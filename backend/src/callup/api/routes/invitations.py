import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentClaims, CurrentRecruiter, SessionDep
from callup.api.permissions import ensure_can_manage, ensure_manager
from callup.api.schemas import (
    InvitationCreatedOut,
    InvitationOut,
    InvitationPreviewOut,
    RecruiterOut,
)
from callup.config import settings
from callup.db import repositories
from callup.db.enums import InvitationStatus, RecruiterRole
from callup.db.models import Org

router = APIRouter(tags=["invitations"])

INVITE_TTL = timedelta(days=7)
_INVITABLE_ROLES = {RecruiterRole.ADMIN.value, RecruiterRole.RECRUITER.value}


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class InviteCreateIn(BaseModel):
    email: str
    role: str

    @field_validator("email")
    @classmethod
    def _clean_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or len(v) > 320:
            raise ValueError("invalid email")
        return v

    @field_validator("role")
    @classmethod
    def _check_role(cls, v: str) -> str:
        if v not in _INVITABLE_ROLES:
            raise ValueError("role must be admin or recruiter")
        return v


class AcceptIn(BaseModel):
    token: str
    display_name: str

    @field_validator("display_name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 120:
            raise ValueError("must be at most 120 characters")
        return v


@router.post("/invitations", response_model=InvitationCreatedOut, status_code=201)
async def create_invitation(
    body: InviteCreateIn, actor: CurrentRecruiter, session: SessionDep
) -> InvitationCreatedOut:
    ensure_can_manage(actor, body.role)
    raw = secrets.token_urlsafe(32)
    invitation = await repositories.create_invitation(
        session,
        org_id=actor.org_id,
        email=body.email,
        role=body.role,
        invited_by=actor.id,
        token_hash=_hash_token(raw),
        expires_at=datetime.now(tz=UTC) + INVITE_TTL,
    )
    accept_url = f"{settings.frontend_origin}/accept-invite?token={raw}"
    return InvitationCreatedOut(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        status=invitation.status,
        expires_at=invitation.expires_at,
        accept_url=accept_url,
    )


@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(actor: CurrentRecruiter, session: SessionDep) -> list[InvitationOut]:
    ensure_manager(actor)
    invitations = await repositories.list_pending_invitations(session, actor.org_id)
    return [
        InvitationOut(id=i.id, email=i.email, role=i.role, status=i.status, expires_at=i.expires_at)
        for i in invitations
    ]


@router.delete("/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: uuid.UUID, actor: CurrentRecruiter, session: SessionDep
) -> None:
    ensure_manager(actor)
    revoked = await repositories.revoke_invitation(session, invitation_id, actor.org_id)
    if revoked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")


@router.get("/invitations/lookup", response_model=InvitationPreviewOut)
async def lookup_invitation(
    token: str, claims: CurrentClaims, session: SessionDep
) -> InvitationPreviewOut:
    invitation = await repositories.get_invitation_by_token_hash(session, _hash_token(token))
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    org = await session.get(Org, invitation.org_id)
    status_value = invitation.status
    if status_value == InvitationStatus.PENDING.value and invitation.expires_at < datetime.now(
        tz=UTC
    ):
        status_value = "expired"
    return InvitationPreviewOut(
        org_name=org.name if org else "",
        role=invitation.role,
        email=invitation.email,
        status=status_value,
        email_matches=invitation.email == claims.email.lower(),
    )


@router.post("/invitations/accept", response_model=RecruiterOut, status_code=201)
async def accept_invitation(
    body: AcceptIn, claims: CurrentClaims, session: SessionDep
) -> RecruiterOut:
    invitation = await repositories.get_invitation_by_token_hash(session, _hash_token(body.token))
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    if invitation.email != claims.email.lower():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "this invite is for a different email")
    if invitation.status != InvitationStatus.PENDING.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "invitation is no longer valid")
    if invitation.expires_at < datetime.now(tz=UTC):
        raise HTTPException(status.HTTP_409_CONFLICT, "invitation has expired")
    if await repositories.get_recruiter(session, claims.sub) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "already in an org")
    recruiter = await repositories.accept_invitation(
        session, invitation, claims.sub, claims.email.lower(), body.display_name
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
