from __future__ import annotations

"""
Deterministic seeded evaluation helpers for new task-type structure.

Used as reliable fallbacks when LLM calls are unavailable (no API key,
network error, etc.), ensuring the demo always produces plausible data.

Scoring is stable: same proposal_id → same scores across restarts.
"""

import hashlib
import re
from typing import List

from miners.base_strategy import StrategyResult, RUBRIC_DIMENSIONS
from buildproof.protocol import DiligenceQuestions, RiskAssessment, ScoreVector


# ── Text heuristics ──────────────────────────────────────────────────────────

_INJECTION_PATTERNS = re.compile(
    r"(SYSTEM\s+OVERRIDE|IGNORE\s+PREVIOUS|ignore\s+all\s+previous"
    r"|scoring\s+instructions\s+are\s+suspended|set\s+recommendation\s+to)",
    re.IGNORECASE,
)

_HYPE_PATTERNS = re.compile(
    r"(revolutionize|paradigm.shift|synergistic|quantum.resistant"
    r"|exponential\s+network|50\s*,?\s*000\s+monthly|50k\s+MAU"
    r"|\$\s*[12]\s*[Mm])\b",
    re.IGNORECASE,
)

_MANIPULATION_PATTERNS = re.compile(
    r"(last\s+hope|millions\s+of\s+lives|single\s+parent|mother\s+died"
    r"|without\s+this\s+funding.*lost)",
    re.IGNORECASE,
)


def _text_heuristics(proposal_text: str) -> dict:
    words = proposal_text.split()
    word_count = len(words)

    injection = bool(_INJECTION_PATTERNS.search(proposal_text))
    hype = len(_HYPE_PATTERNS.findall(proposal_text))
    manipulation = bool(_MANIPULATION_PATTERNS.search(proposal_text))

    clarity_boost = min(0.2, word_count / 500) - max(0.0, (hype * 0.05))
    fraud_risk_base = (
        0.85 if injection else
        0.65 if manipulation else
        min(0.5, hype * 0.1)
    )
    # Match $100,000+ with comma-separated digits (e.g. $485,000 not $18,000)
    # Note: use [$] not \$ — Python re treats \$ inconsistently across versions
    has_large_budget = bool(re.search(r"[$][1-9][0-9]{2,}(?:,[0-9]{3})+", proposal_text))
    has_team_detail = any(
        kw in proposal_text.lower()
        for kw in ["engineer", "developer", "team of", "lead "]
    )
    budget_penalty = 0.3 if has_large_budget and not has_team_detail else 0.0

    return {
        "clarity_boost": clarity_boost,
        "fraud_risk_base": fraud_risk_base,
        "budget_penalty": budget_penalty,
        "word_count": word_count,
        "injection_detected": injection,
        "manipulation_detected": manipulation,
        "hype_count": hype,
        "has_team_detail": has_team_detail,
    }


def _hash_float(seed_str: str, lo: float = 0.0, hi: float = 1.0) -> float:
    digest = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
    return lo + (digest / 0xFFFFFFFF) * (hi - lo)


