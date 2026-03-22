from __future__ import annotations

"""
Miner A — Rubric Scorer.

Outputs normalised dimension scores only. Optimised for agreement with gold
labels. No long prose required.

Backend: Google Gemini (gemini-2.0-flash).  Falls back to seeded deterministic scorer.
"""

import json
import os
import time

from miners.base_strategy import BaseStrategy, StrategyResult
from miners._seeded import seeded_rubric
from miners.feature_flags import external_api_calls_enabled
from buildproof.protocol import ScoreVector

_SYSTEM_PROMPT = """You are a quantitative grant scoring engine.
Given a funding proposal and (optionally) the program mandate, produce
ONLY a JSON object with normalised 0-1 scores and per-dimension confidence:

{
  "feasibility": <0.0-1.0>,
  "impact": <0.0-1.0>,
  "novelty": <0.0-1.0>,
  "budget_reasonableness": <0.0-1.0>,
  "clarity": <0.0-1.0>,
  "mandate_alignment": <0.0-1.0>,
  "confidence_by_dimension": {
    "feasibility": <0.0-1.0>,
    "impact": <0.0-1.0>,
    "novelty": <0.0-1.0>,
    "budget_reasonableness": <0.0-1.0>,
    "clarity": <0.0-1.0>,
    "mandate_alignment": <0.0-1.0>
  }
}

Rules:
- Each score must be between 0.0 and 1.0.
- Confidence reflects how certain you are about that dimension.
  A high score with low confidence is fine; it means "probably good but I'm unsure."
- Do NOT produce any other text, only JSON."""


class Strategy(BaseStrategy):
    """Rubric Scorer — Gemini backend."""

    def evaluate(
        self,
        proposal_id: str,
        proposal_text: str,
        program_mandate: str = "",
    ) -> StrategyResult:
        if not external_api_calls_enabled():
            return seeded_rubric(proposal_id, proposal_text, program_mandate)

        t0 = time.time()
        try:
            result = self._llm_evaluate(proposal_text, program_mandate)
            latency = (time.time() - t0) * 1000
            return StrategyResult(
                task_type="rubric",
                score_vector=ScoreVector(**result),
                latency_ms=latency,
                estimated_cost_usd=self._estimate_cost(latency),
                backend="google/gemini-2.0-flash",
            )
        except Exception:
            return seeded_rubric(proposal_id, proposal_text, program_mandate)

    def _llm_evaluate(self, proposal_text: str, program_mandate: str) -> dict:
        import google.generativeai as genai

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("No GEMINI_API_KEY set")

        genai.configure(api_key=api_key)
        mandate_section = f"\nProgram mandate: {program_mandate}" if program_mandate else ""
        prompt = f"{_SYSTEM_PROMPT}\n\n{mandate_section}\n\nProposal:\n{proposal_text}"

        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.15,
                max_output_tokens=400,
            ),
        )
        response = model.generate_content(prompt)
        return json.loads(response.text)

    @staticmethod
    def _estimate_cost(latency_ms: float) -> float:
        return round(latency_ms / 1000.0 * 0.002, 6)
