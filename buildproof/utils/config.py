from __future__ import annotations

import os
import argparse

import bittensor as bt


def add_common_args(parser: argparse.ArgumentParser) -> None:
    """Arguments shared by all BuildProof neurons."""
    parser.add_argument(
        "--netuid",
        type=int,
        default=1,
        help="Subnet netuid on the local or remote chain.",
    )
    parser.add_argument(
        "--neuron.epoch_length",
        type=int,
        default=100,
        help="Blocks between metagraph resyncs and weight-set attempts.",
    )
    parser.add_argument(
        "--neuron.moving_average_alpha",
        type=float,
        default=0.1,
        help="EMA alpha for per-UID score smoothing (0 = no update, 1 = replace).",
    )
    parser.add_argument(
        "--neuron.sample_size",
        type=int,
        default=8,
        help="Max number of miners queried per validator epoch.",
    )
    parser.add_argument(
        "--neuron.timeout",
        type=float,
        default=30.0,
        help="Dendrite query timeout in seconds.",
    )
    parser.add_argument(
        "--neuron.benchmarks_dir",
        type=str,
        default="benchmarks",
        help="Path to the benchmarks/ directory containing gold_labels.json and adversarial.json.",
    )


def get_config(cls) -> bt.Config:
    """
    Build a bt.Config for the given neuron class.

    Follows the official Bittensor subnet template pattern:
      - adds bt.Wallet / bt.Subtensor / bt.logging / bt.Axon arg groups
      - adds BuildProof-specific common args
      - calls cls.add_args() for class-specific flags
      - resolves the logging full_path
    """
    parser = argparse.ArgumentParser()
    bt.Wallet.add_args(parser)
    bt.Subtensor.add_args(parser)
    bt.logging.add_args(parser)
    bt.Axon.add_args(parser)
    add_common_args(parser)

    if hasattr(cls, "add_args"):
        cls.add_args(parser)

    config = bt.Config(parser)

    neuron_label = "validator" if "validator" in cls.__name__.lower() else "miner"
    config.full_path = os.path.expanduser(
        f"{config.logging.logging_dir}/"
        f"{config.wallet.name}/{config.wallet.hotkey}/"
        f"netuid{config.netuid}/{neuron_label}"
    )
    os.makedirs(config.full_path, exist_ok=True)
    return config
