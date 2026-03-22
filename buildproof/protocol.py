from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

try:
    import bittensor as bt
    _SynapseBase = bt.Synapse
except ImportError:
    _SynapseBase = BaseModel  # type: ignore[assignment,misc]


# ── Typed response payloads ──────────────────────────────────────────────────
# Each miner fills ONLY the payload matching the task_type it was assigned.


class ScoreVector(BaseModel):
    """Rubric Scorer output: normalised dimension scores."""
    feasibility: float = Field(default=0.0, ge=0.0, le=1.0)
    impact: float = Field(default=0.0, ge=0.0, le=1.0)
    novelty: float = Field(default=0.0, ge=0.0, le=1.0)
    budget_reasonableness: float = Field(default=0.0, ge=0.0, le=1.0)
    clarity: float = Field(default=0.0, ge=0.0, le=1.0)
    mandate_alignment: float = Field(default=0.0, ge=0.0, le=1.0)
    confidence_by_dimension: dict[str, float] = Field(
        default_factory=dict,
        description="Per-dimension confidence, keyed by dimension name.",
    )


class DiligenceQuestions(BaseModel):
    """Diligence Question Generator output."""
    questions: List[str] = Field(default_factory=list)
    missing_evidence: List[str] = Field(default_factory=list)
    missing_milestones: List[str] = Field(default_factory=list)
    coverage_summary: str = ""


class RiskAssessment(BaseModel):
    """Risk / Fraud Detector output."""
    fraud_risk: float = Field(default=0.0, ge=0.0, le=1.0)
    mandate_mismatch: float = Field(default=0.0, ge=0.0, le=1.0)
    manipulation_flags: List[str] = Field(default_factory=list)
    confidence_per_flag: dict[str, float] = Field(
        default_factory=dict,
        description="Confidence for each manipulation flag (0-1).",
    )
    reasoning: str = ""


# ── Valid task types ─────────────────────────────────────────────────────────

TASK_TYPES = ("rubric", "diligence", "risk")


class DiligenceSynapse(_SynapseBase):
    """
    Protocol message carried over the Bittensor transport layer.

    Validator → Miner (request fields):
        proposal_id      unique identifier for this proposal
        proposal_text    full body of the funding application
        program_mandate  optional mandate/criteria text from the funding program
        task_type        which task the miner should perform

    Miner → Validator (response fields):
        score_vector         filled by rubric miners
        diligence_questions  filled by diligence miners
        risk_assessment      filled by risk miners
        latency_ms           wall-clock inference time measured by the miner
        estimated_cost_usd   self-reported inference cost
        backend              which provider/model the miner used
        supported_tasks      miner self-declares its task capabilities;
                             validator uses this for dynamic task routing
    """

    # ── request ──────────────────────────────────────────────────────────────
    proposal_id: str
    proposal_text: str
    program_mandate: str = ""
    task_type: str = "rubric"  # "rubric" | "diligence" | "risk"

    # ── response (miner fills whichever matches its task_type) ───────────────
    score_vector: Optional[ScoreVector] = None
    diligence_questions: Optional[DiligenceQuestions] = None
    risk_assessment: Optional[RiskAssessment] = None

    latency_ms: Optional[float] = None
    estimated_cost_usd: Optional[float] = None
    backend: Optional[str] = None

    # ── capability declaration (miner → validator, optional) ─────────────────
    # Miners may populate this field to self-declare which task types they
    # support. The validator uses this for dynamic task routing; miners that
    # do not set this field fall back to uid % len(TASK_TYPES) assignment.
    supported_tasks: Optional[List[str]] = None

    def deserialize(self) -> dict:
        """Return a dict with whichever payload the miner populated."""
        result: dict = {"task_type": self.task_type}
        if self.score_vector is not None:
            result["score_vector"] = self.score_vector.model_dump()
        if self.diligence_questions is not None:
            result["diligence_questions"] = self.diligence_questions.model_dump()
        if self.risk_assessment is not None:
            result["risk_assessment"] = self.risk_assessment.model_dump()
        result["latency_ms"] = self.latency_ms
        result["estimated_cost_usd"] = self.estimated_cost_usd
        result["backend"] = self.backend
        return result
