"""Async twin of :class:`keygate.KeyGate`, for SQLAlchemy async engines.

Use it with ``sqlite+aiosqlite://`` or ``postgresql+asyncpg://`` URLs and an
async-capable rate-limit store (``async+memory://``, ``async+redis://``).
Tables are created lazily on first use (or call ``await gate.init()``).
"""

import asyncio
import math
import time
from datetime import datetime, timedelta
from typing import Any, Callable, Iterable, List, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from limits import RateLimitItem, RateLimitItemPerHour, RateLimitItemPerMinute
from limits.storage import storage_from_string
from limits.aio.strategies import MovingWindowRateLimiter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import StaticPool

from . import usage as _usage
from .keys import generate_key, parse_prefix, verify_key
from .models import ApiKeyRow, Base, UsageRow, utcnow
from .schemas import ApiKey, KeyCreated, UsageStats

_UNSET: Any = object()
_STATE_KEY = "keygate_key_id"


class AsyncKeyGate:
    """Same features and arguments as ``KeyGate``, but every operation is a coroutine.

    ``db_url`` must use an async driver and ``limits_uri`` an async store
    (``async+memory://`` default, or e.g. ``async+redis://host:6379``, which
    uses the ``redis`` package; pass ``limits_options`` to override).
    Usage rows are written immediately (no batching).
    """

    def __init__(
        self,
        app: Optional[FastAPI] = None,
        db_url: str = "sqlite+aiosqlite:///keygate.db",
        admin_secret: Optional[str] = None,
        limits_uri: str = "async+memory://",
        default_per_minute: Optional[int] = 60,
        default_per_hour: Optional[int] = None,
        header: str = "X-API-Key",
        limits_options: Optional[dict] = None,
    ) -> None:
        self.admin_secret = admin_secret
        self.default_per_minute = default_per_minute
        self.default_per_hour = default_per_hour
        self.header = header
        options = dict(limits_options or {})
        if limits_uri.startswith("async+redis"):
            # redis-py's asyncio client (same package as the sync extra); limits'
            # default, coredis, needs its own connection-pool lifecycle.
            options.setdefault("implementation", "redispy")
        self._limiter = MovingWindowRateLimiter(storage_from_string(limits_uri, **options))

        kwargs: dict = {}
        url = make_url(db_url)
        if url.get_backend_name() == "sqlite" and url.database in (None, "", ":memory:"):
            kwargs["poolclass"] = StaticPool
        self._engine = create_async_engine(db_url, **kwargs)
        self._sessions = async_sessionmaker(self._engine, expire_on_commit=False)
        self._ready = False
        self._hit_lock: Optional[asyncio.Lock] = None  # test-then-hit must be atomic in-process
        self._init_lock: Optional[asyncio.Lock] = None

        if app is not None:
            self.install(app)

    # -- setup ------------------------------------------------------------

    async def init(self) -> None:
        """Create tables (idempotent). Called automatically on first use."""
        if self._ready:
            return
        if self._init_lock is None:
            self._init_lock = asyncio.Lock()
        async with self._init_lock:
            if not self._ready:
                async with self._engine.begin() as conn:
                    await conn.run_sync(Base.metadata.create_all)
                self._ready = True

    def install(self, app: FastAPI) -> None:
        app.add_middleware(_AsyncUsageMiddleware, gate=self)
        if self.admin_secret:
            from .async_admin import build_router

            app.include_router(build_router(self))

    # -- the dependency ---------------------------------------------------

    async def require(self, request: Request, response: Response) -> ApiKey:
        """FastAPI dependency: authenticate, rate-limit, return the caller's key."""
        presented = self._extract(request)
        row = await self._lookup(presented) if presented else None
        if row is None:
            raise HTTPException(
                401, "Invalid or missing API key", headers={"WWW-Authenticate": "ApiKey"}
            )
        request.scope.setdefault("state", {})[_STATE_KEY] = row.id

        allowed, headers = await self._hit(row.id, row.per_minute, row.per_hour)
        if not allowed:
            raise HTTPException(429, "Rate limit exceeded", headers=headers)
        if headers:
            response.headers.update(headers)
        return ApiKey.model_validate(row)

    def require_scopes(self, *scopes: str) -> Callable[..., Any]:
        """Like ``require`` but the key must hold every scope (``"*"`` matches all)."""
        needed = set(scopes)

        async def dependency(key: ApiKey = Depends(self.require)) -> ApiKey:
            if not (needed <= set(key.scopes) or "*" in key.scopes):
                raise HTTPException(403, "API key lacks required scope")
            return key

        return dependency

    def _extract(self, request: Request) -> Optional[str]:
        value = request.headers.get(self.header)
        if value:
            return value.strip()
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return None

    async def _lookup(self, presented: str) -> Optional[ApiKeyRow]:
        prefix = parse_prefix(presented)
        if prefix is None:
            return None
        await self.init()
        async with self._sessions() as s:
            row = await s.scalar(select(ApiKeyRow).where(ApiKeyRow.prefix == prefix))
        if row is None or row.revoked_at is not None:
            return None
        if row.expires_at is not None and row.expires_at <= utcnow():
            return None
        return row if verify_key(presented, row.key_hash) else None

    # -- rate limiting ----------------------------------------------------

    async def _hit(
        self, key_id: int, per_minute: Optional[int], per_hour: Optional[int]
    ) -> Tuple[bool, Optional[dict]]:
        if self._hit_lock is None:
            self._hit_lock = asyncio.Lock()
        async with self._hit_lock:
            return await self._hit_locked(key_id, per_minute, per_hour)

    async def _hit_locked(
        self, key_id: int, per_minute: Optional[int], per_hour: Optional[int]
    ) -> Tuple[bool, Optional[dict]]:
        items: List[RateLimitItem] = []
        if per_minute:
            items.append(RateLimitItemPerMinute(per_minute))
        if per_hour:
            items.append(RateLimitItemPerHour(per_hour))
        if not items:
            return True, None
        ident = ("keygate", str(key_id))

        blocked = [i for i in items if not await self._limiter.test(i, *ident)]
        if blocked:
            stats = [await self._limiter.get_window_stats(i, *ident) for i in blocked]
            retry = max(1, math.ceil(max(s.reset_time for s in stats) - time.time()))
            return False, {
                "Retry-After": str(retry),
                "X-RateLimit-Limit": str(blocked[0].amount),
                "X-RateLimit-Remaining": "0",
            }
        for i in items:
            await self._limiter.hit(i, *ident)
        pairs = [(i, await self._limiter.get_window_stats(i, *ident)) for i in items]
        item, st = min(pairs, key=lambda p: p[1].remaining)
        return True, {
            "X-RateLimit-Limit": str(item.amount),
            "X-RateLimit-Remaining": str(st.remaining),
            "X-RateLimit-Reset": str(math.ceil(st.reset_time)),
        }

    # -- key management ---------------------------------------------------

    async def create_key(
        self,
        owner_id: str,
        name: Optional[str] = None,
        per_minute: Optional[int] = _UNSET,
        per_hour: Optional[int] = _UNSET,
        expires_at: Optional[datetime] = None,
        expires_in: Optional[timedelta] = None,
        scopes: Iterable[str] = (),
    ) -> KeyCreated:
        """Create a key; the plaintext is returned only here. See ``KeyGate.create_key``."""
        if expires_at is not None and expires_in is not None:
            raise ValueError("pass expires_at or expires_in, not both")
        if expires_in is not None:
            expires_at = utcnow() + expires_in
        scopes = list(scopes)
        if any(not s or s.split() != [s] for s in scopes):
            raise ValueError("scopes must be non-empty strings without whitespace")
        await self.init()
        key, prefix, key_hash = generate_key()
        row = ApiKeyRow(
            prefix=prefix,
            key_hash=key_hash,
            owner_id=owner_id,
            name=name,
            per_minute=self.default_per_minute if per_minute is _UNSET else per_minute,
            per_hour=self.default_per_hour if per_hour is _UNSET else per_hour,
            created_at=utcnow(),
            expires_at=expires_at,
            scopes=" ".join(dict.fromkeys(scopes)),
        )
        async with self._sessions() as s:
            s.add(row)
            await s.commit()
        return KeyCreated(**ApiKey.model_validate(row).model_dump(), key=key)

    async def list_keys(
        self, owner_id: Optional[str] = None, include_revoked: bool = False
    ) -> List[ApiKey]:
        await self.init()
        q = select(ApiKeyRow).order_by(ApiKeyRow.id)
        if owner_id is not None:
            q = q.where(ApiKeyRow.owner_id == owner_id)
        if not include_revoked:
            q = q.where(ApiKeyRow.revoked_at.is_(None))
        async with self._sessions() as s:
            return [ApiKey.model_validate(r) for r in await s.scalars(q)]

    async def revoke(self, key_id: int) -> bool:
        """Revoke a key. Returns False if it doesn't exist or was already revoked."""
        await self.init()
        async with self._sessions() as s:
            row = await s.get(ApiKeyRow, key_id)
            if row is None or row.revoked_at is not None:
                return False
            row.revoked_at = utcnow()
            await s.commit()
        return True

    async def rotate(
        self, key_id: int, grace: timedelta = timedelta(hours=24)
    ) -> Optional[KeyCreated]:
        """Issue a replacement for ``key_id``; the old key expires after ``grace``."""
        await self.init()
        now = utcnow()
        async with self._sessions() as s:
            old = await s.get(ApiKeyRow, key_id)
        if old is None or old.revoked_at is not None:
            return None
        if old.expires_at is not None and old.expires_at <= now:
            return None
        new = await self.create_key(
            old.owner_id,
            old.name,
            per_minute=old.per_minute,
            per_hour=old.per_hour,
            scopes=old.scopes.split(),
            expires_at=old.expires_at,
        )
        async with self._sessions() as s:
            row = await s.get(ApiKeyRow, key_id)
            cutoff = now + grace
            if row.expires_at is None or cutoff < row.expires_at:
                row.expires_at = cutoff
            await s.commit()
        return new

    # -- usage ------------------------------------------------------------

    async def usage(
        self, key_id: int, since: Optional[datetime] = None, last_hours: Optional[float] = None
    ) -> UsageStats:
        await self.init()
        if last_hours is not None:
            since = utcnow() - timedelta(hours=last_hours)
        async with self._sessions() as s:
            return await s.run_sync(lambda sync: _usage.get_stats(sync, key_id, since))

    async def prune_usage(self, older_than: timedelta = timedelta(days=90)) -> int:
        await self.init()
        before = utcnow() - older_than
        async with self._sessions() as s:
            return await s.run_sync(lambda sync: _usage.prune(sync, before))

    async def _log(self, key_id: int, method: str, path: str, status: int) -> None:
        await self.init()
        async with self._sessions() as s:
            s.add(UsageRow(key_id=key_id, ts=utcnow(), method=method, path=path, status=status))
            await s.commit()

    async def aclose(self) -> None:
        """Dispose of the engine's connections."""
        await self._engine.dispose()


class _AsyncUsageMiddleware:
    """Pure-ASGI middleware: records status for requests ``require`` identified."""

    def __init__(self, app: Callable, gate: AsyncKeyGate) -> None:
        self.app = app
        self.gate = gate

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        status = {"code": 500}

        async def send_wrapper(message: dict) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            key_id = scope.get("state", {}).get(_STATE_KEY)
            if key_id is not None:
                route = scope.get("route")
                path = getattr(route, "path", None) or scope["path"]
                try:
                    await self.gate._log(key_id, scope["method"], path, status["code"])
                except Exception:  # usage logging must never break a request
                    pass
