from __future__ import annotations

"""
SQLite persistence layer for BuildProof.

Tables:
  proposals           — ingested proposals; status field serves as a durable job queue
  miner_runs          — one row per miner per proposal epoch (run-level metadata)
  task_scores         — granular per-metric scores: (proposal, miner, task_type, metric, value)
  validator_scores    — four-dimension + composite scores, parallel to miner_runs
  rewards             — per-miner reward and share fraction
  leaderboard         — running aggregate per UID (upserted after every epoch)
  weight_snapshots    — chain weight snapshots from set_weights()

Queue semantics:
  Instead of an in-process queue, the validator polls for rows with
  status = 'queued' and claims them transactionally (status → 'processing').
  This makes the validator independent from FastAPI process memory.
"""

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import List, Optional

DB_PATH = Path("buildproof.db")

_lock = threading.Lock()


# ────────────────────────────────────────────────────────────────────────────
# Connection + schema bootstrap
# ────────────────────────────────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create tables if absent. Safe to call repeatedly (idempotent)."""
    with _lock, _connect() as conn:
        conn.executescript(
            """
            PRAGMA journal_mode=WAL;

            CREATE TABLE IF NOT EXISTS proposals (
                proposal_id      TEXT    PRIMARY KEY,
                title            TEXT    NOT NULL DEFAULT '',
                proposal_text    TEXT    NOT NULL DEFAULT '',
                program_mandate  TEXT    NOT NULL DEFAULT '',
                requested_amount INTEGER,
                submitted_at     REAL    NOT NULL,
                status           TEXT    NOT NULL DEFAULT 'queued',
                picked_up_at     REAL,
                completed_at     REAL
            );

            CREATE TABLE IF NOT EXISTS miner_runs (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                proposal_id      TEXT    NOT NULL,
                uid              INTEGER NOT NULL,
                hotkey           TEXT,
                task_type        TEXT    NOT NULL DEFAULT 'rubric',
                response_json    TEXT,
                latency_ms       REAL,
                estimated_cost   REAL    DEFAULT 0.0,
                backend          TEXT    DEFAULT 'unknown',
                evaluated_at     REAL    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_scores (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                proposal_id      TEXT    NOT NULL,
                miner_uid        INTEGER NOT NULL,
                task_type        TEXT    NOT NULL,
                metric_name      TEXT    NOT NULL,
                metric_value     REAL    NOT NULL DEFAULT 0.0,
                scored_at        REAL    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS validator_scores (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                proposal_id      TEXT    NOT NULL,
                uid              INTEGER NOT NULL,
                task_type        TEXT    NOT NULL DEFAULT 'rubric',
                quality          REAL    NOT NULL DEFAULT 0.0,
                calibration      REAL    NOT NULL DEFAULT 0.0,
                robustness       REAL    NOT NULL DEFAULT 0.0,
                efficiency       REAL    NOT NULL DEFAULT 0.0,
                anti_gaming      REAL    NOT NULL DEFAULT 0.0,
                composite        REAL    NOT NULL DEFAULT 0.0,
                is_adversarial   INTEGER NOT NULL DEFAULT 0,
                penalties_json   TEXT,
                scored_at        REAL    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rewards (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                proposal_id      TEXT    NOT NULL,
                uid              INTEGER NOT NULL,
                reward           REAL    NOT NULL DEFAULT 0.0,
                reward_share     REAL    NOT NULL DEFAULT 0.0,
                allocated_at     REAL    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS leaderboard (
                uid                  INTEGER PRIMARY KEY,
                hotkey               TEXT,
                task_type            TEXT    DEFAULT '',
                proposals_evaluated  INTEGER NOT NULL DEFAULT 0,
                avg_quality          REAL    NOT NULL DEFAULT 0.0,
                avg_calibration      REAL    NOT NULL DEFAULT 0.0,
                avg_robustness       REAL    NOT NULL DEFAULT 0.0,
                avg_efficiency       REAL    NOT NULL DEFAULT 0.0,
                avg_composite        REAL    NOT NULL DEFAULT 0.0,
                total_reward         REAL    NOT NULL DEFAULT 0.0,
                on_chain_weight      REAL,
                last_updated         REAL    NOT NULL DEFAULT 0.0
            );

            CREATE TABLE IF NOT EXISTS weight_snapshots (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_at  REAL    NOT NULL,
                weights_json TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS evaluation_events (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                proposal_id   TEXT    NOT NULL,
                timestamp     REAL    NOT NULL,
                event_type    TEXT    NOT NULL,
                source        TEXT    NOT NULL DEFAULT 'validator',
                target        TEXT,
                payload_json  TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_eval_events_proposal
                ON evaluation_events(proposal_id, id);

            CREATE TABLE IF NOT EXISTS hotkey_challenges (
                nonce        TEXT    PRIMARY KEY,
                hotkey       TEXT    NOT NULL,
                created_at   REAL    NOT NULL,
                used         INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS verified_hotkeys (
                hotkey       TEXT    PRIMARY KEY,
                uid          INTEGER,
                verified_at  REAL    NOT NULL,
                nonce        TEXT    NOT NULL
            );
            """
        )
        # Idempotent column migrations
        for migration in [
            "ALTER TABLE validator_scores ADD COLUMN penalties_json TEXT",
            "ALTER TABLE weight_snapshots ADD COLUMN epoch INTEGER DEFAULT 0",
            "ALTER TABLE proposals ADD COLUMN submitter_hotkey TEXT",
            "ALTER TABLE proposals ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(migration)
            except Exception:
                pass  # Column already exists
        conn.commit()


# ────────────────────────────────────────────────────────────────────────────
# Proposal writes (API-side)
# ────────────────────────────────────────────────────────────────────────────

def save_proposal(proposal: dict) -> None:
    """Persist a new proposal with status='queued'. Skips if already exists."""
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO proposals
                (proposal_id, title, proposal_text, program_mandate,
                 requested_amount, submitted_at, status,
                 submitter_hotkey, is_verified)
            VALUES
                (:proposal_id, :title, :proposal_text, :program_mandate,
                 :requested_amount, :submitted_at, :status,
                 :submitter_hotkey, :is_verified)
            ON CONFLICT(proposal_id) DO NOTHING
            """,
            {
                "proposal_id": proposal["proposal_id"],
                "title": proposal.get("title", ""),
                "proposal_text": proposal.get("proposal_text", ""),
                "program_mandate": proposal.get("program_mandate", ""),
                "requested_amount": proposal.get("requested_amount"),
                "submitted_at": proposal.get("submitted_at", time.time()),
                "status": "queued",
                "submitter_hotkey": proposal.get("submitter_hotkey"),
                "is_verified": proposal.get("is_verified", 0),
            },
        )
        conn.commit()


def update_proposal_status(proposal_id: str, status: str) -> None:
    with _lock, _connect() as conn:
        extras = ""
        if status == "processing":
            extras = ", picked_up_at = ?"
        elif status == "complete":
            extras = ", completed_at = ?"

        if extras:
            conn.execute(
                f"UPDATE proposals SET status = ?{extras} WHERE proposal_id = ?",
                (status, time.time(), proposal_id),
            )
        else:
            conn.execute(
                "UPDATE proposals SET status = ? WHERE proposal_id = ?",
                (status, proposal_id),
            )
        conn.commit()


# ────────────────────────────────────────────────────────────────────────────
# DB-backed proposal queue (replaces in-process queue)
# ────────────────────────────────────────────────────────────────────────────

def claim_next_proposal() -> Optional[dict]:
    """
    Atomically claim the next 'queued' proposal for processing.

    Returns the proposal dict with status already set to 'processing',
    or None if no queued proposals exist.
    """
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT * FROM proposals WHERE status = 'queued' ORDER BY submitted_at ASC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        proposal_id = row["proposal_id"]
        conn.execute(
            "UPDATE proposals SET status = 'processing', picked_up_at = ? WHERE proposal_id = ?",
            (time.time(), proposal_id),
        )
        conn.commit()
        return dict(row)


def requeue_stale_proposals(timeout_seconds: float = 300.0) -> int:
    """Re-queue proposals stuck in 'processing' beyond timeout."""
    cutoff = time.time() - timeout_seconds
    with _lock, _connect() as conn:
        cursor = conn.execute(
            "UPDATE proposals SET status = 'queued', picked_up_at = NULL "
            "WHERE status = 'processing' AND picked_up_at < ?",
            (cutoff,),
        )
        conn.commit()
        return cursor.rowcount


# ────────────────────────────────────────────────────────────────────────────
# Epoch result write (validator result_callback target)
# ────────────────────────────────────────────────────────────────────────────

def save_epoch_result(payload: dict) -> None:
    """
    Persist a full epoch result emitted by forward.run_epoch().

    Expected payload shape:
    {
        "proposal_id"    : str,
        "is_adversarial" : bool,
        "timestamp"      : float,
        "miner_results"  : [
            {
                "uid"             : int,
                "task_type"       : str,
                "response"        : dict | None,
                "latency_ms"      : float | None,
                "estimated_cost"  : float,
                "backend"         : str,
                "scores"          : { "quality", "calibration", "robustness",
                                      "efficiency", "anti_gaming", "composite" },
                "task_metrics"    : { metric_name: metric_value, ... },
                "reward"          : float,
            },
            ...
        ]
    }
    """
    proposal_id: str = payload["proposal_id"]
    is_adversarial: int = int(payload.get("is_adversarial", False))
    ts: float = payload.get("timestamp", time.time())
    miner_results: list = payload.get("miner_results", [])

    total_reward = sum(mr["reward"] for mr in miner_results) or 1.0

    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE proposals SET status = 'complete', completed_at = ? WHERE proposal_id = ?",
            (ts, proposal_id),
        )

        for mr in miner_results:
            uid: int = mr["uid"]
            task_type: str = mr.get("task_type", "rubric")
            sc: dict = mr.get("scores", {})
            reward: float = float(mr.get("reward", 0.0))
            reward_share: float = reward / total_reward

            conn.execute(
                """
                INSERT INTO miner_runs
                    (proposal_id, uid, hotkey, task_type, response_json,
                     latency_ms, estimated_cost, backend, evaluated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    proposal_id,
                    uid,
                    mr.get("hotkey"),
                    task_type,
                    json.dumps(mr.get("response")) if mr.get("response") else None,
                    mr.get("latency_ms"),
                    mr.get("estimated_cost", 0.0),
                    mr.get("backend", "unknown"),
                    ts,
                ),
            )

            # Granular task-level metrics
            for metric_name, metric_value in mr.get("task_metrics", {}).items():
                conn.execute(
                    """
                    INSERT INTO task_scores
                        (proposal_id, miner_uid, task_type, metric_name, metric_value, scored_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (proposal_id, uid, task_type, metric_name, float(metric_value), ts),
                )

            conn.execute(
                """
                INSERT INTO validator_scores
                    (proposal_id, uid, task_type, quality, calibration, robustness,
                     efficiency, anti_gaming, composite, is_adversarial, penalties_json, scored_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    proposal_id,
                    uid,
                    task_type,
                    sc.get("quality", 0.0),
                    sc.get("calibration", 0.0),
                    sc.get("robustness", 0.0),
                    sc.get("efficiency", 0.0),
                    sc.get("anti_gaming", 0.0),
                    sc.get("composite", 0.0),
                    is_adversarial,
                    json.dumps(mr.get("penalties", {})),
                    ts,
                ),
            )

            conn.execute(
                """
                INSERT INTO rewards (proposal_id, uid, reward, reward_share, allocated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (proposal_id, uid, reward, reward_share, ts),
            )

            conn.execute(
                """
                INSERT INTO leaderboard
                    (uid, task_type, proposals_evaluated,
                     avg_quality, avg_calibration, avg_robustness,
                     avg_efficiency, avg_composite,
                     total_reward, last_updated)
                VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(uid) DO UPDATE SET
                    avg_quality     = (avg_quality     * proposals_evaluated
                                       + excluded.avg_quality)
                                      / (proposals_evaluated + 1),
                    avg_calibration = (avg_calibration * proposals_evaluated
                                       + excluded.avg_calibration)
                                      / (proposals_evaluated + 1),
                    avg_robustness  = (avg_robustness  * proposals_evaluated
                                       + excluded.avg_robustness)
                                      / (proposals_evaluated + 1),
                    avg_efficiency  = (avg_efficiency  * proposals_evaluated
                                       + excluded.avg_efficiency)
                                      / (proposals_evaluated + 1),
                    avg_composite   = (avg_composite   * proposals_evaluated
                                       + excluded.avg_composite)
                                      / (proposals_evaluated + 1),
                    total_reward    = total_reward + excluded.total_reward,
                    proposals_evaluated = proposals_evaluated + 1,
                    last_updated    = excluded.last_updated
                """,
                (
                    uid,
                    task_type,
                    sc.get("quality", 0.0),
                    sc.get("calibration", 0.0),
                    sc.get("robustness", 0.0),
                    sc.get("efficiency", 0.0),
                    sc.get("composite", 0.0),
                    reward,
                    ts,
                ),
            )

        conn.commit()


def save_weight_snapshot(weights: List[dict]) -> None:
    """Persist a chain weight snapshot and refresh on_chain_weight in leaderboard."""
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO weight_snapshots (snapshot_at, weights_json) VALUES (?, ?)",
            (time.time(), json.dumps(weights)),
        )
        for entry in weights:
            conn.execute(
                "UPDATE leaderboard SET on_chain_weight = ? WHERE uid = ?",
                (entry["weight"], entry["uid"]),
            )
        conn.commit()


# ────────────────────────────────────────────────────────────────────────────
# Read helpers
# ────────────────────────────────────────────────────────────────────────────

def get_proposal(proposal_id: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM proposals WHERE proposal_id = ?", (proposal_id,)
        ).fetchone()
        return dict(row) if row else None


def list_proposals() -> List[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM proposals ORDER BY submitted_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_proposal_results(proposal_id: str) -> Optional[dict]:
    """Assemble full epoch result for a proposal from miner_runs + validator_scores."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                mr.uid,
                mr.hotkey,
                mr.task_type,
                mr.response_json,
                mr.latency_ms,
                mr.estimated_cost,
                mr.backend,
                mr.evaluated_at,
                vs.quality,
                vs.calibration,
                vs.robustness,
                vs.efficiency,
                vs.anti_gaming,
                vs.composite,
                vs.is_adversarial,
                vs.penalties_json,
                r.reward,
                r.reward_share
            FROM miner_runs mr
            LEFT JOIN validator_scores vs
                ON mr.proposal_id = vs.proposal_id AND mr.uid = vs.uid
            LEFT JOIN rewards r
                ON mr.proposal_id = r.proposal_id AND mr.uid = r.uid
            WHERE mr.proposal_id = ?
            ORDER BY vs.composite DESC NULLS LAST
            """,
            (proposal_id,),
        ).fetchall()

    if not rows:
        return None

    miner_outputs = []
    is_adversarial = False
    evaluated_at = 0.0

    for row in rows:
        resp_raw = row["response_json"]
        resp_dict = json.loads(resp_raw) if resp_raw else None
        is_adversarial = bool(row["is_adversarial"])
        evaluated_at = max(evaluated_at, row["evaluated_at"] or 0.0)

        penalties_raw = row["penalties_json"] if "penalties_json" in row.keys() else None
        miner_outputs.append(
            {
                "uid": row["uid"],
                "hotkey": row["hotkey"],
                "task_type": row["task_type"],
                "response": resp_dict,
                "latency_ms": row["latency_ms"],
                "estimated_cost": row["estimated_cost"],
                "backend": row["backend"],
                "validator_scores": {
                    "quality": row["quality"] or 0.0,
                    "calibration": row["calibration"] or 0.0,
                    "robustness": row["robustness"] or 0.0,
                    "efficiency": row["efficiency"] or 0.0,
                    "anti_gaming": row["anti_gaming"] or 0.0,
                    "composite": row["composite"] or 0.0,
                    "penalties": json.loads(penalties_raw) if penalties_raw else {},
                },
                "reward": row["reward"] or 0.0,
                "reward_share": row["reward_share"] or 0.0,
            }
        )

    return {
        "proposal_id": proposal_id,
        "is_adversarial": is_adversarial,
        "evaluated_at": evaluated_at,
        "miner_outputs": miner_outputs,
    }


def get_task_scores(proposal_id: str, miner_uid: Optional[int] = None) -> List[dict]:
    """Return granular task-level metrics for a proposal (optionally filtered by miner)."""
    with _connect() as conn:
        if miner_uid is not None:
            rows = conn.execute(
                "SELECT * FROM task_scores WHERE proposal_id = ? AND miner_uid = ? ORDER BY scored_at",
                (proposal_id, miner_uid),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM task_scores WHERE proposal_id = ? ORDER BY miner_uid, scored_at",
                (proposal_id,),
            ).fetchall()
        return [dict(r) for r in rows]


def get_leaderboard() -> List[dict]:
    """Return all leaderboard rows sorted by avg_composite descending, with rank."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                l.*,
                COALESCE(AVG(mr.latency_ms), 0.0) AS avg_latency_ms
            FROM leaderboard l
            LEFT JOIN miner_runs mr ON l.uid = mr.uid
            GROUP BY l.uid
            ORDER BY l.avg_composite DESC
            """
        ).fetchall()

    entries = [dict(r) for r in rows]
    for rank, entry in enumerate(entries, start=1):
        entry["rank"] = rank
    return entries


def get_latest_weight_snapshot() -> Optional[List[dict]]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT weights_json, snapshot_at FROM weight_snapshots ORDER BY snapshot_at DESC LIMIT 1"
        ).fetchone()
        if not row:
            return None
        return {"weights": json.loads(row["weights_json"]), "snapshot_at": row["snapshot_at"]}


def get_weight_history(limit: int = 10) -> List[dict]:
    """Return the last N weight snapshots with timestamps."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, snapshot_at, weights_json FROM weight_snapshots ORDER BY snapshot_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    result = []
    for i, row in enumerate(reversed(rows)):
        result.append({
            "epoch": i + 1,
            "snapshot_at": row["snapshot_at"],
            "weights": json.loads(row["weights_json"]),
        })
    return result


def get_adversarial_results() -> List[dict]:
    """Return evaluated adversarial proposals with per-miner breakdown."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                mr.proposal_id,
                mr.uid,
                mr.task_type,
                mr.response_json,
                mr.latency_ms,
                mr.backend,
                vs.quality,
                vs.robustness,
                vs.composite,
                vs.penalties_json,
                r.reward_share
            FROM miner_runs mr
            LEFT JOIN validator_scores vs
                ON mr.proposal_id = vs.proposal_id AND mr.uid = vs.uid
            LEFT JOIN rewards r
                ON mr.proposal_id = r.proposal_id AND mr.uid = r.uid
            WHERE vs.is_adversarial = 1
            ORDER BY mr.proposal_id, vs.composite DESC NULLS LAST
            """
        ).fetchall()
    results: dict = {}
    for row in rows:
        pid = row["proposal_id"]
        if pid not in results:
            results[pid] = {"proposal_id": pid, "miners": []}
        resp = json.loads(row["response_json"]) if row["response_json"] else {}
        ra = resp.get("risk_assessment") or {}
        results[pid]["miners"].append({
            "uid": row["uid"],
            "task_type": row["task_type"],
            "backend": row["backend"],
            "fraud_risk": ra.get("fraud_risk", 0.0),
            "manipulation_flags": ra.get("manipulation_flags", []),
            "robustness_score": row["robustness"] or 0.0,
            "composite_score": row["composite"] or 0.0,
            "reward_share": row["reward_share"] or 0.0,
            "latency_ms": row["latency_ms"] or 0.0,
        })
    return list(results.values())


