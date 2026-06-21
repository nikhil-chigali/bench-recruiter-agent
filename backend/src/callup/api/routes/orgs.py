import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentClaims, CurrentRecruiter, SessionDep
from callup.api.permissions import ensure_owner
from callup.api.schemas import RecruiterOut
from callup.db import repositories
from callup.db.models import Org
from callup.services import membership

router = APIRouter(tags=["orgs"])


class OrgCreateIn(BaseModel):
    org_name: str
    display_name: str

    @field_validator("org_name", "display_name")
    @classmethod
    def _clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 120:
            raise ValueError("must be at most 120 characters")
        return v


@router.post("/orgs", response_model=RecruiterOut, status_code=status.HTTP_201_CREATED)
async def create_org(body: OrgCreateIn, claims: CurrentClaims, session: SessionDep) -> RecruiterOut:
    existing = await repositories.get_recruiter(session, claims.sub)
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "already onboarded")
    recruiter = await repositories.create_owned_org(
        session, claims.sub, claims.email, body.org_name, body.display_name
    )
    org = await session.get(Org, recruiter.org_id)
    return RecruiterOut(
        id=recruiter.id,
        email=recruiter.email,
        name=recruiter.name,
        role=recruiter.role,
        org_id=recruiter.org_id,
        org_name=org.name,
    )


class TransferIn(BaseModel):
    recruiter_id: uuid.UUID


@router.post("/orgs/transfer-ownership", status_code=204)
async def transfer_ownership(
    body: TransferIn, actor: CurrentRecruiter, session: SessionDep
) -> None:
    ensure_owner(actor)
    target = await repositories.get_member(session, body.recruiter_id, actor.org_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    if target.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot transfer ownership to yourself")
    org = await session.get(Org, actor.org_id)
    await repositories.transfer_ownership(session, org, actor, target)


@router.delete("/orgs/current", status_code=204)
async def delete_current_org(actor: CurrentRecruiter, session: SessionDep) -> None:
    ensure_owner(actor)
    org = await session.get(Org, actor.org_id)
    await membership.delete_org(session, org)
