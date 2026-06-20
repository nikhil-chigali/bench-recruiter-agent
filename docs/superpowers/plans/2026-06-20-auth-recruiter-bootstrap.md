# Auth + recruiter/org bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recruiter can sign up / sign in with email, land on a protected home that greets them and shows their org; first authenticated request auto-provisions their `recruiter` row and a new `org` they own.

**Architecture:** The SPA owns Supabase session state; the existing `api` client already injects the bearer. The backend verifies the Supabase JWT locally against the project's asymmetric signing keys (JWKS), then a `CurrentRecruiter` FastAPI dependency looks up the recruiter by the token's `sub` and provisions org+recruiter on first sight. `GET /me` returns the current recruiter and is what triggers provisioning.

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, asyncpg, Pydantic v2, **PyJWT[crypto]** (new), pytest/pytest-asyncio. Frontend — React 19 + Vite + TS (strict), React Router v7, @supabase/supabase-js, shadcn/ui, Tailwind v4.

Design spec: [`docs/superpowers/specs/2026-06-20-auth-recruiter-bootstrap-design.md`](../specs/2026-06-20-auth-recruiter-bootstrap-design.md).

## Global Constraints

- Backend package manager is **uv** only (`uv add`, `uv run …`); never bare `pip`.
- Frontend package manager is **pnpm** only; `.npmrc` enforces `minimum-release-age=10080` (7 days). shadcn primitives via `pnpm dlx shadcn@latest add <name>`.
- No config reads outside the settings modules: never `os.getenv` / `import.meta.env.X` in app code; never `load_dotenv`. Add new env to `callup.config.settings` / `src/lib/env.ts`.
- Secrets never enter logs, API responses, or the frontend bundle. `RecruiterOut` never echoes the token.
- Backend: `async def` for all route handlers and I/O; validate only at boundaries (HTTP input, external tokens, DB writes). SQL lives only in `db/repositories.py` — routes never write SQL.
- Enum-like columns are stored as **plain strings**, written via `callup.db.enums` values (e.g. `RecruiterRole.OWNER.value`).
- `org_id` tenancy ships on every business table; turning on multi-tenant is RLS + middleware later, never a column-shape change.
- Fast test suite (`uv run pytest -m "not integration"`) hits **no network and no DB**. DB/live tests are marked `@pytest.mark.integration`.
- Frontend: TypeScript strict, no `any`; Tailwind classes inline; one component per file; verified via `pnpm tsc --noEmit` + `pnpm lint` + manual browser (no frontend test runner).
- Ruff/black line-length 100. Run `uv run ruff check .` and `uv run black .` before each backend commit.

---

## File structure

**Backend (create):**
- `backend/src/callup/auth/__init__.py` — package marker.
- `backend/src/callup/auth/jwt.py` — `TokenClaims`, `AuthError`, `JWKSUnavailable`, `verify_token`.
- `backend/src/callup/api/routes/me.py` — `RecruiterOut` schema + `GET /me`.
- `backend/tests/auth/test_jwt.py` — unit tests for `verify_token`.
- `backend/tests/db/test_repositories.py` — integration test for provisioning.
- `backend/tests/api/test_me.py` — fast route tests (dependency-overridden).

**Backend (modify):**
- `backend/src/callup/config.py` — add `supabase_jwt_aud`, `frontend_origin`.
- `backend/src/callup/db/repositories.py` — add `get_recruiter`, `provision_recruiter`.
- `backend/src/callup/api/deps.py` — add `get_current_recruiter` + `CurrentRecruiter`.
- `backend/src/callup/main.py` — register `me.router`, add CORS middleware.
- `backend/tests/conftest.py` — seed `SUPABASE_URL` default.
- `backend/.env.example` — document new vars.
- `backend/pyproject.toml` — PyJWT dep (via `uv add`).

**Frontend (create):**
- `frontend/src/lib/auth.tsx` — `AuthProvider` + `useAuth`.
- `frontend/src/components/RequireAuth.tsx` — route gate.
- `frontend/src/pages/Login.tsx` — email login/signup form.
- `frontend/src/pages/Home.tsx` — protected home; calls `GET /me`.
- shadcn primitives under `frontend/src/components/ui/` (input, label, card) via CLI.

