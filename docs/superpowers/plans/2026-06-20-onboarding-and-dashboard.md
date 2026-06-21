# Onboarding + Dashboard Implementation Plan (Slice 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace slice 1's silent org auto-provisioning with a deliberate onboarding step (create an org → become owner) and give the app a real dashboard surface.

**Architecture:** The backend stops auto-creating an org. `GET /me` becomes a discriminated `{ onboarded, recruiter }` payload driven off a token-claims-only dependency; a new `POST /orgs` performs the create-org onboarding. The SPA gains a `ProfileProvider` that fetches `/me` once and routes the user to `/onboarding` (not onboarded) or the dashboard (onboarded).

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, asyncpg, Pydantic v2, pytest. Frontend — React 19 + Vite + TS strict, React Router v7, @supabase/supabase-js, shadcn/ui, Tailwind v4.

Design spec: [`docs/superpowers/specs/2026-06-20-onboarding-and-dashboard-design.md`](../specs/2026-06-20-onboarding-and-dashboard-design.md).

## Global Constraints

- Backend package manager is **uv** only (`uv run …`); never bare pip.
- Frontend package manager is **pnpm** only; shadcn primitives via `pnpm dlx shadcn@latest add <name>` (none needed here — card/input/label/button already present).
- No config reads outside the settings modules: never `os.getenv` / `import.meta.env.X` in app code; never `load_dotenv`.
- Backend: `async def` for route handlers and I/O; SQL lives only in `db/repositories.py`; validate at boundaries (Pydantic). Routes never write SQL beyond a simple `session.get(Org, …)` for the org name.
- Enum-like values stored as **plain strings** via `callup.db.enums` (`RecruiterRole.OWNER.value`).
- Secrets never enter logs/responses; `RecruiterOut` never echoes the token.
- Auth status mapping: missing/invalid token → 401; JWKS outage → 503; authenticated-but-not-onboarded (business routes) → 403; create-org when already onboarded → 409; blank/too-long names → 422.
- One org per person (`recruiter.org_id` stays a single FK). Owner is the org creator.
- Fast test suite (`uv run pytest -m "not integration"`) hits **no network, no DB**. DB tests are `@pytest.mark.integration`.
- Frontend: TypeScript strict, no `any`; Tailwind inline; one component per file; **no frontend tests** — verify via `pnpm tsc --noEmit` + `pnpm lint` + manual browser.
- Ruff/black line-length 100. Run `uv run ruff check . && uv run black .` before each backend commit.

---

## File structure

**Backend (create):**
- `backend/src/callup/api/schemas.py` — shared `RecruiterOut` Pydantic model (used by `/me` and `/orgs`).
- `backend/src/callup/api/routes/orgs.py` — `OrgCreateIn` + `POST /orgs`.
- `backend/tests/api/test_orgs.py` — fast route tests for `/orgs`.

**Backend (modify):**
- `backend/src/callup/api/deps.py` — split into `get_current_claims`/`CurrentClaims` (token only) and `get_current_recruiter`/`CurrentRecruiter` (requires existing recruiter, 403 if none, no provisioning).
- `backend/src/callup/db/repositories.py` — replace `provision_recruiter` with `create_owned_org` (explicit org/display names).
- `backend/src/callup/api/routes/me.py` — `GET /me` → `MeOut { onboarded, recruiter }` using `CurrentClaims`.
- `backend/src/callup/main.py` — register the `orgs` router.
- `backend/tests/api/test_me.py` — rewrite for the new `MeOut` shape + claims dependency.
- `backend/tests/db/test_repositories.py` — rewrite for `create_owned_org`.

**Frontend (create):**
- `frontend/src/lib/profile.tsx` — `ProfileProvider` + `useProfile`.
- `frontend/src/components/RequireOnboarded.tsx` — onboarding gate.
- `frontend/src/pages/Onboarding.tsx` — create-org form.
- `frontend/src/pages/Dashboard.tsx` — app-shell dashboard (replaces `Home`).

**Frontend (modify / delete):**
- `frontend/src/App.tsx` — mount `ProfileProvider`, add `/onboarding` + onboarded-gated `/`.
- Delete `frontend/src/pages/Home.tsx` (superseded by `Dashboard`).

**Docs (modify):**
- `docs/todos.md` — insert the two org/team slices before candidate intake.

---

## Task 1: Backend onboarding state — deps split, `create_owned_org`, `/me` → `MeOut`

