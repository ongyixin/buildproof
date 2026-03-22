#!/usr/bin/env python3
"""
BuildProof miner neuron entry point.

Usage:
    python neurons/miner.py \
        --netuid 1 \
        --subtensor.network local \
        --wallet.name miner \
        --wallet.hotkey default \
        --miner.strategy rubric_scorer   # or diligence_generator | risk_detector

The --miner.strategy flag selects which evaluation strategy module is loaded
from miners/. Each strategy produces a different task_type output:
  rubric_scorer       → ScoreVector (normalised dimension scores)
  diligence_generator → DiligenceQuestions (questions, missing evidence)
  risk_detector       → RiskAssessment (fraud flags, manipulation indicators)
"""
import argparse
import importlib
import time

import bittensor as bt

from buildproof.base.miner import BaseMinerNeuron
from buildproof.protocol import DiligenceSynapse


STRATEGY_CHOICES = ["rubric_scorer", "diligence_generator", "risk_detector"]


class Miner(BaseMinerNeuron):
    """
    Concrete miner neuron.

    Loads a strategy at startup, then delegates every forward() call to it.
    Each strategy fills only the synapse fields matching its task_type.
    """

    @classmethod
    def add_args(cls, parser: argparse.ArgumentParser) -> None:
        parser.add_argument(
            "--miner.strategy",
            type=str,
            default="rubric_scorer",
            choices=STRATEGY_CHOICES,
            help="Which evaluation strategy this miner instance runs.",
        )

    def __init__(self, config: bt.Config = None):
        super().__init__(config)

        strategy_name: str = self.config.miner.strategy
        try:
            module = importlib.import_module(f"miners.{strategy_name}")
            strategy_cls = getattr(module, "Strategy")
        except (ModuleNotFoundError, AttributeError) as exc:
            bt.logging.error(
                f"Failed to load strategy '{strategy_name}': {exc}\n"
                "Make sure miners/{strategy_name}.py defines a Strategy class."
            )
            raise

        self.strategy = strategy_cls()
        bt.logging.info(f"Loaded strategy: {strategy_name}")

    def forward(self, synapse: DiligenceSynapse) -> DiligenceSynapse:
        """
        Receive a DiligenceSynapse from the validator, run the selected
        strategy, and return the populated synapse with typed response fields.
        """
        t0 = time.time()

        try:
            result = self.strategy.evaluate(
                proposal_id=synapse.proposal_id,
                proposal_text=synapse.proposal_text,
                program_mandate=synapse.program_mandate,
            )

            synapse.score_vector = result.score_vector
            synapse.diligence_questions = result.diligence_questions
            synapse.risk_assessment = result.risk_assessment
            synapse.estimated_cost_usd = result.estimated_cost_usd
            synapse.backend = result.backend

        except Exception as exc:
            bt.logging.error(
                f"Strategy.evaluate() raised for proposal "
                f"{synapse.proposal_id}: {exc}"
            )

        synapse.latency_ms = (time.time() - t0) * 1000
        bt.logging.debug(
            f"forward: proposal={synapse.proposal_id} | "
            f"task_type={synapse.task_type} | "
            f"latency={synapse.latency_ms:.0f} ms | "
            f"backend={synapse.backend}"
        )
        return synapse


if __name__ == "__main__":
    miner = Miner()
    miner.run()
