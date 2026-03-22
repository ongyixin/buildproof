from __future__ import annotations

"""
Pydantic models for the BuildProof API layer.

Aligned with the new task-typed protocol:
  - ScoreVector, DiligenceQuestions, RiskAssessment from protocol.py
  - Task-specific validator scoring from reward.py
  - DB-backed proposal queue from db.py
"""

import time
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from buildproof.protocol import (
    DiligenceQuestions,
    RiskAssessment,
    ScoreVector,
)


# ── Validator scoring ─────────────────────────────────────────────────────────

class ValidatorScores(BaseModel):
    """Per-miner scoring breakdown computed by the validator reward model."""
    quality: float = 0.0
    calibration: float = 0.0
    robustness: float = 0.0
    efficiency: float = 0.0
    anti_gaming: float = 0.0
    composite: float = 0.0
    task_metrics: Dict[str, float] = Field(default_factory=dict)
    penalties: Dict[str, float] = Field(default_factory=dict)


# ── Per-miner bundle for one proposal ────────────────────────────────────────

class MinerOutput(BaseModel):
    """One miner's contribution to a proposal epoch."""
    uid: int
    hotkey: Optional[str] = None
    task_type: str = "rubric"
    strategy: str = ""
    backend: str = "unknown"
    score_vector: Optional[ScoreVector] = None
    diligence_questions: Optional[DiligenceQuestions] = None
    risk_assessment: Optional[RiskAssessment] = None
    latency_ms: float = 0.0
    estimated_cost_usd: float = 0.0
    score: ValidatorScores = Field(default_factory=ValidatorScores)
    reward: float = 0.0
    reward_share: float = 0.0


# ── Proposal ingestion ────────────────────────────────────────────────────────

class ProposalSubmit(BaseModel):
    """Body of POST /proposals."""
    proposal_id: Optional[str] = None
    title: str = ""
    proposal_text: str
    program_mandate: str = ""
    requested_amount: Optional[int] = None


class Proposal(BaseModel):
    """Full proposal record as stored in the DB."""
    proposal_id: str
    title: str = ""
    proposal_text: str
    program_mandate: str = ""
    requested_amount: Optional[int] = None
    submitted_at: float = Field(default_factory=time.time)
    status: Literal["queued", "processing", "complete", "error"] = "queued"
    picked_up_at: Optional[float] = None
    completed_at: Optional[float] = None


class ProposalAccepted(BaseModel):
    """Response body of POST /proposals."""
    proposal_id: str
    status: str = "queued"
    message: str = "Proposal queued for validator evaluation."


# ── Funding decision (synthesised across miners) ─────────────────────────────

class FundingDecision(BaseModel):
    recommendation: Literal["fund", "fund_with_conditions", "reject"] = "reject"
    recommended_amount: Optional[int] = None
    consensus_confidence: float = 0.0
    rationale: str = ""
    dissenting_views: List[str] = []
    disagreement_score: float = 0.0
    disagreement_reason: Optional[str] = None


# ── Proposal results ──────────────────────────────────────────────────────────

class ProposalResult(BaseModel):
    """All miner outputs + metadata for a single proposal epoch."""
    proposal_id: str
    proposal_text: str = ""
    status: str = "complete"
    is_adversarial: bool = False
    evaluated_at: float
    miner_responses: List[MinerOutput]
    consensus_recommendation: Optional[str] = None
    decision: Optional[FundingDecision] = None


# ── Reward allocation ─────────────────────────────────────────────────────────

class RewardAllocation(BaseModel):
    uid: int
    hotkey: Optional[str] = None
    task_type: str = ""
    composite_score: float = 0.0
    reward_share: float = 0.0
    on_chain_weight: Optional[float] = None


# ── Decision packet ───────────────────────────────────────────────────────────

class DecisionPacket(BaseModel):
    proposal_id: str
    title: Optional[str] = None
    generated_at: float = Field(default_factory=time.time)
    top_miner_uid: Optional[int] = None
    consensus_recommendation: str = "reject"
    consensus_amount: Optional[int] = None
    aggregated_scores: Optional[ScoreVector] = None
    top_diligence_questions: List[str] = []
    risk_summary: Optional[RiskAssessment] = None
    is_adversarial: bool = False
    fraud_flags: List[str] = []
    validator_weights: List[RewardAllocation] = []
    miner_responses: List[MinerOutput] = []


# ── Leaderboard ───────────────────────────────────────────────────────────────

class LeaderboardEntry(BaseModel):
    uid: int
    hotkey: Optional[str] = None
    task_type: str = ""
    strategy: str = ""
    proposals_evaluated: int = 0
    avg_quality: float = 0.0
    avg_calibration: float = 0.0
    avg_robustness: float = 0.0
    avg_efficiency: float = 0.0
    avg_composite: float = 0.0
    composite_score: float = 0.0
    total_reward: float = 0.0
    reward_share: float = 0.0
    on_chain_weight: Optional[float] = None
    weight: Optional[float] = None
    latency_ms: float = 0.0
    estimated_cost_usd: float = 0.0
    rank: int = 0


class Leaderboard(BaseModel):
    updated_at: float = Field(default_factory=time.time)
    entries: List[LeaderboardEntry]


# ── Benchmark run ─────────────────────────────────────────────────────────────

class BenchmarkRunRequest(BaseModel):
    proposal_ids: Optional[List[str]] = None
    include_adversarial: bool = True


class BenchmarkRunResponse(BaseModel):
    enqueued: List[str]
    already_complete: List[str]
    message: str
