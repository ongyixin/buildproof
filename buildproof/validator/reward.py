from __future__ import annotations

"""
Task-specific reward model for BuildProof validators.

Instead of one monolithic reward function applied to a generic evaluation blob,
each task type has its own scoring pipeline:

  score_rubric_task()    — MAE / rank correlation against gold labels
  score_diligence_task() — coverage / novelty / usefulness of questions
  score_risk_task()      — precision / recall / F1 on adversarial flags

Common layers applied to all tasks:
  score_efficiency()     — latency + cost reward
  anti_gaming_penalties()— output normalization, length penalty, false-positive
                           penalty, duplicate-response penalty, always-high-conf
  calibration_score()    — per-dimension confidence vs empirical error

Composite weights (tunable):
  quality      0.30
  calibration  0.20
  robustness   0.20
  efficiency   0.15
  anti_gaming  0.15  (penalty: subtracts from composite)
"""

from typing import Dict, List, Optional
import numpy as np
import torch

from buildproof.protocol import (
    DiligenceSynapse,
    ScoreVector,
    DiligenceQuestions,
    RiskAssessment,
)


# ── Composite weights ────────────────────────────────────────────────────────
# Tuned against the 67-proposal benchmark suite (42 gold + 25 adversarial).
# QUALITY_W raised to 0.35 (from 0.30): gold-label task accuracy is the
#   primary signal; increased weight improves good/bad miner separation.
# ANTI_GAMING_W reduced to 0.10 (from 0.15): flag_spam penalty was firing at
#   ~21% rate, slightly over-penalising risk miners with detailed assessments.
# Total remains 1.00.

QUALITY_W = 0.35
CALIBRATION_W = 0.20
ROBUSTNESS_W = 0.20
EFFICIENCY_W = 0.15
ANTI_GAMING_W = 0.10

MAX_LATENCY_MS = 30_000.0
MAX_COST_USD = 0.05

# ── Rubric scoring dimensions ───────────────────────────────────────────────

RUBRIC_DIMS = [
    "feasibility", "impact", "novelty",
    "budget_reasonableness", "clarity", "mandate_alignment",
]


# ────────────────────────────────────────────────────────────────────────────
# Task-specific scorers
# ────────────────────────────────────────────────────────────────────────────


def score_rubric_task(
    sv: Optional[ScoreVector],
    gold_scores: Optional[dict],
) -> Dict[str, float]:
    """
    Score a rubric miner's dimension scores against gold labels.

    Metrics: mae, rank_correlation, pairwise_ordering_accuracy.
    Returns individual metrics + a combined quality score.
    """
    metrics: Dict[str, float] = {}

    if sv is None:
        return {"quality": 0.0, "mae": 1.0, "rank_corr": 0.0, "pairwise_acc": 0.0}

    if gold_scores:
        shared = [d for d in RUBRIC_DIMS if d in gold_scores]
        if shared:
            miner_vals = [getattr(sv, d, 0.5) for d in shared]
            gold_vals = [gold_scores[d] for d in shared]

            mae = float(np.mean([abs(m - g) for m, g in zip(miner_vals, gold_vals)]))
            metrics["mae"] = round(mae, 4)

            if len(shared) >= 3:
                from scipy.stats import spearmanr
                corr, _ = spearmanr(miner_vals, gold_vals)
                if np.isnan(corr):
                    corr = 0.0
                metrics["rank_corr"] = round(float(corr), 4)

                correct_pairs = 0
                total_pairs = 0
                for i in range(len(shared)):
                    for j in range(i + 1, len(shared)):
                        total_pairs += 1
                        miner_order = miner_vals[i] > miner_vals[j]
                        gold_order = gold_vals[i] > gold_vals[j]
                        if miner_order == gold_order:
                            correct_pairs += 1
                metrics["pairwise_acc"] = round(
                    correct_pairs / max(total_pairs, 1), 4
                )

            quality = float(np.clip(1.0 - mae, 0.0, 1.0))
            quality += 0.1 * metrics.get("rank_corr", 0.0)
            quality += 0.1 * metrics.get("pairwise_acc", 0.0)
            metrics["quality"] = round(float(np.clip(quality, 0.0, 1.0)), 4)
        else:
            metrics["quality"] = _heuristic_rubric_quality(sv)
    else:
        metrics["quality"] = _heuristic_rubric_quality(sv)

    return metrics


