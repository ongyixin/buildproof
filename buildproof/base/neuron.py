from __future__ import annotations

import abc
import os

import bittensor as bt

from buildproof.utils.config import get_config


class BaseNeuron(abc.ABC):
    """
    Abstract base class for all BuildProoof neurons.

    Follows the official Bittensor subnet-template pattern:
      - Initialises wallet, subtensor, metagraph.
      - Asserts hotkey registration and resolves self.my_subnet_uid.
      - Exposes sync helpers used by both miner and validator loops.

    Concrete subclasses (BaseMinerNeuron, BaseValidatorNeuron) add transport
    layer setup (axon / dendrite) and implement the epoch loop.
    """

    neuron_type: str = "BaseNeuron"

    # ------------------------------------------------------------------
    # Class-level hooks (override in subclasses)
    # ------------------------------------------------------------------

    @classmethod
    def check_config(cls, config: bt.Config) -> None:
        """Validate config values. Raise on misconfiguration."""
        pass

    @classmethod
    def add_args(cls, parser) -> None:
        """Register additional argparse flags for this neuron type."""
        pass

    @abc.abstractmethod
    def forward(self, *args, **kwargs):
        """Main per-step logic implemented by concrete neuron subclasses."""
        ...

    # ------------------------------------------------------------------
    # Initialisation
    # ------------------------------------------------------------------

    def __init__(self, config: bt.Config = None):
        self.config = get_config(self.__class__)
        if config is not None:
            self.config.merge(config)
        self.check_config(self.config)

        bt.logging(config=self.config, logging_dir=self.config.full_path)
        bt.logging.info(
            f"Initialising {self.__class__.__name__} | "
            f"netuid={self.config.netuid} | "
            f"network={self.config.subtensor.network}"
        )

        self.wallet = bt.Wallet(config=self.config)
        bt.logging.info(f"Wallet: {self.wallet}")

        self.subtensor = bt.Subtensor(config=self.config)
        bt.logging.info(f"Subtensor: {self.subtensor}")

        self.metagraph = self.subtensor.metagraph(self.config.netuid)
        bt.logging.info(f"Metagraph: n={self.metagraph.n.item()} neurons")

        if self.wallet.hotkey.ss58_address not in self.metagraph.hotkeys:
            bt.logging.error(
                f"\nHotkey {self.wallet.hotkey.ss58_address} is NOT registered "
                f"on netuid {self.config.netuid}.\n"
                f"Register with:\n"
                f"  btcli subnet register "
                f"--netuid {self.config.netuid} "
                f"--wallet.name {self.config.wallet.name} "
                f"--wallet.hotkey {self.config.wallet.hotkey}"
            )
            exit(1)

        self.my_subnet_uid: int = self.metagraph.hotkeys.index(
            self.wallet.hotkey.ss58_address
        )
        bt.logging.info(f"Registered as UID {self.my_subnet_uid} on subnet.")

        self.step: int = 0

    # ------------------------------------------------------------------
    # Chain / metagraph helpers
    # ------------------------------------------------------------------

    @property
    def block(self) -> int:
        return self.subtensor.block

    def resync_metagraph(self) -> None:
        bt.logging.info("Resyncing metagraph…")
        self.metagraph.sync(subtensor=self.subtensor)
        bt.logging.info(f"Metagraph synced at block {self.metagraph.block.item()}")

    def should_sync_metagraph(self) -> bool:
        blocks_since_update = self.block - self.metagraph.last_update[self.my_subnet_uid]
        return blocks_since_update > self.config.neuron.epoch_length

    # ------------------------------------------------------------------
    # State persistence (override for non-trivial state)
    # ------------------------------------------------------------------

    def save_state(self) -> None:
        pass

    def load_state(self) -> None:
        pass
