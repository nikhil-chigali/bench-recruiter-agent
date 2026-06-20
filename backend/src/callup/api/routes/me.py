import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from callup.api.deps import CurrentRecruiter, SessionDep
from callup.db.models import Org

router = APIRouter(tags=["me"])


class RecruiterOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    org_id: uuid.UUID
    org_name: str


@router.get("/me", response_model=RecruiterOut)
async def me(recruiter: CurrentRecruiter, session: SessionDep) -> RecruiterOut:
    org = await session.get(Org, recruiter.org_id)
    return RecruiterOut(
        id=recruiter.id,
        email=recruiter.email,
        name=recruiter.name,
        role=recruiter.role,
        org_id=recruiter.org_id,
        org_name=org.name,
    )
