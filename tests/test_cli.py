import re

from keygate import KeyGate
from keygate.cli import main


def run(db, capsys, *args):
    code = main(["--db", db, *args])
    out = capsys.readouterr()
    return code, out.out, out.err


def test_create_list_revoke(tmp_path, capsys):
    db = f"sqlite:///{tmp_path}/k.db"
    code, out, _ = run(db, capsys, "create", "alice", "--name", "n", "--per-minute", "5",
                       "--scope", "read", "--scope", "write", "--expires-days", "2")
    assert code == 0
    assert re.search(r"key: \S+", out) and "cannot be shown again" in out
    run(db, capsys, "create", "bob", "--unlimited")
    code, out, _ = run(db, capsys, "list")
    assert "alice" in out and "bob" in out and "read,write" in out and "unlimited" in out
    code, out, _ = run(db, capsys, "list", "--owner", "bob")
    assert "alice" not in out
    assert run(db, capsys, "revoke", "1")[0] == 0
    assert run(db, capsys, "revoke", "1")[0] == 1
    assert "alice" not in run(db, capsys, "list")[1]
    assert "revoked" in run(db, capsys, "list", "--all")[1]


def test_env_db_and_rotate(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("KEYGATE_DB", f"sqlite:///{tmp_path}/e.db")
    assert main(["create", "carol"]) == 0
    capsys.readouterr()
    assert main(["rotate", "1", "--grace-hours", "1"]) == 0
    assert "key: " in capsys.readouterr().out
    assert main(["rotate", "99"]) == 1
    assert len(KeyGate(db_url=f"sqlite:///{tmp_path}/e.db").list_keys()) == 2


def test_usage_and_prune(tmp_path, capsys):
    db = f"sqlite:///{tmp_path}/u.db"
    run(db, capsys, "create", "dan")
    gate = KeyGate(db_url=db)
    gate._log(1, "GET", "/x", 200)
    gate._log(1, "GET", "/x", 429)
    code, out, _ = run(db, capsys, "usage", "1", "--last-hours", "1")
    assert code == 0 and "total: 2" in out and "/x: 2" in out and "429: 1" in out
    assert "pruned 0" in run(db, capsys, "prune")[1]
    assert "pruned 2" in run(db, capsys, "prune", "--older-than-days", "0")[1]


def test_errors(tmp_path, capsys):
    db = f"sqlite:///{tmp_path}/x.db"
    code, _, err = run(db, capsys, "create", "a", "--unlimited", "--per-hour", "3")
    assert code == 2 and "unlimited" in err
    assert run(db, capsys, "bogus")[0] == 2
    assert run(db, capsys, "create", "a", "--scope", "bad scope")[0] == 1


def test_quickstart_app(tmp_path):
    from fastapi.testclient import TestClient

    from keygate.quickstart import build_app

    app, secret = build_app(f"sqlite:///{tmp_path}/q.db", "s3cret")
    c = TestClient(app)
    assert secret == "s3cret"
    assert c.get("/", follow_redirects=False).headers["location"] == "/keygate/dashboard"
    assert c.get("/hello").status_code == 401
    token = c.post("/keygate/dashboard/api/login", json={"secret": "s3cret"}).json()["token"]
    key = c.post("/keygate/dashboard/api/keys", json={"owner_id": "me"}, headers={"Authorization": f"Bearer {token}"}).json()["key"]
    assert c.get("/hello", headers={"X-API-Key": key}).json() == {"hello": "me"}
