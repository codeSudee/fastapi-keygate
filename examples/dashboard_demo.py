"""Dashboard demo with synthetic traffic.

    pip install fastapi-keygate uvicorn
    python examples/dashboard_demo.py      # then open http://localhost:8000/keygate/dashboard
    sign in with the admin secret:  demo-secret

For UI development run `npm run dev` in dashboard/ (proxies the API to :8000).
"""

import math
import random
from datetime import timedelta

import uvicorn
from fastapi import Depends, FastAPI
from fastapi.responses import RedirectResponse
from keygate import DEFAULT_PLANS, ApiKey, KeyGate
from keygate.dashboard import mount_dashboard
from keygate.models import UsageRow, utcnow

app = FastAPI()
gate = KeyGate(app, db_url="sqlite:///dashboard-demo.db", admin_secret="demo-secret", plans=DEFAULT_PLANS)
mount_dashboard(app, gate)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/keygate/dashboard")


@app.get("/hello")
def hello(key: ApiKey = Depends(gate.require)):
    return {"hello": key.owner_id}


def seed() -> None:
    random.seed(7)
    specs = [
        ("Production", "acme", 600, 20000, ["read", "write"], 1.0),
        ("Staging", "acme", 120, None, ["read", "write"], 0.25),
        ("Mobile app", "acme-mobile", 300, 10000, ["read"], 0.6),
        ("Partner: Northwind", "northwind", 60, 2000, ["read"], 0.18),
        ("Internal cron", "ops", 30, None, ["*"], 0.08),
    ]
    paths = [("GET", "/hello", 55), ("GET", "/v1/items", 25), ("POST", "/v1/items", 12), ("GET", "/v1/reports", 8)]
    now, rows = utcnow(), []
    for name, owner, pm, ph, scopes, weight in specs:
        gate.set_plan(owner, "team")  # the Free plan would reject the seeded keys
        k = gate.create_key(owner, name, per_minute=pm, per_hour=ph, scopes=scopes)
        for h in range(30 * 24):
            ts0 = now - timedelta(hours=h)
            wave = 1 + 0.5 * math.sin((ts0.hour - 9) / 24 * 2 * math.pi) + 0.15 * (ts0.weekday() >= 5) * -1
            ramp = 0.6 + 0.4 * (1 - h / 720)
            n = max(0, int(random.gauss(40 * weight * wave * ramp, 5 * weight + 1)))
            for _ in range(n):
                m, p, _w = random.choices(paths, [w for *_, w in paths])[0]
                r = random.random()
                status = 429 if r < 0.012 * (1.5 if weight < 0.3 else 1) else 500 if r < 0.02 else 401 if r < 0.025 else 200
                rows.append(UsageRow(key_id=k.id, ts=ts0 - timedelta(seconds=random.randint(0, 3599)), method=m, path=p, status=status))
    gate.update_key(gate.list_keys()[-1].id, expires_at=now + timedelta(days=9))
    old = gate.create_key("legacy", "Legacy v1", per_minute=20)
    gate.revoke(old.id)
    with gate._sessions() as s:
        s.add_all(rows)
        s.commit()
    for k, used in zip(gate.list_keys(), (212, 96, 301, 37, 3)):  # live rate-limit meters
        for _ in range(min(used, k.per_minute or used)):
            gate._limiter.hit(k.id, k.per_minute, k.per_hour)


if not gate.list_keys(include_revoked=True):
    seed()

if __name__ == "__main__":
    print("\nDashboard: http://localhost:8000/keygate/dashboard   (admin secret: demo-secret)\n")
    uvicorn.run(app, port=8000, log_level="warning")
