import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from keygate import ApiKey, KeyGate

ADMIN = {"X-Admin-Secret": "s3cret"}


@pytest.fixture
def setup():
    app = FastAPI()
    gate = KeyGate(app, db_url="sqlite://", admin_secret="s3cret")

    @app.get("/items/{item_id}")
    def item(item_id: int, key: ApiKey = Depends(gate.require)):
        return {"owner": key.owner_id}

    @app.get("/open")
    def open_():
        return "ok"

    return gate, TestClient(app)


def h(key):
    return {"X-API-Key": key.key}


def test_missing_and_malformed_keys_rejected(setup):
    _, c = setup
    assert c.get("/items/1").status_code == 401
    assert c.get("/items/1", headers={"X-API-Key": "nope"}).status_code == 401
    assert c.get("/items/1", headers={"X-API-Key": "kg_deadbeef_xxx"}).status_code == 401


def test_valid_key_attaches_identity_and_bearer_works(setup):
    gate, c = setup
    k = gate.create_key("acme")
    r = c.get("/items/1", headers=h(k))
    assert r.status_code == 200 and r.json() == {"owner": "acme"}
    assert c.get("/items/1", headers={"Authorization": f"Bearer {k.key}"}).status_code == 200
    assert c.get("/open").status_code == 200  # unprotected routes untouched


def test_wrong_secret_with_valid_prefix_rejected(setup):
    gate, c = setup
    k = gate.create_key("acme")
    prefix = k.key.split("_", 2)[1]
    assert c.get("/items/1", headers={"X-API-Key": f"kg_{prefix}_wrong"}).status_code == 401


def test_secret_not_stored_in_plaintext(setup):
    gate, _ = setup
    k = gate.create_key("acme")
    with gate._sessions() as s:
        from keygate.models import ApiKeyRow
        row = s.query(ApiKeyRow).one()
    assert k.key not in (row.key_hash, row.prefix) and row.key_hash != k.key


def test_revoked_key_rejected(setup):
    gate, c = setup
    k = gate.create_key("acme")
    assert c.get("/items/1", headers=h(k)).status_code == 200
    assert gate.revoke(k.id) is True
    assert gate.revoke(k.id) is False
    assert c.get("/items/1", headers=h(k)).status_code == 401
    assert gate.list_keys() == []
    assert len(gate.list_keys(include_revoked=True)) == 1


def test_rate_limit_per_minute_with_headers(setup):
    gate, c = setup
    k = gate.create_key("acme", per_minute=3)
    for i in range(3):
        r = c.get("/items/1", headers=h(k))
        assert r.status_code == 200
        assert r.headers["X-RateLimit-Remaining"] == str(2 - i)
    r = c.get("/items/1", headers=h(k))
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1


def test_limits_are_per_key(setup):
    gate, c = setup
    a = gate.create_key("a", per_minute=1)
    b = gate.create_key("b", per_minute=1)
    assert c.get("/items/1", headers=h(a)).status_code == 200
    assert c.get("/items/1", headers=h(a)).status_code == 429
    assert c.get("/items/1", headers=h(b)).status_code == 200


def test_hour_limit_blocks_without_burning_minute_quota(setup):
    gate, c = setup
    k = gate.create_key("a", per_minute=10, per_hour=2)
    codes = [c.get("/items/1", headers=h(k)).status_code for _ in range(4)]
    assert codes == [200, 200, 429, 429]


def test_unlimited_key(setup):
    gate, c = setup
    k = gate.create_key("a", per_minute=None, per_hour=None)
    assert all(c.get("/items/1", headers=h(k)).status_code == 200 for _ in range(100))


def test_usage_tracking_groups_by_route_template_and_status(setup):
    gate, c = setup
    k = gate.create_key("acme", per_minute=3)
    for i in range(4):  # 3 ok + 1 rate-limited
        c.get(f"/items/{i}", headers=h(k))
    c.get("/items/1")  # unauthenticated: not attributed to any key
    u = gate.usage(k.id)
    assert u.total == 4
    assert u.by_status == {200: 3, 429: 1}
    assert u.by_endpoint == {"GET /items/{item_id}": 4}
    assert gate.usage(k.id, last_hours=1).total == 4
    assert gate.usage(k.id + 99).total == 0


def test_admin_endpoints(setup):
    gate, c = setup
    assert c.post("/keygate/keys", json={"owner_id": "x"}).status_code == 403
    assert c.post("/keygate/keys", json={"owner_id": "x"}, headers={"X-Admin-Secret": "bad"}).status_code == 403

    r = c.post("/keygate/keys", json={"owner_id": "x", "per_hour": 5}, headers=ADMIN)
    assert r.status_code == 201
    body = r.json()
    assert body["per_minute"] == 60 and body["per_hour"] == 5  # default + override
    assert c.get("/items/1", headers={"X-API-Key": body["key"]}).status_code == 200

    unl = c.post("/keygate/keys", json={"owner_id": "x", "per_minute": None}, headers=ADMIN).json()
    assert unl["per_minute"] is None

    listed = c.get("/keygate/keys", params={"owner_id": "x"}, headers=ADMIN).json()
    assert len(listed) == 2 and "key" not in listed[0]

    assert c.get(f"/keygate/keys/{body['id']}/usage", headers=ADMIN).json()["total"] == 1
    assert c.delete(f"/keygate/keys/{body['id']}", headers=ADMIN).status_code == 204
    assert c.delete(f"/keygate/keys/{body['id']}", headers=ADMIN).status_code == 404
    assert c.get("/items/1", headers={"X-API-Key": body["key"]}).status_code == 401


def test_admin_not_mounted_without_secret():
    app = FastAPI()
    KeyGate(app, db_url="sqlite://")
    assert TestClient(app).get("/keygate/keys").status_code == 404
