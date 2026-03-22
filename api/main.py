from __future__ import annotations

"""
BuildProof FastAPI application.

Architectural role:
  This is a read layer + thin orchestration shim alongside the real subnet.
  Proposals are written to SQLite with status='queued'. The validator polls
  the DB for queued jobs (no in-process queue dependency).

Queue flow:
  POST /proposals → save to DB with status='queued'
  Validator claims proposals transactionally (status → 'processing')
  Validator writes results (status → 'complete')
  API reads results from DB
"""

import asyncio
import json
import os
import secrets
import statistics
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api import db
from api.models import (
    BenchmarkRunRequest,
    BenchmarkRunResponse,
    DecisionPacket,
    FundingDecision,
    Leaderboard,
    LeaderboardEntry,
    MinerOutput,
    Proposal,
    ProposalAccepted,
    ProposalResult,
    ProposalSubmit,
    RewardAllocation,
    ValidatorScores,
)

from buildproof.protocol import (
    DiligenceQuestions,
    RiskAssessment,
    ScoreVector,
    TASK_TYPES,
)

BENCHMARKS_DIR = Path("benchmarks")

# Adversarial benchmark metadata — loaded once, keyed by proposal_id.
_adv_meta: Optional[dict] = None


def _get_adv_meta() -> dict:
    global _adv_meta
    if _adv_meta is not None:
        return _adv_meta
    result: dict = {}
    for json_file in sorted(BENCHMARKS_DIR.glob("adversarial*.json")):
        try:
            with open(json_file) as f:
                data = json.load(f)
            items = data.get("proposals", data) if isinstance(data, dict) else data
            for item in items:
                pid = item.get("proposal_id") or item.get("id")
                if pid:
                    result[pid] = item
        except Exception:
            pass
    _adv_meta = result
    return _adv_meta


# Task-type → strategy name for display
_TASK_STRATEGIES = {
    "rubric": "rubric_scorer",
    "diligence": "diligence_generator",
    "risk": "risk_detector",
}


def _derive_strategy(uid: int, task_type: str = "") -> str:
    if task_type in _TASK_STRATEGIES:
        return _TASK_STRATEGIES[task_type]
    return _TASK_STRATEGIES.get(TASK_TYPES[uid % len(TASK_TYPES)], "unknown")


def _estimate_cost_usd(latency_ms: Optional[float]) -> float:
    if latency_ms is None:
        return 0.0
    return round(latency_ms / 1000.0 * 0.002, 6)


# ────────────────────────────────────────────────────────────────────────────
# App lifecycle
# ────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(
    title="BuildProof API",
    description="Orchestration and read layer for the BuildProof Bittensor subnet.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ────────────────────────────────────────────────────────────────────────────
# Health
# ────────────────────────────────────────────────────────────────────────────

# ── Hotkey verification request/response models ──────────────────────────────

class HotkeyChallengeRequest(BaseModel):
    hotkey: str


class HotkeyChallengeResponse(BaseModel):
    hotkey: str
    nonce: str
    message: str
    expires_in_seconds: int = 300


class HotkeyVerifyRequest(BaseModel):
    hotkey: str
    nonce: str
    signature: str  # hex-encoded sr25519 signature of the nonce bytes


class HotkeyVerifyResponse(BaseModel):
    hotkey: str
    uid: Optional[int]
    verified: bool
    message: str


# ── Hotkey verification helpers ───────────────────────────────────────────────

def _lookup_uid_for_hotkey(hotkey: str) -> Optional[int]:
    """
    Look up the UID for a hotkey from the latest weight snapshot's metadata.
    In a live testnet context this would call subtensor.get_uid_for_hotkey();
    for the demo/API-only path we scan the leaderboard table as a proxy.
    """
    try:
        rows = db.get_leaderboard()
        for row in rows:
            if row.get("hotkey") == hotkey:
                return row["uid"]
    except Exception:
        pass
    return None


def _verify_hotkey_signature(hotkey: str, nonce: str, signature_hex: str) -> bool:
    """
    Verify a sr25519 signature over a nonce using the Bittensor keypair.

    The miner signs the UTF-8 encoded nonce string with their hotkey private key.
    We verify using the public key (ss58 address).

    Falls back gracefully when bittensor is not available (tests/demo mode).
    """
    try:
        import bittensor as bt
        keypair = bt.Keypair(ss58_address=hotkey)
        signature_bytes = bytes.fromhex(signature_hex)
        return keypair.verify(nonce.encode("utf-8"), signature_bytes)
    except Exception:
        return False


@app.get("/health")
def health():
    raw = os.environ.get("ENABLE_EXTERNAL_API_CALLS", "true").strip().lower()
    external_api_enabled = raw not in {"0", "false", "no", "off"}
    return {
        "status": "ok",
        "db": str(db.DB_PATH.resolve()),
        "queue_model": "db-backed",
        "enable_external_api_calls": external_api_enabled,
        "mode": "live" if external_api_enabled else "seeded-fallback",
    }


# ────────────────────────────────────────────────────────────────────────────
# Hotkey verification — challenge / verify endpoints
# ────────────────────────────────────────────────────────────────────────────

