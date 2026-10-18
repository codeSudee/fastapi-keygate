from datetime import datetime
from typing import Dict, Optional

from pydantic import BaseModel, ConfigDict


class ApiKey(BaseModel):
    """A stored key's identity. Never contains the secret."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    prefix: str
    owner_id: str
    name: Optional[str] = None
    per_minute: Optional[int] = None
    per_hour: Optional[int] = None
    created_at: datetime
    revoked_at: Optional[datetime] = None


class KeyCreated(ApiKey):
    """Returned once at creation; ``key`` cannot be recovered later."""

    key: str


class UsageStats(BaseModel):
    key_id: int
    since: Optional[datetime] = None
    total: int
    by_status: Dict[int, int]
    by_endpoint: Dict[str, int]
    first_request: Optional[datetime] = None
    last_request: Optional[datetime] = None
