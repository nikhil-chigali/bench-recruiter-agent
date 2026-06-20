import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, update

from callup.db import repositories
from callup.db.enums import InvitationStatus
from callup.db.models import Invitation, Org, Recruiter
from callup.db.session import SessionFactory

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]


async def _make_org_with_owner() -> tuple[uuid.UUID, uuid.UUID]:
    owner_id = uuid.uuid4()
    async with SessionFactory() as s:
        owner = await repositories.create_owned_org(
            s, owner_id, f"{owner_id}@example.com", "Acme", "Owner"
        )
        return owner.org_id, owner_id


async def _cleanup(org_id: uuid.UUID) -> None:
    async with SessionFactory() as s:
        await s.execute(delete(Invitation).where(Invitation.org_id == org_id))
        await s.execute(update(Org).where(Org.id == org_id).values(owner_recruiter_id=None))
        await s.execute(delete(Recruiter).where(Recruiter.org_id == org_id))
        await s.execute(delete(Org).where(Org.id == org_id))
        await s.commit()


async def test_create_and_accept_invitation_creates_member():
    org_id, _ = await _make_org_with_owner()
    invitee_id = uuid.uuid4()
    try:
        async with SessionFactory() as s:
            inv = await repositories.create_invitation(
                s,
                org_id,
                "alice@example.com",
                "recruiter",
                invited_by=(await _owner_id(s, org_id)),
                token_hash="hash-a",
                expires_at=datetime.now(tz=UTC) + timedelta(days=7),
            )
            assert inv.status == InvitationStatus.PENDING.value
        async with SessionFactory() as s:
            inv = await repositories.get_invitation_by_token_hash(s, "hash-a")
            member = await repositories.accept_invitation(
                s, inv, invitee_id, "alice@example.com", "Alice"
            )
            assert member.org_id == org_id
            assert member.role == "recruiter"
        async with SessionFactory() as s:
            inv = await repositories.get_invitation_by_token_hash(s, "hash-a")
            assert inv.status == InvitationStatus.ACCEPTED.value
            assert inv.accepted_by == invitee_id
            assert inv.accepted_at is not None
    finally:
        # _cleanup deletes invitations (including accepted_by refs) before recruiters,
        # so the invitee recruiter is safely removed as part of the org teardown.
        await _cleanup(org_id)


async def test_reinvite_revokes_prior_pending():
    org_id, _ = await _make_org_with_owner()
    try:
        async with SessionFactory() as s:
            oid = await _owner_id(s, org_id)
            await repositories.create_invitation(
                s,
                org_id,
                "bob@example.com",
                "recruiter",
                oid,
                "hash-b1",
                datetime.now(tz=UTC) + timedelta(days=7),
            )
        async with SessionFactory() as s:
            oid = await _owner_id(s, org_id)
            await repositories.create_invitation(
                s,
                org_id,
                "bob@example.com",
                "admin",
                oid,
                "hash-b2",
                datetime.now(tz=UTC) + timedelta(days=7),
            )
        async with SessionFactory() as s:
            pending = await repositories.list_pending_invitations(s, org_id)
            assert len(pending) == 1
            assert pending[0].token_hash == "hash-b2"
            old = await repositories.get_invitation_by_token_hash(s, "hash-b1")
            assert old.status == InvitationStatus.REVOKED.value
    finally:
        await _cleanup(org_id)


async def _owner_id(session, org_id: uuid.UUID) -> uuid.UUID:
    org = await session.get(Org, org_id)
    return org.owner_recruiter_id
