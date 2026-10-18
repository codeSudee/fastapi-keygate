from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    """Naive UTC, so SQLite and Postgres behave identically."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class ApiKeyRow(Base):
    __tablename__ = "keygate_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prefix: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    key_hash: Mapped[str] = mapped_column(String(64))
    owner_id: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    per_minute: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    per_hour: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    scopes: Mapped[str] = mapped_column(String(1024), default="", server_default="")  # space-separated


class UsageRow(Base):
    __tablename__ = "keygate_usage"
    __table_args__ = (Index("ix_keygate_usage_key_ts", "key_id", "ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key_id: Mapped[int] = mapped_column(ForeignKey("keygate_keys.id"))
    ts: Mapped[datetime] = mapped_column(DateTime)
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(512))
    status: Mapped[int] = mapped_column(Integer)
