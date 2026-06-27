"""All SQL lives here, including pgvector similarity queries.

Route handlers and worker tasks never write SQL directly — they call repository
functions. The retrieval funnel (freshness window + applied-exclusion + scope filter
combined with vector distance ORDER BY) is implemented here in Phase 3.
"""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from callup.db.enums import CandidateStatus, InvitationStatus, RecruiterRole
from callup.db.models import (
    Candidate,
    CandidateCertification,
    CandidateEducation,
    CandidateExperience,
    CandidateProject,
    Invitation,
    Org,
    User,
)

if TYPE_CHECKING:
    # Type-only import: the API request model is read for its attributes here, but the
    # db layer must not import the api layer at runtime (one-directional dependency).
    from callup.api.schemas import CandidateCreate


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)


async def create_owned_org(
    session: AsyncSession,
    user_id: uuid.UUID,
    email: str,
    org_name: str,
    display_name: str,
) -> User:
    """Create an org owned by this user and the user row (id = auth uid).

    The user becomes the org owner. Idempotent: if a concurrent request already created
    the user, the unique violation is caught and the existing row returned. Order
    respects the circular org<->user FK: org first (owner null), user next,
    then backfill org.owner_user_id.
    """
    org = Org(name=org_name)
    session.add(org)
    await session.flush()  # assigns org.id

    user = User(
        id=user_id,
        org_id=org.id,
        role=RecruiterRole.OWNER.value,
        name=display_name,
        email=email,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = await get_user(session, user_id)
        if existing is None:  # pragma: no cover - violation implies the row exists
            raise
        return existing

    org.owner_user_id = user.id
    await session.commit()
    await session.refresh(user)
    return user


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
    user_id: uuid.UUID,
    email: str,
    display_name: str,
) -> User:
    """Create the member row for an accepted invite and mark the invite accepted."""
    user = User(
        id=user_id,
        org_id=invitation.org_id,
        role=invitation.role,
        name=display_name,
        email=email,
    )
    session.add(user)
    # Flush the user first so the FK on invitation.accepted_by is satisfied.
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise
    invitation.status = InvitationStatus.ACCEPTED.value
    invitation.accepted_at = datetime.now(tz=UTC)
    invitation.accepted_by = user_id
    await session.commit()
    await session.refresh(user)
    return user


async def list_members(session: AsyncSession, org_id: uuid.UUID) -> list[User]:
    result = await session.execute(
        select(User).where(User.org_id == org_id).order_by(User.created_at)
    )
    return list(result.scalars().all())


async def get_member(session: AsyncSession, user_id: uuid.UUID, org_id: uuid.UUID) -> User | None:
    member = await session.get(User, user_id)
    return member if member is not None and member.org_id == org_id else None


async def update_member_role(session: AsyncSession, member: User, role: str) -> User:
    member.role = role
    await session.commit()
    await session.refresh(member)
    return member


async def remove_member(session: AsyncSession, member: User) -> None:
    """Delete a member, first clearing invitation rows that reference them.

    invitation.invited_by is NOT NULL so it cannot be nulled; deleting the member's
    associated invitation records is the clean fix (mirrors delete_org's ordering).
    """
    await session.execute(
        delete(Invitation).where(
            or_(Invitation.invited_by == member.id, Invitation.accepted_by == member.id)
        )
    )
    await session.delete(member)
    await session.commit()


async def transfer_ownership(
    session: AsyncSession, org: Org, old_owner: User, new_owner: User
) -> None:
    new_owner.role = RecruiterRole.OWNER.value
    old_owner.role = RecruiterRole.ADMIN.value
    org.owner_user_id = new_owner.id
    await session.commit()


async def delete_org(session: AsyncSession, org: Org) -> None:
    """FK-safe cascade: null the circular owner FK, then delete invites, members, org."""
    await session.execute(update(Org).where(Org.id == org.id).values(owner_user_id=None))
    await session.execute(delete(Invitation).where(Invitation.org_id == org.id))
    await session.execute(delete(User).where(User.org_id == org.id))
    await session.execute(delete(Org).where(Org.id == org.id))
    await session.commit()


