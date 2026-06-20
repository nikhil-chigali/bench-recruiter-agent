# Team Invitations & Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners/admins invite teammates via email-bound shareable links, manage the member roster with role-gated permissions, and give the owner ownership-transfer + org-deletion.

**Architecture:** A new `invitation` table backs email-bound, single-use, expiring token links (only the sha256 of the token is stored). Logic lives in `db/repositories.py` (all SQL) and a small pure `api/permissions.py`; routes stay thin. The frontend adds an `/accept-invite` page (reachable pre-onboarding) plus dashboard sections for members, invites, and an owner-only danger zone.

**Tech Stack:** FastAPI, async SQLAlchemy 2.0, Pydantic v2, Alembic, pytest/pytest-asyncio (backend); React 19 + Vite + TS strict, React Router v7, Tailwind v4, shadcn/ui (frontend).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-20-team-invitations-and-roles-design.md`.
- **Backend style:** all SQL in `db/repositories.py`; routes thin; `async def` handlers; validate at boundary with Pydantic; enum-like values stored as plain strings validated via `callup.db.enums`. Line length 100 (ruff + black; black excludes `alembic/versions`).
- **No new runtime deps.** Do not add `email-validator`/`EmailStr` — validate email with stdlib. Tokens via stdlib `secrets` + `hashlib`.
- **Backend tests:** unit-first; fast suite (`uv run pytest -m "not integration"`) hits no DB/network; DB tests behind `@pytest.mark.integration` with FK-safe cleanup.
- **Frontend:** pnpm only; `fetch` via the `api` client (no other HTTP lib); shadcn primitives via `pnpm dlx shadcn@latest add <name>`; TS strict, no `any`; Tailwind inline; **no frontend tests** — verify with `pnpm tsc --noEmit` + `pnpm lint` + `pnpm build`.
- **Permission hierarchy:** owner > admins (peers) > recruiters. Admins act on recruiters only; modifying/removing an admin or the owner is owner-only; promotion to `owner` only via transfer; transfer + delete are owner-only.
- **Token:** `secrets.token_urlsafe(32)`; store `sha256(token)` hex only; 7-day expiry; single-use; re-invite revokes the prior pending invite for the same `(org_id, email)`.
- All commit messages follow the repo's existing imperative style.

---

### Task 1: Invitation model, enum, and migration

**Files:**
- Modify: `backend/src/callup/db/enums.py`
- Create: `backend/src/callup/db/models/invitation.py`
- Modify: `backend/src/callup/db/models/__init__.py`
- Create: `backend/alembic/versions/<generated>_add_invitation_table.py` (via autogenerate)
- Modify: `backend/alembic/README.md`
- Test: `backend/tests/db/test_models.py`

**Interfaces:**
- Consumes: `Base`, `TenantMixin`, `TimestampMixin` from `callup.db.base`.
- Produces:
  - `callup.db.enums.InvitationStatus` (StrEnum: `PENDING="pending"`, `ACCEPTED="accepted"`, `REVOKED="revoked"`).
  - `callup.db.models.Invitation` with columns: `id: uuid`, `org_id: uuid` (TenantMixin), `email: str`, `role: str`, `token_hash: str` (unique), `status: str`, `invited_by: uuid`, `expires_at: datetime`, `accepted_at: datetime | None`, `accepted_by: uuid | None`, `created_at`/`updated_at`.

- [ ] **Step 1: Add the enum**

In `backend/src/callup/db/enums.py`, after `RecruiterRole`:

```python
class InvitationStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REVOKED = "revoked"
```

- [ ] **Step 2: Create the model**

Create `backend/src/callup/db/models/invitation.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from callup.db.base import Base, TenantMixin, TimestampMixin
from callup.db.enums import InvitationStatus


class Invitation(Base, TenantMixin, TimestampMixin):
    """An email-bound invite to join an org with a role. Only the token hash is stored."""

    __tablename__ = "invitation"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default=InvitationStatus.PENDING.value
    )
    invited_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recruiter.id"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recruiter.id"), nullable=True
    )
```

- [ ] **Step 3: Register the model**

In `backend/src/callup/db/models/__init__.py`, add the import and `__all__` entry:

```python
from callup.db.models.invitation import Invitation
from callup.db.models.job import JobPosting
from callup.db.models.org import Org, Recruiter
```

Add `"Invitation",` to the `__all__` list (after `"Recruiter",`).

- [ ] **Step 4: Write the failing model test**

Create `backend/tests/db/test_models.py`:

```python
from callup.db.enums import InvitationStatus
from callup.db.models import Base, Invitation


def test_invitation_status_values():
    assert {s.value for s in InvitationStatus} == {"pending", "accepted", "revoked"}


def test_invitation_table_registered():
    table = Base.metadata.tables["invitation"]
    expected = {
        "id", "org_id", "email", "role", "token_hash", "status",
        "invited_by", "expires_at", "accepted_at", "accepted_by",
        "created_at", "updated_at",
    }
    assert expected <= set(table.columns.keys())
    assert table.columns["token_hash"].unique is True