**Frontend (modify):**
- `frontend/src/App.tsx` — router + providers.

---

## Task 1: Backend JWT verification module

**Files:**
- Create: `backend/src/callup/auth/__init__.py`, `backend/src/callup/auth/jwt.py`
- Create: `backend/tests/auth/__init__.py`, `backend/tests/auth/test_jwt.py`
- Modify: `backend/src/callup/config.py`, `backend/tests/conftest.py`, `backend/pyproject.toml`

**Interfaces:**
- Produces:
  - `callup.auth.jwt.TokenClaims` — frozen dataclass `(sub: uuid.UUID, email: str)`.
  - `callup.auth.jwt.AuthError(Exception)` — token missing/invalid → maps to HTTP 401.
  - `callup.auth.jwt.JWKSUnavailable(Exception)` — key server unreachable → maps to HTTP 503.
  - `callup.auth.jwt.verify_token(token: str) -> TokenClaims`.
  - `settings.supabase_jwt_aud: str` (default `"authenticated"`).

- [ ] **Step 1: Add the PyJWT dependency**

Run from `backend/`:
```bash
uv add "pyjwt[crypto]>=2.10.0"
```
Expected: `pyjwt` and `cryptography` added to `[project].dependencies` in `pyproject.toml` and `uv.lock` updated.

- [ ] **Step 2: Add auth settings**

In `backend/src/callup/config.py`, add these fields inside `Settings` (after the `supabase_*` block, before `# Matching.`):
```python
    # Auth. The Supabase JWT audience claim and the project's JWKS endpoint
    # ({supabase_url}/auth/v1/.well-known/jwks.json) are used to verify bearer tokens.
    supabase_jwt_aud: str = "authenticated"
```

- [ ] **Step 3: Seed SUPABASE_URL for the test suite**

In `backend/tests/conftest.py`, add after the existing `setdefault` calls:
```python
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
```

- [ ] **Step 4: Write the failing tests**

Create `backend/tests/auth/__init__.py` (empty file).

Create `backend/tests/auth/test_jwt.py`:
```python
import datetime as dt
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from callup.auth import jwt as auth_jwt
from callup.auth.jwt import AuthError, verify_token


@pytest.fixture
def keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    return private_key, private_key.public_key()


@pytest.fixture(autouse=True)
def _patch_jwks(monkeypatch, keypair):
    _, public_key = keypair

    class _FakeKey:
        key = public_key

    class _FakeClient:
        def get_signing_key_from_jwt(self, token):
            return _FakeKey()

    monkeypatch.setattr(auth_jwt, "_client", lambda: _FakeClient())


def _make_token(private_key, **overrides):
    now = dt.datetime.now(tz=dt.timezone.utc)
    payload = {
        "sub": str(uuid.uuid4()),
        "email": "rec@example.com",
        "aud": "authenticated",
        "exp": now + dt.timedelta(hours=1),
        "iat": now,
    }
    payload.update(overrides)
    return jwt.encode(payload, private_key, algorithm="ES256")


def test_verify_token_valid(keypair):
    private_key, _ = keypair
    sub = uuid.uuid4()
    token = _make_token(private_key, sub=str(sub))
    claims = verify_token(token)
    assert claims.sub == sub
    assert claims.email == "rec@example.com"


def test_verify_token_expired(keypair):
    private_key, _ = keypair
    now = dt.datetime.now(tz=dt.timezone.utc)
    token = _make_token(private_key, exp=now - dt.timedelta(hours=1))
    with pytest.raises(AuthError):
        verify_token(token)


def test_verify_token_wrong_audience(keypair):
    private_key, _ = keypair
    token = _make_token(private_key, aud="not-authenticated")
    with pytest.raises(AuthError):
        verify_token(token)


def test_verify_token_missing_email(keypair):
    private_key, _ = keypair
    token = _make_token(private_key, email=None)
    with pytest.raises(AuthError):
        verify_token(token)
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `uv run pytest tests/auth/test_jwt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'callup.auth'`.

- [ ] **Step 6: Implement the module**

Create `backend/src/callup/auth/__init__.py` (empty file).

Create `backend/src/callup/auth/jwt.py`:
```python
"""Verify Supabase bearer tokens against the project's asymmetric JWKS.

No shared secret and no per-request call to Supabase: PyJWKClient fetches and caches
the public keys, and verification happens locally. AuthError -> HTTP 401 (the token is
missing/invalid); JWKSUnavailable -> HTTP 503 (the key server is unreachable, which is
an outage, not a bad token).
"""

