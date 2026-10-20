# fastapi-keygate: session context

Last updated: 2026-10-21. Read this first in a new session, then verify against the code and `git log`.

## What this is
`fastapi-keygate` (import `keygate`): API-key auth, per-key rate limits and usage tracking for FastAPI.
SQLAlchemy (SQLite default), `limits` for rate limiting. Sync `KeyGate` and `AsyncKeyGate`.
GitHub: codeSudee/fastapi-keygate. PyPI: 0.4.0. Python tests: `.venv/bin/python -m pytest -q`.

## What exists
- Core library, CLI, rotation, scopes, expiry, usage batching/pruning. See README.
- **Web dashboard** (commit `2a309b4`):
  - UI in `dashboard/` (React + TS + Tailwind v4 + Framer Motion + Recharts + Lenis). Build: `cd dashboard && npm run build` (outputs to `src/keygate/dashboard_static/`, gitignored).
  - API in `src/keygate/dashboard.py`, mounted with `mount_dashboard(app, gate)`. Login = `admin_secret` exchanged for a 12h signed token.
  - Added to the gate: `get_key`, `update_key`, `rate_status`, `RateLimiter.status`.
  - Demo with seeded data: `python examples/dashboard_demo.py`, secret `demo-secret`, then open `/keygate/dashboard`.
  - Works with both `KeyGate` and `AsyncKeyGate` (handlers are async; sync gate calls run in a thread).
  - Sign-in page explains what Keygate does (two-column on desktop).
  - Default limits set from the Settings page live in memory and reset on restart.

## In progress: paid plans (not shipped)
Design is in `docs/PLANS.md`. User decisions so far:
- Model: **each developer pays the user** (hosted product), a plan per `owner_id`.
- Tier numbers: use the proposals in `docs/PLANS.md`. **Prices: undecided (left None).**
- Build order: (0) plan model, sync gate -> (1) async gate support -> (2) pricing/billing page in the dashboard -> (3) Stripe checkout, **test mode only**.
- Done: (0) plan model on the sync gate, request-time clamping of existing keys, and (1) the same on `AsyncKeyGate`, including the dashboard API on both. Deliberately minimal: max_keys, per-key caps, scope limits, 402 on a plan limit. Owner-level rate windows and per-plan retention pruning are deferred.
- Next: (2) pricing/billing page in the dashboard (needs prices from the user), (3) Stripe test mode.
- Grace period on past-due/canceled plans: undecided. Leaning: block new keys immediately, never auto-revoke existing keys, decide any grace period at the Stripe step.

Check `git log` and `git status` for how far step 0 got before assuming anything.

## Known gaps and honest risks
- Plans: count-then-insert race can exceed `max_keys` by one; an unknown stored plan id silently falls back to the default plan; the older `/keygate/keys` admin route returns 402 but is untested.
- **The hosted "developers pay me" model has no foundation yet.** Keygate is self-hosted: one deployment, one admin secret, one database. Charging developers needs developer accounts/login, tenant isolation, and a way for their usage to reach the user's service (user hosts the gate, or apps send data in). None of that exists or is designed.
- No evidence of demand yet: 0.x alpha library, no user data seen. Billing is expensive to build and easy to build too early.
- Never put real payment keys in the repo. Stripe work is test mode only; webhooks must be signature-verified and idempotent.

## Working agreements with the user
- Be direct and truthful, including harsh reality checks. Do not over-engineer ("don't supercode").
- Commit with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, short imperative subject. Push to `main` when the user asks to commit.
- Confirm before outward-facing actions (releases, publishing). Release flow: bump `version` in `pyproject.toml`, push, `gh release create vX.Y.Z`.
- Website work: follow `~/.claude/skills/website-build-stack`. The user named Framer Motion over GSAP for the dashboard.
- The conversion-psychology skill applies only to sell/sign-up pages. The pricing page is the first place it may legitimately apply, with no fake urgency, scarcity or progress.

## Roadmap, not started
Skeleton loader for first paint, URL-synced filters/ranges, unsaved-changes warning, Alembic migrations, async usage batching.
