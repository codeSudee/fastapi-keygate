"""Put Keygate in front of OpenAI: callers use Keygate keys, your OpenAI key stays on the server.

    pip install fastapi-keygate uvicorn certifi
    export OPENAI_API_KEY=...            # set in your own terminal, never in code
    python openai_proxy.py

Open the printed dashboard link, create a key, then:
    curl -X POST localhost:8000/v1/ask -H "X-API-Key: <your key>" \\
         -H "Content-Type: application/json" -d '{"prompt": "Say hi in five words"}'

Each Keygate key has its own rate limit and usage, so one caller can't drain your OpenAI budget.
Optional: OPENAI_MODEL (default gpt-4o-mini), KEYGATE_ADMIN_SECRET, OPENAI_BASE_URL.
"""

import json
import os
import secrets
import ssl
import sys
import urllib.error
import urllib.request

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from keygate import ApiKey, KeyGate
from keygate.dashboard import mount_dashboard
from pydantic import BaseModel

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    sys.exit("Set OPENAI_API_KEY in your terminal first:  export OPENAI_API_KEY=...")
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
admin_secret = os.environ.get("KEYGATE_ADMIN_SECRET") or secrets.token_urlsafe(16)

try:  # python.org builds on macOS ship without CA certificates; certifi fixes that if installed
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = None

app = FastAPI()
gate = KeyGate(app, db_url="sqlite:///keygate.db", admin_secret=admin_secret)
mount_dashboard(app, gate)


class Ask(BaseModel):
    prompt: str


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/keygate/dashboard")


@app.post("/v1/ask")
def ask(body: Ask, key: ApiKey = Depends(gate.require)):
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps({"model": MODEL, "messages": [{"role": "user", "content": body.prompt}]}).encode(),
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60, context=SSL_CONTEXT) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:  # never echo the upstream body: it can contain request details
        raise HTTPException(502, f"OpenAI returned HTTP {e.code}")
    except urllib.error.URLError as e:
        print(f"OpenAI connection failed: {e.reason}", file=sys.stderr)  # the reason, for you; callers get a generic error
        raise HTTPException(502, "Could not reach OpenAI")
    return {"owner": key.owner_id, "answer": data["choices"][0]["message"]["content"]}


if __name__ == "__main__":
    print(f"\nDashboard: http://localhost:8000/keygate/dashboard\nAdmin secret: {admin_secret}\n")
    uvicorn.run(app, port=8000, log_level="warning")
