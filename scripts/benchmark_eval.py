#!/usr/bin/env python3
"""
Benchmark evaluation harness for BuildProof reward function tuning.

Loads all gold and adversarial benchmark proposals, constructs mock synapse
responses from the reference scores/labels, runs them through compute_rewards(),
and prints a report showing per-task score distributions and separation metrics.

Usage:
    python scripts/benchmark_eval.py
    python scripts/benchmark_eval.py --show-detail
    python scripts/benchmark_eval.py --task rubric
    python scripts/benchmark_eval.py --category strong weak

The report shows:
  - Mean/std quality, calibration, robustness, efficiency, composite per task type
  - Separation between "should fund" vs "should reject" proposals
  - Anti-gaming penalty firing rates
  - Suggested weight adjustments based on observed separation gaps

Run this after adding new benchmarks or before adjusting weights in reward.py.
"""

import argparse
import json
import sys
from pathlib import Path
from statistics import mean, stdev
from typing import Dict, List, Optional

# Ensure project root is on path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from buildproof.protocol import (
    DiligenceSynapse,
    DiligenceQuestions,
    RiskAssessment,
    ScoreVector,
    TASK_TYPES,
)
from buildproof.validator.reward import (
    QUALITY_W, CALIBRATION_W, ROBUSTNESS_W, EFFICIENCY_W, ANTI_GAMING_W,
    compute_rewards,
)

BENCHMARKS_DIR = ROOT / "benchmarks"

RUBRIC_DIMS = [
    "feasibility", "impact", "novelty",
    "budget_reasonableness", "clarity", "mandate_alignment",
]


# ────────────────────────────────────────────────────────────────────────────
# Benchmark loading
# ────────────────────────────────────────────────────────────────────────────

def load_all_benchmarks() -> Dict[str, List[dict]]:
    """Load all benchmark files, returning {"gold": [...], "adversarial": [...]}."""
    gold: List[dict] = []
    adversarial: List[dict] = []

    for json_file in sorted(BENCHMARKS_DIR.glob("gold*.json")):
        with open(json_file) as f:
            data = json.load(f)
        entries = data.get("proposals", data) if isinstance(data, dict) else data
        if isinstance(entries, list):
            gold.extend(entries)

    for json_file in sorted(BENCHMARKS_DIR.glob("adversarial*.json")):
        with open(json_file) as f:
            data = json.load(f)
        entries = data.get("proposals", data) if isinstance(data, dict) else data
        if isinstance(entries, list):
            adversarial.extend(entries)

    return {"gold": gold, "adversarial": adversarial}


# ────────────────────────────────────────────────────────────────────────────
# Mock synapse construction from reference data
# ────────────────────────────────────────────────────────────────────────────

def _make_rubric_synapse(entry: dict, miner_quality: str = "good") -> DiligenceSynapse:
    """
    Build a mock rubric synapse.

    miner_quality:
      "good"    — miner matches reference scores closely (low MAE)
      "bad"     — miner inverts reference scores (high MAE, tests separation)
      "flat"    — miner outputs 0.5 for everything (calibration test)
    """
    ref = entry.get("reference_scores", {})

    if miner_quality == "good":
        scores = {dim: ref.get(dim, 0.5) for dim in RUBRIC_DIMS}
        # Well-calibrated: confidence tracks the reference score
        confidences = {dim: min(0.95, ref.get(dim, 0.5) + 0.1) for dim in RUBRIC_DIMS}
    elif miner_quality == "bad":
        # Invert: low-scoring proposals get high scores and vice versa
        scores = {dim: max(0.05, min(0.95, 1.0 - ref.get(dim, 0.5))) for dim in RUBRIC_DIMS}
        confidences = {dim: 0.90 for dim in RUBRIC_DIMS}  # overconfident + wrong
    else:  # flat
        scores = {dim: 0.5 for dim in RUBRIC_DIMS}
        confidences = {dim: 0.5 for dim in RUBRIC_DIMS}

    sv = ScoreVector(
        **scores,
        confidence_by_dimension=confidences,
    )
    return DiligenceSynapse(
        proposal_id=entry.get("proposal_id", "bench"),
        proposal_text=entry.get("proposal_text", ""),
        program_mandate=entry.get("program_mandate", ""),
        task_type="rubric",
        score_vector=sv,
        latency_ms=1500.0,
        estimated_cost_usd=0.002,
        backend=f"benchmark_mock_{miner_quality}",
    )


