"""REST API (and optional static UI) behind the Keygate web dashboard.

Everything here reads and writes through an existing ``KeyGate``: keys come from
``list_keys``/``create_key``/``update_key``/``revoke``/``rotate``, usage from the
``keygate_usage`` table the gate already fills, and live limits from the rate
limiter. No tables are added.

    gate = KeyGate(app, admin_secret="...")
    mount_dashboard(app, gate)        # API at /keygate/dashboard/api, UI at /keygate/dashboard

Users sign in with the gate's ``admin_secret`` and receive a short-lived signed
token (HMAC-SHA256 keyed by the secret), so the secret itself is not kept in the browser.
"""

import base64
import hashlib
import hmac
import json
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, case, cast, func, select

from .models import ApiKeyRow, UsageRow, utcnow
from .plans import PlanLimitError
from .schemas import ApiKey

TOKEN_TTL = 12 * 3600
STATIC_DIR = Path(__file__).parent / "dashboard_static"

# range -> (window, bucket seconds)
RANGES: Dict[str, Tuple[timedelta, int]] = {
    "1h": (timedelta(hours=1), 60),
    "24h": (timedelta(hours=24), 3600),
    "7d": (timedelta(days=7), 6 * 3600),
    "30d": (timedelta(days=30), 24 * 3600),
}


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


def _epoch(dt: datetime) -> int:
    return int((dt - datetime(1970, 1, 1)).total_seconds())


# -- tokens ----------------------------------------------------------------


def _sign(secret: str, payload: bytes) -> str:
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def make_token(secret: str, ttl: int = TOKEN_TTL) -> Tuple[str, int]:
    exp = int(time.time()) + ttl
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode())
    return f"{payload.decode()}.{_sign(secret, payload)}", exp


def check_token(secret: str, token: str) -> bool:
    try:
        payload, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(secret, payload.encode())):
            return False
        return json.loads(base64.urlsafe_b64decode(payload))["exp"] > time.time()
    except Exception:
        return False


class _LoginThrottle:
    """Small in-memory brute-force guard: N failures per client per window."""

    def __init__(self, limit: int = 8, window: int = 60) -> None:
        self.limit, self.window = limit, window
        self._fails: Dict[str, Deque[float]] = defaultdict(deque)

    def blocked(self, who: str) -> Optional[int]:
        q, now = self._fails[who], time.time()
        while q and q[0] < now - self.window:
            q.popleft()
        return max(1, int(q[0] + self.window - now)) if len(q) >= self.limit else None

    def fail(self, who: str) -> None:
        self._fails[who].append(time.time())


# -- request bodies ----------------------------------------------------------


class Login(BaseModel):
    secret: str


class CreateKey(BaseModel):
    owner_id: str = Field(min_length=1, max_length=255)
    name: Optional[str] = Field(default=None, max_length=255)
    per_minute: Optional[int] = Field(default=None, ge=1)
    per_hour: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[datetime] = None
    scopes: List[str] = []