async def list_candidates(
    session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> list[Candidate]:
    """Candidates in an org, newest first, with experience eager-loaded.

    When ``user_id`` is given, restrict to that assignee (recruiter-scoped view).
    """
    stmt = (
        select(Candidate)
        .where(Candidate.org_id == org_id)
        .options(selectinload(Candidate.experience))
        .order_by(Candidate.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(Candidate.user_id == user_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_candidate(
    session: AsyncSession, candidate_id: uuid.UUID, org_id: uuid.UUID
) -> Candidate | None:
    """One candidate scoped to an org, with experience eager-loaded (None if not in the org)."""
    stmt = (
        select(Candidate)
        .where(Candidate.id == candidate_id, Candidate.org_id == org_id)
        .options(selectinload(Candidate.experience))
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_candidate_detail(
    session: AsyncSession, candidate_id: uuid.UUID, org_id: uuid.UUID
) -> Candidate | None:
    """One candidate scoped to an org with all profile children eager-loaded (None if not in org)."""
    stmt = (
        select(Candidate)
        .where(Candidate.id == candidate_id, Candidate.org_id == org_id)
        .options(
            selectinload(Candidate.experience),
            selectinload(Candidate.education),
            selectinload(Candidate.projects),
            selectinload(Candidate.certifications),
        )
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def update_candidate(session: AsyncSession, candidate: Candidate, changes: dict) -> Candidate:
    """Apply a partial set of column changes and return the candidate detail-loaded.

    ``changes`` is the caller's already-validated field→value map (from
    ``CandidateUpdate.model_dump(exclude_unset=True)``); only those columns are written. The PK
    is captured before commit because the default expire-on-commit would otherwise turn the
    post-commit child reads into illegal async lazy loads; we re-fetch with
    ``get_candidate_detail`` to return a fully eager-loaded graph.
    """
    candidate_id = candidate.id
    org_id = candidate.org_id
    # The blind setattr loop is safe ONLY because ``changes`` is the dump of a CandidateUpdate,
    # whose Pydantic v2 default (extra="ignore") drops unknown keys — so identity/derived columns
    # (id, org_id, years_experience, …) never reach here. Do not feed this raw client input.
    for field, value in changes.items():
        setattr(candidate, field, value)
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed


async def create_candidate(
    session: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    data: "CandidateCreate",
) -> Candidate:
    """Persist a candidate and all its children in one transaction; return it detail-loaded.

    The PK is captured before commit because the default expire-on-commit would otherwise
    turn the post-commit child reads into illegal async lazy loads; we re-fetch with
    ``get_candidate_detail`` to return a fully eager-loaded graph.
    """
    candidate = Candidate(
        org_id=org_id,
        user_id=user_id,
        name=data.name,
        title=data.title,
        status=CandidateStatus.ON_BENCH.value,
        primary_skills=data.primary_skills,
        work_authorization=data.work_authorization,
        location=data.location,
        email=data.email,
        phone=data.phone,
        experience=[
            CandidateExperience(
                org_id=org_id,
                company=e.company,
                position=e.position,
                start_date=e.start_date,
                end_date=e.end_date,
            )
            for e in data.experience
        ],
        education=[
            CandidateEducation(org_id=org_id, university=ed.university, degree=ed.degree)
            for ed in data.education
        ],
        projects=[
            CandidateProject(
                org_id=org_id,
                title=p.title,
                project_link=p.project_link,
                github_link=p.github_link,
            )
            for p in data.projects
        ],
        certifications=[
            CandidateCertification(org_id=org_id, name=ct.name, issued_by=ct.issued_by)
            for ct in data.certifications
        ],
    )
    session.add(candidate)
    await session.flush()
    candidate_id = candidate.id
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just created within this transaction
    return refreshed
