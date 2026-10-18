# fastapi-keygate

[![CI](https://github.com/codeSudee/fastapi-keygate/actions/workflows/ci.yml/badge.svg)](https://github.com/codeSudee/fastapi-keygate/actions/workflows/ci.yml)

API-key authentication, per-key rate limiting and per-key usage tracking for FastAPI — in a few lines, with zero setup (SQLite by default).

```bash
pip install fastapi-keygate
```

```python
from fastapi import Depends, FastAPI
from keygate import ApiKey, KeyGate

app = FastAPI()
gate = KeyGate(app, admin_secret="change-me")  # SQLite, zero setup

@app.get("/hello")
def hello(key: ApiKey = Depends(gate.require)):
    return {"hello": key.owner_id}

if not gate.list_keys():  # demo only: mint a first key
    print("Your API key:", gate.create_key("demo-tenant", per_minute=5).key)
```

```bash
uvicorn app:app
curl -H "X-API-Key: kg_..." localhost:8000/hello   # 200, then 429 after 5/minute
```

(The package is `fastapi-keygate` on PyPI; you `import keygate`.)

## What you get

- **Auth** — `Depends(gate.require)` returns the caller's `ApiKey` (`id`, `owner_id`, limits). Missing/invalid/revoked → `401`. Keys are read from `X-API-Key` or `Authorization: Bearer`, never from query strings (those leak into logs).
- **Per-key rate limits** — requests per minute and/or hour, stored on each key. Over limit → `429` with `Retry-After`; successful responses carry `X-RateLimit-*` headers.
- **Usage tracking** — every authenticated request is logged (timestamp, method, route, status).
- **Key management** — from Python or an opt-in admin API.

Keys look like `kg_<prefix>_<secret>`. Only a SHA-256 hash is stored; the plaintext is shown once at creation.

## Managing keys

```python
k = gate.create_key("acme", name="prod", per_minute=60, per_hour=1000)
k.key                      # plaintext, only available here
gate.list_keys("acme")     # [ApiKey, ...]
gate.revoke(k.id)
gate.usage(k.id, last_hours=24)
# UsageStats(total=…, by_status={200: …, 429: …}, by_endpoint={"GET /hello": …}, …)
```

Give keys scopes and guard routes with them (missing scope → `403`; the `"*"` scope matches everything):

```python
k = gate.create_key("acme", scopes=["read", "write"])

@app.delete("/items/{id}")
def delete(id: int, key: ApiKey = Depends(gate.require_scopes("write"))): ...
```

Rotate a key without downtime: `new = gate.rotate(k.id, grace=timedelta(hours=24))` returns a replacement with the same owner, limits and scopes, and the old key keeps working until the grace period ends (`POST /keygate/keys/{id}/rotate?grace_hours=24` in the admin API). Rate-limit counters are per key, so during the grace period the two keys each get their own allowance.

Keys never expire unless you set `expires_at=` (naive UTC datetime) or `expires_in=timedelta(days=30)`; expired keys get `401`. Omitted limits use `KeyGate(default_per_minute=60, default_per_hour=None)`; pass `None` for unlimited.

With `admin_secret` set, these endpoints are mounted (header `X-Admin-Secret`). Without it, nothing is exposed.

| Method | Path | |
|---|---|---|
| POST | `/keygate/keys` | `{"owner_id": "acme", "per_minute": 30, "expires_at": "2027-01-01T00:00:00", "scopes": ["read"]}` → returns the key once |
| GET | `/keygate/keys?owner_id=acme` | list |
| DELETE | `/keygate/keys/{id}` | revoke |
| POST | `/keygate/keys/{id}/rotate?grace_hours=24` | replacement key, old one expires after the grace period |
| GET | `/keygate/keys/{id}/usage?last_hours=24` | stats |
| DELETE | `/keygate/usage?older_than_days=90` | delete old usage rows |

## Configuration

```python
KeyGate(
    app,
    db_url="postgresql+psycopg://user:pw@host/db",  # any SQLAlchemy URL
    limits_uri="redis://localhost:6379",             # shared rate-limit store
    admin_secret=...,
)
```

## Things to know

- **Multiple workers:** the default rate-limit store is in memory, per process. With N Uvicorn/Gunicorn workers a `60/min` limit becomes up to `60×N`. Use `limits_uri="redis://..."` (`pip install fastapi-keygate[redis]`) in that case.
- **Why not slowapi?** Rate limiting uses [`limits`](https://github.com/alisaifee/limits), the engine slowapi wraps. slowapi is built around per-endpoint decorators that need a `request` argument; keygate's limits belong to the *key*, so they're enforced inside the auth dependency. You can still use slowapi alongside it.
- **Usage table growth:** every authenticated request adds a row. Call `gate.prune_usage(timedelta(days=90))` periodically (or `DELETE /keygate/usage?older_than_days=90`) to delete old rows.
- **Schema:** tables are created on startup (`create_all`); there are no migrations yet.
- **Not included (yet):** async engines.
- Timestamps are naive UTC.

## Development

```bash
pip install -e ".[dev]" && pytest
```

MIT licensed.