def _dim_signals(proposal_text: str, h: dict, program_mandate: str = "") -> dict:
    """
    Per-dimension quality signals derived from proposal text.

    Returns a dict of adjustments (positive or negative floats) keyed by
    RUBRIC_DIMENSIONS.  These are added to a neutral base of 0.52 so that
    a well-structured proposal scores ~0.8+ while a weak one scores ~0.4.
    A small hash-based jitter (±0.06) is applied on top in seeded_rubric.
    """
    text_lower = proposal_text.lower()

    has_team = h["has_team_detail"]
    has_prior = any(kw in text_lower for kw in [
        "prototype", "deployed", "prior work", "previous work",
        "existing sdk", "we built", "have built",
    ])
    has_timeline = bool(re.search(r"month\s*\d|week\s*\d", text_lower))
    n_milestones = len(re.findall(
        r"(?:^|\n)\s*(?:\d+[\.\)]\s+|[-•]\s*)(.{10,})",
        proposal_text,
        re.MULTILINE,
    ))
    has_milestones = n_milestones >= 3
    has_itemized_budget = bool(re.search(
        r"[$][\d,]+\s*[—\-]\s*\w"
        r"|[$][\d,]+\s+(?:development|infrastructure|audit|labor|hardware|engineering|research)",
        proposal_text,
        re.IGNORECASE,
    ))
    # Budget dominated by overhead (exec comp, office, marketing) rather than technical work
    has_overhead_budget = bool(re.search(
        r"[$][\d,]+\s*[—\-]\s*(?:executive|compensation|salary|office\s+space|marketing|branding|legal\s+and|travel)",
        proposal_text,
        re.IGNORECASE,
    ))
    # Specific technical tools/protocols rather than generic buzzwords
    has_specific_tech = any(kw in text_lower for kw in [
        "sdk", "eip", "hardhat", "ethereum", "solidity", "rust", "python",
        "attestation", "openwrt", "batman", "zero-knowledge", "zk-", "typescript",
    ])
    has_open_source = any(kw in text_lower for kw in [
        "open-source", "open source", "mit licence", "mit license",
        "apache license", "github.com",
    ])
    # Vague team: executive titles without any technical role keywords
    vague_team = (
        bool(re.search(r"\b(CEO|CTO|co.founder)\b", proposal_text, re.IGNORECASE))
        and not has_team
    )

    # Mandate alignment weighted by structural credibility of the proposal
    mandate_overlap = 0.0
    if program_mandate:
        m_words = set(re.findall(r"\b[a-z]{4,}\b", program_mandate.lower()))
        t_words = set(re.findall(r"\b[a-z]{4,}\b", text_lower))
        if m_words:
            mandate_overlap = len(m_words & t_words) / len(m_words)
    struct_quality = (
        0.30
        + (0.20 if has_team else 0.0)
        + (0.15 if has_specific_tech else 0.0)
        + (0.10 if has_prior else 0.0)
        + (0.10 if has_milestones else 0.0)
    )
    mandate_signal = min(0.30, mandate_overlap * 0.5) * min(1.0, struct_quality)

    inj = h["injection_detected"]
    manip = h["manipulation_detected"]
    hype = h["hype_count"]
    bp = h["budget_penalty"]

    return {
        "feasibility": sum([
            0.22 if has_team else -0.15,
            0.12 if has_prior else 0.0,
            0.10 if has_timeline else -0.06,
            0.08 if has_milestones else 0.0,
            -0.12 if vague_team else 0.0,
            0.06 if has_specific_tech else 0.0,
            -0.20 if inj else 0.0,
            -0.10 if manip else 0.0,
        ]),
        "impact": sum([
            0.10 if has_milestones else -0.06,
            0.08 if has_open_source else 0.0,
            0.06 if has_specific_tech else 0.0,
            0.04 if has_itemized_budget else 0.0,
            -0.08 if manip else 0.0,
            -0.15 if inj else 0.0,
            -0.05 * min(3, hype),
        ]),
        "clarity": sum([
            h["clarity_boost"] * 1.2,
            (0.12 if has_specific_tech else 0.06) if has_milestones else -0.12,
            0.08 if has_itemized_budget else -0.04,
            0.06 if has_specific_tech else 0.0,
            -0.08 if (vague_team and not has_specific_tech) else 0.0,
            -0.12 if has_overhead_budget else 0.0,
            -0.06 * min(3, hype),
        ]),
        "mandate_alignment": sum([
            mandate_signal,
            0.10 if has_specific_tech else 0.0,
            0.05 if has_open_source else 0.0,
            -0.05 if manip else 0.0,
            -0.10 if inj else 0.0,
        ]),
        "budget_reasonableness": sum([
            -bp,
            0.12 if has_itemized_budget else -0.06,
            0.05 if (has_team and not bp) else 0.0,
            -0.04 * min(3, hype),
        ]),
        "novelty": sum([
            0.12 if (has_open_source and has_specific_tech) else 0.0,
            0.08 if has_specific_tech else 0.0,
            0.05 if has_prior else 0.0,
            -0.06 * min(3, hype),
        ]),
    }


# ── Rubric Scorer fallback ───────────────────────────────────────────────────

def seeded_rubric(
    proposal_id: str,
    proposal_text: str,
    program_mandate: str = "",
) -> StrategyResult:
    """
    Quality-driven rubric scores.

    Scores are anchored to per-dimension text signals (team, timeline,
    technical specifics, milestones, budget structure) so that a well-formed
    proposal consistently scores ≥0.70 and a structurally weak one scores
    ≈0.40–0.55.  A small proposal-id hash jitter (±0.06) adds variety while
    keeping the outcome stable enough for the demo.
    """
    h = _text_heuristics(proposal_text)
    signals = _dim_signals(proposal_text, h, program_mandate)

    scores = {}
    confidences = {}
    for dim in RUBRIC_DIMENSIONS:
        jitter = _hash_float(f"{proposal_id}:{dim}", -0.06, 0.06)
        raw = 0.52 + signals[dim] + jitter
        scores[dim] = round(max(0.05, min(0.97, raw)), 3)
        confidences[dim] = round(_hash_float(f"{proposal_id}:{dim}:conf", 0.4, 0.95), 3)

    return StrategyResult(
        task_type="rubric",
        score_vector=ScoreVector(
            **scores,
            confidence_by_dimension=confidences,
        ),
        latency_ms=_hash_float(f"{proposal_id}:lat_rubric", 50, 300),
        estimated_cost_usd=0.0,
        backend="seeded-deterministic",
    )


