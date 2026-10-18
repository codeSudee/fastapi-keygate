import asyncio
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi import Depends, FastAPI

from keygate import ApiKey, AsyncKeyGate

pytestmark = pytest.mark.asyncio
ADMIN = {"X-Admin-Secret": "s3cret"}


def build(**kw):
    app = FastAPI()
    gate = AsyncKeyGate(app, db_url="sqlite+aiosqlite://", admin_secret="s3cret", **kw)

    @app.get("/items/{item_id}")
    async def item(item_id: int, key: ApiKey = Depends(gate.require)):
        return {"owner": key.owner_id}

    @app.get("/admin-only")
    async def admin_only(key: ApiKey = Depends(gate.require_scopes("admin"))):
        return "ok"

    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
    return gate, client


def h(k):
    return {"X-API-Key": k.key}


async def test_auth_and_rate_limit():
    gate, c = build()
    k = await gate.create_key("acme", per_minute=3)
    assert (await c.get("/items/1")).status_code == 401
    assert (await c.get("/items/1", headers={"X-API-Key": "kg_deadbeef_x"})).status_code == 401
    codes = [(await c.get("/items/1", headers=h(k))).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    r = await c.get("/items/1", headers=h(k))
    assert r.headers["Retry-After"] and r.headers["X-RateLimit-Remaining"] == "0"
    b = await gate.create_key("b")
    ok = await c.get("/items/1", headers={"Authorization": f"Bearer {b.key}"})
    assert ok.status_code == 200 and ok.json() == {"owner": "b"}


async def test_scopes_expiry_revoke_rotate():
    gate, c = build()
    ro = await gate.create_key("a", scopes=["read"])
    adm = await gate.create_key("a", scopes=["admin"])
    assert (await c.get("/admin-only", headers=h(ro))).status_code == 403
    assert (await c.get("/admin-only", headers=h(adm))).status_code == 200

    dead = await gate.create_key("a", expires_in=timedelta(seconds=-1))
    assert (await c.get("/items/1", headers=h(dead))).status_code == 401

    old = await gate.create_key("a", name="prod", per_minute=9, scopes=["read"])
    new = await gate.rotate(old.id, grace=timedelta(0))
    assert (new.name, new.per_minute, new.scopes) == ("prod", 9, ["read"])
    assert (await c.get("/items/1", headers=h(old))).status_code == 401
    assert (await c.get("/items/1", headers=h(new))).status_code == 200
    assert await gate.rotate(999) is None

    assert await gate.revoke(new.id) is True and await gate.revoke(new.id) is False
    assert (await c.get("/items/1", headers=h(new))).status_code == 401
    assert new.id not in [k.id for k in await gate.list_keys()]
    assert new.id in [k.id for k in await gate.list_keys(include_revoked=True)]


async def test_usage_and_prune():
    gate, c = build()
    k = await gate.create_key("acme", per_minute=2)
    for _ in range(3):
        await c.get("/items/1", headers=h(k))
    stats = await gate.usage(k.id)
    assert stats.total == 3 and stats.by_status == {200: 2, 429: 1}
    assert stats.by_endpoint == {"GET /items/{item_id}": 3}
    assert await gate.prune_usage(timedelta(days=1)) == 0
    assert await gate.prune_usage(timedelta(seconds=-1)) == 3
    assert (await gate.usage(k.id)).total == 0


async def test_admin_api():
    gate, c = build()
    assert (await c.post("/keygate/keys", json={"owner_id": "a"})).status_code == 403
    r = await c.post("/keygate/keys", json={"owner_id": "a", "scopes": ["read"], "per_minute": 5}, headers=ADMIN)
    body = r.json()
    assert r.status_code == 201 and body["scopes"] == ["read"] and body["per_minute"] == 5
    assert (await c.get("/items/1", headers={"X-API-Key": body["key"]})).status_code == 200
    assert len((await c.get("/keygate/keys", headers=ADMIN)).json()) == 1
    rot = await c.post(f"/keygate/keys/{body['id']}/rotate?grace_hours=0", headers=ADMIN)
    assert rot.status_code == 201
    assert (await c.get("/items/1", headers={"X-API-Key": body["key"]})).status_code == 401
    assert (await c.get(f"/keygate/keys/{body['id']}/usage", headers=ADMIN)).json()["total"] >= 1
    assert (await c.delete(f"/keygate/keys/{rot.json()['id']}", headers=ADMIN)).status_code == 204
    assert (await c.delete("/keygate/usage?older_than_days=0", headers=ADMIN)).status_code == 200


async def test_concurrent_requests_respect_limit():
    gate, c = build()
    k = await gate.create_key("acme", per_minute=5)
    rs = await asyncio.gather(*[c.get("/items/1", headers=h(k)) for _ in range(30)])
    assert [r.status_code for r in rs].count(200) == 5


async def test_invalid_scope_and_exclusive_expiry():
    gate, _ = build()
    with pytest.raises(ValueError):
        await gate.create_key("a", scopes=["bad scope"])
    with pytest.raises(ValueError):
        await gate.create_key("a", expires_at=datetime(2999, 1, 1), expires_in=timedelta(days=1))


import os


@pytest.mark.skipif(
    not (os.environ.get("KEYGATE_TEST_REDIS") and os.environ.get("KEYGATE_TEST_PG_ASYNC_URL")),
    reason="KEYGATE_TEST_REDIS / KEYGATE_TEST_PG_ASYNC_URL not set",
)
async def test_async_redis_and_postgres():
    pytest.importorskip("redis")
    pytest.importorskip("asyncpg")
    app = FastAPI()
    gate = AsyncKeyGate(
        app,
        db_url=os.environ["KEYGATE_TEST_PG_ASYNC_URL"],
        limits_uri="async+" + os.environ["KEYGATE_TEST_REDIS"],
    )

    @app.get("/p")
    async def p(key: ApiKey = Depends(gate.require)):
        return key.owner_id

    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
    k = await gate.create_key("async-pg", per_minute=2)
    try:
        codes = [(await c.get("/p", headers=h(k))).status_code for _ in range(3)]
        assert codes == [200, 200, 429]
        assert (await gate.usage(k.id)).total == 3
    finally:
        await gate.revoke(k.id)
        await gate.aclose()
