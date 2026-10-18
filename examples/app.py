"""Try it: pip install fastapi-keygate uvicorn && uvicorn app:app"""

from fastapi import Depends, FastAPI
from keygate import ApiKey, KeyGate

app = FastAPI()
gate = KeyGate(app, admin_secret="change-me")  # SQLite file, zero setup


@app.get("/hello")
def hello(key: ApiKey = Depends(gate.require)):
    return {"hello": key.owner_id}


if not gate.list_keys():  # demo only: mint a first key (limit: 5 requests/minute)
    print("\n  Your API key:", gate.create_key("demo-tenant", per_minute=5).key, "\n", flush=True)
