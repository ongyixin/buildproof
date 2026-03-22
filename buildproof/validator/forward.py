from __future__ import annotations

"""
Validator forward pass for BuildProof.

Key changes from the original:
  1. DB-backed proposal queue (no more in-process queue).
  2. Multi-task dispatch: each miner gets a task_type matching its role.
  3. Metagraph-native sampling: select K miners from eligible UIDs each epoch.
  4. Task-specific scoring via the rewritten reward model.
"""

import json
import time
from pathlib import Path
from typing import TYPE_CHECKING, Dict, List, Optional

import bittensor as bt

from buildproof.protocol import DiligenceSynapse, TASK_TYPES
from buildproof.validator.reward import compute_rewards
from buildproof.utils.uids import get_random_uids, get_all_miner_uids, get_weighted_uids
from buildproof.mutations import MutationEngine

if TYPE_CHECKING:
    from buildproof.base.validator import BaseValidatorNeuron

# Module-level mutation engine (stateful counter, seeded for reproducibility)
_mutation_engine = MutationEngine()

# How often to inject a mutation challenge: every Nth epoch
_MUTATION_CHALLENGE_INTERVAL = 5

# Running epoch counter for challenge scheduling
_epoch_counter: int = 0


# ── Capability registry ─────────────────────────────────────────────────────
# Maps uid → List[str] of task types the miner has self-declared.
# Populated at runtime from miner responses that include supported_tasks.
# Module-level so it persists across epoch calls without requiring validator state.
_capability_registry: Dict[int, List[str]] = {}


def _update_capability_registry(uid: int, synapse: DiligenceSynapse) -> None:
    """Record a miner's declared task capabilities from a response synapse."""
    if synapse.supported_tasks:
        valid = [t for t in synapse.supported_tasks if t in TASK_TYPES]
        if valid:
            _capability_registry[uid] = valid
            bt.logging.debug(
                f"capability_registry: uid={uid} declared supported_tasks={valid}"
            )


# ── Task-type assignment ────────────────────────────────────────────────────

def task_for_uid(uid: int, capability_registry: Optional[Dict[int, List[str]]] = None) -> str:
    """
    Determine the task type for a miner UID.

    Priority:
      1. If the miner has declared its capabilities via supported_tasks in a
         prior response, use the first declared task type.
      2. Fall back to round-robin assignment: uid % len(TASK_TYPES).

    Args:
        uid:                  Miner UID.
        capability_registry:  Optional override registry; uses module-level
                              _capability_registry if not provided.
    """
    registry = capability_registry if capability_registry is not None else _capability_registry
    declared = registry.get(uid)
    if declared:
        task = declared[0]
        bt.logging.debug(f"task_for_uid: uid={uid} → {task} (declared)")
        return task
    task = TASK_TYPES[uid % len(TASK_TYPES)]
    bt.logging.debug(f"task_for_uid: uid={uid} → {task} (fallback uid%{len(TASK_TYPES)})")
    return task


# ────────────────────────────────────────────────────────────────────────────
# Benchmark Manager
# ────────────────────────────────────────────────────────────────────────────


