import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from keygate import DEFAULT_PLANS, KeyGate, Plan, PlanLimitError
from keygate.dashboard import mount_dashboard

API = "/keygate/dashboard/api"


def make_gate(**kw):
    return KeyGate(db_url="sqlite://", plans=DEFAULT_PLANS, **kw)


def test_plans_are_off_by_default():
    gate = KeyGate(db_url="sqlite://")
    for _ in range(5):
        gate.create_key("acme", per_minute=None, scopes=["*"])
    assert gate.get_plan("acme") is None
    with pytest.raises(ValueError):
        gate.set_plan("acme", "pro")


def test_default_plan_must_exist():
    with pytest.raises(ValueError):
        KeyGate(db_url="sqlite://", plans=DEFAULT_PLANS, default_plan="gold")


def test_max_keys_counts_only_active_keys():
    gate = make_gate()
    a = gate.create_key("acme")
    gate.create_key("acme")
    with pytest.raises(PlanLimitError) as e:
        gate.create_key("acme")
    assert (e.value.limit, e.value.current, e.value.cap, e.value.upgrade_to) == ("max_keys", 2, 2, "pro")
    gate.create_key("other")  # another owner is unaffected
    gate.revoke(a.id)
    gate.create_key("acme")  # a revoked key frees a slot


def test_limits_are_clamped_and_unlimited_becomes_the_cap():
    gate = make_gate(default_per_minute=None)
    k = gate.create_key("acme", per_minute=9999, per_hour=None)
    assert (k.per_minute, k.per_hour) == (60, 1_000)
    assert gate.create_key("acme", per_minute=5).per_minute == 5  # lower than the cap is kept


def test_scope_limits():
    gate = make_gate()
    with pytest.raises(PlanLimitError) as e:
        gate.create_key("acme", scopes=["a", "b", "c", "d"])
    assert e.value.limit == "max_scopes"
    with pytest.raises(PlanLimitError) as e:
        gate.create_key("acme", scopes=["*"])
    assert e.value.limit == "wildcard_scope"
    gate.set_plan("acme", "team")
    assert gate.create_key("acme", scopes=["*"]).scopes == ["*"]


def test_upgrade_raises_the_cap():
    gate = make_gate()
    gate.create_key("acme")
    gate.create_key("acme")
    gate.set_plan("acme", "pro")
    assert gate.get_plan("acme").id == "pro"
    assert gate.create_key("acme", per_minute=500).per_minute == 500


def test_downgrade_never_touches_existing_keys():
    gate = make_gate()
    gate.set_plan("acme", "pro")
    keys = [gate.create_key("acme", per_minute=600, scopes=list("abcde")) for _ in range(4)]
    gate.set_plan("acme", "free")
    assert len(gate.list_keys("acme")) == 4
    assert all(k.per_minute == 600 for k in gate.list_keys("acme"))
    with pytest.raises(PlanLimitError):
        gate.create_key("acme")
    # renaming an over-cap key works; changing its limits or scopes is checked
    assert gate.update_key(keys[0].id, name="x", per_minute=600, scopes=list("abcde")).name == "x"
    assert gate.update_key(keys[0].id, per_minute=900).per_minute == 60
    with pytest.raises(PlanLimitError):
        gate.update_key(keys[0].id, scopes=list("abcdef"))


def test_unknown_plan_id_in_db_falls_back_to_default():
    gate = KeyGate(db_url="sqlite://", plans={"free": DEFAULT_PLANS["free"], "pro": DEFAULT_PLANS["pro"]})
    gate.set_plan("acme", "pro")
    gate.plans = {"free": DEFAULT_PLANS["free"]}  # catalog later drops "pro"
    assert gate.get_plan("acme").id == "free"