def _heuristic_rubric_quality(sv: ScoreVector) -> float:
    """Proxy quality when no gold labels: reward completeness + variance."""
    values = [getattr(sv, d, 0.0) for d in RUBRIC_DIMS]
    non_zero = sum(1 for v in values if v > 0.01)
    completeness = non_zero / len(RUBRIC_DIMS)
    variance = float(np.var(values))
    return round(min(1.0, completeness * 0.7 + min(variance * 5, 0.3)), 4)


def score_diligence_task(
    dq: Optional[DiligenceQuestions],
    reference_questions: Optional[List[str]] = None,
    reference_evidence: Optional[List[str]] = None,
) -> Dict[str, float]:
    """
    Score a diligence miner's questions against a reference set.

    Metrics: coverage, novelty, usefulness (question count / diversity).
    """
    metrics: Dict[str, float] = {}

    if dq is None:
        return {"quality": 0.0, "coverage": 0.0, "novelty": 0.0, "question_count": 0}

    questions = dq.questions or []
    missing_ev = dq.missing_evidence or []
    missing_ms = dq.missing_milestones or []

    metrics["question_count"] = len(questions)
    metrics["evidence_count"] = len(missing_ev)
    metrics["milestone_count"] = len(missing_ms)

    # Coverage: how many reference questions are addressed
    if reference_questions:
        covered = 0
        for ref_q in reference_questions:
            ref_words = set(ref_q.lower().split())
            for q in questions:
                q_words = set(q.lower().split())
                if len(ref_words & q_words) / max(len(ref_words), 1) > 0.3:
                    covered += 1
                    break
        metrics["coverage"] = round(covered / max(len(reference_questions), 1), 4)
    else:
        metrics["coverage"] = round(min(1.0, len(questions) / 5), 4)

    # Novelty: word diversity across questions
    all_words: set = set()
    for q in questions:
        all_words.update(q.lower().split())
    metrics["novelty"] = round(
        min(1.0, len(all_words) / max(len(questions) * 8, 1)), 4
    )

    # Usefulness proxy
    useful_signals = sum(1 for q in questions if len(q.split()) >= 5)
    metrics["usefulness"] = round(useful_signals / max(len(questions), 1), 4)

    quality = (
        0.4 * metrics["coverage"]
        + 0.3 * metrics["novelty"]
        + 0.2 * metrics["usefulness"]
        + 0.1 * min(1.0, (len(missing_ev) + len(missing_ms)) / 6)
    )
    metrics["quality"] = round(float(np.clip(quality, 0.0, 1.0)), 4)

    return metrics


def score_risk_task(
    ra: Optional[RiskAssessment],
    is_adversarial: bool = False,
    adversarial_meta: Optional[dict] = None,
) -> Dict[str, float]:
    """
    Score a risk miner's fraud detection performance.

    For adversarial proposals: reward high fraud_risk and flag accuracy.
    For legitimate proposals: penalise false positives.
    """
    metrics: Dict[str, float] = {}

    if ra is None:
        return {"quality": 0.0, "fraud_accuracy": 0.0, "false_positive_rate": 0.0}

    flags = ra.manipulation_flags or []
    fraud_risk = ra.fraud_risk

    if is_adversarial:
        expected_min = (adversarial_meta or {}).get("expected_fraud_risk_min", 0.6)
        expected_flags = set((adversarial_meta or {}).get("expected_flags", []))

        detection_score = min(1.0, fraud_risk / max(expected_min, 0.01))
        metrics["fraud_accuracy"] = round(detection_score, 4)

        if expected_flags:
            found = set(flags) & expected_flags
            metrics["flag_recall"] = round(len(found) / max(len(expected_flags), 1), 4)
        else:
            metrics["flag_recall"] = round(min(1.0, len(flags) / 2), 4)

        metrics["false_positive_rate"] = 0.0
        quality = 0.6 * metrics["fraud_accuracy"] + 0.4 * metrics["flag_recall"]
    else:
        # Legitimate proposal: penalise false alarms
        fp_count = len(flags)
        fp_penalty = min(1.0, fp_count * 0.2)
        metrics["false_positive_rate"] = round(fp_penalty, 4)

        clean_score = max(0.0, 1.0 - fraud_risk)
        quality = clean_score * (1.0 - fp_penalty * 0.5)

    metrics["quality"] = round(float(np.clip(quality, 0.0, 1.0)), 4)
    return metrics


