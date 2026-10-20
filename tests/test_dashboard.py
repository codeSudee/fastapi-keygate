import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from keygate import ApiKey, KeyGate
from keygate.dashboard import check_token, make_token, mount_dashboard

API = "/keygate/dashboard/api"


@pytest.fixture
def env():
    app = FastAPI()
    gate = KeyGate(app, db_url="sqlite://", admin_secret="s3cret")
    mount_dashboard(app, gate)

    @app.get("/ping")
    def ping(key: ApiKey = Depends(gate.require)):
        return {"ok": True}

    client = TestClient(app)
    token = client.post(f"{API}/login", json={"secret": "s3cret"}).json()["token"]
    return gate, client, {"Authorization": f"Bearer {token}"}


def test_login_rejects_wrong_secret_and_guards_routes(env):
    gate, client, _ = env
    assert client.post(f"{API}/login", json={"secret": "nope"}).status_code == 401
    assert client.get(f"{API}/overview").status_code == 401
    assert client.get(f"{API}/overview", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_token_expiry_and_tampering():
    token, _ = make_token("k", ttl=-1)
    assert not check_token("k", token)
    good, _ = make_token("k")
    assert check_token("k", good) and not check_token("other", good)


def test_login_is_throttled(env):
    _, client, _ = env
    codes = [client.post(f"{API}/login", json={"secret": "x"}).status_code for _ in range(10)]
    assert codes[-1] == 429


def test_key_lifecycle_and_usage(env):
    gate, client, h = env
    made = client.post(f"{API}/keys", headers=h, json={"owner_id": "acme", "name": "Prod", "per_minute": 5}).json()
    assert made["key"].startswith("kg_") and made["state"] == "active"
    for _ in range(3):
        client.get("/ping", headers={"X-API-Key": made["key"]})

    ov = client.get(f"{API}/overview?range=1h", headers=h).json()
    assert ov["totals"]["total"] == 3 and ov["active_keys"] == 1
    assert sum(p["ok"] for p in ov["series"]) == 3

    keys = client.get(f"{API}/keys", headers=h).json()["keys"]
    assert keys[0]["usage"]["total"] == 3
    assert keys[0]["rate"][0]["remaining"] == 2  # status is read-only: still 2 after viewing
    assert client.get(f"{API}/keys", headers=h).json()["keys"][0]["rate"][0]["remaining"] == 2

    patched = client.patch(f"{API}/keys/{made['id']}", headers=h, json={"name": "Renamed", "per_minute": None}).json()
    assert patched["name"] == "Renamed" and patched["per_minute"] is None

    detail = client.get(f"{API}/keys/{made['id']}/usage?range=1h", headers=h).json()
    assert detail["by_status"] == {"200": 3}

    assert client.delete(f"{API}/keys/{made['id']}", headers=h).status_code == 204
    assert client.patch(f"{API}/keys/{made['id']}", headers=h, json={"name": "x"}).status_code == 404
    assert client.get("/ping", headers={"X-API-Key": made["key"]}).status_code == 401


def test_settings_change_defaults_for_new_keys(env):
    gate, client, h = env
    client.put(f"{API}/settings", headers=h, json={"default_per_minute": 7, "default_per_hour": 90})
    k = client.post(f"{API}/keys", headers=h, json={"owner_id": "a"}).json()
    assert (k["per_minute"], k["per_hour"]) == (7, 90)  # unspecified limits inherit the defaults
    k2 = gate.create_key("b")
    assert (k2.per_minute, k2.per_hour) == (7, 90)


def test_bad_range_rejected(env):
    _, client, h = env
    assert client.get(f"{API}/overview?range=5y", headers=h).status_code == 422