def test_invitation_model_importable():
    assert Invitation.__tablename__ == "invitation"
```

- [ ] **Step 5: Run the test**

Run: `cd backend && uv run pytest tests/db/test_models.py -v`
Expected: PASS (model + enum exist and are registered).

- [ ] **Step 6: Generate the migration**

Run: `cd backend && uv run alembic revision --autogenerate -m "add invitation table"`

Review the generated file. It must `op.create_table("invitation", ...)` with the columns above, a unique constraint/index on `token_hash`, the `org_id` FK + index (from TenantMixin), and FKs on `invited_by`/`accepted_by` → `recruiter.id`. Remove any stray autogenerate diffs unrelated to `invitation`. Ensure `downgrade()` drops the table.

- [ ] **Step 7: Apply the migration**

Run: `cd backend && uv run alembic upgrade head`
Expected: the `invitation` table is created in Supabase. Verify with `uv run alembic current`.

- [ ] **Step 8: Document the migration**

In `backend/alembic/README.md`, add a row to the migration-log table (newest last):

```markdown
| `<rev>` | `161a7bd63439` | 2026-06-20 | Adds the `invitation` table (team invites) |
```

And a detail section:

```markdown
### `<rev>` — add invitation table

Adds `invitation` for slice 3 team invites: `org_id` tenancy FK + index, `email`, `role`,
unique `token_hash` (sha256 of the link token), `status` (`pending`/`accepted`/`revoked`),
`invited_by` + nullable `accepted_by` FKs to `recruiter`, `expires_at`/`accepted_at`.
```

- [ ] **Step 9: Verify fast suite still green**

Run: `cd backend && uv run pytest -m "not integration" -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/callup/db backend/tests/db/test_models.py backend/alembic
git commit -m "Add invitation table, enum, and migration (slice 3)"
```

---

### Task 2: Permission helpers

**Files:**
- Create: `backend/src/callup/api/permissions.py`
- Test: `backend/tests/api/test_permissions.py`

**Interfaces:**
- Consumes: `callup.db.enums.RecruiterRole`, `callup.db.models.Recruiter`.
- Produces (all raise `fastapi.HTTPException(403)` on violation, return `None` otherwise):
  - `ensure_owner(actor: Recruiter) -> None`
  - `ensure_manager(actor: Recruiter) -> None` (role in {owner, admin})
  - `ensure_can_manage(actor: Recruiter, target_role: str) -> None`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/api/test_permissions.py`:

```python
import pytest
from fastapi import HTTPException

from callup.api import permissions
from callup.db.models import Recruiter


def _r(role: str) -> Recruiter:
    return Recruiter(role=role, name="x", email="x@example.com")


def test_ensure_owner_allows_owner():
    permissions.ensure_owner(_r("owner"))  # no raise


@pytest.mark.parametrize("role", ["admin", "recruiter"])
def test_ensure_owner_rejects_non_owner(role):
    with pytest.raises(HTTPException) as e:
        permissions.ensure_owner(_r(role))
    assert e.value.status_code == 403


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_ensure_manager_allows_managers(role):
    permissions.ensure_manager(_r(role))  # no raise


def test_ensure_manager_rejects_recruiter():
    with pytest.raises(HTTPException) as e:
        permissions.ensure_manager(_r("recruiter"))
    assert e.value.status_code == 403


def test_owner_can_manage_admin_and_recruiter():
    permissions.ensure_can_manage(_r("owner"), "admin")
    permissions.ensure_can_manage(_r("owner"), "recruiter")


def test_owner_cannot_manage_owner():
    with pytest.raises(HTTPException) as e:
        permissions.ensure_can_manage(_r("owner"), "owner")
    assert e.value.status_code == 403


def test_admin_can_manage_recruiter_only():
    permissions.ensure_can_manage(_r("admin"), "recruiter")
    for target in ("admin", "owner"):
        with pytest.raises(HTTPException) as e:
            permissions.ensure_can_manage(_r("admin"), target)
        assert e.value.status_code == 403


@pytest.mark.parametrize("target", ["owner", "admin", "recruiter"])
def test_recruiter_can_manage_nobody(target):
    with pytest.raises(HTTPException) as e:
        permissions.ensure_can_manage(_r("recruiter"), target)
    assert e.value.status_code == 403
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/api/test_permissions.py -v`
Expected: FAIL with `ModuleNotFoundError: callup.api.permissions`.

- [ ] **Step 3: Implement the helpers**

Create `backend/src/callup/api/permissions.py`:

```python
from fastapi import HTTPException, status

from callup.db.enums import RecruiterRole
from callup.db.models import Recruiter

_OWNER = RecruiterRole.OWNER.value
_ADMIN = RecruiterRole.ADMIN.value
_RECRUITER = RecruiterRole.RECRUITER.value


def ensure_owner(actor: Recruiter) -> None:
    if actor.role != _OWNER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")


def ensure_manager(actor: Recruiter) -> None:
    if actor.role not in (_OWNER, _ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")


def ensure_can_manage(actor: Recruiter, target_role: str) -> None:
    """Owner manages any non-owner; admin manages only recruiters; recruiter manages none."""
    if actor.role == _OWNER:
        if target_role == _OWNER:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage the owner")
        return
    if actor.role == _ADMIN and target_role == _RECRUITER:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && uv run pytest tests/api/test_permissions.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/callup/api/permissions.py backend/tests/api/test_permissions.py
git commit -m "Add role permission helpers (slice 3)"
```

---

### Task 3: Invitation repository functions

**Files:**
- Modify: `backend/src/callup/db/repositories.py`
- Test: `backend/tests/db/test_invitations_repo.py`

**Interfaces:**
- Consumes: `Invitation`, `Recruiter`, `InvitationStatus`.
- Produces:
  - `create_invitation(session, org_id, email, role, invited_by, token_hash, expires_at) -> Invitation`
  - `list_pending_invitations(session, org_id) -> list[Invitation]`
  - `get_invitation_by_token_hash(session, token_hash) -> Invitation | None`
  - `revoke_invitation(session, invitation_id, org_id) -> Invitation | None`
  - `accept_invitation(session, invitation, recruiter_id, email, display_name) -> Recruiter`

- [ ] **Step 1: Add imports and functions**

In `backend/src/callup/db/repositories.py`, update imports:

```python
import uuid
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from callup.db.enums import InvitationStatus, RecruiterRole
from callup.db.models import Invitation, Org, Recruiter
```

Append:

```python
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


async def get_invitation_by_token_hash(
    session: AsyncSession, token_hash: str
) -> Invitation | None:
    result = await session.execute(
        select(Invitation).where(Invitation.token_hash == token_hash)
    )
    return result.scalar_one_or_none()


async def revoke_invitation(
    session: AsyncSession, invitation_id: uuid.UUID, org_id: uuid.UUID
) -> Invitation | None:
    invitation = await session.get(Invitation, invitation_id)
    if invitation is None or invitation.org_id != org_id:
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
    invitation.status = InvitationStatus.ACCEPTED.value
    invitation.accepted_at = datetime.now(tz=UTC)
    invitation.accepted_by = recruiter_id
    await session.commit()
    await session.refresh(recruiter)
    return recruiter
```

Add `from datetime import UTC, datetime` (replace the bare `datetime` import line above with `from datetime import UTC, datetime`).

- [ ] **Step 2: Write the failing integration tests**

Create `backend/tests/db/test_invitations_repo.py`:

```python
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
                s, org_id, "alice@example.com", "recruiter",
                invited_by=(await _owner_id(s, org_id)),
                token_hash="hash-a", expires_at=datetime.now(tz=UTC) + timedelta(days=7),
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
    finally:
        async with SessionFactory() as s:
            await s.execute(delete(Recruiter).where(Recruiter.id == invitee_id))
            await s.commit()
        await _cleanup(org_id)


async def test_reinvite_revokes_prior_pending():
    org_id, _ = await _make_org_with_owner()
    try:
        async with SessionFactory() as s:
            oid = await _owner_id(s, org_id)
            await repositories.create_invitation(
                s, org_id, "bob@example.com", "recruiter", oid, "hash-b1",
                datetime.now(tz=UTC) + timedelta(days=7),
            )
        async with SessionFactory() as s:
            oid = await _owner_id(s, org_id)
            await repositories.create_invitation(
                s, org_id, "bob@example.com", "admin", oid, "hash-b2",
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
```

- [ ] **Step 3: Run the integration tests**

Run: `cd backend && uv run pytest tests/db/test_invitations_repo.py -v`
Expected: PASS (requires live Supabase via `backend/.env`).

- [ ] **Step 4: Verify fast suite untouched**

Run: `cd backend && uv run pytest -m "not integration" -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/callup/db/repositories.py backend/tests/db/test_invitations_repo.py
git commit -m "Add invitation repository functions (slice 3)"
```

---

### Task 4: Member & org-lifecycle repository functions

**Files:**
- Modify: `backend/src/callup/db/repositories.py`
- Test: `backend/tests/db/test_members_repo.py`

**Interfaces:**
- Consumes: `Org`, `Recruiter`, `Invitation`, `RecruiterRole` (already imported in Task 3).
- Produces:
  - `list_members(session, org_id) -> list[Recruiter]`
  - `get_member(session, recruiter_id, org_id) -> Recruiter | None`
  - `update_member_role(session, member, role) -> Recruiter`
  - `remove_member(session, member) -> None`
  - `transfer_ownership(session, org, old_owner, new_owner) -> None`
  - `delete_org(session, org) -> None`

- [ ] **Step 1: Add the functions**

Append to `backend/src/callup/db/repositories.py`:

```python
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
    await session.execute(
        update(Org).where(Org.id == org.id).values(owner_recruiter_id=None)
    )
    await session.execute(delete(Invitation).where(Invitation.org_id == org.id))
    await session.execute(delete(Recruiter).where(Recruiter.org_id == org.id))
    await session.execute(delete(Org).where(Org.id == org.id))
    await session.commit()
```

- [ ] **Step 2: Write the failing integration tests**

Create `backend/tests/db/test_members_repo.py`:

```python
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
```

- [ ] **Step 3: Run the integration tests**

Run: `cd backend && uv run pytest tests/db/test_members_repo.py -v`
Expected: PASS.

- [ ] **Step 4: Verify fast suite**

Run: `cd backend && uv run pytest -m "not integration" -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/callup/db/repositories.py backend/tests/db/test_members_repo.py
git commit -m "Add member and org-lifecycle repository functions (slice 3)"
```

---

### Task 5: Invitation routes + response schemas

**Files:**
- Modify: `backend/src/callup/api/schemas.py`
- Create: `backend/src/callup/api/routes/invitations.py`
- Modify: `backend/src/callup/main.py`
- Test: `backend/tests/api/test_invitations.py`

**Interfaces:**
- Consumes: `CurrentClaims`, `CurrentRecruiter`, `SessionDep` (from `api.deps`); `permissions.ensure_manager`, `permissions.ensure_can_manage`; the Task 3 repository functions; `settings.frontend_origin`.
- Produces (in `api/schemas.py`):
  - `MemberOut(id, name, email, role)` — used by Task 6 too.
  - `InvitationOut(id, email, role, status, expires_at)` — list item.
  - `InvitationCreatedOut(id, email, role, status, expires_at, accept_url)`.
  - `InvitationPreviewOut(org_name, role, email, status, email_matches)`.
- Produces routes: `POST /invitations`, `GET /invitations`, `DELETE /invitations/{id}`, `GET /invitations/lookup`, `POST /invitations/accept`.

- [ ] **Step 1: Add response schemas**

Append to `backend/src/callup/api/schemas.py`:

```python
import datetime as _dt


class MemberOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    status: str
    expires_at: _dt.datetime


class InvitationCreatedOut(InvitationOut):
    accept_url: str


class InvitationPreviewOut(BaseModel):
    org_name: str
    role: str
    email: str
    status: str
    email_matches: bool
```

- [ ] **Step 2: Write the failing route tests**

Create `backend/tests/api/test_invitations.py`:

```python
import uuid
from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_claims, get_current_recruiter
from callup.auth.jwt import TokenClaims
from callup.db import repositories
from callup.db.models import Invitation, Recruiter
from callup.db.session import get_session
from callup.main import app

SUB = uuid.uuid4()
ORG = uuid.uuid4()


def _claims() -> TokenClaims:
    return TokenClaims(sub=SUB, email="actor@example.com")


def _actor(role: str) -> Recruiter:
    return Recruiter(id=SUB, org_id=ORG, role=role, name="Actor", email="actor@example.com")


class _SessionNoRecruiter:
    async def get(self, model, pk):
        return None


async def _client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_invite_rejects_owner_role():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("owner")
    try:
        async with await _client() as c:
            resp = await c.post("/invitations", json={"email": "a@x.com", "role": "owner"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_admin_cannot_invite_admin():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("admin")
    try:
        async with await _client() as c:
            resp = await c.post("/invitations", json={"email": "a@x.com", "role": "admin"})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_list_invitations():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("recruiter")
    try:
        async with await _client() as c:
            resp = await c.get("/invitations")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_accept_email_mismatch(monkeypatch):
    inv = Invitation(
        id=uuid.uuid4(), org_id=ORG, email="other@example.com", role="recruiter",
        invited_by=uuid.uuid4(), token_hash="h", status="pending",
        expires_at=datetime.now(tz=UTC) + timedelta(days=7),
    )

    async def fake_lookup(session, token_hash):
        return inv

    monkeypatch.setattr(repositories, "get_invitation_by_token_hash", fake_lookup)
    app.dependency_overrides[get_current_claims] = _claims
    app.dependency_overrides[get_session] = lambda: _SessionNoRecruiter()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/invitations/accept", json={"token": "raw", "display_name": "Actor"}
            )
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_accept_non_pending_conflicts(monkeypatch):
    inv = Invitation(
        id=uuid.uuid4(), org_id=ORG, email="actor@example.com", role="recruiter",
        invited_by=uuid.uuid4(), token_hash="h", status="revoked",
        expires_at=datetime.now(tz=UTC) + timedelta(days=7),
    )

    async def fake_lookup(session, token_hash):
        return inv

    monkeypatch.setattr(repositories, "get_invitation_by_token_hash", fake_lookup)
    app.dependency_overrides[get_current_claims] = _claims
    app.dependency_overrides[get_session] = lambda: _SessionNoRecruiter()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/invitations/accept", json={"token": "raw", "display_name": "Actor"}
            )
        assert resp.status_code == 409
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && uv run pytest tests/api/test_invitations.py -v`
Expected: FAIL (route not registered → 404, or import error).