@app.post("/hotkey/challenge", response_model=HotkeyChallengeResponse)
def hotkey_challenge(body: HotkeyChallengeRequest) -> HotkeyChallengeResponse:
    """
    Issue a one-time challenge nonce that the miner must sign with their hotkey.

    Flow:
      1. Miner calls POST /hotkey/challenge with their ss58 hotkey address.
      2. Server returns a random nonce (32 hex chars).
      3. Miner signs the nonce with their sr25519 private key.
      4. Miner calls POST /hotkey/verify with (hotkey, nonce, signature).

    Nonces expire after 5 minutes and can only be used once.
    """
    hotkey = body.hotkey.strip()
    if not hotkey:
        raise HTTPException(status_code=422, detail="hotkey must not be empty")

    nonce = secrets.token_hex(16)
    db.store_challenge(nonce, hotkey)
    db.expire_old_challenges()

    return HotkeyChallengeResponse(
        hotkey=hotkey,
        nonce=nonce,
        message=f"Sign the nonce with your hotkey private key and submit to POST /hotkey/verify",
        expires_in_seconds=300,
    )


@app.post("/hotkey/verify", response_model=HotkeyVerifyResponse)
def hotkey_verify(body: HotkeyVerifyRequest) -> HotkeyVerifyResponse:
    """
    Verify a miner's hotkey ownership via signature over a challenge nonce.

    The miner must have previously called POST /hotkey/challenge to obtain a nonce.
    The signature must be a hex-encoded sr25519 signature of the UTF-8 encoded nonce.

    On success, the hotkey is recorded as verified and future proposal submissions
    with X-Hotkey: <hotkey> will be marked is_verified=1.
    """
    hotkey = body.hotkey.strip()
    nonce = body.nonce.strip()
    signature = body.signature.strip()

    if not hotkey or not nonce or not signature:
        raise HTTPException(status_code=422, detail="hotkey, nonce, and signature are required")

    # Consume the challenge nonce (atomic, prevents replay)
    if not db.consume_challenge(nonce, hotkey):
        raise HTTPException(
            status_code=400,
            detail="Invalid, expired, or already-used nonce. Request a new challenge.",
        )

    # Verify signature
    if not _verify_hotkey_signature(hotkey, nonce, signature):
        raise HTTPException(
            status_code=401,
            detail="Signature verification failed. Ensure you signed the nonce with the correct hotkey.",
        )

    uid = _lookup_uid_for_hotkey(hotkey)
    db.record_verified_hotkey(hotkey, uid, nonce)

    return HotkeyVerifyResponse(
        hotkey=hotkey,
        uid=uid,
        verified=True,
        message=f"Hotkey verified successfully. Future proposals submitted with X-Hotkey: {hotkey} will be marked as verified.",
    )


@app.get("/hotkey/{hotkey}/status")
def hotkey_status(hotkey: str):
    """Check whether a hotkey has been verified."""
    record = db.get_verified_hotkey(hotkey)
    if record is None:
        return {"hotkey": hotkey, "verified": False}
    return {
        "hotkey": hotkey,
        "verified": True,
        "uid": record.get("uid"),
        "verified_at": record.get("verified_at"),
    }


# ────────────────────────────────────────────────────────────────────────────
# POST /proposals
# ────────────────────────────────────────────────────────────────────────────

@app.post("/proposals", response_model=ProposalAccepted, status_code=202)
def submit_proposal(
    body: ProposalSubmit,
    x_hotkey: Optional[str] = Header(default=None, alias="X-Hotkey"),
) -> ProposalAccepted:
    """
    Accept a proposal and persist it with status='queued'.
    The validator will claim it from the DB on its next epoch tick.

    Optional hotkey attribution:
      Include an 'X-Hotkey' header with a verified hotkey ss58 address to
      attribute this submission to a registered miner. The proposal will be
      flagged is_verified=1 if the hotkey has a valid verification record.
      Unverified submissions are accepted normally with is_verified=0.
    """
    proposal_id = body.proposal_id or f"p_{uuid.uuid4().hex[:8]}"

    submitter_hotkey = x_hotkey.strip() if x_hotkey else None
    is_verified = 0
    if submitter_hotkey:
        is_verified = 1 if db.is_hotkey_verified(submitter_hotkey) else 0

    proposal_dict = {
        "proposal_id": proposal_id,
        "title": body.title,
        "proposal_text": body.proposal_text,
        "program_mandate": body.program_mandate,
        "requested_amount": body.requested_amount,
        "submitted_at": time.time(),
        "submitter_hotkey": submitter_hotkey,
        "is_verified": is_verified,
    }

    db.save_proposal(proposal_dict)

    db.emit_event(proposal_id, "proposal_queued", source="api", payload={
        "proposal_id": proposal_id,
        "title": body.title,
        "submitter_hotkey": submitter_hotkey,
        "is_verified": bool(is_verified),
    })

    message = "Proposal queued for validator evaluation."
    if submitter_hotkey and is_verified:
        message += f" Attributed to verified hotkey {submitter_hotkey}."
    elif submitter_hotkey and not is_verified:
        message += f" Hotkey {submitter_hotkey} is not verified — call POST /hotkey/challenge to verify."

    return ProposalAccepted(
        proposal_id=proposal_id,
        status="queued",
        message=message,
    )


# ────────────────────────────────────────────────────────────────────────────
# GET /proposals/{id}/results
# ────────────────────────────────────────────────────────────────────────────

@app.get("/proposals/{proposal_id}/results", response_model=ProposalResult)
def get_results(proposal_id: str) -> ProposalResult:
    raw = db.get_proposal_results(proposal_id)
    if raw is None:
        raise HTTPException(
            status_code=404,
            detail=f"No results found for proposal_id='{proposal_id}'. "
            "The validator may not have processed it yet.",
        )
    return _build_proposal_result(raw)


