import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select, update

from callup.db import repositories
from callup.db.models import Invitation, Org, Recruiter
from callup.db.session import SessionFactory

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]


async def _seed_owner_and_member() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    owner_id = uuid.uuid4()
    member_id = uuid.uuid4()
    async with SessionFactory() as s:
        owner = await repositories.create_owned_org(
            s, owner_id, f"{owner_id}@example.com", "Acme", "Owner"
        )
        org_id = owner.org_id
        s.add(
            Recruiter(
                id=member_id, org_id=org_id, role="recruiter",
                name="Member", email=f"{member_id}@example.com",
            )
        )
        await s.commit()
    return org_id, owner_id, member_id


async def _cleanup(org_id: uuid.UUID) -> None:
    async with SessionFactory() as s:
        await s.execute(delete(Invitation).where(Invitation.org_id == org_id))
        await s.execute(update(Org).where(Org.id == org_id).values(owner_recruiter_id=None))
        await s.execute(delete(Recruiter).where(Recruiter.org_id == org_id))
        await s.execute(delete(Org).where(Org.id == org_id))
        await s.commit()


async def test_list_and_role_update():
    org_id, owner_id, member_id = await _seed_owner_and_member()
    try:
        async with SessionFactory() as s:
            members = await repositories.list_members(s, org_id)
            assert {m.id for m in members} == {owner_id, member_id}
            member = await repositories.get_member(s, member_id, org_id)
            await repositories.update_member_role(s, member, "admin")
        async with SessionFactory() as s:
            member = await repositories.get_member(s, member_id, org_id)
            assert member.role == "admin"
    finally:
        await _cleanup(org_id)


async def test_get_member_rejects_cross_org():
    org_id, _, member_id = await _seed_owner_and_member()
    try:
        async with SessionFactory() as s:
            assert await repositories.get_member(s, member_id, uuid.uuid4()) is None
    finally:
        await _cleanup(org_id)


async def test_transfer_ownership_swaps_roles():
    org_id, owner_id, member_id = await _seed_owner_and_member()
    try:
        async with SessionFactory() as s:
            org = await s.get(Org, org_id)
            old = await repositories.get_member(s, owner_id, org_id)
            new = await repositories.get_member(s, member_id, org_id)
            await repositories.transfer_ownership(s, org, old, new)
        async with SessionFactory() as s:
            org = await s.get(Org, org_id)
            assert org.owner_recruiter_id == member_id
            assert (await repositories.get_member(s, member_id, org_id)).role == "owner"
            assert (await repositories.get_member(s, owner_id, org_id)).role == "admin"
    finally:
        await _cleanup(org_id)


async def test_delete_org_cascades():
    org_id, owner_id, member_id = await _seed_owner_and_member()
    deleted = False
    try:
        async with SessionFactory() as s:
            s.add(
                Invitation(
                    org_id=org_id, email="x@example.com", role="recruiter",
                    invited_by=owner_id, token_hash=f"h-{uuid.uuid4()}", status="pending",
                    expires_at=datetime.now(tz=UTC) + timedelta(days=7),
                )
            )
            await s.commit()
        async with SessionFactory() as s:
            org = await s.get(Org, org_id)
            await repositories.delete_org(s, org)
            deleted = True
        async with SessionFactory() as s:
            assert await s.get(Org, org_id) is None
            remaining = await s.scalar(
                select(Recruiter).where(Recruiter.org_id == org_id).limit(1)
            )
            assert remaining is None
            inv = await s.scalar(
                select(Invitation).where(Invitation.org_id == org_id).limit(1)
            )
            assert inv is None
    finally:
        if not deleted:
            await _cleanup(org_id)
