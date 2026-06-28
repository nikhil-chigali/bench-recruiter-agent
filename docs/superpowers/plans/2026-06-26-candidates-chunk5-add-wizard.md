# Candidates Chunk 5 — Add Wizard (create) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guided 6-step `/candidates/new` wizard that creates a candidate plus its experience/education/projects/certifications in one transaction via a new role-scoped `POST /candidates`, with a localStorage-backed draft that survives refresh and a resume-draft banner on the roster.

**Architecture:** Backend adds `POST /candidates` (Pydantic `CandidateCreate` with nested child schemas) that resolves the assignee server-side (recruiter → self; owner/admin → chosen member or self) and persists the candidate graph in one commit via a new `repositories.create_candidate`, returning the full `CandidateDetail`. Frontend builds a draft model + small step components (presentational, build-only), then a wizard page that holds the draft, autosaves it to `localStorage`, and POSTs on create; the roster gains an "Add candidate" button and a resume-draft banner.

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, Pydantic v2, `uv`, pytest. Frontend — React 19 + TypeScript (strict), Vite, Tailwind v4, React Router 7, `pnpm`, generated `@callup/shared-types`.

## Global Constraints

- Backend is **`uv` only**; frontend is **`pnpm` only** (never npm/yarn). Run backend commands from `backend/`, frontend commands from `frontend/`.
- **No frontend tests** — no `*.test.ts(x)`, no test runner. Frontend is verified by `pnpm build` (type-check + bundle) and `pnpm lint`.
- Backend: logic in `services/`/repositories, **all SQL in `db/repositories.py`**, routes are thin callers (never write SQL). Validate at boundaries with Pydantic. Fast suite (`uv run pytest -m "not integration"`) hits no network/DB and must stay green. Format with `uv run black`.
- **RBAC (security-critical, server-side only):** a recruiter may create candidates **assigned only to themselves**; owner/admin may assign to **any member of their org** (defaulting to self). The assignee is derived from `actor.role` + the request, **never trusted blindly from the client** — a recruiter's `user_id` in the body is ignored and forced to self. New candidates start with status `on_bench`.
- **`years_experience` is derived, never stored** (locked spec decision #1). The wizard does **not** collect a "years" input; Step 2's experience start/end dates drive the derived value. Experience dates are **structured** (`<input type="month">` → first-of-month ISO date).
- **`title` is required at the create-API boundary** (DB column is nullable; the API rejects a blank/missing title with 422).
- Status tokens are `on_bench`/`interviewing`/`placed` (`callup.db.enums.CandidateStatus`); work-authorization tokens are `callup.db.enums.WorkAuthorization` (`USC`, `GC`, `GC_EAD`, `H1B`, `OPT`, `STEM_OPT`, `L2_EAD`, `TN`, `OTHER`).
- **The OpenAPI contract is the source of frontend types (Chunk 2.5).** Any backend route/schema change requires regenerating **both** `backend/openapi.json` (guarded by the fast-suite `test_committed_openapi_is_up_to_date`) **and** `frontend/packages/shared-types/openapi.d.ts` (guarded by the frontend CI drift step). Both are committed and LF-pinned; do not hand-edit them.
- **Documents (Step 5) is a placeholder** this chunk — upload/list is Chunk 8. The wizard renders a static notice and the create request sends no documents.
- Frontend: Tailwind classes inline reusing theme tokens (`bg-card`, `bg-brand`, `border-border`, `border-input`, `text-muted-foreground`, `text-destructive`, `text-foreground`); `@/*` alias; one component per file; TS strict, no `any`; `import type` for type-only imports. Backend types come from `@callup/shared-types`. Content max-width for the wizard is **1000px** (spec).
- **Commit hygiene:** explicit `git add <paths>` only — never `git add -A`/`.`. Never add the untracked `test_creds.txt`. Do not touch the pre-existing unstaged deletion of `docs/IMPLEMENTATION PLAN - Bench Sales Recruiting.docx`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/callup/api/schemas.py` | `ExperienceIn`/`EducationIn`/`ProjectIn`/`CertificationIn` + `CandidateCreate` request schemas | Modify |
| `backend/src/callup/db/repositories.py` | `create_candidate` (build candidate graph + children, one commit, re-fetch detail) | Modify |
| `backend/src/callup/api/routes/candidates.py` | `POST /candidates` + `_resolve_assignee` helper | Modify |
| `backend/tests/api/test_candidates.py` | POST RBAC/validation/children tests | Modify |
| `backend/openapi.json` | regenerated contract | Modify (generated) |
| `frontend/packages/shared-types/openapi.d.ts` | regenerated types | Modify (generated) |
| `frontend/packages/shared-types/index.ts` | `CandidateCreate` alias | Modify |
| `frontend/src/lib/candidateDraft.ts` | draft model + localStorage load/save/clear | Create |
| `frontend/src/lib/workAuth.ts` | work-authorization options (value/label) | Create |
| `frontend/src/components/wizard/Field.tsx` | shared labelled-field + input class | Create |
| `frontend/src/components/wizard/WizardStepper.tsx` | left stepper + progress bar | Create |
| `frontend/src/components/wizard/BasicsStep.tsx` | Step 1 (basics + skills chip editor) | Create |
| `frontend/src/components/wizard/ExperienceStep.tsx` | Step 2 (repeatable experience) | Create |
| `frontend/src/components/wizard/EducationStep.tsx` | Step 3 (repeatable education) | Create |
| `frontend/src/components/wizard/ProjectsCertsStep.tsx` | Step 4 (repeatable projects + certs) | Create |
| `frontend/src/components/wizard/DocumentsStep.tsx` | Step 5 placeholder | Create |
| `frontend/src/components/wizard/ReviewStep.tsx` | Step 6 (summary + assignee select) | Create |
| `frontend/src/pages/AddCandidate.tsx` | wizard page: state, autosave, nav, submit | Create |
| `frontend/src/App.tsx` | `/candidates/new` route | Modify |
| `frontend/src/pages/Candidates.tsx` | "Add candidate" button + resume-draft banner | Modify |

---

## Task 1: `POST /candidates` create endpoint (backend) + contract regeneration

**Files:**
- Modify: `backend/src/callup/api/schemas.py`
- Modify: `backend/src/callup/db/repositories.py`
- Modify: `backend/src/callup/api/routes/candidates.py`
- Modify: `backend/tests/api/test_candidates.py`
- Modify (generated): `backend/openapi.json`, `frontend/packages/shared-types/openapi.d.ts`

**Interfaces:**
- Produces: `POST /candidates` accepting `CandidateCreate`, returning `CandidateDetail` with `201`. The frontend (Tasks 2–6) consumes `CandidateCreate` (request) and the existing `CandidateDetail` (response).
- Produces: `repositories.create_candidate(session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, data: CandidateCreate) -> Candidate` (builds the candidate + children, commits once, returns the detail-loaded candidate).
- Produces: module helper `_resolve_assignee(actor: User, requested_user_id: uuid.UUID | None, session: AsyncSession) -> uuid.UUID`.

- [ ] **Step 1: Write the failing POST tests**

In `backend/tests/api/test_candidates.py`, append (the file already defines `ORG`, `ACTOR`, `OTHER`, `CAND`, `_actor`, `_candidate`, `_detailed_candidate`, `_Session`, `_client`, and imports `uuid`, `repositories`, `User`, `get_current_user`, `get_session`, `app`):

```python
async def test_recruiter_creates_self_assigned(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["user_id"] = user_id
        captured["name"] = data.name
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "New Cand", "title": "Engineer"})
        assert resp.status_code == 201
        assert captured["user_id"] == ACTOR
        assert captured["name"] == "New Cand"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_ignores_requested_assignee(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["user_id"] = user_id
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "X", "title": "Y", "user_id": str(OTHER)})
        assert resp.status_code == 201
        assert captured["user_id"] == ACTOR  # recruiter forced to self, body user_id ignored
    finally:
        app.dependency_overrides.clear()


