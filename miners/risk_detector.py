from __future__ import annotations

"""
Miner C — Risk / Fraud Detector.

Outputs fraud flags, manipulation indicators, mandate mismatch, and
per-flag confidence. Optimised for adversarial performance.

Backend: primarily rule-based classifier with optional LLM secondary pass.
This miner is deliberately architecture-first, not LLM-first, to demonstrate
that the subnet can produce value even without any LLM provider.
"""

import os
import json
import re
import time
from typing import List, Tuple

from miners.base_strategy import BaseStrategy, StrategyResult
from miners._seeded import seeded_risk
from miners.feature_flags import external_api_calls_enabled
from buildproof.protocol import RiskAssessment


# ── Rule-based detection patterns ────────────────────────────────────────────

_DETECTORS: List[Tuple[str, str, re.Pattern, float]] = [
    (
        "prompt_injection",
        "Prompt injection attempt detected in proposal text",
        re.compile(
            r"(SYSTEM\s+OVERRIDE|IGNORE\s+(ALL\s+)?PREVIOUS|"
            r"scoring\s+instructions\s+are\s+suspended|"
            r"set\s+recommendation\s+to|"
            r"output\s+maximum\s+scores)",
            re.IGNORECASE,
        ),
        0.95,
    ),
    (
        "fake_traction",
        "Implausible traction claims inconsistent with grant stage",
        re.compile(
            r"(50\s*,?\s*000\s+monthly|50k\s+MAU|"
            r"\$[1-9]\s*[Mm]\s+ARR|"
            r"partnership.{0,20}(MIT|Stanford|NASA|Google|Microsoft)|"
            r"top.tier\s+VC)",
            re.IGNORECASE,
        ),
        0.85,
    ),
    (
        "emotional_manipulation",
        "Emotional manipulation substitutes for technical substance",
        re.compile(
            r"(last\s+hope|millions\s+of\s+lives|single\s+parent|"
            r"mother\s+died|without\s+this\s+funding.*lost|"
            r"children\s+will|desperate)",
            re.IGNORECASE,
        ),
        0.80,
    ),
    (
        "jargon_overload",
        "Excessive buzzwords with no concrete deliverables",
        re.compile(
            r"(synergistic|paradigm.shift|quantum.resistant|"
            r"exponential\s+network|composable\s+\w+\s+stack|"
            r"epistemic\s+hegemony|meta.protocol)",
            re.IGNORECASE,
        ),
        0.75,
    ),
    (
        "milestone_padding",
        "Scope appears artificially inflated relative to deliverables",
        re.compile(
            r"Month\s+\d+:\s+.*(?:Research|Draft|Set\s+up|Write\s+documentation)",
            re.IGNORECASE,
        ),
        0.70,
    ),
    (
        "budget_inflation",
        "Budget appears disproportionate to scope described",
        re.compile(
            r"\$\s*(?:[4-9]\d|[1-9]\d{2})\s*,?\s*000",
            re.IGNORECASE,
        ),
        0.60,
    ),
]


def _count_buzzwords(text: str) -> int:
    buzzwords = re.findall(
        r"\b(synergistic|paradigm|disrupt|revolutionize|exponential|"
        r"quantum|blockchain|tokenomics|DeSci|Web3|AI-augmented|"
        r"zero-knowledge|composable|meta-protocol|decentralized autonomous)\b",
        text,
        re.IGNORECASE,
    )
    return len(buzzwords)


