# Slice 3 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the admin invite UI, add confirmation to the two destructive member actions, fix the `remove_member` FK bug, and delete members' Supabase auth accounts on both remove-member and delete-org.

**Architecture:** A new auth-admin HTTP client (`auth/admin.py`) deletes Supabase auth users via the Auth Admin API; a thin `services/membership.py` orchestrates DB deletion (repositories) + auth deletion for remove-member and delete-org; routes call the service and stay thin. Frontend gains a role-gated invite dropdown, an inline role-change confirm, a typed-confirmation remove dialog, and a post-org-delete sign-out.

**Tech Stack:** FastAPI, async SQLAlchemy 2.0, httpx (already a dep), pytest/pytest-asyncio (backend); React 19 + Vite + TS strict, React Router v7, Tailwind v4, shadcn/ui (frontend).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-20-slice3-hardening-design.md`.
- **Backend style:** all SQL in `db/repositories.py`; routes thin (logic in `services/`); `async def` handlers; validate at boundary with Pydantic; enum-like values stored as plain strings via `callup.db.enums`. Line length 100 (ruff + black; black excludes `alembic/versions`).
- **No new runtime deps.** HTTP via `httpx` (already declared). Secrets resolved only in `callup/secrets.py`; never logged or returned.
- **Backend tests:** unit-first; fast suite (`uv run pytest -m "not integration"`) hits no DB/network; DB tests behind `@pytest.mark.integration` with FK-safe cleanup.
- **Frontend:** pnpm only; `fetch` via the `api` client; shadcn primitives via `pnpm dlx shadcn@latest add <name>`; TS strict, no `any`; Tailwind inline; **no frontend tests** — verify with `pnpm tsc --noEmit` + `pnpm lint` + `pnpm build`.
- **Confirmed decisions:** org-delete deletes ALL members' auth accounts incl. the owner's (owner → signed out to `/login`); remove-member also deletes that member's auth account; role-change confirm is inline Confirm/Cancel; remove uses a modal dialog with a typed `remove` gate.
- **Auth deletion is best-effort:** DB deleted first (transactional); failed auth deletions are logged, not raised; `404` from the Auth API counts as already-deleted.

---

### Task 1: Auth-admin client + secrets accessor

**Files:**
- Modify: `backend/src/callup/secrets.py`
- Create: `backend/src/callup/auth/admin.py`
- Test: `backend/tests/auth/test_admin.py`

**Interfaces:**
- Consumes: `callup.config.settings` (`supabase_url`, `supabase_service_key`).
- Produces:
  - `callup.secrets.supabase_service_key() -> str` (raises `RuntimeError` if unset).
  - `callup.auth.admin.delete_auth_users(ids: list[uuid.UUID]) -> list[uuid.UUID]` (returns the ids that failed; logs failures; never raises on per-user failure; raises `RuntimeError` only if `supabase_url`/service key unset).

- [ ] **Step 1: Add the secrets accessor**

In `backend/src/callup/secrets.py`, after `def database_url()`:

```python
def supabase_service_key() -> str:
    key = settings.supabase_service_key
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_KEY is not configured")
    return key
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/auth/test_admin.py`:

```python
import uuid

import httpx
import pytest

from callup.auth import admin
from callup.config import settings

OK = uuid.uuid4()
GONE = uuid.uuid4()
FAIL = uuid.uuid4()