def _build_proposal_result(raw: dict) -> ProposalResult:
    outputs = [_build_miner_output(mo) for mo in raw["miner_outputs"]]
    consensus = _weighted_recommendation_vote(outputs)
    proposal_info = db.get_proposal(raw["proposal_id"]) or {}

    return ProposalResult(
        proposal_id=raw["proposal_id"],
        proposal_text=proposal_info.get("proposal_text", ""),
        status=proposal_info.get("status", "complete"),
        is_adversarial=raw["is_adversarial"],
        evaluated_at=raw["evaluated_at"],
        miner_responses=outputs,
        consensus_recommendation=consensus,
        decision=_build_funding_decision(outputs),
    )


def _build_miner_output(mo: dict) -> MinerOutput:
    uid = mo["uid"]
    task_type = mo.get("task_type", "rubric")
    resp = mo.get("response") or {}
    latency_ms = float(mo.get("latency_ms") or 0.0)
    vs_raw = mo.get("validator_scores", {})

    # Parse typed response fields
    sv = None
    dq = None
    ra = None

    if "score_vector" in resp and resp["score_vector"]:
        try:
            sv = ScoreVector(**resp["score_vector"])
        except Exception:
            pass
    if "diligence_questions" in resp and resp["diligence_questions"]:
        try:
            dq = DiligenceQuestions(**resp["diligence_questions"])
        except Exception:
            pass
    if "risk_assessment" in resp and resp["risk_assessment"]:
        try:
            ra = RiskAssessment(**resp["risk_assessment"])
        except Exception:
            pass

    # Build penalties display dict
    raw_penalties = vs_raw.get("penalties", {})
    penalties_display = {k: round(float(v), 4) for k, v in raw_penalties.items()} if raw_penalties else {}

    return MinerOutput(
        uid=uid,
        hotkey=mo.get("hotkey"),
        task_type=task_type,
        strategy=_derive_strategy(uid, task_type),
        backend=mo.get("backend", "unknown"),
        score_vector=sv,
        diligence_questions=dq,
        risk_assessment=ra,
        latency_ms=latency_ms,
        estimated_cost_usd=mo.get("estimated_cost") or _estimate_cost_usd(latency_ms),
        score=ValidatorScores(
            quality=vs_raw.get("quality", 0.0),
            calibration=vs_raw.get("calibration", 0.0),
            robustness=vs_raw.get("robustness", 0.0),
            efficiency=vs_raw.get("efficiency", 0.0),
            anti_gaming=vs_raw.get("anti_gaming", 0.0),
            composite=vs_raw.get("composite", 0.0),
            penalties=penalties_display,
        ),
        reward=mo.get("reward", 0.0),
        reward_share=mo.get("reward_share", 0.0),
    )


def _weighted_recommendation_vote(outputs: List[MinerOutput]) -> Optional[str]:
    """Derive consensus from rubric miners' implicit recommendation."""
    vote: dict[str, float] = {}
    for mo in outputs:
        if mo.score_vector:
            avg = sum(
                getattr(mo.score_vector, d, 0.0)
                for d in ["feasibility", "impact", "clarity", "mandate_alignment"]
            ) / 4
            if avg >= 0.65:
                rec = "fund"
            elif avg >= 0.40:
                rec = "fund_with_conditions"
            else:
                rec = "reject"
            vote[rec] = vote.get(rec, 0.0) + mo.score.composite

        if mo.risk_assessment and mo.risk_assessment.fraud_risk > 0.6:
            vote["reject"] = vote.get("reject", 0.0) + mo.score.composite * 1.5

    if not vote:
        return None
    return max(vote, key=vote.__getitem__)


def _build_funding_decision(outputs: List[MinerOutput]) -> Optional[FundingDecision]:
    if not outputs:
        return None

    rec = _weighted_recommendation_vote(outputs) or "reject"

    conf = 0.5
    conf_signals = []
    conf_weights = []
    for mo in outputs:
        if mo.score_vector and mo.score_vector.confidence_by_dimension:
            avg_conf = sum(mo.score_vector.confidence_by_dimension.values()) / max(
                len(mo.score_vector.confidence_by_dimension), 1
            )
            conf_signals.append(avg_conf * mo.score.composite)
            conf_weights.append(mo.score.composite)
    if conf_signals:
        contributing_w = sum(conf_weights)
        if contributing_w > 0:
            conf = sum(conf_signals) / contributing_w

    n = len(outputs)
    rec_label = {"fund": "fund", "fund_with_conditions": "fund with conditions", "reject": "reject"}.get(rec, rec)
    rationale = f"Consensus across {n} miner{'s' if n > 1 else ''}: {rec_label}."

    dissenting: List[str] = []
    risk_miners = [mo for mo in outputs if mo.risk_assessment and mo.risk_assessment.fraud_risk > 0.5]
    if risk_miners and rec != "reject":
        for mo in risk_miners:
            dissenting.append(
                f"UID {mo.uid} (risk_detector) flagged fraud_risk="
                f"{mo.risk_assessment.fraud_risk:.2f}"
            )

    # Disagreement: variance in composite scores across miners
    composites = [mo.score.composite for mo in outputs]
    disagreement_score = 0.0
    disagreement_reason: Optional[str] = None
    if len(composites) >= 2:
        import statistics as _stats
        try:
            variance = _stats.variance(composites)
            disagreement_score = round(min(1.0, variance * 10), 3)
            if disagreement_score > 0.15:
                spread = max(composites) - min(composites)
                disagreement_reason = (
                    f"Miners diverge by {spread * 100:.1f} composite points — "
                    f"highest UID {outputs[composites.index(max(composites))].uid} "
                    f"vs lowest UID {outputs[composites.index(min(composites))].uid}"
                )
        except Exception:
            pass

    return FundingDecision(
        recommendation=rec,  # type: ignore[arg-type]
        consensus_confidence=round(conf, 3),
        rationale=rationale,
        dissenting_views=dissenting,
        disagreement_score=disagreement_score,
        disagreement_reason=disagreement_reason,
    )