import uuid
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError

from callup.config import settings


class AuthError(Exception):
    """Bearer token is missing or fails verification (-> HTTP 401)."""


class JWKSUnavailable(Exception):
    """Supabase's key server can't be reached (-> HTTP 503)."""


@dataclass(frozen=True)
class TokenClaims:
    sub: uuid.UUID
    email: str


def _jwks_url() -> str:
    base = settings.supabase_url
    if not base:
        raise RuntimeError("SUPABASE_URL is required for auth but is not set")
    return f"{base.rstrip('/')}/auth/v1/.well-known/jwks.json"


_jwk_client: PyJWKClient | None = None


def _client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(_jwks_url())
    return _jwk_client


def verify_token(token: str) -> TokenClaims:
    try:
        signing_key = _client().get_signing_key_from_jwt(token)
    except PyJWKClientConnectionError as exc:
        raise JWKSUnavailable(str(exc)) from exc
    except jwt.PyJWTError as exc:
        raise AuthError(str(exc)) from exc

    try:
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience=settings.supabase_jwt_aud,
        )
    except jwt.InvalidTokenError as exc:
        raise AuthError(str(exc)) from exc

    sub = payload.get("sub")
    email = payload.get("email")
    if not sub or not email:
        raise AuthError("token missing required sub/email claim")
    return TokenClaims(sub=uuid.UUID(sub), email=email)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `uv run pytest tests/auth/test_jwt.py -v`
Expected: PASS (4 passed).

- [ ] **Step 8: Lint and format**

Run: `uv run ruff check . && uv run black .`
Expected: no errors; files unchanged or reformatted.

- [ ] **Step 9: Commit**

```bash
git add backend/src/callup/auth backend/tests/auth backend/src/callup/config.py backend/tests/conftest.py backend/pyproject.toml backend/uv.lock
git commit -m "Add Supabase JWT verification via JWKS"
```

---

## Task 2: Recruiter provisioning repository

**Files:**
- Modify: `backend/src/callup/db/repositories.py`
- Create: `backend/tests/db/__init__.py`, `backend/tests/db/test_repositories.py`

**Interfaces:**
- Consumes: `callup.db.models.Org`, `callup.db.models.Recruiter`; `callup.db.enums.RecruiterRole`.
- Produces:
  - `repositories.get_recruiter(session: AsyncSession, recruiter_id: uuid.UUID) -> Recruiter | None`
  - `repositories.provision_recruiter(session: AsyncSession, recruiter_id: uuid.UUID, email: str, name: str) -> Recruiter`

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/db/__init__.py` (empty file).

Create `backend/tests/db/test_repositories.py`:
```python
import uuid

import pytest
from sqlalchemy import delete

from callup.db import repositories
from callup.db.models import Org, Recruiter
from callup.db.session import SessionFactory

pytestmark = pytest.mark.integration


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
        # exactly one recruiter, one org for this id
        async with SessionFactory() as s3:
            assert await repositories.get_recruiter(s3, rid) is not None
    finally:
        if org_id is not None:
            async with SessionFactory() as cleanup:
                await cleanup.execute(delete(Recruiter).where(Recruiter.id == rid))
                await cleanup.execute(delete(Org).where(Org.id == org_id))
                await cleanup.commit()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest -m integration tests/db/test_repositories.py -v`
Expected: FAIL — `AttributeError: module 'callup.db.repositories' has no attribute 'provision_recruiter'`. (Requires the live Supabase DB via `.env`.)

- [ ] **Step 3: Implement the repository functions**

Replace the contents of `backend/src/callup/db/repositories.py` with:
```python
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


