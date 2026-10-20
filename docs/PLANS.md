# Paid plans: design proposal

Status: **step 0 implemented for the sync `KeyGate` only** (see "Implemented" below); everything else is still a proposal. Every number below is a starting point for you to change. No market research was done and no prices are proposed; pricing is deliberately left blank.

## Implemented (step 0, sync gate)

- `plans.py`, the `keygate_owners` table, `KeyGate(plans=..., default_plan=...)`, `get_plan`/`set_plan`/`active_key_count`, and `/plans`, `/plan` (GET, PUT) in the dashboard API. Plans are **opt-in**: `plans=None` (the default) enforces nothing, because the Free caps would break existing deployments.
- Enforced at **create/edit time only**: `max_keys` (active keys), per-key limit caps (clamped; unlimited becomes the cap), `max_scopes`, `wildcard_scope`. 402 responses carry `code/limit/current/cap/upgrade_to`.
- **Deferred:** owner-level rate windows, per-plan retention (`prune_by_plan`, range clamping), the async gate, pricing UI, billing. Request-time clamping is implemented: `require` applies the plan's per-key caps on every request, so a downgrade limits existing keys immediately (one extra owner-row query per request when plans are on).
- Known gap: the key-count check and insert are not atomic, so two simultaneous creates can exceed `max_keys` by one.

## Decision (2026-10-20)

Reading **B** is the direction: Keygate stays self-hosted and plans serve the adopter's own customers. Hosted multi-tenant billing (reading A) is deferred until there is demand. Past-due grace is ~14 days, then new keys are blocked and the plan falls back to default; existing keys are never auto-revoked. Not yet implemented.

## 0. Assumption to confirm

A plan attaches to an **owner** (`owner_id`, already on every key). That supports both readings of "payable":

- **A. You host Keygate; each developer account pays you.** Each developer account is one `owner_id`.
- **B. A developer sells plans to their own customers.** Each customer tenant is an `owner_id`.

The data model is the same for both. What differs is who the dashboard login represents (see open question 1).

## 1. Proposed tiers

| | Free | Pro | Team |
|---|---|---|---|
| Active keys per owner | 2 | 10 | 50 |
| Per-key cap, per minute | 60 | 600 | 3,000 |
| Per-key cap, per hour | 1,000 | 20,000 | 100,000 |
| Per-owner total, per minute | 100 | 1,500 | 10,000 |
| Per-owner total, per hour | 3,000 | 60,000 | 500,000 |
| Usage history kept | 7 days | 30 days | 90 days |
| Scopes per key | 3 | 20 | unlimited, `*` allowed |
| Key rotation, expiry, revoke | yes | yes | yes |
| Price (USD/month) | $0 | $12 | $39 |

Rationale (proposals):
- **Free: 2 keys.** Enough for one prod and one staging key, which is what a trial needs.
- **Free: 7 days.** Covers the dashboard's 1h, 24h and 7d ranges.
- **Pro: 30 days.** Matches the dashboard's longest range (30d).
- **Team: 90 days.** Matches the existing `prune_usage` default.
- **Per-owner totals are well under keys × per-key caps.** One owner can't consume the whole limiter by minting many keys. Adjust the ratio to taste.
- **Security features are on every plan.** Rotation, expiry and revoke are never paywalled.

Plan definitions live **in code**, not the database, so changing a number is a deploy, not a migration:

```python
@dataclass(frozen=True)
class Plan:
    id: str; name: str
    max_keys: Optional[int]               # None = unlimited
    key_per_minute: Optional[int]; key_per_hour: Optional[int]
    owner_per_minute: Optional[int]; owner_per_hour: Optional[int]
    retention_days: Optional[int]
    max_scopes: Optional[int]; wildcard_scope: bool

KeyGate(..., plans=DEFAULT_PLANS, default_plan="free")   # overridable per deployment
```

## 2. Data model fit

**One new table; the existing tables are untouched.**

```
keygate_owners
  owner_id         String(255) PK
  plan             String(32)  NOT NULL          -- id into the in-code catalog
  billing_ref      String(255) NULL              -- opaque external id (e.g. a Stripe customer); unused until task 3
  billing_status   String(16)  NULL              -- "active" | "past_due" | "canceled"; unused until task 3
  plan_changed_at  DateTime
  created_at       DateTime
```

- **No row means the default plan**, so existing deployments keep working after upgrade. A row is created lazily on first plan change.
- **Migration:** `Base.metadata.create_all` already creates new tables, so no `ALTER` is needed. `_add_missing_columns` is only used if a later release adds columns to this table. The async gate runs the same `create_all` inside its existing `init()`.
- **Why not a column on `keygate_keys`:** a plan is per owner, not per key, and would be duplicated across rows.

### Enforcement

All enforcement is at **request and create time**, never by rewriting key rows. A downgrade takes effect immediately and no limits are lost on upgrade.

