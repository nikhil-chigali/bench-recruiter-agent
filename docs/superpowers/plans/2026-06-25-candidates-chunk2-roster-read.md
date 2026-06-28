# Candidates Chunk 2 — Roster Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the Candidates roster end-to-end — a role-scoped `GET /candidates` endpoint feeding a filterable list/grid roster with status filters, search, recruiter grouping, and counts.

**Architecture:** The backend adds a `GET /candidates` endpoint that returns the role-scoped candidate cards (a recruiter sees only their own; owner/admin see the whole org bench), with `years_experience` derived on read from `candidate_experience` date ranges. All presentation-level filtering — status, search, recruiter filter, counts, list/grid grouping — happens client-side in the React roster page (the bench is small; this matches the mockup's instant interactions). Security-critical scoping is enforced server-side only.

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, Pydantic v2, `uv`, pytest. Frontend — React 19 + TypeScript (strict), Vite, Tailwind v4, React Router 7, `pnpm`.

## Global Constraints

- Backend is **`uv` only**; frontend is **`pnpm` only`** (never npm/yarn).
- **No frontend tests** — no `*.test.ts(x)`, no test runner. Frontend is verified by `pnpm build` (type-check + bundle) and `pnpm lint`.
- Backend: logic in `services/`, **all SQL in `db/repositories.py`**, routes are thin callers (never write SQL). Validate at boundaries with Pydantic. Fast suite (`uv run pytest -m "not integration"`) hits no network/DB and must stay green. Format with `uv run black`.
- **RBAC mirrors slice-3 roles:** owner/admin see the whole org bench; a recruiter sees only candidates with `user_id == self`. This scoping is enforced **server-side** in the endpoint.
- Status tokens are `on_bench` / `interviewing` / `placed` (`callup.db.enums.CandidateStatus`). Display labels + colors come from the existing `@/lib/candidateStatus` util (Chunk 1).
- `years_experience` is **derived, never stored** — computed from `candidate_experience` start/end dates (null end = present).
- Tailwind classes inline reusing existing theme tokens (`bg-background`, `border-border`, `bg-card`, `text-muted-foreground`, `bg-brand`); preserve the roster content max-width of **1140px**. Don't hand-roll shadcn primitives. Use the `@/*` alias. TypeScript strict, no `any`.

## Deviations from the spec (flagged)

1. **Filtering is client-side.** The spec described `GET /candidates` with `status` / `recruiter_id` / `search` query params + server-side grouping metadata. This plan keeps the endpoint to **role/org scoping only** and does status/search/recruiter filtering, counts, and grouping in the browser. Rationale: matches the mockup (all-client filtering, instant tab switches), far less backend surface, and benches are small (tens per org). If benches grow, the filters move server-side later with no UI contract change.
2. **Local TS types, not `packages/shared-types`.** That package doesn't exist in the repo; the established practice is local types (e.g. `MembersSection` inlines `type Member`). This plan adds `frontend/src/lib/candidates.ts`. When/if an OpenAPI type-gen pipeline lands, these move there.
3. **Cards are display-only in this chunk.** Clicking a card to open the quick-view drawer is Chunk 3; the card exposes no click handler yet.

Empty recruiter groups **are** shown (per the design): the grouped owner/admin view renders a group for every recruiter-role member even with zero candidates, plus any other member who actually owns candidates (so nothing is orphaned). This needs the member list, so the page also calls `GET /members`.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/callup/services/candidates/roster.py` | `years_of_experience` derivation helper (pure) | Create |
| `backend/tests/services/candidates/__init__.py` | test package marker | Create |
| `backend/tests/services/candidates/test_roster.py` | helper unit tests | Create |
| `backend/src/callup/db/repositories.py` | `list_candidates` query | Modify |
| `backend/src/callup/api/schemas.py` | `CandidateCard` response schema | Modify |
| `backend/src/callup/api/routes/candidates.py` | `GET /candidates` route | Create |
| `backend/src/callup/main.py` | register the candidates router | Modify |
| `backend/tests/api/test_candidates.py` | route RBAC + shape tests | Create |
| `frontend/src/lib/candidates.ts` | `CandidateCard` TS type | Create |
| `frontend/src/components/CandidateStatusPill.tsx` | read-only status pill | Create |
| `frontend/src/components/CandidateCard.tsx` | list-row + grid-card renderer | Create |
| `frontend/src/pages/Candidates.tsx` | roster page (fetch, filter, group) | Modify (replace placeholder) |

Run backend commands from `backend/`, frontend commands from `frontend/`.

---

## Task 1: `years_of_experience` helper + `list_candidates` repository

**Files:**
- Create: `backend/src/callup/services/candidates/roster.py`
- Create: `backend/tests/services/candidates/__init__.py`
- Create: `backend/tests/services/candidates/test_roster.py`
- Modify: `backend/src/callup/db/repositories.py`

**Interfaces:**
- Produces: `years_of_experience(experiences: list[CandidateExperience], *, today: date | None = None) -> int` (pure; total career span in whole years from earliest start to latest end/today; 0 if no dated experience).
- Produces: `async def list_candidates(session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID | None = None) -> list[Candidate]` — candidates in the org (optionally filtered to one assignee), newest first, with `.experience` eager-loaded.

- [ ] **Step 1: Write the failing helper tests**

Create `backend/tests/services/candidates/__init__.py` as an empty file.

Create `backend/tests/services/candidates/test_roster.py`:

```python
from datetime import date

from callup.db.models import CandidateExperience
from callup.services.candidates.roster import years_of_experience


def _exp(start: date | None, end: date | None) -> CandidateExperience:
    return CandidateExperience(start_date=start, end_date=end)


def test_years_zero_when_no_experience():
    assert years_of_experience([]) == 0


def test_years_zero_when_no_start_dates():
    assert years_of_experience([_exp(None, None)]) == 0


def test_years_span_single_role():
    assert years_of_experience([_exp(date(2016, 1, 1), date(2025, 1, 1))]) == 9


def test_years_uses_today_for_present_role():
    assert years_of_experience([_exp(date(2020, 1, 1), None)], today=date(2025, 1, 1)) == 5


def test_years_span_across_multiple_roles():
    exps = [_exp(date(2016, 1, 1), date(2020, 1, 1)), _exp(date(2020, 1, 1), date(2025, 1, 1))]
    assert years_of_experience(exps) == 9
```

- [ ] **Step 2: Run the helper tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/services/candidates/test_roster.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'callup.services.candidates.roster'`.

- [ ] **Step 3: Implement the helper**

Create `backend/src/callup/services/candidates/roster.py`:

```python
"""Read-side derivations for the candidate roster.

Years of experience is derived here (not stored) from the candidate's experience
date ranges, so the roster and profile always reflect the actual roles on file.
"""

from datetime import date

from callup.db.models import CandidateExperience


def years_of_experience(
    experiences: list[CandidateExperience], *, today: date | None = None
) -> int:
    """Total career span in whole years: earliest start to latest end (null end = today).

    Returns 0 when there are no experience entries with a start date.
    """
    today = today or date.today()
    starts = [e.start_date for e in experiences if e.start_date is not None]
    if not starts:
        return 0
    earliest = min(starts)
    latest = max(e.end_date or today for e in experiences if e.start_date is not None)
    return max(0, (latest - earliest).days // 365)
```

- [ ] **Step 4: Run the helper tests to verify they pass**

From `backend/`:
```bash
uv run pytest tests/services/candidates/test_roster.py -v
```
Expected: PASS (5 passed).

- [ ] **Step 5: Add the repository query**

In `backend/src/callup/db/repositories.py`:

First, extend the SQLAlchemy import line near the top of the file. Change:
```python
from sqlalchemy import delete, or_, select, update
```
to:
```python
from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import selectinload
```

Extend the models import. Change:
```python
from callup.db.models import Invitation, Org, User
```
to:
```python
from callup.db.models import Candidate, Invitation, Org, User
```

Then append this function to the end of the file:
```python
async def list_candidates(
    session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> list[Candidate]:
    """Candidates in an org, newest first, with experience eager-loaded.

    When ``user_id`` is given, restrict to that assignee (recruiter-scoped view).
    """
    stmt = (
        select(Candidate)
        .where(Candidate.org_id == org_id)
        .options(selectinload(Candidate.experience))
        .order_by(Candidate.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(Candidate.user_id == user_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())
```

- [ ] **Step 6: Run the fast suite**

From `backend/`:
```bash
uv run pytest -m "not integration"
```
Expected: all pass (baseline 52 + 5 new helper tests = 57).

- [ ] **Step 7: Format and commit**

From `backend/`:
```bash
uv run black .
```
Then from the repo root:
```bash
git add backend/src/callup/services/candidates/roster.py backend/tests/services/candidates/ backend/src/callup/db/repositories.py
git commit -m "Add years-of-experience derivation and list_candidates query"
```

---

## Task 2: `GET /candidates` endpoint

**Files:**
- Modify: `backend/src/callup/api/schemas.py`
- Create: `backend/src/callup/api/routes/candidates.py`
- Modify: `backend/src/callup/main.py`
- Test: `backend/tests/api/test_candidates.py`

**Interfaces:**
- Consumes: `repositories.list_candidates`, `repositories.list_members`, `years_of_experience` (Task 1).
- Produces: `GET /candidates -> list[CandidateCard]`. `CandidateCard` fields: `id: UUID, name: str, title: str | None, status: str, work_authorization: str | None, years_experience: int, location: str | None, primary_skills: list[str], recruiter_id: UUID, recruiter_name: str`. The frontend (Tasks 3–4) consumes this shape.

- [ ] **Step 1: Write the failing route tests**

Create `backend/tests/api/test_candidates.py`:

```python
import uuid
from datetime import date

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_user
from callup.db import repositories
from callup.db.models import Candidate, CandidateExperience, User
from callup.db.session import get_session
from callup.main import app

ORG = uuid.uuid4()
ACTOR = uuid.uuid4()


def _actor(role: str) -> User:
    return User(id=ACTOR, org_id=ORG, role=role, name="Actor", email="a@example.com")


class _Session:
    async def get(self, model, pk):
        return None


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_recruiter_scoped_to_self(monkeypatch):
    captured = {}

    async def fake_list_candidates(session, org_id, user_id=None):
        captured["user_id"] = user_id
        return []

    async def fake_list_members(session, org_id):
        return []

    monkeypatch.setattr(repositories, "list_candidates", fake_list_candidates)
    monkeypatch.setattr(repositories, "list_members", fake_list_members)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get("/candidates")
        assert resp.status_code == 200
        assert captured["user_id"] == ACTOR
    finally:
        app.dependency_overrides.clear()


async def test_owner_sees_whole_org(monkeypatch):
    captured = {}

    async def fake_list_candidates(session, org_id, user_id=None):
        captured["user_id"] = user_id
        return []

    async def fake_list_members(session, org_id):
        return []

    monkeypatch.setattr(repositories, "list_candidates", fake_list_candidates)
    monkeypatch.setattr(repositories, "list_members", fake_list_members)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get("/candidates")
        assert resp.status_code == 200
        assert captured["user_id"] is None
    finally:
        app.dependency_overrides.clear()


async def test_card_shape_and_derived_years(monkeypatch):
    cand = Candidate(
        id=uuid.uuid4(),
        org_id=ORG,
        user_id=ACTOR,
        name="Arjun Mehta",
        title="Sr. Java Developer",
        status="on_bench",
        work_authorization="H1B",
        location="Dallas, TX",
        primary_skills=["Java", "Spring Boot"],
    )
    cand.experience = [CandidateExperience(start_date=date(2016, 1, 1), end_date=date(2025, 1, 1))]

    async def fake_list_candidates(session, org_id, user_id=None):
        return [cand]

    async def fake_list_members(session, org_id):
        return [_actor("recruiter")]

    monkeypatch.setattr(repositories, "list_candidates", fake_list_candidates)
    monkeypatch.setattr(repositories, "list_members", fake_list_members)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get("/candidates")
        assert resp.status_code == 200
        card = resp.json()[0]
        assert card["name"] == "Arjun Mehta"
        assert card["title"] == "Sr. Java Developer"
        assert card["status"] == "on_bench"
        assert card["years_experience"] == 9
        assert card["primary_skills"] == ["Java", "Spring Boot"]
        assert card["recruiter_id"] == str(ACTOR)
        assert card["recruiter_name"] == "Actor"
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run the route tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: FAIL — all three return 404 (route not registered yet), so the `status_code == 200` assertions fail.

- [ ] **Step 3: Add the `CandidateCard` schema**

In `backend/src/callup/api/schemas.py`, append:

```python
class CandidateCard(BaseModel):
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
```

(`uuid` and `BaseModel` are already imported in this file.)

- [ ] **Step 4: Create the route**

Create `backend/src/callup/api/routes/candidates.py`:

```python
from fastapi import APIRouter

from callup.api.deps import CurrentUser, SessionDep
from callup.api.schemas import CandidateCard
from callup.db import repositories
from callup.db.enums import RecruiterRole
from callup.services.candidates.roster import years_of_experience

router = APIRouter(tags=["candidates"])


@router.get("/candidates", response_model=list[CandidateCard])
async def list_candidates(actor: CurrentUser, session: SessionDep) -> list[CandidateCard]:
    # A recruiter sees only their own bench; owner/admin see the whole org.
    scope_user_id = actor.id if actor.role == RecruiterRole.RECRUITER.value else None
    candidates = await repositories.list_candidates(session, actor.org_id, scope_user_id)
    members = await repositories.list_members(session, actor.org_id)
    name_by_id = {m.id: m.name for m in members}
    return [
        CandidateCard(
            id=c.id,
            name=c.name,
            title=c.title,
            status=c.status,
            work_authorization=c.work_authorization,
            years_experience=years_of_experience(c.experience),
            location=c.location,
            primary_skills=c.primary_skills,
            recruiter_id=c.user_id,
            recruiter_name=name_by_id.get(c.user_id, "—"),
        )
        for c in candidates
    ]
```

- [ ] **Step 5: Register the router**

In `backend/src/callup/main.py`, change the routes import:
```python
from callup.api.routes import health, invitations, me, members, orgs
```
to:
```python
from callup.api.routes import candidates, health, invitations, me, members, orgs
```
And add this line in `create_app()` alongside the other `include_router` calls:
```python
    app.include_router(candidates.router)
```

- [ ] **Step 6: Run the route tests to verify they pass**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: PASS (3 passed).

- [ ] **Step 7: Run the fast suite**

From `backend/`:
```bash
uv run pytest -m "not integration"
```
Expected: all pass (60 = 52 baseline + 5 helper + 3 route).

- [ ] **Step 8: Format and commit**

From `backend/`:
```bash
uv run black .
```
Then from the repo root:
```bash
git add backend/src/callup/api/schemas.py backend/src/callup/api/routes/candidates.py backend/src/callup/main.py backend/tests/api/test_candidates.py
git commit -m "Add GET /candidates roster endpoint"
```

---

## Task 3: Candidate types + status pill + card components (frontend)

**Files:**
- Create: `frontend/src/lib/candidates.ts`
- Create: `frontend/src/components/CandidateStatusPill.tsx`
- Create: `frontend/src/components/CandidateCard.tsx`

**Interfaces:**
- Produces: `type CandidateCard` (matches the Task 2 response).
- Produces: `default export CandidateStatusPill({ status }: { status: string })`.
- Produces: `default export CandidateCard({ candidate, view }: { candidate: CandidateCard; view: 'list' | 'grid' })`. Tasks 4 (page) consumes both components.

- [ ] **Step 1: Create the TS type**

Create `frontend/src/lib/candidates.ts`:

```ts
// Mirrors the backend CandidateCard response (GET /candidates). Local type — the repo has
// no generated shared-types package yet; move here when one lands.
export type CandidateCard = {
  id: string
  name: string
  title: string | null
  status: string
  work_authorization: string | null
  years_experience: number
  location: string | null
  primary_skills: string[]
  recruiter_id: string
  recruiter_name: string
}
```

- [ ] **Step 2: Create the status pill**

Create `frontend/src/components/CandidateStatusPill.tsx`:

```tsx
import { statusStyle } from '@/lib/candidateStatus'

export default function CandidateStatusPill({ status }: { status: string }) {
  const s = statusStyle(status)
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium"
      style={{ background: s.bg, borderColor: s.border, color: s.fg }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  )
}
```

- [ ] **Step 3: Create the card component**

Create `frontend/src/components/CandidateCard.tsx`:

```tsx
import { initialsOf } from '@/lib/utils'
import type { CandidateCard as Candidate } from '@/lib/candidates'
import CandidateStatusPill from '@/components/CandidateStatusPill'

function SkillChips({ skills, max }: { skills: string[]; max: number }) {
  const shown = skills.slice(0, max)
  const extra = skills.length - shown.length
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <span
          key={s}
          className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#52525b]"
        >
          {s}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[10px] text-[#a1a1aa]">
          +{extra}
        </span>
      )}
    </div>
  )
}

export default function CandidateCard({
  candidate,
  view,
}: {
  candidate: Candidate
  view: 'list' | 'grid'
}) {
  const yrs = `${candidate.years_experience}y`
  const auth = candidate.work_authorization ?? '—'
  const location = candidate.location ?? '—'

  if (view === 'list') {
    return (
      <div className="flex items-center border-b border-[#f4f4f5] px-[18px] py-[13px] last:border-b-0">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-[38px] flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-xs font-semibold text-[#52525b]">
            {initialsOf(candidate.name)}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold">
              {candidate.name}{' '}
              {candidate.title && <span className="font-normal text-[#a1a1aa]">· {candidate.title}</span>}
            </div>
            <div className="mt-[5px]">
              <SkillChips skills={candidate.primary_skills} max={4} />
            </div>
          </div>
        </div>
        <div className="w-[74px] font-mono text-[11.5px] text-[#52525b]">{auth}</div>
        <div className="w-[52px] text-[12.5px] text-[#52525b]">{yrs}</div>
        <div className="w-[150px] truncate text-[12px] text-[#52525b]">{location}</div>
        <div className="w-[120px]">
          <CandidateStatusPill status={candidate.status} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-start justify-between gap-[9px]">
        <div className="flex min-w-0 items-center gap-[11px]">
          <div className="flex size-10 flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-[13px] font-semibold text-[#52525b]">
            {initialsOf(candidate.name)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{candidate.name}</div>
            <div className="truncate text-xs text-[#a1a1aa]">{candidate.title ?? '—'}</div>
          </div>
        </div>
        <CandidateStatusPill status={candidate.status} />
      </div>
      <SkillChips skills={candidate.primary_skills} max={3} />
      <div className="flex items-center gap-[9px] border-t border-[#f4f4f5] pt-[10px] text-[11.5px] text-[#71717a]">
        <span className="font-mono text-[#52525b]">{auth}</span>
        <span className="text-[#d4d4d8]">·</span>
        <span>{yrs}</span>
        <span className="text-[#d4d4d8]">·</span>
        <span className="min-w-0 truncate">{location}</span>
      </div>
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
git add frontend/src/lib/candidates.ts frontend/src/components/CandidateStatusPill.tsx frontend/src/components/CandidateCard.tsx
git commit -m "Add candidate card + status pill components"
```

---

## Task 4: Roster page (fetch, filter, group)

**Files:**
- Modify: `frontend/src/pages/Candidates.tsx` (replace the Chunk-1 placeholder)

**Interfaces:**
- Consumes: `api.get<CandidateCard[]>('/candidates')` and (managers only) `api.get<Member[]>('/members')`, `useProfile()` (`user.role`), `CandidateCard` type, `CandidateCard`/`CandidateStatusPill` components, `CANDIDATE_STATUS_ORDER` + `statusStyle` from `@/lib/candidateStatus`, `AppLayout`, `initialsOf`, `ROLE_LABEL`, `ROLE_BADGE`. `Member` (`{ id; name; email; role }`) is declared inline in the page (same pattern as `MembersSection`).

- [ ] **Step 1: Replace the placeholder page with the roster**

Replace the entire contents of `frontend/src/pages/Candidates.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useProfile } from '@/lib/profile'
import { initialsOf, ROLE_BADGE, ROLE_LABEL } from '@/lib/utils'
import { CANDIDATE_STATUS_ORDER, statusStyle } from '@/lib/candidateStatus'
import type { CandidateCard as Candidate } from '@/lib/candidates'
import AppLayout from '@/components/AppLayout'
import CandidateCard from '@/components/CandidateCard'

type Member = { id: string; name: string; email: string; role: string }
type Group = { id: string | null; name: string; role: string; candidates: Candidate[] }
type View = 'list' | 'grid'
const VIEW_KEY = 'callup_candidates_view'

function loadView(): View {
  return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
}

export default function Candidates() {
  const { user } = useProfile()
  const isManager = user?.role === 'owner' || user?.role === 'admin'

  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [recruiter, setRecruiter] = useState<string>('all')
  const [view, setView] = useState<View>(loadView)

  const load = useCallback(() => {
    setLoading(true)
    // Managers also load members so every recruiter shows as a group, even with an empty bench.
    const membersReq = isManager ? api.get<Member[]>('/members') : Promise.resolve<Member[]>([])
    Promise.all([api.get<Candidate[]>('/candidates'), membersReq])
      .then(([cs, ms]) => {
        setCandidates(cs)
        setMembers(ms)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load candidates'))
      .finally(() => setLoading(false))
  }, [isManager])

  useEffect(() => load(), [load])

  function chooseView(v: View) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  // Recruiter dropdown lists the recruiter-role members (assignees), so one with an empty
  // bench is still selectable.
  const recruiterOptions = useMemo(
    () => members.filter((m) => m.role === 'recruiter').map((m) => ({ id: m.id, name: m.name })),
    [members],
  )

  // Pipeline: recruiter filter (managers) -> search -> counts -> status filter -> group.
  const afterRecruiter = useMemo(
    () =>
      isManager && recruiter !== 'all'
        ? candidates.filter((c) => c.recruiter_id === recruiter)
        : candidates,
    [candidates, isManager, recruiter],
  )

  const afterSearch = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return afterRecruiter
    return afterRecruiter.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.title ?? '').toLowerCase().includes(q) ||
        c.primary_skills.some((s) => s.toLowerCase().includes(q)),
    )
  }, [afterRecruiter, search])

  const counts = useMemo(() => {
    const by: Record<string, number> = { on_bench: 0, interviewing: 0, placed: 0 }
    for (const c of afterSearch) by[c.status] = (by[c.status] ?? 0) + 1
    return { all: afterSearch.length, ...by }
  }, [afterSearch])

  const visible = useMemo(
    () => (status === 'all' ? afterSearch : afterSearch.filter((c) => c.status === status)),
    [afterSearch, status],
  )

  const grouped = isManager && recruiter === 'all'
  const filtered = search.trim() !== '' || status !== 'all'

  // Grouped view: a group for every recruiter-role member (empty included), plus any other
  // member who actually owns a visible candidate — so nothing is ever orphaned.
  const groups = useMemo<Group[]>(() => {
    if (!grouped) return [{ id: null, name: '', role: '', candidates: visible }]
    const memberById = new Map(members.map((m) => [m.id, m]))
    const byId = new Map<string, Group>()
    for (const m of members) {
      if (m.role === 'recruiter') byId.set(m.id, { id: m.id, name: m.name, role: m.role, candidates: [] })
    }
    for (const c of visible) {
      let g = byId.get(c.recruiter_id)
      if (!g) {
        const m = memberById.get(c.recruiter_id)
        g = { id: c.recruiter_id, name: m?.name ?? c.recruiter_name, role: m?.role ?? 'recruiter', candidates: [] }
        byId.set(c.recruiter_id, g)
      }
      g.candidates.push(c)
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [grouped, members, visible])

  if (!user) return null

  const statusTabs: Array<{ key: string; label: string; dot?: string; count: number }> = [
    { key: 'all', label: 'All', count: counts.all },
    ...CANDIDATE_STATUS_ORDER.map((token) => ({
      key: token,
      label: statusStyle(token).label,
      dot: statusStyle(token).dot,
      count: counts[token] ?? 0,
    })),
  ]

  // Big empty state only when there is genuinely nothing to render: a flat view with no
  // candidates, or a grouped view with no recruiter groups at all.
  const showBigEmpty = grouped ? groups.length === 0 : groups[0].candidates.length === 0

  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1140px] px-9 pt-[26px]">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.015em]">Candidates</h1>
            <p className="mt-[3px] text-[13.5px] text-muted-foreground">
              {isManager ? 'Your bench across the team.' : 'Your bench — candidates assigned to you.'}
            </p>
          </div>
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-3 text-[13px] text-[#a1a1aa]">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or skill…"
              className="h-[38px] w-[230px] rounded-[9px] border border-input bg-card pr-3 pl-[30px] text-[13.5px]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <div className="inline-flex gap-[3px] rounded-[10px] bg-[#f0f0f1] p-[3px]">
            {statusTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatus(t.key)}
                className={`inline-flex items-center gap-[7px] rounded-[7px] px-[13px] py-[7px] text-[13px] font-medium transition-all ${
                  status === t.key
                    ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'text-muted-foreground'
                }`}
              >
                {t.dot && <span className="size-[7px] rounded-full" style={{ background: t.dot }} />}
                {t.label}
                <span className="font-mono text-[10.5px] text-[#a1a1aa]">{t.count}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-[9px]">
            {isManager && (
              <select
                value={recruiter}
                onChange={(e) => setRecruiter(e.target.value)}
                className="h-9 min-w-[150px] rounded-[9px] border border-input bg-card px-3 text-[13px]"
              >
                <option value="all">All recruiters</option>
                {recruiterOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            <div className="inline-flex gap-[3px] rounded-[9px] bg-[#f0f0f1] p-[3px]">
              <button
                type="button"
                title="List view"
                onClick={() => chooseView('list')}
                className={`flex h-[30px] w-[34px] items-center justify-center rounded-md text-[13px] transition-all ${
                  view === 'list' ? 'bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-[#a1a1aa]'
                }`}
              >
                ☰
              </button>
              <button
                type="button"
                title="Grid view"
                onClick={() => chooseView('grid')}
                className={`flex h-[30px] w-[34px] items-center justify-center rounded-md text-[13px] transition-all ${
                  view === 'grid' ? 'bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-[#a1a1aa]'
                }`}
              >
                ▦
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-[1140px] px-9 pt-[18px] pb-12">
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        {loading && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}

        {!loading && !error && showBigEmpty && (
          <div className="rounded-[14px] border border-dashed border-input bg-card p-12 text-center">
            <div className="text-[15px] font-semibold">
              {filtered ? 'No candidates match' : 'No candidates yet'}
            </div>
            <div className="mt-[5px] text-[13px] text-muted-foreground">
              {filtered
                ? 'Try a different status or search term.'
                : 'Candidates you add will appear here.'}
            </div>
          </div>
        )}

        {!loading && !error && !showBigEmpty && (
          <div className="flex flex-col gap-[22px]">
            {groups.map((g) => {
              const badge = ROLE_BADGE[g.role] ?? ROLE_BADGE.recruiter
              return (
                <div key={g.id ?? 'flat'}>
                  {grouped && (
                    <div className="mb-[11px] flex items-center gap-[9px]">
                      <div className="flex size-6 items-center justify-center rounded-full border border-border bg-[#f4f4f5] text-[9.5px] font-semibold text-[#52525b]">
                        {initialsOf(g.name)}
                      </div>
                      <span className="text-[13.5px] font-semibold">{g.name}</span>
                      <span
                        className="rounded-full px-[9px] py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: badge.bg, color: badge.fg }}
                      >
                        {ROLE_LABEL[g.role] ?? 'Recruiter'}
                      </span>
                      <span className="font-mono text-[11px] text-[#a1a1aa]">
                        {g.candidates.length}{' '}
                        {g.candidates.length === 1 ? 'candidate' : 'candidates'}
                      </span>
                    </div>
                  )}

                  {g.candidates.length === 0 ? (
                    <div className="rounded-[14px] border border-border bg-card px-4 py-4 text-[13px] text-[#a1a1aa]">
                      {filtered ? 'No matches.' : 'No candidates assigned.'}
                    </div>
                  ) : view === 'list' ? (
                    <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                      <div className="flex border-b border-[#f0f0f1] bg-[#fafafa] px-[18px] py-[9px] font-mono text-[10.5px] tracking-[0.07em] text-[#a1a1aa] uppercase">
                        <div className="flex-1">Candidate</div>
                        <div className="w-[74px]">Work auth</div>
                        <div className="w-[52px]">Exp</div>
                        <div className="w-[150px]">Location</div>
                        <div className="w-[120px]">Status</div>
                      </div>
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="list" />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="grid" />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
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

A subagent cannot sign in. The controller verifies: sign in → `/candidates` shows candidates scoped to role; status tabs filter with live counts; search by name/title/skill narrows results; list/grid toggle works and persists across refresh; owner/admin see **a group per recruiter — including recruiters with an empty bench, which show "No candidates assigned."** — plus the recruiter dropdown; a recruiter sees a flat list with no dropdown; an active filter that matches nothing shows "No matches." per group (or the big "No candidates match" in flat view). (If the dev DB has no candidates yet, recruiter groups still render as empty; you can insert a candidate row via the DB to spot-check populated rendering.)

- [ ] **Step 4: Commit**

From the repo root:
```bash
git add frontend/src/pages/Candidates.tsx
git commit -m "Build the candidates roster page"
```

---

## Done-when

- Backend fast suite green (60 = 52 + 5 helper + 3 route); `uv run black --check .` clean.
- `GET /candidates` returns role-scoped cards with derived `years_experience` and `recruiter_name`; a recruiter is restricted to `user_id == self` server-side.
- `pnpm build` and `pnpm lint` pass.
- In the browser: roster renders with working status filter + counts, search, recruiter filter/grouping (owner/admin), list/grid toggle (persisted), and empty state.
- Four commits (Task 1, Task 2, Task 3, Task 4).

## Self-review notes (for the planner)

- **Spec coverage:** roster header/search/status-filter-with-counts/recruiter-filter/list-grid/grouping (incl. empty recruiter groups)/empty-state and the role-scoped read endpoint with derived years are all covered. Two spec items are deliberately reshaped (client-side filtering, local types) and one deferred (card click → drawer, Chunk 3) — all flagged in "Deviations".
- **Type consistency:** the backend `CandidateCard` fields equal the frontend `CandidateCard` type field-for-field (`recruiter_id`/`recruiter_name`, `years_experience`, `primary_skills`). `view: 'list' | 'grid'` is consistent across the card component and the page. Status tokens flow through `@/lib/candidateStatus` (Chunk 1).
- **No placeholders:** every step has complete code/commands and expected output. The one non-automatable step (manual browser check) is explicitly marked controller-run.
- **TDD:** backend tasks are test-first (helper unit tests; route RBAC+shape tests RED at 404). Frontend has no tests per the standing constraint — verified by build + lint + the controller's manual check.
