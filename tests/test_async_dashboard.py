import httpx
import pytest
from fastapi import Depends, FastAPI

from keygate import DEFAULT_PLANS, ApiKey, AsyncKeyGate, KeyGate, Plan, PlanLimitError
from keygate.dashboard import mount_dashboard

pytestmark = pytest.mark.asyncio
API = "/keygate/dashboard/api"


async def build(**kw):
    app = FastAPI()
    gate = AsyncKeyGate(app, db_url="sqlite+aiosqlite://", admin_secret="s3cret", **kw)
    mount_dashboard(app, gate)

    @app.get("/ping")
    async def ping(key: ApiKey = Depends(gate.require)):
        return {}

    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
    token = (await c.post(f"{API}/login", json={"secret": "s3cret"})).json()["token"]
    return gate, c, {"Authorization": f"Bearer {token}"}


async def test_dashboard_runs_on_the_async_gate():
    gate, c, h = await build()
    made = (await c.post(f"{API}/keys", headers=h, json={"owner_id": "acme", "name": "Prod", "per_minute": 5})).json()
    for _ in range(3):
        await c.get("/ping", headers={"X-API-Key": made["key"]})

    ov = (await c.get(f"{API}/overview?range=1h", headers=h)).json()
    assert ov["totals"]["total"] == 3 and ov["active_keys"] == 1

    row = (await c.get(f"{API}/keys", headers=h)).json()["keys"][0]
    assert row["usage"]["total"] == 3 and row["rate"][0]["remaining"] == 2

    patched = (await c.patch(f"{API}/keys/{made['id']}", headers=h, json={"name": "Renamed"})).json()
    assert patched["name"] == "Renamed"

    detail = (await c.get(f"{API}/keys/{made['id']}/usage?range=1h", headers=h)).json()
    assert detail["by_status"] == {"200": 3}

    assert (await c.post(f"{API}/keys/{made['id']}/rotate", headers=h)).status_code == 201
    assert (await c.delete(f"{API}/keys/{made['id']}", headers=h)).status_code == 204
    assert (await c.get(f"{API}/overview", headers={"Authorization": "Bearer x"})).status_code == 401


async def test_async_plans_enforce_and_return_402():
    gate, c, h = await build(plans=DEFAULT_PLANS)
    for _ in range(2):
        assert (await c.post(f"{API}/keys", headers=h, json={"owner_id": "o"})).status_code == 201
    r = await c.post(f"{API}/keys", headers=h, json={"owner_id": "o"})
    assert r.status_code == 402 and r.json()["code"] == "plan_limit" and r.json()["upgrade_to"] == "pro"
    assert (await c.put(f"{API}/plan", headers=h, json={"owner_id": "o", "plan": "pro"})).status_code == 200
    assert (await c.post(f"{API}/keys", headers=h, json={"owner_id": "o"})).status_code == 201
    assert (await c.get(f"{API}/plan?owner_id=o", headers=h)).json()["usage"]["active_keys"] == 3


async def test_async_limits_are_clamped_and_downgrade_hits_existing_keys():
    plans = {"big": Plan("big", "Big", None, 100, None, None, True), "small": Plan("small", "Small", None, 2, None, None, True)}
    gate, c, _ = await build(plans=plans, default_plan="big")
    k = await gate.create_key("acme", per_minute=None)
    assert k.per_minute == 100  # unlimited becomes the cap
    await gate.set_plan("acme", "small")
    codes = [(await c.get("/ping", headers={"X-API-Key": k.key})).status_code for _ in range(4)]
    assert codes.count(429) == 2


async def test_rotate_works_at_the_key_cap_on_both_gates():
    gate = AsyncKeyGate(db_url="sqlite+aiosqlite://", plans=DEFAULT_PLANS)
    a, _b = await gate.create_key("o"), await gate.create_key("o")
    assert await gate.rotate(a.id) is not None
    with pytest.raises(PlanLimitError):
        await gate.create_key("o")  # normal creation is still capped

    sync = KeyGate(db_url="sqlite://", plans=DEFAULT_PLANS)
    a, _b = sync.create_key("o"), sync.create_key("o")
    assert sync.rotate(a.id) is not None
