"""Command-line key management: ``keygate --db sqlite:///keygate.db create alice``."""
import argparse
import os
import sys
from datetime import timedelta
from typing import List, Optional

from .gate import KeyGate


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="keygate", description="Manage fastapi-keygate API keys.")
    p.add_argument(
        "--db",
        default=os.environ.get("KEYGATE_DB", "sqlite:///keygate.db"),
        help="SQLAlchemy database URL (env: KEYGATE_DB; default: sqlite:///keygate.db)",
    )
    sub = p.add_subparsers(dest="command", required=True)

    c = sub.add_parser("create", help="create a key (plaintext is shown once)")
    c.add_argument("owner")
    c.add_argument("--name")
    c.add_argument("--per-minute", type=int)
    c.add_argument("--per-hour", type=int)
    c.add_argument("--unlimited", action="store_true", help="no rate limits")
    c.add_argument("--expires-days", type=float, metavar="N")
    c.add_argument("--scope", action="append", default=[], metavar="S", help="repeatable")

    ls = sub.add_parser("list", help="list keys")
    ls.add_argument("--owner")
    ls.add_argument("--all", action="store_true", help="include revoked keys")

    r = sub.add_parser("revoke", help="revoke a key")
    r.add_argument("id", type=int)

    ro = sub.add_parser("rotate", help="issue a replacement key and retire the old one")
    ro.add_argument("id", type=int)
    ro.add_argument("--grace-hours", type=float, default=24.0)

    u = sub.add_parser("usage", help="show usage stats for a key")
    u.add_argument("id", type=int)
    u.add_argument("--last-hours", type=float)

    pr = sub.add_parser("prune", help="delete old usage rows")
    pr.add_argument("--older-than-days", type=float, default=90.0)
    return p


def _fmt(dt) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else "-"


def _limit(v) -> str:
    return "unlimited" if v is None else str(v)


def _print_new_key(k) -> None:
    print(f"id: {k.id}")
    print(f"key: {k.key}")
    print("WARNING: store this key now; it cannot be shown again.")


def _run(args: argparse.Namespace, gate: KeyGate) -> int:
    cmd = args.command
    if cmd == "create":
        kwargs = {}
        if args.unlimited:
            if args.per_minute is not None or args.per_hour is not None:
                print("error: --unlimited cannot be combined with --per-minute/--per-hour",
                      file=sys.stderr)
                return 2
            kwargs.update(per_minute=None, per_hour=None)
        else:
            if args.per_minute is not None:
                kwargs["per_minute"] = args.per_minute
            if args.per_hour is not None:
                kwargs["per_hour"] = args.per_hour
        if args.expires_days is not None:
            kwargs["expires_in"] = timedelta(days=args.expires_days)
        k = gate.create_key(args.owner, name=args.name, scopes=args.scope, **kwargs)
        _print_new_key(k)
        return 0

    if cmd == "list":
        keys = gate.list_keys(owner_id=args.owner, include_revoked=args.all)
        if not keys:
            print("no keys")
            return 0
        print(f"{'ID':<5} {'PREFIX':<12} {'OWNER':<16} {'NAME':<14} {'MIN':<10} {'HOUR':<10} "
              f"{'EXPIRES':<19} {'STATUS':<8} SCOPES")
        for k in keys:
            print(f"{k.id:<5} {k.prefix:<12} {k.owner_id:<16} {k.name or '-':<14} "
                  f"{_limit(k.per_minute):<10} {_limit(k.per_hour):<10} {_fmt(k.expires_at):<19} "
                  f"{'revoked' if k.revoked_at else 'active':<8} {','.join(k.scopes) or '-'}")
        return 0

    if cmd == "revoke":
        if gate.revoke(args.id):
            print(f"revoked key {args.id}")
            return 0
        print(f"error: key {args.id} not found or already revoked", file=sys.stderr)
        return 1

    if cmd == "rotate":
        k = gate.rotate(args.id, grace=timedelta(hours=args.grace_hours))
        if k is None:
            print(f"error: key {args.id} not found, revoked or expired", file=sys.stderr)
            return 1
        _print_new_key(k)
        print(f"old key {args.id} stays valid for {args.grace_hours:g} more hours")
        return 0

    if cmd == "usage":
        s = gate.usage(args.id, last_hours=args.last_hours)
        print(f"key: {s.key_id}")
        print(f"total: {s.total}")
        print(f"first: {_fmt(s.first_request)}")
        print(f"last: {_fmt(s.last_request)}")
        print("by status:")
        for status, n in sorted(s.by_status.items()):
            print(f"  {status}: {n}")
        print("by endpoint:")
        for ep, n in sorted(s.by_endpoint.items()):
            print(f"  {ep}: {n}")
        return 0

    if cmd == "prune":
        n = gate.prune_usage(timedelta(days=args.older_than_days))
        print(f"pruned {n} usage rows")
        return 0
    return 2  # pragma: no cover


def main(argv: Optional[List[str]] = None) -> int:
    try:
        args = _build_parser().parse_args(argv)
    except SystemExit as e:  # argparse exits; turn that into a return code
        return e.code if isinstance(e.code, int) else 2
    try:
        gate = KeyGate(db_url=args.db)
        return _run(args, gate)
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
