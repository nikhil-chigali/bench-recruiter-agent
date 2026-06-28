# Candidates Chunk 4 — Full Profile View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deep-linkable, read-only candidate profile at `/candidates/:id` — fed by a new role-scoped `GET /candidates/:id` returning the candidate plus all children — with a breadcrumb, in-page section nav, a header whose status changer reuses Chunk 3's PATCH, and read-only sections (summary/skills/links, experience, education, projects, certifications, documents placeholder).

**Architecture:** Backend adds a thin, RBAC-guarded `GET /candidates/{id}` that eager-loads the candidate's experience/education/projects/certifications and returns a nested `CandidateDetail`. The chunk-3 ownership check is extracted to a shared `_ensure_access` helper used by both GET and PATCH. Frontend builds small presentational section components (build-only verified), then the profile page composes them, fetches the detail, and reuses `CandidateStatusChanger` for an optimistic status change — replacing the Chunk-3 placeholder page.

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, Pydantic v2, `uv`, pytest. Frontend — React 19 + TypeScript (strict), Vite, Tailwind v4, React Router 7, `pnpm`, generated `@callup/shared-types`.

## Global Constraints

- Backend is **`uv` only**; frontend is **`pnpm` only** (never npm/yarn). Run backend commands from `backend/`, frontend commands from `frontend/`.
- **No frontend tests** — no `*.test.ts(x)`, no test runner. Frontend is verified by `pnpm build` (type-check + bundle) and `pnpm lint`.
- Backend: logic in `services/`, **all SQL in `db/repositories.py`**, routes are thin callers (never write SQL). Validate at boundaries with Pydantic. Fast suite (`uv run pytest -m "not integration"`) hits no network/DB and must stay green. Format with `uv run black`.
- **RBAC (security-critical, server-side only):** a recruiter may view/edit **only their own** candidates (`candidate.user_id == actor.id`); owner/admin may view/edit **any** candidate in their org. Derived from `actor.role` + ownership, never from a client param. GET and PATCH share one helper, `_ensure_access`.
- Status tokens are `on_bench`/`interviewing`/`placed` (`callup.db.enums.CandidateStatus`); the profile header reuses `@/components/CandidateStatusChanger` (Chunk 3) and `PATCH /candidates/:id` (Chunk 3).
- **The OpenAPI contract is the source of frontend types (Chunk 2.5).** Any backend route/schema change requires regenerating **both** `backend/openapi.json` (guarded by the fast-suite `test_committed_openapi_is_up_to_date`) **and** `frontend/packages/shared-types/openapi.d.ts` (guarded by the frontend CI drift step). Both are committed and LF-pinned; do not hand-edit them.
- Frontend: Tailwind classes inline reusing theme tokens (`bg-card`, `border-border`, `text-muted-foreground`, `text-destructive`, `text-foreground`); `@/*` alias; one component per file; TS strict, no `any`; `import type` for type-only imports. Backend types come from `@callup/shared-types`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/callup/api/schemas.py` | child schemas (`ExperienceOut`/`EducationOut`/`ProjectOut`/`CertificationOut`) + `CandidateDetail` | Modify |
| `backend/src/callup/db/repositories.py` | `get_candidate_detail` (all children eager-loaded) | Modify |
| `backend/src/callup/api/routes/candidates.py` | `GET /candidates/{id}`, `_ensure_access` helper, `_detail` helper; PATCH refactor | Modify |
| `backend/tests/api/test_candidates.py` | GET detail RBAC + shape tests | Modify |
| `backend/openapi.json` | regenerated contract | Modify (generated) |
| `frontend/packages/shared-types/openapi.d.ts` | regenerated types | Modify (generated) |
| `frontend/packages/shared-types/index.ts` | `CandidateDetail` alias | Modify |
| `frontend/src/lib/dates.ts` | `formatMonthYear` / `formatRange` (UTC, native Intl) | Create |
| `frontend/src/components/profile/Section.tsx` | titled card section wrapper (anchor id + heading) | Create |
| `frontend/src/components/profile/ExperienceSection.tsx` | experience list renderer | Create |
| `frontend/src/components/profile/EducationSection.tsx` | education list renderer | Create |
| `frontend/src/components/profile/ProjectsSection.tsx` | projects list renderer | Create |
| `frontend/src/components/profile/CertificationsSection.tsx` | certifications list renderer | Create |
| `frontend/src/pages/CandidateProfile.tsx` | profile page (fetch, header+status, nav, compose sections) | Modify (replace placeholder) |

`/candidates/:id` is already a route (Chunk 3) pointing at `CandidateProfile`; only the page contents change — no `App.tsx` edit.

---

## Task 1: `GET /candidates/{id}` full-detail endpoint (backend) + contract regeneration

**Files:**
- Modify: `backend/src/callup/api/schemas.py`
- Modify: `backend/src/callup/db/repositories.py`
- Modify: `backend/src/callup/api/routes/candidates.py`
- Modify: `backend/tests/api/test_candidates.py`
- Modify (generated): `backend/openapi.json`, `frontend/packages/shared-types/openapi.d.ts`

**Interfaces:**
- Produces: `repositories.get_candidate_detail(session: AsyncSession, candidate_id: uuid.UUID, org_id: uuid.UUID) -> Candidate | None` (org-scoped; eager-loads experience/education/projects/certifications).
- Produces: `GET /candidates/{candidate_id}` returning `CandidateDetail`. The frontend (Tasks 2–4) consumes `CandidateDetail` and its nested `experience`/`education`/`projects`/`certifications` arrays.
- Produces: module helper `_ensure_access(actor: User, candidate: Candidate) -> None` (shared by GET + PATCH).

- [ ] **Step 1: Write the failing GET tests**

In `backend/tests/api/test_candidates.py`, extend the models import. Change:
```python
from callup.db.models import Candidate, CandidateExperience, User
```
to:
```python
from callup.db.models import (
    Candidate,
    CandidateCertification,
    CandidateEducation,
    CandidateExperience,
    CandidateProject,
    User,
)
```

Then append (the file already defines `ORG`, `ACTOR`, `OTHER`, `CAND`, `_actor`, `_candidate`, `_Session`, `_client`, and imports `uuid`, `date`, `repositories`, `get_current_user`, `get_session`, `app`):

```python
def _detailed_candidate(owner_id: uuid.UUID) -> Candidate:
    cand = _candidate(owner_id)
    cand.email = "arjun@example.com"
    cand.phone = "555-0100"
    cand.linkedin_url = "https://linkedin.com/in/arjun"
    cand.github_url = None
    cand.portfolio_url = None
    cand.summary = "Backend engineer."
    cand.experience = [
        CandidateExperience(
            id=uuid.uuid4(),
            company="Acme",
            position="Senior Dev",
            start_date=date(2016, 1, 1),
            end_date=date(2025, 1, 1),
            description=["Built X"],
            tech_stack=["Java"],
        )
    ]
    cand.education = [
        CandidateEducation(
            id=uuid.uuid4(),
            university="MIT",
            location="Cambridge, MA",
            degree="BS CS",
            cgpa=None,
            coursework=None,
            start_date=None,
            end_date=None,
        )
    ]
    cand.projects = [
        CandidateProject(
            id=uuid.uuid4(),
            title="Callup",
            project_link=None,
            github_link=None,
            description=["Did Y"],
            tech_stack=["Go"],
        )
    ]
    cand.certifications = [
        CandidateCertification(
            id=uuid.uuid4(),
            name="AWS SAA",
            issued_by="AWS",
            badge_url=None,
            issued_on=date(2022, 6, 1),
            verification_url=None,
        )
    ]
    return cand


