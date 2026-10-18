from datetime import datetime, timedelta
from typing import Any, Callable, Iterable, List, Optional

from anyio import to_thread
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from . import usage as _usage
from .keys import generate_key, parse_prefix, verify_key
from .models import ApiKeyRow, Base, utcnow
from .ratelimit import RateLimiter
from .schemas import ApiKey, KeyCreated, UsageStats

_UNSET: Any = object()
_STATE_KEY = "keygate_key_id"


class KeyGate:
    """API-key auth, per-key rate limits and usage tracking for a FastAPI app.

    Args:
        app: Optional app. If given, usage logging is installed on it and, when
            ``admin_secret`` is set, the key-management router is mounted.
        db_url: Any SQLAlchemy URL. Defaults to a local SQLite file.
        admin_secret: Enables ``/keygate/*`` admin endpoints (header
            ``X-Admin-Secret``). Omit to manage keys from Python only.
        limits_uri: Rate-limit storage, e.g. ``"redis://host:6379"``. The
            default in-memory store is per-process.
        default_per_minute / default_per_hour: Limits given to new keys that
            don't specify their own. ``None`` means unlimited.
        header: Header carrying the key. ``Authorization: Bearer <key>`` is
            always accepted too.
    """

    def __init__(
        self,
        app: Optional[FastAPI] = None,
        db_url: str = "sqlite:///keygate.db",
        admin_secret: Optional[str] = None,
        limits_uri: str = "memory://",
        default_per_minute: Optional[int] = 60,
        default_per_hour: Optional[int] = None,
        header: str = "X-API-Key",
    ) -> None:
        self.admin_secret = admin_secret
        self.default_per_minute = default_per_minute
        self.default_per_hour = default_per_hour
        self.header = header
        self._limiter = RateLimiter(limits_uri)

        kwargs: dict = {}
        url = make_url(db_url)
        if url.get_backend_name() == "sqlite":
            kwargs["connect_args"] = {"check_same_thread": False}
            if url.database in (None, "", ":memory:"):
                kwargs["poolclass"] = StaticPool  # one shared in-memory DB
        self._engine = create_engine(db_url, **kwargs)
        self._sessions = sessionmaker(self._engine, expire_on_commit=False)
        Base.metadata.create_all(self._engine)
        self._add_missing_columns()

        if app is not None:
            self.install(app)

    def _add_missing_columns(self) -> None:
        """Upgrade tables created by an older version (``create_all`` won't alter them)."""
        table = ApiKeyRow.__tablename__
        cols = {c["name"] for c in inspect(self._engine).get_columns(table)}
        added = {
            "expires_at": "TIMESTAMP",
            "scopes": "VARCHAR(1024) NOT NULL DEFAULT ''",
        }
        with self._engine.begin() as conn:
            for name, ddl in added.items():
                if name not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))

    # -- wiring -----------------------------------------------------------

    def install(self, app: FastAPI) -> None:
        """Add usage logging (and the admin router, if enabled) to ``app``."""
        app.add_middleware(_UsageMiddleware, gate=self)
        if self.admin_secret:
            from .admin import build_router

            app.include_router(build_router(self))

    # -- the dependency ---------------------------------------------------

    def require(self, request: Request, response: Response) -> ApiKey:
        """FastAPI dependency: authenticate, rate-limit, return the caller's key.

        Raises 401 for a missing/invalid/revoked key and 429 when over limit.
        """
        presented = self._extract(request)
        row = self._lookup(presented) if presented else None
        if row is None:
            raise HTTPException(
                401, "Invalid or missing API key", headers={"WWW-Authenticate": "ApiKey"}
            )
        request.scope.setdefault("state", {})[_STATE_KEY] = row.id

        allowed, headers = self._limiter.hit(row.id, row.per_minute, row.per_hour)
        if not allowed:
            raise HTTPException(429, "Rate limit exceeded", headers=headers)
        if headers:
            response.headers.update(headers)
        return ApiKey.model_validate(row)

    def require_scopes(self, *scopes: str) -> Callable[..., ApiKey]:
        """Dependency factory: like ``require`` but the key must hold every scope.

        A key holding the ``"*"`` scope passes any check. Missing scope -> 403.
        """
        needed = set(scopes)

        def dependency(key: ApiKey = Depends(self.require)) -> ApiKey:
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

    def _lookup(self, presented: str) -> Optional[ApiKeyRow]:
        prefix = parse_prefix(presented)
        if prefix is None:
            return None
        with self._sessions() as s:
            row = s.scalar(select(ApiKeyRow).where(ApiKeyRow.prefix == prefix))
        if row is None or row.revoked_at is not None:
            return None
        if row.expires_at is not None and row.expires_at <= utcnow():
            return None
        return row if verify_key(presented, row.key_hash) else None

    # -- key management ---------------------------------------------------

    def create_key(
        self,
        owner_id: str,
        name: Optional[str] = None,
        per_minute: Optional[int] = _UNSET,
        per_hour: Optional[int] = _UNSET,
        expires_at: Optional[datetime] = None,
        expires_in: Optional[timedelta] = None,
        scopes: Iterable[str] = (),
    ) -> KeyCreated:
        """Create a key for ``owner_id``. The plaintext is returned only here.

        Omitted limits fall back to the gate defaults; pass ``None`` for unlimited.
        A key can expire at a naive-UTC ``expires_at`` or after ``expires_in``
        from now (not both); expired keys get a 401. Default: never expires.
        """
        if expires_at is not None and expires_in is not None:
            raise ValueError("pass expires_at or expires_in, not both")
        if expires_in is not None:
            expires_at = utcnow() + expires_in
        scopes = list(scopes)
        if any(not s or s.split() != [s] for s in scopes):
            raise ValueError("scopes must be non-empty strings without whitespace")
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
        with self._sessions() as s:
            s.add(row)
            s.commit()
        return KeyCreated(**ApiKey.model_validate(row).model_dump(), key=key)

    def list_keys(self, owner_id: Optional[str] = None, include_revoked: bool = False) -> List[ApiKey]:
        q = select(ApiKeyRow).order_by(ApiKeyRow.id)
        if owner_id is not None:
            q = q.where(ApiKeyRow.owner_id == owner_id)
        if not include_revoked:
            q = q.where(ApiKeyRow.revoked_at.is_(None))
        with self._sessions() as s:
            return [ApiKey.model_validate(r) for r in s.scalars(q)]

    def revoke(self, key_id: int) -> bool:
        """Revoke a key. Returns False if it doesn't exist or was already revoked."""
        with self._sessions() as s:
            row = s.get(ApiKeyRow, key_id)
            if row is None or row.revoked_at is not None:
                return False
            row.revoked_at = utcnow()
            s.commit()
        return True

    # -- usage ------------------------------------------------------------

    def usage(
        self, key_id: int, since: Optional[datetime] = None, last_hours: Optional[float] = None
    ) -> UsageStats:
        """Request counts for a key, by status and endpoint (UTC timestamps)."""
        if last_hours is not None:
            since = utcnow() - timedelta(hours=last_hours)
        with self._sessions() as s:
            return _usage.get_stats(s, key_id, since)

    def _log(self, key_id: int, method: str, path: str, status: int) -> None:
        with self._sessions() as s:
            _usage.log_request(s, key_id, method, path, status)


class _UsageMiddleware:
    """Pure-ASGI middleware: records status for requests ``require`` identified."""

    def __init__(self, app: Callable, gate: KeyGate) -> None:
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
                    await to_thread.run_sync(
                        self.gate._log, key_id, scope["method"], path, status["code"]
                    )
                except Exception:  # usage logging must never break a request
                    pass