class BenchmarkManager:
    """
    Loads and indexes the curated proposal corpora used by the reward model.

    Supports the expanded benchmark structure with per-task reference data.
    Provides a category index for filtered benchmark runs.
    """

    def __init__(self, benchmarks_dir: str = "benchmarks"):
        self._gold: dict[str, dict] = {}
        self._adversarial: dict[str, dict] = {}
        self._by_category: dict[str, List[str]] = {}  # category → [proposal_id, ...]
        self._by_domain: dict[str, List[str]] = {}    # domain → [proposal_id, ...]
        self._bench_idx: int = 0
        self._load(benchmarks_dir)

    def _load(self, benchmarks_dir: str) -> None:
        base = Path(benchmarks_dir)

        for json_file in sorted(base.glob("gold_*.json")):
            try:
                with open(json_file) as f:
                    entries = json.load(f)
                if isinstance(entries, dict):
                    entries = entries.get("proposals", [entries])
                for entry in entries:
                    pid = entry.get("proposal_id") or entry.get("id")
                    if pid:
                        self._gold[pid] = entry
                        self._index_entry(pid, entry)
            except Exception as exc:
                bt.logging.warning(f"BenchmarkManager: failed to load {json_file}: {exc}")

        for json_file in sorted(base.glob("adversarial_*.json")):
            try:
                with open(json_file) as f:
                    entries = json.load(f)
                if isinstance(entries, dict):
                    entries = entries.get("proposals", [entries])
                for entry in entries:
                    pid = entry.get("proposal_id") or entry.get("id")
                    if pid:
                        self._adversarial[pid] = entry
                        self._index_entry(pid, entry)
            except Exception as exc:
                bt.logging.warning(f"BenchmarkManager: failed to load {json_file}: {exc}")

        # Also load legacy single-file formats
        for legacy_name, target in [("gold_labels.json", self._gold), ("adversarial.json", self._adversarial)]:
            legacy_path = base / legacy_name
            if legacy_path.exists():
                try:
                    with open(legacy_path) as f:
                        entries = json.load(f)
                    if isinstance(entries, dict):
                        entries = entries.get("proposals", [entries])
                    for entry in entries:
                        pid = entry.get("proposal_id") or entry.get("id")
                        if pid and pid not in target:
                            target[pid] = entry
                            self._index_entry(pid, entry)
                except Exception:
                    pass

        bt.logging.info(
            f"BenchmarkManager: {len(self._gold)} gold + {len(self._adversarial)} adversarial loaded "
            f"across {len(self._by_category)} categories, {len(self._by_domain)} domains."
        )

    def _index_entry(self, proposal_id: str, entry: dict) -> None:
        """Index proposal by category and domain for filtered access."""
        category = entry.get("category")
        if category:
            self._by_category.setdefault(category, []).append(proposal_id)
        domain = entry.get("domain")
        if domain:
            self._by_domain.setdefault(domain, []).append(proposal_id)

    def get_gold_scores(self, proposal_id: str) -> Optional[dict]:
        entry = self._gold.get(proposal_id)
        return entry.get("reference_scores") if entry else None

    def get_reference_questions(self, proposal_id: str) -> Optional[List[str]]:
        entry = self._gold.get(proposal_id) or self._adversarial.get(proposal_id)
        return entry.get("reference_questions") if entry else None

    def is_adversarial(self, proposal_id: str) -> bool:
        return proposal_id in self._adversarial

    def get_adversarial_meta(self, proposal_id: str) -> Optional[dict]:
        return self._adversarial.get(proposal_id)

    def get_by_category(self, category: str) -> List[dict]:
        """Return all benchmark entries matching the given category."""
        pids = self._by_category.get(category, [])
        results = []
        for pid in pids:
            entry = self._gold.get(pid) or self._adversarial.get(pid)
            if entry:
                results.append(entry)
        return results

    def get_by_domain(self, domain: str) -> List[dict]:
        """Return all benchmark entries matching the given domain."""
        pids = self._by_domain.get(domain, [])
        results = []
        for pid in pids:
            entry = self._gold.get(pid) or self._adversarial.get(pid)
            if entry:
                results.append(entry)
        return results

    def list_categories(self) -> List[str]:
        """Return all known categories across gold and adversarial benchmarks."""
        return sorted(self._by_category.keys())

    def list_domains(self) -> List[str]:
        """Return all known domains across gold and adversarial benchmarks."""
        return sorted(self._by_domain.keys())

    def next_benchmark_proposal(self) -> Optional[dict]:
        """Round-robin fallback when no live proposals are queued."""
        all_entries = list(self._gold.values()) + list(self._adversarial.values())
        if not all_entries:
            return None
        entry = all_entries[self._bench_idx % len(all_entries)]
        self._bench_idx += 1
        return {
            "proposal_id": entry.get("proposal_id") or entry.get("id", ""),
            "proposal_text": entry.get("proposal_text") or entry.get("text", ""),
            "program_mandate": entry.get("program_mandate", ""),
        }


# ────────────────────────────────────────────────────────────────────────────
# DB-backed proposal queue helpers
# ────────────────────────────────────────────────────────────────────────────

def _claim_proposal_from_db() -> Optional[dict]:
    """Try to claim a queued proposal from SQLite. Returns None if empty."""
    try:
        from api.db import claim_next_proposal
        return claim_next_proposal()
    except ImportError:
        return None


def _emit(proposal_id: str, event_type: str, source: str = "validator",
          target: Optional[str] = None, payload: Optional[dict] = None) -> None:
    """Fire-and-forget event emission. Never raises."""
    try:
        from api.db import emit_event
        emit_event(proposal_id, event_type, source=source, target=target, payload=payload)
    except Exception:
        pass



# ────────────────────────────────────────────────────────────────────────────
# Epoch runner
# ────────────────────────────────────────────────────────────────────────────


