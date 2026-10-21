# Changelog

## 0.5.1 — 2026-10-21

- Dashboard: the new-key dialog now shows a ready-to-run `curl` command with the key filled in, next to the key itself.
- New `examples/dashboard_quickstart.py`: your own empty dashboard with one protected route (prints the dashboard link and an admin secret). `examples/dashboard_demo.py` stays the sample-data demo.
- Fix: `examples/dashboard_demo.py` no longer crashes seeding a fresh database when plans are enabled; its root URL now redirects to the dashboard.

## 0.5.0 — 2026-10-20

- **Web dashboard:** `mount_dashboard(app, gate)` serves a UI at `/keygate/dashboard` for keys, usage graphs, live rate-limit status, and creating, editing, rotating and revoking keys. Sign in with the `admin_secret` (exchanged for a 12-hour signed token). Works with `KeyGate` and `AsyncKeyGate`. Try it with `python examples/dashboard_demo.py` (secret `demo-secret`), or the [live demo](https://fastapi-keygate.code-sudeepto.workers.dev/demo/) on sample data.
- **Plans (opt-in):** `KeyGate(plans=DEFAULT_PLANS)` (also on `AsyncKeyGate`) attaches a plan to each `owner_id` and enforces `max_keys`, per-key rate caps and scope limits, returning `402` with a `plan_limit` payload. Default catalog: Free, Pro and Team. Caps apply to existing keys at request time, so a downgrade takes effect immediately. New: `get_key`, `update_key`, `get_plan`, `set_plan`, `rate_status`. Billing is not included; prices are display-only.
- Fix: the published wheel now includes the built dashboard UI.
- Known gaps: the key-count check and insert are not atomic, so two simultaneous creates can exceed `max_keys` by one.

## 0.4.0 — 2026-10-18

- **`AsyncKeyGate`:** async twin of `KeyGate` for `sqlite+aiosqlite` / `postgresql+asyncpg` and `async+redis://` stores (`pip install fastapi-keygate[async]`, plus `[asyncpg]`; async Redis uses the `[redis]` extra). Same features: auth, scopes, expiry, rotation, usage, admin API.
- Fix: `keygate.__version__` now reports the installed version (was stuck at 0.1.0).
- CI runs Redis and Postgres integration tests (sync and async).

## 0.3.0 — 2026-10-18

- `gate.prune_usage()` and `DELETE /keygate/usage` to delete old usage rows.
- `keygate` command-line tool (create, list, rotate, revoke, usage, prune).
- `usage_batch_size` option and `gate.flush_usage()` for batched usage logging (default unchanged).
- Contributing/security docs and issue/PR templates.
- Fix: rate-limit check and hit are now atomic within a process.
- Fix: in-memory SQLite (`sqlite://`) no longer breaks under concurrent requests.

## 0.2.0 — 2026-10-18

- **Key expiry:** `create_key(expires_at=..., expires_in=...)`; expired keys get `401`.
- **Scopes:** `create_key(scopes=[...])` and `gate.require_scopes(...)`; missing scope gets `403`, `"*"` matches all.
- **Rotation:** `gate.rotate(key_id, grace=...)` and `POST /keygate/keys/{id}/rotate`.
- Tables created by 0.1.0 are upgraded automatically (new columns added on startup).

## 0.1.0 — 2026-10-18

- Initial release: API-key auth, per-key rate limits, usage tracking, admin API.
