#!/usr/bin/env python3
"""
BuildProof validator neuron entry point.

Usage:
    python neurons/validator.py \
        --netuid 1 \
        --subtensor.network local \
        --wallet.name validator \
        --wallet.hotkey default \
        --neuron.benchmarks_dir benchmarks

The validator:
  1. Loads benchmark proposals from benchmarks/ at startup.
  2. Runs a continuous epoch loop (inherited from BaseValidatorNeuron.run()).
  3. Each epoch calls forward() → forward.run_epoch():
       - claims a proposal from the DB queue (or benchmark fallback)
       - queries miners with task-typed synapses via dendrite
       - computes task-specific rewards (rubric / diligence / risk)
       - applies anti-gaming penalties
       - updates EMA scores and sets weights on chain
       - emits results via result_callback → SQLite
  4. Periodically re-queues stale proposals stuck in 'processing'.

DB integration:
    The validator reads proposals from the DB (status='queued'),
    claims them transactionally, and writes results back. No in-process
    queue dependency — can run in a separate process from FastAPI.
"""
from __future__ import annotations

import bittensor as bt

from api.db import save_epoch_result, requeue_stale_proposals, save_weight_snapshot, emit_event
from buildproof.base.validator import BaseValidatorNeuron
from buildproof.validator.forward import BenchmarkManager, run_epoch


class Validator(BaseValidatorNeuron):
    """
    Concrete validator neuron.

    Sets up BenchmarkManager, wires result_callback to persist epoch
    results to SQLite, and delegates each epoch to forward.run_epoch().
    """

    def __init__(self, config: bt.Config = None):
        super().__init__(config)

        self.benchmark_manager = BenchmarkManager(
            benchmarks_dir=self.config.neuron.benchmarks_dir
        )

        self.result_callback = save_epoch_result

        self.load_state()

    def forward(self) -> None:
        """Delegate to the stateless run_epoch() function."""
        # Re-queue proposals stuck in processing for > 5 minutes
        if self.step % 10 == 0:
            requeued = requeue_stale_proposals(timeout_seconds=300.0)
            if requeued:
                bt.logging.info(f"Re-queued {requeued} stale proposal(s).")

        run_epoch(self)

    def set_weights(self) -> None:
        """Call base set_weights and save snapshot + emit chain event."""
        super().set_weights()
        try:
            uids = self.metagraph.uids.tolist()
            weights = self.scores.tolist()
            snapshot = [
                {"uid": int(uid), "weight": round(float(w), 6)}
                for uid, w in zip(uids, weights)
                if float(w) > 0
            ]
            if snapshot:
                save_weight_snapshot(snapshot)
                # Emit a global chain event (proposal_id="chain" is a sentinel)
                emit_event(
                    "chain",
                    "weights_submitted",
                    source="validator",
                    payload={
                        "step": self.step,
                        "uids": [s["uid"] for s in snapshot],
                        "weights": [s["weight"] for s in snapshot],
                        "epoch": self.step // max(self.config.neuron.epoch_length, 1),
                    },
                )
        except Exception as exc:
            bt.logging.warning(f"Failed to save weight snapshot: {exc}")


if __name__ == "__main__":
    validator = Validator()
    validator.run()
