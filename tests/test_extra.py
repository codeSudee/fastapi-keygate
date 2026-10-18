import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from keygate import ApiKey, KeyGate


def build(**gate_kwargs):
    app = FastAPI()
    kwargs = dict(db_url="sqlite://", admin_secret="s3cret")
    kwargs.update(gate_kwargs)
    gate = KeyGate(app, **kwargs)

    @app.get("/ping")
    def ping(key: ApiKey = Depends(gate.require)):
        return {"owner": key.owner_id}

    return gate, TestClient(app)


@pytest.fixture
def setup():
    return build()


def xk(k):
    return {"X-API-Key": k.key}


# -- concurrency ---------------------------------------------------------


def test_concurrent_requests_never_exceed_per_minute_limit(tmp_path):
    # file-backed DB: the in-memory StaticPool connection is not thread-safe
    gate, c = build(db_url=f"sqlite:///{tmp_path / 'kg.db'}")
    limit = 5
    k = gate.create_key("acme", per_minute=limit)

    def call(_):
        return c.get("/ping", headers=xk(k)).status_code

    with ThreadPoolExecutor(max_workers=16) as ex:
        codes = list(ex.map(call, range(40)))
    assert codes.count(200) <= limit
    assert codes.count(200) + codes.count(429) == 40


# -- Bearer / header edge cases ------------------------------------------


@pytest.mark.parametrize("scheme", ["Bearer", "bearer", "BEARER", "BeArEr"])
def test_bearer_scheme_case_insensitive(setup, scheme):
    gate, c = setup
    k = gate.create_key("acme")
    assert c.get("/ping", headers={"Authorization": f"{scheme} {k.key}"}).status_code == 200


def test_bearer_extra_whitespace(setup):
    gate, c = setup
    k = gate.create_key("acme")
    r = c.get("/ping", headers={"Authorization": f"Bearer    {k.key}  "})
    assert r.status_code == 200


def test_x_api_key_takes_precedence_over_bearer(setup):
    gate, c = setup
    good = gate.create_key("good")
    other = gate.create_key("other")
    # valid X-API-Key wins over a different valid Bearer key
    r = c.get("/ping", headers={"X-API-Key": good.key, "Authorization": f"Bearer {other.key}"})
    assert r.json() == {"owner": "good"}
    # invalid X-API-Key is not rescued by a valid Bearer key
    r = c.get("/ping", headers={"X-API-Key": "kg_bad_bad", "Authorization": f"Bearer {good.key}"})
    assert r.status_code == 401


def test_empty_values_rejected(setup):
    gate, c = setup
    k = gate.create_key("acme")
    assert c.get("/ping", headers={"X-API-Key": ""}).status_code == 401
    assert c.get("/ping", headers={"Authorization": "Bearer "}).status_code == 401
    assert c.get("/ping", headers={"Authorization": "Bearer"}).status_code == 401
    assert c.get("/ping", headers={"Authorization": ""}).status_code == 401
    assert c.get("/ping", headers={"Authorization": f"Basic {k.key}"}).status_code == 401
    # empty X-API-Key falls through to a valid Bearer
    r = c.get("/ping", headers={"X-API-Key": "", "Authorization": f"Bearer {k.key}"})
    assert r.status_code == 200


def test_401_has_www_authenticate(setup):
    _, c = setup
    r = c.get("/ping")
    assert r.status_code == 401 and r.headers["WWW-Authenticate"] == "ApiKey"


# -- rate-limit headers --------------------------------------------------


def test_rate_limit_headers_on_success_and_429(setup):
    gate, c = setup
    k = gate.create_key("acme", per_minute=2)
    r = c.get("/ping", headers=xk(k))
    assert r.headers["X-RateLimit-Limit"] == "2"
    assert r.headers["X-RateLimit-Remaining"] == "1"
    assert int(r.headers["X-RateLimit-Reset"]) > 0
    assert "Retry-After" not in r.headers
    c.get("/ping", headers=xk(k))
    r = c.get("/ping", headers=xk(k))
    assert r.status_code == 429
    assert r.headers["X-RateLimit-Limit"] == "2"
    assert r.headers["X-RateLimit-Remaining"] == "0"
    assert 1 <= int(r.headers["Retry-After"]) <= 60