**Files:**
- Create: `backend/src/callup/api/schemas.py`
- Modify: `backend/src/callup/api/deps.py` (full rewrite), `backend/src/callup/db/repositories.py`, `backend/src/callup/api/routes/me.py` (full rewrite)
- Test: `backend/tests/api/test_me.py` (full rewrite), `backend/tests/db/test_repositories.py` (full rewrite)

**Interfaces:**
- Consumes: `callup.auth.jwt.verify_token` / `TokenClaims` / `AuthError` / `JWKSUnavailable`; `callup.db.models.Org` / `Recruiter`; `callup.db.enums.RecruiterRole`; `callup.db.session.get_session`.
- Produces:
  - `callup.api.schemas.RecruiterOut` (BaseModel: `id, org_id: uuid.UUID`; `email, name, role, org_name: str`).
  - `callup.api.deps.get_current_claims(request) -> TokenClaims`, `CurrentClaims` (Annotated), `SessionDep`.
  - `callup.api.deps.get_current_recruiter(claims, session) -> Recruiter` (raises 403 if none), `CurrentRecruiter`.
  - `callup.db.repositories.create_owned_org(session, recruiter_id, email, org_name, display_name) -> Recruiter`.
  - `callup.api.routes.me.MeOut` (BaseModel: `onboarded: bool`, `recruiter: RecruiterOut | None`); `GET /me`.

- [ ] **Step 1: Write the failing fast tests for `/me`**

Replace the entire contents of `backend/tests/api/test_me.py` with:
```python
import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_claims
from callup.auth.jwt import TokenClaims
from callup.db.models import Org, Recruiter
from callup.db.session import get_session
from callup.main import app

SUB = uuid.uuid4()
ORG_ID = uuid.uuid4()


def _claims() -> TokenClaims:
    return TokenClaims(sub=SUB, email="jane@example.com")


class _SessionWithRecruiter:
    async def get(self, model, pk):
        if model is Recruiter:
            return Recruiter(
                id=SUB, org_id=ORG_ID, role="owner", name="Jane", email="jane@example.com"
            )
        if model is Org:
            return Org(id=pk, name="Acme workspace")
        return None


class _SessionNoRecruiter:
    async def get(self, model, pk):
        return None


async def _get_me(overrides):
    for dep, override in overrides.items():
        app.dependency_overrides[dep] = override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get("/me")
    finally:
        app.dependency_overrides.clear()


async def test_me_onboarded_returns_profile():
    resp = await _get_me({get_current_claims: _claims, get_session: lambda: _SessionWithRecruiter()})
    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarded"] is True
    assert body["recruiter"]["email"] == "jane@example.com"
    assert body["recruiter"]["role"] == "owner"
    assert body["recruiter"]["org_name"] == "Acme workspace"
    assert "token" not in body


async def test_me_not_onboarded_returns_flag():
    resp = await _get_me({get_current_claims: _claims, get_session: lambda: _SessionNoRecruiter()})
    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarded"] is False
    assert body["recruiter"] is None


async def test_me_without_token_is_unauthorized():
    resp = await _get_me({})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run the `/me` tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_me.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_current_claims' from 'callup.api.deps'`.

- [ ] **Step 3: Create the shared schema**

Create `backend/src/callup/api/schemas.py`:
```python
import uuid

from pydantic import BaseModel


class RecruiterOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    org_id: uuid.UUID
    org_name: str
```

- [ ] **Step 4: Rewrite the dependencies**

Replace the entire contents of `backend/src/callup/api/deps.py` with:
```python
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from callup.auth.jwt import AuthError, JWKSUnavailable, TokenClaims, verify_token
from callup.db import repositories
from callup.db.models import Recruiter
from callup.db.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_current_claims(request: Request) -> TokenClaims:
    """Verify the bearer token and return its claims. No DB access.

    Base auth dependency for routes that must work pre-onboarding (/me, POST /orgs).
    Missing/invalid token -> 401; key-server outage -> 503.
    """
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        return verify_token(token)
    except AuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    except JWKSUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "auth key server unavailable"
        ) from exc


CurrentClaims = Annotated[TokenClaims, Depends(get_current_claims)]


async def get_current_recruiter(claims: CurrentClaims, session: SessionDep) -> Recruiter:
    """Resolve the onboarded recruiter for the authenticated user.

    For business routes that require an existing recruiter. Raises 403 if the user has
    authenticated but not yet onboarded (no recruiter row). Does not provision.
    """
    recruiter = await repositories.get_recruiter(session, claims.sub)
    if recruiter is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not onboarded")
    return recruiter


CurrentRecruiter = Annotated[Recruiter, Depends(get_current_recruiter)]
```

