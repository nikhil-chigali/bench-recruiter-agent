import uuid

import pytest
from sqlalchemy import delete, func, select, update

from callup.db import repositories
from callup.db.models import Org, Recruiter
from callup.db.session import SessionFactory

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]


async def test_provision_recruiter_creates_owned_org():
    rid = uuid.uuid4()
    email = f"{rid}@example.com"
    org_id = None
    try:
        async with SessionFactory() as session:
            recruiter = await repositories.provision_recruiter(session, rid, email, "Test")
            org_id = recruiter.org_id
            assert recruiter.id == rid
            assert recruiter.role == "owner"
            assert recruiter.email == email
            org = await session.get(Org, org_id)
            assert org is not None
            assert org.owner_recruiter_id == rid
    finally:
        if org_id is not None:
            async with SessionFactory() as cleanup:
                # Null the circular FK before deleting the recruiter row it references.
                await cleanup.execute(
                    update(Org).where(Org.id == org_id).values(owner_recruiter_id=None)
                )
                await cleanup.execute(delete(Recruiter).where(Recruiter.id == rid))
                await cleanup.execute(delete(Org).where(Org.id == org_id))
                await cleanup.commit()


async def test_provision_recruiter_is_idempotent():
    rid = uuid.uuid4()
    email = f"{rid}@example.com"
    org_id = None
    try:
        async with SessionFactory() as s1:
            first = await repositories.provision_recruiter(s1, rid, email, "Test")
            org_id = first.org_id
        async with SessionFactory() as s2:
            second = await repositories.provision_recruiter(s2, rid, email, "Test")
            assert second.id == rid
            assert second.org_id == org_id
            assert second.name == "Test"
            org_count = await s2.scalar(
                select(func.count()).select_from(Org).where(Org.owner_recruiter_id == rid)
            )
            assert org_count == 1
        # exactly one recruiter, one org for this id
        async with SessionFactory() as s3:
            assert await repositories.get_recruiter(s3, rid) is not None
    finally:
        if org_id is not None:
            async with SessionFactory() as cleanup:
                # Null the circular FK before deleting the recruiter row it references.
                await cleanup.execute(
                    update(Org).where(Org.id == org_id).values(owner_recruiter_id=None)
                )
                await cleanup.execute(delete(Recruiter).where(Recruiter.id == rid))
                await cleanup.execute(delete(Org).where(Org.id == org_id))
                await cleanup.commit()
