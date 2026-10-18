"""keygate: API-key auth, per-key rate limiting and usage tracking for FastAPI."""

from .gate import KeyGate
from .schemas import ApiKey, KeyCreated, UsageStats

__all__ = ["KeyGate", "ApiKey", "KeyCreated", "UsageStats"]
__version__ = "0.1.0"