async def provision_recruiter(
    session: AsyncSession, recruiter_id: uuid.UUID, email: str, name: str
) -> Recruiter:
    """Create a new org owned by this recruiter and the recruiter row (id = auth uid).

    Idempotent: if a concurrent first request already created the row, the unique
    violation is caught and the existing recruiter is returned. Order respects the
    circular org<->recruiter FK: org first (owner null), recruiter next, then backfill
    org.owner_recruiter_id.
    """
    org = Org(name=f"{email}'s workspace")
    session.add(org)
    await session.flush()  # assigns org.id

    recruiter = Recruiter(
        id=recruiter_id,
        org_id=org.id,
        role=RecruiterRole.OWNER.value,
        name=name,
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest -m integration tests/db/test_repositories.py -v`
Expected: PASS (2 passed). Confirm the fast suite still excludes it: `uv run pytest -m "not integration" -q` collects 0 from this file.

- [ ] **Step 5: Lint and format**

Run: `uv run ruff check . && uv run black .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/callup/db/repositories.py backend/tests/db
git commit -m "Add recruiter/org provisioning repository"
```

---

## Task 3: CurrentRecruiter dependency, /me route, CORS

**Files:**
- Modify: `backend/src/callup/api/deps.py`, `backend/src/callup/main.py`, `backend/src/callup/config.py`, `backend/.env.example`
- Create: `backend/src/callup/api/routes/me.py`, `backend/tests/api/__init__.py`, `backend/tests/api/test_me.py`

**Interfaces:**
- Consumes: `callup.auth.jwt.verify_token` / `AuthError` / `JWKSUnavailable`; `repositories.get_recruiter` / `provision_recruiter`; `callup.db.models.Org` / `Recruiter`; `SessionDep`.
- Produces:
  - `callup.api.deps.get_current_recruiter(request, session) -> Recruiter`
  - `callup.api.deps.CurrentRecruiter` (Annotated dependency)
  - `callup.api.routes.me.router` with `GET /me -> RecruiterOut`
  - `RecruiterOut(BaseModel)`: `id, org_id: uuid.UUID`; `email, name, role, org_name: str`
  - `settings.frontend_origin: str` (default `"http://localhost:5173"`)

- [ ] **Step 1: Add the frontend_origin setting**

In `backend/src/callup/config.py`, directly under the `supabase_jwt_aud` line added in Task 1:
```python
    # CORS: the SPA origin allowed to call this API (dev Vite server by default).
    frontend_origin: str = "http://localhost:5173"
```

- [ ] **Step 2: Write the failing route tests**

Create `backend/tests/api/__init__.py` (empty file).

Create `backend/tests/api/test_me.py`:
```python
import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_recruiter
from callup.db.models import Org, Recruiter
from callup.db.session import get_session
from callup.main import app


class _FakeSession:
    async def get(self, model, pk):
        return Org(id=pk, name="Acme workspace")


def _fake_recruiter() -> Recruiter:
    return Recruiter(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        role="owner",
        name="Jane",
        email="jane@example.com",
    )


async def test_me_returns_recruiter_profile():
    recruiter = _fake_recruiter()
    app.dependency_overrides[get_current_recruiter] = lambda: recruiter
    app.dependency_overrides[get_session] = lambda: _FakeSession()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/me")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "jane@example.com"
    assert body["role"] == "owner"
    assert body["org_name"] == "Acme workspace"
    assert "token" not in body


async def test_me_without_token_is_unauthorized():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/me")
    assert response.status_code == 401
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/api/test_me.py -v`
Expected: FAIL — `ImportError: cannot import name 'get_current_recruiter' from 'callup.api.deps'`.

- [ ] **Step 4: Implement the dependency**

Replace the contents of `backend/src/callup/api/deps.py` with:
```python
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from callup.auth.jwt import AuthError, JWKSUnavailable, verify_token
from callup.db import repositories
from callup.db.models import Recruiter
from callup.db.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_current_recruiter(request: Request, session: SessionDep) -> Recruiter:
    """Resolve the authenticated recruiter, provisioning org+recruiter on first sight.

    Routes depend on this for identity and org_id scoping. Missing/invalid token -> 401;
    key-server outage -> 503.
    """
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")

    try:
        claims = verify_token(token)
    except AuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    except JWKSUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "auth key server unavailable"
        ) from exc

    recruiter = await repositories.get_recruiter(session, claims.sub)
    if recruiter is None:
        recruiter = await repositories.provision_recruiter(
            session, claims.sub, claims.email, claims.email.split("@")[0]
        )
    return recruiter


