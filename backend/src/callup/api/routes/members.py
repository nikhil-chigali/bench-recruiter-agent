import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentRecruiter, SessionDep
from callup.api.permissions import ensure_can_manage
from callup.api.schemas import MemberOut
from callup.db import repositories
from callup.db.enums import RecruiterRole
from callup.services import membership

router = APIRouter(tags=["members"])

_ASSIGNABLE_ROLES = {RecruiterRole.ADMIN.value, RecruiterRole.RECRUITER.value}


class RoleUpdateIn(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        if v not in _ASSIGNABLE_ROLES:
            raise ValueError("role must be admin or recruiter")
        return v


@router.get("/members", response_model=list[MemberOut])
async def list_members(actor: CurrentRecruiter, session: SessionDep) -> list[MemberOut]:
    members = await repositories.list_members(session, actor.org_id)
    return [MemberOut(id=m.id, name=m.name, email=m.email, role=m.role) for m in members]


@router.patch("/members/{member_id}", response_model=MemberOut)
async def update_member_role(
    member_id: uuid.UUID, body: RoleUpdateIn, actor: CurrentRecruiter, session: SessionDep
) -> MemberOut:
    member = await repositories.get_member(session, member_id, actor.org_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    ensure_can_manage(actor, member.role)
    updated = await repositories.update_member_role(session, member, body.role)
    return MemberOut(id=updated.id, name=updated.name, email=updated.email, role=updated.role)


@router.delete("/members/{member_id}", status_code=204)
async def remove_member(member_id: uuid.UUID, actor: CurrentRecruiter, session: SessionDep) -> None:
    member = await repositories.get_member(session, member_id, actor.org_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    ensure_can_manage(actor, member.role)
    await membership.remove_member(session, member)