# ────────────────────────────────────────────────────────────────────────────
# GET /leaderboard
# ────────────────────────────────────────────────────────────────────────────

@app.get("/leaderboard", response_model=Leaderboard)
def get_leaderboard() -> Leaderboard:
    rows = db.get_leaderboard()
    total_rewards = sum(r["total_reward"] for r in rows) or 1.0
    entries = [
        LeaderboardEntry(
            uid=r["uid"],
            hotkey=r.get("hotkey"),
            task_type=r.get("task_type", ""),
            strategy=_derive_strategy(r["uid"], r.get("task_type", "")),
            proposals_evaluated=r["proposals_evaluated"],
            avg_quality=round(r["avg_quality"], 4),
            avg_calibration=round(r["avg_calibration"], 4),
            avg_robustness=round(r["avg_robustness"], 4),
            avg_efficiency=round(r["avg_efficiency"], 4),
            avg_composite=round(r["avg_composite"], 4),
            composite_score=round(r["avg_composite"], 4),
            total_reward=round(r["total_reward"], 4),
            reward_share=round(r["total_reward"] / total_rewards, 4),
            on_chain_weight=r.get("on_chain_weight"),
            weight=r.get("on_chain_weight"),
            latency_ms=round(r.get("avg_latency_ms", 0.0) or 0.0, 1),
            estimated_cost_usd=_estimate_cost_usd(r.get("avg_latency_ms")),
            rank=r["rank"],
        )
        for r in rows
    ]
    return Leaderboard(updated_at=time.time(), entries=entries)


# ────────────────────────────────────────────────────────────────────────────
# POST /benchmarks/run
# ────────────────────────────────────────────────────────────────────────────

@app.post("/benchmarks/run", response_model=BenchmarkRunResponse)
def run_benchmarks(body: BenchmarkRunRequest = BenchmarkRunRequest()) -> BenchmarkRunResponse:
    """
    Enqueue curated benchmark proposals for validator evaluation.
    Proposals are saved to DB with status='queued'; the validator claims them.
    """
    all_proposals = _load_benchmark_proposals(body.include_adversarial)

    if body.proposal_ids:
        requested = set(body.proposal_ids)
        all_proposals = [p for p in all_proposals if p["proposal_id"] in requested]

    enqueued: List[str] = []
    already_complete: List[str] = []

    for p in all_proposals:
        existing = db.get_proposal(p["proposal_id"])
        if existing and existing["status"] == "complete":
            already_complete.append(p["proposal_id"])
            continue
        db.save_proposal(p)
        enqueued.append(p["proposal_id"])

    return BenchmarkRunResponse(
        enqueued=enqueued,
        already_complete=already_complete,
        message=(
            f"Enqueued {len(enqueued)} benchmark proposal(s). "
            f"{len(already_complete)} already had results."
        ),
    )


def _load_benchmark_proposals(include_adversarial: bool = True) -> List[dict]:
    proposals: List[dict] = []
    ts = time.time()

    for json_file in sorted(BENCHMARKS_DIR.glob("gold*.json")):
        try:
            with open(json_file) as f:
                data = json.load(f)
            items = data.get("proposals", data) if isinstance(data, dict) else data
            for item in items:
                pid = item.get("proposal_id") or item.get("id")
                if pid:
                    proposals.append({
                        "proposal_id": pid,
                        "title": item.get("title", ""),
                        "proposal_text": item.get("proposal_text") or item.get("text", ""),
                        "program_mandate": item.get("program_mandate", ""),
                        "submitted_at": ts,
                    })
        except Exception:
            pass

    if include_adversarial:
        for json_file in sorted(BENCHMARKS_DIR.glob("adversarial*.json")):
            try:
                with open(json_file) as f:
                    data = json.load(f)
                items = data.get("proposals", data) if isinstance(data, dict) else data
                for item in items:
                    pid = item.get("proposal_id") or item.get("id")
                    if pid:
                        proposals.append({
                            "proposal_id": pid,
                            "title": item.get("title", f"[Adversarial] {item.get('attack_type', '')}"),
                            "proposal_text": item.get("proposal_text") or item.get("text", ""),
                            "program_mandate": item.get("program_mandate", ""),
                            "submitted_at": ts,
                        })
            except Exception:
                pass

    return proposals


# ────────────────────────────────────────────────────────────────────────────
# GET /decision-packet/{id}
# ────────────────────────────────────────────────────────────────────────────

