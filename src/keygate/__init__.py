"""keygate: API-key auth, per-key rate limiting and usage tracking for FastAPI."""

from importlib.metadata import PackageNotFoundError, version
from typing import TYPE_CHECKING, Any

from .gate import KeyGate
from .schemas import ApiKey, KeyCreated, UsageStats

if TYPE_CHECKING:
    from .async_gate import AsyncKeyGate

try:
    __version__ = version("fastapi-keygate")
except PackageNotFoundError:  # running from a source tree without install
    __version__ = "0+unknown"

__all__ = ["KeyGate", "AsyncKeyGate", "ApiKey", "KeyCreated", "UsageStats"]


def __getattr__(name: str) -> Any:
    # Lazy: the async gate needs the optional `sqlalchemy[asyncio]` extra (greenlet).
    if name == "AsyncKeyGate":
        from .async_gate import AsyncKeyGate

        return AsyncKeyGate
    raise AttributeError(f"module 'keygate' has no attribute {name!r}")
