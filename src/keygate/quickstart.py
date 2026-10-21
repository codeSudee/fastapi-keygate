"""``keygate quickstart``: a real, empty Keygate with the dashboard and one protected route."""
import os
import secrets
import sys
from typing import Optional, Tuple

from fastapi import Depends, FastAPI
from fastapi.responses import RedirectResponse

from .dashboard import mount_dashboard
from .gate import KeyGate
from .schemas import ApiKey


def build_app(db_url: str, admin_secret: Optional[str] = None) -> Tuple[FastAPI, str]:
    secret = admin_secret or os.environ.get("KEYGATE_ADMIN_SECRET") or secrets.token_urlsafe(16)
    app = FastAPI()
    gate = KeyGate(app, db_url=db_url, admin_secret=secret)
    mount_dashboard(app, gate)

    @app.get("/", include_in_schema=False)
    def root():
        return RedirectResponse("/keygate/dashboard")

    @app.get("/hello")
    def hello(key: ApiKey = Depends(gate.require)):
        return {"hello": key.owner_id}

    return app, secret


def run(db_url: str, port: int = 8000) -> int:
    try:
        import uvicorn
    except ImportError:
        print("error: quickstart needs uvicorn.  Run:  pip install uvicorn", file=sys.stderr)
        return 1
    app, secret = build_app(db_url)
    print(
        f"\n  Dashboard:     http://localhost:{port}/keygate/dashboard"
        f"\n  Admin secret:  {secret}"
        "\n\n  1. Open the dashboard link and sign in with the admin secret."
        "\n  2. API keys -> Generate key. Copy the curl command it shows."
        "\n  3. Paste that command in a second terminal.\n"
        f"\n  Keys are stored in {db_url}. Press Ctrl+C to stop.\n"
    )
    uvicorn.run(app, port=port, log_level="warning")
    return 0
