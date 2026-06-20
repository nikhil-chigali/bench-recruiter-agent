from fastapi import APIRouter
from pydantic import BaseModel

from callup.api.deps import CurrentClaims, SessionDep
from callup.api.schemas import RecruiterOut
from callup.db import repositories
from callup.db.models import Org

router = APIRouter(tags=["me"])


class MeOut(BaseModel):
    onboarded: bool
    recruiter: RecruiterOut | None


@router.get("/me", response_model=MeOut)
async def me(claims: CurrentClaims, session: SessionDep) -> MeOut:
    recruiter = await repositories.get_recruiter(session, claims.sub)
    if recruiter is None:
        return MeOut(onboarded=False, recruiter=None)
    org = await session.get(Org, recruiter.org_id)
    return MeOut(
        onboarded=True,
        recruiter=RecruiterOut(
            id=recruiter.id,
            email=recruiter.email,
            name=recruiter.name,
            role=recruiter.role,
            org_id=recruiter.org_id,
            org_name=org.name,
        ),
    )