def _make_diligence_synapse(entry: dict, miner_quality: str = "good") -> DiligenceSynapse:
    """Build a mock diligence synapse. miner_quality: 'good'|'bad'|'flat'."""
    ref_questions = entry.get("reference_questions") or entry.get("expected_diligence_questions") or []

    if miner_quality == "good":
        questions = ref_questions[:6]
        missing_ev = ["Budget breakdown detail", "Team credentials", "Maintenance plan"]
        missing_ms = ["Post-launch maintenance", "User adoption milestones"]
    elif miner_quality == "bad":
        # Short, low-quality questions with no reference overlap
        questions = ["Why?", "How?"]
        missing_ev = []
        missing_ms = []
    else:  # flat — moderate output
        questions = ref_questions[:2] if ref_questions else ["What is the timeline?"]
        missing_ev = ["Budget detail"]
        missing_ms = []

    dq = DiligenceQuestions(
        questions=questions,
        missing_evidence=missing_ev,
        missing_milestones=missing_ms,
        coverage_summary="Mock diligence.",
    )
    return DiligenceSynapse(
        proposal_id=entry.get("proposal_id", "bench"),
        proposal_text=entry.get("proposal_text", ""),
        program_mandate=entry.get("program_mandate", ""),
        task_type="diligence",
        diligence_questions=dq,
        latency_ms=2000.0,
        estimated_cost_usd=0.005,
        backend=f"benchmark_mock_{miner_quality}",
    )


def _make_risk_synapse(
    entry: dict, is_adversarial: bool = False, miner_quality: str = "good"
) -> DiligenceSynapse:
    """Build a mock risk synapse. miner_quality: 'good'|'bad'|'flat'."""
    expected_flags = entry.get("expected_flags", [])
    expected_min = float(entry.get("expected_fraud_risk_min", 0.0))

    if miner_quality == "good":
        if is_adversarial:
            fraud_risk = max(expected_min + 0.05, 0.70) if expected_min > 0 else 0.75
            flags = expected_flags[:5]
        else:
            fraud_risk = 0.05
            flags = []
    elif miner_quality == "bad":
        if is_adversarial:
            # Fooled: misses the attack
            fraud_risk = 0.10
            flags = []
        else:
            # False positive: flags clean proposals heavily
            fraud_risk = 0.85
            flags = ["fake_traction", "budget_inflation", "low_substance", "jargon_overload", "prompt_injection", "milestone_padding"]
    else:  # flat
        fraud_risk = 0.50
        flags = expected_flags[:1] if expected_flags else []

    ra = RiskAssessment(
        fraud_risk=min(1.0, fraud_risk),
        mandate_mismatch=0.1,
        manipulation_flags=flags,
        confidence_per_flag={f: 0.75 for f in flags},
        reasoning="Mock risk assessment.",
    )
    return DiligenceSynapse(
        proposal_id=entry.get("proposal_id", "bench"),
        proposal_text=entry.get("proposal_text", ""),
        program_mandate=entry.get("program_mandate", ""),
        task_type="risk",
        risk_assessment=ra,
        latency_ms=800.0,
        estimated_cost_usd=0.001,
        backend=f"benchmark_mock_{miner_quality}",
    )


# ────────────────────────────────────────────────────────────────────────────
# Evaluation runner
# ────────────────────────────────────────────────────────────────────────────

def evaluate_entry(entry: dict, is_adversarial: bool) -> Dict[str, dict]:
    """
    Run all three task types against a benchmark entry for "good" and "bad" miners.

    Returns {
        "rubric_good": ..., "rubric_bad": ...,
        "diligence_good": ..., "diligence_bad": ...,
        "risk_good": ..., "risk_bad": ...
    }
    """
    ref = entry.get("reference_scores")
    adv_meta = entry if is_adversarial else None
    ref_questions = entry.get("reference_questions")
    results = {}

    for quality in ("good", "bad"):
        rubric_synapse = _make_rubric_synapse(entry, miner_quality=quality)
        _, (rubric_bd,) = compute_rewards(
            responses=[rubric_synapse],
            uids=[1],
            gold_scores=ref,
            is_adversarial=is_adversarial,
            adversarial_meta=adv_meta,
        )
        results[f"rubric_{quality}"] = rubric_bd

        diligence_synapse = _make_diligence_synapse(entry, miner_quality=quality)
        _, (diligence_bd,) = compute_rewards(
            responses=[diligence_synapse],
            uids=[2],
            gold_scores=ref,
            is_adversarial=is_adversarial,
            adversarial_meta=adv_meta,
            reference_questions=ref_questions,
        )
        results[f"diligence_{quality}"] = diligence_bd

        risk_synapse = _make_risk_synapse(entry, is_adversarial=is_adversarial, miner_quality=quality)
        _, (risk_bd,) = compute_rewards(
            responses=[risk_synapse],
            uids=[3],
            gold_scores=ref,
            is_adversarial=is_adversarial,
            adversarial_meta=adv_meta,
        )
        results[f"risk_{quality}"] = risk_bd

    return results


