# Candidates Chunk 7 — Child Section Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a candidate's profile fully manage its child records — experience, education, projects, certifications — with per-section add/edit/delete editors backed by role-guarded section-replace endpoints.

**Architecture:** Each child section gets one role-guarded `PUT /candidates/:id/<section>` that accepts the **full list** for that section and replaces the candidate's rows for it in one transaction (via the existing `delete-orphan` cascade), returning the refreshed `CandidateDetail`. The four `…In` request schemas (already used by the create wizard) are expanded to carry **all** editable fields, and `create_candidate` is updated to persist them, so one schema per child is the single source of truth. On the frontend, each read-only profile section becomes a self-contained editor component (view ↔ edit toggle, add/remove rows, Save→PUT/Cancel) reusing the chunk-6 `SkillsChipEditor` plus a new `StringListEditor` for bullet/tech arrays.

> **Design decision — section-replace, not per-row CRUD.** The spec says "CRUD … per-section add/edit/delete editors." This plan implements that as **section-level replace** (one PUT per child type carrying the whole list) rather than 12 granular per-row endpoints. Rationale: it mirrors the chunk-6 edit-mode UX (edit a section, Save/Cancel), is atomic, far less surface, and no data references child-row IDs (so the delete-and-reinsert ID churn is harmless). If per-row REST is preferred, this is the decision to revisit before executing.

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, Pydantic v2, `uv`, pytest. Frontend — React 19 + TypeScript (strict), Vite, Tailwind v4, React Router 7, `pnpm`, generated `@callup/shared-types`.

## Global Constraints

- Backend is **`uv` only**; frontend is **`pnpm` only** (never npm/yarn). Run backend commands from `backend/`, frontend commands from `frontend/`.
- **No frontend tests** — no `*.test.ts(x)`, no test runner. Frontend is verified by `pnpm build` (type-check + bundle) and `pnpm lint`.
- Backend: logic in repositories, **all SQL in `db/repositories.py`**, routes are thin callers (never write SQL). Validate at boundaries with Pydantic. Fast suite (`uv run pytest -m "not integration"`) hits no network/DB and must stay green. Format with `uv run black`.
- **RBAC (security-critical, server-side only):** every section-replace endpoint fetches the candidate **org-scoped** and applies the existing `_ensure_access` — a recruiter may edit children **only** on candidates where `candidate.user_id == actor.id`; owner/admin may edit any candidate **in their org**. Cross-org → 404 (the org-scoped fetch returns None); in-org non-owner recruiter → 403. Scope is derived from `actor.role` + org tenancy, **never from a client param**.
- **`years_experience` is derived, never stored** (locked spec decision #1) — it is recomputed from experience dates on read; editing experience changes it automatically. It is never an input.
- Child date inputs are **month granularity** (`<input type="month">` → first-of-month ISO date), matching the read-only month-year rendering. Empty month → `null`.
- Status/work-auth token sets are unchanged (`callup.db.enums`).
- **The OpenAPI contract is the source of frontend types (Chunk 2.5).** The schema expansion (the four `…In` schemas gain fields) and the four new `PUT` paths require regenerating **both** `backend/openapi.json` (guarded by the fast-suite `test_committed_openapi_is_up_to_date`) **and** `frontend/packages/shared-types/openapi.d.ts` (guarded by the frontend CI drift step). Both are committed and LF-pinned; never hand-edit them.
- **Documents stays a placeholder** (Chunk 8). This chunk does not touch the Documents section.
- Frontend: Tailwind classes inline reusing theme tokens (`bg-card`, `bg-brand`, `border-border`, `border-input`, `text-muted-foreground`, `text-destructive`, `text-foreground`); `@/*` alias; one component per file; TS strict, no `any`; `import type` for type-only imports; the `react-hooks/set-state-in-effect` rule is enforced (no synchronous `setState` in an effect body). Profile content max-width stays **1140px**.
- **Commit hygiene:** explicit `git add <paths>` only — never `git add -A`/`.`. Never add the untracked `test_creds.txt`. Do not touch the pre-existing unstaged deletion of `docs/IMPLEMENTATION PLAN - Bench Sales Recruiting.docx`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/callup/api/schemas.py` | expand `ExperienceIn`/`EducationIn`/`ProjectIn`/`CertificationIn` to all editable fields | Modify |
| `backend/src/callup/db/repositories.py` | `replace_experience`/`replace_education`/`replace_projects`/`replace_certifications`; map full fields in `create_candidate` | Modify |
| `backend/src/callup/api/routes/candidates.py` | four `PUT /candidates/{id}/<section>` endpoints | Modify |
| `backend/tests/api/test_candidates.py` | section-replace success/RBAC/validation tests | Modify |
| `backend/openapi.json` | regenerated contract | Modify (generated) |
| `frontend/packages/shared-types/openapi.d.ts` | regenerated types | Modify (generated) |
| `frontend/packages/shared-types/index.ts` | `ExperienceIn`/`EducationIn`/`ProjectIn`/`CertificationIn` aliases | Modify |
| `frontend/src/lib/dates.ts` | `monthInputToIso` + `isoToMonthInput` helpers | Modify |
| `frontend/src/pages/AddCandidate.tsx` | use the shared `monthInputToIso` (drop the local `monthToDate`) | Modify |
| `frontend/src/components/profile/Section.tsx` | optional `action` slot in the section header | Modify |
| `frontend/src/components/profile/StringListEditor.tsx` | reusable bullet/string-list editor | Create |
| `frontend/src/components/profile/ExperienceEditor.tsx` | Experience section view ↔ edit | Create |
| `frontend/src/components/profile/EducationEditor.tsx` | Education section view ↔ edit | Create |
| `frontend/src/components/profile/ProjectEditor.tsx` | Projects section view ↔ edit | Create |
| `frontend/src/components/profile/CertificationEditor.tsx` | Certifications section view ↔ edit | Create |
| `frontend/src/pages/CandidateProfile.tsx` | render the four editors in place of the read-only sections | Modify |

---

## Task 1: Section-replace endpoints (backend) + contract regeneration

**Files:**
- Modify: `backend/src/callup/api/schemas.py`
- Modify: `backend/src/callup/db/repositories.py`
- Modify: `backend/src/callup/api/routes/candidates.py`
- Modify: `backend/tests/api/test_candidates.py`
- Modify (generated): `backend/openapi.json`, `frontend/packages/shared-types/openapi.d.ts`

**Interfaces:**
- Produces: `PUT /candidates/{candidate_id}/experience`, `…/education`, `…/projects`, `…/certifications`, each accepting a JSON **array** of the matching `…In` item and returning `CandidateDetail` (200). The frontend (Tasks 2–4) consumes the expanded `…In` types and the existing `CandidateDetail`.
- Produces: `repositories.replace_experience(session, candidate, items: list[ExperienceIn]) -> Candidate` (and `replace_education`/`replace_projects`/`replace_certifications`) — reassign the candidate's child collection (delete-orphan removes old rows), commit once, return the detail-loaded candidate.
- Produces: expanded `ExperienceIn` (adds `description`, `tech_stack`), `EducationIn` (adds `location`, `cgpa`, `coursework`, `start_date`, `end_date`), `ProjectIn` (adds `description`, `tech_stack`), `CertificationIn` (adds `badge_url`, `issued_on`, `verification_url`).

- [ ] **Step 1: Write the failing section-replace tests**

In `backend/tests/api/test_candidates.py`, append (the file already defines `ORG`, `ACTOR`, `OTHER`, `CAND`, `_actor`, `_candidate`, `_detailed_candidate`, `_Session`, `_client`, and imports `uuid`, `date`, `repositories`, `User`, `get_current_user`, `get_session`, `app`):

```python
async def test_replace_experience_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_experience", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/experience",
                json=[
                    {
                        "company": "Acme",
                        "position": "Dev",
                        "start_date": "2020-01-01",
                        "end_date": "2022-01-01",
                        "description": ["Built X", "  "],
                        "tech_stack": ["Go", " ", "Rust"],
                    }
                ],
            )
        assert resp.status_code == 200
        items = captured["items"]
        assert len(items) == 1
        assert items[0].company == "Acme"
        assert items[0].description == ["Built X"]  # blanks dropped
        assert items[0].tech_stack == ["Go", "Rust"]
    finally:
        app.dependency_overrides.clear()