class Strategy(BaseStrategy):
    """Risk / Fraud Detector — rule-based classifier + optional LLM secondary pass."""

    def evaluate(
        self,
        proposal_id: str,
        proposal_text: str,
        program_mandate: str = "",
    ) -> StrategyResult:
        t0 = time.time()

        try:
            flags, confidences, reasoning_parts = self._detect(proposal_text, program_mandate)
            fraud_risk, mandate_mismatch = self._compute_risk_scores(
                flags, confidences, proposal_text, program_mandate
            )

            # Optional LLM secondary pass for nuanced cases
            try:
                llm_assessment = self._llm_secondary_pass(proposal_text, program_mandate)
                flags, confidences = self._merge_llm_flags(flags, confidences, llm_assessment)
                fraud_risk = max(fraud_risk, llm_assessment.get("fraud_risk", 0.0))
            except Exception:
                pass

            latency = (time.time() - t0) * 1000
            return StrategyResult(
                task_type="risk",
                risk_assessment=RiskAssessment(
                    fraud_risk=min(1.0, fraud_risk),
                    mandate_mismatch=min(1.0, mandate_mismatch),
                    manipulation_flags=flags,
                    confidence_per_flag={f: c for f, c in zip(flags, confidences)},
                    reasoning="; ".join(reasoning_parts) if reasoning_parts else "No issues detected.",
                ),
                latency_ms=latency,
                estimated_cost_usd=self._estimate_cost(latency),
                backend=self._backend_name(),
            )
        except Exception:
            return seeded_risk(proposal_id, proposal_text, program_mandate)

    def _detect(
        self, text: str, mandate: str
    ) -> Tuple[List[str], List[float], List[str]]:
        flags: List[str] = []
        confidences: List[float] = []
        reasoning: List[str] = []

        for flag_name, description, pattern, base_confidence in _DETECTORS:
            matches = pattern.findall(text)
            if matches:
                flags.append(flag_name)
                hit_count = len(matches) if isinstance(matches[0], str) else len(matches)
                confidence = min(1.0, base_confidence + 0.05 * (hit_count - 1))
                confidences.append(round(confidence, 3))
                reasoning.append(f"{description} ({hit_count} signal{'s' if hit_count > 1 else ''})")

        buzzword_count = _count_buzzwords(text)
        word_count = len(text.split())
        buzzword_density = buzzword_count / max(word_count, 1)
        if buzzword_density > 0.03:
            flags.append("high_buzzword_density")
            confidences.append(round(min(1.0, buzzword_density * 10), 3))
            reasoning.append(
                f"Buzzword density {buzzword_density:.1%} ({buzzword_count}/{word_count} words)"
            )

        # Check for missing substance markers
        substance_markers = ["deliver", "build", "implement", "develop", "create", "test", "deploy"]
        substance_count = sum(1 for m in substance_markers if m in text.lower())
        if substance_count < 2 and word_count > 50:
            flags.append("low_substance")
            confidences.append(0.65)
            reasoning.append("Few concrete action verbs; proposal may lack technical substance")

        return flags, confidences, reasoning

    def _compute_risk_scores(
        self,
        flags: List[str],
        confidences: List[float],
        text: str,
        mandate: str,
    ) -> Tuple[float, float]:
        if not flags:
            return 0.05, self._mandate_mismatch_score(text, mandate)

        weighted_risk = sum(confidences) / max(len(confidences), 1)
        high_severity = {"prompt_injection", "fake_traction", "emotional_manipulation"}
        has_high = any(f in high_severity for f in flags)
        fraud_risk = min(1.0, weighted_risk + (0.2 if has_high else 0.0))

        mandate_mismatch = self._mandate_mismatch_score(text, mandate)
        return fraud_risk, mandate_mismatch

    @staticmethod
    def _mandate_mismatch_score(text: str, mandate: str) -> float:
        if not mandate:
            return 0.1
        mandate_words = set(mandate.lower().split())
        text_words = set(text.lower().split())
        overlap = mandate_words & text_words
        coverage = len(overlap) / max(len(mandate_words), 1)
        return round(max(0.0, 1.0 - coverage * 2), 3)

    def _llm_secondary_pass(self, text: str, mandate: str) -> dict:
        """Optional LLM pass using Google Gemini."""
        if not external_api_calls_enabled():
            raise RuntimeError("External API calls are disabled")

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("No GEMINI_API_KEY set")

        import google.generativeai as genai

        genai.configure(api_key=api_key)
        prompt = (
            "You are a fraud analyst reviewing grant proposals. "
            "Return ONLY JSON: "
            '{"fraud_risk": 0.0-1.0, "flags": ["flag_name"], '
            '"reasoning": "brief explanation"}\n\n'
            f"Proposal:\n{text[:1500]}"
        )

        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.0,
                max_output_tokens=200,
            ),
        )
        response = model.generate_content(prompt)
        return json.loads(response.text)

    @staticmethod
    def _merge_llm_flags(
        flags: List[str], confidences: List[float], llm: dict
    ) -> Tuple[List[str], List[float]]:
        existing = set(flags)
        for flag in llm.get("flags", []):
            if flag not in existing:
                flags.append(flag)
                confidences.append(0.6)
                existing.add(flag)
        return flags, confidences

    def _backend_name(self) -> str:
        backend = "rule-based"
        if external_api_calls_enabled() and os.environ.get("GEMINI_API_KEY"):
            backend += "+google/gemini-2.0-flash"
        return backend

    @staticmethod
    def _estimate_cost(latency_ms: float) -> float:
        return round(latency_ms / 1000.0 * 0.001, 6)
