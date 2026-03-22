import abc
import threading
import time
from typing import Tuple

import bittensor as bt

from buildproof.base.neuron import BaseNeuron
from buildproof.protocol import DiligenceSynapse


class BaseMinerNeuron(BaseNeuron):
    """
    Miner base class.

    Lifecycle:
      1. __init__: creates axon, attaches forward / blacklist / priority handlers.
      2. run(): serves axon on chain, then blocks while a background thread
         handles periodic metagraph resyncs.
      3. forward(): implemented by the concrete Miner in neurons/miner.py.

    The blacklist and priority implementations here are safe defaults.
    Override in a concrete subclass for finer-grained control.
    """

    neuron_type: str = "MinerNeuron"

    def __init__(self, config: bt.Config = None):
        super().__init__(config)

        self.axon = bt.Axon(wallet=self.wallet, config=self.config)
        bt.logging.info(f"Axon created: {self.axon}")

        self.axon.attach(
            forward_fn=self.forward,
            blacklist_fn=self.blacklist,
            priority_fn=self.priority,
        )

        self._is_running: bool = False
        self._bg_thread: threading.Thread | None = None

        # Precomputed hotkey→uid index for O(1) lookups in blacklist/priority.
        # Rebuilt whenever the metagraph is resynced.
        self._hotkey_uid_map: dict[str, int] = self._build_hotkey_uid_map()

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        if not self.subtensor.is_hotkey_registered(
            netuid=self.config.netuid,
            hotkey_ss58=self.wallet.hotkey.ss58_address,
        ):
            bt.logging.error("Hotkey not registered — cannot serve axon. Exiting.")
            exit(1)

        self.axon.serve(netuid=self.config.netuid, subtensor=self.subtensor)
        self.axon.start()
        bt.logging.info(
            f"Miner running | axon={self.axon} | netuid={self.config.netuid}"
        )

        self._is_running = True
        self._bg_thread = threading.Thread(
            target=self._background_loop, daemon=True, name="miner-bg"
        )
        self._bg_thread.start()

        try:
            while True:
                time.sleep(12)
        except KeyboardInterrupt:
            self.stop()

    def _build_hotkey_uid_map(self) -> dict[str, int]:
        """Return a hotkey→uid dict from the current metagraph snapshot."""
        return {hk: uid for uid, hk in enumerate(self.metagraph.hotkeys)}

    def resync_metagraph(self) -> None:
        """Sync metagraph and rebuild the hotkey→uid lookup cache."""
        super().resync_metagraph()
        self._hotkey_uid_map = self._build_hotkey_uid_map()

    def _background_loop(self) -> None:
        """Periodically resync metagraph while the axon serves requests."""
        while self._is_running:
            try:
                if self.should_sync_metagraph():
                    self.resync_metagraph()
            except Exception as exc:
                bt.logging.warning(f"Metagraph resync error: {exc}")
            time.sleep(12)

    def stop(self) -> None:
        self._is_running = False
        self.axon.stop()
        bt.logging.info("Miner stopped.")

    # ------------------------------------------------------------------
    # Axon handlers  (forward implemented by concrete class)
    # ------------------------------------------------------------------

    @abc.abstractmethod
    def forward(self, synapse: DiligenceSynapse) -> DiligenceSynapse:
        """Evaluate the proposal and populate synapse.evaluation + latency_ms."""
        ...

    def blacklist(self, synapse: DiligenceSynapse) -> Tuple[bool, str]:
        """
        Reject requests from callers not registered in the metagraph or
        without a validator permit.

        Returns (should_blacklist: bool, reason: str).
        """
        hotkey = synapse.dendrite.hotkey
        caller_uid = self._hotkey_uid_map.get(hotkey)
        if caller_uid is None:
            return True, f"Caller hotkey {hotkey} not found in metagraph."

        if not self.metagraph.validator_permit[caller_uid]:
            return True, f"Caller uid={caller_uid} does not hold a validator permit."

        return False, "OK"

    def priority(self, synapse: DiligenceSynapse) -> float:
        """
        Assign queue priority proportional to caller stake.
        Higher stake validators are served first.
        """
        hotkey = synapse.dendrite.hotkey
        caller_uid = self._hotkey_uid_map.get(hotkey)
        if caller_uid is None:
            return 0.0
        return float(self.metagraph.S[caller_uid])