class PatchKey(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    per_minute: Optional[int] = Field(default=None, ge=1)
    per_hour: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[datetime] = None
    scopes: Optional[List[str]] = None


class SetPlan(BaseModel):
    owner_id: str = Field(min_length=1, max_length=255)
    plan: str


class Settings(BaseModel):
    default_per_minute: Optional[int] = Field(default=None, ge=1)
    default_per_hour: Optional[int] = Field(default=None, ge=1)


# -- usage queries -----------------------------------------------------------


def _category():
    return case(
        (UsageRow.status == 429, "limited"),
        (UsageRow.status >= 400, "errors"),
        else_="ok",
    )


def _epoch_expr(dialect: str):
    if dialect == "sqlite":
        return cast(func.strftime("%s", UsageRow.ts), BigInteger)
    if dialect == "postgresql":
        return cast(func.extract("epoch", UsageRow.ts), BigInteger)
    return None


def _blank(n: int) -> List[Dict[str, int]]:
    return [{"ok": 0, "errors": 0, "limited": 0} for _ in range(n)]


def _bucketed(
    s, since: datetime, step: int, n: int, key_id: Optional[int] = None, per_key: bool = False
) -> Dict[Optional[int], List[Dict[str, int]]]:
    """Request counts per time bucket (and category), optionally split by key."""
    base = _epoch(since)
    out: Dict[Optional[int], List[Dict[str, int]]] = defaultdict(lambda: _blank(n))
    cond = [UsageRow.ts >= since]
    if key_id is not None:
        cond.append(UsageRow.key_id == key_id)

    def put(k, b, cat, c):
        if 0 <= b < n:
            out[k][b][cat] += c

    expr = _epoch_expr(s.get_bind().dialect.name)
    cat = _category()
    if expr is not None:
        bucket = ((expr - base) // step).label("b")
        cols = [bucket, cat.label("c"), func.count().label("n")]
        group = [bucket, cat]
        if per_key:
            cols.insert(0, UsageRow.key_id)
            group.insert(0, UsageRow.key_id)
        for row in s.execute(select(*cols).where(*cond).group_by(*group)):
            *k, b, c, count = row
            put(k[0] if per_key else None, int(b), c, count)
    else:  # other databases: bucket in Python
        for kid, ts, status in s.execute(
            select(UsageRow.key_id, UsageRow.ts, UsageRow.status).where(*cond)
        ):
            c = "limited" if status == 429 else "errors" if status >= 400 else "ok"
            put(kid if per_key else None, (_epoch(ts) - base) // step, c, 1)
    return out


def _points(since: datetime, step: int, buckets: List[Dict[str, int]]) -> List[dict]:
    return [
        {"t": _iso(since + timedelta(seconds=i * step)), **b} for i, b in enumerate(buckets)
    ]


def _window(rng: str) -> Tuple[datetime, int, int]:
    if rng not in RANGES:
        raise HTTPException(422, f"range must be one of {', '.join(RANGES)}")
    span, step = RANGES[rng]
    n = int(span.total_seconds() // step)
    # Align to the bucket grid; the last bucket is the (partial) one containing "now".
    now = _epoch(utcnow())
    end = (now // step + 1) * step
    return datetime(1970, 1, 1) + timedelta(seconds=end - n * step), step, n


def _key_state(k: ApiKey) -> str:
    if k.revoked_at is not None:
        return "revoked"
    if k.expires_at is not None and k.expires_at <= utcnow():
        return "expired"
    return "active"


def _totals(buckets: List[Dict[str, int]]) -> Dict[str, int]:
    ok = sum(b["ok"] for b in buckets)
    err = sum(b["errors"] for b in buckets)
    lim = sum(b["limited"] for b in buckets)
    return {"total": ok + err + lim, "ok": ok, "errors": err, "limited": lim}


def build_router(gate) -> APIRouter:
    throttle = _LoginThrottle()
    router = APIRouter(prefix="/keygate/dashboard/api", tags=["keygate-dashboard"])

    def auth(authorization: str = Header(default="")) -> None:
        token = authorization[7:] if authorization.lower().startswith("bearer ") else ""
        if not token or not check_token(gate.admin_secret, token):
            raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})

    guarded = APIRouter(dependencies=[Depends(auth)])

    @router.post("/login")
    def login(body: Login, request: Request) -> dict:
        who = request.client.host if request.client else "?"
        wait = throttle.blocked(who)
        if wait:
            raise HTTPException(429, "Too many attempts", headers={"Retry-After": str(wait)})
        if not hmac.compare_digest(body.secret.encode(), gate.admin_secret.encode()):
            throttle.fail(who)
            raise HTTPException(401, "That secret doesn't match")
        token, exp = make_token(gate.admin_secret)
        return {"token": token, "expires_at": exp}

    def serialize(k: ApiKey) -> dict:
        d = k.model_dump()
        for f in ("created_at", "revoked_at", "expires_at"):
            d[f] = _iso(d[f])
        d["state"] = _key_state(k)
        return d

    def rate(k: ApiKey) -> List[dict]:
        return gate.rate_status(k) if _key_state(k) == "active" else []

    def key_or_404(key_id: int) -> ApiKey:
        k = gate.get_key(key_id)
        if k is None:
            raise HTTPException(404, "Key not found")
        return k

    @guarded.get("/overview")
    def overview(range: str = "24h") -> dict:
        since, step, n = _window(range)
        prev_since = since - (RANGES[range][0])
        gate.flush_usage()
        keys = gate.list_keys(include_revoked=True)
        by_id = {k.id: k for k in keys}
        with gate._sessions() as s:
            cur = _bucketed(s, since, step, n).get(None, _blank(n))
            prev_total = s.scalar(
                select(func.count())
                .select_from(UsageRow)
                .where(UsageRow.ts >= prev_since, UsageRow.ts < since)
            ) or 0
            per_key = s.execute(
                select(UsageRow.key_id, func.count())
                .where(UsageRow.ts >= since)
                .group_by(UsageRow.key_id)
                .order_by(func.count().desc())
                .limit(5)
            ).all()
            endpoints = s.execute(
                select(UsageRow.method, UsageRow.path, func.count())
                .where(UsageRow.ts >= since)
                .group_by(UsageRow.method, UsageRow.path)
                .order_by(func.count().desc())
                .limit(6)
            ).all()
        totals = _totals(cur)
        active = [k for k in keys if _key_state(k) == "active"]
        limited_now = sum(
            1 for k in active for r in rate(k) if r["remaining"] == 0
        )
        return {
            "range": range,
            "totals": totals,
            "previous_total": prev_total,
            "error_rate": (totals["errors"] + totals["limited"]) / totals["total"]
            if totals["total"]
            else 0,
            "active_keys": len(active),
            "total_keys": len(keys),
            "keys_at_limit": limited_now,
            "series": _points(since, step, cur),
            "top_keys": [
                {
                    "id": kid,
                    "name": by_id[kid].name or f"kg_{by_id[kid].prefix}" if kid in by_id else "deleted",
                    "prefix": by_id[kid].prefix if kid in by_id else "",
                    "calls": c,
                }
                for kid, c in per_key
            ],
            "top_endpoints": [
                {"method": m, "path": p, "calls": c} for m, p, c in endpoints
            ],
        }

    @guarded.get("/keys")
    def keys(range: str = "7d", include_revoked: bool = True) -> dict:
        since, step, n = _window(range)
        gate.flush_usage()
        rows = gate.list_keys(include_revoked=include_revoked)
        with gate._sessions() as s:
            series = _bucketed(s, since, step, n, per_key=True)
            last = dict(
                s.execute(
                    select(UsageRow.key_id, func.max(UsageRow.ts)).group_by(UsageRow.key_id)
                ).all()
            )
        items = []
        for k in rows:
            b = series.get(k.id, _blank(n))
            items.append(
                {
                    **serialize(k),
                    "usage": _totals(b),
                    "spark": [x["ok"] + x["errors"] + x["limited"] for x in b],
                    "last_used": _iso(last.get(k.id)),
                    "rate": rate(k),
                }
            )
        return {"range": range, "keys": items, "defaults": _defaults()}

    @guarded.post("/keys", status_code=201)
    def create(body: CreateKey) -> dict:
        limits = {
            f: getattr(body, f) for f in ("per_minute", "per_hour") if f in body.model_fields_set
        }
        try:
            created = gate.create_key(
                body.owner_id, body.name, expires_at=body.expires_at, scopes=body.scopes, **limits
            )
        except PlanLimitError as e:
            return JSONResponse(e.payload(), status_code=402)
        except ValueError as e:
            raise HTTPException(422, str(e))
        return {**serialize(created), "key": created.key}

    @guarded.patch("/keys/{key_id}")
    def patch(key_id: int, body: PatchKey) -> dict:
        changes = {f: getattr(body, f) for f in body.model_fields_set}
        try:
            updated = gate.update_key(key_id, **changes)
        except PlanLimitError as e:
            return JSONResponse(e.payload(), status_code=402)
        except ValueError as e:
            raise HTTPException(422, str(e))
        if updated is None:
            raise HTTPException(404, "Key not found or revoked")
        return serialize(updated)

    @guarded.delete("/keys/{key_id}", status_code=204)
    def revoke(key_id: int) -> None:
        if not gate.revoke(key_id):
            raise HTTPException(404, "Key not found or already revoked")

    @guarded.post("/keys/{key_id}/rotate", status_code=201)
    def rotate(key_id: int, grace_hours: float = 24) -> dict:
        new = gate.rotate(key_id, timedelta(hours=grace_hours))
        if new is None:
            raise HTTPException(404, "Key not found, revoked or expired")
        return {**serialize(new), "key": new.key}

    @guarded.get("/keys/{key_id}/usage")
    def key_usage(key_id: int, range: str = "24h") -> dict:
        k = key_or_404(key_id)
        since, step, n = _window(range)
        stats = gate.usage(key_id, since)
        with gate._sessions() as s:
            series = _bucketed(s, since, step, n, key_id=key_id).get(None, _blank(n))
        return {
            "key": serialize(k),
            "range": range,
            "totals": _totals(series),
            "series": _points(since, step, series),
            "by_status": {str(c): n_ for c, n_ in sorted(stats.by_status.items())},
            "by_endpoint": [
                {"endpoint": e, "calls": c}
                for e, c in sorted(stats.by_endpoint.items(), key=lambda p: -p[1])[:8]
            ],
            "first_request": _iso(stats.first_request),
            "last_request": _iso(stats.last_request),
            "rate": rate(k),
        }

    def plan_json(p) -> dict:
        d = {k: getattr(p, k) for k in ("id", "name", "max_keys", "key_per_minute", "key_per_hour", "max_scopes", "wildcard_scope")}
        return {**d, "price": p.price}

    def plans_on():
        if gate.plans is None:
            raise HTTPException(404, "Plans are not enabled on this server")

    @guarded.get("/plans")
    def plans() -> dict:
        if gate.plans is None:
            return {"enabled": False, "plans": [], "default": None}
        return {"enabled": True, "plans": [plan_json(p) for p in gate.plans.values()], "default": gate.default_plan}

    @guarded.get("/plan")
    def get_plan(owner_id: str) -> dict:
        plans_on()
        plan = gate.get_plan(owner_id)
        active = gate.active_key_count(owner_id)
        return {
            "owner_id": owner_id,
            "plan": plan_json(plan),
            "usage": {"active_keys": active},
            "can_create_key": plan.max_keys is None or active < plan.max_keys,
        }

    @guarded.put("/plan")
    def put_plan(body: SetPlan) -> dict:
        plans_on()
        try:
            gate.set_plan(body.owner_id, body.plan)
        except ValueError as e:
            raise HTTPException(422, str(e))
        return get_plan(body.owner_id)

    def _defaults() -> dict:
        return {
            "default_per_minute": gate.default_per_minute,
            "default_per_hour": gate.default_per_hour,
        }

    @guarded.get("/settings")
    def get_settings() -> dict:
        return _defaults()

    @guarded.put("/settings")
    def put_settings(body: Settings) -> dict:
        gate.default_per_minute = body.default_per_minute
        gate.default_per_hour = body.default_per_hour
        return _defaults()

    router.include_router(guarded)
    return router


def mount_dashboard(app: FastAPI, gate: Any, static_dir: Optional[Path] = None) -> None:
    """Add the dashboard API (and, if built, the UI) to ``app``.

    Requires ``gate.admin_secret``. The UI is served from ``static_dir`` (default:
    the bundled ``keygate/dashboard_static``) when that folder exists.
    """
    if not gate.admin_secret:
        raise ValueError("the dashboard needs KeyGate(admin_secret=...)")
    app.include_router(build_router(gate))

    root = static_dir or STATIC_DIR
    if root.is_dir():
        app.mount("/keygate/dashboard/assets", StaticFiles(directory=root / "assets"), name="kg-assets")

        @app.get("/keygate/dashboard", include_in_schema=False)
        @app.get("/keygate/dashboard/{path:path}", include_in_schema=False)
        def spa(path: str = ""):  # client-side routes fall back to index.html
            f = (root / path).resolve()
            if path and root.resolve() in f.parents and f.is_file():
                return FileResponse(f)
            return FileResponse(root / "index.html")
