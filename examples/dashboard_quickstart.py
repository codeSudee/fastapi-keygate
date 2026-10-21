"""Your own Keygate with the web dashboard: an empty database and one protected route.

    pip install fastapi-keygate uvicorn
    python dashboard_quickstart.py

Open the printed dashboard link, sign in with the printed admin secret, create a key on the
API keys page, then call the route:  curl -H "X-API-Key: <your key>" localhost:8000/hello

Set KEYGATE_ADMIN_SECRET to keep one secret across runs. Keys live in ./keygate.db.
"""

import os
import secrets

import uvicorn
from fastapi import Depends, FastAPI
from fastapi.responses import RedirectResponse
from keygate import ApiKey, KeyGate
from keygate.dashboard import mount_dashboard

admin_secret = os.environ.get("KEYGATE_ADMIN_SECRET") or secrets.token_urlsafe(16)

app = FastAPI()
gate = KeyGate(app, db_url="sqlite:///keygate.db", admin_secret=admin_secret)
mount_dashboard(app, gate)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/keygate/dashboard")


@app.get("/hello")
def hello(key: ApiKey = Depends(gate.require)):
    return {"hello": key.owner_id}


if __name__ == "__main__":
    print(f"\nDashboard: http://localhost:8000/keygate/dashboard\nAdmin secret: {admin_secret}\n")
    uvicorn.run(app, port=8000, log_level="warning")