async def test_owner_creates_with_explicit_assignee(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["user_id"] = user_id
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return User(id=user_id, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "X", "title": "Y", "user_id": str(OTHER)})
        assert resp.status_code == 201
        assert captured["user_id"] == OTHER
        assert resp.json()["recruiter_name"] == "Other Rec"
    finally:
        app.dependency_overrides.clear()


async def test_owner_assignee_not_member_returns_400(monkeypatch):
    called = {"created": False}

    async def fake_create(session, org_id, user_id, data):
        called["created"] = True
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return None  # requested assignee is not a member of this org

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "X", "title": "Y", "user_id": str(OTHER)})
        assert resp.status_code == 400
        assert called["created"] is False
    finally:
        app.dependency_overrides.clear()


async def test_create_persists_children(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["data"] = data
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/candidates",
                json={
                    "name": "X",
                    "title": "Y",
                    "primary_skills": ["Go", "  ", "Rust"],
                    "experience": [
                        {
                            "company": "Acme",
                            "position": "Dev",
                            "start_date": "2020-01-01",
                            "end_date": "2022-01-01",
                        }
                    ],
                    "education": [{"university": "MIT", "degree": "BS"}],
                    "projects": [{"title": "P1"}],
                    "certifications": [{"name": "AWS"}],
                },
            )
        assert resp.status_code == 201
        data = captured["data"]
        assert data.primary_skills == ["Go", "Rust"]  # blanks dropped, order preserved
        assert len(data.experience) == 1 and data.experience[0].company == "Acme"
        assert len(data.education) == 1 and data.education[0].university == "MIT"
        assert len(data.projects) == 1 and data.projects[0].title == "P1"
        assert len(data.certifications) == 1 and data.certifications[0].name == "AWS"
    finally:
        app.dependency_overrides.clear()


async def test_create_requires_title_returns_422(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "X", "title": "   "})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run the POST tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: the six new `test_*create*` / assignee tests FAIL (no `POST /candidates` route yet → 405/404, and `repositories.create_candidate` does not exist so `monkeypatch.setattr` raises `AttributeError`). This confirms the tests exercise unbuilt code.

- [ ] **Step 3: Add the request schemas**

In `backend/src/callup/api/schemas.py`, change the imports at the top:
```python
import datetime as _dt
import uuid

from pydantic import BaseModel
```
to:
```python
import datetime as _dt
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

from callup.db.enums import WorkAuthorization

_WORK_AUTHS = {w.value for w in WorkAuthorization}
```

Then append at the end of the file:
```python
class ExperienceIn(BaseModel):
    company: str
    position: str | None = None
    start_date: _dt.date | None = None
    end_date: _dt.date | None = None

    @field_validator("company")
    @classmethod
    def _company(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company is required")
        return v

    @model_validator(mode="after")
    def _dates(self) -> "ExperienceIn":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class EducationIn(BaseModel):
    university: str
    degree: str | None = None

    @field_validator("university")
    @classmethod
    def _university(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("university is required")
        return v


class ProjectIn(BaseModel):
    title: str
    project_link: str | None = None
    github_link: str | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title is required")
        return v


class CertificationIn(BaseModel):
    name: str
    issued_by: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class CandidateCreate(BaseModel):
    name: str
    title: str
    primary_skills: list[str] = Field(default_factory=list)
    work_authorization: str | None = None
    location: str | None = None
    email: str | None = None
    phone: str | None = None
    user_id: uuid.UUID | None = None
    experience: list[ExperienceIn] = Field(default_factory=list)
    education: list[EducationIn] = Field(default_factory=list)
    projects: list[ProjectIn] = Field(default_factory=list)
    certifications: list[CertificationIn] = Field(default_factory=list)

    @field_validator("name", "title")
    @classmethod
    def _required_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 200:
            raise ValueError("must be at most 200 characters")
        return v

    @field_validator("location", "email", "phone")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("work_authorization")
    @classmethod
    def _work_auth(cls, v: str | None) -> str | None:
        if not v:
            return None
        if v not in _WORK_AUTHS:
            raise ValueError("invalid work authorization")
        return v

    @field_validator("primary_skills")
    @classmethod
    def _skills(cls, v: list[str]) -> list[str]:
        return [s.strip() for s in v if s and s.strip()]
```

- [ ] **Step 4: Add the repository create function**

