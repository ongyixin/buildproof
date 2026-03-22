from __future__ import annotations

import random
from typing import List, Optional

import torch
import bittensor as bt


def get_random_uids(
    metagraph: bt.metagraph,
    k: int,
    exclude: Optional[List[int]] = None,
) -> torch.LongTensor:
    """
    Sample up to `k` UIDs from miners with active axons, excluding the
    provided list (typically [validator_uid]).

    Returns an empty tensor when no eligible miners are registered.
    """
    exclude = set(exclude or [])
    candidates = [
        uid
        for uid in range(metagraph.n.item())
        if metagraph.axons[uid].is_serving and uid not in exclude
    ]
    if not candidates:
        bt.logging.warning("get_random_uids: no eligible miner UIDs found.")
        return torch.LongTensor([])

    sampled = random.sample(candidates, min(k, len(candidates)))
    return torch.LongTensor(sampled)


def get_all_miner_uids(
    metagraph: bt.metagraph,
    exclude: Optional[List[int]] = None,
) -> torch.LongTensor:
    """Return all UIDs with active axons, excluding the given list."""
    exclude = set(exclude or [])
    uids = [
        uid
        for uid in range(metagraph.n.item())
        if metagraph.axons[uid].is_serving and uid not in exclude
    ]
    return torch.LongTensor(uids)


def get_weighted_uids(
    metagraph: bt.metagraph,
    k: int,
    exclude: Optional[List[int]] = None,
    task_type: Optional[str] = None,
    capability_registry: Optional[dict] = None,
    stake_floor: float = 0.1,
) -> torch.LongTensor:
    """
    Sample up to `k` UIDs using stake-weighted sampling from the live metagraph.

    Miners with higher stake are sampled more frequently, but a minimum floor
    weight (`stake_floor`) ensures low-stake miners still receive occasional
    queries — important for evaluation fairness on a new subnet.

    Args:
        metagraph:            Live Bittensor metagraph.
        k:                    Number of UIDs to sample.
        exclude:              UIDs to exclude (typically [validator_uid]).
        task_type:            If provided and capability_registry is set, only
                              sample miners that have declared support for this
                              task type. Falls through to all eligible miners
                              when no capable miner is registered.
        capability_registry:  Dict mapping uid → List[str] of declared task types.
                              Populated by the validator from miner responses.
        stake_floor:          Minimum weight fraction assigned to each candidate,
                              preventing zero-probability exclusion of any serving miner.

    Returns:
        LongTensor of sampled UIDs (length <= k).
    """
    exclude = set(exclude or [])

    # Build candidate list from live metagraph
    candidates = [
        uid
        for uid in range(metagraph.n.item())
        if metagraph.axons[uid].is_serving and uid not in exclude
    ]
    if not candidates:
        bt.logging.warning("get_weighted_uids: no eligible miner UIDs found.")
        return torch.LongTensor([])

    # Optionally filter by declared task capability
    if task_type and capability_registry:
        capable = [
            uid for uid in candidates
            if task_type in (capability_registry.get(uid) or [])
        ]
        if capable:
            candidates = capable
            bt.logging.debug(
                f"get_weighted_uids: {len(capable)} miners declared task_type={task_type}"
            )
        else:
            bt.logging.debug(
                f"get_weighted_uids: no declared capability for task_type={task_type}; "
                "using all eligible miners"
            )

    # Build stake weights with floor to ensure every miner has non-zero probability
    raw_stakes = [float(metagraph.S[uid].item()) for uid in candidates]
    max_stake = max(raw_stakes) if raw_stakes else 1.0
    if max_stake <= 0:
        max_stake = 1.0

    # Normalise to [stake_floor, 1.0]
    weights = [
        stake_floor + (1.0 - stake_floor) * (s / max_stake)
        for s in raw_stakes
    ]

    n_sample = min(k, len(candidates))
    sampled = random.choices(candidates, weights=weights, k=n_sample * 3)
    # Deduplicate while preserving order
    seen: set = set()
    unique: List[int] = []
    for uid in sampled:
        if uid not in seen:
            seen.add(uid)
            unique.append(uid)
        if len(unique) >= n_sample:
            break

    # Fall back to random.sample if deduplication didn't yield enough
    if len(unique) < n_sample:
        remaining = [uid for uid in candidates if uid not in seen]
        unique.extend(random.sample(remaining, min(n_sample - len(unique), len(remaining))))

    bt.logging.debug(
        f"get_weighted_uids: sampled {len(unique)}/{len(candidates)} miners "
        f"(task_type={task_type or 'any'}, stake_floor={stake_floor})"
    )
    return torch.LongTensor(unique)