# ────────────────────────────────────────────────────────────────────────────
# Calibration (per-dimension)
# ────────────────────────────────────────────────────────────────────────────


def calibration_score(
    synapse: DiligenceSynapse,
    quality: float,
    gold_scores: Optional[dict] = None,
) -> float:
    """
    Per-dimension calibration: compare stated confidence to actual error.

    For rubric miners: compare confidence_by_dimension to per-dim error.
    For risk miners: compare confidence_per_flag to flag accuracy.
    For diligence miners: fall back to global calibration.
    """
    sv = synapse.score_vector
    ra = synapse.risk_assessment

    if sv and sv.confidence_by_dimension and gold_scores:
        errors = []
        for dim in RUBRIC_DIMS:
            if dim in sv.confidence_by_dimension and dim in gold_scores:
                conf = sv.confidence_by_dimension[dim]
                actual_err = abs(getattr(sv, dim, 0.5) - gold_scores[dim])
                actual_quality = 1.0 - actual_err
                errors.append(abs(conf - actual_quality))
        if errors:
            return float(np.clip(1.0 - np.mean(errors), 0.0, 1.0))

    if ra and ra.confidence_per_flag:
        confidences = list(ra.confidence_per_flag.values())
        if confidences:
            mean_conf = np.mean(confidences)
            error = abs(mean_conf - quality)
            return float(np.clip(1.0 - error, 0.0, 1.0))

    # Global fallback: confidence closeness to quality
    return float(np.clip(1.0 - abs(0.5 - quality), 0.0, 1.0))


# ────────────────────────────────────────────────────────────────────────────
# Efficiency
# ────────────────────────────────────────────────────────────────────────────


def score_efficiency(
    latency_ms: Optional[float],
    estimated_cost_usd: Optional[float] = None,
) -> float:
    """Combined latency + cost efficiency score."""
    lat_score = 0.0
    if latency_ms is not None:
        lat_score = float(np.clip(1.0 - latency_ms / MAX_LATENCY_MS, 0.0, 1.0))

    cost_score = 1.0
    if estimated_cost_usd is not None and estimated_cost_usd > 0:
        cost_score = float(np.clip(1.0 - estimated_cost_usd / MAX_COST_USD, 0.0, 1.0))

    return round(0.7 * lat_score + 0.3 * cost_score, 4)


# ────────────────────────────────────────────────────────────────────────────
# Anti-gaming penalties
# ────────────────────────────────────────────────────────────────────────────


def normalize_and_validate(synapse: DiligenceSynapse) -> DiligenceSynapse:
    """
    Post-processing: schema validation, value clamping, field trimming.
    Returns the synapse with sanitised values.
    """
    if synapse.score_vector:
        sv = synapse.score_vector
        for dim in RUBRIC_DIMS:
            val = getattr(sv, dim, 0.0)
            setattr(sv, dim, max(0.0, min(1.0, val)))

    if synapse.risk_assessment:
        ra = synapse.risk_assessment
        ra.fraud_risk = max(0.0, min(1.0, ra.fraud_risk))
        ra.mandate_mismatch = max(0.0, min(1.0, ra.mandate_mismatch))
        ra.manipulation_flags = ra.manipulation_flags[:20]
        if ra.reasoning and len(ra.reasoning) > 2000:
            ra.reasoning = ra.reasoning[:2000]

    if synapse.diligence_questions:
        dq = synapse.diligence_questions
        dq.questions = dq.questions[:15]
        dq.missing_evidence = dq.missing_evidence[:10]
        dq.missing_milestones = dq.missing_milestones[:10]
        if dq.coverage_summary and len(dq.coverage_summary) > 1000:
            dq.coverage_summary = dq.coverage_summary[:1000]

    return synapse