- [ ] **Step 5: Replace `provision_recruiter` with `create_owned_org`**

In `backend/src/callup/db/repositories.py`, replace the entire `provision_recruiter` function (the `async def provision_recruiter(...)` block) with:
```python
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
```
Leave the module docstring, imports, and `get_recruiter` unchanged.

- [ ] **Step 6: Rewrite the `/me` route**

Replace the entire contents of `backend/src/callup/api/routes/me.py` with:
```python
from fastapi import APIRouter
from pydantic import BaseModel

from callup.api.deps import CurrentClaims, SessionDep
from callup.api.schemas import RecruiterOut
from callup.db import repositories
from callup.db.models import Org

router = APIRouter(tags=["me"])


class MeOut(BaseModel):
    onboarded: bool
    recruiter: RecruiterOut | None


@router.get("/me", response_model=MeOut)
async def me(claims: CurrentClaims, session: SessionDep) -> MeOut:
    recruiter = await repositories.get_recruiter(session, claims.sub)
    if recruiter is None:
        return MeOut(onboarded=False, recruiter=None)
    org = await session.get(Org, recruiter.org_id)
    return MeOut(
        onboarded=True,
        recruiter=RecruiterOut(
            id=recruiter.id,
            email=recruiter.email,
            name=recruiter.name,
            role=recruiter.role,
            org_id=recruiter.org_id,
            org_name=org.name,
        ),
    )
```

- [ ] **Step 7: Run the `/me` tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/test_me.py -v`
Expected: PASS (3 passed).

- [ ] **Step 8: Rewrite the repository integration test**

Replace the entire contents of `backend/tests/db/test_repositories.py` with:
```python
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
```

- [ ] **Step 9: Run the integration test to verify it passes**

Run: `cd backend && uv run pytest -m integration tests/db/test_repositories.py -v`
Expected: PASS (2 passed). Requires the live Supabase DB via `backend/.env` (present).

- [ ] **Step 10: Run the whole fast suite + lint/format**

Run: `cd backend && uv run pytest -m "not integration" -q && uv run ruff check . && uv run black .`
Expected: fast suite PASS (no network/DB); ruff clean; black unchanged.

- [ ] **Step 11: Commit**

```bash
git add backend/src/callup/api/schemas.py backend/src/callup/api/deps.py backend/src/callup/db/repositories.py backend/src/callup/api/routes/me.py backend/tests/api/test_me.py backend/tests/db/test_repositories.py
git commit -m "Replace auto-provision with onboarding state; /me reports onboarded"
```

---

## Task 2: `POST /orgs` onboarding endpoint

**Files:**
- Create: `backend/src/callup/api/routes/orgs.py`
- Modify: `backend/src/callup/main.py`
- Test: `backend/tests/api/test_orgs.py`

**Interfaces:**
- Consumes: `callup.api.deps.CurrentClaims` / `SessionDep` / `get_current_claims`; `callup.api.schemas.RecruiterOut`; `callup.db.repositories.get_recruiter` / `create_owned_org`; `callup.db.models.Org`.
- Produces: `callup.api.routes.orgs.OrgCreateIn` (`org_name: str`, `display_name: str`; both trimmed, 1..120 chars), `POST /orgs -> RecruiterOut` (201), registered in `main.py`.

- [ ] **Step 1: Write the failing route tests**

Create `backend/tests/api/test_orgs.py`:
```python
import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_claims
from callup.auth.jwt import TokenClaims
from callup.db.models import Recruiter
from callup.db.session import get_session
from callup.main import app

SUB = uuid.uuid4()


def _claims() -> TokenClaims:
    return TokenClaims(sub=SUB, email="jane@example.com")


class _SessionWithRecruiter:
    async def get(self, model, pk):
        return Recruiter(
            id=SUB, org_id=uuid.uuid4(), role="owner", name="Jane", email="jane@example.com"
        )


class _SessionNoRecruiter:
    async def get(self, model, pk):
        return None


async def _post_orgs(body, session_override=None):
    app.dependency_overrides[get_current_claims] = _claims
    if session_override is not None:
        app.dependency_overrides[get_session] = session_override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/orgs", json=body)
    finally:
        app.dependency_overrides.clear()


