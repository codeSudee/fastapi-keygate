from fastapi import Depends, FastAPI
from keygate import ApiKey, KeyGate

app = FastAPI()
gate = KeyGate(app, admin_secret="change-me")  # SQLite, zero setup

@app.get("/hello")
def hello(key: ApiKey = Depends(gate.require)):
    return {"hello": key.owner_id}

if not gate.list_keys():  # demo only: mint a first key
    print("Your API key:", gate.create_key("demo-tenant", per_minute=5).key)