CurrentRecruiter = Annotated[Recruiter, Depends(get_current_recruiter)]
```

- [ ] **Step 5: Implement the /me route**

Create `backend/src/callup/api/routes/me.py`:
```python
import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from callup.api.deps import CurrentRecruiter, SessionDep
from callup.db.models import Org

router = APIRouter(tags=["me"])


class RecruiterOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    org_id: uuid.UUID
    org_name: str


@router.get("/me", response_model=RecruiterOut)
async def me(recruiter: CurrentRecruiter, session: SessionDep) -> RecruiterOut:
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

- [ ] **Step 6: Register the route and add CORS**

Replace the contents of `backend/src/callup/main.py` with:
```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from callup.api.routes import health, me
from callup.config import settings
from callup.db.session import engine


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Callup API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(me.router)
    return app


app = create_app()


def run() -> None:
    """Console entry point (``uv run callup``) — dev server only."""
    import uvicorn

    uvicorn.run(
        "callup.main:app",
        host="127.0.0.1",
        port=8000,
        reload=settings.environment == "development",
    )
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `uv run pytest tests/api/test_me.py -v`
Expected: PASS (2 passed).

- [ ] **Step 8: Run the whole fast suite**

Run: `uv run pytest -m "not integration" -q`
Expected: PASS, no network/DB access (health, config, jwt, me tests).

- [ ] **Step 9: Document new env vars**

In `backend/.env.example`, ensure these are present (add any missing), each with a short comment:
```dotenv
# Supabase project URL — required for auth (JWKS verification of bearer tokens).
SUPABASE_URL=https://<project-ref>.supabase.co
# JWT audience claim Supabase issues (leave default unless you changed it).
SUPABASE_JWT_AUD=authenticated
# CORS: the SPA origin allowed to call this API (dev Vite server default below).
FRONTEND_ORIGIN=http://localhost:5173
```

- [ ] **Step 10: Lint and format**

Run: `uv run ruff check . && uv run black .`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add backend/src/callup/api backend/src/callup/main.py backend/src/callup/config.py backend/.env.example backend/tests/api
git commit -m "Add CurrentRecruiter dependency, /me route, and CORS"
```

---

## Task 4: Frontend auth context

**Files:**
- Create: `frontend/src/lib/auth.tsx`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`.
- Produces:
  - `AuthProvider({ children })` component.
  - `useAuth(): { session: Session | null; loading: boolean; signIn(email, password): Promise<void>; signUp(email, password): Promise<void>; signOut(): Promise<void> }`.

- [ ] **Step 1: Implement the auth context**

Create `frontend/src/lib/auth.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }
  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
  }
  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
```

- [ ] **Step 2: Type-check**

Run from `frontend/`: `pnpm tsc --noEmit`
Expected: no errors. (Visual wiring is verified in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/auth.tsx
git commit -m "Add frontend Supabase auth context"
```

---

## Task 5: Login page and shadcn primitives

**Files:**
- Create (via CLI): `frontend/src/components/ui/input.tsx`, `frontend/src/components/ui/label.tsx`, `frontend/src/components/ui/card.tsx`
- Create: `frontend/src/pages/Login.tsx`

**Interfaces:**
- Consumes: `useAuth` from `@/lib/auth`; `useNavigate` from `react-router-dom`; shadcn `Button`, `Input`, `Label`, `Card*`.
- Produces: default-exported `Login` page component.

- [ ] **Step 1: Add the shadcn primitives**

Run from `frontend/`:
```bash
pnpm dlx shadcn@latest add input label card
```
Expected: creates `src/components/ui/{input,label,card}.tsx`. (These are existing shadcn releases — no `minimum-release-age` override needed.)

- [ ] **Step 2: Implement the login page**

Create `frontend/src/pages/Login.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    try {
      if (mode === 'signin') await signIn(email, password)
      else await signUp(email, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'signin' ? 'Sign in' : 'Create account'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </Button>
          </form>
          <button
            type="button"
            className="text-muted-foreground text-sm underline"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
            }}
          >
            {mode === 'signin' ? 'No account? Sign up' : 'Have an account? Sign in'}
          </button>
        </CardContent>
      </Card>
    </main>
  )
}
```

- [ ] **Step 3: Type-check**

