import hmac
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from .admin import NewKey
from .schemas import ApiKey, KeyCreated, UsageStats


def build_router(gate) -> APIRouter:
    def admin(x_admin_secret: str = Header(default="")) -> None:
        if not hmac.compare_digest(x_admin_secret.encode(), gate.admin_secret.encode()):
            raise HTTPException(403, "Invalid admin secret")

    router = APIRouter(prefix="/keygate", tags=["keygate"], dependencies=[Depends(admin)])

    @router.post("/keys", response_model=KeyCreated, status_code=201)
    async def create(body: NewKey) -> KeyCreated:
        limits = {k: getattr(body, k) for k in ("per_minute", "per_hour") if k in body.model_fields_set}
        return await gate.create_key(
            body.owner_id, body.name, expires_at=body.expires_at, scopes=body.scopes, **limits
        )

    @router.get("/keys", response_model=List[ApiKey])
    async def list_(owner_id: Optional[str] = None, include_revoked: bool = False) -> List[ApiKey]:
        return await gate.list_keys(owner_id, include_revoked)

    @router.delete("/keys/{key_id}", status_code=204)
    async def revoke(key_id: int) -> None:
        if not await gate.revoke(key_id):
            raise HTTPException(404, "Key not found or already revoked")

    @router.post("/keys/{key_id}/rotate", response_model=KeyCreated, status_code=201)
    async def rotate(key_id: int, grace_hours: float = 24) -> KeyCreated:
        new = await gate.rotate(key_id, timedelta(hours=grace_hours))
        if new is None:
            raise HTTPException(404, "Key not found, revoked or expired")
        return new

    @router.delete("/usage")
    async def prune_usage(older_than_days: float = 90) -> dict:
        return {"deleted": await gate.prune_usage(timedelta(days=older_than_days))}

    @router.get("/keys/{key_id}/usage", response_model=UsageStats)
    async def usage(
        key_id: int, since: Optional[datetime] = None, last_hours: Optional[float] = None
    ) -> UsageStats:
        return await gate.usage(key_id, since, last_hours)

    return router
