# fastapi-keygate: session context

Last updated: 2026-10-20. Read this first in a new session, then verify against the code and `git log`.

## What this is
`fastapi-keygate` (import `keygate`): API-key auth, per-key rate limits and usage tracking for FastAPI.
SQLAlchemy (SQLite default), `limits` for rate limiting. Sync `KeyGate` and `AsyncKeyGate`.
GitHub: codeSudee/fastapi-keygate. PyPI: 0.4.0 (0.5.0 prepared, see below). Python tests: `.venv/bin/python -m pytest -q`.

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

## Where we left off (2026-10-20) / next step: RELEASE 0.5.0
State: 78 tests pass, 3 skipped. `main` has commits ahead of `origin/main` (unpushed); run `git log --oneline -6` and `git status -sb`. Everything below is built and verified locally.
- Shipped on main, unreleased: dashboard (with phone layout, URL-synced ranges, skeletons, Keys->detail title morph, portaled row menu, sign-in page theme toggle and show/hide secret, animation polish), opt-in plans + read-only Plans page, landing site and mock-data demo in `site/`.
- **Live site (deployed 2026-10-20, Cloudflare Workers static assets):** https://fastapi-keygate.code-sudeepto.workers.dev (`/` landing, `/demo/` dashboard on sample data with hash routes). Redeploy: `cd dashboard && npm run build:demo`, then `cd site && npx wrangler deploy` (wrangler OAuth login is saved on the user's machine; `npx wrangler logout` removes it).
- **0.5.0 is prepared but NOT released.** Already done: `pyproject.toml` version 0.5.0, CHANGELOG entry dated 2026-10-20, README dashboard/plans sections, and a packaging fix: `pyproject.toml` `artifacts` plus `.github/workflows/publish.yml` now builds the dashboard (Node 22, `npm ci && npm run build`) and asserts the wheel contains `dashboard_static/index.html`. Before this fix a release would have shipped without the UI (the 0.4.0 wheel has none). A local build produced a wheel with 21 UI files. The publish workflow itself has never run: watch its first run.
- **Remaining release steps (user said they will do it in a new session):**
  1. Landing page pill in `site/public/index.html` says "Alpha, v0.4 on PyPI": change to v0.5.
  2. `git push origin main`.
  3. Confirm with the user, then `gh release create v0.5.0` (triggers PyPI trusted publishing, irreversible). Release flow also in memory `project-status`.
  4. Watch the Publish workflow (`gh run watch`), then confirm PyPI shows 0.5.0 and `pip install` in a clean venv gives a dashboard that serves its UI (`mount_dashboard` + open `/keygate/dashboard`).
  5. Redeploy the site (`dashboard` demo build + `wrangler deploy`) so the pill matches.
- After release: the launch (user's plan): demo/launch video via HeyGen HyperFrames in a new session plus a dedicated X account. When the user says building is done, explain how the video gets made and leave a pasteable brief (see memory `launch-plan`). Never post or create accounts without explicit confirmation.
- Nothing is blocked on decisions. Optional later work: enforce `billing_status` with the grace policy only if demand shows up; sidebar nav discards unsaved Settings edits silently (needs a data router or a confirm in Shell); real-device emulation not tested (phone width checked at 390/360px via iframes).
- Dev loop: `python examples/dashboard_demo.py` (secret `demo-secret`) serves the built UI at `localhost:8000/keygate/dashboard`; rebuild UI with `cd dashboard && npm run build`. Stop the demo with `pkill -f dashboard_demo.py`.
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