In `backend/src/callup/db/repositories.py`, change the top-of-file imports. Change:
```python
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from callup.db.enums import InvitationStatus, RecruiterRole
from callup.db.models import Candidate, Invitation, Org, User
```
to:
```python
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
```

Then append at the end of the file:
```python
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
```

- [ ] **Step 5: Add the POST route + `_resolve_assignee`**

In `backend/src/callup/api/routes/candidates.py`, change the imports. Change:
```python
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentUser, SessionDep
from callup.api.schemas import (
    CandidateCard,
    CandidateDetail,
    CertificationOut,
    EducationOut,
    ExperienceOut,
    ProjectOut,
)
```
to:
```python
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from callup.api.deps import CurrentUser, SessionDep
from callup.api.schemas import (
    CandidateCard,
    CandidateCreate,
    CandidateDetail,
    CertificationOut,
    EducationOut,
    ExperienceOut,
    ProjectOut,
)
```

Then add the assignee helper directly after the existing `_ensure_access` function:
```python
async def _resolve_assignee(
    actor: User, requested_user_id: uuid.UUID | None, session: AsyncSession
) -> uuid.UUID:
    """Who the new candidate is assigned to. Recruiters are forced to themselves; owner/admin
    may pick any member of their org (defaulting to self)."""
    if actor.role == RecruiterRole.RECRUITER.value:
        return actor.id
    if requested_user_id is None:
        return actor.id
    member = await repositories.get_member(session, requested_user_id, actor.org_id)
    if member is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "assignee is not a member of this org")
    return member.id
```

Then add the POST route directly after the `list_candidates` route (so it sits before the `/{candidate_id}` routes, though FastAPI ranks static `/candidates` ahead of params regardless):
```python
@router.post("/candidates", response_model=CandidateDetail, status_code=status.HTTP_201_CREATED)
async def create_candidate(
    body: CandidateCreate, actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    assignee_id = await _resolve_assignee(actor, body.user_id, session)
    candidate = await repositories.create_candidate(session, actor.org_id, assignee_id, body)
    member = await repositories.get_member(session, candidate.user_id, actor.org_id)
    return _detail(candidate, member.name if member is not None else "—")
```

- [ ] **Step 6: Run the candidate tests to verify they pass**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: all candidate tests pass (3 GET-list + 5 PATCH + 4 GET-detail + 6 POST = 18).

- [ ] **Step 7: Regenerate the committed OpenAPI contract**

From `backend/`:
```bash
uv run python -m callup.openapi_export
```
Expected: prints `wrote .../backend/openapi.json`; the diff adds the `post` operation under `/candidates` and the `CandidateCreate`/`ExperienceIn`/`EducationIn`/`ProjectIn`/`CertificationIn` schemas.

- [ ] **Step 8: Run the fast suite (incl. the drift guard) and format**

From `backend/`:
```bash
uv run pytest -m "not integration"
uv run black .
```
Expected: all pass — `test_committed_openapi_is_up_to_date` green after regeneration. Count goes from 71 to **77** (6 new POST tests). `black` reports no changes (or reformats the edited files — re-run to confirm clean).

- [ ] **Step 9: Propagate the contract to the frontend types**

From `frontend/`:
```bash
pnpm gen:types
```
Expected: `packages/shared-types/openapi.d.ts` updates with the new `post` operation under `/candidates` and the `CandidateCreate` + child input schemas.

- [ ] **Step 10: Commit**

From the repo root (explicit adds; never `git add -A`/`.`; never add `test_creds.txt`):
```bash
git add backend/src/callup/api/schemas.py backend/src/callup/db/repositories.py backend/src/callup/api/routes/candidates.py backend/tests/api/test_candidates.py backend/openapi.json frontend/packages/shared-types/openapi.d.ts
git commit -m "Add POST /candidates create endpoint and regenerate contract types"
```

---

## Task 2: Frontend foundation — `CandidateCreate` alias, draft lib, work-auth options

**Files:**
- Modify: `frontend/packages/shared-types/index.ts`
- Create: `frontend/src/lib/candidateDraft.ts`
- Create: `frontend/src/lib/workAuth.ts`

**Interfaces:**
- Consumes: generated `components['schemas']['CandidateCreate']` (Task 1).
- Produces: `@callup/shared-types` alias `CandidateCreate`; `@/lib/candidateDraft` exports `CandidateDraft`, `ExperienceDraft`, `EducationDraft`, `ProjectDraft`, `CertificationDraft`, `EMPTY_DRAFT`, `isDraftEmpty`, `loadDraft`, `saveDraft`, `clearDraft`, `hasDraft`; `@/lib/workAuth` exports `WORK_AUTH_OPTIONS`. Tasks 3–6 consume all of these.

- [ ] **Step 1: Add the `CandidateCreate` alias**

In `frontend/packages/shared-types/index.ts`, append below the existing aliases:
```ts
/** Backend `POST /candidates` request body (generated). */
export type CandidateCreate = components['schemas']['CandidateCreate']
```

- [ ] **Step 2: Create the draft model + localStorage helpers**

Create `frontend/src/lib/candidateDraft.ts`:
```ts
// The wizard's working form, persisted to localStorage so a half-finished candidate
// survives a refresh. Dates are "YYYY-MM" strings (from <input type="month">); they are
// converted to first-of-month ISO dates at submit time.
export type ExperienceDraft = { company: string; position: string; start_date: string; end_date: string }
export type EducationDraft = { university: string; degree: string }
export type ProjectDraft = { title: string; project_link: string; github_link: string }
export type CertificationDraft = { name: string; issued_by: string }

export type CandidateDraft = {
  name: string
  title: string
  primary_skills: string[]
  work_authorization: string
  location: string
  email: string
  phone: string
  user_id: string // assignee (managers only); '' means assign to self
  experience: ExperienceDraft[]
  education: EducationDraft[]
  projects: ProjectDraft[]
  certifications: CertificationDraft[]
}

export const EMPTY_DRAFT: CandidateDraft = {
  name: '',
  title: '',
  primary_skills: [],
  work_authorization: '',
  location: '',
  email: '',
  phone: '',
  user_id: '',
  experience: [],
  education: [],
  projects: [],
  certifications: [],
}

const KEY = 'callup_candidate_draft'

// The assignee (user_id) alone does not make a draft "real" — only entered candidate data does.
export function isDraftEmpty(d: CandidateDraft): boolean {
  return (
    !d.name &&
    !d.title &&
    d.primary_skills.length === 0 &&
    !d.work_authorization &&
    !d.location &&
    !d.email &&
    !d.phone &&
    d.experience.length === 0 &&
    d.education.length === 0 &&
    d.projects.length === 0 &&
    d.certifications.length === 0
  )
}

export function loadDraft(): CandidateDraft | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CandidateDraft>
    return { ...EMPTY_DRAFT, ...parsed }
  } catch {
    return null
  }
}

export function saveDraft(d: CandidateDraft): void {
  if (isDraftEmpty(d)) {
    localStorage.removeItem(KEY)
    return
  }
  localStorage.setItem(KEY, JSON.stringify(d))
}

export function clearDraft(): void {
  localStorage.removeItem(KEY)
}

export function hasDraft(): boolean {
  const d = loadDraft()
  return d != null && !isDraftEmpty(d)
}
```