async def test_create_org_conflicts_when_already_onboarded():
    resp = await _post_orgs(
        {"org_name": "Acme", "display_name": "Jane"}, lambda: _SessionWithRecruiter()
    )
    assert resp.status_code == 409


async def test_create_org_rejects_blank_name():
    resp = await _post_orgs(
        {"org_name": "   ", "display_name": "Jane"}, lambda: _SessionNoRecruiter()
    )
    assert resp.status_code == 422


async def test_create_org_requires_token():
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/orgs", json={"org_name": "Acme", "display_name": "Jane"})
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 401
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_orgs.py -v`
Expected: FAIL — 404 responses (route `/orgs` not registered yet), so the 409/422 assertions fail.

- [ ] **Step 3: Implement the route**

Create `backend/src/callup/api/routes/orgs.py`:
```python
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentClaims, SessionDep
from callup.api.schemas import RecruiterOut
from callup.db import repositories
from callup.db.models import Org

router = APIRouter(tags=["orgs"])


class OrgCreateIn(BaseModel):
    org_name: str
    display_name: str

    @field_validator("org_name", "display_name")
    @classmethod
    def _clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 120:
            raise ValueError("must be at most 120 characters")
        return v


@router.post("/orgs", response_model=RecruiterOut, status_code=status.HTTP_201_CREATED)
async def create_org(
    body: OrgCreateIn, claims: CurrentClaims, session: SessionDep
) -> RecruiterOut:
    existing = await repositories.get_recruiter(session, claims.sub)
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "already onboarded")
    recruiter = await repositories.create_owned_org(
        session, claims.sub, claims.email, body.org_name, body.display_name
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

- [ ] **Step 4: Register the router**

In `backend/src/callup/main.py`, update the routes import and registration. Change:
```python
from callup.api.routes import health, me
```
to:
```python
from callup.api.routes import health, me, orgs
```
and add, after `app.include_router(me.router)`:
```python
    app.include_router(orgs.router)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/test_orgs.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Run the whole fast suite + lint/format**

Run: `cd backend && uv run pytest -m "not integration" -q && uv run ruff check . && uv run black .`
Expected: fast suite PASS; ruff clean; black unchanged.

- [ ] **Step 7: Commit**

```bash
git add backend/src/callup/api/routes/orgs.py backend/src/callup/main.py backend/tests/api/test_orgs.py
git commit -m "Add POST /orgs onboarding endpoint"
```

---

## Task 3: Frontend `ProfileProvider`

**Files:**
- Create: `frontend/src/lib/profile.tsx`

**Interfaces:**
- Consumes: `api` from `@/lib/api`; `ApiError` from `@/lib/http`; `useAuth` from `@/lib/auth`.
- Produces:
  - `ProfileProvider({ children })`.
  - `useProfile(): { loading: boolean; onboarded: boolean; recruiter: Recruiter | null; error: string | null; refresh: () => Promise<void> }`.
  - exported type `Recruiter` (`{ id, email, name, role, org_id, org_name }`, all `string`) — mirrors backend `RecruiterOut`.

- [ ] **Step 1: Implement the profile context**

Create `frontend/src/lib/profile.tsx`:
```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { useAuth } from '@/lib/auth'

export type Recruiter = {
  id: string
  email: string
  name: string
  role: string
  org_id: string
  org_name: string
}

type MeResponse = {
  onboarded: boolean
  recruiter: Recruiter | null
}

type ProfileContextValue = {
  loading: boolean
  onboarded: boolean
  recruiter: Recruiter | null
  error: string | null
  refresh: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const [loading, setLoading] = useState(true)
  const [onboarded, setOnboarded] = useState(false)
  const [recruiter, setRecruiter] = useState<Recruiter | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await api.get<MeResponse>('/me')
      setOnboarded(me.onboarded)
      setRecruiter(me.recruiter)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await signOut()
        return
      }
      setError(e instanceof Error ? e.message : 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [signOut])

  useEffect(() => {
    if (!session) {
      setLoading(false)
      setOnboarded(false)
      setRecruiter(null)
      setError(null)
      return
    }
    void load()
  }, [session, load])

  return (
    <ProfileContext.Provider value={{ loading, onboarded, recruiter, error, refresh: load }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used within a ProfileProvider')
  return ctx
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/profile.tsx
git commit -m "Add ProfileProvider that loads /me and drives routing"
```

---

## Task 4: Onboarding page + `RequireOnboarded` gate

**Files:**
- Create: `frontend/src/components/RequireOnboarded.tsx`, `frontend/src/pages/Onboarding.tsx`

**Interfaces:**
- Consumes: `useProfile` from `@/lib/profile`; `api` from `@/lib/api`; `ApiError` from `@/lib/http`; `Navigate`/`useNavigate` from `react-router-dom`; shadcn `Button`/`Input`/`Label`/`Card*`.
- Produces: default-exported `RequireOnboarded` and `Onboarding`.

- [ ] **Step 1: Implement the onboarding gate**

Create `frontend/src/components/RequireOnboarded.tsx`:
```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useProfile } from '@/lib/profile'

export default function RequireOnboarded({ children }: { children: ReactNode }) {
  const { loading, onboarded, error, refresh } = useProfile()
  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3">
        <p className="text-destructive text-sm">{error}</p>
        <button type="button" className="text-sm underline" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    )
  }
  if (!onboarded) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}
