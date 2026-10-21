# fastapi-keygate: session context

Last updated: 2026-10-21. Read this first in a new session, then verify against the code and `git log`.

## What this is
`fastapi-keygate` (import `keygate`): API-key auth, per-key rate limits and usage tracking for FastAPI.
SQLAlchemy (SQLite default), `limits` for rate limiting. Sync `KeyGate` and `AsyncKeyGate`.
GitHub: codeSudee/fastapi-keygate. PyPI: 0.5.1. Python tests: `.venv/bin/python -m pytest -q`.

## What exists
- Core library, CLI, rotation, scopes, expiry, usage batching/pruning. See README.
- **Web dashboard** (first commit `2a309b4`, since extended):
  - UI in `dashboard/` (React + TS + Tailwind v4 + Framer Motion + Recharts + Lenis). Build: `cd dashboard && npm run build` (outputs to `src/keygate/dashboard_static/`, gitignored).
  - API in `src/keygate/dashboard.py`, mounted with `mount_dashboard(app, gate)`. Login = `admin_secret` exchanged for a 12h signed token.
  - Added to the gate: `get_key`, `update_key`, `rate_status`, `RateLimiter.status`.
  - Demo with seeded data: `python examples/dashboard_demo.py`, secret `demo-secret`, then open `/keygate/dashboard`.
  - Works with both `KeyGate` and `AsyncKeyGate` (handlers are async; sync gate calls run in a thread).
  - Sign-in page explains what Keygate does (two-column on desktop).
  - Default limits set from the Settings page live in memory and reset on restart.

## In progress: paid plans (not shipped)
Design is in `docs/PLANS.md`. User decisions so far:
- Model (revised 2026-10-20, after web research, user approved): **stay self-hosted.** Plans are a feature for the adopter's *own* customers (reading B in `docs/PLANS.md`, one `owner_id` per customer); the adopter's own billing webhook can call `set_plan(..., billing_status=...)`. No hosted multi-tenant service, developer accounts or Stripe inside Keygate until real users ask. The original hosted plan was rejected for lack of demand, solo-maintainer ops cost, and missing tenancy.
- Tier numbers: use the proposals in `docs/PLANS.md`. **Prices (decided): Free $0, Pro $12/mo, Team $39/mo, USD, monthly.** They come from a thin, unverified benchmark (Apitally, Zuplo, Unkey) and are untested against real demand.
- Build order: (0) plan model, sync gate -> (1) async gate support -> (2) pricing/billing page in the dashboard -> (3) Stripe checkout, **test mode only**.
- Done: (0) plan model on the sync gate, request-time clamping of existing keys, and (1) the same on `AsyncKeyGate`, including the dashboard API on both. Deliberately minimal: max_keys, per-key caps, scope limits, 402 on a plan limit. Owner-level rate windows and per-plan retention pruning are deferred.
- Done: (2) read-only Plans page in the dashboard (nav item only when `plans` is enabled; no checkout, says billing isn't connected). Demo now enables plans.
- Step (3) Stripe test mode is deferred indefinitely, see the revised model above.
- Grace period (decided, not yet coded): past-due keeps full access for ~14 days (configurable by the adopter); after that block new keys and fall back to the default plan; never auto-revoke existing keys. Based on dunning guidance of 3-4 retries over 2-3 weeks; verify against Stripe docs before relying on it.

## Where we left off (2026-10-21) / next step: LAUNCH
State: 0.5.1 is RELEASED and pushed (0.5.0 on 2026-10-20). 79 tests pass, 3 skipped. Run `git log --oneline -6` and `git status -sb` to confirm.
- Shipped in 0.5.0: dashboard (phone layout, URL-synced ranges, skeletons, Keys->detail title morph, portaled row menu, sign-in theme toggle and show/hide secret, animation polish), opt-in plans + read-only Plans page, landing site and mock-data demo in `site/`.
- **Release done (2026-10-20):** https://github.com/codeSudee/fastapi-keygate/releases/tag/v0.5.0. The Publish workflow's first run succeeded (it builds the dashboard and asserts the wheel contains `dashboard_static/index.html`). A clean venv `pip install fastapi-keygate==0.5.0` has `dashboard_static/index.html`. Verified 2026-10-20: a server started from that clean PyPI install serves `/keygate/dashboard`, login with `admin_secret` works and the Overview page loads (checked in Chrome).
- **0.5.1 released (2026-10-21):** https://github.com/codeSudee/fastapi-keygate/releases/tag/v0.5.1. Publish and CI passed; a clean venv `pip install fastapi-keygate==0.5.1` runs `keygate quickstart` and serves the dashboard. Changes: new-key dialog shows a ready-to-run `curl` command with the key filled in; new `keygate quickstart` command (`src/keygate/quickstart.py`: empty real dashboard + `/hello`, prints link, random admin secret and next steps; needs `uvicorn`); `examples/dashboard_quickstart.py` and `examples/openai_proxy.py` (Keygate keys in front of an OpenAI call, key read from `OPENAI_API_KEY`, never pasted into chat or files); demo seed fix (demo owners go on the Team plan, `/` redirects to the dashboard, quiet logs).
- **Why 0.5.1 exists:** the user hit every first-run failure in turn. The site's "run locally" steps were wrong (no `-U`, so an old global 0.4.0 shadowed 0.5; no `uvicorn`), `dashboard_demo.py` crashed seeding a fresh database under the Free plan (never run fresh since plans landed; a stale local `.db` hid it), the demo is sample data so it can't show *their* keys (the quickstart is the real path), and Python from python.org on macOS lacks CA certificates (fix: `pip install certifi`, which the OpenAI example uses if present). Lesson: test any first-run path from an empty directory and a fresh venv, not from the repo.
- **Live site (redeployed 2026-10-21 with the Get started / OpenAI / troubleshooting guide at `/#local`; earlier the v0.5 pill, Cloudflare Workers static assets):** https://fastapi-keygate.code-sudeepto.workers.dev (`/` landing, `/demo/` dashboard on sample data with hash routes). Redeploy: `cd dashboard && npm run build:demo`, then `cd site && npx wrangler deploy` (wrangler OAuth login is saved on the user's machine; `npx wrangler logout` removes it).
- After release: the launch (user's plan): demo/launch video via HeyGen HyperFrames in a new session plus a dedicated X account. When the user says building is done, explain how the video gets made and leave a pasteable brief (see memory `launch-plan`). Never post or create accounts without explicit confirmation.
- Nothing is blocked on decisions. Optional later work: enforce `billing_status` with the grace policy only if demand shows up; sidebar nav discards unsaved Settings edits silently (needs a data router or a confirm in Shell); real-device emulation not tested (phone width checked at 390/360px via iframes).
- Dev loop (the user's own test servers often hold port 8000; check `lsof -nP -iTCP:8000 -sTCP:LISTEN` and use another port instead of killing them): `python examples/dashboard_demo.py` (secret `demo-secret`) serves the built UI at `localhost:8000/keygate/dashboard`; rebuild UI with `cd dashboard && npm run build`. Stop the demo with `pkill -f dashboard_demo.py`.
- Always run `git log --oneline -5` and `git status` first to confirm this file is current.

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
Alembic migrations, async usage batching.
