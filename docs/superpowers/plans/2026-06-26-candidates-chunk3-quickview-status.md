# Candidates Chunk 3 — Quick-View Drawer + Status Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a candidate on the roster → a quick-view drawer opens → change their pipeline status (persisted via a role-guarded `PATCH /candidates/:id`) with an optimistic update, plus an "Open full profile" link.

**Architecture:** Backend adds a thin, RBAC-guarded `PATCH /candidates/{id}` that updates `status` and returns the refreshed `CandidateCard`. Frontend adds two shadcn primitives (`sheet`, `dropdown-menu`), a reusable `CandidateStatusChanger` (pill-as-trigger + status menu), a `CandidateDrawer` (Sheet), and wires the roster: card click opens the drawer, the changer fires an optimistic status update reconciled against the PATCH response, and "Open full profile" navigates to a placeholder `/candidates/:id` route (fleshed out in Chunk 4).

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, Pydantic v2, `uv`, pytest. Frontend — React 19 + TypeScript (strict), Vite, Tailwind v4, React Router 7, shadcn/ui (`radix-ui`), `pnpm`.

## Global Constraints

- Backend is **`uv` only**; frontend is **`pnpm` only** (never npm/yarn). Run backend commands from `backend/`, frontend commands from `frontend/`.
- **No frontend tests** — no `*.test.ts(x)`, no test runner. Frontend is verified by `pnpm build` (type-check + bundle) and `pnpm lint`.
- Backend: logic in `services/`, **all SQL in `db/repositories.py`**, routes are thin callers (never write SQL). Validate at boundaries with Pydantic. Fast suite (`uv run pytest -m "not integration"`) hits no network/DB and must stay green. Format with `uv run black`.
- **RBAC (security-critical, server-side only):** a recruiter may edit **only their own** candidates (`candidate.user_id == actor.id`); owner/admin may edit **any** candidate in their org. Derived from `actor.role` + candidate ownership, never from a client param.
- Status tokens are `on_bench` / `interviewing` / `placed` (`callup.db.enums.CandidateStatus`). Display labels + colors come from `@/lib/candidateStatus` (Chunk 1).
- **The OpenAPI contract is the source of frontend types (Chunk 2.5).** Any backend route/schema change requires regenerating **both** `backend/openapi.json` (guarded by the fast-suite `test_committed_openapi_is_up_to_date`) **and** `frontend/packages/shared-types/openapi.d.ts` (guarded by the frontend CI drift step). Both are committed and LF-pinned; do not hand-edit them.
- **UI primitives come from shadcn** (`pnpm dlx shadcn@latest add <name>`) — don't hand-roll a drawer or menu. New primitives must import from the unified `radix-ui` package (already a dependency, matching `src/components/ui/dialog.tsx`). The 7-day `minimum-release-age` in `.npmrc` must not be lowered.
- Frontend: Tailwind classes inline reusing theme tokens (`bg-card`, `border-border`, `text-muted-foreground`, `text-destructive`); `@/*` alias; one component per file; TS strict, no `any`; use `import type` for type-only imports. Backend request/response types come from `@callup/shared-types`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/callup/db/repositories.py` | `get_candidate` + `update_candidate_status` queries | Modify |
| `backend/src/callup/api/routes/candidates.py` | `PATCH /candidates/{id}` + status-update schema + `_card` helper | Modify |
| `backend/tests/api/test_candidates.py` | PATCH RBAC + shape + validation tests | Modify |
| `backend/openapi.json` | regenerated contract (new PATCH path) | Modify (generated) |
| `frontend/packages/shared-types/openapi.d.ts` | regenerated types (new path/schema) | Modify (generated) |
| `frontend/src/components/ui/sheet.tsx` | shadcn drawer primitive | Create (generated) |
| `frontend/src/components/ui/dropdown-menu.tsx` | shadcn menu primitive | Create (generated) |
| `frontend/src/components/CandidateStatusChanger.tsx` | status pill trigger + status menu (reusable) | Create |
| `frontend/src/components/CandidateDrawer.tsx` | quick-view Sheet | Create |
| `frontend/src/components/CandidateCard.tsx` | accept an optional `onClick` | Modify |
| `frontend/src/pages/Candidates.tsx` | drawer state, optimistic PATCH, profile nav | Modify |
| `frontend/src/pages/CandidateProfile.tsx` | placeholder profile page (Chunk 4 fills it) | Create |
| `frontend/src/App.tsx` | `/candidates/:id` route | Modify |

---

## Task 1: `PATCH /candidates/{id}` status endpoint (backend) + contract regeneration

**Files:**
- Modify: `backend/src/callup/db/repositories.py`
- Modify: `backend/src/callup/api/routes/candidates.py`
- Modify: `backend/tests/api/test_candidates.py`
- Modify (generated): `backend/openapi.json`, `frontend/packages/shared-types/openapi.d.ts`

**Interfaces:**
- Produces: `repositories.get_candidate(session: AsyncSession, candidate_id: uuid.UUID, org_id: uuid.UUID) -> Candidate | None` (org-scoped, experience eager-loaded).
- Produces: `repositories.update_candidate_status(session: AsyncSession, candidate: Candidate, status: str) -> Candidate` (persists status; returns the candidate reloaded with experience).
- Produces: `PATCH /candidates/{candidate_id}` accepting `{ "status": "on_bench" | "interviewing" | "placed" }`, returning `CandidateCard`. The frontend (Task 5) calls `api.patch<CandidateCard>('/candidates/:id', { status })`.

- [ ] **Step 1: Write the failing route tests**

Append to `backend/tests/api/test_candidates.py` (the file already imports `uuid`, `date`, `ASGITransport`, `AsyncClient`, `get_current_user`, `repositories`, `Candidate`, `CandidateExperience`, `User`, `get_session`, `app`, and defines `ORG`, `ACTOR`, `_actor`, `_Session`, `_client`):

```python
CAND = uuid.uuid4()
OTHER = uuid.uuid4()


