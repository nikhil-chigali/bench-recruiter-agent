"""All SQL lives here, including pgvector similarity queries.

Route handlers and worker tasks never write SQL directly — they call repository
functions. The retrieval funnel (freshness window + applied-exclusion + scope filter
combined with vector distance ORDER BY) is implemented here in Phase 3.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from callup.db.enums import InvitationStatus, RecruiterRole
from callup.db.models import Invitation, Org, Recruiter


async def get_recruiter(session: AsyncSession, recruiter_id: uuid.UUID) -> Recruiter | None:
    return await session.get(Recruiter, recruiter_id)


async def create_owned_org(
    session: AsyncSession,
    recruiter_id: uuid.UUID,
    email: str,
    org_name: str,
    display_name: str,
) -> Recruiter:
    """Create an org owned by this recruiter and the recruiter row (id = auth uid).

    The user becomes the org owner. Idempotent: if a concurrent request already created
    the recruiter, the unique violation is caught and the existing row returned. Order
    respects the circular org<->recruiter FK: org first (owner null), recruiter next,
    then backfill org.owner_recruiter_id.
    """
    org = Org(name=org_name)
    session.add(org)
    await session.flush()  # assigns org.id

    recruiter = Recruiter(
        id=recruiter_id,
        org_id=org.id,
        role=RecruiterRole.OWNER.value,
        name=display_name,
        email=email,
    )
    session.add(recruiter)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = await get_recruiter(session, recruiter_id)
        if existing is None:  # pragma: no cover - violation implies the row exists
            raise
        return existing

    org.owner_recruiter_id = recruiter.id
    await session.commit()
    await session.refresh(recruiter)
    return recruiter


async def create_invitation(
    session: AsyncSession,
    org_id: uuid.UUID,
    email: str,
    role: str,
    invited_by: uuid.UUID,
    token_hash: str,
    expires_at: datetime,
) -> Invitation:
    """Create a pending invite, revoking any existing pending invite for the same email."""
    await session.execute(
        update(Invitation)
        .where(
            Invitation.org_id == org_id,
            Invitation.email == email,
            Invitation.status == InvitationStatus.PENDING.value,
        )
        .values(status=InvitationStatus.REVOKED.value)
    )
    invitation = Invitation(
        org_id=org_id,
        email=email,
        role=role,
        invited_by=invited_by,
        token_hash=token_hash,
        status=InvitationStatus.PENDING.value,
        expires_at=expires_at,
    )
    session.add(invitation)
    await session.commit()
    await session.refresh(invitation)
    return invitation


async def list_pending_invitations(session: AsyncSession, org_id: uuid.UUID) -> list[Invitation]:
    result = await session.execute(
        select(Invitation)
        .where(
            Invitation.org_id == org_id,
            Invitation.status == InvitationStatus.PENDING.value,
        )
        .order_by(Invitation.created_at.desc())
    )
    return list(result.scalars().all())


async def get_invitation_by_token_hash(session: AsyncSession, token_hash: str) -> Invitation | None:
    result = await session.execute(select(Invitation).where(Invitation.token_hash == token_hash))
    return result.scalar_one_or_none()


async def revoke_invitation(
    session: AsyncSession, invitation_id: uuid.UUID, org_id: uuid.UUID
) -> Invitation | None:
    invitation = await session.get(Invitation, invitation_id)
    if invitation is None or invitation.org_id != org_id:
        return None
    if invitation.status != InvitationStatus.PENDING.value:
        return None
    invitation.status = InvitationStatus.REVOKED.value
    await session.commit()
    await session.refresh(invitation)
    return invitation


async def accept_invitation(
    session: AsyncSession,
    invitation: Invitation,
    recruiter_id: uuid.UUID,
    email: str,
    display_name: str,
) -> Recruiter:
    """Create the member row for an accepted invite and mark the invite accepted."""
    recruiter = Recruiter(
        id=recruiter_id,
        org_id=invitation.org_id,
        role=invitation.role,
        name=display_name,
        email=email,
    )
    session.add(recruiter)
    # Flush recruiter first so the FK on invitation.accepted_by is satisfied.
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise
    invitation.status = InvitationStatus.ACCEPTED.value
    invitation.accepted_at = datetime.now(tz=UTC)
    invitation.accepted_by = recruiter_id
    await session.commit()
    await session.refresh(recruiter)
    return recruiter


async def list_members(session: AsyncSession, org_id: uuid.UUID) -> list[Recruiter]:
    result = await session.execute(
        select(Recruiter).where(Recruiter.org_id == org_id).order_by(Recruiter.created_at)
    )
    return list(result.scalars().all())


async def get_member(
    session: AsyncSession, recruiter_id: uuid.UUID, org_id: uuid.UUID
) -> Recruiter | None:
    member = await session.get(Recruiter, recruiter_id)
    return member if member is not None and member.org_id == org_id else None


async def update_member_role(session: AsyncSession, member: Recruiter, role: str) -> Recruiter:
    member.role = role
    await session.commit()
    await session.refresh(member)
    return member


async def remove_member(session: AsyncSession, member: Recruiter) -> None:
    await session.delete(member)
    await session.commit()


async def transfer_ownership(
    session: AsyncSession, org: Org, old_owner: Recruiter, new_owner: Recruiter
) -> None:
    new_owner.role = RecruiterRole.OWNER.value
    old_owner.role = RecruiterRole.ADMIN.value
    org.owner_recruiter_id = new_owner.id
    await session.commit()


async def delete_org(session: AsyncSession, org: Org) -> None:
    """FK-safe cascade: null the circular owner FK, then delete invites, members, org."""
    await session.execute(update(Org).where(Org.id == org.id).values(owner_recruiter_id=None))
    await session.execute(delete(Invitation).where(Invitation.org_id == org.id))
    await session.execute(delete(Recruiter).where(Recruiter.org_id == org.id))
    await session.execute(delete(Org).where(Org.id == org.id))
    await session.commit()
