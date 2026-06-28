# Candidates Chunk 6 — Profile Edit + Reassignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the candidate profile editable — a recruiter/owner/admin edits the Overview fields (name, title, primary_skills, work_authorization, location, summary) inline, and an owner/admin can reassign the candidate to another org member — by generalizing `PATCH /candidates/:id` into a partial update and adding an edit mode to the profile page.

**Architecture:** The existing status-only `PATCH /candidates/:id` becomes a partial `CandidateUpdate` that also carries the Overview fields and `user_id` (reassignment). RBAC is unchanged for in-place edits (the shared `_ensure_access`: recruiter → own only, owner/admin → any in org) and adds a reassignment guard (a recruiter sending `user_id` → 403; owner/admin → the new assignee must be an org member or 400). The route now returns the full `CandidateDetail` so one response refreshes the whole profile. On the frontend, the read-only profile gains an edit mode (Edit → editable Overview form with `EDITING` badge, Cancel/Save), reusing a shared skills-chip editor extracted from the wizard.

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, Pydantic v2, `uv`, pytest. Frontend — React 19 + TypeScript (strict), Vite, Tailwind v4, React Router 7, `pnpm`, generated `@callup/shared-types`.

## Global Constraints

- Backend is **`uv` only**; frontend is **`pnpm` only** (never npm/yarn). Run backend commands from `backend/`, frontend commands from `frontend/`.
- **No frontend tests** — no `*.test.ts(x)`, no test runner. Frontend is verified by `pnpm build` (type-check + bundle) and `pnpm lint`.
- Backend: logic in repositories, **all SQL in `db/repositories.py`**, routes are thin callers (never write SQL). Validate at boundaries with Pydantic. Fast suite (`uv run pytest -m "not integration"`) hits no network/DB and must stay green. Format with `uv run black`.
- **RBAC (security-critical, server-side only):** in-place edits use the existing `_ensure_access` — a recruiter may edit **only** candidates where `candidate.user_id == actor.id`; owner/admin may edit any candidate **in their org**. **Reassignment** (`user_id` in the body) is **owner/admin only**: a recruiter sending `user_id` → **403** (and nothing is written); owner/admin reassigning to a non-member of their org → **400**. Scope is derived from `actor.role` + org tenancy, **never trusted from a client param**.
- **`title` stays required at the API boundary:** if `title` is present in the PATCH body it must be non-blank (422 on blank/null) — you cannot blank an existing title. `name` likewise.
- **`years_experience` is derived, never stored** (locked spec decision #1). The profile shows it read-only in edit mode; it is **not** an editable field and is **not** sent in the update.
- **Partial-update semantics:** the update applies **only** the fields the client actually sent (`model_dump(exclude_unset=True)`). An omitted field is left unchanged; an explicitly-sent nullable field (work_authorization/location/summary) set to `null`/`""` is cleared.
- Status tokens are `on_bench`/`interviewing`/`placed` (`callup.db.enums.CandidateStatus`); work-authorization tokens are `callup.db.enums.WorkAuthorization` (`USC`, `GC`, `GC_EAD`, `H1B`, `OPT`, `STEM_OPT`, `L2_EAD`, `TN`, `OTHER`).
- **The OpenAPI contract is the source of frontend types (Chunk 2.5).** The PATCH change (new `CandidateUpdate` request schema + response model now `CandidateDetail`) requires regenerating **both** `backend/openapi.json` (guarded by the fast-suite `test_committed_openapi_is_up_to_date`) **and** `frontend/packages/shared-types/openapi.d.ts` (guarded by the frontend CI drift step). Both are committed and LF-pinned; do not hand-edit them.
- **Child sections (experience/education/projects/certs) and Documents are NOT edited this chunk** — they remain read-only on the profile (Chunk 7 / Chunk 8). This chunk edits the Overview only.
- Frontend: Tailwind classes inline reusing theme tokens (`bg-card`, `bg-brand`, `border-border`, `border-input`, `text-muted-foreground`, `text-destructive`, `text-foreground`); `@/*` alias; one component per file; TS strict, no `any`; `import type` for type-only imports; the `react-hooks/set-state-in-effect` rule is enforced (no synchronous `setState` in an effect body — set state only inside async callbacks guarded by an `ignore` flag). Profile content max-width stays **1140px** (the current value in `CandidateProfile.tsx`).
- **Commit hygiene:** explicit `git add <paths>` only — never `git add -A`/`.`. Never add the untracked `test_creds.txt`. Do not touch the pre-existing unstaged deletion of `docs/IMPLEMENTATION PLAN - Bench Sales Recruiting.docx`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/callup/api/schemas.py` | add `CandidateUpdate` partial-update request schema | Modify |
| `backend/src/callup/db/repositories.py` | replace `update_candidate_status` with generic `update_candidate(session, candidate, changes)` | Modify |
| `backend/src/callup/api/routes/candidates.py` | generalize `PATCH /candidates/:id` (uses `CandidateUpdate`, reassignment guard, returns `CandidateDetail`); drop `CandidateStatusUpdateIn`/`_CANDIDATE_STATUSES` | Modify |
| `backend/tests/api/test_candidates.py` | rewrite the 5 PATCH tests for the new repo fn + response; add overview/reassign/validation tests | Modify |
| `backend/openapi.json` | regenerated contract | Modify (generated) |
| `frontend/packages/shared-types/openapi.d.ts` | regenerated types | Modify (generated) |
| `docs/database-schema-v1.md` | soften the "assigning candidates across recruiters … future" note (reassignment ships now) | Modify |
| `frontend/packages/shared-types/index.ts` | `CandidateUpdate` alias | Modify |
| `frontend/src/components/SkillsChipEditor.tsx` | shared skills chip editor (extracted from `BasicsStep`) | Create |
| `frontend/src/components/wizard/BasicsStep.tsx` | use the extracted `SkillsChipEditor` | Modify |
| `frontend/src/pages/Candidates.tsx` | repoint the drawer status PATCH generic to `CandidateDetail` | Modify |
| `frontend/src/components/profile/OverviewEditor.tsx` | edit-mode Overview form (name/title/skills/work-auth/location/summary + reassign select) | Create |
| `frontend/src/pages/CandidateProfile.tsx` | edit mode (Edit/Cancel/Save, `EDITING` badge, draft state, save→PATCH, manager members fetch); repoint status PATCH generic to `CandidateDetail` | Modify |

---

## Task 1: Generalize `PATCH /candidates/:id` to Overview + reassignment (backend) + contract regeneration

**Files:**
- Modify: `backend/src/callup/api/schemas.py`
- Modify: `backend/src/callup/db/repositories.py`
- Modify: `backend/src/callup/api/routes/candidates.py`
- Modify: `backend/tests/api/test_candidates.py`
- Modify: `docs/database-schema-v1.md`
- Modify (generated): `backend/openapi.json`, `frontend/packages/shared-types/openapi.d.ts`

**Interfaces:**
- Produces: `PATCH /candidates/{id}` accepting `CandidateUpdate` and returning `CandidateDetail` (200). The frontend (Tasks 2–3) consumes `CandidateUpdate` (request) and the existing `CandidateDetail` (response).
- Produces: `CandidateUpdate` schema — all fields optional: `status`, `name`, `title`, `primary_skills`, `work_authorization`, `location`, `summary`, `user_id`.
- Produces: `repositories.update_candidate(session: AsyncSession, candidate: Candidate, changes: dict) -> Candidate` (applies the provided fields, commits once, returns the detail-loaded candidate). **Replaces** `repositories.update_candidate_status`.

- [ ] **Step 1: Rewrite the existing PATCH tests + write the new failing tests**

In `backend/tests/api/test_candidates.py`, **replace the five existing PATCH tests** (`test_recruiter_patches_own_candidate`, `test_recruiter_cannot_patch_others_candidate`, `test_owner_patches_any_candidate`, `test_patch_unknown_candidate_returns_404`, `test_patch_invalid_status_returns_422` — the block spanning the `async def test_recruiter_patches_own_candidate` through the end of `test_patch_invalid_status_returns_422`) with this block. It monkeypatches the new `repositories.update_candidate` (signature `(session, candidate, changes)`), exercises the new fields, and adds the reassignment + validation cases:

```python
async def test_recruiter_patches_own_status(monkeypatch):
    captured = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        captured["changes"] = changes
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "interviewing"})
        assert resp.status_code == 200
        assert captured["changes"] == {"status": "interviewing"}
        assert resp.json()["status"] == "interviewing"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_edits_own_overview(monkeypatch):
    captured = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        captured["changes"] = changes
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(
                f"/candidates/{CAND}",
                json={
                    "name": "  Arjun M.  ",
                    "title": "Staff Engineer",
                    "primary_skills": ["Go", "  ", "Rust"],
                    "summary": "  Backend.  ",
                    "location": "",
                },
            )
        assert resp.status_code == 200
        changes = captured["changes"]
        assert changes["name"] == "Arjun M."  # trimmed
        assert changes["title"] == "Staff Engineer"
        assert changes["primary_skills"] == ["Go", "Rust"]  # blanks dropped
        assert changes["summary"] == "Backend."  # trimmed
        assert changes["location"] is None  # blank → cleared
        assert "user_id" not in changes  # not sent → not touched
        assert resp.json()["name"] == "Arjun M."
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_patch_others_candidate(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update(session, candidate, changes):
        called["updated"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 403
        assert called["updated"] is False
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_reassign_returns_403(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)  # the recruiter's OWN candidate

    async def fake_update(session, candidate, changes):
        called["updated"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"user_id": str(OTHER)})
        assert resp.status_code == 403  # reassignment is owner/admin only
        assert called["updated"] is False
    finally:
        app.dependency_overrides.clear()


async def test_owner_patches_any_candidate(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update(session, candidate, changes):
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return User(id=OTHER, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
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


async def test_owner_reassigns_to_member(monkeypatch):
    captured = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        captured["changes"] = changes
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return User(id=user_id, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"user_id": str(OTHER)})
        assert resp.status_code == 200
        assert captured["changes"]["user_id"] == OTHER
        assert resp.json()["recruiter_id"] == str(OTHER)
        assert resp.json()["recruiter_name"] == "Other Rec"
    finally:
        app.dependency_overrides.clear()


async def test_owner_reassign_to_non_member_returns_400(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        called["updated"] = True
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return None  # requested assignee is not a member of this org

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"user_id": str(OTHER)})
        assert resp.status_code == 400
        assert called["updated"] is False
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


async def test_patch_blank_title_returns_422(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"title": "   "})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_patch_invalid_work_auth_returns_422(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"work_authorization": "NOPE"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run the PATCH tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -k "patch or reassign or overview" -v
```
Expected: the rewritten/new tests FAIL — `monkeypatch.setattr(repositories, "update_candidate", ...)` raises `AttributeError` (no such function yet), and the new field/reassign behaviors are not implemented. This confirms the tests exercise unbuilt code.

- [ ] **Step 3: Add the `CandidateUpdate` schema**

In `backend/src/callup/api/schemas.py`, change the enum import line:
```python
from callup.db.enums import WorkAuthorization
```
to:
```python
from callup.db.enums import CandidateStatus, WorkAuthorization
```
and add, directly below the existing `_WORK_AUTHS` line:
```python
_STATUSES = {s.value for s in CandidateStatus}
```

Then append at the end of the file:
```python
class CandidateUpdate(BaseModel):
    """Partial update for a candidate's Overview + assignee. Every field is optional; only the
    fields the client actually sends are applied (the route uses ``model_dump(exclude_unset=True)``)."""

    status: str | None = None
    name: str | None = None
    title: str | None = None
    primary_skills: list[str] | None = None
    work_authorization: str | None = None
    location: str | None = None
    summary: str | None = None
    user_id: uuid.UUID | None = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("status must not be null")
        if v not in _STATUSES:
            raise ValueError("status must be on_bench, interviewing, or placed")
        return v

    @field_validator("name", "title")
    @classmethod
    def _required_text(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("must not be null")
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 200:
            raise ValueError("must be at most 200 characters")
        return v

    @field_validator("location", "summary")
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
    def _skills(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        return [s.strip() for s in v if s and s.strip()]
```

Note: Pydantic v2 does not validate defaults unless asked, so the validators run **only** for fields the client actually sends. A field set explicitly to `null`/`""` runs its validator (clearing nullable fields, rejecting null status/name/title); an omitted field stays unset and is dropped by `exclude_unset`.

- [ ] **Step 4: Replace `update_candidate_status` with `update_candidate` in the repository**

In `backend/src/callup/db/repositories.py`, **replace** the entire `update_candidate_status` function:
```python
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
with:
```python
async def update_candidate(
    session: AsyncSession, candidate: Candidate, changes: dict
) -> Candidate:
    """Apply a partial set of column changes and return the candidate detail-loaded.

    ``changes`` is the caller's already-validated field→value map (from
    ``CandidateUpdate.model_dump(exclude_unset=True)``); only those columns are written. The PK
    is captured before commit because the default expire-on-commit would otherwise turn the
    post-commit child reads into illegal async lazy loads; we re-fetch with
    ``get_candidate_detail`` to return a fully eager-loaded graph.
    """
    candidate_id = candidate.id
    org_id = candidate.org_id
    for field, value in changes.items():
        setattr(candidate, field, value)
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed
```

- [ ] **Step 5: Generalize the PATCH route**

In `backend/src/callup/api/routes/candidates.py`, change the schema import block. Change:
```python
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
to:
```python
from callup.api.schemas import (
    CandidateCard,
    CandidateCreate,
    CandidateDetail,
    CandidateUpdate,
    CertificationOut,
    EducationOut,
    ExperienceOut,
    ProjectOut,
)
```

Then **delete** the now-unused status-only request model and its status set. Remove:
```python
_CANDIDATE_STATUSES = {s.value for s in CandidateStatus}


class CandidateStatusUpdateIn(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in _CANDIDATE_STATUSES:
            raise ValueError("status must be on_bench, interviewing, or placed")
        return v
```
Because `CandidateStatus`, `BaseModel`, and `field_validator` are now unused in this module, change the imports. Change:
```python
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from callup.api.deps import CurrentUser, SessionDep
```
to:
```python
from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from callup.api.deps import CurrentUser, SessionDep
```
and change:
```python
from callup.db.enums import CandidateStatus, RecruiterRole
```
to:
```python
from callup.db.enums import RecruiterRole
```

Then **replace** the existing PATCH route:
```python
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
with:
```python
@router.patch("/candidates/{candidate_id}", response_model=CandidateDetail)
async def update_candidate(
    candidate_id: uuid.UUID,
    body: CandidateUpdate,
    actor: CurrentUser,
    session: SessionDep,
) -> CandidateDetail:
    candidate = await repositories.get_candidate(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    changes = body.model_dump(exclude_unset=True)
    if "user_id" in changes:
        # Reassignment is owner/admin only, and only to a member of the actor's org.
        if actor.role == RecruiterRole.RECRUITER.value:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "only owner/admin may reassign")
        member = await repositories.get_member(session, changes["user_id"], actor.org_id)
        if member is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "assignee is not a member of this org")
    updated = await repositories.update_candidate(session, candidate, changes)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")
```

- [ ] **Step 6: Run the candidate tests to verify they pass**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: all candidate tests pass (3 GET-list + **12** PATCH + 4 GET-detail + 9 POST/validation = **28**).

- [ ] **Step 7: Regenerate the committed OpenAPI contract**

From `backend/`:
```bash
uv run python -m callup.openapi_export
```
Expected: prints `wrote .../backend/openapi.json`; the diff adds the `CandidateUpdate` schema and changes the `patch` operation's request body to `CandidateUpdate` and its `200` response to `CandidateDetail`.

- [ ] **Step 8: Run the fast suite (incl. the drift guard) and format**

From `backend/`:
```bash
uv run pytest -m "not integration"
uv run black .
```
Expected: all pass — `test_committed_openapi_is_up_to_date` green after regeneration. Count goes from 80 to **87** (PATCH section +7 net). `black` reports no changes (or reformats the edited files — re-run to confirm clean).

- [ ] **Step 9: Propagate the contract to the frontend types**

From `frontend/`:
```bash
pnpm gen:types
```
Expected: `packages/shared-types/openapi.d.ts` updates with the `CandidateUpdate` schema and the changed PATCH operation.

- [ ] **Step 10: Reconcile the schema doc**

In `docs/database-schema-v1.md`, change:
```
  `e3546d70251d`; it is not drawn in this v1 ERD). Still future scope: assigning candidates
  across recruiters and org-level stats.
```
to:
```
  `e3546d70251d`; it is not drawn in this v1 ERD). Owner/admin can reassign a candidate to
  another org member via `PATCH /candidates/:id` (slice 4 — candidates chunk 6). Still future
  scope: org-level stats.
```

- [ ] **Step 11: Commit**

From the repo root (explicit adds; never `git add -A`/`.`; never add `test_creds.txt`):
```bash
git add backend/src/callup/api/schemas.py backend/src/callup/db/repositories.py backend/src/callup/api/routes/candidates.py backend/tests/api/test_candidates.py backend/openapi.json frontend/packages/shared-types/openapi.d.ts docs/database-schema-v1.md
git commit -m "Generalize PATCH /candidates/:id to Overview edit + reassignment"
```

---

## Task 2: Frontend foundation — `CandidateUpdate` alias, shared `SkillsChipEditor`, repoint status PATCH types

**Files:**
- Modify: `frontend/packages/shared-types/index.ts`
- Create: `frontend/src/components/SkillsChipEditor.tsx`
- Modify: `frontend/src/components/wizard/BasicsStep.tsx`
- Modify: `frontend/src/pages/Candidates.tsx`

**Interfaces:**
- Consumes: generated `components['schemas']['CandidateUpdate']` (Task 1); `CandidateDraft` (`@/lib/candidateDraft`); `Field`/`inputClass` (`@/components/wizard/Field`).
- Produces: `@callup/shared-types` alias `CandidateUpdate`; `@/components/SkillsChipEditor` default export `SkillsChipEditor({ skills, onChange })` where `onChange: (next: string[]) => void`. Task 3 consumes both.

- [ ] **Step 1: Add the `CandidateUpdate` alias**

In `frontend/packages/shared-types/index.ts`, append below the existing aliases:
```ts
/** Backend `PATCH /candidates/:id` request body (generated). */
export type CandidateUpdate = components['schemas']['CandidateUpdate']
```

- [ ] **Step 2: Create the shared `SkillsChipEditor`**

Create `frontend/src/components/SkillsChipEditor.tsx` (this is the wizard's chip editor lifted verbatim into a reusable, controlled component — add on Enter or blur, dedup, remove with ×):
```tsx
import { useState } from 'react'

export default function SkillsChipEditor({
  skills,
  onChange,
}: {
  skills: string[]
  onChange: (next: string[]) => void
}) {
  const [skill, setSkill] = useState('')

  function add() {
    const s = skill.trim()
    setSkill('')
    if (!s || skills.includes(s)) return
    onChange([...skills, s])
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-input bg-card p-2">
      {skills.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 rounded-[6px] bg-[#f4f4f5] px-2 py-0.5 text-[12px] text-[#52525b]"
        >
          {s}
          <button
            type="button"
            onClick={() => onChange(skills.filter((x) => x !== s))}
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
            add()
          }
        }}
        onBlur={add}
        placeholder="Add a skill…"
        className="min-w-[120px] flex-1 bg-transparent px-1 text-[13px] outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 3: Refactor `BasicsStep` to use `SkillsChipEditor`**

In `frontend/src/components/wizard/BasicsStep.tsx`, change the imports. Change:
```tsx
import { useState } from 'react'
import type { CandidateDraft } from '@/lib/candidateDraft'
import { WORK_AUTH_OPTIONS } from '@/lib/workAuth'
import { Field, inputClass } from '@/components/wizard/Field'
```
to:
```tsx
import type { CandidateDraft } from '@/lib/candidateDraft'
import { WORK_AUTH_OPTIONS } from '@/lib/workAuth'
import { Field, inputClass } from '@/components/wizard/Field'
import SkillsChipEditor from '@/components/SkillsChipEditor'
```

Then **delete** the local skill state and `addSkill` helper:
```tsx
  const [skill, setSkill] = useState('')

  function addSkill() {
    const s = skill.trim()
    setSkill('')
    if (!s || draft.primary_skills.includes(s)) return
    update({ primary_skills: [...draft.primary_skills, s] })
  }
```

Then **replace** the entire `<Field label="Primary skills">…</Field>` block (the one containing the inline chip `<div>` with the chips `.map` and the skill `<input>`):
```tsx
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
```
with:
```tsx
      <Field label="Primary skills">
        <SkillsChipEditor
          skills={draft.primary_skills}
          onChange={(next) => update({ primary_skills: next })}
        />
      </Field>
```

- [ ] **Step 4: Repoint the roster drawer's status PATCH generic to `CandidateDetail`**

The PATCH response is now `CandidateDetail` (a superset of `CandidateCard`). In `frontend/src/pages/Candidates.tsx`, update the type-only import. Change:
```tsx
import type { CandidateCard as Candidate, Member } from '@callup/shared-types'
```
to:
```tsx
import type { CandidateCard as Candidate, CandidateDetail, Member } from '@callup/shared-types'
```
Then change the drawer status PATCH call (around line 56). Change:
```tsx
      const updated = await api.patch<Candidate>(`/candidates/${current.id}`, { status: next })
```
to:
```tsx
      const updated = await api.patch<CandidateDetail>(`/candidates/${current.id}`, { status: next })
```
(The surrounding reconcile reads only `updated.status`, which exists on `CandidateDetail`, so no other change is needed.)

- [ ] **Step 5: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed. `BasicsStep` behaves identically (chip add/remove/dedup), now via the shared component; the roster drawer compiles against the new response type.

- [ ] **Step 6: Commit**

From the repo root:
```bash
git add frontend/packages/shared-types/index.ts frontend/src/components/SkillsChipEditor.tsx frontend/src/components/wizard/BasicsStep.tsx frontend/src/pages/Candidates.tsx
git commit -m "Add CandidateUpdate alias and shared SkillsChipEditor; repoint roster PATCH type"
```

---

## Task 3: Profile Overview edit mode (frontend)

**Files:**
- Create: `frontend/src/components/profile/OverviewEditor.tsx`
- Modify: `frontend/src/pages/CandidateProfile.tsx`

**Interfaces:**
- Consumes: `CandidateUpdate`/`CandidateDetail`/`Member` (`@callup/shared-types`); `SkillsChipEditor` (`@/components/SkillsChipEditor`); `Field`/`inputClass` (`@/components/wizard/Field`); `WORK_AUTH_OPTIONS` (`@/lib/workAuth`); `useProfile` (`@/lib/profile`); `api` (`@/lib/api`).
- Produces: `@/components/profile/OverviewEditor` default export `OverviewEditor({ draft, update, years, isManager, members, errors })` with exported `type OverviewDraft`, where `members: { id: string; name: string }[]` is **all** org members (so the current assignee — who may be an owner/admin who self-assigned — is always representable); the editable profile page.

- [ ] **Step 1: Create the `OverviewEditor`**

Create `frontend/src/components/profile/OverviewEditor.tsx`:
```tsx
import { Field, inputClass } from '@/components/wizard/Field'
import SkillsChipEditor from '@/components/SkillsChipEditor'
import { WORK_AUTH_OPTIONS } from '@/lib/workAuth'

export type OverviewDraft = {
  name: string
  title: string
  primary_skills: string[]
  work_authorization: string
  location: string
  summary: string
  user_id: string // current/selected assignee
}

export default function OverviewEditor({
  draft,
  update,
  years,
  isManager,
  members,
  errors,
}: {
  draft: OverviewDraft
  update: (patch: Partial<OverviewDraft>) => void
  years: number
  isManager: boolean
  members: { id: string; name: string }[]
  errors: { name?: string; title?: string }
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name *" hint={errors.name}>
          <input className={inputClass} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Title *" hint={errors.title}>
          <input className={inputClass} value={draft.title} onChange={(e) => update({ title: e.target.value })} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Primary skills">
          <SkillsChipEditor skills={draft.primary_skills} onChange={(next) => update({ primary_skills: next })} />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
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
          <input className={inputClass} value={draft.location} onChange={(e) => update({ location: e.target.value })} />
        </Field>
        <Field label="Years of experience">
          <div className="flex h-[38px] items-center text-[13.5px] text-muted-foreground">
            {years}y · derived from experience
          </div>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Summary">
          <textarea
            value={draft.summary}
            onChange={(e) => update({ summary: e.target.value })}
            rows={5}
            className="w-full rounded-[9px] border border-input bg-card p-3 text-[13.5px] leading-relaxed outline-none focus:border-[#a5b4fc]"
          />
        </Field>
      </div>

      {isManager && (
        <div className="mt-4">
          <Field label="Assigned to">
            <select className={inputClass} value={draft.user_id} onChange={(e) => update({ user_id: e.target.value })}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire edit mode into `CandidateProfile`**

Edit `frontend/src/pages/CandidateProfile.tsx`. Change the import block at the top. Change:
```tsx
import { useEffect, useState } from 'react'
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
```
to:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/http'
import { initialsOf } from '@/lib/utils'
import { useProfile } from '@/lib/profile'
import type { CandidateDetail, CandidateUpdate, Member } from '@callup/shared-types'
import AppLayout from '@/components/AppLayout'
import CandidateStatusChanger from '@/components/CandidateStatusChanger'
import OverviewEditor, { type OverviewDraft } from '@/components/profile/OverviewEditor'
import Section from '@/components/profile/Section'
import ExperienceSection from '@/components/profile/ExperienceSection'
import EducationSection from '@/components/profile/EducationSection'
import ProjectsSection from '@/components/profile/ProjectsSection'
import CertificationsSection from '@/components/profile/CertificationsSection'
```

Then change the status PATCH generic in `changeStatus` (the only `CandidateCard` user left). Change:
```tsx
      const updated = await api.patch<CandidateCard>(`/candidates/${detail.id}`, { status: next })
      setDetail((d) => (d ? { ...d, status: updated.status } : d))
```
to:
```tsx
      const updated = await api.patch<CandidateDetail>(`/candidates/${detail.id}`, { status: next })
      setDetail(updated)
```

Then add the edit-mode state + handlers. Insert directly after the existing `const [statusError, setStatusError] = useState<string | null>(null)` line:
```tsx
  const { user } = useProfile()
  const isManager = user?.role === 'owner' || user?.role === 'admin'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<OverviewDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])

  // Managers load all org members for the reassign select (any member can be an assignee, incl.
  // the current one who may be an owner/admin). Inline-async + ignore flag so the effect body
  // sets no state synchronously — satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!isManager) return
    let ignore = false
    api
      .get<Member[]>('/members')
      .then((ms) => {
        if (!ignore) setMembers(ms.map((m) => ({ id: m.id, name: m.name })))
      })
      .catch(() => {
        if (!ignore) setMembers([])
      })
    return () => {
      ignore = true
    }
  }, [isManager])

  const errors = useMemo(() => {
    const e: { name?: string; title?: string } = {}
    if (draft && !draft.name.trim()) e.name = 'Name is required'
    if (draft && !draft.title.trim()) e.title = 'Title is required'
    return e
  }, [draft])

  function startEdit() {
    if (!detail) return
    setDraft({
      name: detail.name,
      title: detail.title ?? '',
      primary_skills: detail.primary_skills,
      work_authorization: detail.work_authorization ?? '',
      location: detail.location ?? '',
      summary: detail.summary ?? '',
      user_id: detail.recruiter_id,
    })
    setShowErrors(false)
    setSaveError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft(null)
    setShowErrors(false)
    setSaveError(null)
  }

  function updateDraft(patch: Partial<OverviewDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  async function save() {
    if (!draft || !detail) return
    if (!draft.name.trim() || !draft.title.trim()) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    setSaveError(null)
    const payload: CandidateUpdate = {
      name: draft.name.trim(),
      title: draft.title.trim(),
      primary_skills: draft.primary_skills,
      work_authorization: draft.work_authorization || null,
      location: draft.location.trim() || null,
      summary: draft.summary.trim() || null,
    }
    if (isManager && draft.user_id && draft.user_id !== detail.recruiter_id) {
      payload.user_id = draft.user_id
    }
    try {
      const updated = await api.patch<CandidateDetail>(`/candidates/${detail.id}`, payload)
      setDetail(updated)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save changes')
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 3: Add the Edit / Cancel / Save controls + `EDITING` badge to the breadcrumb bar**

In `CandidateProfile.tsx`, **replace** the breadcrumb `<div>` (the one containing the `Candidates` link and the candidate name span):
```tsx
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Link to="/candidates" className="hover:text-foreground">
            Candidates
          </Link>
          <span className="text-[#d4d4d8]">/</span>
          <span className="text-foreground">{detail?.name ?? '…'}</span>
        </div>
```
with:
```tsx
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Link to="/candidates" className="hover:text-foreground">
              Candidates
            </Link>
            <span className="text-[#d4d4d8]">/</span>
            <span className="text-foreground">{detail?.name ?? '…'}</span>
            {editing && (
              <span className="ml-1 rounded-[5px] border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-[#b45309]">
                EDITING
              </span>
            )}
          </div>
          {detail && !loading && !error && (
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-[9px] border border-input bg-card px-3.5 py-1.5 text-[13px] hover:bg-[#f4f4f5] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="rounded-[9px] bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded-[9px] border border-input bg-card px-3.5 py-1.5 text-[13px] hover:bg-[#f4f4f5]"
                >
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 4: Render the editor in place of the header + summary when editing**

In `CandidateProfile.tsx`, the loaded view currently renders, in order: the header `<div className="mt-5 flex items-start gap-4">…</div>`, the section `<nav>`, then `<div className="mt-6 flex flex-col gap-7">` containing the `summary`/`experience`/… `Section`s. Make the header + Summary section conditional on `!editing`, and render the editor (plus a save error) when `editing`.

Change the header block opening line:
```tsx
            <div className="mt-5 flex items-start gap-4">
```
to:
```tsx
            {!editing && (
            <div className="mt-5 flex items-start gap-4">
```
and close that conditional: the header block ends with the `</div>` that closes `mt-5 flex items-start gap-4` (immediately before the `<nav className="mt-6 …">`). Change that closing `</div>` to:
```tsx
            </div>
            )}

            {editing && draft && (
              <div className="mt-5">
                <OverviewEditor
                  draft={draft}
                  update={updateDraft}
                  years={detail.years_experience}
                  isManager={isManager}
                  members={members}
                  errors={showErrors ? errors : {}}
                />
                {saveError && <p className="mt-3 text-[13px] text-destructive">{saveError}</p>}
              </div>
            )}
```

Then make the Summary section render only in view mode. Change:
```tsx
              <Section id="summary" title="Summary">
                {detail.summary ? (
```
to:
```tsx
              {!editing && (
              <Section id="summary" title="Summary">
                {detail.summary ? (
```
and close it — change the Summary section's closing `</Section>` (the one immediately before `<Section id="experience" title="Experience">`) to:
```tsx
              </Section>
              )}
```

(The experience/education/projects/certifications/documents `Section`s stay rendered in both modes — they are read-only this chunk.)

- [ ] **Step 5: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 6: Manual browser check (controller-run; the implementer notes this as deferred)**

A subagent cannot sign in. The controller verifies: open a candidate profile → **Edit** → the Overview form appears with the `EDITING` badge; change name/title/skills/work-auth/location/summary → **Save** → the view refreshes with the new values and the badge clears; **Cancel** discards edits; blanking name or title blocks Save with an inline error. As an **owner/admin**: the **Assigned to** select lists all org members, defaulting to the current assignee; reassigning + Save updates the recruiter line and the candidate moves to that member's group on the roster. As a **recruiter** editing their own candidate: no assignee select is shown; editing the Overview works.

- [ ] **Step 7: Commit**

From the repo root:
```bash
git add frontend/src/components/profile/OverviewEditor.tsx frontend/src/pages/CandidateProfile.tsx
git commit -m "Add profile Overview edit mode with reassignment"
```

---

## Done-when

- Backend fast suite green (**87** = 80 + 7 net new PATCH tests) incl. the OpenAPI drift guard; `uv run black --check .` clean.
- `PATCH /candidates/:id` applies a partial `CandidateUpdate` (status + Overview fields), returns the full `CandidateDetail` (200), enforces RBAC (recruiter → own only; owner/admin → any in org) and the reassignment guard (recruiter sending `user_id` → 403; owner/admin reassign to non-member → 400); blank/null `title`/`name` → 422; invalid `status`/`work_authorization` → 422; only the sent fields are written.
- `backend/openapi.json` and `frontend/packages/shared-types/openapi.d.ts` regenerated and committed (both CI drift checks pass); `pnpm gen:types` produces no diff at HEAD.
- `pnpm build` and `pnpm lint` pass.
- In the browser: a profile's Overview is editable (Edit → form + `EDITING` badge → Save/Cancel), validation blocks blank name/title, owner/admin can reassign, and the change persists and reflects on the roster.
- Three commits (one per task).

## Out of scope (not requested)

- **Child section editors** (experience/education/projects/certifications add/edit/delete) — Chunk 7.
- **Documents** (profile Documents section) — Chunk 8.
- Editing `email`/`phone`/links (linkedin/github/portfolio) — not in the spec's Overview edit field list; they remain view-only (links render in the view-mode Summary card) until a later chunk adds them.
- Server-side optimistic-concurrency / conflict detection on edit — single-editor assumption holds for v1.

## Self-review notes (for the planner)

- **Spec coverage:** the spec's Chunk 6 bullets are covered — backend extends `PATCH /candidates/:id` to Overview fields (name, title, primary_skills, work_authorization, location, summary) + reassignment (`user_id`, owner/admin only, guarded) (Task 1); frontend profile edit mode (Overview), skills chip editor, work-auth select, reassign select for owner/admin, Cancel/Save + `EDITING` badge (Tasks 2–3). The housekeeping reconciliation (soften the "assigning candidates across recruiters … future" note) is Task 1 Step 10.
- **RBAC consistency:** in-place edit reuses the existing `_ensure_access` (recruiter→own, owner/admin→org) unchanged; reassignment adds an explicit owner/admin-only guard + org-membership check via the existing `get_member` (→ 403 for a recruiter, → 400 for a non-member), mirroring the create-endpoint assignee rule. Scope is never widened by a client param.
- **Partial-update safety:** the route applies `model_dump(exclude_unset=True)`, so omitted fields are untouched and an explicitly-nulled nullable field is cleared; Pydantic's no-validate-default means validators run only for sent fields. `years_experience` is never accepted (derived), and `title`/`name`/`status` cannot be nulled.
- **Async-safety:** `update_candidate` captures the PK before `commit()` and re-fetches via `get_candidate_detail` (eager children) — the same proven pattern as `update_candidate_status`/`create_candidate`. The status-change path now also returns the full detail, which is harmless (superset).
- **Contract:** changing the PATCH response from `CandidateCard` to `CandidateDetail` is a strict superset, so existing status-change consumers keep working; both committed artifacts are regenerated in Task 1's commit, keeping both CI drift checks green. The two frontend consumers' generics are repointed to `CandidateDetail` (Tasks 2–3).
- **DRY:** the skills chip editor is extracted to one shared `SkillsChipEditor` now that there are two real callers (wizard Basics + profile Overview), eliminating duplication/drift; `Field`/`inputClass` and `WORK_AUTH_OPTIONS` are reused from chunk 5.
- **Effect hygiene:** the members fetch uses the inline-async + `ignore`-flag pattern (no synchronous `setState` in the effect body), matching the chunk-5 wizard and the roster.
- **No placeholders:** every code step has complete code; the one non-automatable step (manual browser check) is explicitly controller-run.
- **TDD:** backend is test-first (the rewritten + new PATCH tests go RED before the schema/repo/route change). Frontend has no tests per the standing constraint — verified by build + lint + the controller's manual check.