@app.get("/decision-packet/{proposal_id}", response_model=DecisionPacket)
def get_decision_packet(proposal_id: str) -> DecisionPacket:
    raw = db.get_proposal_results(proposal_id)
    if raw is None:
        raise HTTPException(
            status_code=404,
            detail=f"No results found for proposal_id='{proposal_id}'.",
        )

    proposal_info = db.get_proposal(proposal_id) or {}
    outputs = [_build_miner_output(mo) for mo in raw["miner_outputs"]]

    if not outputs:
        raise HTTPException(status_code=404, detail="No miner outputs available.")

    outputs.sort(key=lambda x: x.score.composite, reverse=True)
    top = outputs[0]

    consensus_rec = _weighted_recommendation_vote(outputs) or "reject"

    # Aggregate rubric scores from rubric miners
    rubric_miners = [mo for mo in outputs if mo.score_vector]
    aggregated_sv = None
    if rubric_miners:
        dims = ["feasibility", "impact", "novelty", "budget_reasonableness", "clarity", "mandate_alignment"]
        total_w = sum(mo.score.composite for mo in rubric_miners)
        if total_w > 0:
            agg = {}
            for d in dims:
                agg[d] = sum(
                    getattr(mo.score_vector, d, 0.0) * mo.score.composite
                    for mo in rubric_miners
                ) / total_w
                agg[d] = round(agg[d], 4)
            aggregated_sv = ScoreVector(**agg)

    # Best diligence questions
    diligence_miners = [mo for mo in outputs if mo.diligence_questions]
    top_dqs: List[str] = []
    if diligence_miners:
        best_dq = max(diligence_miners, key=lambda m: m.score.composite)
        top_dqs = best_dq.diligence_questions.questions[:6]

    # Risk summary from risk miners
    risk_miners = [mo for mo in outputs if mo.risk_assessment]
    risk_summary = None
    if risk_miners:
        best_risk = max(risk_miners, key=lambda m: m.score.composite)
        risk_summary = best_risk.risk_assessment

    # Fraud flags
    fraud_flags: List[str] = []
    for mo in risk_miners:
        if mo.risk_assessment and mo.risk_assessment.fraud_risk > 0.5:
            for flag in mo.risk_assessment.manipulation_flags:
                if flag not in fraud_flags:
                    fraud_flags.append(flag)

    # Weights
    weight_snapshot = db.get_latest_weight_snapshot() or []
    weight_map = {entry["uid"]: entry["weight"] for entry in weight_snapshot}

    validator_weights = [
        RewardAllocation(
            uid=mo.uid,
            hotkey=mo.hotkey,
            task_type=mo.task_type,
            composite_score=round(mo.score.composite, 4),
            reward_share=round(mo.reward_share, 4),
            on_chain_weight=weight_map.get(mo.uid),
        )
        for mo in outputs
    ]

    return DecisionPacket(
        proposal_id=proposal_id,
        title=proposal_info.get("title"),
        generated_at=time.time(),
        top_miner_uid=top.uid,
        consensus_recommendation=consensus_rec,
        aggregated_scores=aggregated_sv,
        top_diligence_questions=top_dqs,
        risk_summary=risk_summary,
        is_adversarial=raw["is_adversarial"],
        fraud_flags=fraud_flags,
        validator_weights=validator_weights,
        miner_responses=outputs,
    )


# ────────────────────────────────────────────────────────────────────────────
# GET /task-scores/{proposal_id}
# ────────────────────────────────────────────────────────────────────────────

@app.get("/task-scores/{proposal_id}")
def get_task_scores(proposal_id: str, miner_uid: Optional[int] = None):
    """Return granular per-metric task scores for a proposal."""
    rows = db.get_task_scores(proposal_id, miner_uid)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No task scores for proposal_id='{proposal_id}'.",
        )
    return {"proposal_id": proposal_id, "scores": rows}


# ────────────────────────────────────────────────────────────────────────────
# GET /proposals/{id}/events  — SSE stream of evaluation events
# GET /proposals/{id}/events/poll — REST polling fallback
# ────────────────────────────────────────────────────────────────────────────

_TERMINAL_EVENTS = {"decision_packet_ready"}
_SSE_TIMEOUT = 120  # seconds before auto-close


@app.get("/proposals/{proposal_id}/events")
async def stream_evaluation_events(proposal_id: str):
    """
    Server-Sent Events stream of structured evaluation events.
    Emits 'eval' events until decision_packet_ready or timeout.
    """
    async def event_generator():
        cursor = 0
        deadline = time.time() + _SSE_TIMEOUT
        # Send a comment to keep connection alive and confirm open
        yield ": connected\n\n"

        while time.time() < deadline:
            events = db.get_events(proposal_id, after_id=cursor)
            for ev in events:
                cursor = ev["id"]
                data = json.dumps(ev)
                yield f"event: eval\ndata: {data}\n\n"
                if ev["event_type"] in _TERMINAL_EVENTS:
                    return

            await asyncio.sleep(0.5)

        # Timeout — send a close sentinel
        yield "event: timeout\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/proposals/{proposal_id}/events/poll")
def poll_evaluation_events(
    proposal_id: str,
    after_id: int = Query(default=0, ge=0),
):
    """REST polling fallback: returns events with id > after_id."""
    events = db.get_events(proposal_id, after_id=after_id)
    return {"proposal_id": proposal_id, "events": events}


@app.get("/proposals/{proposal_id}/replay")
def replay_evaluation(proposal_id: str):
    """Return all stored events for a proposal for replay animation."""
    events = db.get_events(proposal_id, after_id=0)
    return {"proposal_id": proposal_id, "events": events, "total": len(events)}