```

- [ ] **Step 2: Implement the onboarding page**

Create `frontend/src/pages/Onboarding.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Onboarding() {
  const navigate = useNavigate()
  const { loading, onboarded, refresh } = useProfile()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }
  if (onboarded) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const form = new FormData(e.currentTarget)
    const display_name = String(form.get('display_name')).trim()
    const org_name = String(form.get('org_name')).trim()
    try {
      await api.post('/orgs', { org_name, display_name })
      await refresh()
      navigate('/')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await refresh()
        navigate('/')
        return
      }
      setError(err instanceof Error ? err.message : 'Could not create your workspace')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up your workspace</CardTitle>
          <CardDescription>Create your organization to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="display_name">Your name</Label>
              <Input id="display_name" name="display_name" required maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="org_name">Organization name</Label>
              <Input id="org_name" name="org_name" required maxLength={120} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create workspace'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: no errors. (These pages aren't routed yet — that's Task 5.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RequireOnboarded.tsx frontend/src/pages/Onboarding.tsx
git commit -m "Add onboarding page and RequireOnboarded gate"
```

---

## Task 5: Dashboard + router wiring (replaces Home)

**Files:**
- Create: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/pages/Home.tsx`

**Interfaces:**
- Consumes: `useAuth` from `@/lib/auth`; `useProfile` from `@/lib/profile`; `ProfileProvider` from `@/lib/profile`; `RequireAuth` from `@/components/RequireAuth`; `RequireOnboarded` from `@/components/RequireOnboarded`; `Login`/`Onboarding`/`Dashboard` pages; shadcn `Button`/`Card*`.
- Produces: default-exported `Dashboard`; `App` wired with `ProfileProvider` + onboarding-gated routes.

- [ ] **Step 1: Implement the dashboard**

Create `frontend/src/pages/Dashboard.tsx`:
```tsx
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Dashboard() {
  const { signOut } = useAuth()
  const { recruiter } = useProfile()
  if (!recruiter) return null

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
      <main className="flex-1 p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Welcome, {recruiter.name}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            You're the <span className="text-foreground font-medium">{recruiter.role}</span> of{' '}
            <span className="text-foreground font-medium">{recruiter.org_name}</span>.
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Wire the router**

Replace the entire contents of `frontend/src/App.tsx` with:
```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { ProfileProvider } from '@/lib/profile'
import RequireAuth from '@/components/RequireAuth'
import RequireOnboarded from '@/components/RequireOnboarded'
import Login from '@/pages/Login'
import Onboarding from '@/pages/Onboarding'
import Dashboard from '@/pages/Dashboard'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ProfileProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <Onboarding />
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <Dashboard />
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ProfileProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
```

- [ ] **Step 3: Delete the superseded Home page**

Run: `git rm frontend/src/pages/Home.tsx`

- [ ] **Step 4: Type-check and lint**

Run: `cd frontend && pnpm tsc --noEmit && pnpm lint`
Expected: no errors (0 problems).

- [ ] **Step 5: Manual browser verification**

Restart the backend (`uv run callup` from `backend/`) and frontend (`pnpm dev` from `frontend/`), open `http://localhost:5173` (not `127.0.0.1`, for CORS). With a fresh account verify:
1. Sign up → redirected to `/onboarding` (not a dashboard).
2. Submit your name + org name → land on the dashboard showing the org name in the header and "Welcome, <name>" with role `owner`.
3. In Supabase, exactly one `org` (named what you typed, owned by you) and one `recruiter` (role `owner`, `id` = your auth user id) exist.
4. Refresh `/` → stays on the dashboard (no re-onboarding).
5. Visit `/onboarding` while onboarded → redirected to `/`.
6. Sign out → `/login`; visiting `/` → `/login`.