| Where | Rule |
|---|---|
| `create_key` | Count active keys (not revoked, not expired) for the owner. If the count is at or over `max_keys`, raise `PlanLimitError`. Clamp requested `per_minute`/`per_hour` to the key caps; `None` (unlimited) becomes the cap. Reject scopes over `max_scopes`, and `*` unless `wildcard_scope`. |
| `update_key` | Same clamping and scope checks. |
| `require` / limiter | Effective key limit = `min(key.per_minute, plan.key_per_minute)`. The key lookup becomes `ApiKeyRow LEFT JOIN keygate_owners`, so the plan costs no extra query per request. After the key window, also hit an **owner window** keyed `("keygate-owner", owner_id)`. `RateLimiter.hit` gains a list of `(ident, items)` pairs so test-then-hit stays atomic across both. Headers keep reporting the tightest limit. |
| `prune_usage` | Keep the existing global `prune_usage(older_than)`. Add `prune_by_plan()` that deletes each owner's rows older than their plan's `retention_days` (`DELETE ... WHERE key_id IN (owner keys)`). Run it on the same cron. |
| Dashboard reads | Clamp the `range` parameter to the plan's retention so charts never promise history that was pruned. |

- **Downgrade over the key cap:** existing keys keep working and are never auto-revoked. Creating new keys is blocked until the owner is under the cap, and the UI says so.
- **Async:** `AsyncKeyGate` mirrors this in the same places (`create_key`, `_lookup`, `_hit_locked`, `prune_usage`, `init`). Share the `Plan` dataclass and the pure clamp and validate helpers in one module (`plans.py`). Keep the SQL thin in each gate.

### New gate API (sync; async mirrors it with `await`)

```python
gate.get_plan(owner_id) -> Plan
gate.set_plan(owner_id, plan_id, billing_ref=None, billing_status=None) -> Plan
gate.plan_usage(owner_id) -> PlanUsage   # active_keys, calls_in_retention, owner_rate windows
class PlanLimitError(Exception): code, limit, current, cap, upgrade_to
```

## 3. Dashboard API additions (`src/keygate/dashboard.py`)

All under `/keygate/dashboard/api`, behind the existing bearer token.

| Method | Path | Purpose |
|---|---|---|
| GET | `/plans` | Catalog of plans, for the pricing page. |
| GET | `/plan?owner_id=` | The owner's plan and usage vs limits. |
| PUT | `/plan` | Body `{owner_id, plan}`. Manual change (admin). Task 3's Stripe webhook calls `gate.set_plan` directly. |

```jsonc
// GET /plans
{"plans": [{"id":"free","name":"Free","limits":{"max_keys":2,"key_per_minute":60, "...":"..."},"price":null}], "default":"free"}

// GET /plan?owner_id=acme
{"owner_id":"acme","plan":"free","billing_status":null,
 "limits":{"max_keys":2,"owner_per_minute":100,"retention_days":7, "...":"..."},
 "usage":{"active_keys":2,"calls_7d":1840,
          "owner_rate":[{"window":"minute","limit":100,"remaining":88,"reset_time":1792509019}]},
 "can_create_key":false}
```

`POST /keys` and `PATCH /keys/{id}` return **402** when a plan limit is hit. `detail` stays a string, because `api.ts` reads it as one, and `code` is an extra top-level field:

```json
{"detail":"Your Free plan allows 2 active keys.","code":"plan_limit","limit":"max_keys","current":2,"cap":2,"upgrade_to":"pro"}
```

`/keys` and `/overview` also get `plan` and `retention_days` so the ranges can be clamped.

## 4. What the dashboard should show

- **Plan card (Overview and Settings):** plan name, active keys against the cap, and calls against the owner's rate limit, as quiet meters like the existing `RateMeter`.
- **Usage vs plan:** Key detail shows the effective limit (the lower of the key's limit and the plan cap) and says when the plan is the reason. For example: "Capped at 60/min by your Free plan."
- **Upgrade prompts:** only at the point of a real block (key cap reached, range beyond retention), stating the concrete difference ("Pro allows 10 keys"). One calm inline prompt, never a modal on page load.
- **Honesty rules:** show real current numbers only. No countdowns, no "limited time", no invented scarcity or social proof, and no meters that start above zero. Downgrade and cancel stay as easy to find as upgrade, and the downgrade screen lists exactly what changes (which keys exceed the cap, which history is pruned).

## 5. Open questions

1. Who logs in: you as operator of a multi-tenant host (A), or each developer to see only their own owners (B)? B needs per-owner login. Today the dashboard has one admin secret and sees every owner.
2. Are the tier numbers right, and are three tiers enough?
3. Prices and billing period (monthly only, or annual too)? Currency?
4. Free-tier abuse: any need for email verification or a per-owner creation limit?
5. Past due or canceled: downgrade immediately, or keep the paid plan for a grace period?
6. Retention on downgrade: prune old history right away, or only when the cron next runs?

## Recommended build order

The plan model itself comes first. It isn't one of tasks 2-4, but they all depend on it.

0. **Plan model, sync gate:** `plans.py`, the `keygate_owners` table, enforcement and the new API, with tests.
1. **Async gate support (task 4):** build it right after the model, so the two gates don't drift.
2. **Pricing and billing page (task 2):** works against manual `PUT /plan`, with no payment provider.
3. **Stripe checkout, test mode only (task 3):** last. Checkout and a webhook that calls `gate.set_plan`. Test keys only, signature-verified webhook, idempotent on event id.

## Decisions needed from you

1. Is a plan per `owner_id` the right shape: A (you host) or B (developers sell to their customers)?
2. Approve or edit the tier numbers (keys, rate caps, retention, scopes).
3. Prices and billing periods (left blank here).
4. Grace period on past-due or canceled: immediate downgrade or a delay?
5. Confirm the build order: plan model, then async, then pricing page, then Stripe test mode.