# ────────────────────────────────────────────────────────────────────────────
# Chain weights
# ────────────────────────────────────────────────────────────────────────────

@app.get("/chain/weights")
def get_chain_weights():
    """Return the latest on-chain weight vector."""
    snapshot = db.get_latest_weight_snapshot()
    if snapshot is None:
        return {"weights": [], "snapshot_at": None, "epoch": None}
    return {
        "weights": snapshot.get("weights", []),
        "snapshot_at": snapshot.get("snapshot_at"),
    }


@app.get("/chain/weights/history")
def get_chain_weights_history(limit: int = Query(default=10, ge=1, le=50)):
    """Return the last N weight snapshots for trend visualization."""
    history = db.get_weight_history(limit=limit)
    return {"history": history, "count": len(history)}


# ────────────────────────────────────────────────────────────────────────────
# Adversarial Arena
# ────────────────────────────────────────────────────────────────────────────

@app.post("/arena/run")
def arena_run():
    """Enqueue and directly evaluate all adversarial proposals.

    Proposals that are already complete are skipped.  New proposals are saved
    to the DB and then evaluated inline using the direct-eval miner strategies
    (up to 5 proposals concurrently, 3 miners per proposal concurrently).
    This avoids the race between /arena/run and /arena/results when no
    bittensor validator process is running.
    """
    proposals = _load_benchmark_proposals(include_adversarial=True)
    adversarial = [p for p in proposals if p["proposal_id"].startswith("adv")]

    enqueued: List[str] = []
    already_complete: List[str] = []

    for p in adversarial:
        existing = db.get_proposal(p["proposal_id"])
        if existing and existing["status"] == "complete":
            already_complete.append(p["proposal_id"])
            continue
        db.save_proposal(p)
        enqueued.append(p["proposal_id"])

    # Evaluate unevaluated proposals concurrently (up to 5 at once).
    # Each proposal runs its 3 miners in parallel inside _direct_eval_proposal.
    if enqueued:
        with ThreadPoolExecutor(max_workers=5) as pool:
            list(pool.map(_direct_eval_proposal, enqueued))

    return {
        "run_id": f"arena_{int(time.time())}",
        "enqueued": enqueued,
        "already_complete": already_complete,
        "message": f"Evaluated {len(enqueued)} adversarial proposals.",
    }


@app.get("/arena/results")
def get_arena_results():
    """Return aggregated adversarial evaluation results with per-miner fooled/caught breakdown."""
    raw_results = db.get_adversarial_results()

    adv_meta = _get_adv_meta()
    enriched = []
    total_caught = 0
    total_fooled = 0

    for result in raw_results:
        pid = result["proposal_id"]
        meta = adv_meta.get(pid, {})
        expected_min = float(meta.get("expected_fraud_risk_min", 0.6))
        expected_flags = meta.get("expected_flags", [])

        miner_results = []
        for m in result["miners"]:
            was_fooled = m["fraud_risk"] < expected_min
            found_flags = [f for f in m["manipulation_flags"] if f in expected_flags]
            miner_results.append({
                **m,
                "was_fooled": was_fooled,
                "expected_fraud_risk_min": expected_min,
                "expected_flags": expected_flags,
                "flags_found": found_flags,
                "flag_recall": len(found_flags) / max(len(expected_flags), 1),
            })
            if was_fooled:
                total_fooled += 1
            else:
                total_caught += 1

        enriched.append({
            "proposal_id": pid,
            "attack_type": meta.get("attack_type", "unknown"),
            "title": meta.get("title", pid),
            "severity": meta.get("severity", "medium"),
            "trap_description": meta.get("trap_description", ""),
            "expected_fraud_risk_min": expected_min,
            "expected_flags": expected_flags,
            "miner_results": miner_results,
        })

    return {
        "proposals": enriched,
        "summary": {
            "total_proposals": len(enriched),
            "total_caught": total_caught,
            "total_fooled": total_fooled,
            "detection_rate": round(total_caught / max(total_caught + total_fooled, 1), 3),
        },
    }


@app.get("/arena/{proposal_id}/result")
def get_arena_single_result(proposal_id: str):
    """Return adversarial evaluation for a single proposal."""
    raw = db.get_proposal_results(proposal_id)
    if raw is None:
        raise HTTPException(status_code=404, detail=f"No results for {proposal_id}")

    outputs = [_build_miner_output(mo) for mo in raw["miner_outputs"]]

    meta = _get_adv_meta().get(proposal_id, {})
    expected_min = float(meta.get("expected_fraud_risk_min", 0.6))
    expected_flags = meta.get("expected_flags", [])

    miner_results = []
    for mo in outputs:
        fraud_risk = mo.risk_assessment.fraud_risk if mo.risk_assessment else 0.0
        flags = mo.risk_assessment.manipulation_flags if mo.risk_assessment else []
        was_fooled = fraud_risk < expected_min
        miner_results.append({
            "uid": mo.uid,
            "task_type": mo.task_type,
            "backend": mo.backend,
            "fraud_risk": fraud_risk,
            "manipulation_flags": flags,
            "was_fooled": was_fooled,
            "required_fraud_risk_min": expected_min,
            "robustness_score": mo.score.robustness,
            "composite_score": mo.score.composite,
            "reward_share": mo.reward_share,
            "latency_ms": mo.latency_ms,
        })

    return {
        "proposal_id": proposal_id,
        "attack_type": meta.get("attack_type", "unknown"),
        "title": meta.get("title", proposal_id),
        "severity": meta.get("severity", "medium"),
        "trap_description": meta.get("trap_description", ""),
        "expected_fraud_risk_min": expected_min,
        "expected_flags": expected_flags,
        "miner_results": miner_results,
        "total_caught": sum(1 for m in miner_results if not m["was_fooled"]),
        "total_fooled": sum(1 for m in miner_results if m["was_fooled"]),
    }