def run_epoch(validator: "BaseValidatorNeuron") -> None:
    """
    Execute one full validator epoch.

    Steps:
      1. Claim a proposal from the DB queue (or benchmark fallback).
         Every _MUTATION_CHALLENGE_INTERVAL epochs, inject a mutation challenge
         from a gold proposal instead of pulling from the queue.
      2. Sample miner UIDs from metagraph (stake-weighted, capability-aware).
      3. Build task-typed DiligenceSynapses and query miners via dendrite.
      4. Score responses with task-specific compute_rewards().
      5. Apply EMA update to per-UID scores.
      6. Emit structured result payload via validator.result_callback.
    """
    global _epoch_counter
    _epoch_counter += 1

    # ── 1. Proposal source ───────────────────────────────────────────────────
    # On mutation challenge epochs: generate a synthetic adversarial proposal
    # from a random gold benchmark entry to test miner robustness.
    is_mutation_challenge = (
        _epoch_counter % _MUTATION_CHALLENGE_INTERVAL == 0
        and _epoch_counter > 0
    )

    proposal = None

    if is_mutation_challenge:
        gold_proposals = list(validator.benchmark_manager._gold.values())
        if gold_proposals:
            challenges = _mutation_engine.generate_challenge_set(gold_proposals, n=1)
            if challenges:
                proposal = challenges[0]
                bt.logging.info(
                    f"run_epoch: injecting mutation challenge "
                    f"(epoch={_epoch_counter}, attack={proposal.get('attack_type')}, "
                    f"source={proposal.get('mutation_source')})"
                )

    if proposal is None:
        proposal = _claim_proposal_from_db()
    if proposal is None:
        proposal = validator.benchmark_manager.next_benchmark_proposal()
    if proposal is None:
        bt.logging.warning("run_epoch: no proposals available — skipping.")
        return

    proposal_id: str = proposal["proposal_id"]
    proposal_text: str = proposal.get("proposal_text", "")
    program_mandate: str = proposal.get("program_mandate", "")
    bt.logging.info(f"run_epoch: processing proposal={proposal_id}")

    _emit(proposal_id, "proposal_claimed", source="validator", payload={
        "proposal_id": proposal_id,
        "title": proposal.get("title", ""),
    })

    # ── 2. Sample miners from metagraph (stake-weighted, capability-aware) ────
    miner_uids = get_weighted_uids(
        metagraph=validator.metagraph,
        k=validator.config.neuron.sample_size,
        exclude=[validator.my_subnet_uid],
        capability_registry=_capability_registry,
    )
    if len(miner_uids) == 0:
        bt.logging.warning("run_epoch: no active miners found — skipping.")
        return

    uid_list = miner_uids.tolist()
    _emit(proposal_id, "synapse_built", source="validator", payload={
        "miner_uids": uid_list,
        "task_types": [task_for_uid(u, _capability_registry) for u in uid_list],
        "sampling_method": "stake_weighted",
        "capability_registry_size": len(_capability_registry),
    })

    # ── 3. Query miners with task-typed synapses ──────────────────────────────
    # NOTE: bittensor's Dendrite caches a single aiohttp ClientSession bound
    # to the calling thread's event loop. Calling dendrite.query() from
    # multiple threads (ThreadPoolExecutor) causes "Future attached to a
    # different loop" errors. Queries are therefore sequential; latency is
    # bounded by sum(miner response times) rather than max(single latency).
    responses: List[DiligenceSynapse] = []

    for uid in uid_list:
        tt = task_for_uid(uid, _capability_registry)
        synapse = DiligenceSynapse(
            proposal_id=proposal_id,
            proposal_text=proposal_text,
            program_mandate=program_mandate,
            task_type=tt,
        )
        axon = validator.metagraph.axons[uid]

        _emit(proposal_id, "miner_query_sent", source="validator",
              target=f"miner:{uid}", payload={"uid": uid, "task_type": tt})

        t0 = time.time()
        resp_list = validator.dendrite.query(
            axons=[axon],
            synapse=synapse,
            deserialize=False,
            timeout=validator.config.neuron.timeout,
        )
        elapsed = (time.time() - t0) * 1000

        if resp_list:
            resp = resp_list[0]
            if resp.latency_ms is None:
                resp.latency_ms = elapsed
            responses.append(resp)

            _update_capability_registry(uid, resp)

            has_response = bool(
                resp.score_vector or resp.diligence_questions or resp.risk_assessment
            )
            if has_response:
                _emit(proposal_id, "miner_response_received",
                      source=f"miner:{uid}", target="validator", payload={
                          "uid": uid,
                          "task_type": tt,
                          "latency_ms": round(elapsed, 1),
                          "backend": resp.backend or "unknown",
                      })
            else:
                _emit(proposal_id, "miner_timeout",
                      source=f"miner:{uid}", target="validator", payload={
                          "uid": uid,
                          "task_type": tt,
                          "latency_ms": round(elapsed, 1),
                      })
        else:
            empty = DiligenceSynapse(
                proposal_id=proposal_id,
                proposal_text="",
                task_type=tt,
            )
            empty.latency_ms = elapsed
            responses.append(empty)
            _emit(proposal_id, "miner_timeout",
                  source=f"miner:{uid}", target="validator", payload={
                      "uid": uid,
                      "task_type": tt,
                      "latency_ms": round(elapsed, 1),
                  })

    bt.logging.info(
        f"run_epoch: queried {len(uid_list)} miners "
        f"({', '.join(task_for_uid(u) for u in uid_list)})"
    )

    # ── 4. Reward computation ────────────────────────────────────────────────
    gold_scores = validator.benchmark_manager.get_gold_scores(proposal_id)
    is_adversarial = validator.benchmark_manager.is_adversarial(proposal_id)
    adversarial_meta = validator.benchmark_manager.get_adversarial_meta(proposal_id)
    reference_questions = validator.benchmark_manager.get_reference_questions(proposal_id)

    # Mutation challenges carry their adversarial metadata inline
    if is_mutation_challenge and proposal.get("attack_type"):
        is_adversarial = True
        adversarial_meta = adversarial_meta or proposal

    rewards, score_breakdowns = compute_rewards(
        responses=responses,
        uids=uid_list,
        gold_scores=gold_scores,
        is_adversarial=is_adversarial,
        adversarial_meta=adversarial_meta,
        reference_questions=reference_questions,
    )
    bt.logging.info(f"run_epoch: rewards={[round(r, 3) for r in rewards.tolist()]}")

    _emit(proposal_id, "reward_scored", source="validator", payload={
        "scores": [
            {
                "uid": uid,
                "task_type": task_for_uid(uid, _capability_registry),
                "quality": round(bd.get("quality", 0.0), 3),
                "calibration": round(bd.get("calibration", 0.0), 3),
                "robustness": round(bd.get("robustness", 0.0), 3),
                "efficiency": round(bd.get("efficiency", 0.0), 3),
                "composite": round(bd.get("composite", 0.0), 3),
                "reward": round(float(r), 4),
            }
            for uid, bd, r in zip(uid_list, score_breakdowns, rewards.tolist())
        ]
    })

    # ── 5. Score update ──────────────────────────────────────────────────────
    validator.update_scores(rewards, miner_uids)

    _emit(proposal_id, "ema_updated", source="validator", payload={
        "updated_uids": uid_list,
    })

    # ── 6. Result callback (DB layer hook) ───────────────────────────────────
    callback = getattr(validator, "result_callback", None)
    if callback is not None:
        payload = _build_result_payload(
            proposal_id=proposal_id,
            miner_uids=uid_list,
            responses=responses,
            score_breakdowns=score_breakdowns,
            rewards=rewards.tolist(),
            is_adversarial=is_adversarial,
        )
        try:
            callback(payload)
            _emit(proposal_id, "decision_packet_ready", source="validator", payload={
                "proposal_id": proposal_id,
                "is_adversarial": is_adversarial,
                "miner_count": len(uid_list),
            })
        except Exception as exc:
            bt.logging.warning(f"run_epoch: result_callback raised {exc}")


