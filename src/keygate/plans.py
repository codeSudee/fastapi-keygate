"""Plan catalog and the pure limit checks behind it.

A plan is a set of caps applied per ``owner_id`` when keys are created or edited.
Plans live in code, not the database: changing a number is a deploy, not a migration.
"""

from dataclasses import dataclass
from typing import Dict, Iterable, Optional


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    max_keys: Optional[int]  # active keys per owner; None = unlimited
    key_per_minute: Optional[int]  # cap on any one key's limit; None = no cap
    key_per_hour: Optional[int]
    max_scopes: Optional[int]
    wildcard_scope: bool
    price: Optional[str] = None  # display only, USD per month; billing is not wired up


# Proposed numbers, see docs/PLANS.md. Dict order is the upgrade path.
DEFAULT_PLANS: Dict[str, Plan] = {
    "free": Plan("free", "Free", 2, 60, 1_000, 3, False, "$0"),
    "pro": Plan("pro", "Pro", 10, 600, 20_000, 20, False, "$12"),
    "team": Plan("team", "Team", 50, 3_000, 100_000, None, True, "$39"),
}


class PlanLimitError(Exception):
    """A key operation would exceed the owner's plan."""

    code = "plan_limit"

    def __init__(
        self,
        message: str,
        limit: str,
        current: Optional[int],
        cap: Optional[int],
        upgrade_to: Optional[str],
    ) -> None:
        super().__init__(message)
        self.limit, self.current, self.cap, self.upgrade_to = limit, current, cap, upgrade_to

    def payload(self) -> dict:
        return {
            "detail": str(self),
            "code": self.code,
            "limit": self.limit,
            "current": self.current,
            "cap": self.cap,
            "upgrade_to": self.upgrade_to,
        }


def upgrade_path(plans: Dict[str, Plan], plan: Plan) -> Optional[str]:
    """The next plan in catalog order, if any."""
    ids = list(plans)
    i = ids.index(plan.id) if plan.id in ids else len(ids) - 1
    return ids[i + 1] if i + 1 < len(ids) else None


def clamp_limit(requested: Optional[int], cap: Optional[int]) -> Optional[int]:
    """Apply a plan cap to a requested key limit (None means unlimited)."""
    if cap is None:
        return requested
    return cap if requested is None else min(requested, cap)


def check_key_count(plans: Dict[str, Plan], plan: Plan, active: int) -> None:
    if plan.max_keys is not None and active >= plan.max_keys:
        raise PlanLimitError(
            f"Your {plan.name} plan allows {plan.max_keys} active keys.",
            "max_keys", active, plan.max_keys, upgrade_path(plans, plan),
        )


def check_scopes(plans: Dict[str, Plan], plan: Plan, scopes: Iterable[str]) -> None:
    scopes = list(scopes)
    if "*" in scopes and not plan.wildcard_scope:
        raise PlanLimitError(
            f"The {plan.name} plan doesn't include the * scope.",
            "wildcard_scope", None, None, upgrade_path(plans, plan),
        )
    if plan.max_scopes is not None and len(scopes) > plan.max_scopes:
        raise PlanLimitError(
            f"Your {plan.name} plan allows {plan.max_scopes} scopes per key.",
            "max_scopes", len(scopes), plan.max_scopes, upgrade_path(plans, plan),
        )
