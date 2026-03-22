from __future__ import annotations

"""
Abstract base class and provider abstraction for BuildProof miner strategies.

Architecture:
  BaseStrategy defines the evaluate() contract.
  Each concrete strategy uses a *backend* (OpenAI, local transformer, rule-based)
  so that the subnet remains functional even if any single provider disappears.

  Strategy modules under miners/ must:
    1. Import BaseStrategy from this file.
    2. Define a class named `Strategy(BaseStrategy)`.
    3. Implement evaluate() returning a StrategyResult.
"""

import abc
import time
from typing import Optional

from pydantic import BaseModel, Field

from buildproof.protocol import (
    DiligenceQuestions,
    RiskAssessment,
    ScoreVector,
)


# ── Strategy result container ────────────────────────────────────────────────

class StrategyResult(BaseModel):
    """Uniform envelope returned by every strategy.evaluate() call."""
    task_type: str
    score_vector: Optional[ScoreVector] = None
    diligence_questions: Optional[DiligenceQuestions] = None
    risk_assessment: Optional[RiskAssessment] = None
    latency_ms: float = 0.0
    estimated_cost_usd: float = 0.0
    backend: str = "unknown"


# ── Score dimensions (for reference / validation) ────────────────────────────

RUBRIC_DIMENSIONS = [
    "feasibility",
    "impact",
    "novelty",
    "budget_reasonableness",
    "clarity",
    "mandate_alignment",
]


# ── Abstract strategy ───────────────────────────────────────────────────────

class BaseStrategy(abc.ABC):
    """Abstract strategy. Subclass and implement evaluate()."""

    @abc.abstractmethod
    def evaluate(
        self,
        proposal_id: str,
        proposal_text: str,
        program_mandate: str = "",
    ) -> StrategyResult:
        """
        Evaluate a proposal and return a typed StrategyResult.

        The concrete class should populate ONLY the field matching its task_type
        (score_vector for rubric, diligence_questions for diligence,
        risk_assessment for risk).
        """
        ...

    @staticmethod
    def empty_rubric() -> ScoreVector:
        return ScoreVector()

    @staticmethod
    def empty_diligence() -> DiligenceQuestions:
        return DiligenceQuestions()

    @staticmethod
    def empty_risk() -> RiskAssessment:
        return RiskAssessment()
