"""
Feature flags for miner runtime behavior.
"""

from __future__ import annotations

import os


def external_api_calls_enabled() -> bool:
    """
    Global toggle for outbound LLM provider calls (OpenAI/Anthropic).

    Defaults to enabled for backward compatibility.
    Set ENABLE_EXTERNAL_API_CALLS=false to force fallback/mock behavior.
    """
    raw = os.environ.get("ENABLE_EXTERNAL_API_CALLS", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}

