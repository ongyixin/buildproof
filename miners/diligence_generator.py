from __future__ import annotations

"""
Miner B — Diligence Question Generator.

Outputs top unanswered questions, required evidence, and missing milestones.
Optimised for recall of hidden risk and ambiguity.

Backend: Google Gemini (gemini-2.0-flash).
Falls back to rule-based heuristic extraction.
"""

import json
import os
import re
import time
from typing import List

from miners.base_strategy import BaseStrategy, StrategyResult
from miners._seeded import seeded_diligence
from miners.feature_flags import external_api_calls_enabled
from buildproof.protocol import DiligenceQuestions

# Rule-based question templates keyed by what's missing from proposal text
_QUESTION_TEMPLATES = {
    "budget_detail": "What is the detailed budget breakdown for each line item?",
    "team_info": "Who are the team members and what are their relevant qualifications?",
    "timeline": "What is the detailed timeline with specific milestones and deadlines?",
    "success_metrics": "How will success be measured and over what timeframe?",
    "prior_work": "What prior evidence or prototypes support feasibility?",
    "sustainability": "What is the plan for maintaining the project after the grant period?",
    "risk_mitigation": "What are the key risks and how will they be mitigated?",
    "ip_licensing": "Are there intellectual property, licensing, or compliance dependencies?",
    "user_validation": "What evidence of user demand or market validation exists?",
    "alternatives": "What alternative approaches were considered and why was this one chosen?",
}

_EVIDENCE_SIGNALS = {
    "budget_detail": [r"\$[\d,]+", r"budget", r"cost breakdown"],
    "team_info": [r"team of", r"developer", r"engineer", r"lead ", r"PhD"],
    "timeline": [r"week \d", r"month \d", r"milestone", r"phase \d"],
    "success_metrics": [r"KPI", r"metric", r"measur", r"success criteria"],
    "prior_work": [r"prototype", r"pilot", r"existing", r"already built"],
    "sustainability": [r"sustain", r"maintain", r"after the grant", r"long.term"],
    "risk_mitigation": [r"risk", r"mitiga", r"backup plan", r"fallback"],
    "ip_licensing": [r"license", r"IP", r"patent", r"open.source", r"MIT", r"Apache"],
    "user_validation": [r"user", r"customer", r"MAU", r"download", r"adoption"],
    "alternatives": [r"alternative", r"compared to", r"instead of", r"unlike"],
}


class Strategy(BaseStrategy):
    """Diligence Question Generator — rule-based with optional LLM enrichment."""

    def evaluate(
        self,
        proposal_id: str,
        proposal_text: str,
        program_mandate: str = "",
    ) -> StrategyResult:
        t0 = time.time()

        # Primary path: rule-based extraction (no external API dependency)
        questions, missing_evidence, missing_milestones, coverage = (
            self._rule_based_analysis(proposal_text, program_mandate)
        )

        # Optional LLM enrichment via Anthropic or any non-OpenAI provider
        try:
            llm_extras = self._llm_enrich(proposal_text, program_mandate)
            questions = self._merge_unique(questions, llm_extras.get("questions", []))
            missing_evidence = self._merge_unique(
                missing_evidence, llm_extras.get("missing_evidence", [])
            )
        except Exception:
            pass  # Rule-based output is sufficient

        latency = (time.time() - t0) * 1000
        return StrategyResult(
            task_type="diligence",
            diligence_questions=DiligenceQuestions(
                questions=questions[:8],
                missing_evidence=missing_evidence[:6],
                missing_milestones=missing_milestones[:5],
                coverage_summary=coverage,
            ),
            latency_ms=latency,
            estimated_cost_usd=self._estimate_cost(latency),
            backend=self._backend_name(),
        )

    def _rule_based_analysis(
        self, proposal_text: str, program_mandate: str
    ) -> tuple[List[str], List[str], List[str], str]:
        text_lower = proposal_text.lower()
        questions: List[str] = []
        missing_evidence: List[str] = []
        covered_areas: List[str] = []

        for area, patterns in _EVIDENCE_SIGNALS.items():
            found = any(re.search(p, text_lower) for p in patterns)
            if not found:
                questions.append(_QUESTION_TEMPLATES[area])
                missing_evidence.append(f"No evidence found for: {area.replace('_', ' ')}")
            else:
                covered_areas.append(area.replace("_", " "))

        # Missing milestones detection
        milestone_patterns = re.findall(
            r"(?:^|\n)\s*(?:\d+[\.\)]\s+|[-•]\s*)(.{15,80})",
            proposal_text,
            re.MULTILINE,
        )
        missing_milestones: List[str] = []
        if len(milestone_patterns) < 3:
            missing_milestones.append("Proposal lacks detailed milestone breakdown (< 3 milestones found)")
        if not re.search(r"(?:deliver|ship|launch|release|deploy)", text_lower):
            missing_milestones.append("No concrete delivery milestone identified")
        if not re.search(r"(?:test|pilot|user study|evaluation)", text_lower):
            missing_milestones.append("No testing or validation milestone identified")

        coverage_pct = len(covered_areas) / max(len(_EVIDENCE_SIGNALS), 1)
        coverage = (
            f"Proposal covers {len(covered_areas)}/{len(_EVIDENCE_SIGNALS)} key areas "
            f"({coverage_pct:.0%}). Gaps: {', '.join(missing_evidence[:3]) if missing_evidence else 'none'}."
        )

        return questions, missing_evidence, missing_milestones, coverage

    def _llm_enrich(self, proposal_text: str, program_mandate: str) -> dict:
        """Optional enrichment via Google Gemini."""
        if not external_api_calls_enabled():
            raise RuntimeError("External API calls are disabled")

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("No GEMINI_API_KEY set")

        import google.generativeai as genai

        genai.configure(api_key=api_key)
        mandate_line = f"\nProgram mandate: {program_mandate}" if program_mandate else ""
        prompt = (
            f"Analyse this grant proposal and return ONLY JSON:\n"
            f'{{"questions": ["..."], "missing_evidence": ["..."]}}\n'
            f"Questions = top unanswered due-diligence questions.\n"
            f"Missing_evidence = information the applicant should provide.\n"
            f"{mandate_line}\n\nProposal:\n{proposal_text[:2000]}"
        )

        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                max_output_tokens=500,
            ),
        )
        response = model.generate_content(prompt)
        return json.loads(response.text)

    @staticmethod
    def _merge_unique(existing: List[str], new: List[str]) -> List[str]:
        seen = set(existing)
        merged = list(existing)
        for item in new:
            if item not in seen:
                merged.append(item)
                seen.add(item)
        return merged

    def _backend_name(self) -> str:
        if external_api_calls_enabled() and os.environ.get("GEMINI_API_KEY"):
            return "google/gemini-2.0-flash"
        return "rule-based"

    @staticmethod
    def _estimate_cost(latency_ms: float) -> float:
        return round(latency_ms / 1000.0 * 0.0005, 6)