async def test_get_candidate_detail_shape(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"] == "Backend engineer."
        assert body["years_experience"] == 9
        assert body["recruiter_name"] == "Actor"
        assert body["linkedin_url"] == "https://linkedin.com/in/arjun"
        assert len(body["experience"]) == 1
        assert body["experience"][0]["company"] == "Acme"
        assert body["experience"][0]["tech_stack"] == ["Java"]
        assert len(body["education"]) == 1
        assert body["education"][0]["university"] == "MIT"
        assert len(body["projects"]) == 1
        assert len(body["certifications"]) == 1
        assert body["certifications"][0]["name"] == "AWS SAA"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_gets_own_detail(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 200
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_get_others_detail(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(OTHER)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_get_unknown_candidate_returns_404(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return None

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run the GET tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: `test_get_candidate_detail_shape`, `test_recruiter_gets_own_detail`, `test_recruiter_cannot_get_others_detail` FAIL (the route isn't registered → 404, so the 200/403 assertions fail). `test_get_unknown_candidate_returns_404` may pass already (an unmatched path also 404s) — that's fine; it becomes a real handler test after Step 5.

- [ ] **Step 3: Add the child + detail schemas**

In `backend/src/callup/api/schemas.py`, append (the file already imports `datetime as _dt`, `uuid`, and `BaseModel`):

```python
class ExperienceOut(BaseModel):
    id: uuid.UUID
    company: str
    position: str | None
    start_date: _dt.date | None
    end_date: _dt.date | None
    description: list[str] | None
    tech_stack: list[str] | None


class EducationOut(BaseModel):
    id: uuid.UUID
    university: str
    location: str | None
    degree: str | None
    cgpa: float | None
    coursework: str | None
    start_date: _dt.date | None
    end_date: _dt.date | None


class ProjectOut(BaseModel):
    id: uuid.UUID
    title: str
    project_link: str | None
    github_link: str | None
    description: list[str] | None
    tech_stack: list[str] | None


class CertificationOut(BaseModel):
    id: uuid.UUID
    name: str
    issued_by: str | None
    badge_url: str | None
    issued_on: _dt.date | None
    verification_url: str | None


class CandidateDetail(BaseModel):
    id: uuid.UUID
    name: str
    title: str | None
    status: str
    work_authorization: str | None
    years_experience: int
    location: str | None
    primary_skills: list[str]
    recruiter_id: uuid.UUID
    recruiter_name: str
    email: str | None
    phone: str | None
    linkedin_url: str | None
    github_url: str | None
    portfolio_url: str | None
    summary: str | None
    experience: list[ExperienceOut]
    education: list[EducationOut]
    projects: list[ProjectOut]
    certifications: list[CertificationOut]
```

- [ ] **Step 4: Add the repository query**

In `backend/src/callup/db/repositories.py`, append at the end (imports `select`, `selectinload`, `Candidate`, `AsyncSession`, `uuid` already present):

```python
async def get_candidate_detail(
    session: AsyncSession, candidate_id: uuid.UUID, org_id: uuid.UUID
) -> Candidate | None:
    """One candidate scoped to an org with all profile children eager-loaded (None if not in org)."""
    stmt = (
        select(Candidate)
        .where(Candidate.id == candidate_id, Candidate.org_id == org_id)
        .options(
            selectinload(Candidate.experience),
            selectinload(Candidate.education),
            selectinload(Candidate.projects),
            selectinload(Candidate.certifications),
        )
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
```

- [ ] **Step 5: Add the GET route + `_ensure_access` + `_detail`, and refactor PATCH**

Replace the entire contents of `backend/src/callup/api/routes/candidates.py` with:

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
from callup.db import repositories
from callup.db.enums import CandidateStatus, RecruiterRole
from callup.db.models import Candidate, User
from callup.services.candidates.roster import years_of_experience

router = APIRouter(tags=["candidates"])

_CANDIDATE_STATUSES = {s.value for s in CandidateStatus}


class CandidateStatusUpdateIn(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in _CANDIDATE_STATUSES:
            raise ValueError("status must be on_bench, interviewing, or placed")
        return v


def _ensure_access(actor: User, candidate: Candidate) -> None:
    """A recruiter may touch only their own candidates; owner/admin may touch any in the org."""
    if actor.role == RecruiterRole.RECRUITER.value and candidate.user_id != actor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")


def _card(c: Candidate, recruiter_name: str) -> CandidateCard:
    return CandidateCard(
        id=c.id,
        name=c.name,
        title=c.title,
        status=c.status,
        work_authorization=c.work_authorization,
        years_experience=years_of_experience(c.experience),
        location=c.location,
        primary_skills=c.primary_skills,
        recruiter_id=c.user_id,
        recruiter_name=recruiter_name,
    )


def _detail(c: Candidate, recruiter_name: str) -> CandidateDetail:
    return CandidateDetail(
        id=c.id,
        name=c.name,
        title=c.title,
        status=c.status,
        work_authorization=c.work_authorization,
        years_experience=years_of_experience(c.experience),
        location=c.location,
        primary_skills=c.primary_skills,
        recruiter_id=c.user_id,
        recruiter_name=recruiter_name,
        email=c.email,
        phone=c.phone,
        linkedin_url=c.linkedin_url,
        github_url=c.github_url,
        portfolio_url=c.portfolio_url,
        summary=c.summary,
        experience=[
            ExperienceOut(
                id=e.id,
                company=e.company,
                position=e.position,
                start_date=e.start_date,
                end_date=e.end_date,
                description=e.description,
                tech_stack=e.tech_stack,
            )
            for e in c.experience
        ],
        education=[
            EducationOut(
                id=ed.id,
                university=ed.university,
                location=ed.location,
                degree=ed.degree,
                cgpa=float(ed.cgpa) if ed.cgpa is not None else None,
                coursework=ed.coursework,
                start_date=ed.start_date,
                end_date=ed.end_date,
            )
            for ed in c.education
        ],
        projects=[
            ProjectOut(
                id=p.id,
                title=p.title,
                project_link=p.project_link,
                github_link=p.github_link,
                description=p.description,
                tech_stack=p.tech_stack,
            )
            for p in c.projects
        ],
        certifications=[
            CertificationOut(
                id=ct.id,
                name=ct.name,
                issued_by=ct.issued_by,
                badge_url=ct.badge_url,
                issued_on=ct.issued_on,
                verification_url=ct.verification_url,
            )
            for ct in c.certifications
        ],
    )


@router.get("/candidates", response_model=list[CandidateCard])
async def list_candidates(actor: CurrentUser, session: SessionDep) -> list[CandidateCard]:
    # A recruiter sees only their own bench; owner/admin see the whole org.
    scope_user_id = actor.id if actor.role == RecruiterRole.RECRUITER.value else None
    candidates = await repositories.list_candidates(session, actor.org_id, scope_user_id)
    members = await repositories.list_members(session, actor.org_id)
    name_by_id = {m.id: m.name for m in members}
    return [_card(c, name_by_id.get(c.user_id, "—")) for c in candidates]


@router.get("/candidates/{candidate_id}", response_model=CandidateDetail)
async def get_candidate(
    candidate_id: uuid.UUID, actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    member = await repositories.get_member(session, candidate.user_id, actor.org_id)
    return _detail(candidate, member.name if member is not None else "—")


@router.patch("/candidates/{candidate_id}", response_model=CandidateCard)
async def update_candidate(
    candidate_id: uuid.UUID,
    body: CandidateStatusUpdateIn,
    actor: CurrentUser,
    session: SessionDep,
) -> CandidateCard:
    candidate = await repositories.get_candidate(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.update_candidate_status(session, candidate, body.status)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _card(updated, member.name if member is not None else "—")
```

- [ ] **Step 6: Run the candidate tests to verify they pass**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: all candidate tests pass (3 GET-list + 5 PATCH + 4 GET-detail = 12).

- [ ] **Step 7: Regenerate the committed OpenAPI contract**

From `backend/`:
```bash
uv run python -m callup.openapi_export
```
Expected: prints `wrote .../backend/openapi.json`; the diff adds the `get` operation under `/candidates/{candidate_id}` and the `CandidateDetail`/`ExperienceOut`/`EducationOut`/`ProjectOut`/`CertificationOut` schemas.

- [ ] **Step 8: Run the fast suite (incl. the drift guard) and format**

From `backend/`:
```bash
uv run pytest -m "not integration"
uv run black .
```
Expected: all pass — `test_committed_openapi_is_up_to_date` green after regeneration. Count goes from 67 to 71 (4 new GET tests). `black` reports no changes (or reformats the edited files — re-run to confirm clean).

- [ ] **Step 9: Propagate the contract to the frontend types**

From `frontend/`:
```bash
pnpm gen:types
```
Expected: `packages/shared-types/openapi.d.ts` updates with the new path + `CandidateDetail` and child schemas.

- [ ] **Step 10: Commit**

From the repo root (explicit adds; never `git add -A`/`.`; never add `test_creds.txt`):
```bash
git add backend/src/callup/api/schemas.py backend/src/callup/db/repositories.py backend/src/callup/api/routes/candidates.py backend/tests/api/test_candidates.py backend/openapi.json frontend/packages/shared-types/openapi.d.ts
git commit -m "Add GET /candidates/:id full-detail endpoint and regenerate contract types"
```

---

## Task 2: Shared-types alias + dates util + `Section`/`ExperienceSection`/`EducationSection`

**Files:**
- Modify: `frontend/packages/shared-types/index.ts`
- Create: `frontend/src/lib/dates.ts`
- Create: `frontend/src/components/profile/Section.tsx`
- Create: `frontend/src/components/profile/ExperienceSection.tsx`
- Create: `frontend/src/components/profile/EducationSection.tsx`

**Interfaces:**
- Consumes: the generated `components['schemas']['CandidateDetail']` (Task 1).
- Produces: `@callup/shared-types` alias `CandidateDetail`; `formatMonthYear`/`formatRange` from `@/lib/dates`; `default export Section({ id, title, children })`; `default export ExperienceSection({ items })` and `EducationSection({ items })` where `items` is `CandidateDetail['experience'|'education'][number][]`. Task 4 (page) consumes all of these.

- [ ] **Step 1: Add the `CandidateDetail` alias**

In `frontend/packages/shared-types/index.ts`, append below the existing aliases (the `components` import is already at the top):
```ts
/** Backend `GET /candidates/:id` full profile (generated). */
export type CandidateDetail = components['schemas']['CandidateDetail']
```

- [ ] **Step 2: Create the dates helper**

Create `frontend/src/lib/dates.ts`:

```ts
// Format ISO date strings (from the backend) for display. UTC is used so a date-only value
// like "2016-01-01" never shifts a month under the viewer's local timezone.
export function formatMonthYear(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

export function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = formatMonthYear(start)
  const e = end ? formatMonthYear(end) : 'Present'
  if (!s && (!end || !e)) return ''
  return `${s || '—'} – ${e}`
}
```

- [ ] **Step 3: Create the `Section` wrapper**

Create `frontend/src/components/profile/Section.tsx`:

```tsx
import type { ReactNode } from 'react'

export default function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {children}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Create `ExperienceSection`**

Create `frontend/src/components/profile/ExperienceSection.tsx`:

```tsx
import type { CandidateDetail } from '@callup/shared-types'
import { formatRange } from '@/lib/dates'

type Item = CandidateDetail['experience'][number]

export default function ExperienceSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No experience added.</p>
  }
  return (
    <div className="flex flex-col gap-5">
      {items.map((e) => (
        <div key={e.id} className="border-b border-[#f4f4f5] pb-5 last:border-b-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[14px] font-semibold">
              {e.position ? `${e.position} · ` : ''}
              {e.company}
            </div>
            <div className="font-mono text-[11.5px] text-[#a1a1aa]">
              {formatRange(e.start_date, e.end_date)}
            </div>
          </div>
          {e.description && e.description.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-[#52525b]">
              {e.description.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {e.tech_stack && e.tech_stack.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {e.tech_stack.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#52525b]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create `EducationSection`**

Create `frontend/src/components/profile/EducationSection.tsx`:

```tsx
import type { CandidateDetail } from '@callup/shared-types'
import { formatRange } from '@/lib/dates'

type Item = CandidateDetail['education'][number]

export default function EducationSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No education added.</p>
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((ed) => (
        <div key={ed.id} className="border-b border-[#f4f4f5] pb-4 last:border-b-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[14px] font-semibold">{ed.university}</div>
            <div className="font-mono text-[11.5px] text-[#a1a1aa]">
              {formatRange(ed.start_date, ed.end_date)}
            </div>
          </div>
          {(ed.degree || ed.location) && (
            <div className="mt-0.5 text-[13px] text-[#52525b]">
              {[ed.degree, ed.location].filter(Boolean).join(' · ')}
            </div>
          )}
          {ed.cgpa != null && (
            <div className="mt-0.5 text-[12.5px] text-[#71717a]">CGPA: {ed.cgpa}</div>
          )}
          {ed.coursework && <div className="mt-1 text-[12.5px] text-[#71717a]">{ed.coursework}</div>}
        </div>
      ))}
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
Expected: both succeed (the new components are unconsumed until Task 4 — they just need to type-check).

- [ ] **Step 7: Commit**

From the repo root:
```bash
git add frontend/packages/shared-types/index.ts frontend/src/lib/dates.ts frontend/src/components/profile/Section.tsx frontend/src/components/profile/ExperienceSection.tsx frontend/src/components/profile/EducationSection.tsx
git commit -m "Add profile section primitives, dates util, and experience/education renderers"
```

---

## Task 3: `ProjectsSection` + `CertificationsSection`

**Files:**
- Create: `frontend/src/components/profile/ProjectsSection.tsx`
- Create: `frontend/src/components/profile/CertificationsSection.tsx`

**Interfaces:**
- Consumes: `CandidateDetail` (`@callup/shared-types`), `formatMonthYear` (`@/lib/dates`).
- Produces: `default export ProjectsSection({ items })` and `CertificationsSection({ items })` (`items` = `CandidateDetail['projects'|'certifications'][number][]`). Task 4 consumes both.

- [ ] **Step 1: Create `ProjectsSection`**

Create `frontend/src/components/profile/ProjectsSection.tsx`:

```tsx
import type { CandidateDetail } from '@callup/shared-types'

type Item = CandidateDetail['projects'][number]

export default function ProjectsSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No projects added.</p>
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((p) => (
        <div key={p.id} className="border-b border-[#f4f4f5] pb-4 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{p.title}</span>
            {p.project_link && (
              <a
                href={p.project_link}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[#5b46e0] hover:underline"
              >
                link
              </a>
            )}
            {p.github_link && (
              <a
                href={p.github_link}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[#5b46e0] hover:underline"
              >
                github
              </a>
            )}
          </div>
          {p.description && p.description.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-[#52525b]">
              {p.description.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {p.tech_stack && p.tech_stack.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.tech_stack.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#52525b]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create `CertificationsSection`**

Create `frontend/src/components/profile/CertificationsSection.tsx`:

```tsx
import type { CandidateDetail } from '@callup/shared-types'
import { formatMonthYear } from '@/lib/dates'

type Item = CandidateDetail['certifications'][number]

export default function CertificationsSection({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No certifications added.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((ct) => (
        <div
          key={ct.id}
          className="flex items-baseline justify-between gap-3 border-b border-[#f4f4f5] pb-3 last:border-b-0 last:pb-0"
        >
          <div>
            <div className="text-[14px] font-semibold">{ct.name}</div>
            {ct.issued_by && <div className="text-[12.5px] text-[#71717a]">{ct.issued_by}</div>}
          </div>
          <div className="flex flex-none items-center gap-2">
            {ct.issued_on && (
              <span className="font-mono text-[11.5px] text-[#a1a1aa]">
                {formatMonthYear(ct.issued_on)}
              </span>
            )}
            {ct.verification_url && (
              <a
                href={ct.verification_url}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[#5b46e0] hover:underline"
              >
                verify
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 4: Commit**

From the repo root:
```bash
git add frontend/src/components/profile/ProjectsSection.tsx frontend/src/components/profile/CertificationsSection.tsx
git commit -m "Add projects and certifications profile renderers"
```

---

## Task 4: Profile page — fetch, header + status, breadcrumb, section nav, compose sections

**Files:**
- Modify: `frontend/src/pages/CandidateProfile.tsx` (replace the Chunk-3 placeholder)

**Interfaces:**
- Consumes: `api.get<CandidateDetail>` + `api.patch<CandidateCard>` (`@/lib/api`), `ApiError` (`@/lib/http`), `useParams`/`useNavigate`/`Link` (react-router-dom), `initialsOf` (`@/lib/utils`), `AppLayout`, `CandidateStatusChanger` (Chunk 3), `Section`/`ExperienceSection`/`EducationSection` (Task 2), `ProjectsSection`/`CertificationsSection` (Task 3), types `CandidateDetail`/`CandidateCard` (`@callup/shared-types`).

- [ ] **Step 1: Replace the placeholder page with the full profile**

Replace the entire contents of `frontend/src/pages/CandidateProfile.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { initialsOf } from '@/lib/utils'
import type { CandidateCard, CandidateDetail } from '@callup/shared-types'
import AppLayout from '@/components/AppLayout'
import CandidateStatusChanger from '@/components/CandidateStatusChanger'
import Section from '@/components/profile/Section'
import ExperienceSection from '@/components/profile/ExperienceSection'
import EducationSection from '@/components/profile/EducationSection'
import ProjectsSection from '@/components/profile/ProjectsSection'
import CertificationsSection from '@/components/profile/CertificationsSection'

const NAV = [
  { id: 'summary', label: 'Summary' },
  { id: 'experience', label: 'Experience' },
  { id: 'education', label: 'Education' },
  { id: 'projects', label: 'Projects' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'documents', label: 'Documents' },
]

function ProfileLinks({ detail }: { detail: CandidateDetail }) {
  const links: Array<{ label: string; href: string }> = []
  if (detail.linkedin_url) links.push({ label: 'LinkedIn', href: detail.linkedin_url })
  if (detail.github_url) links.push({ label: 'GitHub', href: detail.github_url })
  if (detail.portfolio_url) links.push({ label: 'Portfolio', href: detail.portfolio_url })
  if (detail.email) links.push({ label: detail.email, href: `mailto:${detail.email}` })
  if (links.length === 0 && !detail.phone) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="text-[#5b46e0] hover:underline"
        >
          {l.label}
        </a>
      ))}
      {detail.phone && <span className="text-[#71717a]">{detail.phone}</span>}
    </div>
  )
}

export default function CandidateProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<CandidateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    api
      .get<CandidateDetail>(`/candidates/${id}`)
      .then((d) => {
        setDetail(d)
        setError(null)
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setError('Candidate not found.')
        else setError(e instanceof Error ? e.message : 'Failed to load candidate')
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => load(), [load])

  async function changeStatus(next: string) {
    if (!detail || next === detail.status || statusUpdating) return
    const prev = detail.status
    setStatusError(null)
    setStatusUpdating(true)
    setDetail((d) => (d ? { ...d, status: next } : d))
    try {
      const updated = await api.patch<CandidateCard>(`/candidates/${detail.id}`, { status: next })
      setDetail((d) => (d ? { ...d, status: updated.status } : d))
    } catch (e) {
      setDetail((d) => (d ? { ...d, status: prev } : d))
      setStatusError(e instanceof Error ? e.message : 'Could not update status')
    } finally {
      setStatusUpdating(false)
    }
  }

  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1140px] px-9 pt-[22px] pb-12">
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link to="/candidates" className="hover:text-foreground">
            Candidates
          </Link>
          <span className="text-[#d4d4d8]">/</span>
          <span className="text-foreground">{detail?.name ?? '…'}</span>
        </div>

        {loading && <p className="mt-6 text-[13px] text-muted-foreground">Loading…</p>}
        {error && !loading && (
          <div className="mt-6">
            <p className="text-[13px] text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/candidates')}
              className="mt-2 text-[13px] text-[#5b46e0] hover:underline"
            >
              ← Back to candidates
            </button>
          </div>
        )}

        {detail && !loading && !error && (
          <>
            <div className="mt-5 flex items-start gap-4">
              <div className="flex size-14 flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-[17px] font-semibold text-[#52525b]">
                {initialsOf(detail.name)}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{detail.name}</h1>
                <div className="text-[14px] text-muted-foreground">{detail.title ?? '—'}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[#71717a]">
                  <span className="font-mono text-[#52525b]">{detail.work_authorization ?? '—'}</span>
                  <span className="text-[#d4d4d8]">·</span>
                  <span>{detail.years_experience}y</span>
                  <span className="text-[#d4d4d8]">·</span>
                  <span>{detail.location ?? '—'}</span>
                  <span className="text-[#d4d4d8]">·</span>
                  <span>{detail.recruiter_name}</span>
                </div>
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                <CandidateStatusChanger
                  status={detail.status}
                  onChange={changeStatus}
                  disabled={statusUpdating}
                />
                {statusError && <span className="text-[11.5px] text-destructive">{statusError}</span>}
              </div>
            </div>

            <nav className="mt-6 flex flex-wrap gap-1 border-b border-border pb-3">
              {NAV.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className="rounded-[7px] px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-[#f0f0f1] hover:text-foreground"
                >
                  {n.label}
                </a>
              ))}
            </nav>

            <div className="mt-6 flex flex-col gap-7">
              <Section id="summary" title="Summary">
                {detail.summary ? (
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-[#3f3f46]">
                    {detail.summary}
                  </p>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No summary added.</p>
                )}
                {detail.primary_skills.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1">
                    {detail.primary_skills.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#52525b]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <ProfileLinks detail={detail} />
              </Section>

              <Section id="experience" title="Experience">
                <ExperienceSection items={detail.experience} />
              </Section>
              <Section id="education" title="Education">
                <EducationSection items={detail.education} />
              </Section>
              <Section id="projects" title="Projects">
                <ProjectsSection items={detail.projects} />
              </Section>
              <Section id="certifications" title="Certifications">
                <CertificationsSection items={detail.certifications} />
              </Section>
              <Section id="documents" title="Documents">
                <p className="text-[13px] text-muted-foreground">
                  Document uploads arrive in a later update.
                </p>
              </Section>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
```

- [ ] **Step 2: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 3: Manual browser check (controller-run; the implementer notes this as deferred)**

A subagent cannot sign in. The controller verifies: sign in → roster → open a candidate's quick-view drawer → "Open full profile" → `/candidates/:id` renders the full read-only profile (header, status changer, breadcrumb, section nav, summary/skills/links, experience/education/projects/certifications, documents placeholder); changing status from the profile header persists (and survives refresh); the section-nav anchors jump to each section; a recruiter opening their own candidate works, and a deep link to a candidate they don't own shows "Candidate not found." (403/404 → error state); a bad id shows the not-found state. (If the dev DB lacks a candidate with children, insert rows to exercise the sections.)

- [ ] **Step 4: Commit**

From the repo root:
```bash
git add frontend/src/pages/CandidateProfile.tsx
git commit -m "Build the read-only candidate profile page"
```

---

## Done-when

- Backend fast suite green (71 = 67 + 4 GET tests) incl. the OpenAPI drift guard; `uv run black --check .` clean.
- `GET /candidates/:id` returns the candidate + experience/education/projects/certifications, RBAC-scoped (recruiter → own only → 403 otherwise; cross-org/missing → 404), with derived `years_experience` and `recruiter_name`. PATCH and GET share `_ensure_access`.
- `backend/openapi.json` and `frontend/packages/shared-types/openapi.d.ts` regenerated and committed (both CI drift checks pass); `pnpm gen:types` produces no diff at HEAD.
- `pnpm build` and `pnpm lint` pass.
- In the browser: the profile renders all sections read-only, is deep-linkable, the breadcrumb + section nav work, and the header status change persists.
- Four commits (Task 1, Task 2, Task 3, Task 4).

## Out of scope (not requested)

- **Documents** are a static placeholder section — upload/list is Slice 5 (Candidate documents, Chunk 8). The GET response intentionally omits the documents collection until then.
- **`other_urls`** is omitted from `CandidateDetail` — its element shape isn't defined until the Chunk 5 add-wizard writes it; add it to the schema and the links section when that shape lands.
- **Editing** any profile field (name/title/skills/experience/etc.) or reassignment — Chunk 6's extended PATCH. This chunk is read-only except the existing status change.
- A scroll-spy that highlights the active section in the nav — plain anchor links are enough for now.

## Self-review notes (for the planner)

- **Spec coverage:** the spec's Chunk 4 bullets are covered — `GET /candidates/:id` returning the candidate + all children, scoped (Task 1); profile route (the Chunk-3 `/candidates/:id` route now renders the real page), breadcrumb top bar, section nav, header with the reused status changer, and read-only cards for summary/skills/links, experience, education, projects/certs, and a documents placeholder (Tasks 2–4).
- **Stale-drawer follow-up:** `docs/todos.md` carried a note that the roster drawer could show stale data; this chunk doesn't reopen that file, but the full profile (a fresh fetch by id) is the canonical view the note pointed at — leave the todo until the drawer itself is reconciled.
- **Drift loop:** Task 1 regenerates both committed artifacts in one commit, keeping both CI drift checks green for every later commit.
- **RBAC consistency:** GET reuses the exact ownership rule from PATCH via the shared `_ensure_access` helper (404 for cross-org/missing via the org-scoped fetch, then 403 for in-org non-owner recruiters), covered by `test_recruiter_cannot_get_others_detail` (403) and `test_get_unknown_candidate_returns_404` (404).
- **Async-safety:** the GET path only reads from the eagerly-loaded candidate (no commit, no post-commit access), so there's no lazy-load hazard. `cgpa` (Numeric/Decimal) is converted to `float` at the boundary to keep JSON serialization predictable.
- **Type consistency:** `CandidateDetail` field names match the backend Pydantic schema; section components derive their item types from `CandidateDetail['<child>'][number]` so any backend shape change surfaces as a frontend type error. The header status change reuses the Chunk-3 `CandidateStatusChanger` prop contract (`status`/`onChange`/`disabled`) and the PATCH response type (`CandidateCard`).
- **No placeholders:** every code step has complete code; the one non-automatable step (manual browser check) is explicitly controller-run.
- **TDD:** backend is test-first (4 GET tests RED before the route exists). Frontend has no tests per the standing constraint — verified by build + lint + the controller's manual check.