- [ ] **Step 3: Create the work-authorization options**

Create `frontend/src/lib/workAuth.ts`:
```ts
// Mirrors callup.db.enums.WorkAuthorization (validated server-side). value = stored token.
export const WORK_AUTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'USC', label: 'US Citizen' },
  { value: 'GC', label: 'Green Card' },
  { value: 'GC_EAD', label: 'GC-EAD' },
  { value: 'H1B', label: 'H-1B' },
  { value: 'OPT', label: 'OPT' },
  { value: 'STEM_OPT', label: 'STEM OPT' },
  { value: 'L2_EAD', label: 'L2-EAD' },
  { value: 'TN', label: 'TN' },
  { value: 'OTHER', label: 'Other' },
]
```

- [ ] **Step 4: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed (the new modules are unconsumed until later tasks — they just need to type-check).

- [ ] **Step 5: Commit**

From the repo root:
```bash
git add frontend/packages/shared-types/index.ts frontend/src/lib/candidateDraft.ts frontend/src/lib/workAuth.ts
git commit -m "Add candidate-create type alias, wizard draft model, and work-auth options"
```

---

## Task 3: Wizard primitives + Steps 1–3 (Field, Stepper, Basics, Experience, Education)

**Files:**
- Create: `frontend/src/components/wizard/Field.tsx`
- Create: `frontend/src/components/wizard/WizardStepper.tsx`
- Create: `frontend/src/components/wizard/BasicsStep.tsx`
- Create: `frontend/src/components/wizard/ExperienceStep.tsx`
- Create: `frontend/src/components/wizard/EducationStep.tsx`

**Interfaces:**
- Consumes: `CandidateDraft`, `ExperienceDraft`, `EducationDraft` (`@/lib/candidateDraft`); `WORK_AUTH_OPTIONS` (`@/lib/workAuth`).
- Produces: `Field({ label, children, hint? })` + `inputClass` (named exports from `@/components/wizard/Field`); `default WizardStepper({ steps, current, onJump })` with exported `type Step = { key: string; label: string }`; `default BasicsStep({ draft, update, errors })`; `default ExperienceStep({ draft, update })`; `default EducationStep({ draft, update })` where `update: (patch: Partial<CandidateDraft>) => void`. Tasks 4–5 consume all of these.

- [ ] **Step 1: Create the shared `Field` primitive**

Create `frontend/src/components/wizard/Field.tsx`:
```tsx
import type { ReactNode } from 'react'

export const inputClass =
  'h-[38px] w-full rounded-[9px] border border-input bg-card px-3 text-[13.5px] outline-none focus:border-[#a5b4fc]'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[#52525b]">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-destructive">{hint}</span>}
    </label>
  )
}
```

- [ ] **Step 2: Create the `WizardStepper`**