def test_tightest_limit_reported(setup):
    gate, c = setup
    k = gate.create_key("acme", per_minute=10, per_hour=3)
    r = c.get("/ping", headers=xk(k))
    assert r.headers["X-RateLimit-Limit"] == "3"
    assert r.headers["X-RateLimit-Remaining"] == "2"


def test_unlimited_key_has_no_limit_headers(setup):
    gate, c = setup
    k = gate.create_key("acme", per_minute=None, per_hour=None)
    r = c.get("/ping", headers=xk(k))
    assert r.status_code == 200
    assert not [h for h in r.headers if h.lower().startswith("x-ratelimit")]
    assert "Retry-After" not in r.headers


# -- hour limit / minute quota ------------------------------------------


def test_hour_block_does_not_burn_minute_quota(setup):
    gate, c = setup
    k = gate.create_key("acme", per_minute=3, per_hour=2)
    assert [c.get("/ping", headers=xk(k)).status_code for _ in range(5)] == [200, 200, 429, 429, 429]
    # minute window must only hold the 2 allowed hits, not the 3 blocked attempts
    stats = gate._limiter._limiter.get_window_stats(
        gate._limiter._items(3, None)[0], "keygate", str(k.id)
    )
    assert stats.remaining == 1


# -- revocation ----------------------------------------------------------


def test_revoked_key_401_even_with_bearer(setup):
    gate, c = setup
    k = gate.create_key("acme")
    assert c.get("/ping", headers=xk(k)).status_code == 200
    gate.revoke(k.id)
    assert c.get("/ping", headers=xk(k)).status_code == 401
    assert c.get("/ping", headers={"Authorization": f"Bearer {k.key}"}).status_code == 401


# -- optional backends ---------------------------------------------------


@pytest.mark.skipif(not os.environ.get("KEYGATE_TEST_REDIS"), reason="KEYGATE_TEST_REDIS not set")
def test_redis_rate_limit_store():
    pytest.importorskip("redis")
    gate, c = build(limits_uri=os.environ["KEYGATE_TEST_REDIS"])
    k = gate.create_key("redis-user", per_minute=3)
    codes = [c.get("/ping", headers=xk(k)).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]


@pytest.mark.skipif(not os.environ.get("KEYGATE_TEST_PG_URL"), reason="KEYGATE_TEST_PG_URL not set")
def test_postgres_backend():
    pytest.importorskip("psycopg")
    gate, c = build(db_url=os.environ["KEYGATE_TEST_PG_URL"])
    k = gate.create_key("pg-user", per_minute=2)
    try:
        assert c.get("/ping", headers=xk(k)).json() == {"owner": "pg-user"}
        assert c.get("/ping", headers=xk(k)).status_code == 200
        assert c.get("/ping", headers=xk(k)).status_code == 429
        assert gate.usage(k.id).total == 3
        assert gate.revoke(k.id) is True
        assert c.get("/ping", headers=xk(k)).status_code == 401
    finally:
        gate.revoke(k.id)


def test_in_memory_sqlite_is_safe_under_threads():
    from concurrent.futures import ThreadPoolExecutor

    app = FastAPI()
    gate = KeyGate(app, db_url="sqlite://")

    @app.get("/x")
    def x(key: ApiKey = Depends(gate.require)):
        return "ok"

    k = gate.create_key("acme", per_minute=10)
    c = TestClient(app)
    with ThreadPoolExecutor(16) as pool:
        codes = list(pool.map(lambda _: c.get("/x", headers={"X-API-Key": k.key}).status_code, range(60)))
    assert set(codes) <= {200, 429} and codes.count(200) == 10
