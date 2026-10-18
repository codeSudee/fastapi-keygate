# Changelog

## 0.2.0 — 2026-10-18

- **Key expiry:** `create_key(expires_at=..., expires_in=...)`; expired keys get `401`.
- **Scopes:** `create_key(scopes=[...])` and `gate.require_scopes(...)`; missing scope gets `403`, `"*"` matches all.
- **Rotation:** `gate.rotate(key_id, grace=...)` and `POST /keygate/keys/{id}/rotate`.
- Tables created by 0.1.0 are upgraded automatically (new columns added on startup).

## 0.1.0 — 2026-10-18

- Initial release: API-key auth, per-key rate limits, usage tracking, admin API.