# ────────────────────────────────────────────────────────────────────────────
# Calibration leaderboard
# ────────────────────────────────────────────────────────────────────────────

@app.get("/leaderboard/calibration")
def get_calibration_leaderboard():
    """Return per-miner calibration ranking."""
    stats = db.get_calibration_stats()
    return {"updated_at": time.time(), "entries": stats}


# ────────────────────────────────────────────────────────────────────────────
# Direct in-process evaluation (fallback when bittensor stack is not running)
# ────────────────────────────────────────────────────────────────────────────

def _direct_eval_scores(result, task_type: str) -> dict:
    """
    Compute simplified validator scores for a directly-evaluated miner result.

    These approximate the real validator reward model without requiring the
    full bittensor stack.  Used only by the /evaluate-direct endpoint.
    """
    quality = 0.75
    calibration = 0.70
    robustness = 0.80
    efficiency = 0.88

    if task_type == "rubric" and result.score_vector:
        sv = result.score_vector
        dims = [
            "feasibility", "impact", "novelty",
            "budget_reasonableness", "clarity", "mandate_alignment",
        ]
        scores_list = [getattr(sv, d, 0.5) for d in dims]
        quality = round(sum(scores_list) / len(scores_list), 4)

        if sv.confidence_by_dimension:
            conf_vals = list(sv.confidence_by_dimension.values())
            if conf_vals:
                mean_c = sum(conf_vals) / len(conf_vals)
                variance = (
                    sum((v - mean_c) ** 2 for v in conf_vals) / len(conf_vals)
                    if len(conf_vals) > 1 else 0.01
                )
                # Reward variance in confidence; penalise always-high
                calibration = min(0.95, 0.5 + variance * 10 + (0.1 if mean_c < 0.85 else 0.0))

    elif task_type == "diligence" and result.diligence_questions:
        dq = result.diligence_questions
        n_questions = len(dq.questions)
        quality = min(0.95, 0.50 + n_questions * 0.06)
        calibration = 0.75

    elif task_type == "risk" and result.risk_assessment:
        ra = result.risk_assessment
        quality = min(0.95, 0.70 + len(ra.manipulation_flags) * 0.04)
        robustness = min(1.0, 0.75 + ra.fraud_risk * 0.25) if ra.fraud_risk > 0.3 else 0.80

    if result.latency_ms:
        efficiency = max(0.10, 1.0 - result.latency_ms / 10_000)

    composite = round(
        0.35 * quality + 0.25 * calibration + 0.25 * robustness + 0.15 * efficiency, 4
    )
    return {
        "quality": round(quality, 4),
        "calibration": round(calibration, 4),
        "robustness": round(robustness, 4),
        "efficiency": round(efficiency, 4),
        "anti_gaming": 0.0,
        "composite": composite,
    }


def _run_single_miner(
    uid: int,
    StratClass,
    task_type: str,
    proposal_id: str,
    proposal_text: str,
    program_mandate: str,
) -> dict:
    """Evaluate one miner strategy and return a result dict.

    Designed to be called from a ThreadPoolExecutor so that multiple miners
    can run concurrently.  DB event emission is intentionally skipped here;
    callers that need event ordering should emit before/after the parallel block.
    """
    try:
        strategy = StratClass()
        result = strategy.evaluate(proposal_id, proposal_text, program_mandate)

        response_dict: dict = {}
        if result.score_vector is not None:
            response_dict["score_vector"] = result.score_vector.model_dump()
        if result.diligence_questions is not None:
            response_dict["diligence_questions"] = result.diligence_questions.model_dump()
        if result.risk_assessment is not None:
            response_dict["risk_assessment"] = result.risk_assessment.model_dump()

        scores = _direct_eval_scores(result, task_type)
        return {
            "uid": uid,
            "task_type": task_type,
            "response": response_dict,
            "latency_ms": result.latency_ms or 0.0,
            "estimated_cost": result.estimated_cost_usd or 0.0,
            "backend": result.backend or "direct",
            "scores": scores,
            "task_metrics": {},
            "penalties": {},
            "reward": scores["composite"],
        }
    except Exception as exc:
        return {
            "uid": uid,
            "task_type": task_type,
            "response": None,
            "latency_ms": 0.0,
            "estimated_cost": 0.0,
            "backend": "error",
            "scores": {
                "quality": 0.0, "calibration": 0.0, "robustness": 0.0,
                "efficiency": 0.0, "anti_gaming": 0.0, "composite": 0.0,
            },
            "task_metrics": {},
            "penalties": {},
            "reward": 0.0,
            "_error": str(exc),
        }