def _build_result_payload(
    proposal_id: str,
    miner_uids: List[int],
    responses: List[DiligenceSynapse],
    score_breakdowns: List[dict],
    rewards: List[float],
    is_adversarial: bool,
) -> dict:
    """Build the result dict for the DB layer."""
    miner_results = []
    for uid, synapse, breakdown, reward in zip(
        miner_uids, responses, score_breakdowns, rewards
    ):
        response_dict = synapse.deserialize() if synapse else None
        miner_results.append(
            {
                "uid": uid,
                "task_type": synapse.task_type if synapse else "rubric",
                "response": response_dict,
                "latency_ms": synapse.latency_ms if synapse else None,
                "estimated_cost": synapse.estimated_cost_usd or 0.0,
                "backend": synapse.backend or "unknown",
                "scores": {
                    "quality": breakdown.get("quality", 0.0),
                    "calibration": breakdown.get("calibration", 0.0),
                    "robustness": breakdown.get("robustness", 0.0),
                    "efficiency": breakdown.get("efficiency", 0.0),
                    "anti_gaming": breakdown.get("anti_gaming", 0.0),
                    "composite": breakdown.get("composite", 0.0),
                },
                "task_metrics": breakdown.get("task_metrics", {}),
                "penalties": breakdown.get("penalties", {}),
                "reward": reward,
            }
        )
    return {
        "proposal_id": proposal_id,
        "is_adversarial": is_adversarial,
        "timestamp": time.time(),
        "miner_results": miner_results,
    }
