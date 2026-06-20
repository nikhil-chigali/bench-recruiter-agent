"""All SQL lives here, including pgvector similarity queries.

Route handlers and worker tasks never write SQL directly — they call repository
functions. The retrieval funnel (freshness window + applied-exclusion + scope filter
combined with vector distance ORDER BY) is implemented here in Phase 3.
"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from callup.db.enums import RecruiterRole
from callup.db.models import Org, Recruiter


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