- [ ] **Step 4: Implement the routes**

Create `backend/src/callup/api/routes/invitations.py`:

```python
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
        InvitationOut(
            id=i.id, email=i.email, role=i.role, status=i.status, expires_at=i.expires_at
        )
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
    if (
        status_value == InvitationStatus.PENDING.value
        and invitation.expires_at < datetime.now(tz=UTC)
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
```

Note: register order matters — define `/invitations/lookup` and `/invitations/accept` before `/invitations/{invitation_id}` is **not** required here because `lookup`/`accept` are distinct path segments under `/invitations/...` only on DELETE/GET-by-id; FastAPI matches static segments (`lookup`, `accept`) ahead of the `{invitation_id}` converter regardless of declaration order. Keep as written.

- [ ] **Step 5: Register the router**

In `backend/src/callup/main.py`, update the import and registration:

```python
from callup.api.routes import health, invitations, me, orgs
```

```python
    app.include_router(me.router)
    app.include_router(orgs.router)
    app.include_router(invitations.router)
```

- [ ] **Step 6: Run the route tests**

Run: `cd backend && uv run pytest tests/api/test_invitations.py -v`
Expected: PASS.

- [ ] **Step 7: Verify full fast suite**

Run: `cd backend && uv run pytest -m "not integration" -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/callup/api/schemas.py backend/src/callup/api/routes/invitations.py backend/src/callup/main.py backend/tests/api/test_invitations.py
git commit -m "Add invitation routes (slice 3)"
```

---

### Task 6: Member & org-lifecycle routes

**Files:**
- Create: `backend/src/callup/api/routes/members.py`
- Modify: `backend/src/callup/api/routes/orgs.py`
- Modify: `backend/src/callup/main.py`
- Test: `backend/tests/api/test_members.py`

**Interfaces:**
- Consumes: `CurrentRecruiter`, `SessionDep`; `permissions.ensure_can_manage`, `permissions.ensure_owner`; `MemberOut`; Task 4 repository functions.
- Produces routes: `GET /members`, `PATCH /members/{id}`, `DELETE /members/{id}`, `POST /orgs/transfer-ownership`, `DELETE /orgs/current`.

- [ ] **Step 1: Write the failing route tests**

Create `backend/tests/api/test_members.py`:

```python
import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_recruiter
from callup.db import repositories
from callup.db.models import Recruiter
from callup.db.session import get_session
from callup.main import app

ORG = uuid.uuid4()
ACTOR = uuid.uuid4()
TARGET = uuid.uuid4()


def _actor(role: str) -> Recruiter:
    return Recruiter(id=ACTOR, org_id=ORG, role=role, name="Actor", email="actor@example.com")


def _target(role: str) -> Recruiter:
    return Recruiter(id=TARGET, org_id=ORG, role=role, name="Target", email="t@example.com")


class _Session:
    async def get(self, model, pk):
        return None


async def _client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_admin_cannot_change_admin_role(monkeypatch):
    async def fake_get_member(session, rid, org_id):
        return _target("admin")

    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("admin")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/members/{TARGET}", json={"role": "recruiter"})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_cannot_remove_owner(monkeypatch):
    async def fake_get_member(session, rid, org_id):
        return _target("owner")

    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.delete(f"/members/{TARGET}")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_patch_to_owner_rejected():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/members/{TARGET}", json={"role": "owner"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_transfer_requires_owner():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("admin")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/orgs/transfer-ownership", json={"recruiter_id": str(TARGET)})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_delete_org_requires_owner():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.delete("/orgs/current")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/api/test_members.py -v`
Expected: FAIL (routes not found → 404 / 405).

- [ ] **Step 3: Implement the members routes**

Create `backend/src/callup/api/routes/members.py`:

```python
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentRecruiter, SessionDep
from callup.api.permissions import ensure_can_manage
from callup.api.schemas import MemberOut
from callup.db import repositories
from callup.db.enums import RecruiterRole

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
async def remove_member(
    member_id: uuid.UUID, actor: CurrentRecruiter, session: SessionDep
) -> None:
    member = await repositories.get_member(session, member_id, actor.org_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    ensure_can_manage(actor, member.role)
    await repositories.remove_member(session, member)
```

- [ ] **Step 4: Add the org-lifecycle routes**

In `backend/src/callup/api/routes/orgs.py`, add imports at the top:

```python
import uuid

from callup.api.deps import CurrentClaims, CurrentRecruiter, SessionDep
from callup.api.permissions import ensure_owner
```

(Keep the existing `from callup.api.deps import CurrentClaims, SessionDep` consolidated into the line above; remove the duplicate.)

Append these handlers to `orgs.py`:

```python
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "already the owner")
    org = await session.get(Org, actor.org_id)
    await repositories.transfer_ownership(session, org, actor, target)


@router.delete("/orgs/current", status_code=204)
async def delete_current_org(actor: CurrentRecruiter, session: SessionDep) -> None:
    ensure_owner(actor)
    org = await session.get(Org, actor.org_id)
    await repositories.delete_org(session, org)
```

- [ ] **Step 5: Register the members router**

In `backend/src/callup/main.py`:

```python
from callup.api.routes import health, invitations, me, members, orgs
```

```python
    app.include_router(invitations.router)
    app.include_router(members.router)
```

- [ ] **Step 6: Run the route tests**

Run: `cd backend && uv run pytest tests/api/test_members.py -v`
Expected: PASS.

- [ ] **Step 7: Verify full fast suite**

Run: `cd backend && uv run pytest -m "not integration" -q`
Expected: PASS.

- [ ] **Step 8: Lint/format**

Run: `cd backend && uv run ruff check src tests && uv run black --check src tests`
Expected: PASS (fix with `uv run ruff check --fix` / `uv run black src tests` if needed).

- [ ] **Step 9: Commit**

```bash
git add backend/src/callup/api/routes/members.py backend/src/callup/api/routes/orgs.py backend/src/callup/main.py backend/tests/api/test_members.py
git commit -m "Add member and org-lifecycle routes (slice 3)"
```

---

### Task 7: Frontend — accept-invite flow & routing

**Files:**
- Modify: `frontend/src/components/RequireAuth.tsx`
- Modify: `frontend/src/pages/Login.tsx`
- Create: `frontend/src/pages/AcceptInvite.tsx`
- Modify: `frontend/src/pages/Onboarding.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api` client (`api.get`, `api.post`); `useProfile()` (`onboarded`, `refresh`); `useAuth()` (`session`); React Router `useLocation`, `useNavigate`, `useSearchParams`.
- Produces: `/accept-invite` route; `RequireAuth` now forwards `state.from`; `Login` honors `state.from`.
- Backend contracts: `GET /invitations/lookup?token=` → `{org_name, role, email, status, email_matches}`; `POST /invitations/accept` `{token, display_name}` → `RecruiterOut`.

- [ ] **Step 1: Preserve return location in `RequireAuth`**

Replace `frontend/src/components/RequireAuth.tsx` with:

```tsx
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  return <>{children}</>
}
```

- [ ] **Step 2: Honor return location in `Login`**

In `frontend/src/pages/Login.tsx`, change the imports and the post-auth navigation:

```tsx
import { useNavigate, useLocation } from 'react-router-dom'
```

Inside the component, after `const navigate = useNavigate()`:

```tsx
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string; search: string } } | null)?.from
  const redirectTo = from ? `${from.pathname}${from.search}` : '/'
```

Replace `navigate('/')` (in `onSubmit`) with `navigate(redirectTo, { replace: true })`.

- [ ] **Step 3: Create the AcceptInvite page**

Create `frontend/src/pages/AcceptInvite.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Preview = {
  org_name: string
  role: string
  email: string
  status: string
  email_matches: boolean
}

export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { session } = useAuth()
  const { onboarded, refresh } = useProfile()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError('This invite link is missing its token.')
      return
    }
    let active = true
    api
      .get<Preview>(`/invitations/lookup?token=${encodeURIComponent(token)}`)
      .then((p) => active && setPreview(p))
      .catch((e) =>
        active &&
        setLoadError(
          e instanceof ApiError && e.status === 404
            ? 'This invite could not be found.'
            : 'Could not load this invite.',
        ),
      )
    return () => {
      active = false
    }
  }, [token])

  if (onboarded) {
    return (
      <Centered>
        <p className="text-muted-foreground text-sm">You're already part of an organization.</p>
        <Button onClick={() => navigate('/')}>Go to dashboard</Button>
      </Centered>
    )
  }

  if (loadError) {
    return (
      <Centered>
        <p className="text-destructive text-sm">{loadError}</p>
      </Centered>
    )
  }

  if (!preview) {
    return <Centered>Loading…</Centered>
  }

  const signedInEmail = session?.user.email ?? ''
  const accepting = preview.status === 'pending' && preview.email_matches

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitError(null)
    setBusy(true)
    const display_name = String(new FormData(e.currentTarget).get('display_name')).trim()
    try {
      await api.post('/invitations/accept', { token, display_name })
      await refresh()
      navigate('/')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not accept the invite')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Join {preview.org_name}</CardTitle>
          <CardDescription>You've been invited as {preview.role}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!preview.email_matches && (
            <p className="text-destructive text-sm">
              This invite is for {preview.email}; you're signed in as {signedInEmail}.
            </p>
          )}
          {preview.status !== 'pending' && (
            <p className="text-destructive text-sm">This invite is {preview.status}.</p>
          )}
          {accepting && (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="display_name">Your name</Label>
                <Input id="display_name" name="display_name" required maxLength={120} />
              </div>
              {submitError && <p className="text-destructive text-sm">{submitError}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? 'Joining…' : `Join ${preview.org_name}`}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="text-muted-foreground flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-sm">
      {children}
    </main>
  )
}
```