def test_set_plan_validates_and_stores_billing_fields():
    gate = make_gate()
    with pytest.raises(ValueError):
        gate.set_plan("acme", "gold")
    gate.set_plan("acme", "pro", billing_ref="cus_1", billing_status="active")
    gate.set_plan("acme", "pro")  # omitted billing fields are kept
    from keygate.models import OwnerRow
    with gate._sessions() as s:
        row = s.get(OwnerRow, "acme")
        assert (row.billing_ref, row.billing_status) == ("cus_1", "active")


def test_default_plan_prices():
    assert [p.price for p in DEFAULT_PLANS.values()] == ["$0", "$12", "$39"]
    assert isinstance(DEFAULT_PLANS["free"], Plan)


@pytest.fixture
def api():
    app = FastAPI()
    gate = KeyGate(app, db_url="sqlite://", admin_secret="s3cret", plans=DEFAULT_PLANS)
    mount_dashboard(app, gate)
    client = TestClient(app)
    token = client.post(f"{API}/login", json={"secret": "s3cret"}).json()["token"]
    return gate, client, {"Authorization": f"Bearer {token}"}


def test_plan_endpoints(api):
    gate, client, h = api
    body = client.get(f"{API}/plans", headers=h).json()
    assert body["enabled"] and body["default"] == "free" and [p["id"] for p in body["plans"]] == ["free", "pro", "team"]

    p = client.get(f"{API}/plan?owner_id=acme", headers=h).json()
    assert p["plan"]["id"] == "free" and p["can_create_key"] and p["usage"]["active_keys"] == 0

    out = client.put(f"{API}/plan", headers=h, json={"owner_id": "acme", "plan": "pro"}).json()
    assert out["plan"]["id"] == "pro"
    assert client.put(f"{API}/plan", headers=h, json={"owner_id": "acme", "plan": "gold"}).status_code == 422
    assert client.get(f"{API}/plan?owner_id=acme").status_code == 401


def test_key_routes_return_402_with_structured_fields(api):
    gate, client, h = api
    for _ in range(2):
        assert client.post(f"{API}/keys", headers=h, json={"owner_id": "acme"}).status_code == 201
    r = client.post(f"{API}/keys", headers=h, json={"owner_id": "acme"})
    assert r.status_code == 402
    assert r.json() == {
        "detail": "Your Free plan allows 2 active keys.",
        "code": "plan_limit", "limit": "max_keys", "current": 2, "cap": 2, "upgrade_to": "pro",
    }
    key_id = gate.list_keys("acme")[0].id
    r = client.patch(f"{API}/keys/{key_id}", headers=h, json={"scopes": ["*"]})
    assert r.status_code == 402 and r.json()["limit"] == "wildcard_scope"


def test_plan_endpoints_when_plans_are_off():
    app = FastAPI()
    gate = KeyGate(app, db_url="sqlite://", admin_secret="s3cret")
    mount_dashboard(app, gate)
    client = TestClient(app)
    h = {"Authorization": "Bearer " + client.post(f"{API}/login", json={"secret": "s3cret"}).json()["token"]}
    assert client.get(f"{API}/plans", headers=h).json() == {"enabled": False, "plans": [], "default": None}
    assert client.get(f"{API}/plan?owner_id=a", headers=h).status_code == 404


def test_downgrade_limits_existing_keys_at_request_time():
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from keygate import ApiKey

    plans = {
        "big": Plan("big", "Big", None, 100, None, None, True),
        "small": Plan("small", "Small", None, 2, None, None, True),
    }
    app = FastAPI()
    gate = KeyGate(db_url="sqlite://", plans=plans, default_plan="big")

    @app.get("/ping")
    def ping(key: ApiKey = Depends(gate.require)):
        return {}

    k = gate.create_key("acme", per_minute=50)
    c = TestClient(app)
    h = {"X-API-Key": k.key}
    assert all(c.get("/ping", headers=h).status_code == 200 for _ in range(3))
    gate.set_plan("acme", "small")  # key row still says 50/min
    codes = [c.get("/ping", headers=h).status_code for _ in range(4)]
    assert codes.count(429) >= 2
