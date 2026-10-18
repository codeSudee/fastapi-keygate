"""Thin wrapper over `limits` (the engine slowapi is built on)."""

import math
import time
from typing import List, Optional, Tuple

from limits import RateLimitItem, RateLimitItemPerHour, RateLimitItemPerMinute
from limits.storage import storage_from_string
from limits.strategies import MovingWindowRateLimiter


class RateLimiter:
    def __init__(self, uri: str = "memory://") -> None:
        self._limiter = MovingWindowRateLimiter(storage_from_string(uri))

    @staticmethod
    def _items(per_minute: Optional[int], per_hour: Optional[int]) -> List[RateLimitItem]:
        items: List[RateLimitItem] = []
        if per_minute:
            items.append(RateLimitItemPerMinute(per_minute))
        if per_hour:
            items.append(RateLimitItemPerHour(per_hour))
        return items

    def hit(
        self, key_id: int, per_minute: Optional[int], per_hour: Optional[int]
    ) -> Tuple[bool, Optional[dict]]:
        """Consume one request from every configured limit.

        Returns ``(allowed, headers)``. Nothing is consumed unless all limits
        have room, so a blocked hour limit doesn't burn minute quota.
        ``headers`` carries X-RateLimit-* for the tightest limit, plus
        Retry-After when blocked. ``None`` when the key is unlimited.
        """
        items = self._items(per_minute, per_hour)
        if not items:
            return True, None
        ident = ("keygate", str(key_id))

        blocked = [i for i in items if not self._limiter.test(i, *ident)]
        if blocked:
            worst = max(
                (self._limiter.get_window_stats(i, *ident) for i in blocked),
                key=lambda s: s.reset_time,
            )
            retry = max(1, math.ceil(worst.reset_time - time.time()))
            tight = blocked[0]
            return False, {
                "Retry-After": str(retry),
                "X-RateLimit-Limit": str(tight.amount),
                "X-RateLimit-Remaining": "0",
            }

        for i in items:
            self._limiter.hit(i, *ident)
        stats = [(i, self._limiter.get_window_stats(i, *ident)) for i in items]
        item, st = min(stats, key=lambda p: p[1].remaining)
        return True, {
            "X-RateLimit-Limit": str(item.amount),
            "X-RateLimit-Remaining": str(st.remaining),
            "X-RateLimit-Reset": str(math.ceil(st.reset_time)),
        }