def get_calibration_stats() -> List[dict]:
    """Return per-miner calibration stats aggregated from task_scores."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                l.uid,
                l.task_type,
                l.proposals_evaluated,
                l.avg_calibration,
                l.avg_quality,
                l.avg_composite,
                COALESCE(
                    (SELECT AVG(ts.metric_value)
                     FROM task_scores ts
                     WHERE ts.miner_uid = l.uid
                       AND ts.metric_name IN ('rank_corr', 'flag_recall')
                    ), l.avg_calibration
                ) AS task_calibration
            FROM leaderboard l
            ORDER BY l.avg_calibration DESC
            """
        ).fetchall()
    result = []
    for row in rows:
        cal = row["avg_calibration"] or 0.0
        result.append({
            "uid": row["uid"],
            "task_type": row["task_type"],
            "proposals_evaluated": row["proposals_evaluated"],
            "calibration_score": round(cal, 4),
            "overconfidence_rate": round(max(0.0, 0.5 - cal) * 2, 4),
            "avg_quality": round(row["avg_quality"] or 0.0, 4),
            "avg_composite": round(row["avg_composite"] or 0.0, 4),
            "task_calibration": round(row["task_calibration"] or cal, 4),
        })
    return result


# ────────────────────────────────────────────────────────────────────────────
# Evaluation event stream
# ────────────────────────────────────────────────────────────────────────────

