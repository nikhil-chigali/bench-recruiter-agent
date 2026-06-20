import uuid

import pytest
from sqlalchemy import delete, func, select, update

from callup.db import repositories
from callup.db.models import Org, Recruiter
from callup.db.session import SessionFactory

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]


async def _cleanup(rid: uuid.UUID, org_id: uuid.UUID) -> None:
    async with SessionFactory() as s:
        # Null the circular FK before deleting the recruiter row it references.
        await s.execute(update(Org).where(Org.id == org_id).values(owner_recruiter_id=None))
        await s.execute(delete(Recruiter).where(Recruiter.id == rid))
        await s.execute(delete(Org).where(Org.id == org_id))
        await s.commit()


async def test_create_owned_org_creates_owner_and_named_org():
    rid = uuid.uuid4()
    email = f"{rid}@example.com"
    org_id = None
    try:
        async with SessionFactory() as session:
            recruiter = await repositories.create_owned_org(
                session, rid, email, "Acme Staffing", "Jane Doe"
            )
            org_id = recruiter.org_id
            assert recruiter.id == rid
            assert recruiter.role == "owner"
            assert recruiter.name == "Jane Doe"
            assert recruiter.email == email
            org = await session.get(Org, org_id)
            assert org is not None
            assert org.name == "Acme Staffing"
            assert org.owner_recruiter_id == rid
    finally:
        if org_id is not None:
            await _cleanup(rid, org_id)


async def test_create_owned_org_is_idempotent():
    rid = uuid.uuid4()
    email = f"{rid}@example.com"
    org_id = None
    try:
        async with SessionFactory() as s1:
            first = await repositories.create_owned_org(s1, rid, email, "Acme", "Jane")
            org_id = first.org_id
        async with SessionFactory() as s2:
            second = await repositories.create_owned_org(s2, rid, email, "Acme", "Jane")
            assert second.id == rid
            assert second.org_id == org_id
            org_count = await s2.scalar(
                select(func.count()).select_from(Org).where(Org.owner_recruiter_id == rid)
            )
            assert org_count == 1
    finally:
        if org_id is not None:
            await _cleanup(rid, org_id)
