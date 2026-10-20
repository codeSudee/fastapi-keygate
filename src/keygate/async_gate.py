"""Async twin of :class:`keygate.KeyGate`, for SQLAlchemy async engines.

Use it with ``sqlite+aiosqlite://`` or ``postgresql+asyncpg://`` URLs and an
async-capable rate-limit store (``async+memory://``, ``async+redis://``).
Tables are created lazily on first use (or call ``await gate.init()``).
"""

import asyncio
import math
import time
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from limits import RateLimitItem, RateLimitItemPerHour, RateLimitItemPerMinute
from limits.storage import storage_from_string
from limits.aio.strategies import MovingWindowRateLimiter
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import StaticPool

from . import usage as _usage
from .keys import generate_key, parse_prefix, verify_key
from .models import ApiKeyRow, Base, OwnerRow, UsageRow, utcnow
from .plans import Plan, check_key_count, check_scopes, clamp_limit
from .schemas import ApiKey, KeyCreated, UsageStats

_UNSET: Any = object()
_STATE_KEY = "keygate_key_id"


class AsyncKeyGate:
    """Same features and arguments as ``KeyGate``, but every operation is a coroutine.

    ``db_url`` must use an async driver and ``limits_uri`` an async store
    (``async+memory://`` default, or e.g. ``async+redis://host:6379``, which
    uses the ``redis`` package; pass ``limits_options`` to override).
    Usage rows are written immediately (no batching).

    ``plans``/``default_plan`` work as in ``KeyGate``: opt-in per-owner caps.
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
        plans: Optional[Dict[str, Plan]] = None,
        default_plan: str = "free",
    ) -> None:
        if plans is not None and default_plan not in plans:
            raise ValueError(f"default_plan {default_plan!r} is not in plans")
        self.plans = plans
        self.default_plan = default_plan
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

        per_minute, per_hour = row.per_minute, row.per_hour
        if self.plans is not None:  # a downgrade must limit existing keys too
            plan = await self.get_plan(row.owner_id)
            per_minute = clamp_limit(per_minute, plan.key_per_minute)
            per_hour = clamp_limit(per_hour, plan.key_per_hour)

        allowed, headers = await self._hit(row.id, per_minute, per_hour)
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
        _rotating: bool = False,
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
        per_minute = self.default_per_minute if per_minute is _UNSET else per_minute
        per_hour = self.default_per_hour if per_hour is _UNSET else per_hour
        async with self._sessions() as s:
            plan = await self._plan_for(s, owner_id)
            if plan is not None:
                if not _rotating:  # the old key retires after its grace period
                    check_key_count(self.plans, plan, await self._active_count(s, owner_id))
                check_scopes(self.plans, plan, scopes)
                per_minute = clamp_limit(per_minute, plan.key_per_minute)
                per_hour = clamp_limit(per_hour, plan.key_per_hour)
            key, prefix, key_hash = generate_key()
            row = ApiKeyRow(
                prefix=prefix,
                key_hash=key_hash,
                owner_id=owner_id,
                name=name,
                per_minute=per_minute,
                per_hour=per_hour,
                created_at=utcnow(),
                expires_at=expires_at,
                scopes=" ".join(dict.fromkeys(scopes)),
            )
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

    async def get_key(self, key_id: int) -> Optional[ApiKey]:
        await self.init()
        async with self._sessions() as s:
            row = await s.get(ApiKeyRow, key_id)
            return ApiKey.model_validate(row) if row is not None else None

    async def update_key(
        self,
        key_id: int,
        name: Any = _UNSET,
        per_minute: Any = _UNSET,
        per_hour: Any = _UNSET,
        scopes: Any = _UNSET,
        expires_at: Any = _UNSET,
    ) -> Optional[ApiKey]:
        """Change a live key; omitted fields are kept. See ``KeyGate.update_key``."""
        if scopes is not _UNSET:
            scopes = list(scopes)
            if any(not x or x.split() != [x] for x in scopes):
                raise ValueError("scopes must be non-empty strings without whitespace")
        await self.init()
        async with self._sessions() as s:
            row = await s.get(ApiKeyRow, key_id)
            if row is None or row.revoked_at is not None:
                return None
            plan = await self._plan_for(s, row.owner_id)
            if plan is not None:
                if per_minute is not _UNSET and per_minute != row.per_minute:
                    per_minute = clamp_limit(per_minute, plan.key_per_minute)
                if per_hour is not _UNSET and per_hour != row.per_hour:
                    per_hour = clamp_limit(per_hour, plan.key_per_hour)
                if scopes is not _UNSET and list(dict.fromkeys(scopes)) != row.scopes.split():
                    check_scopes(self.plans, plan, scopes)
            if name is not _UNSET:
                row.name = name
            if per_minute is not _UNSET:
                row.per_minute = per_minute
            if per_hour is not _UNSET:
                row.per_hour = per_hour
            if scopes is not _UNSET:
                row.scopes = " ".join(dict.fromkeys(scopes))
            if expires_at is not _UNSET:
                row.expires_at = expires_at
            await s.commit()
            return ApiKey.model_validate(row)

    async def rate_status(self, key: ApiKey) -> List[dict]:
        """Read-only view of a key's live rate-limit windows (consumes nothing)."""
        ident = ("keygate", str(key.id))
        out = []
        for limit, window, item in (
            (key.per_minute, "minute", RateLimitItemPerMinute(key.per_minute) if key.per_minute else None),
            (key.per_hour, "hour", RateLimitItemPerHour(key.per_hour) if key.per_hour else None),
        ):
            if item is None:
                continue
            st = await self._limiter.get_window_stats(item, *ident)
            out.append(
                {"window": window, "limit": limit, "remaining": max(0, st.remaining), "reset_time": math.ceil(st.reset_time)}
            )
        return out

    # -- plans ------------------------------------------------------------

    async def _plan_for(self, s: AsyncSession, owner_id: str) -> Optional[Plan]:
        if self.plans is None:
            return None
        row = await s.get(OwnerRow, owner_id)
        # an id that's no longer in the catalog falls back to the default plan
        return self.plans.get(row.plan if row else self.default_plan, self.plans[self.default_plan])

    async def _active_count(self, s: AsyncSession, owner_id: str) -> int:
        now = utcnow()
        return await s.scalar(
            select(func.count())
            .select_from(ApiKeyRow)
            .where(
                ApiKeyRow.owner_id == owner_id,
                ApiKeyRow.revoked_at.is_(None),
                or_(ApiKeyRow.expires_at.is_(None), ApiKeyRow.expires_at > now),
            )
        )

    async def get_plan(self, owner_id: str) -> Optional[Plan]:
        """The owner's plan, or ``None`` when plans are not enabled."""
        await self.init()
        async with self._sessions() as s:
            return await self._plan_for(s, owner_id)

    async def set_plan(
        self,
        owner_id: str,
        plan_id: str,
        billing_ref: Any = _UNSET,
        billing_status: Any = _UNSET,
    ) -> Plan:
        """Put an owner on ``plan_id``. Existing keys are never revoked or rewritten."""
        if self.plans is None:
            raise ValueError("plans are not enabled; pass AsyncKeyGate(plans=...)")
        if plan_id not in self.plans:
            raise ValueError(f"unknown plan {plan_id!r}")
        await self.init()
        now = utcnow()
        async with self._sessions() as s:
            row = await s.get(OwnerRow, owner_id)
            if row is None:
                row = OwnerRow(owner_id=owner_id, plan=plan_id, plan_changed_at=now, created_at=now)
                s.add(row)
            elif row.plan != plan_id:
                row.plan, row.plan_changed_at = plan_id, now
            if billing_ref is not _UNSET:
                row.billing_ref = billing_ref
            if billing_status is not _UNSET:
                row.billing_status = billing_status
            await s.commit()
        return self.plans[plan_id]

    async def active_key_count(self, owner_id: str) -> int:
        await self.init()
        async with self._sessions() as s:
            return await self._active_count(s, owner_id)

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
            _rotating=True,
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