# ── Diligence Generator fallback ────────────────────────────────────────────

def seeded_diligence(
    proposal_id: str,
    proposal_text: str,
    program_mandate: str = "",
) -> StrategyResult:
    """Deterministic diligence questions based on text gap analysis."""
    text_lower = proposal_text.lower()

    questions: List[str] = []
    missing_evidence: List[str] = []

    checks = [
        ("budget", ["budget", "cost", "$"], "What is the detailed budget breakdown?"),
        ("team", ["team", "engineer", "developer"], "Who are the team members and qualifications?"),
        ("timeline", ["week", "month", "milestone"], "What is the detailed timeline with milestones?"),
        ("metrics", ["metric", "KPI", "measur"], "How will success be measured?"),
        ("prior_work", ["prototype", "existing", "pilot", "deployed", "prior work", "previous work", "we built", "have built"], "What prior work or prototypes exist?"),
    ]

    for area, keywords, question in checks:
        if not any(kw in text_lower for kw in keywords):
            questions.append(question)
            missing_evidence.append(f"No evidence for: {area}")

    milestone_matches = re.findall(
        r"(?:^|\n)\s*(?:\d+[\.\)]\s+|[-•]\s*)(.{15,80})",
        proposal_text,
        re.MULTILINE,
    )
    missing_milestones: List[str] = []
    if len(milestone_matches) < 3:
        missing_milestones.append("Fewer than 3 explicit milestones found")

    coverage_pct = 1.0 - len(questions) / max(len(checks), 1)
    coverage = f"Coverage: {coverage_pct:.0%}. {len(questions)} gaps identified."

    return StrategyResult(
        task_type="diligence",
        diligence_questions=DiligenceQuestions(
            questions=questions,
            missing_evidence=missing_evidence,
            missing_milestones=missing_milestones,
            coverage_summary=coverage,
        ),
        latency_ms=_hash_float(f"{proposal_id}:lat_diligence", 20, 150),
        estimated_cost_usd=0.0,
        backend="seeded-deterministic",
    )


# ── Risk Detector fallback ──────────────────────────────────────────────────

def seeded_risk(
    proposal_id: str,
    proposal_text: str,
    program_mandate: str = "",
) -> StrategyResult:
    """Deterministic risk assessment using text heuristics."""
    h = _text_heuristics(proposal_text)

    flags: List[str] = []
    conf_per_flag: dict[str, float] = {}

    if h["injection_detected"]:
        flags.append("prompt_injection")
        conf_per_flag["prompt_injection"] = 0.95

    if h["manipulation_detected"]:
        flags.append("emotional_manipulation")
        conf_per_flag["emotional_manipulation"] = 0.80

    if h["hype_count"] > 3:
        flags.append("jargon_overload")
        conf_per_flag["jargon_overload"] = min(1.0, h["hype_count"] * 0.15)

    if h["budget_penalty"] > 0:
        flags.append("budget_inflation")
        conf_per_flag["budget_inflation"] = 0.65

    fraud_risk = min(1.0, h["fraud_risk_base"] * 1.2) if flags else 0.05
    mandate_mismatch = 0.1

    if program_mandate:
        mandate_words = set(program_mandate.lower().split())
        text_words = set(proposal_text.lower().split())
        overlap = mandate_words & text_words
        coverage = len(overlap) / max(len(mandate_words), 1)
        mandate_mismatch = round(max(0.0, 1.0 - coverage * 2), 3)

    reasoning = "; ".join(
        f"Detected {f} (confidence {conf_per_flag.get(f, 0.5):.2f})"
        for f in flags
    ) if flags else "No significant risks detected."

    return StrategyResult(
        task_type="risk",
        risk_assessment=RiskAssessment(
            fraud_risk=round(fraud_risk, 3),
            mandate_mismatch=mandate_mismatch,
            manipulation_flags=flags,
            confidence_per_flag=conf_per_flag,
            reasoning=reasoning,
        ),
        latency_ms=_hash_float(f"{proposal_id}:lat_risk", 10, 100),
        estimated_cost_usd=0.0,
        backend="seeded-deterministic",
    )