# ────────────────────────────────────────────────────────────────────────────
# Report generation
# ────────────────────────────────────────────────────────────────────────────

def _fmt(v: float) -> str:
    return f"{v:.3f}"


def _fmt_list(vals: List[float]) -> str:
    if not vals:
        return "n/a"
    return f"{mean(vals):.3f} ± {stdev(vals):.3f}" if len(vals) > 1 else f"{vals[0]:.3f}"


def print_report(
    all_results: List[dict],
    show_detail: bool = False,
    filter_task: Optional[str] = None,
    filter_categories: Optional[List[str]] = None,
) -> None:
    """Print a formatted evaluation report to stdout."""
    print("=" * 72)
    print("BuildProof Benchmark Evaluation Report")
    print(f"Current weights: Q={QUALITY_W} C={CALIBRATION_W} R={ROBUSTNESS_W} E={EFFICIENCY_W} AG={ANTI_GAMING_W}")
    print("=" * 72)

    # Aggregate good-miner vs bad-miner separation per task
    good_scores: Dict[str, List[float]] = {t: [] for t in TASK_TYPES}
    bad_scores: Dict[str, List[float]] = {t: [] for t in TASK_TYPES}
    by_task: Dict[str, Dict[str, List[float]]] = {
        t: {"composite": [], "quality": [], "calibration": [], "robustness": [], "efficiency": []}
        for t in TASK_TYPES
    }
    penalty_counts: Dict[str, int] = {}
    entry_scores: List[dict] = []

    for row in all_results:
        entry = row["entry"]
        task_results = row["task_results"]
        rec = entry.get("recommendation") or entry.get("expected_recommendation")
        category = entry.get("category", "unknown")

        if filter_categories and category not in filter_categories:
            continue

        for task in TASK_TYPES:
            if filter_task and task != filter_task:
                continue
            good_bd = task_results.get(f"{task}_good", {})
            bad_bd = task_results.get(f"{task}_bad", {})

            if good_bd:
                good_scores[task].append(good_bd["composite"])
                by_task[task]["composite"].append(good_bd["composite"])
                by_task[task]["quality"].append(good_bd["quality"])
                by_task[task]["calibration"].append(good_bd["calibration"])
                by_task[task]["robustness"].append(good_bd["robustness"])
                by_task[task]["efficiency"].append(good_bd["efficiency"])
                for penalty_name in good_bd.get("penalties", {}):
                    penalty_counts[penalty_name] = penalty_counts.get(penalty_name, 0) + 1
            if bad_bd:
                bad_scores[task].append(bad_bd["composite"])
                for penalty_name in bad_bd.get("penalties", {}):
                    penalty_counts[penalty_name] = penalty_counts.get(penalty_name, 0) + 1

        entry_scores.append({
            "id": entry.get("proposal_id", "?"),
            "category": category,
            "rec": rec or "?",
            "is_adv": row["is_adversarial"],
            "rubric_good": task_results.get("rubric_good", {}).get("composite", 0.0),
            "rubric_bad": task_results.get("rubric_bad", {}).get("composite", 0.0),
            "diligence_good": task_results.get("diligence_good", {}).get("composite", 0.0),
            "diligence_bad": task_results.get("diligence_bad", {}).get("composite", 0.0),
            "risk_good": task_results.get("risk_good", {}).get("composite", 0.0),
            "risk_bad": task_results.get("risk_bad", {}).get("composite", 0.0),
        })

    # Per-task summary
    print(f"\n{'TASK':<12} {'N':>4}  {'COMPOSITE':>15}  {'QUALITY':>15}  {'CALIBRATION':>15}")
    print("-" * 68)
    for task in TASK_TYPES:
        data = by_task[task]
        n = len(data["composite"])
        if n == 0:
            continue
        print(
            f"{task:<12} {n:>4}  {_fmt_list(data['composite']):>15}  "
            f"{_fmt_list(data['quality']):>15}  {_fmt_list(data['calibration']):>15}"
        )

    # Good-miner vs bad-miner separation (the key reward function signal)
    print(f"\n{'TASK':<12} {'GOOD_MINER':>12} {'BAD_MINER':>12} {'SEPARATION':>12} {'OK?':>5}")
    print("-" * 55)
    for task in TASK_TYPES:
        g_vals = good_scores[task]
        b_vals = bad_scores[task]
        if not g_vals or not b_vals:
            print(f"{task:<12} {'n/a':>12} {'n/a':>12} {'n/a':>12}")
            continue
        g_mean = mean(g_vals)
        b_mean = mean(b_vals)
        separation = g_mean - b_mean
        ok = "YES" if separation >= 0.15 else "LOW"
        print(f"{task:<12} {_fmt(g_mean):>12} {_fmt(b_mean):>12} {_fmt(separation):>12} {ok:>5}")

    # Penalty firing rates
    if penalty_counts:
        total = len(all_results)
        print(f"\nPenalty Firing Rates (out of {total} proposals × 3 tasks = {total * 3} evals):")
        for name, count in sorted(penalty_counts.items(), key=lambda x: -x[1]):
            rate = count / (total * 3)
            print(f"  {name:<30} {count:>4}  ({rate:.1%})")

    # Weight tuning suggestions
    print("\n" + "=" * 72)
    print("Weight Tuning Suggestions:")
    _print_weight_suggestions(by_task, good_scores, bad_scores)

    if show_detail:
        print("\n" + "=" * 72)
        print("Per-Entry Detail (good miner composite | bad miner composite per task):")
        print(f"{'ID':<30} {'CAT':<25} {'ADV':>4}  {'RUB_G':>6} {'RUB_B':>6}  {'DIL_G':>6} {'DIL_B':>6}  {'RSK_G':>6} {'RSK_B':>6}")
        print("-" * 105)
        for row in sorted(entry_scores, key=lambda x: x["rubric_good"], reverse=True):
            adv_marker = "ADV" if row["is_adv"] else ""
            print(
                f"{row['id']:<30} {row['category']:<25} {adv_marker:>4}  "
                f"{row['rubric_good']:>6.3f} {row['rubric_bad']:>6.3f}  "
                f"{row['diligence_good']:>6.3f} {row['diligence_bad']:>6.3f}  "
                f"{row['risk_good']:>6.3f} {row['risk_bad']:>6.3f}"
            )


