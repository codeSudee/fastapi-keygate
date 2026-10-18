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


def test_expired_key_rejected_and_future_key_works(setup):
    from datetime import timedelta
    gate, c = setup
    live = gate.create_key("acme", expires_in=timedelta(days=1))
    dead = gate.create_key("acme", expires_in=timedelta(seconds=-1))
    forever = gate.create_key("acme")
    assert c.get("/items/1", headers=h(live)).status_code == 200
    assert c.get("/items/1", headers=h(dead)).status_code == 401
    assert c.get("/items/1", headers=h(forever)).status_code == 200
    assert live.expires_at is not None and forever.expires_at is None


def test_expires_at_and_expires_in_are_exclusive(setup):
    from datetime import datetime, timedelta
    gate, _ = setup
    with pytest.raises(ValueError):
        gate.create_key("acme", expires_at=datetime(2999, 1, 1), expires_in=timedelta(days=1))


def test_admin_create_with_expires_at(setup):
    _, c = setup
    r = c.post("/keygate/keys", json={"owner_id": "a", "expires_at": "2000-01-01T00:00:00"}, headers=ADMIN)
    assert r.status_code == 201 and r.json()["expires_at"].startswith("2000-01-01")
    assert c.get("/items/1", headers={"X-API-Key": r.json()["key"]}).status_code == 401


def test_old_database_gets_expires_at_column(tmp_path):
    import sqlite3
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE keygate_keys (id INTEGER PRIMARY KEY, prefix VARCHAR(16), key_hash VARCHAR(64), "
                "owner_id VARCHAR(255), name VARCHAR(255), per_minute INTEGER, per_hour INTEGER, "
                "created_at DATETIME, revoked_at DATETIME)")
    con.commit(); con.close()
    gate = KeyGate(db_url=f"sqlite:///{db}")
    k = gate.create_key("acme", scopes=["read"])
    assert k.expires_at is None and k.scopes == ["read"]


def test_scopes_enforced():
    app = FastAPI()
    gate = KeyGate(app, db_url="sqlite://")

    @app.get("/r")
    def r(key: ApiKey = Depends(gate.require_scopes("read"))):
        return key.scopes

    @app.post("/w")
    def w(key: ApiKey = Depends(gate.require_scopes("read", "write"))):
        return "ok"

    c = TestClient(app)
    ro = gate.create_key("a", scopes=["read"])
    rw = gate.create_key("a", scopes=["read", "write", "read"])
    root = gate.create_key("a", scopes=["*"])
    none = gate.create_key("a")
    assert rw.scopes == ["read", "write"]
    assert c.get("/r", headers=h(ro)).json() == ["read"]
    assert c.post("/w", headers=h(ro)).status_code == 403
    assert c.post("/w", headers=h(rw)).status_code == 200
    assert c.post("/w", headers=h(root)).status_code == 200
    assert c.get("/r", headers=h(none)).status_code == 403
    assert c.get("/r").status_code == 401  # auth still comes first


def test_invalid_scope_rejected_and_admin_sets_scopes(setup):
    gate, c = setup
    with pytest.raises(ValueError):
        gate.create_key("a", scopes=["bad scope"])
    r = c.post("/keygate/keys", json={"owner_id": "a", "scopes": ["read"]}, headers=ADMIN)
    assert r.json()["scopes"] == ["read"]
    assert gate.list_keys("a")[0].scopes == ["read"]


def test_rotate_copies_settings_and_retires_old_key(setup):
    from datetime import timedelta
    gate, c = setup
    old = gate.create_key("acme", name="prod", per_minute=7, scopes=["read"])
    new = gate.rotate(old.id, grace=timedelta(hours=1))
    assert new.id != old.id and new.key != old.key
    assert (new.owner_id, new.name, new.per_minute, new.scopes) == ("acme", "prod", 7, ["read"])
    assert new.expires_at is None  # old had no expiry
    assert c.get("/items/1", headers=h(old)).status_code == 200  # still in grace
    assert c.get("/items/1", headers=h(new)).status_code == 200
    stored_old = next(k for k in gate.list_keys() if k.id == old.id)
    assert stored_old.expires_at is not None


def test_rotate_with_zero_grace_cuts_old_key_immediately(setup):
    from datetime import timedelta
    gate, c = setup
    old = gate.create_key("acme")
    new = gate.rotate(old.id, grace=timedelta(0))
    assert c.get("/items/1", headers=h(old)).status_code == 401
    assert c.get("/items/1", headers=h(new)).status_code == 200


def test_rotate_unknown_revoked_or_expired_returns_none(setup):
    from datetime import timedelta
    gate, _ = setup
    assert gate.rotate(999) is None
    k = gate.create_key("acme"); gate.revoke(k.id)
    assert gate.rotate(k.id) is None
    e = gate.create_key("acme", expires_in=timedelta(seconds=-1))
    assert gate.rotate(e.id) is None


def test_rotate_keeps_earlier_expiry_of_old_key(setup):
    from datetime import timedelta
    gate, _ = setup
    old = gate.create_key("acme", expires_in=timedelta(minutes=5))
    new = gate.rotate(old.id, grace=timedelta(days=7))
    assert new.expires_at == old.expires_at  # grace never extends the old key


def test_admin_rotate(setup):
    gate, c = setup
    k = gate.create_key("acme")
    r = c.post(f"/keygate/keys/{k.id}/rotate?grace_hours=0", headers=ADMIN)
    assert r.status_code == 201 and r.json()["key"] != k.key
    assert c.post("/keygate/keys/999/rotate", headers=ADMIN).status_code == 404
    assert c.get("/items/1", headers=h(k)).status_code == 401


def test_prune_usage_removes_only_old_rows(setup):
    from datetime import timedelta
    from keygate.models import UsageRow, utcnow
    gate, c = setup
    k = gate.create_key("acme")
    for _ in range(3):
        c.get("/items/1", headers=h(k))
    with gate._sessions() as s:
        s.query(UsageRow).filter(UsageRow.id == 1).update({"ts": utcnow() - timedelta(days=100)})
        s.commit()
    assert gate.prune_usage(timedelta(days=90)) == 1
    assert gate.usage(k.id).total == 2
    assert gate.prune_usage(timedelta(days=90)) == 0


def test_admin_prune_usage(setup):
    gate, c = setup
    assert c.delete("/keygate/usage", headers=ADMIN).json() == {"deleted": 0}
    assert c.delete("/keygate/usage").status_code == 403
