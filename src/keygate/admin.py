import hmac
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from .schemas import ApiKey, KeyCreated, UsageStats


class NewKey(BaseModel):
    owner_id: str
    name: Optional[str] = None
    per_minute: Optional[int] = None
    per_hour: Optional[int] = None
    expires_at: Optional[datetime] = None  # naive UTC
    scopes: List[str] = []


def build_router(gate) -> APIRouter:
    def admin(x_admin_secret: str = Header(default="")) -> None:
        if not hmac.compare_digest(x_admin_secret.encode(), gate.admin_secret.encode()):
            raise HTTPException(403, "Invalid admin secret")

    router = APIRouter(prefix="/keygate", tags=["keygate"], dependencies=[Depends(admin)])

    @router.post("/keys", response_model=KeyCreated, status_code=201)
    def create(body: NewKey) -> KeyCreated:
        # Only explicitly-sent limits override the gate defaults (null = unlimited).
        limits = {k: getattr(body, k) for k in ("per_minute", "per_hour") if k in body.model_fields_set}
        return gate.create_key(body.owner_id, body.name, expires_at=body.expires_at, scopes=body.scopes, **limits)

    @router.get("/keys", response_model=List[ApiKey])
    def list_(owner_id: Optional[str] = None, include_revoked: bool = False) -> List[ApiKey]:
        return gate.list_keys(owner_id, include_revoked)

    @router.delete("/keys/{key_id}", status_code=204)
    def revoke(key_id: int) -> None:
        if not gate.revoke(key_id):
            raise HTTPException(404, "Key not found or already revoked")

    @router.post("/keys/{key_id}/rotate", response_model=KeyCreated, status_code=201)
    def rotate(key_id: int, grace_hours: float = 24) -> KeyCreated:
        new = gate.rotate(key_id, timedelta(hours=grace_hours))
        if new is None:
            raise HTTPException(404, "Key not found, revoked or expired")
        return new

    @router.get("/keys/{key_id}/usage", response_model=UsageStats)
    def usage(key_id: int, since: Optional[datetime] = None, last_hours: Optional[float] = None) -> UsageStats:
        return gate.usage(key_id, since, last_hours)

    return router