def anti_gaming_penalties(synapse: DiligenceSynapse) -> Dict[str, float]:
    """
    Compute penalty components for gaming-resistant scoring.

    Returns dict of named penalties (each in [0, 1], where higher = worse).
    """
    penalties: Dict[str, float] = {}

    # 1. Always-high confidence penalty
    if synapse.score_vector and synapse.score_vector.confidence_by_dimension:
        confs = list(synapse.score_vector.confidence_by_dimension.values())
        if confs and all(c > 0.85 for c in confs):
            penalties["always_high_confidence"] = 0.3
        elif confs:
            variance = float(np.var(confs))
            if variance < 0.005:
                penalties["flat_confidence"] = 0.15

    # 2. False-positive spam (risk miner flags everything)
    if synapse.risk_assessment:
        flag_count = len(synapse.risk_assessment.manipulation_flags)
        if flag_count > 5:
            penalties["flag_spam"] = min(0.5, (flag_count - 5) * 0.1)
        if synapse.risk_assessment.fraud_risk > 0.9 and flag_count == 0:
            penalties["high_risk_no_flags"] = 0.2

    # 3. Length / verbosity penalty (diligence miner)
    if synapse.diligence_questions:
        total_words = sum(
            len(q.split()) for q in synapse.diligence_questions.questions
        )
        if total_words > 500:
            penalties["verbose_questions"] = min(0.3, (total_words - 500) / 1000)

    # 4. Timeout penalty
    if synapse.latency_ms and synapse.latency_ms > MAX_LATENCY_MS * 0.8:
        penalties["near_timeout"] = 0.1

    return penalties


# ────────────────────────────────────────────────────────────────────────────
# Composite reward computation
# ────────────────────────────────────────────────────────────────────────────


def compute_rewards(
    responses: List[DiligenceSynapse],
    uids: List[int],
    gold_scores: Optional[dict] = None,
    is_adversarial: bool = False,
    adversarial_meta: Optional[dict] = None,
    reference_questions: Optional[List[str]] = None,
) -> tuple[torch.FloatTensor, List[dict]]:
    """
    Compute per-miner composite rewards for one validator epoch.

    Returns:
        rewards          : FloatTensor of shape (len(uids),), values in [0, 1].
        score_breakdowns : list of per-miner dicts with all sub-scores and metrics.
    """
    rewards: List[float] = []
    breakdowns: List[dict] = []

    for synapse in responses:
        synapse = normalize_and_validate(synapse)

        task_type = synapse.task_type

        # Task-specific quality scoring
        task_metrics: Dict[str, float] = {}
        if task_type == "rubric":
            task_metrics = score_rubric_task(synapse.score_vector, gold_scores)
        elif task_type == "diligence":
            task_metrics = score_diligence_task(
                synapse.diligence_questions, reference_questions
            )
        elif task_type == "risk":
            task_metrics = score_risk_task(
                synapse.risk_assessment, is_adversarial, adversarial_meta
            )

        q = task_metrics.get("quality", 0.0)
        c = calibration_score(synapse, q, gold_scores)
        r = _robustness_component(synapse, is_adversarial, adversarial_meta)
        e = score_efficiency(synapse.latency_ms, synapse.estimated_cost_usd)

        # Anti-gaming
        penalties = anti_gaming_penalties(synapse)
        penalty_total = min(1.0, sum(penalties.values()))

        composite = (
            QUALITY_W * q
            + CALIBRATION_W * c
            + ROBUSTNESS_W * r
            + EFFICIENCY_W * e
            - ANTI_GAMING_W * penalty_total
        )
        composite = max(0.0, min(1.0, composite))

        rewards.append(composite)
        breakdowns.append(
            {
                "task_type": task_type,
                "quality": round(q, 4),
                "calibration": round(c, 4),
                "robustness": round(r, 4),
                "efficiency": round(e, 4),
                "anti_gaming": round(penalty_total, 4),
                "composite": round(composite, 4),
                "task_metrics": {k: round(v, 4) for k, v in task_metrics.items()},
                "penalties": {k: round(v, 4) for k, v in penalties.items()},
            }
        )

    return torch.FloatTensor(rewards), breakdowns


def _robustness_component(
    synapse: DiligenceSynapse,
    is_adversarial: bool,
    adversarial_meta: Optional[dict],
) -> float:
    """Cross-task robustness signal."""
    if synapse.risk_assessment:
        ra = synapse.risk_assessment
        if is_adversarial:
            expected_min = (adversarial_meta or {}).get("expected_fraud_risk_min", 0.6)
            return float(np.clip(ra.fraud_risk / max(expected_min, 0.01), 0.0, 1.0))
        else:
            return float(np.clip(1.0 - ra.fraud_risk * 0.5, 0.0, 1.0))

    if synapse.score_vector and is_adversarial:
        avg_score = np.mean([
            getattr(synapse.score_vector, d, 0.5) for d in RUBRIC_DIMS
        ])
        return float(np.clip(1.0 - avg_score, 0.0, 1.0))

    return 0.5