def _patch(monkeypatch, captured):
    monkeypatch.setattr(settings, "supabase_url", "http://test")
    monkeypatch.setattr(settings, "supabase_service_key", "svc-key")
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        uid = request.url.path.rsplit("/", 1)[-1]
        if uid == str(FAIL):
            return httpx.Response(500)
        if uid == str(GONE):
            return httpx.Response(404)
        return httpx.Response(204)

    def fake_client(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(**kwargs)

    monkeypatch.setattr(admin.httpx, "AsyncClient", fake_client)


async def test_delete_auth_users_success_and_failures(monkeypatch):
    captured: list[httpx.Request] = []
    _patch(monkeypatch, captured)
    failed = await admin.delete_auth_users([OK, GONE, FAIL])
    assert failed == [FAIL]  # 200/204/404 succeed; 500 fails
    assert len(captured) == 3
    for req in captured:
        assert req.headers["apikey"] == "svc-key"
        assert req.headers["authorization"] == "Bearer svc-key"
        assert req.url.path.startswith("/auth/v1/admin/users/")


async def test_delete_auth_users_empty_is_noop(monkeypatch):
    captured: list[httpx.Request] = []
    _patch(monkeypatch, captured)
    assert await admin.delete_auth_users([]) == []
    assert captured == []


async def test_delete_auth_users_raises_without_key(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "http://test")
    monkeypatch.setattr(settings, "supabase_service_key", None)
    with pytest.raises(RuntimeError):
        await admin.delete_auth_users([OK])
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && uv run pytest tests/auth/test_admin.py -v`
Expected: FAIL (`callup.auth.admin` does not exist).

- [ ] **Step 4: Implement the client**

Create `backend/src/callup/auth/admin.py`:

```python
"""Supabase Auth Admin API client. Deletes auth users (service-key authenticated)."""

import logging
import uuid

import httpx

from callup import secrets
from callup.config import settings

logger = logging.getLogger(__name__)


async def delete_auth_users(ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Delete Supabase auth users by id. Returns the ids that failed (already logged).

    A 200/204/404 counts as success (404 = already deleted). Other statuses and network
    errors are logged and collected — one failure never aborts the rest.
    """
    if not ids:
        return []
    base = settings.supabase_url
    if not base:
        raise RuntimeError("supabase_url is not configured")
    key = secrets.supabase_service_key()
    failed: list[uuid.UUID] = []
    async with httpx.AsyncClient(
        base_url=base.rstrip("/"),
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=10.0,
    ) as client:
        for uid in ids:
            try:
                resp = await client.delete(f"/auth/v1/admin/users/{uid}")
            except httpx.HTTPError as exc:
                logger.warning("auth user delete network error for %s: %s", uid, exc)
                failed.append(uid)
                continue
            if resp.status_code in (200, 204, 404):
                continue
            logger.warning("auth user delete failed for %s: HTTP %s", uid, resp.status_code)
            failed.append(uid)
    return failed
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && uv run pytest tests/auth/test_admin.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify fast suite + lint**

Run: `cd backend && uv run pytest -m "not integration" -q && uv run ruff check src tests && uv run black --check src tests`
Expected: all green/clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/callup/secrets.py backend/src/callup/auth/admin.py backend/tests/auth/test_admin.py
git commit -m "Add Supabase auth-admin client + service-key accessor (slice 3 hardening)"
```

---

### Task 2: Fix remove_member FK violation (repository)

**Files:**
- Modify: `backend/src/callup/db/repositories.py`
- Test: `backend/tests/db/test_members_repo.py`

**Interfaces:**
- Consumes: `Invitation`, `Recruiter`, `or_` (sqlalchemy).
- Produces: `remove_member(session, member)` now deletes invitation rows referencing the member (`invited_by == member.id OR accepted_by == member.id`) before deleting the recruiter.

- [ ] **Step 1: Add `or_` to the imports**

In `backend/src/callup/db/repositories.py`, change line 11:

```python
from sqlalchemy import delete, or_, select, update
```

- [ ] **Step 2: Write the failing integration test**

Append to `backend/tests/db/test_members_repo.py` (it already imports `uuid`, `pytest`, `delete`, `select`, `update`, repositories, models, `SessionFactory`; ensure `from datetime import UTC, datetime, timedelta` and `Invitation` are imported — add them to the existing imports if missing):

```python
async def test_remove_member_deletes_referencing_invitations():
    owner_id = uuid.uuid4()
    member_id = uuid.uuid4()
    org_id = None
    try:
        async with SessionFactory() as s:
            owner = await repositories.create_owned_org(
                s, owner_id, f"{owner_id}@example.com", "Acme", "Owner"
            )
            org_id = owner.org_id
            await repositories.create_invitation(
                s, org_id, "m@example.com", "recruiter", owner_id, "th-accept",
                datetime.now(tz=UTC) + timedelta(days=7),
            )
        async with SessionFactory() as s:
            inv = await repositories.get_invitation_by_token_hash(s, "th-accept")
            await repositories.accept_invitation(s, inv, member_id, "m@example.com", "Member")
        async with SessionFactory() as s:
            # member also sent an invite (covers the invited_by FK reference)
            await repositories.create_invitation(
                s, org_id, "x@example.com", "recruiter", member_id, "th-sent",
                datetime.now(tz=UTC) + timedelta(days=7),
            )
        async with SessionFactory() as s:
            member = await repositories.get_member(s, member_id, org_id)
            await repositories.remove_member(s, member)  # must NOT raise a FK error
        async with SessionFactory() as s:
            assert await repositories.get_member(s, member_id, org_id) is None
            assert await repositories.get_invitation_by_token_hash(s, "th-accept") is None
            assert await repositories.get_invitation_by_token_hash(s, "th-sent") is None
    finally:
        if org_id is not None:
            async with SessionFactory() as s:
                await s.execute(delete(Invitation).where(Invitation.org_id == org_id))
                await s.execute(
                    update(Org).where(Org.id == org_id).values(owner_recruiter_id=None)
                )
                await s.execute(delete(Recruiter).where(Recruiter.org_id == org_id))
                await s.execute(delete(Org).where(Org.id == org_id))
                await s.commit()
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && uv run pytest tests/db/test_members_repo.py::test_remove_member_deletes_referencing_invitations -v`
Expected: FAIL with a `ForeignKeyViolationError` / `IntegrityError` on `invitation_accepted_by_fkey` (the current bare-delete bug).

- [ ] **Step 4: Apply the fix**

In `backend/src/callup/db/repositories.py`, replace `remove_member` (currently a bare delete):

```python
async def remove_member(session: AsyncSession, member: Recruiter) -> None:
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && uv run pytest tests/db/test_members_repo.py -v`
Expected: PASS (incl. the new test and the existing ones).

- [ ] **Step 6: Verify fast suite + lint**

Run: `cd backend && uv run pytest -m "not integration" -q && uv run ruff check src tests && uv run black --check src tests`
Expected: green/clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/callup/db/repositories.py backend/tests/db/test_members_repo.py
git commit -m "Fix remove_member FK violation: clear referencing invitations (slice 3 hardening)"
```

---

### Task 3: Membership service (DB + auth orchestration)

**Files:**
- Create: `backend/src/callup/services/membership.py`
- Test: `backend/tests/services/test_membership.py` (create `backend/tests/services/__init__.py` if missing)

**Interfaces:**
- Consumes: `repositories.remove_member`, `repositories.list_members`, `repositories.delete_org`; `auth.admin.delete_auth_users`.
- Produces:
  - `remove_member(session, member) -> None` — repo delete (DB) then `delete_auth_users([member.id])`.
  - `delete_org(session, org) -> None` — capture member ids via `list_members`, repo cascade, then `delete_auth_users(ids)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/services/__init__.py` (empty) if it does not exist, then create `backend/tests/services/test_membership.py`:

```python
import uuid

from callup.db.models import Org, Recruiter
from callup.services import membership

OID = uuid.uuid4()
M1 = uuid.uuid4()
M2 = uuid.uuid4()


async def test_remove_member_deletes_db_then_auth(monkeypatch):
    order: list = []

    async def fake_remove(session, member):
        order.append(("db", member.id))

    async def fake_del(ids):
        order.append(("auth", list(ids)))
        return []

    monkeypatch.setattr(membership.repositories, "remove_member", fake_remove)
    monkeypatch.setattr(membership.auth_admin, "delete_auth_users", fake_del)

    member = Recruiter(id=M1, org_id=OID, role="recruiter", name="M", email="m@e.com")
    await membership.remove_member(object(), member)
    assert order == [("db", M1), ("auth", [M1])]


async def test_delete_org_captures_ids_then_cascades(monkeypatch):
    members = [
        Recruiter(id=M1, org_id=OID, role="owner", name="O", email="o@e.com"),
        Recruiter(id=M2, org_id=OID, role="recruiter", name="R", email="r@e.com"),
    ]
    order: list = []

    async def fake_list(session, org_id):
        order.append(("list", org_id))
        return members

    async def fake_delete_org(session, org):
        order.append(("db", org.id))

    async def fake_del(ids):
        order.append(("auth", list(ids)))
        return []

    monkeypatch.setattr(membership.repositories, "list_members", fake_list)
    monkeypatch.setattr(membership.repositories, "delete_org", fake_delete_org)
    monkeypatch.setattr(membership.auth_admin, "delete_auth_users", fake_del)

    org = Org(id=OID, name="Acme")
    await membership.delete_org(object(), org)
    assert order == [("list", OID), ("db", OID), ("auth", [M1, M2])]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/services/test_membership.py -v`
Expected: FAIL (`callup.services.membership` does not exist).

- [ ] **Step 3: Implement the service**

Create `backend/src/callup/services/membership.py`:

```python
"""Orchestrates member/org deletion across the DB and Supabase auth.

Routes stay thin and SQL stays in repositories; this layer sequences the DB delete
(transactional) and the best-effort auth-account deletion.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from callup.auth import admin as auth_admin
from callup.db import repositories
from callup.db.models import Org, Recruiter


async def remove_member(session: AsyncSession, member: Recruiter) -> None:
    await repositories.remove_member(session, member)
    await auth_admin.delete_auth_users([member.id])


async def delete_org(session: AsyncSession, org: Org) -> None:
    members = await repositories.list_members(session, org.id)
    ids = [m.id for m in members]
    await repositories.delete_org(session, org)
    await auth_admin.delete_auth_users(ids)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && uv run pytest tests/services/test_membership.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify fast suite + lint**

Run: `cd backend && uv run pytest -m "not integration" -q && uv run ruff check src tests && uv run black --check src tests`
Expected: green/clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/callup/services/membership.py backend/tests/services/
git commit -m "Add membership service: DB + auth-account deletion (slice 3 hardening)"
```

---

### Task 4: Wire routes to the membership service

**Files:**
- Modify: `backend/src/callup/api/routes/members.py`
- Modify: `backend/src/callup/api/routes/orgs.py`
- Test: `backend/tests/api/test_members.py`

**Interfaces:**
- Consumes: `services.membership.remove_member`, `services.membership.delete_org`.
- Produces: `DELETE /members/{id}` and `DELETE /orgs/current` now call the membership service (permission checks unchanged).

- [ ] **Step 1: Write the failing happy-path tests**

Append to `backend/tests/api/test_members.py` (reuses its existing helpers `_actor`, `_target`, `_Session`, `_client`, `ORG`, `ACTOR`, `TARGET`, and the `get_current_recruiter` / `get_session` overrides):

```python
async def test_remove_member_calls_service(monkeypatch):
    called = {}

    async def fake_get_member(session, rid, org_id):
        return _target("recruiter")

    async def fake_remove(session, member):
        called["id"] = member.id

    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    from callup.services import membership

    monkeypatch.setattr(membership, "remove_member", fake_remove)
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.delete(f"/members/{TARGET}")
        assert resp.status_code == 204
        assert called["id"] == TARGET
    finally:
        app.dependency_overrides.clear()
```

(If `test_members.py` does not already import `repositories`, add `from callup.db import repositories`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest tests/api/test_members.py::test_remove_member_calls_service -v`
Expected: FAIL (route still calls `repositories.remove_member`, so the `membership.remove_member` spy is never hit → `KeyError: 'id'`).

- [ ] **Step 3: Wire the members route**

In `backend/src/callup/api/routes/members.py`, add the import (after the existing `from callup.db import repositories`):

```python
from callup.services import membership
```

Change the last line of `remove_member` from `await repositories.remove_member(session, member)` to:

```python
    await membership.remove_member(session, member)
```

- [ ] **Step 4: Wire the orgs route**

In `backend/src/callup/api/routes/orgs.py`, add the import (after `from callup.db import repositories`):

```python
from callup.services import membership
```

Change the last line of `delete_current_org` from `await repositories.delete_org(session, org)` to:

```python
    await membership.delete_org(session, org)
```

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && uv run pytest tests/api/test_members.py -v`
Expected: PASS (incl. the new happy-path test and the existing permission tests).

- [ ] **Step 6: Verify full fast suite + lint**

Run: `cd backend && uv run pytest -m "not integration" -q && uv run ruff check src tests && uv run black --check src tests`
Expected: green/clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/callup/api/routes/members.py backend/src/callup/api/routes/orgs.py backend/tests/api/test_members.py
git commit -m "Route member/org deletion through the membership service (slice 3 hardening)"
```

---

### Task 5: Frontend — role-gated invite dropdown + post-delete sign-out

**Files:**
- Modify: `frontend/src/components/InvitesSection.tsx`
- Modify: `frontend/src/components/DangerZone.tsx`

**Interfaces:**
- Consumes: `useProfile()` (`recruiter.role`), `useAuth()` (`signOut`).

- [ ] **Step 1: Role-gate the invite dropdown**

In `frontend/src/components/InvitesSection.tsx`:

1. Add the profile import after the `api` import:

```tsx
import { useProfile } from '@/lib/profile'
```

2. Inside the component, after `const [busy, setBusy] = useState(false)`:

```tsx
  const { recruiter } = useProfile()
  const isOwner = recruiter?.role === 'owner'
```

3. Replace the role `<SelectContent>` block so `admin` only shows for the owner:

```tsx
            <SelectContent>
              <SelectItem value="recruiter">recruiter</SelectItem>
              {isOwner && <SelectItem value="admin">admin</SelectItem>}
            </SelectContent>
```

(The default `role` state stays `'recruiter'`, so an admin always sends a valid role.)

- [ ] **Step 2: Sign out after org delete**

In `frontend/src/components/DangerZone.tsx`:

1. Add the auth import after the `api` import:

```tsx
import { useAuth } from '@/lib/auth'
```

2. Inside the component, replace `const { recruiter, refresh } = useProfile()` with:

```tsx
  const { recruiter } = useProfile()
  const { signOut } = useAuth()
```

3. Replace the `deleteOrg` function body's success path (`await refresh()`) with a sign-out, since the owner's own account is now deleted:

```tsx
  async function deleteOrg() {
    setError(null)
    try {
      await api.delete('/orgs/current')
      await signOut()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }
```

(`refresh` is no longer used in this file — remove it from the `useProfile()` destructure as shown in step 2 above. `transfer()` still uses `refresh`? It does — keep `refresh` if `transfer` needs it.)

> Note for the implementer: `transfer()` calls `await refresh()`. Keep `refresh` in the destructure: `const { recruiter, refresh } = useProfile()` and add `const { signOut } = useAuth()`. Only the `deleteOrg` success path changes from `refresh()` to `signOut()`. Verify no unused-variable lint error either way.

- [ ] **Step 3: Type-check, lint, build**

Run:
```bash
cd frontend && pnpm tsc --noEmit && pnpm lint && pnpm build
```
Expected: all clean (a pre-existing chunk-size warning on build is fine).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/InvitesSection.tsx frontend/src/components/DangerZone.tsx
git commit -m "Role-gate invite dropdown; sign out after org delete (slice 3 hardening)"
```

---

### Task 6: Frontend — role-change confirm + typed remove dialog

**Files:**
- Create: `frontend/src/components/ui/dialog.tsx` (via shadcn)
- Modify: `frontend/src/components/MembersSection.tsx`

**Interfaces:**
- Consumes: shadcn `dialog` primitive, the existing `api` client.

- [ ] **Step 1: Add the shadcn dialog primitive**

Run: `cd frontend && pnpm dlx shadcn@latest add dialog`
Expected: creates `src/components/ui/dialog.tsx` (covered by the eslint `react-refresh/only-export-components` exclusion for `ui/**`). If the `.npmrc` minimum-release-age blocks a fresh Radix dialog transitive dep, report it as a concern rather than lowering the global threshold.

- [ ] **Step 2: Rewrite MembersSection with confirm + dialog**

Replace `frontend/src/components/MembersSection.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  const [pending, setPending] = useState<Record<string, string>>({})
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const load = useCallback(() => {
    api
      .get<Member[]>('/members')
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load members'))
  }, [])

  useEffect(() => load(), [load])

  if (!recruiter) return null
  const actorRole = recruiter.role

  async function confirmRole(id: string) {
    const role = pending[id]
    if (!role) return
    try {
      await api.patch(`/members/${id}`, { role })
      setPending((p) => {
        const next = { ...p }
        delete next[id]
        return next
      })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role')
    }
  }

  function cancelRole(id: string) {
    setPending((p) => {
      const next = { ...p }
      delete next[id]
      return next
    })
  }

  async function confirmRemove() {
    if (!removeTarget) return
    try {
      await api.delete(`/members/${removeTarget.id}`)
      setRemoveTarget(null)
      setConfirmText('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    }
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
                  <Select
                    value={pending[m.id] ?? m.role}
                    onValueChange={(v) => setPending((p) => ({ ...p, [m.id]: v }))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="recruiter">recruiter</SelectItem>
                    </SelectContent>
                  </Select>
                  {pending[m.id] && pending[m.id] !== m.role ? (
                    <>
                      <Button size="sm" onClick={() => void confirmRole(m.id)}>
                        Confirm
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => cancelRole(m.id)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmText('')
                        setRemoveTarget(m)
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground text-sm">{m.role}</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null)
            setConfirmText('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              This permanently removes {removeTarget?.name} ({removeTarget?.email}) and deletes
              their login account. This cannot be undone. Type <span className="font-mono">remove</span>{' '}
              to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRemoveTarget(null)
                setConfirmText('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-destructive text-destructive"
              disabled={confirmText !== 'remove'}
              onClick={() => void confirmRemove()}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
```

- [ ] **Step 3: Type-check, lint, build**

Run:
```bash
cd frontend && pnpm tsc --noEmit && pnpm lint && pnpm build
```
Expected: all clean.

- [ ] **Step 4: Manual smoke (no automated FE tests)**

With the backend on `:8000` and `pnpm dev` on `http://localhost:5173`, as an owner:
1. Change a member's role → Confirm/Cancel appear; Cancel reverts; Confirm applies and persists on refresh.
2. Remove a member → dialog opens; the Remove button is disabled until you type `remove`; confirming removes them from the roster (and deletes their auth account).
3. As an admin, the invite role dropdown offers only `recruiter`.
4. Delete the org (owner) → you are signed out to `/login`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/dialog.tsx frontend/src/components/MembersSection.tsx frontend/package.json frontend/pnpm-lock.yaml
git commit -m "Add role-change confirm and typed remove dialog (slice 3 hardening)"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (role-gated invite dropdown) → Task 5 Step 1. ✓
- Item 2 (role-change confirmation) → Task 6 (pending + Confirm/Cancel). ✓
- Item 3 backend (remove_member FK fix) → Task 2; frontend typed dialog → Task 6. ✓
- Item 4 (auth-account deletion): secrets accessor + client → Task 1; service → Task 3; route wiring → Task 4; post-delete sign-out → Task 5 Step 2. ✓
- Testing (auth client, service, route, integration regression) → Tasks 1–4. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `delete_auth_users(ids) -> list[uuid]` defined in Task 1 and consumed in Task 3; `membership.remove_member` / `membership.delete_org` defined in Task 3 and consumed in Task 4; `or_` import added in Task 2 before use. Frontend: `pending`/`removeTarget`/`confirmText` state introduced and used consistently in Task 6.

**Note for the implementer:** Task 5 Step 2 keeps `refresh` in the `DangerZone` destructure (still used by `transfer()`) and only swaps the `deleteOrg` success path to `signOut()` — watch for an unused-variable lint error and adjust the destructure to exactly what's used.