async def test_replace_education_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_education", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/education",
                json=[{"university": "MIT", "degree": "BS", "cgpa": 3.9, "location": "MA"}],
            )
        assert resp.status_code == 200
        assert captured["items"][0].university == "MIT"
        assert captured["items"][0].cgpa == 3.9
    finally:
        app.dependency_overrides.clear()


async def test_replace_projects_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_projects", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/projects",
                json=[{"title": "P1", "github_link": "https://gh/p1", "tech_stack": ["Go"]}],
            )
        assert resp.status_code == 200
        assert captured["items"][0].title == "P1"
        assert captured["items"][0].tech_stack == ["Go"]
    finally:
        app.dependency_overrides.clear()


async def test_replace_certifications_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_certifications", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/certifications",
                json=[{"name": "AWS SAA", "issued_by": "Amazon", "issued_on": "2023-05-01"}],
            )
        assert resp.status_code == 200
        assert captured["items"][0].name == "AWS SAA"
        assert captured["items"][0].issued_on == date(2023, 5, 1)
    finally:
        app.dependency_overrides.clear()


async def test_replace_section_empty_list_clears(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_experience", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/experience", json=[])
        assert resp.status_code == 200
        assert captured["items"] == []
    finally:
        app.dependency_overrides.clear()


async def test_replace_recruiter_cannot_edit_others_children(monkeypatch):
    called = {"replaced": False}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(OTHER)  # another recruiter's candidate

    async def fake_replace(session, candidate, items):
        called["replaced"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_experience", fake_replace)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/experience", json=[])
        assert resp.status_code == 403
        assert called["replaced"] is False
    finally:
        app.dependency_overrides.clear()