If the `onboarded` early-return creates an unused-import lint issue with `Navigate`, drop the `Navigate` import (it isn't used above — navigation is via `useNavigate`). Verify in Step 6.

- [ ] **Step 4: Add the onboarding hint**

In `frontend/src/pages/Onboarding.tsx`, inside `<CardContent>`, after the `</form>`, add:

```tsx
            <p className="text-muted-foreground mt-4 text-sm">
              Have an invite? Open the invite link your admin sent you.
            </p>
```

- [ ] **Step 5: Register the route**

In `frontend/src/App.tsx`, add the import and route (before the `*` catch-all):

```tsx
import AcceptInvite from '@/pages/AcceptInvite'
```

```tsx
            <Route
              path="/accept-invite"
              element={
                <RequireAuth>
                  <AcceptInvite />
                </RequireAuth>
              }
            />
```

- [ ] **Step 6: Type-check, lint, build**

Run:
```bash
cd frontend && pnpm tsc --noEmit && pnpm lint && pnpm build
```
Expected: all PASS (fix unused imports / type errors if any).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/RequireAuth.tsx frontend/src/pages/Login.tsx frontend/src/pages/AcceptInvite.tsx frontend/src/pages/Onboarding.tsx frontend/src/App.tsx
git commit -m "Add accept-invite flow and return-location handling (slice 3)"
```

---

### Task 8: Frontend — dashboard members, invites, and danger zone

**Files:**
- Create: `frontend/src/components/ui/select.tsx` (via shadcn)
- Create: `frontend/src/components/MembersSection.tsx`
- Create: `frontend/src/components/InvitesSection.tsx`
- Create: `frontend/src/components/DangerZone.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `api` client; `useProfile()` (`recruiter` with `role`, `org_id`, `org_name`, `id`, `name`); `useAuth()` (`signOut`).
- Backend contracts: `GET /members` → `{id,name,email,role}[]`; `PATCH /members/{id}` `{role}`; `DELETE /members/{id}`; `GET /invitations` → `{id,email,role,status,expires_at}[]`; `POST /invitations` `{email,role}` → `{...,accept_url}`; `DELETE /invitations/{id}`; `POST /orgs/transfer-ownership` `{recruiter_id}`; `DELETE /orgs/current`.

- [ ] **Step 1: Add the shadcn select primitive**

Run: `cd frontend && pnpm dlx shadcn@latest add select`
Expected: creates `src/components/ui/select.tsx` (already covered by the eslint `react-refresh/only-export-components` exclusion for `ui/**`).

- [ ] **Step 2: Build the members section**

Create `frontend/src/components/MembersSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Member = { id: string; name: string; email: string; role: string }

function canManage(actorRole: string, targetRole: string): boolean {
  if (targetRole === 'owner') return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && targetRole === 'recruiter'
}

export default function MembersSection() {
  const { recruiter } = useProfile()
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .get<Member[]>('/members')
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load members'))
  }, [])

  useEffect(() => load(), [load])

  if (!recruiter) return null
  const actorRole = recruiter.role

  async function changeRole(id: string, role: string) {
    await api.patch(`/members/${id}`, { role })
    load()
  }

  async function remove(id: string) {
    await api.delete(`/members/${id}`)
    load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error && <p className="text-destructive text-sm">{error}</p>}
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-4 border-b py-2">
            <div className="text-sm">
              <div className="font-medium">{m.name}</div>
              <div className="text-muted-foreground">{m.email}</div>
            </div>
            <div className="flex items-center gap-2">
              {canManage(actorRole, m.role) ? (
                <>
                  <Select value={m.role} onValueChange={(v) => void changeRole(m.id, v)}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="recruiter">recruiter</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => void remove(m.id)}>
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground text-sm">{m.role}</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Build the invites section**

Create `frontend/src/components/InvitesSection.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Invitation = { id: string; email: string; role: string; status: string; expires_at: string }
type Created = Invitation & { accept_url: string }

export default function InvitesSection() {
  const [invites, setInvites] = useState<Invitation[]>([])
  const [role, setRole] = useState('recruiter')
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api
      .get<Invitation[]>('/invitations')
      .then(setInvites)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load invites'))
  }, [])

  useEffect(() => load(), [load])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLastLink(null)
    setBusy(true)
    const email = String(new FormData(e.currentTarget).get('email')).trim()
    try {
      const created = await api.post<Created>('/invitations', { email, role })
      setLastLink(created.accept_url)
      e.currentTarget.reset()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invite')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    await api.delete(`/invitations/${id}`)
    load()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="invite_email">Email</Label>
            <Input id="invite_email" name="email" type="email" required />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recruiter">recruiter</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {lastLink && (
          <div className="flex items-center gap-2 text-sm">
            <Input readOnly value={lastLink} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(lastLink)}
            >
              Copy
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b py-2 text-sm">
              <span>
                {i.email} · {i.role}
              </span>
              <Button variant="outline" size="sm" onClick={() => void revoke(i.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Build the danger zone**

Create `frontend/src/components/DangerZone.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Member = { id: string; name: string; email: string; role: string }

export default function DangerZone() {
  const { recruiter, refresh } = useProfile()
  const [members, setMembers] = useState<Member[]>([])
  const [transferTo, setTransferTo] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Member[]>('/members').then(setMembers).catch(() => undefined)
  }, [])

  if (!recruiter) return null
  const others = members.filter((m) => m.id !== recruiter.id)

  async function transfer() {
    setError(null)
    try {
      await api.post('/orgs/transfer-ownership', { recruiter_id: transferTo })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    }
  }

  async function deleteOrg() {
    setError(null)
    try {
      await api.delete('/orgs/current')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex flex-col gap-2">
          <Label>Transfer ownership</Label>
          <div className="flex items-center gap-2">
            <Select value={transferTo} onValueChange={setTransferTo}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {others.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!transferTo} onClick={() => void transfer()}>
              Transfer
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm_name">
            Delete organization — type <span className="font-mono">{recruiter.org_name}</span> to
            confirm
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="confirm_name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
            <Button
              variant="outline"
              className="border-destructive text-destructive"
              disabled={confirmName !== recruiter.org_name}
              onClick={() => void deleteOrg()}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Compose the dashboard**

Replace the `<main>` body in `frontend/src/pages/Dashboard.tsx` so it renders the sections (keep the existing header). New file:

```tsx
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import MembersSection from '@/components/MembersSection'
import InvitesSection from '@/components/InvitesSection'
import DangerZone from '@/components/DangerZone'

export default function Dashboard() {
  const { signOut } = useAuth()
  const { recruiter } = useProfile()
  if (!recruiter) return null
  const isManager = recruiter.role === 'owner' || recruiter.role === 'admin'
  const isOwner = recruiter.role === 'owner'

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold tracking-tight">{recruiter.org_name}</span>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm">
            {recruiter.name} · {recruiter.role}
          </span>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <MembersSection />
        {isManager && <InvitesSection />}
        {isOwner && <DangerZone />}
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Type-check, lint, build**

Run:
```bash
cd frontend && pnpm tsc --noEmit && pnpm lint && pnpm build
```
Expected: all PASS.

- [ ] **Step 7: Manual browser smoke test**

With backend on `:8000` and `pnpm dev` on `http://localhost:5173`:
1. As owner, invite `alice@example.com` as recruiter → copy the link.
2. In a second browser/profile, sign up as `alice@example.com`, open the link → see "Join {org} as recruiter" → set name → Join → land on dashboard.
3. Back as owner: Alice appears in Members → change her to admin → confirm it sticks on refresh → Remove her.
4. Invite + transfer ownership to a member → confirm roles swap.
5. Delete the org with the typed confirmation → owner is routed back to `/onboarding`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ui/select.tsx frontend/src/components/MembersSection.tsx frontend/src/components/InvitesSection.tsx frontend/src/components/DangerZone.tsx frontend/src/pages/Dashboard.tsx frontend/package.json frontend/pnpm-lock.yaml
git commit -m "Add dashboard members, invites, and danger zone (slice 3)"
```

---

## Self-Review

**Spec coverage:**
- `invitation` table + enum + migration → Task 1. ✓
- Token mechanics (sha256, single-use, 7-day, re-invite revokes) → Task 3 (`create_invitation`, `accept_invitation`) + Task 5 (`_hash_token`, `INVITE_TTL`). ✓
- Permission hierarchy → Task 2 + enforced in Tasks 5/6. ✓
- Invite create/list/revoke/lookup/accept → Task 5. ✓
- Members list/role-change/remove → Tasks 4 + 6. ✓
- Ownership transfer + org deletion (cascade) → Tasks 4 + 6. ✓
- Accept page + `RequireAuth`/`Login` return-location fix + onboarding hint → Task 7. ✓
- Dashboard members/invites/danger-zone sections + `select` primitive → Task 8. ✓
- Testing (permission unit tests, fast route tests, integration tests) → Tasks 2–6. ✓

**Placeholder scan:** none — all steps contain concrete code/commands.

**Type consistency:** repository signatures used in routes (Tasks 5/6) match definitions (Tasks 3/4); `MemberOut`/`InvitationOut`/`InvitationCreatedOut`/`InvitationPreviewOut` defined in Task 5 schemas and consumed consistently; frontend response types mirror the backend response models. Note for the implementer: Task 3 changes the `repositories.py` datetime import to `from datetime import UTC, datetime` and adds `delete, select, update` to the SQLAlchemy import — Task 4 relies on those already being present.

**One known follow-up (not blocking):** member-list endpoints return all members to any role; the management *controls* are role-gated on both client and server, but the roster itself is visible to recruiters by design (per spec "all roles see the roster").
