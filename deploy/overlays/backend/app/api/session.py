"""Anonymous session API."""

from fastapi import APIRouter, Depends

from app.services.owner_service import OwnerSession, get_owner_session


router = APIRouter(prefix="/session", tags=["session"])


@router.get("")
async def get_session(owner: OwnerSession = Depends(get_owner_session)) -> dict[str, str]:
    return {"owner_id": owner.owner_id}