async def test_replace_cross_org_candidate_returns_404(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return None  # org-scoped fetch misses → not in this org

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/projects", json=[])
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_replace_experience_missing_company_returns_422(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/experience", json=[{"position": "Dev"}])
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_replace_experience_bad_dates_returns_422(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/experience",
                json=[{"company": "Acme", "start_date": "2022-01-01", "end_date": "2020-01-01"}],
            )
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run the new tests to verify they fail**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -k "replace" -v
```
Expected: the new `test_replace_*` tests FAIL — `monkeypatch.setattr(repositories, "replace_experience", …)` raises `AttributeError` (the repo functions don't exist) and the `PUT /candidates/{id}/<section>` routes return 405/404. This confirms the tests exercise unbuilt code.

- [ ] **Step 3: Expand the four `…In` schemas**

In `backend/src/callup/api/schemas.py`, **replace** the existing `ExperienceIn`, `EducationIn`, `ProjectIn`, and `CertificationIn` class definitions (the four classes defined before `CandidateCreate`) with these expanded versions (each keeps its required-key validator and adds the remaining editable fields with cleaning validators):

```python
def _clean_str_list(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    return [s.strip() for s in v if s and s.strip()]


class ExperienceIn(BaseModel):
    company: str
    position: str | None = None
    start_date: _dt.date | None = None
    end_date: _dt.date | None = None
    description: list[str] | None = None
    tech_stack: list[str] | None = None

    @field_validator("company")
    @classmethod
    def _company(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company is required")
        return v

    @field_validator("description", "tech_stack")
    @classmethod
    def _lists(cls, v: list[str] | None) -> list[str] | None:
        return _clean_str_list(v)

    @model_validator(mode="after")
    def _dates(self) -> "ExperienceIn":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class EducationIn(BaseModel):
    university: str
    degree: str | None = None
    location: str | None = None
    cgpa: float | None = None
    coursework: str | None = None
    start_date: _dt.date | None = None
    end_date: _dt.date | None = None

    @field_validator("university")
    @classmethod
    def _university(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("university is required")
        return v

    @field_validator("degree", "location", "coursework")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _dates(self) -> "EducationIn":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class ProjectIn(BaseModel):
    title: str
    project_link: str | None = None
    github_link: str | None = None
    description: list[str] | None = None
    tech_stack: list[str] | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title is required")
        return v

    @field_validator("project_link", "github_link")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("description", "tech_stack")
    @classmethod
    def _lists(cls, v: list[str] | None) -> list[str] | None:
        return _clean_str_list(v)


class CertificationIn(BaseModel):
    name: str
    issued_by: str | None = None
    badge_url: str | None = None
    issued_on: _dt.date | None = None
    verification_url: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("issued_by", "badge_url", "verification_url")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None
```

- [ ] **Step 4: Persist the full child fields in `create_candidate` + add the four `replace_*` repo functions**

In `backend/src/callup/db/repositories.py`, **update the child-building in `create_candidate`** so the new fields are persisted. In the `Candidate(...)` constructor inside `create_candidate`, replace the four child list-comprehensions with:
```python
        experience=[
            CandidateExperience(
                org_id=org_id,
                company=e.company,
                position=e.position,
                start_date=e.start_date,
                end_date=e.end_date,
                description=e.description,
                tech_stack=e.tech_stack,
            )
            for e in data.experience
        ],
        education=[
            CandidateEducation(
                org_id=org_id,
                university=ed.university,
                degree=ed.degree,
                location=ed.location,
                cgpa=ed.cgpa,
                coursework=ed.coursework,
                start_date=ed.start_date,
                end_date=ed.end_date,
            )
            for ed in data.education
        ],
        projects=[
            CandidateProject(
                org_id=org_id,
                title=p.title,
                project_link=p.project_link,
                github_link=p.github_link,
                description=p.description,
                tech_stack=p.tech_stack,
            )
            for p in data.projects
        ],
        certifications=[
            CandidateCertification(
                org_id=org_id,
                name=ct.name,
                issued_by=ct.issued_by,
                badge_url=ct.badge_url,
                issued_on=ct.issued_on,
                verification_url=ct.verification_url,
            )
            for ct in data.certifications
        ],
```

Then add the `TYPE_CHECKING` imports for the new request models. Change the existing TYPE_CHECKING block:
```python
if TYPE_CHECKING:
    # Type-only import: the API request model is read for its attributes here, but the
    # db layer must not import the api layer at runtime (one-directional dependency).
    from callup.api.schemas import CandidateCreate
```
to:
```python
if TYPE_CHECKING:
    # Type-only import: the API request models are read for their attributes here, but the
    # db layer must not import the api layer at runtime (one-directional dependency).
    from callup.api.schemas import (
        CandidateCreate,
        CertificationIn,
        EducationIn,
        ExperienceIn,
        ProjectIn,
    )
```

Then append the four replace functions at the end of the file:
```python
async def replace_experience(
    session: AsyncSession, candidate: Candidate, items: "list[ExperienceIn]"
) -> Candidate:
    """Replace all of a candidate's experience rows with ``items`` in one transaction.

    Reassigning the collection lets the ``delete-orphan`` cascade remove the old rows; the PK is
    captured before commit so the post-commit re-fetch (eager) is not an illegal async lazy load.
    """
    candidate_id = candidate.id
    org_id = candidate.org_id
    candidate.experience = [
        CandidateExperience(
            org_id=org_id,
            company=e.company,
            position=e.position,
            start_date=e.start_date,
            end_date=e.end_date,
            description=e.description,
            tech_stack=e.tech_stack,
        )
        for e in items
    ]
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed


async def replace_education(
    session: AsyncSession, candidate: Candidate, items: "list[EducationIn]"
) -> Candidate:
    """Replace all of a candidate's education rows with ``items`` in one transaction."""
    candidate_id = candidate.id
    org_id = candidate.org_id
    candidate.education = [
        CandidateEducation(
            org_id=org_id,
            university=ed.university,
            degree=ed.degree,
            location=ed.location,
            cgpa=ed.cgpa,
            coursework=ed.coursework,
            start_date=ed.start_date,
            end_date=ed.end_date,
        )
        for ed in items
    ]
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed


async def replace_projects(
    session: AsyncSession, candidate: Candidate, items: "list[ProjectIn]"
) -> Candidate:
    """Replace all of a candidate's project rows with ``items`` in one transaction."""
    candidate_id = candidate.id
    org_id = candidate.org_id
    candidate.projects = [
        CandidateProject(
            org_id=org_id,
            title=p.title,
            project_link=p.project_link,
            github_link=p.github_link,
            description=p.description,
            tech_stack=p.tech_stack,
        )
        for p in items
    ]
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed


async def replace_certifications(
    session: AsyncSession, candidate: Candidate, items: "list[CertificationIn]"
) -> Candidate:
    """Replace all of a candidate's certification rows with ``items`` in one transaction."""
    candidate_id = candidate.id
    org_id = candidate.org_id
    candidate.certifications = [
        CandidateCertification(
            org_id=org_id,
            name=ct.name,
            issued_by=ct.issued_by,
            badge_url=ct.badge_url,
            issued_on=ct.issued_on,
            verification_url=ct.verification_url,
        )
        for ct in items
    ]
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed
```

- [ ] **Step 5: Add the four `PUT` endpoints**

In `backend/src/callup/api/routes/candidates.py`, add the request-model imports. Change:
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
to:
```python
from callup.api.schemas import (
    CandidateCard,
    CandidateCreate,
    CandidateDetail,
    CandidateUpdate,
    CertificationIn,
    CertificationOut,
    EducationIn,
    EducationOut,
    ExperienceIn,
    ExperienceOut,
    ProjectIn,
    ProjectOut,
)
```

Then append the four endpoints at the end of the file (each fetches the candidate detail org-scoped, applies `_ensure_access`, replaces the section, and returns the refreshed detail):
```python
@router.put("/candidates/{candidate_id}/experience", response_model=CandidateDetail)
async def replace_experience(
    candidate_id: uuid.UUID, body: list[ExperienceIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_experience(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.put("/candidates/{candidate_id}/education", response_model=CandidateDetail)
async def replace_education(
    candidate_id: uuid.UUID, body: list[EducationIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_education(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.put("/candidates/{candidate_id}/projects", response_model=CandidateDetail)
async def replace_projects(
    candidate_id: uuid.UUID, body: list[ProjectIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_projects(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.put("/candidates/{candidate_id}/certifications", response_model=CandidateDetail)
async def replace_certifications(
    candidate_id: uuid.UUID, body: list[CertificationIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_certifications(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")
```

- [ ] **Step 6: Run the candidate tests to verify they pass**

From `backend/`:
```bash
uv run pytest tests/api/test_candidates.py -v
```
Expected: all candidate tests pass (the 9 new `test_replace_*` tests plus the existing 28 = **37**).

- [ ] **Step 7: Regenerate the committed OpenAPI contract**

From `backend/`:
```bash
uv run python -m callup.openapi_export
```
Expected: prints `wrote .../backend/openapi.json`; the diff adds the four `put` operations and the expanded `ExperienceIn`/`EducationIn`/`ProjectIn`/`CertificationIn` schemas.

- [ ] **Step 8: Run the fast suite (incl. the drift guard) and format**

From `backend/`:
```bash
uv run pytest -m "not integration"
uv run black .
```
Expected: all pass — `test_committed_openapi_is_up_to_date` green after regeneration. Count goes from 87 to **96** (9 new). `black` reports no changes (or reformats the edited files — re-run to confirm clean).

- [ ] **Step 9: Propagate the contract to the frontend types**

From `frontend/`:
```bash
pnpm gen:types
```
Expected: `packages/shared-types/openapi.d.ts` updates with the four `put` operations and the expanded child input schemas.

- [ ] **Step 10: Commit**

From the repo root (explicit adds; never `git add -A`/`.`; never add `test_creds.txt`):
```bash
git add backend/src/callup/api/schemas.py backend/src/callup/db/repositories.py backend/src/callup/api/routes/candidates.py backend/tests/api/test_candidates.py backend/openapi.json frontend/packages/shared-types/openapi.d.ts
git commit -m "Add candidate child-section replace endpoints (experience/education/projects/certs)"
```

---

## Task 2: Frontend foundation — `…In` aliases, date helpers, `StringListEditor`, `Section` action slot

**Files:**
- Modify: `frontend/packages/shared-types/index.ts`
- Modify: `frontend/src/lib/dates.ts`
- Modify: `frontend/src/pages/AddCandidate.tsx`
- Modify: `frontend/src/components/profile/Section.tsx`
- Create: `frontend/src/components/profile/StringListEditor.tsx`

**Interfaces:**
- Consumes: generated `components['schemas']['ExperienceIn'|'EducationIn'|'ProjectIn'|'CertificationIn']` (Task 1).
- Produces: `@callup/shared-types` aliases `ExperienceIn`, `EducationIn`, `ProjectIn`, `CertificationIn`; `@/lib/dates` exports `monthInputToIso(m: string): string | null` and `isoToMonthInput(iso: string | null): string`; `@/components/profile/StringListEditor` default export `StringListEditor({ items, onChange, placeholder? })` where `onChange: (next: string[]) => void`; `Section` gains an optional `action?: ReactNode` slot. Tasks 3–4 consume all of these.

- [ ] **Step 1: Add the `…In` aliases**

In `frontend/packages/shared-types/index.ts`, append below the existing aliases:
```ts
/** Backend candidate child-record inputs (generated) — used by the create wizard and the
 *  profile section editors. */
export type ExperienceIn = components['schemas']['ExperienceIn']
export type EducationIn = components['schemas']['EducationIn']
export type ProjectIn = components['schemas']['ProjectIn']
export type CertificationIn = components['schemas']['CertificationIn']
```

- [ ] **Step 2: Add the date helpers**

In `frontend/src/lib/dates.ts`, append:
```ts
// <input type="month"> gives "YYYY-MM"; the API wants a date, so anchor to the first of the month.
export function monthInputToIso(m: string): string | null {
  return m ? `${m}-01` : null
}

// An ISO date ("YYYY-MM-DD" or null) → the "YYYY-MM" value an <input type="month"> expects.
export function isoToMonthInput(iso: string | null): string {
  return iso ? iso.slice(0, 7) : ''
}
```

- [ ] **Step 3: Use the shared helper in `AddCandidate`**

In `frontend/src/pages/AddCandidate.tsx`, **remove** the local helper:
```tsx
// <input type="month"> gives "YYYY-MM"; the API wants a date, so anchor to the first of the month.
function monthToDate(m: string): string | null {
  return m ? `${m}-01` : null
}
```
Add `monthInputToIso` to the dates import (the file currently has no `@/lib/dates` import — add one after the existing `@/lib/candidateDraft` import line):
```tsx
import { monthInputToIso } from '@/lib/dates'
```
Then replace the two `monthToDate(` call sites in `toPayload` (`start_date: monthToDate(e.start_date)` and `end_date: monthToDate(e.end_date)`) with `monthInputToIso(`:
```tsx
        start_date: monthInputToIso(e.start_date),
        end_date: monthInputToIso(e.end_date),
```

- [ ] **Step 4: Add the `action` slot to `Section`**

In `frontend/src/components/profile/Section.tsx`, replace the whole file with:
```tsx
import type { ReactNode } from 'react'

export default function Section({
  id,
  title,
  children,
  action,
}: {
  id: string
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {action}
      </div>
      <div className="rounded-[14px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {children}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Create `StringListEditor`**

Create `frontend/src/components/profile/StringListEditor.tsx`:
```tsx
export default function StringListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={v}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={placeholder}
            className="h-[34px] flex-1 rounded-[8px] border border-input bg-card px-2.5 text-[13px] outline-none focus:border-[#a5b4fc]"
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-[12.5px] text-destructive hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="self-start text-[12.5px] text-[#5b46e0] hover:underline"
      >
        + Add line
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
Expected: both succeed. `AddCandidate` behaves identically (now using the shared date helper); the new module and `Section` action slot are unconsumed until Tasks 3–4.

- [ ] **Step 7: Commit**

From the repo root:
```bash
git add frontend/packages/shared-types/index.ts frontend/src/lib/dates.ts frontend/src/pages/AddCandidate.tsx frontend/src/components/profile/Section.tsx frontend/src/components/profile/StringListEditor.tsx
git commit -m "Add child-input aliases, shared month/date helpers, StringListEditor, Section action slot"
```

---

## Task 3: Experience & Education section editors + wire into the profile

**Files:**
- Create: `frontend/src/components/profile/ExperienceEditor.tsx`
- Create: `frontend/src/components/profile/EducationEditor.tsx`
- Modify: `frontend/src/pages/CandidateProfile.tsx`

**Interfaces:**
- Consumes: `CandidateDetail`/`ExperienceIn`/`EducationIn` (`@callup/shared-types`); `api` (`@/lib/api`); `monthInputToIso`/`isoToMonthInput` (`@/lib/dates`); `Section` (`@/components/profile/Section`); the read-only `ExperienceSection`/`EducationSection`; `Field`/`inputClass` (`@/components/wizard/Field`); `SkillsChipEditor` (`@/components/SkillsChipEditor`); `StringListEditor` (`@/components/profile/StringListEditor`).
- Produces: `default ExperienceEditor({ id, candidateId, items, canEdit, onSaved })` and `default EducationEditor({ id, candidateId, items, canEdit, onSaved })`, where `items: CandidateDetail['experience'|'education']`, `canEdit: boolean`, `onSaved: (updated: CandidateDetail) => void`. Task 4 follows the same pattern; the profile (this task) renders these two.

- [ ] **Step 1: Create `ExperienceEditor`**

Create `frontend/src/components/profile/ExperienceEditor.tsx`:
```tsx
import { useState } from 'react'
import type { CandidateDetail, ExperienceIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import { isoToMonthInput, monthInputToIso } from '@/lib/dates'
import Section from '@/components/profile/Section'
import ExperienceSection from '@/components/profile/ExperienceSection'
import StringListEditor from '@/components/profile/StringListEditor'
import SkillsChipEditor from '@/components/SkillsChipEditor'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['experience'][number]
type Row = {
  company: string
  position: string
  start: string
  end: string
  description: string[]
  tech_stack: string[]
}

const EMPTY: Row = { company: '', position: '', start: '', end: '', description: [], tech_stack: [] }

function toRow(e: Item): Row {
  return {
    company: e.company,
    position: e.position ?? '',
    start: isoToMonthInput(e.start_date),
    end: isoToMonthInput(e.end_date),
    description: e.description ?? [],
    tech_stack: e.tech_stack ?? [],
  }
}

export default function ExperienceEditor({
  id,
  candidateId,
  items,
  canEdit,
  onSaved,
}: {
  id: string
  candidateId: string
  items: Item[]
  canEdit: boolean
  onSaved: (updated: CandidateDetail) => void
}) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setRows(items.map(toRow))
    setError(null)
    setEditing(true)
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  async function save() {
    setSaving(true)
    setError(null)
    const payload: ExperienceIn[] = rows
      .filter((r) => r.company.trim())
      .map((r) => ({
        company: r.company.trim(),
        position: r.position.trim() || null,
        start_date: monthInputToIso(r.start),
        end_date: monthInputToIso(r.end),
        description: r.description,
        tech_stack: r.tech_stack,
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/experience`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save experience')
    } finally {
      setSaving(false)
    }
  }

  const action = editing ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => { setEditing(false); setError(null) }}
        disabled={saving}
        className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-[8px] bg-brand px-3 py-1 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  ) : canEdit ? (
    <button
      type="button"
      onClick={start}
      className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
    >
      Edit
    </button>
  ) : null

  return (
    <Section id={id} title="Experience" action={action}>
      {!editing && <ExperienceSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Company">
                  <input className={inputClass} value={r.company} onChange={(e) => setRow(i, { company: e.target.value })} />
                </Field>
                <Field label="Position">
                  <input className={inputClass} value={r.position} onChange={(e) => setRow(i, { position: e.target.value })} />
                </Field>
                <Field label="Start">
                  <input type="month" className={inputClass} value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} />
                </Field>
                <Field label="End (blank if current)">
                  <input type="month" className={inputClass} value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Highlights">
                  <StringListEditor items={r.description} onChange={(d) => setRow(i, { description: d })} placeholder="Achievement or responsibility" />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Tech stack">
                  <SkillsChipEditor skills={r.tech_stack} onChange={(t) => setRow(i, { tech_stack: t })} />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="mt-3 text-[12.5px] text-destructive hover:underline"
              >
                Remove entry
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, EMPTY])}
            className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
          >
            + Add experience
          </button>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
      )}
    </Section>
  )
}
```

- [ ] **Step 2: Create `EducationEditor`**

Create `frontend/src/components/profile/EducationEditor.tsx`:
```tsx
import { useState } from 'react'
import type { CandidateDetail, EducationIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import { isoToMonthInput, monthInputToIso } from '@/lib/dates'
import Section from '@/components/profile/Section'
import EducationSection from '@/components/profile/EducationSection'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['education'][number]
type Row = {
  university: string
  degree: string
  location: string
  cgpa: string
  coursework: string
  start: string
  end: string
}

const EMPTY: Row = { university: '', degree: '', location: '', cgpa: '', coursework: '', start: '', end: '' }

function toRow(e: Item): Row {
  return {
    university: e.university,
    degree: e.degree ?? '',
    location: e.location ?? '',
    cgpa: e.cgpa == null ? '' : String(e.cgpa),
    coursework: e.coursework ?? '',
    start: isoToMonthInput(e.start_date),
    end: isoToMonthInput(e.end_date),
  }
}

export default function EducationEditor({
  id,
  candidateId,
  items,
  canEdit,
  onSaved,
}: {
  id: string
  candidateId: string
  items: Item[]
  canEdit: boolean
  onSaved: (updated: CandidateDetail) => void
}) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setRows(items.map(toRow))
    setError(null)
    setEditing(true)
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  async function save() {
    setSaving(true)
    setError(null)
    const payload: EducationIn[] = rows
      .filter((r) => r.university.trim())
      .map((r) => ({
        university: r.university.trim(),
        degree: r.degree.trim() || null,
        location: r.location.trim() || null,
        cgpa: r.cgpa.trim() ? Number(r.cgpa) : null,
        coursework: r.coursework.trim() || null,
        start_date: monthInputToIso(r.start),
        end_date: monthInputToIso(r.end),
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/education`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save education')
    } finally {
      setSaving(false)
    }
  }

  const action = editing ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => { setEditing(false); setError(null) }}
        disabled={saving}
        className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-[8px] bg-brand px-3 py-1 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  ) : canEdit ? (
    <button
      type="button"
      onClick={start}
      className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
    >
      Edit
    </button>
  ) : null

  return (
    <Section id={id} title="Education" action={action}>
      {!editing && <EducationSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="University">
                  <input className={inputClass} value={r.university} onChange={(e) => setRow(i, { university: e.target.value })} />
                </Field>
                <Field label="Degree">
                  <input className={inputClass} value={r.degree} onChange={(e) => setRow(i, { degree: e.target.value })} />
                </Field>
                <Field label="Location">
                  <input className={inputClass} value={r.location} onChange={(e) => setRow(i, { location: e.target.value })} />
                </Field>
                <Field label="CGPA">
                  <input className={inputClass} type="number" step="0.01" value={r.cgpa} onChange={(e) => setRow(i, { cgpa: e.target.value })} />
                </Field>
                <Field label="Start">
                  <input type="month" className={inputClass} value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} />
                </Field>
                <Field label="End">
                  <input type="month" className={inputClass} value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Coursework">
                  <input className={inputClass} value={r.coursework} onChange={(e) => setRow(i, { coursework: e.target.value })} />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="mt-3 text-[12.5px] text-destructive hover:underline"
              >
                Remove entry
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, EMPTY])}
            className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
          >
            + Add education
          </button>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
      )}
    </Section>
  )
}
```

- [ ] **Step 3: Wire the two editors into `CandidateProfile`**

In `frontend/src/pages/CandidateProfile.tsx`, change the section imports. Remove these two lines:
```tsx
import ExperienceSection from '@/components/profile/ExperienceSection'
import EducationSection from '@/components/profile/EducationSection'
```
and add (keep the `ProjectsSection`/`CertificationsSection` imports for now — Task 4 removes them):
```tsx
import ExperienceEditor from '@/components/profile/ExperienceEditor'
import EducationEditor from '@/components/profile/EducationEditor'
```

Then replace the Experience and Education `Section` blocks. Change:
```tsx
              <Section id="experience" title="Experience">
                <ExperienceSection items={detail.experience} />
              </Section>
              <Section id="education" title="Education">
                <EducationSection items={detail.education} />
              </Section>
```
to:
```tsx
              <ExperienceEditor
                id="experience"
                candidateId={detail.id}
                items={detail.experience}
                canEdit={!editing}
                onSaved={setDetail}
              />
              <EducationEditor
                id="education"
                candidateId={detail.id}
                items={detail.education}
                canEdit={!editing}
                onSaved={setDetail}
              />
```
(`editing` is the Overview edit-mode flag from chunk 6; section editing is hidden while the Overview is being edited. `setDetail` is the existing profile state setter.)

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
git add frontend/src/components/profile/ExperienceEditor.tsx frontend/src/components/profile/EducationEditor.tsx frontend/src/pages/CandidateProfile.tsx
git commit -m "Add experience and education section editors to the profile"
```

---

## Task 4: Projects & Certifications section editors + wire into the profile

**Files:**
- Create: `frontend/src/components/profile/ProjectEditor.tsx`
- Create: `frontend/src/components/profile/CertificationEditor.tsx`
- Modify: `frontend/src/pages/CandidateProfile.tsx`

**Interfaces:**
- Consumes: `CandidateDetail`/`ProjectIn`/`CertificationIn` (`@callup/shared-types`); `api`; `isoToMonthInput`/`monthInputToIso` (`@/lib/dates`); `Section`; the read-only `ProjectsSection`/`CertificationsSection`; `Field`/`inputClass`; `SkillsChipEditor`; `StringListEditor`.
- Produces: `default ProjectEditor({ id, candidateId, items, canEdit, onSaved })` and `default CertificationEditor({ id, candidateId, items, canEdit, onSaved })` (same prop contract as Task 3); the profile renders all four editors after this task.

- [ ] **Step 1: Create `ProjectEditor`**

Create `frontend/src/components/profile/ProjectEditor.tsx`:
```tsx
import { useState } from 'react'
import type { CandidateDetail, ProjectIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import Section from '@/components/profile/Section'
import ProjectsSection from '@/components/profile/ProjectsSection'
import StringListEditor from '@/components/profile/StringListEditor'
import SkillsChipEditor from '@/components/SkillsChipEditor'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['projects'][number]
type Row = {
  title: string
  project_link: string
  github_link: string
  description: string[]
  tech_stack: string[]
}

const EMPTY: Row = { title: '', project_link: '', github_link: '', description: [], tech_stack: [] }

function toRow(p: Item): Row {
  return {
    title: p.title,
    project_link: p.project_link ?? '',
    github_link: p.github_link ?? '',
    description: p.description ?? [],
    tech_stack: p.tech_stack ?? [],
  }
}

export default function ProjectEditor({
  id,
  candidateId,
  items,
  canEdit,
  onSaved,
}: {
  id: string
  candidateId: string
  items: Item[]
  canEdit: boolean
  onSaved: (updated: CandidateDetail) => void
}) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setRows(items.map(toRow))
    setError(null)
    setEditing(true)
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  async function save() {
    setSaving(true)
    setError(null)
    const payload: ProjectIn[] = rows
      .filter((r) => r.title.trim())
      .map((r) => ({
        title: r.title.trim(),
        project_link: r.project_link.trim() || null,
        github_link: r.github_link.trim() || null,
        description: r.description,
        tech_stack: r.tech_stack,
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/projects`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save projects')
    } finally {
      setSaving(false)
    }
  }

  const action = editing ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => { setEditing(false); setError(null) }}
        disabled={saving}
        className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-[8px] bg-brand px-3 py-1 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  ) : canEdit ? (
    <button
      type="button"
      onClick={start}
      className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
    >
      Edit
    </button>
  ) : null

  return (
    <Section id={id} title="Projects" action={action}>
      {!editing && <ProjectsSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Title">
                  <input className={inputClass} value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} />
                </Field>
                <Field label="Project link">
                  <input className={inputClass} value={r.project_link} onChange={(e) => setRow(i, { project_link: e.target.value })} />
                </Field>
                <Field label="GitHub link">
                  <input className={inputClass} value={r.github_link} onChange={(e) => setRow(i, { github_link: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Highlights">
                  <StringListEditor items={r.description} onChange={(d) => setRow(i, { description: d })} placeholder="What it does / your role" />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Tech stack">
                  <SkillsChipEditor skills={r.tech_stack} onChange={(t) => setRow(i, { tech_stack: t })} />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="mt-3 text-[12.5px] text-destructive hover:underline"
              >
                Remove entry
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, EMPTY])}
            className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
          >
            + Add project
          </button>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
      )}
    </Section>
  )
}
```

- [ ] **Step 2: Create `CertificationEditor`**

Create `frontend/src/components/profile/CertificationEditor.tsx`:
```tsx
import { useState } from 'react'
import type { CandidateDetail, CertificationIn } from '@callup/shared-types'
import { api } from '@/lib/api'
import { isoToMonthInput, monthInputToIso } from '@/lib/dates'
import Section from '@/components/profile/Section'
import CertificationsSection from '@/components/profile/CertificationsSection'
import { Field, inputClass } from '@/components/wizard/Field'

type Item = CandidateDetail['certifications'][number]
type Row = {
  name: string
  issued_by: string
  issued_on: string
  badge_url: string
  verification_url: string
}

const EMPTY: Row = { name: '', issued_by: '', issued_on: '', badge_url: '', verification_url: '' }

function toRow(c: Item): Row {
  return {
    name: c.name,
    issued_by: c.issued_by ?? '',
    issued_on: isoToMonthInput(c.issued_on),
    badge_url: c.badge_url ?? '',
    verification_url: c.verification_url ?? '',
  }
}

export default function CertificationEditor({
  id,
  candidateId,
  items,
  canEdit,
  onSaved,
}: {
  id: string
  candidateId: string
  items: Item[]
  canEdit: boolean
  onSaved: (updated: CandidateDetail) => void
}) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function start() {
    setRows(items.map(toRow))
    setError(null)
    setEditing(true)
  }
  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  async function save() {
    setSaving(true)
    setError(null)
    const payload: CertificationIn[] = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        issued_by: r.issued_by.trim() || null,
        issued_on: monthInputToIso(r.issued_on),
        badge_url: r.badge_url.trim() || null,
        verification_url: r.verification_url.trim() || null,
      }))
    try {
      const updated = await api.put<CandidateDetail>(`/candidates/${candidateId}/certifications`, payload)
      onSaved(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save certifications')
    } finally {
      setSaving(false)
    }
  }

  const action = editing ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => { setEditing(false); setError(null) }}
        disabled={saving}
        className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-[8px] bg-brand px-3 py-1 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  ) : canEdit ? (
    <button
      type="button"
      onClick={start}
      className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
    >
      Edit
    </button>
  ) : null

  return (
    <Section id={id} title="Certifications" action={action}>
      {!editing && <CertificationsSection items={items} />}
      {editing && (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={i} className="rounded-[12px] border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Name">
                  <input className={inputClass} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                </Field>
                <Field label="Issued by">
                  <input className={inputClass} value={r.issued_by} onChange={(e) => setRow(i, { issued_by: e.target.value })} />
                </Field>
                <Field label="Issued on">
                  <input type="month" className={inputClass} value={r.issued_on} onChange={(e) => setRow(i, { issued_on: e.target.value })} />
                </Field>
                <Field label="Badge URL">
                  <input className={inputClass} value={r.badge_url} onChange={(e) => setRow(i, { badge_url: e.target.value })} />
                </Field>
                <Field label="Verification URL">
                  <input className={inputClass} value={r.verification_url} onChange={(e) => setRow(i, { verification_url: e.target.value })} />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="mt-3 text-[12.5px] text-destructive hover:underline"
              >
                Remove entry
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, EMPTY])}
            className="self-start rounded-[9px] border border-input bg-card px-3 py-2 text-[13px] hover:bg-[#f4f4f5]"
          >
            + Add certification
          </button>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
      )}
    </Section>
  )
}
```

- [ ] **Step 3: Wire the two editors into `CandidateProfile`**

In `frontend/src/pages/CandidateProfile.tsx`, remove these two now-unused imports:
```tsx
import ProjectsSection from '@/components/profile/ProjectsSection'
import CertificationsSection from '@/components/profile/CertificationsSection'
```
and add:
```tsx
import ProjectEditor from '@/components/profile/ProjectEditor'
import CertificationEditor from '@/components/profile/CertificationEditor'
```

Then replace the Projects and Certifications `Section` blocks. Change:
```tsx
              <Section id="projects" title="Projects">
                <ProjectsSection items={detail.projects} />
              </Section>
              <Section id="certifications" title="Certifications">
                <CertificationsSection items={detail.certifications} />
              </Section>
```
to:
```tsx
              <ProjectEditor
                id="projects"
                candidateId={detail.id}
                items={detail.projects}
                canEdit={!editing}
                onSaved={setDetail}
              />
              <CertificationEditor
                id="certifications"
                candidateId={detail.id}
                items={detail.certifications}
                canEdit={!editing}
                onSaved={setDetail}
              />
```

- [ ] **Step 4: Type-check and lint**

From `frontend/`:
```bash
pnpm build
pnpm lint
```
Expected: both succeed.

- [ ] **Step 5: Manual browser check (controller-run; the implementer notes this as deferred)**

A subagent cannot sign in. The controller verifies on a candidate profile (as the owning recruiter and as an owner/admin): each of Experience / Education / Projects / Certifications shows an **Edit** button → editing swaps the read-only view for the row editor → add a row, edit fields (incl. month dates, highlights bullets, tech-stack chips, CGPA), remove a row → **Save** persists and the section refreshes (and the header years update when experience dates change) → **Cancel** discards. Editing a section is hidden while the Overview (chunk 6) is in edit mode. A recruiter cannot see the Edit affordance on another recruiter's candidate (they cannot open it at all → 404 page from chunk 4).

- [ ] **Step 6: Commit**

From the repo root:
```bash
git add frontend/src/components/profile/ProjectEditor.tsx frontend/src/components/profile/CertificationEditor.tsx frontend/src/pages/CandidateProfile.tsx
git commit -m "Add projects and certifications section editors to the profile"
```

---

## Done-when

- Backend fast suite green (**96** = 87 + 9 new replace tests) incl. the OpenAPI drift guard; `uv run black --check .` clean.
- `PUT /candidates/:id/{experience|education|projects|certifications}` each replace that section's rows in one transaction and return the full `CandidateDetail` (200), enforcing RBAC (recruiter → own only; owner/admin → any in org; cross-org → 404) and per-item validation (required key → 422; experience/education bad date order → 422); an empty array clears the section.
- `backend/openapi.json` and `frontend/packages/shared-types/openapi.d.ts` regenerated and committed (both CI drift checks pass); `pnpm gen:types` produces no diff at HEAD.
- `pnpm build` and `pnpm lint` pass.
- In the browser: each child section on the profile has an Edit → add/edit/remove rows → Save/Cancel flow that persists; editing a section is suppressed while the Overview is being edited.
- Four commits (one per task).

## Out of scope (not requested)

- **Documents** (profile Documents section + uploads) — Chunk 8.
- Per-row granular REST endpoints / optimistic-concurrency — section-replace is the chosen model (see the design-decision note).
- Drag-reorder of rows within a section — not in the spec; rows are saved in entry order.
- Editing `email`/`phone`/links on the candidate — chunk-6 Overview scope; unchanged here.

## Self-review notes (for the planner)

- **Spec coverage:** the spec's Chunk 7 bullets are covered — backend CRUD for the four child tables (as section-replace, nested under the candidate, scoped + guarded) (Task 1); per-section add/edit/delete editors on the profile for each child type (Tasks 3–4), with the shared primitives in Task 2. The design-decision note flags the section-replace interpretation of "CRUD."
- **RBAC consistency:** every replace endpoint fetches via the org-scoped `get_candidate_detail` (→ 404 cross-org) and applies the same `_ensure_access` (→ 403 in-org non-owner) as chunk 4/6; no client param can widen scope. The tests assert the guard runs before any write (`called["replaced"] is False`). The shared guard is identical across all four endpoints; RBAC is asserted on the experience endpoint and the cross-org case on projects to cover both branches without 4× duplication.
- **Async-safety:** each `replace_*` reassigns the eager-loaded child collection (so `delete-orphan` removes old rows), captures the PK before `commit()`, and re-fetches via `get_candidate_detail` — the proven pattern; no post-commit lazy load. The route fetches the candidate via `get_candidate_detail`, so the collection is loaded before reassignment.
- **Schema reuse:** the four `…In` schemas are expanded (not duplicated) so the create wizard and the section editors share one definition; `create_candidate` is updated to persist the added fields, so nothing a client sends is silently dropped. Expanding optional fields is backward-compatible with the chunk-5 create tests and the wizard payload.
- **Contract:** Task 1 regenerates both committed artifacts in one commit (expanded `…In` schemas + four `put` paths), keeping both CI drift checks green for later commits. The frontend editors build their payloads as the generated `…In` types, so a backend shape change surfaces as a TS error.
- **DRY without premature abstraction:** the four editors share `Section` (now with an `action` slot), `Field`/`inputClass`, `SkillsChipEditor` (tech_stack), and `StringListEditor` (bullets); they are kept as four sibling components rather than one mega-generic because their field sets genuinely differ. `monthInputToIso` is consolidated into `lib/dates.ts` (replacing the wizard's local copy).
- **State/effect hygiene:** the editors hold local draft state and perform the PUT in an event handler (no effects), so the `react-hooks/set-state-in-effect` rule is not engaged; the `EMPTY` row constant is never mutated (immutable updates only).
- **No placeholders:** every code step has complete code; the one non-automatable step (manual browser check) is explicitly controller-run.
- **TDD:** backend is test-first (9 replace tests RED before the schema/repo/routes exist). Frontend has no tests per the standing constraint — verified by build + lint + the controller's manual check.
