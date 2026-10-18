from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from keygate import ApiKey, KeyGate
from keygate.models import UsageRow


def make(batch):
    app = FastAPI()
    gate = KeyGate(app, db_url="sqlite://", usage_batch_size=batch)

    @app.get("/x")
    def x(key: ApiKey = Depends(gate.require)):
        return "ok"

    return gate, TestClient(app), gate.create_key("acme")


def rows(gate):
    with gate._sessions() as s:
        return s.scalar(select(func.count()).select_from(UsageRow))


def hit(c, k, n=1):
    for _ in range(n):
        assert c.get("/x", headers={"X-API-Key": k.key}).status_code == 200


def test_batch_writes_only_when_full():
    gate, c, k = make(3)
    hit(c, k, 2)
    assert rows(gate) == 0
    hit(c, k)
    assert rows(gate) == 3
    hit(c, k)
    assert rows(gate) == 3


def test_flush_usage():
    gate, c, k = make(10)
    hit(c, k, 4)
    assert rows(gate) == 0
    assert gate.flush_usage() == 4
    assert rows(gate) == 4
    assert gate.flush_usage() == 0


def test_usage_sees_buffered_rows():
    gate, c, k = make(100)
    hit(c, k, 5)
    assert rows(gate) == 0
    assert gate.usage(k.id).total == 5
    assert rows(gate) == 5


def test_default_is_immediate():
    gate, c, k = make(1)
    hit(c, k)
    assert rows(gate) == 1
    assert gate.flush_usage() == 0