def _print_weight_suggestions(
    by_task: dict,
    good_scores: dict,
    bad_scores: dict,
) -> None:
    suggestions = []

    for task in TASK_TYPES:
        g_vals = good_scores[task]
        b_vals = bad_scores[task]
        if not g_vals or not b_vals:
            continue
        separation = mean(g_vals) - mean(b_vals)
        if separation < 0.10:
            suggestions.append(
                f"  [{task}] Low good/bad separation ({separation:.3f}). "
                "Consider increasing QUALITY_W to amplify gold-label signal."
            )
        elif separation < 0.20:
            suggestions.append(
                f"  [{task}] Moderate separation ({separation:.3f}). "
                "Acceptable but consider raising QUALITY_W by 0.05."
            )
        else:
            suggestions.append(
                f"  [{task}] Strong separation ({separation:.3f}). "
                "Weights appear well-calibrated for this task."
            )

    # Check calibration spread
    for task in TASK_TYPES:
        cal_vals = by_task[task]["calibration"]
        if cal_vals and mean(cal_vals) < 0.45:
            suggestions.append(
                f"  [{task}] Low mean calibration ({mean(cal_vals):.3f}). "
                "Consider reducing CALIBRATION_W or reviewing confidence design."
            )

    if not suggestions:
        suggestions.append("  All separations and calibration scores look reasonable.")

    for s in suggestions:
        print(s)


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="BuildProof benchmark evaluation harness")
    parser.add_argument("--show-detail", action="store_true", help="Print per-entry scores")
    parser.add_argument("--task", choices=list(TASK_TYPES), help="Filter to a specific task type")
    parser.add_argument("--category", nargs="+", metavar="CAT", help="Filter to specific categories")
    parser.add_argument("--adversarial-only", action="store_true", help="Only evaluate adversarial proposals")
    parser.add_argument("--gold-only", action="store_true", help="Only evaluate gold proposals")
    args = parser.parse_args()

    print(f"Loading benchmarks from {BENCHMARKS_DIR} ...")
    benchmarks = load_all_benchmarks()
    gold = benchmarks["gold"]
    adversarial = benchmarks["adversarial"]

    print(f"Found: {len(gold)} gold proposals, {len(adversarial)} adversarial proposals")

    entries_to_eval: List[tuple] = []
    if not args.adversarial_only:
        entries_to_eval.extend([(e, False) for e in gold])
    if not args.gold_only:
        entries_to_eval.extend([(e, True) for e in adversarial])

    print(f"Evaluating {len(entries_to_eval)} proposals across 3 task types ...\n")

    all_results = []
    for entry, is_adv in entries_to_eval:
        try:
            task_results = evaluate_entry(entry, is_adversarial=is_adv)
            all_results.append({
                "entry": entry,
                "is_adversarial": is_adv,
                "task_results": task_results,
            })
        except Exception as exc:
            pid = entry.get("proposal_id", "?")
            print(f"  WARNING: failed to evaluate {pid}: {exc}", file=sys.stderr)

    print_report(
        all_results,
        show_detail=args.show_detail,
        filter_task=args.task,
        filter_categories=args.category,
    )

    print(f"\nEvaluated {len(all_results)} proposals successfully.")


if __name__ == "__main__":
    main()