def _direct_eval_proposal(proposal_id: str) -> None:
    """Run inline direct evaluation for a single proposal, miners in parallel.

    Skips proposals that are already fully evaluated.  Safe to call from a
    thread pool — all DB access goes through the module-level _lock.
    """
    if db.get_proposal_results(proposal_id) is not None:
        return

    proposal = db.get_proposal(proposal_id)
    if proposal is None:
        return

    try:
        from miners.rubric_scorer import Strategy as RubricStrategy
        from miners.diligence_generator import Strategy as DiligenceStrategy
        from miners.risk_detector import Strategy as RiskStrategy
    except ImportError:
        return

    proposal_text: str = proposal.get("proposal_text", "")
    program_mandate: str = proposal.get("program_mandate", "")
    ts = time.time()

    task_configs = [
        (1, RubricStrategy, "rubric"),
        (2, DiligenceStrategy, "diligence"),
        (3, RiskStrategy, "risk"),
    ]

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(
                _run_single_miner,
                uid, StratClass, task_type,
                proposal_id, proposal_text, program_mandate,
            ): (uid, task_type)
            for uid, StratClass, task_type in task_configs
        }
        miner_results = [f.result() for f in as_completed(futures)]

    db.save_epoch_result({
        "proposal_id": proposal_id,
        "is_adversarial": proposal_id.startswith("adv"),
        "timestamp": ts,
        "miner_results": miner_results,
    })


@app.post("/proposals/{proposal_id}/evaluate-direct", response_model=ProposalResult)
def evaluate_proposal_direct(proposal_id: str) -> ProposalResult:
    """
    In-process evaluation using miner strategies directly.

    Bypasses the bittensor validator/miner stack entirely — no chain or
    running neuron processes required.  Each of the three miner strategies
    is instantiated and called inline.

    When ENABLE_EXTERNAL_API_CALLS=false the strategies automatically use
    seeded/rule-based fallbacks.  This endpoint is therefore safe to call
    in any environment and always produces a complete ProposalResult.

    Use this as a fallback when:
      - The bittensor validator process is not running, OR
      - ENABLE_EXTERNAL_API_CALLS=false and you need an immediate result.
    """
    proposal = db.get_proposal(proposal_id)
    if proposal is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Proposal '{proposal_id}' not found. "
                "Submit it first via POST /proposals."
            ),
        )

    # Skip re-evaluation if already complete
    existing = db.get_proposal_results(proposal_id)
    if existing is not None:
        return _build_proposal_result(existing)

    proposal_text: str = proposal.get("proposal_text", "")
    program_mandate: str = proposal.get("program_mandate", "")
    ts = time.time()

    try:
        from miners.rubric_scorer import Strategy as RubricStrategy
        from miners.diligence_generator import Strategy as DiligenceStrategy
        from miners.risk_detector import Strategy as RiskStrategy
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Miner strategies not importable: {exc}",
        )

    task_configs = [
        (1, RubricStrategy, "rubric"),
        (2, DiligenceStrategy, "diligence"),
        (3, RiskStrategy, "risk"),
    ]

    # Emit the upstream pipeline events that the live view depends on.
    # These mirror what the bittensor validator emits in run_epoch so that
    # deriveFlowState can advance the Proposal and Validator nodes correctly.
    db.emit_event(
        proposal_id, "proposal_claimed", source="api-direct",
        payload={"proposal_id": proposal_id, "title": proposal.get("title", "")},
    )
    db.emit_event(
        proposal_id, "synapse_built", source="api-direct",
        payload={
            "miner_uids": [uid for uid, _, _ in task_configs],
            "task_types": [tt for _, _, tt in task_configs],
            "sampling_method": "direct",
            "capability_registry_size": 0,
        },
    )

    for uid, _, task_type in task_configs:
        db.emit_event(
            proposal_id, "miner_query_sent",
            source="api-direct", target=f"miner:{uid}",
            payload={"uid": uid, "task_type": task_type},
        )

    # Run all 3 miners concurrently — they are independent I/O-bound tasks.
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(
                _run_single_miner,
                uid, StratClass, task_type,
                proposal_id, proposal_text, program_mandate,
            ): (uid, task_type)
            for uid, StratClass, task_type in task_configs
        }
        miner_results = [f.result() for f in as_completed(futures)]

    for mr in miner_results:
        event = "miner_response_received" if mr["backend"] != "error" else "miner_timeout"
        payload: dict = {"uid": mr["uid"], "task_type": mr["task_type"], "latency_ms": round(mr["latency_ms"], 1)}
        if event == "miner_response_received":
            payload["backend"] = mr["backend"]
        else:
            payload["error"] = mr.get("_error", "unknown")
        db.emit_event(proposal_id, event, source=f"miner:{mr['uid']}", target="api-direct", payload=payload)

    db.emit_event(
        proposal_id, "reward_scored", source="api-direct",
        payload={
            "scores": [
                {"uid": mr["uid"], "task_type": mr["task_type"], **mr["scores"]}
                for mr in miner_results
            ]
        },
    )

    db.save_epoch_result({
        "proposal_id": proposal_id,
        "is_adversarial": False,
        "timestamp": ts,
        "miner_results": miner_results,
    })

    db.emit_event(
        proposal_id, "ema_updated", source="api-direct",
        payload={"updated_uids": [uid for uid, _, _ in task_configs]},
    )

    db.emit_event(
        proposal_id, "decision_packet_ready", source="api-direct",
        payload={
            "proposal_id": proposal_id,
            "is_adversarial": False,
            "miner_count": len(miner_results),
        },
    )

    raw = db.get_proposal_results(proposal_id)
    if raw is None:
        raise HTTPException(status_code=500, detail="Direct evaluation failed to persist results.")
    return _build_proposal_result(raw)
