from __future__ import annotations

import abc
import time
from typing import Optional

import torch
import bittensor as bt

from buildproof.base.neuron import BaseNeuron


class BaseValidatorNeuron(BaseNeuron):
    """
    Validator base class.

    Lifecycle:
      1. __init__: creates dendrite, initialises per-UID score tensor.
      2. run(): blocking loop — calls forward() each step, resyncs metagraph,
         and sets weights on the configured schedule.
      3. forward(): implemented by the concrete Validator in neurons/validator.py;
         calls forward.run_epoch() which queries miners and computes rewards.
      4. update_scores(): EMA update applied after each reward computation.
      5. set_weights(): normalises scores and writes to the local chain.
    """

    neuron_type: str = "ValidatorNeuron"

    def __init__(self, config: bt.Config = None):
        super().__init__(config)

        self.dendrite = bt.Dendrite(wallet=self.wallet)
        bt.logging.info(f"Dendrite: {self.dendrite}")

        # Per-UID moving-averaged scores; shape grows with metagraph on resync.
        self.scores = torch.zeros(self.metagraph.n, dtype=torch.float32)

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        bt.logging.info("Starting validator loop.")
        try:
            while True:
                _t_step_start = time.time()
                bt.logging.info(f"── Step {self.step} ──")
                self.forward()

                if self.should_sync_metagraph():
                    self.resync_metagraph()
                    self._maybe_resize_scores()

                if self.should_set_weights():
                    self.set_weights()

                self.step += 1
                # Sleep only the time remaining in the 12-second block window so
                # the loop doesn't accumulate idle time on top of long epochs.
                _remaining = 12.0 - (time.time() - _t_step_start)
                if _remaining > 0:
                    time.sleep(_remaining)

        except KeyboardInterrupt:
            bt.logging.info("Validator stopped by keyboard interrupt.")

    # ------------------------------------------------------------------
    # Abstract: implemented in neurons/validator.py
    # ------------------------------------------------------------------

    @abc.abstractmethod
    def forward(self) -> None:
        """Run one validator epoch: query miners, compute rewards, update scores."""
        ...

    # ------------------------------------------------------------------
    # Score management
    # ------------------------------------------------------------------

    def update_scores(
        self, rewards: torch.FloatTensor, uids: torch.LongTensor
    ) -> None:
        """
        Apply EMA update to the per-UID score tensor.

        Only the UIDs returned by the current epoch are updated; all other
        UIDs decay naturally toward zero via the (1 - alpha) factor.
        """
        alpha = self.config.neuron.moving_average_alpha
        scattered = torch.zeros_like(self.scores)
        scattered[uids] = rewards.to(self.scores.dtype)
        self.scores = alpha * scattered + (1.0 - alpha) * self.scores
        bt.logging.debug(f"Scores after update: {self.scores.tolist()}")

    def _maybe_resize_scores(self) -> None:
        """Grow or shrink the score tensor to match current metagraph size."""
        n = self.metagraph.n.item()
        if self.scores.shape[0] != n:
            bt.logging.info(
                f"Resizing scores tensor: {self.scores.shape[0]} → {n}"
            )
            new_scores = torch.zeros(n, dtype=torch.float32)
            copy_n = min(self.scores.shape[0], n)
            new_scores[:copy_n] = self.scores[:copy_n]
            self.scores = new_scores

    # ------------------------------------------------------------------
    # Weight setting
    # ------------------------------------------------------------------

    def should_set_weights(self) -> bool:
        return self.step > 0 and (self.step % self.config.neuron.epoch_length) == 0

    def _uids_cpu_long(self) -> torch.LongTensor:
        """
        Return metagraph UIDs as a CPU long tensor across bittensor versions.
        """
        uids = self.metagraph.uids
        if isinstance(uids, torch.Tensor):
            return uids.to("cpu").long()
        return torch.as_tensor(uids, dtype=torch.long, device="cpu")

    def set_weights(self) -> None:
        """
        Normalise moving-averaged scores to sum=1 and write to the chain.

        Uses bt.utils.weight_utils.process_weights_for_netuid to apply
        subnet-specific min/max weight constraints before submitting.
        """
        raw_weights = torch.nn.functional.normalize(self.scores, p=1, dim=0)
        uids_cpu = self._uids_cpu_long()

        try:
            (
                processed_uids,
                processed_weights,
            ) = bt.utils.weight_utils.process_weights_for_netuid(
                uids=uids_cpu,
                weights=raw_weights.to("cpu"),
                netuid=self.config.netuid,
                subtensor=self.subtensor,
                metagraph=self.metagraph,
            )
        except Exception as exc:
            bt.logging.warning(
                f"process_weights_for_netuid failed ({exc}); submitting raw weights."
            )
            processed_uids = uids_cpu
            processed_weights = raw_weights.to("cpu")

        bt.logging.info(
            f"set_weights | uids={processed_uids.tolist()} | "
            f"weights={[round(w, 4) for w in processed_weights.tolist()]}"
        )

        result, msg = self.subtensor.set_weights(
            wallet=self.wallet,
            netuid=self.config.netuid,
            uids=processed_uids,
            weights=processed_weights,
            wait_for_inclusion=False,
        )

        if result:
            bt.logging.success(f"Weights committed to chain at step {self.step}.")
        else:
            bt.logging.warning(f"set_weights failed: {msg}")