Create `frontend/src/components/wizard/WizardStepper.tsx`:
```tsx
export type Step = { key: string; label: string }

export default function WizardStepper({
  steps,
  current,
  onJump,
}: {
  steps: Step[]
  current: number
  onJump: (index: number) => void
}) {
  const pct = Math.round(((current + 1) / steps.length) * 100)
  return (
    <div className="w-[220px] flex-none">
      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-[#f0f0f1]">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ol className="flex flex-col gap-0.5">
        {steps.map((s, i) => {
          const state = i === current ? 'current' : i < current ? 'done' : 'todo'
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onJump(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] ${
                  state === 'current'
                    ? 'bg-[#f4f4f5] font-medium text-foreground'
                    : state === 'done'
                      ? 'text-foreground hover:bg-[#f4f4f5]'
                      : 'text-[#a1a1aa] hover:bg-[#f4f4f5]'
                }`}
              >
                <span
                  className={`flex size-5 flex-none items-center justify-center rounded-full text-[11px] font-semibold ${
                    state === 'todo' ? 'border border-[#d4d4d8] text-[#a1a1aa]' : 'bg-brand text-white'
                  }`}
                >
                  {state === 'done' ? '✓' : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
```

- [ ] **Step 3: Create `BasicsStep`**

Create `frontend/src/components/wizard/BasicsStep.tsx`:
```tsx
import { useState } from 'react'
import type { CandidateDraft } from '@/lib/candidateDraft'
import { WORK_AUTH_OPTIONS } from '@/lib/workAuth'
import { Field, inputClass } from '@/components/wizard/Field'

export default function BasicsStep({
  draft,
  update,
  errors,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
  errors: { name?: string; title?: string }
}) {
  const [skill, setSkill] = useState('')

  function addSkill() {
    const s = skill.trim()
    setSkill('')
    if (!s || draft.primary_skills.includes(s)) return
    update({ primary_skills: [...draft.primary_skills, s] })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name *" hint={errors.name}>
          <input className={inputClass} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Title *" hint={errors.title}>
          <input
            className={inputClass}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Senior Backend Engineer"
          />
        </Field>
      </div>

      <Field label="Primary skills">
        <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-input bg-card p-2">
          {draft.primary_skills.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-[6px] bg-[#f4f4f5] px-2 py-0.5 text-[12px] text-[#52525b]"
            >
              {s}
              <button
                type="button"
                onClick={() => update({ primary_skills: draft.primary_skills.filter((x) => x !== s) })}
                className="text-[#a1a1aa] hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSkill()
              }
            }}
            onBlur={addSkill}
            placeholder="Add a skill…"
            className="min-w-[120px] flex-1 bg-transparent px-1 text-[13px] outline-none"
          />
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Work authorization">
          <select
            className={inputClass}
            value={draft.work_authorization}
            onChange={(e) => update({ work_authorization: e.target.value })}
          >
            <option value="">—</option>
            {WORK_AUTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input
            className={inputClass}
            value={draft.location}
            onChange={(e) => update({ location: e.target.value })}
            placeholder="Austin, TX"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Email">
          <input className={inputClass} type="email" value={draft.email} onChange={(e) => update({ email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className={inputClass} value={draft.phone} onChange={(e) => update({ phone: e.target.value })} />
        </Field>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `ExperienceStep`**

Create `frontend/src/components/wizard/ExperienceStep.tsx`:
```tsx
import type { CandidateDraft, ExperienceDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'

const EMPTY: ExperienceDraft = { company: '', position: '', start_date: '', end_date: '' }

export default function ExperienceStep({
  draft,
  update,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
}) {
  const rows = draft.experience
  function set(i: number, patch: Partial<ExperienceDraft>) {
    update({ experience: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && <p className="text-[13px] text-muted-foreground">No experience added yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-[12px] border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company">
              <input className={inputClass} value={r.company} onChange={(e) => set(i, { company: e.target.value })} />
            </Field>
            <Field label="Position">
              <input className={inputClass} value={r.position} onChange={(e) => set(i, { position: e.target.value })} />
            </Field>
            <Field label="Start">
              <input className={inputClass} type="month" value={r.start_date} onChange={(e) => set(i, { start_date: e.target.value })} />
            </Field>
            <Field label="End (leave blank if current)">
              <input className={inputClass} type="month" value={r.end_date} onChange={(e) => set(i, { end_date: e.target.value })} />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => update({ experience: rows.filter((_, j) => j !== i) })}
            className="mt-3 text-[12.5px] text-destructive hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update({ experience: [...rows, EMPTY] })}
        className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
      >
        + Add experience
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Create `EducationStep`**

Create `frontend/src/components/wizard/EducationStep.tsx`:
```tsx
import type { CandidateDraft, EducationDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'

const EMPTY: EducationDraft = { university: '', degree: '' }

export default function EducationStep({
  draft,
  update,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
}) {
  const rows = draft.education
  function set(i: number, patch: Partial<EducationDraft>) {
    update({ education: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 && <p className="text-[13px] text-muted-foreground">No education added yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-[12px] border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="University">
              <input className={inputClass} value={r.university} onChange={(e) => set(i, { university: e.target.value })} />
            </Field>
            <Field label="Degree">
              <input
                className={inputClass}
                value={r.degree}
                onChange={(e) => set(i, { degree: e.target.value })}
                placeholder="BS Computer Science"
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => update({ education: rows.filter((_, j) => j !== i) })}
            className="mt-3 text-[12.5px] text-destructive hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update({ education: [...rows, EMPTY] })}
        className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
      >
        + Add education
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed (components are unconsumed until Task 5 — they just need to type-check).

- [ ] **Step 7: Commit**

From the repo root:
```bash
git add frontend/src/components/wizard/Field.tsx frontend/src/components/wizard/WizardStepper.tsx frontend/src/components/wizard/BasicsStep.tsx frontend/src/components/wizard/ExperienceStep.tsx frontend/src/components/wizard/EducationStep.tsx
git commit -m "Add wizard field/stepper primitives and basics/experience/education steps"
```

---

## Task 4: Steps 4–6 (ProjectsCerts, Documents placeholder, Review)

**Files:**
- Create: `frontend/src/components/wizard/ProjectsCertsStep.tsx`
- Create: `frontend/src/components/wizard/DocumentsStep.tsx`
- Create: `frontend/src/components/wizard/ReviewStep.tsx`

**Interfaces:**
- Consumes: `CandidateDraft`, `ProjectDraft`, `CertificationDraft` (`@/lib/candidateDraft`); `Field`/`inputClass` (`@/components/wizard/Field`).
- Produces: `default ProjectsCertsStep({ draft, update })`; `default DocumentsStep()`; `default ReviewStep({ draft, update, isManager, recruiters })` where `recruiters: { id: string; name: string }[]`. Task 5 consumes all three.

- [ ] **Step 1: Create `ProjectsCertsStep`**

Create `frontend/src/components/wizard/ProjectsCertsStep.tsx`:
```tsx
import type { CandidateDraft, ProjectDraft, CertificationDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'

const EMPTY_PROJECT: ProjectDraft = { title: '', project_link: '', github_link: '' }
const EMPTY_CERT: CertificationDraft = { name: '', issued_by: '' }

export default function ProjectsCertsStep({
  draft,
  update,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
}) {
  const projects = draft.projects
  const certs = draft.certifications
  function setP(i: number, patch: Partial<ProjectDraft>) {
    update({ projects: projects.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  function setC(i: number, patch: Partial<CertificationDraft>) {
    update({ certifications: certs.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  }
  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold">Projects</h3>
        {projects.length === 0 && <p className="text-[13px] text-muted-foreground">No projects added yet.</p>}
        {projects.map((r, i) => (
          <div key={i} className="rounded-[12px] border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Title">
                <input className={inputClass} value={r.title} onChange={(e) => setP(i, { title: e.target.value })} />
              </Field>
              <Field label="Project link">
                <input className={inputClass} value={r.project_link} onChange={(e) => setP(i, { project_link: e.target.value })} />
              </Field>
              <Field label="GitHub link">
                <input className={inputClass} value={r.github_link} onChange={(e) => setP(i, { github_link: e.target.value })} />
              </Field>
            </div>
            <button
              type="button"
              onClick={() => update({ projects: projects.filter((_, j) => j !== i) })}
              className="mt-3 text-[12.5px] text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ projects: [...projects, EMPTY_PROJECT] })}
          className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
        >
          + Add project
        </button>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-[14px] font-semibold">Certifications</h3>
        {certs.length === 0 && <p className="text-[13px] text-muted-foreground">No certifications added yet.</p>}
        {certs.map((r, i) => (
          <div key={i} className="rounded-[12px] border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name">
                <input className={inputClass} value={r.name} onChange={(e) => setC(i, { name: e.target.value })} />
              </Field>
              <Field label="Issued by">
                <input className={inputClass} value={r.issued_by} onChange={(e) => setC(i, { issued_by: e.target.value })} />
              </Field>
            </div>
            <button
              type="button"
              onClick={() => update({ certifications: certs.filter((_, j) => j !== i) })}
              className="mt-3 text-[12.5px] text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ certifications: [...certs, EMPTY_CERT] })}
          className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
        >
          + Add certification
        </button>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Create the `DocumentsStep` placeholder**

Create `frontend/src/components/wizard/DocumentsStep.tsx`:
```tsx
export default function DocumentsStep() {
  return (
    <div className="rounded-[12px] border border-dashed border-input bg-card p-8 text-center">
      <p className="text-[13px] text-muted-foreground">
        Document uploads arrive in a later update. You can create the candidate now and add documents
        later.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Create `ReviewStep`**

Create `frontend/src/components/wizard/ReviewStep.tsx`:
```tsx
import type { CandidateDraft } from '@/lib/candidateDraft'
import { Field, inputClass } from '@/components/wizard/Field'

export default function ReviewStep({
  draft,
  update,
  isManager,
  recruiters,
}: {
  draft: CandidateDraft
  update: (patch: Partial<CandidateDraft>) => void
  isManager: boolean
  recruiters: { id: string; name: string }[]
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[12px] border border-border bg-card p-4 text-[13px]">
        <div className="text-[15px] font-semibold">{draft.name || '—'}</div>
        <div className="text-muted-foreground">{draft.title || '—'}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {draft.primary_skills.map((s) => (
            <span
              key={s}
              className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#52525b]"
            >
              {s}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-y-1 text-[12.5px] text-[#52525b]">
          <span>Work auth: {draft.work_authorization || '—'}</span>
          <span>Location: {draft.location || '—'}</span>
          <span>Experience entries: {draft.experience.length}</span>
          <span>Education entries: {draft.education.length}</span>
          <span>Projects: {draft.projects.length}</span>
          <span>Certifications: {draft.certifications.length}</span>
        </div>
      </div>

      {isManager && (
        <Field label="Assign to">
          <select className={inputClass} value={draft.user_id} onChange={(e) => update({ user_id: e.target.value })}>
            <option value="">Myself</option>
            {recruiters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 5: Commit**

From the repo root:
```bash
git add frontend/src/components/wizard/ProjectsCertsStep.tsx frontend/src/components/wizard/DocumentsStep.tsx frontend/src/components/wizard/ReviewStep.tsx
git commit -m "Add wizard projects/certs, documents placeholder, and review steps"
```

---

## Task 5: Wizard page + route

**Files:**
- Create: `frontend/src/pages/AddCandidate.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `api.post<CandidateDetail>` (`@/lib/api`); `useProfile` (`@/lib/profile`); `useNavigate`/`Link` (react-router-dom); types `CandidateCreate`/`CandidateDetail`/`Member` (`@callup/shared-types`); `EMPTY_DRAFT`/`loadDraft`/`saveDraft`/`clearDraft`/`CandidateDraft` (`@/lib/candidateDraft`); `AppLayout`; `WizardStepper` (+ no need to import `Step`); `BasicsStep`/`ExperienceStep`/`EducationStep` (Task 3); `ProjectsCertsStep`/`DocumentsStep`/`ReviewStep` (Task 4).
- Produces: the `/candidates/new` page; on success it navigates to `/candidates/:id`.

- [ ] **Step 1: Create the wizard page**

Create `frontend/src/pages/AddCandidate.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import type { CandidateCreate, CandidateDetail, Member } from '@callup/shared-types'
import { EMPTY_DRAFT, clearDraft, loadDraft, saveDraft, type CandidateDraft } from '@/lib/candidateDraft'
import AppLayout from '@/components/AppLayout'
import WizardStepper from '@/components/wizard/WizardStepper'
import BasicsStep from '@/components/wizard/BasicsStep'
import ExperienceStep from '@/components/wizard/ExperienceStep'
import EducationStep from '@/components/wizard/EducationStep'
import ProjectsCertsStep from '@/components/wizard/ProjectsCertsStep'
import DocumentsStep from '@/components/wizard/DocumentsStep'
import ReviewStep from '@/components/wizard/ReviewStep'

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'experience', label: 'Experience' },
  { key: 'education', label: 'Education' },
  { key: 'projects', label: 'Projects & certs' },
  { key: 'documents', label: 'Documents' },
  { key: 'review', label: 'Review & create' },
]

// <input type="month"> gives "YYYY-MM"; the API wants a date, so anchor to the first of the month.
function monthToDate(m: string): string | null {
  return m ? `${m}-01` : null
}

function toPayload(d: CandidateDraft, isManager: boolean): CandidateCreate {
  return {
    name: d.name.trim(),
    title: d.title.trim(),
    primary_skills: d.primary_skills,
    work_authorization: d.work_authorization || null,
    location: d.location || null,
    email: d.email || null,
    phone: d.phone || null,
    user_id: isManager && d.user_id ? d.user_id : null,
    experience: d.experience
      .filter((e) => e.company.trim())
      .map((e) => ({
        company: e.company.trim(),
        position: e.position.trim() || null,
        start_date: monthToDate(e.start_date),
        end_date: monthToDate(e.end_date),
      })),
    education: d.education
      .filter((e) => e.university.trim())
      .map((e) => ({ university: e.university.trim(), degree: e.degree.trim() || null })),
    projects: d.projects
      .filter((p) => p.title.trim())
      .map((p) => ({
        title: p.title.trim(),
        project_link: p.project_link.trim() || null,
        github_link: p.github_link.trim() || null,
      })),
    certifications: d.certifications
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), issued_by: c.issued_by.trim() || null })),
  }
}

export default function AddCandidate() {
  const { user } = useProfile()
  const isManager = user?.role === 'owner' || user?.role === 'admin'
  const navigate = useNavigate()

  const [draft, setDraft] = useState<CandidateDraft>(() => loadDraft() ?? EMPTY_DRAFT)
  const [step, setStep] = useState(0)
  const [recruiters, setRecruiters] = useState<{ id: string; name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  // Autosave on every change (saveDraft clears the key when the draft is empty).
  useEffect(() => {
    saveDraft(draft)
  }, [draft])

  // Managers load recruiter members for the assignee select.
  useEffect(() => {
    if (!isManager) return
    let ignore = false
    api
      .get<Member[]>('/members')
      .then((ms) => {
        if (!ignore)
          setRecruiters(ms.filter((m) => m.role === 'recruiter').map((m) => ({ id: m.id, name: m.name })))
      })
      .catch(() => {
        if (!ignore) setRecruiters([])
      })
    return () => {
      ignore = true
    }
  }, [isManager])

  function update(patch: Partial<CandidateDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  const errors = useMemo(() => {
    const e: { name?: string; title?: string } = {}
    if (!draft.name.trim()) e.name = 'Name is required'
    if (!draft.title.trim()) e.title = 'Title is required'
    return e
  }, [draft.name, draft.title])

  const basicsValid = !errors.name && !errors.title

  function goNext() {
    if (step === 0 && !basicsValid) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  function goBack() {
    setStep((s) => Math.max(s - 1, 0))
  }
  function saveAndExit() {
    saveDraft(draft)
    navigate('/candidates')
  }

  async function create() {
    if (!basicsValid) {
      setStep(0)
      setShowErrors(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await api.post<CandidateDetail>('/candidates', toPayload(draft, isManager))
      clearDraft()
      navigate(`/candidates/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create candidate')
    } finally {
      setSubmitting(false)
    }
  }

  if (!user) return null

  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1000px] px-9 pt-[22px] pb-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Link to="/candidates" className="hover:text-foreground">
              Candidates
            </Link>
            <span className="text-[#d4d4d8]">/</span>
            <span className="text-foreground">New candidate</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#a1a1aa]">Draft saved automatically</span>
            <button type="button" onClick={saveAndExit} className="text-[13px] text-[#5b46e0] hover:underline">
              Save &amp; exit
            </button>
          </div>
        </div>

        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.015em]">Add candidate</h1>

        <div className="mt-6 flex gap-8">
          <WizardStepper
            steps={STEPS}
            current={step}
            onJump={(i) => {
              if (i === 0 || basicsValid) setStep(i)
            }}
          />

          <div className="min-w-0 flex-1">
            {step === 0 && <BasicsStep draft={draft} update={update} errors={showErrors ? errors : {}} />}
            {step === 1 && <ExperienceStep draft={draft} update={update} />}
            {step === 2 && <EducationStep draft={draft} update={update} />}
            {step === 3 && <ProjectsCertsStep draft={draft} update={update} />}
            {step === 4 && <DocumentsStep />}
            {step === 5 && <ReviewStep draft={draft} update={update} isManager={isManager} recruiters={recruiters} />}

            {error && <p className="mt-4 text-[13px] text-destructive">{error}</p>}

            <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
              <button
                type="button"
                onClick={goBack}
                disabled={step === 0}
                className="rounded-[9px] border border-input bg-card px-4 py-2 text-[13px] hover:bg-[#f4f4f5] disabled:opacity-40"
              >
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-[9px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
                >
                  Save &amp; continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={create}
                  disabled={submitting}
                  className="rounded-[9px] bg-brand px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create candidate'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
```

- [ ] **Step 2: Register the `/candidates/new` route**

In `frontend/src/App.tsx`, add the import below the other page imports (after the `CandidateProfile` import line):
```tsx
import AddCandidate from '@/pages/AddCandidate'
```

Then add the route **before** the existing `/candidates/:id` route block (declare static `/candidates/new` ahead of the `:id` param for clarity), i.e. insert between the `/candidates` route and the `/candidates/:id` route:
```tsx
            <Route
              path="/candidates/new"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <AddCandidate />
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
```

- [ ] **Step 3: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 4: Manual browser check (controller-run; the implementer notes this as deferred)**

A subagent cannot sign in. The controller verifies: as a recruiter, `Candidates` → (Task 6 button) **Add candidate** → fill Basics (name + title required; Next is blocked until both are set) → add an experience row with month inputs → Review shows the summary (no assignee select for a recruiter) → **Create candidate** → lands on the new `/candidates/:id` profile with the entered data and derived years; the candidate appears on the roster assigned to self. As an **owner/admin**: the Review step shows an **Assign to** select (Myself + recruiters); creating with a recruiter selected assigns it to them. Draft persistence: enter a name, refresh `/candidates/new` → the field is still populated; **Save & exit** returns to the roster; the roster shows the resume-draft banner (Task 6); **Resume** reopens the wizard with the draft; **Create candidate** clears the draft (banner gone).

- [ ] **Step 5: Commit**

From the repo root:
```bash
git add frontend/src/pages/AddCandidate.tsx frontend/src/App.tsx
git commit -m "Build the add-candidate wizard page and route"
```

---

## Task 6: Roster "Add candidate" button + resume-draft banner

**Files:**
- Modify: `frontend/src/pages/Candidates.tsx`

**Interfaces:**
- Consumes: `clearDraft`/`hasDraft` (`@/lib/candidateDraft`), the existing `useNavigate` already in the file.
- Produces: an "Add candidate" button (→ `/candidates/new`) and a resume-draft banner (Resume → `/candidates/new`; Discard → `clearDraft()`).

- [ ] **Step 1: Import the draft helpers**

In `frontend/src/pages/Candidates.tsx`, add this import after the existing `import { CANDIDATE_STATUS_ORDER, statusStyle } from '@/lib/candidateStatus'` line:
```tsx
import { clearDraft, hasDraft } from '@/lib/candidateDraft'
```

- [ ] **Step 2: Track whether a draft exists**

In `Candidates.tsx`, add this state declaration immediately after the existing `const [statusUpdating, setStatusUpdating] = useState(false)` line:
```tsx
  const [draftPresent, setDraftPresent] = useState(hasDraft)
```

- [ ] **Step 3: Add the "Add candidate" button to the header**

In `Candidates.tsx`, replace the header's right-hand search block. Change:
```tsx
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-3 text-[13px] text-[#a1a1aa]">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or skill…"
              className="h-[38px] w-[230px] rounded-[9px] border border-input bg-card pr-3 pl-[30px] text-[13.5px]"
            />
          </div>
```
to:
```tsx
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3 text-[13px] text-[#a1a1aa]">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or skill…"
                className="h-[38px] w-[230px] rounded-[9px] border border-input bg-card pr-3 pl-[30px] text-[13.5px]"
              />
            </div>
            <button
              type="button"
              onClick={() => navigate('/candidates/new')}
              className="h-[38px] rounded-[9px] bg-brand px-4 text-[13px] font-medium text-white hover:opacity-90"
            >
              + Add candidate
            </button>
          </div>
```

- [ ] **Step 4: Add the resume-draft banner**

In `Candidates.tsx`, insert the banner as the first child of the outer content div. Change:
```tsx
      <div className="w-full max-w-[1140px] px-9 pt-[26px]">
        <div className="mb-5 flex items-end justify-between gap-4">
```
to:
```tsx
      <div className="w-full max-w-[1140px] px-9 pt-[26px]">
        {draftPresent && (
          <div className="mb-4 flex items-center justify-between rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-2.5 text-[13px]">
            <span className="text-[#92400e]">You have an unsaved candidate draft.</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/candidates/new')}
                className="font-medium text-[#5b46e0] hover:underline"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  clearDraft()
                  setDraftPresent(false)
                }}
                className="text-muted-foreground hover:underline"
              >
                Discard
              </button>
            </div>
          </div>
        )}
        <div className="mb-5 flex items-end justify-between gap-4">
```

- [ ] **Step 5: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 6: Commit**

From the repo root:
```bash
git add frontend/src/pages/Candidates.tsx
git commit -m "Add roster add-candidate button and resume-draft banner"
```

---

## Done-when

- Backend fast suite green (**77** = 71 + 6 POST tests) incl. the OpenAPI drift guard; `uv run black --check .` clean.
- `POST /candidates` creates the candidate + experience/education/projects/certifications in one transaction and returns the full `CandidateDetail` (201), with the assignee resolved server-side (recruiter → self always; owner/admin → chosen member or 400 if not a member, defaulting to self); blank/missing `title` → 422.
- `backend/openapi.json` and `frontend/packages/shared-types/openapi.d.ts` regenerated and committed (both CI drift checks pass); `pnpm gen:types` produces no diff at HEAD.
- `pnpm build` and `pnpm lint` pass.
- In the browser: the 6-step wizard creates a candidate end-to-end; the draft autosaves and survives a refresh; **Save & exit** + the roster resume-draft banner (Resume/Discard) work; a recruiter self-assigns and an owner/admin can pick an assignee; the created candidate appears on the roster and its profile.
- Six commits (one per task).

## Out of scope (not requested)

- **Documents** (wizard Step 5) is a static placeholder — upload/list is Chunk 8.
- **Editing** an existing candidate (Overview fields, child records) and **reassignment of an existing candidate** — Chunk 6 (Overview + reassign) and Chunk 7 (child editors). This chunk is create-only.
- **Server-persisted drafts** — drafts are localStorage only (locked spec decision #4).
- **`summary` and link fields** (linkedin/github/portfolio) are not collected by the wizard (not in the spec's step list); they become editable in a later chunk. New candidates start with them null.
- A "years" input in Step 1 — `years_experience` is derived from experience dates (locked spec decision #1).

## Self-review notes (for the planner)

- **Spec coverage:** the spec's Chunk 5 bullets are covered — backend `POST /candidates` creating candidate + children in one transaction with assignee logic (Task 1); wizard route + stepper + progress + steps 1–4 + Review with structured month date inputs (Tasks 3–5); localStorage draft autosave + "Save & exit" + roster resume-draft banner (Tasks 5–6); Documents step present but placeholder (Task 4). Deliverable "add a candidate end-to-end; draft survives refresh; appears on roster" is the Task 5 manual check.
- **RBAC consistency:** assignee resolution mirrors the slice-3/chunk-3 rule shape — recruiters are confined to themselves (their `user_id` in the body is ignored, not 403'd, matching "auto-self for recruiter"); owner/admin may assign to any org member, validated via the existing `get_member` (org-scoped) → 400 if not a member. Scope is never widened by a client param.
- **Async-safety:** `create_candidate` captures the PK before `commit()` and re-fetches via `get_candidate_detail` (eager children) — the same pattern proven in `update_candidate_status`, so no post-commit lazy-load hazard. Children carry `org_id` explicitly (TenantMixin is NOT NULL); `candidate_id` is set through the relationship on flush.
- **Layering:** `repositories.create_candidate` builds the ORM graph (consistent with `create_owned_org`/`create_invitation` building ORM from inputs) and imports the API request model **only** under `TYPE_CHECKING`, so the db layer keeps its one-directional dependency at runtime while staying typed.
- **Drift loop:** Task 1 regenerates both committed artifacts in one commit, keeping both CI drift checks green for every later commit.
- **Type consistency:** the frontend `toPayload` builds a `CandidateCreate` (generated) — its nested `experience`/`education`/`projects`/`certifications` element types come from the generated `ExperienceIn`/`EducationIn`/`ProjectIn`/`CertificationIn`, so a backend shape change surfaces as a TS error. Month-string → `YYYY-MM-01` matches the backend `date` field; empty months → `null`.
- **Effect hygiene:** the autosave effect performs a side effect (`saveDraft`) with no `setState`, and the members fetch uses the inline-async + `ignore`-flag pattern — both avoid the `react-hooks/set-state-in-effect` rule that the chunk-4 fetch tripped.
- **Lists:** repeatable rows use index keys; every input is fully controlled from `draft[...][i]`, so removal reconciles values from the new state without data corruption (no uncontrolled internal state to lose).
- **No placeholders:** every code step has complete code; the one non-automatable step (manual browser check) is explicitly controller-run.
- **TDD:** backend is test-first (6 POST tests RED before the route/repo exist). Frontend has no tests per the standing constraint — verified by build + lint + the controller's manual check.