def emit_event(
    proposal_id: str,
    event_type: str,
    source: str = "validator",
    target: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    """Insert a structured evaluation event. Non-fatal — never raises."""
    try:
        with _lock, _connect() as conn:
            conn.execute(
                """
                INSERT INTO evaluation_events
                    (proposal_id, timestamp, event_type, source, target, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    proposal_id,
                    time.time(),
                    event_type,
                    source,
                    target,
                    json.dumps(payload) if payload else None,
                ),
            )
            conn.commit()
    except Exception:
        pass


def get_events(proposal_id: str, after_id: int = 0) -> List[dict]:
    """Return evaluation events for a proposal with id > after_id."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, proposal_id, timestamp, event_type, source, target, payload_json
            FROM evaluation_events
            WHERE proposal_id = ? AND id > ?
            ORDER BY id ASC
            """,
            (proposal_id, after_id),
        ).fetchall()
    results = []
    for row in rows:
        results.append({
            "id": row["id"],
            "proposal_id": row["proposal_id"],
            "timestamp": row["timestamp"],
            "event_type": row["event_type"],
            "source": row["source"],
            "target": row["target"],
            "payload": json.loads(row["payload_json"]) if row["payload_json"] else {},
        })
    return results


# ────────────────────────────────────────────────────────────────────────────
# Hotkey verification
# ────────────────────────────────────────────────────────────────────────────

def store_challenge(nonce: str, hotkey: str) -> None:
    """Persist a challenge nonce for a hotkey. Expires after 5 minutes."""
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO hotkey_challenges (nonce, hotkey, created_at) VALUES (?, ?, ?)",
            (nonce, hotkey, time.time()),
        )
        conn.commit()


def consume_challenge(nonce: str, hotkey: str) -> bool:
    """
    Atomically claim a challenge nonce for use in signature verification.

    Returns True if the nonce was valid, unused, not expired (< 5 min old),
    and matched the provided hotkey. Marks the nonce as used.
    """
    cutoff = time.time() - 300  # 5 minute expiry
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT * FROM hotkey_challenges WHERE nonce = ? AND hotkey = ? AND used = 0 AND created_at > ?",
            (nonce, hotkey, cutoff),
        ).fetchone()
        if row is None:
            return False
        conn.execute(
            "UPDATE hotkey_challenges SET used = 1 WHERE nonce = ?",
            (nonce,),
        )
        conn.commit()
    return True


def record_verified_hotkey(hotkey: str, uid: Optional[int], nonce: str) -> None:
    """Persist a successfully verified hotkey."""
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO verified_hotkeys (hotkey, uid, verified_at, nonce)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(hotkey) DO UPDATE SET
                uid = excluded.uid,
                verified_at = excluded.verified_at,
                nonce = excluded.nonce
            """,
            (hotkey, uid, time.time(), nonce),
        )
        conn.commit()


def is_hotkey_verified(hotkey: str) -> bool:
    """Return True if the hotkey has a valid verification record."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT hotkey FROM verified_hotkeys WHERE hotkey = ?",
            (hotkey,),
        ).fetchone()
    return row is not None


def get_verified_hotkey(hotkey: str) -> Optional[dict]:
    """Return the verification record for a hotkey, or None."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM verified_hotkeys WHERE hotkey = ?",
            (hotkey,),
        ).fetchone()
    return dict(row) if row else None


def expire_old_challenges(max_age_seconds: float = 600.0) -> int:
    """Delete used or expired challenge nonces older than max_age_seconds."""
    cutoff = time.time() - max_age_seconds
    with _lock, _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM hotkey_challenges WHERE created_at < ? OR used = 1",
            (cutoff,),
        )
        conn.commit()
        return cursor.rowcount
