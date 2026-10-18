from datetime import datetime
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .models import UsageRow, utcnow
from .schemas import UsageStats


def log_request(session: Session, key_id: int, method: str, path: str, status: int) -> None:
    session.add(
        UsageRow(key_id=key_id, ts=utcnow(), method=method, path=path, status=status)
    )
    session.commit()


def prune(session: Session, before: datetime) -> int:
    """Delete usage rows older than ``before``; returns how many were removed."""
    result = session.execute(delete(UsageRow).where(UsageRow.ts < before))
    session.commit()
    return result.rowcount


def get_stats(session: Session, key_id: int, since: Optional[datetime] = None) -> UsageStats:
    cond = [UsageRow.key_id == key_id]
    if since is not None:
        cond.append(UsageRow.ts >= since)

    def grouped(col):
        rows = session.execute(select(col, func.count()).where(*cond).group_by(col)).all()
        return {k: n for k, n in rows}

    first, last, total = session.execute(
        select(func.min(UsageRow.ts), func.max(UsageRow.ts), func.count()).where(*cond)
    ).one()
    return UsageStats(
        key_id=key_id,
        since=since,
        total=total,
        by_status=grouped(UsageRow.status),
        by_endpoint=grouped(UsageRow.method + " " + UsageRow.path),
        first_request=first,
        last_request=last,
    )