Expected: all six behaviors hold.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/App.tsx
git commit -m "Add dashboard shell and onboarding-gated routing"
```

---

## Task 6: Update the roadmap

**Files:**
- Modify: `docs/todos.md`

- [ ] **Step 1: Insert the org/team slices and renumber**

In `docs/todos.md`, replace the entire status table (the rows from `| 0 |` through `| 10 |`) with:
```markdown
| # | Slice | Delivers (testable on screen) | Status |
|---|-------|-------------------------------|--------|
| 0 | DB schema v1 | 10 base tables live in Supabase | ✅ |
| 1 | Auth + recruiter/org bootstrap | Email login → first sign-in establishes your identity | ✅ |
| 2 | Onboarding + dashboard | First sign-in → onboarding (create org, become owner) → dashboard showing org + your role | ✅ |
| 3 | Team invitations & roles | Owner/admin invite recruiters/admins via shareable link; members management + role-gated permissions | ▶ |
| 4 | Candidate intake | Create / list / view candidates with the full profile (education, experience, certs, projects) | ⬜ |
| 5 | Candidate documents | Upload candidate files to Supabase Storage; list them on the candidate | ⬜ |
| 6 | Job postings (manual) | Create / list / view job postings by hand, incl. hiring-side contact | ⬜ |
| 7 | Job ingestion (Dice) | Autonomous worker fetches + normalizes + dedupes Dice postings into the same job list | ⬜ |
| 8 | Matching | Embeddings + similarity + LLM re-rank; ranked candidate↔job matches surfaced in the UI | ⬜ |
| 9 | Document generation | Truthful tailored resume / cover letter, validated against verified candidate facts | ⬜ |
| 10 | Applications | Create application records against a job, track status, application dashboard | ⬜ |
| 11 | Assisted apply session | Playwright worker + live SSE session with the mandatory human-approve-submit step | ⬜ |
| 12 | Outreach | Draft hiring-manager emails (Gmail); sending gated by `OUTREACH_SEND_ENABLED` | ⬜ |
```

- [ ] **Step 2: Update the ordering notes**

In `docs/todos.md`, replace the entire `## Notes on ordering` section (down to the line before `## Follow-ups`) with:
```markdown
## Notes on ordering

- **Auth + org/team (1–3)** come before candidates so every later row has a real
  recruiter/org and a team to own it.
- **Onboarding (2) before team management (3):** prove explicit org creation + the
  dashboard, then layer invites and roles onto it.
- **Manual job postings (6) before Dice ingestion (7):** prove the job model + UI by
  hand, then make the worker just another writer into the same tables.
- **Matching (8) needs candidates + jobs (4, 6/7)** to have anything to rank.
- **Generation (9) before applications (10):** an application attaches a generated,
  fact-checked resume.
- **Assisted apply (11)** is the most complex (browser worker + SSE + human-in-loop);
  it comes after the documents it submits exist.
- **Outreach (12)** last; send stays behind the `OUTREACH_SEND_ENABLED` gate.
```

- [ ] **Step 3: Commit**

```bash
git add docs/todos.md
git commit -m "Insert onboarding + team-management slices into roadmap"
```

---

## Self-review notes

- **Spec coverage:** deps split → Task 1; `create_owned_org` → Task 1; `/me` MeOut → Task 1; `POST /orgs` + validation + 409 → Task 2; `ProfileProvider` (incl. 401→signout, error state) → Task 3; `RequireOnboarded` + Onboarding (incl. redirect-if-onboarded, 409 handling) → Task 4; Dashboard shell + routing + delete Home → Task 5; error table (401/503/409/422/race) → Tasks 1–4; testing (me fast, orgs fast, create_owned_org integration, no frontend tests) → Tasks 1, 2, 5; roadmap → Task 6. All spec sections map to a task.
- **Type consistency:** `TokenClaims(sub, email)` consumed by `get_current_claims`/`/me`/`/orgs`; `RecruiterOut` (schemas.py) shared by `/me` and `/orgs` and mirrored by frontend `Recruiter` type and `MeResponse`; `create_owned_org(session, recruiter_id, email, org_name, display_name)` signature matches its call in `orgs.py`; `useProfile()` shape (`loading/onboarded/recruiter/error/refresh`) matches its consumers in `RequireOnboarded`, `Onboarding`, `Dashboard`.
- **No placeholders:** every code step is complete; commands carry expected output.
