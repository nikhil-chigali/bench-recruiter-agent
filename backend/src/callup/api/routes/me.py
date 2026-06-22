from fastapi import APIRouter
from pydantic import BaseModel

from callup.api.deps import CurrentClaims, SessionDep
from callup.api.schemas import UserOut
from callup.db import repositories
from callup.db.models import Org

router = APIRouter(tags=["me"])


class MeOut(BaseModel):
    onboarded: bool
    user: UserOut | None


@router.get("/me", response_model=MeOut)
async def me(claims: CurrentClaims, session: SessionDep) -> MeOut:
    user = await repositories.get_user(session, claims.sub)
    if user is None:
        return MeOut(onboarded=False, user=None)
    org = await session.get(Org, user.org_id)
    return MeOut(
        onboarded=True,
        user=UserOut(
            id=user.id,
            email=user.email,
            name=user.name,
            role=user.role,
            org_id=user.org_id,
            org_name=org.name,
        ),
    )