def _candidate(owner_id: uuid.UUID, status: str = "on_bench") -> Candidate:
    cand = Candidate(
        id=CAND,
        org_id=ORG,
        user_id=owner_id,
        name="Arjun Mehta",
        title="Sr. Java Developer",
        status=status,
        work_authorization="H1B",
        location="Dallas, TX",
        primary_skills=["Java"],
    )
    cand.experience = []
    return cand


async def test_recruiter_patches_own_candidate(monkeypatch):
    called = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update_status(session, candidate, new_status):
        called["status"] = new_status
        candidate.status = new_status
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate_status", fake_update_status)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "interviewing"})
        assert resp.status_code == 200
        assert called["status"] == "interviewing"
        assert resp.json()["status"] == "interviewing"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_patch_others_candidate(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update_status(session, candidate, new_status):
        called["updated"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate_status", fake_update_status)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 403
        assert called["updated"] is False
    finally:
        app.dependency_overrides.clear()


async def test_owner_patches_any_candidate(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update_status(session, candidate, new_status):
        candidate.status = new_status
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return User(id=OTHER, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate_status", fake_update_status)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "placed"
        assert resp.json()["recruiter_name"] == "Other Rec"
    finally:
        app.dependency_overrides.clear()


async def test_patch_unknown_candidate_returns_404(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return None

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_patch_invalid_status_returns_422(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "bogus"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run the route tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: the 5 new tests FAIL — `PATCH /candidates/{id}` is not registered, so requests return 404/405 and the status assertions fail (the existing GET tests still pass).

- [ ] **Step 3: Add the repository queries**

In `backend/src/callup/db/repositories.py`, append at the end of the file (the imports it needs — `uuid`, `select`, `selectinload`, `AsyncSession`, `Candidate` — are already imported):

```python
async def get_candidate(
    session: AsyncSession, candidate_id: uuid.UUID, org_id: uuid.UUID
) -> Candidate | None:
    """One candidate scoped to an org, with experience eager-loaded (None if not in the org)."""
    stmt = (
        select(Candidate)
        .where(Candidate.id == candidate_id, Candidate.org_id == org_id)
        .options(selectinload(Candidate.experience))
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def update_candidate_status(
    session: AsyncSession, candidate: Candidate, status: str
) -> Candidate:
    """Persist a new status; return the candidate reloaded with experience eager-loaded.

    The PKs are captured before commit because the default expire-on-commit would otherwise
    make the post-commit attribute reads (incl. the experience relationship) a lazy load,
    which is illegal under async SQLAlchemy.
    """
    candidate_id = candidate.id
    org_id = candidate.org_id
    candidate.status = status
    await session.commit()
    refreshed = await get_candidate(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed
```

- [ ] **Step 4: Add the PATCH route, request schema, and `_card` helper**

Replace the entire contents of `backend/src/callup/api/routes/candidates.py` with:

```python
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentUser, SessionDep
from callup.api.schemas import CandidateCard
from callup.db import repositories
from callup.db.enums import CandidateStatus, RecruiterRole
from callup.db.models import Candidate
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


@router.get("/candidates", response_model=list[CandidateCard])
async def list_candidates(actor: CurrentUser, session: SessionDep) -> list[CandidateCard]:
    # A recruiter sees only their own bench; owner/admin see the whole org.
    scope_user_id = actor.id if actor.role == RecruiterRole.RECRUITER.value else None
    candidates = await repositories.list_candidates(session, actor.org_id, scope_user_id)
    members = await repositories.list_members(session, actor.org_id)
    name_by_id = {m.id: m.name for m in members}
    return [_card(c, name_by_id.get(c.user_id, "—")) for c in candidates]


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
    # A recruiter may edit only their own candidates; owner/admin may edit any in the org.
    if actor.role == RecruiterRole.RECRUITER.value and candidate.user_id != actor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
    updated = await repositories.update_candidate_status(session, candidate, body.status)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _card(updated, member.name if member is not None else "—")
```

- [ ] **Step 5: Run the route tests to verify they pass**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: all candidate tests pass (the 3 existing GET tests + 5 new PATCH tests = 8).

- [ ] **Step 6: Regenerate the committed OpenAPI contract**

The new route adds a path + the `CandidateStatusUpdateIn` schema, so the committed contract is now stale. From `backend/`:
```bash
uv run python -m callup.openapi_export
```
Expected: prints `wrote .../backend/openapi.json`. The diff adds the `patch` operation under `/candidates/{candidate_id}` and a `CandidateStatusUpdateIn` schema.

- [ ] **Step 7: Run the fast suite (incl. the drift guard) and format**

From `backend/`:
```bash
uv run pytest -m "not integration"
uv run black .
```
Expected: all pass — crucially `test_committed_openapi_is_up_to_date` is green now that `openapi.json` was regenerated. Baseline was 62; this adds 5 PATCH tests → 67. `black` reports no changes (or reformats the two edited files — re-run to confirm clean).

- [ ] **Step 8: Propagate the contract to the frontend types**

The frontend's generated types are derived from `backend/openapi.json` (Chunk 2.5), so regenerate them or the frontend CI drift check will fail. From `frontend/`:
```bash
pnpm gen:types
```
Expected: `packages/shared-types/openapi.d.ts` updates with the new path/operation/schema. (The `CandidateCard` type itself is unchanged — the PATCH returns the existing card — so no consumer breaks.)

- [ ] **Step 9: Commit**

From the repo root (add files explicitly — never `git add -A`/`.`; never add `test_creds.txt`):
```bash
git add backend/src/callup/db/repositories.py backend/src/callup/api/routes/candidates.py backend/tests/api/test_candidates.py backend/openapi.json frontend/packages/shared-types/openapi.d.ts
git commit -m "Add PATCH /candidates/:id status endpoint and regenerate contract types"
```

---

## Task 2: Add shadcn `sheet` + `dropdown-menu` primitives

**Files:**
- Create (generated): `frontend/src/components/ui/sheet.tsx`
- Create (generated): `frontend/src/components/ui/dropdown-menu.tsx`

**Interfaces:**
- Produces: `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription` (and the rest) from `@/components/ui/sheet`; `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from `@/components/ui/dropdown-menu`. Tasks 3–4 consume these.

- [ ] **Step 1: Generate the primitives**

From `frontend/`:
```bash
pnpm dlx shadcn@latest add sheet dropdown-menu
```
This reads the existing `components.json` (style `radix-luma`) and writes `src/components/ui/sheet.tsx` and `src/components/ui/dropdown-menu.tsx`.

If `pnpm dlx shadcn@latest` is blocked (the `.npmrc` 7-day release-age policy can reject a too-new `@latest`) or prompts interactively, fall back to the already-installed pinned CLI (`shadcn` is a devDependency):
```bash
pnpm exec shadcn add sheet dropdown-menu
```
Do **not** lower the release-age threshold.

- [ ] **Step 2: Verify the generated files and that no unexpected deps were added**

```bash
git status --short
```
Expected: two new untracked files under `src/components/ui/` (and possibly `package.json`/`pnpm-lock.yaml` if shadcn added a dep). Confirm both new files import the primitive from the unified package, i.e. a line like `import { Dialog as SheetPrimitive } from "radix-ui"` / `import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"` (matching `src/components/ui/dialog.tsx:2`). If instead they import from `@radix-ui/react-*` and those were added to `package.json`, that is acceptable — note it in the report and ensure `pnpm-lock.yaml` is committed too.

- [ ] **Step 3: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed. (Generated `src/components/ui/**` files are already exempt from `react-refresh/only-export-components` via `eslint.config.js`.)

- [ ] **Step 4: Commit**

From the repo root (include `package.json`/`pnpm-lock.yaml` in the `git add` only if Step 2 showed them changed):
```bash
git add frontend/src/components/ui/sheet.tsx frontend/src/components/ui/dropdown-menu.tsx
git commit -m "Add shadcn sheet and dropdown-menu primitives"
```

---

## Task 3: `CandidateStatusChanger` component

**Files:**
- Create: `frontend/src/components/CandidateStatusChanger.tsx`

**Interfaces:**
- Consumes: `@/components/ui/dropdown-menu` (Task 2), `CandidateStatusPill` (Chunk 2), `CANDIDATE_STATUS_ORDER` + `statusStyle` (Chunk 1).
- Produces: `default export CandidateStatusChanger({ status, onChange, disabled }: { status: string; onChange: (next: string) => void; disabled?: boolean })` — the current status as a pill that opens a menu of the three statuses; selecting one calls `onChange(token)`. Tasks 4 (drawer) consumes it.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/CandidateStatusChanger.tsx`:

```tsx
import { CANDIDATE_STATUS_ORDER, statusStyle } from '@/lib/candidateStatus'
import CandidateStatusPill from '@/components/CandidateStatusPill'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function CandidateStatusChanger({
  status,
  onChange,
  disabled,
}: {
  status: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="inline-flex cursor-pointer rounded-full outline-none disabled:cursor-default"
      >
        <CandidateStatusPill status={status} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {CANDIDATE_STATUS_ORDER.map((token) => {
          const s = statusStyle(token)
          return (
            <DropdownMenuItem
              key={token}
              onSelect={() => onChange(token)}
              className="gap-2 text-[13px]"
            >
              <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
              {s.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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

- [ ] **Step 3: Commit**

From the repo root:
```bash
git add frontend/src/components/CandidateStatusChanger.tsx
git commit -m "Add candidate status changer component"
```

---

## Task 4: `CandidateDrawer` component

**Files:**
- Create: `frontend/src/components/CandidateDrawer.tsx`

**Interfaces:**
- Consumes: `@/components/ui/sheet` (Task 2), `@/components/ui/button`, `CandidateStatusChanger` (Task 3), `initialsOf` (`@/lib/utils`), `type CandidateCard` (`@callup/shared-types`).
- Produces: `default export CandidateDrawer({ candidate, open, onOpenChange, onStatusChange, onOpenProfile, error }: { candidate: CandidateCard | null; open: boolean; onOpenChange: (open: boolean) => void; onStatusChange: (next: string) => void; onOpenProfile: () => void; error?: string | null })`. Task 5 (roster) consumes it.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/CandidateDrawer.tsx`:

```tsx
import type { CandidateCard as Candidate } from '@callup/shared-types'
import { initialsOf } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import CandidateStatusChanger from '@/components/CandidateStatusChanger'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[0.07em] text-[#a1a1aa] uppercase">{label}</div>
      <div className="mt-0.5 text-[13px] text-foreground">{value}</div>
    </div>
  )
}

export default function CandidateDrawer({
  candidate,
  open,
  onOpenChange,
  onStatusChange,
  onOpenProfile,
  error,
}: {
  candidate: Candidate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onStatusChange: (next: string) => void
  onOpenProfile: () => void
  error?: string | null
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[420px]">
        {candidate && (
          <>
            <SheetHeader className="border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex size-11 flex-none items-center justify-center rounded-full border border-[#e9e9ec] bg-[#f4f4f5] text-sm font-semibold text-[#52525b]">
                  {initialsOf(candidate.name)}
                </div>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-[15px]">{candidate.name}</SheetTitle>
                  <SheetDescription className="truncate text-[13px]">
                    {candidate.title ?? '—'}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 py-5">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-muted-foreground">Status</span>
                <CandidateStatusChanger status={candidate.status} onChange={onStatusChange} />
              </div>
              {error && <p className="text-[12.5px] text-destructive">{error}</p>}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Work auth" value={candidate.work_authorization ?? '—'} />
                <Field label="Experience" value={`${candidate.years_experience}y`} />
                <Field label="Location" value={candidate.location ?? '—'} />
                <Field label="Recruiter" value={candidate.recruiter_name} />
              </div>

              <div>
                <div className="mb-1.5 font-mono text-[10.5px] tracking-[0.07em] text-[#a1a1aa] uppercase">
                  Skills
                </div>
                <div className="flex flex-wrap gap-1">
                  {candidate.primary_skills.length === 0 ? (
                    <span className="text-[13px] text-muted-foreground">—</span>
                  ) : (
                    candidate.primary_skills.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        className="rounded-[5px] border border-[#ececef] bg-[#f4f4f5] px-1.5 py-px text-[11px] text-[#52525b]"
                      >
                        {s}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={onOpenProfile}>
                Open full profile
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
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

- [ ] **Step 3: Commit**

From the repo root:
```bash
git add frontend/src/components/CandidateDrawer.tsx
git commit -m "Add candidate quick-view drawer component"
```

---

## Task 5: Wire the roster — clickable cards, drawer, optimistic status change, profile route

**Files:**
- Modify: `frontend/src/components/CandidateCard.tsx`
- Modify: `frontend/src/pages/Candidates.tsx`
- Create: `frontend/src/pages/CandidateProfile.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `CandidateDrawer` (Task 4), `api.patch<CandidateCard>` (`@/lib/api`), `useNavigate` (react-router-dom), `type CandidateCard` (`@callup/shared-types`), `AppLayout`.
- Produces: a working quick-view + status-change flow and a `/candidates/:id` placeholder route.

- [ ] **Step 1: Make the card accept an `onClick`**

In `frontend/src/components/CandidateCard.tsx`, change the component signature and apply the handler to both view roots.

Change the props destructuring:
```tsx
export default function CandidateCard({
  candidate,
  view,
}: {
  candidate: Candidate
  view: 'list' | 'grid'
}) {
```
to:
```tsx
export default function CandidateCard({
  candidate,
  view,
  onClick,
}: {
  candidate: Candidate
  view: 'list' | 'grid'
  onClick?: () => void
}) {
```

In the **list** view, change the row's opening `<div>`:
```tsx
      <div className="flex items-center border-b border-[#f4f4f5] px-[18px] py-[13px] last:border-b-0">
```
to:
```tsx
      <div
        onClick={onClick}
        className="flex cursor-pointer items-center border-b border-[#f4f4f5] px-[18px] py-[13px] last:border-b-0 hover:bg-[#fafafa]"
      >
```

In the **grid** view, change the card's opening `<div>`:
```tsx
    <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
```
to:
```tsx
    <div
      onClick={onClick}
      className="flex cursor-pointer flex-col gap-3 rounded-[14px] border border-border bg-card p-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:border-[#d4d4d8]"
    >
```

- [ ] **Step 2: Create the placeholder profile page**

Create `frontend/src/pages/CandidateProfile.tsx`:

```tsx
import { Link, useParams } from 'react-router-dom'
import AppLayout from '@/components/AppLayout'

export default function CandidateProfile() {
  const { id } = useParams<{ id: string }>()
  return (
    <AppLayout active="candidates">
      <div className="w-full max-w-[1140px] px-9 pt-[26px]">
        <Link to="/candidates" className="text-[13px] text-muted-foreground hover:text-foreground">
          ← Back to candidates
        </Link>
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.015em]">Candidate profile</h1>
        <p className="mt-[3px] text-[13.5px] text-muted-foreground">
          Full profile for <span className="font-mono">{id}</span> — coming in the next chunk.
        </p>
      </div>
    </AppLayout>
  )
}
```

- [ ] **Step 3: Register the `/candidates/:id` route**

In `frontend/src/App.tsx`, add the import after the `Candidates` import:
```tsx
import Candidates from '@/pages/Candidates'
import CandidateProfile from '@/pages/CandidateProfile'
```

And add this route immediately after the existing `/candidates` `<Route ...>` block (before the `/accept-invite` route):
```tsx
            <Route
              path="/candidates/:id"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <CandidateProfile />
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
```

- [ ] **Step 4: Wire the drawer + optimistic status change into the roster**

In `frontend/src/pages/Candidates.tsx`:

(a) Add to the imports — `useNavigate` from react-router-dom and the drawer:
```tsx
import { useNavigate } from 'react-router-dom'
import CandidateDrawer from '@/components/CandidateDrawer'
```

(b) Inside the `Candidates` component, after the existing `const [view, setView] = useState<View>(loadView)` line, add the drawer state and navigation:
```tsx
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const navigate = useNavigate()

  function openCandidate(c: Candidate) {
    setSelected(c)
    setDrawerError(null)
    setDrawerOpen(true)
  }

  async function changeStatus(next: string) {
    const current = selected
    if (!current || next === current.status) return
    setDrawerError(null)
    // Optimistic: reflect the new status immediately in the roster and the drawer.
    setCandidates((cs) => cs.map((x) => (x.id === current.id ? { ...x, status: next } : x)))
    setSelected((s) => (s && s.id === current.id ? { ...s, status: next } : s))
    try {
      const updated = await api.patch<Candidate>(`/candidates/${current.id}`, { status: next })
      setCandidates((cs) => cs.map((x) => (x.id === updated.id ? updated : x)))
      setSelected((s) => (s && s.id === updated.id ? updated : s))
    } catch (e) {
      // Roll the one candidate back to its pre-change value and surface the error.
      setCandidates((cs) => cs.map((x) => (x.id === current.id ? current : x)))
      setSelected((s) => (s && s.id === current.id ? current : s))
      setDrawerError(e instanceof Error ? e.message : 'Could not update status')
    }
  }
```

(c) Add `onClick` to **both** `CandidateCard` usages. Change:
```tsx
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="list" />
                      ))}
```
to:
```tsx
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="list" onClick={() => openCandidate(c)} />
                      ))}
```
and change:
```tsx
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="grid" />
                      ))}
```
to:
```tsx
                      {g.candidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} view="grid" onClick={() => openCandidate(c)} />
                      ))}
```

(d) Render the drawer just before the closing `</AppLayout>` tag (after the last content `</div>`):
```tsx
      <CandidateDrawer
        candidate={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onStatusChange={changeStatus}
        onOpenProfile={() => selected && navigate(`/candidates/${selected.id}`)}
        error={drawerError}
      />
    </AppLayout>
```

- [ ] **Step 5: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 6: Manual browser check (controller-run; the implementer notes this as deferred)**

A subagent cannot sign in. The controller verifies: sign in → `/candidates` → click a candidate row/card → the drawer opens with that candidate's details → click the status pill → pick a new status → the pill updates immediately (optimistic) and stays after a refresh (persisted); a recruiter can change their own candidates; owner/admin can change any; "Open full profile" navigates to `/candidates/:id` (placeholder page). (If the dev DB has no candidates, insert one row to exercise the flow.)

- [ ] **Step 7: Commit**

From the repo root:
```bash
git add frontend/src/components/CandidateCard.tsx frontend/src/pages/Candidates.tsx frontend/src/pages/CandidateProfile.tsx frontend/src/App.tsx
git commit -m "Wire candidate quick-view drawer with optimistic status change"
```

---

## Done-when

- Backend fast suite green (67 = 62 + 5 PATCH tests) including the OpenAPI drift guard; `uv run black --check .` clean.
- `PATCH /candidates/:id` updates status, is RBAC-guarded server-side (recruiter → own only, owner/admin → any), returns the refreshed `CandidateCard`, 404s unknown candidates, 422s invalid statuses.
- `backend/openapi.json` and `frontend/packages/shared-types/openapi.d.ts` regenerated and committed (both CI drift checks pass); `pnpm gen:types` produces no diff at HEAD.
- `pnpm build` and `pnpm lint` pass.
- In the browser: card click opens the drawer; status change is optimistic and persists; "Open full profile" navigates to `/candidates/:id`.
- Five commits (Task 1, Task 2, Task 3, Task 4, Task 5).

## Out of scope (not requested)

- `GET /candidates/:id` and the full read-only profile (Chunk 4) — Chunk 3 ships only a placeholder profile route so "Open full profile" lands somewhere.
- Editing any field other than `status` (name/title/skills/reassignment) — that's Chunk 6's extended `PATCH`.
- Server-side filtering/pagination (already a recorded `docs/todos.md` follow-up).
- A toast/notification system — status-change errors surface inline in the drawer; revisit if more surfaces need transient feedback.

## Self-review notes (for the planner)

- **Spec coverage:** the spec's Chunk 3 bullets are all covered — `PATCH /candidates/:id` status change RBAC-guarded (Task 1); drawer opened from a card (Tasks 4–5); status pill + dropdown menu (Task 3); optimistic update (Task 5); "Open full profile" navigation (Task 5, to a placeholder route since the profile is Chunk 4).
- **Drift loop:** Task 1 regenerates both committed artifacts in the same commit, so every later commit keeps both CI drift checks green — consistent with the Chunk 2.5 contract.
- **RBAC is server-side:** the recruiter-vs-owner/admin rule lives in the route and is covered by `test_recruiter_cannot_patch_others_candidate` (403, update not called) and `test_owner_patches_any_candidate` (200). The frontend adds no gating because the roster only shows candidates the user may edit (recruiters are server-scoped to their own); a stray 403 is handled by the optimistic rollback.
- **Async-safety:** `update_candidate_status` captures PKs before `commit()` and re-fetches with `selectinload`, avoiding a post-commit lazy load (illegal under async SQLAlchemy) when the response derives `years_experience` from `experience`.
- **Type consistency:** PATCH returns the same `CandidateCard` the GET list returns (built by the shared `_card` helper), and the frontend consumes it as the generated `@callup/shared-types` `CandidateCard` — no field drift. `CandidateStatusChanger`/`CandidateDrawer` prop names are consistent across Tasks 3–5 (`status`, `onChange`, `onStatusChange`, `onOpenProfile`, `onOpenChange`).
- **No placeholders:** every code step has complete code; the one non-automatable step (manual browser check) is explicitly controller-run.
- **TDD:** backend is test-first (5 PATCH tests RED before the route exists). Frontend has no tests per the standing constraint — verified by build + lint + the controller's manual check.
- **shadcn dependency:** the two new primitives import from the already-present unified `radix-ui` (verified against `dialog.tsx`), so no new runtime dependency is expected; Task 2 Step 2 explicitly checks and the report records if anything was added.
