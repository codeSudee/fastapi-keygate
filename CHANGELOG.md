# Changelog

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