Run from `frontend/`: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui frontend/src/pages/Login.tsx frontend/components.json
git commit -m "Add login page and shadcn form primitives"
```

---

## Task 6: Protected shell — RequireAuth, Home, router wiring

**Files:**
- Create: `frontend/src/components/RequireAuth.tsx`, `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth` from `@/lib/auth`; `api` from `@/lib/api`; `Navigate`/`BrowserRouter`/`Routes`/`Route` from `react-router-dom`; `Button` from `@/components/ui/button`.
- Produces: `RequireAuth` (default), `Home` (default); `App` wired with router + `AuthProvider`.
- The `Home` `/me` response shape mirrors backend `RecruiterOut`: `{ id, email, name, role, org_id, org_name }` (all strings over the wire).

- [ ] **Step 1: Implement the route gate**

Create `frontend/src/components/RequireAuth.tsx`:
```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Loading…
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 2: Implement the protected home page**

Create `frontend/src/pages/Home.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'

type Me = {
  id: string
  email: string
  name: string
  role: string
  org_id: string
  org_name: string
}

export default function Home() {
  const { signOut } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load profile'))
  }, [])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3">
      {error && <p className="text-destructive text-sm">{error}</p>}
      {me && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {me.name}</h1>
          <p className="text-muted-foreground text-sm">
            {me.org_name} · {me.role}
          </p>
        </>
      )}
      {!me && !error && <p className="text-muted-foreground text-sm">Loading…</p>}
      <Button variant="outline" onClick={() => void signOut()}>
        Sign out
      </Button>
    </main>
  )
}
```

- [ ] **Step 3: Wire the router and providers**

Replace the contents of `frontend/src/App.tsx` with:
```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import RequireAuth from '@/components/RequireAuth'
import Login from '@/pages/Login'
import Home from '@/pages/Home'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
```

- [ ] **Step 4: Type-check and lint**

Run from `frontend/`: `pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual browser verification**

Start the backend (`uv run callup` from `backend/`, with a real `.env`) and the frontend (`pnpm dev` from `frontend/`, with `VITE_API_BASE_URL=http://127.0.0.1:8000`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` set). Then verify:
1. Visiting `/` while logged out redirects to `/login`.
2. Sign up with a new email + password → lands on `/` showing "Welcome, &lt;email-local-part&gt;" and the org name.
3. In Supabase, an `org` row and a `recruiter` row (id = auth user id, role `owner`) now exist.
4. Refresh the page → still logged in (session persists).
5. Sign out → redirected to `/login`; visiting `/` again redirects to `/login`.
6. Sign in with the same credentials → back on `/` (no duplicate org/recruiter created).

Expected: all six behaviors hold.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/RequireAuth.tsx frontend/src/pages/Home.tsx frontend/src/App.tsx
git commit -m "Add protected shell with auth-gated home and routing"
```

---

## Task 7: Update roadmap status

**Files:**
- Modify: `docs/todos.md`

- [ ] **Step 1: Mark slice 1 done**

In `docs/todos.md`, change the slice 1 status cell from `▶` to `✅` and the slice 2 (Candidate intake) status from `⬜` to `▶` (next up).

- [ ] **Step 2: Commit**

```bash
git add docs/todos.md
git commit -m "Mark auth/bootstrap slice complete in roadmap"
```

---

## Self-review notes

- **Spec coverage:** auth sequencing → whole plan; per-user-org provisioning → Task 2; JWKS asymmetric verification → Task 1; `config` additions → Tasks 1 & 3; repository functions → Task 2; `CurrentRecruiter` + `/me` → Task 3; CORS → Task 3; auth context/Login/Home/RequireAuth/App → Tasks 4–6; error table (401/503/race/inline) → Tasks 1–3 (codes) and 5 (inline form errors); testing (verify_token unit, provisioning integration, no frontend tests) → Tasks 1, 2, 6. All spec sections map to a task.
- **Type consistency:** `verify_token -> TokenClaims(sub: UUID, email: str)` used by `get_current_recruiter`; `provision_recruiter(session, recruiter_id, email, name)` signature matches its call site in `deps.py`; `RecruiterOut` fields match `Home`'s `Me` type; `useAuth` shape matches its consumers in Login/Home/RequireAuth.
- **No placeholders:** every code step is complete; commands have expected output.
