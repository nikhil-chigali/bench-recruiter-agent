# Candidate Documents & Storage (Chunk 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload, list, download, and delete a candidate's compliance documents from both the add-candidate wizard and the profile, with files stored in private Supabase Storage.

**Architecture:** A thin `httpx` storage client (no new runtime dep) wraps the Supabase Storage REST API; the backend proxies uploads — it validates type/size, stores the bytes with the service key, and writes a `candidate_document` row. Three new endpoints hang off the existing candidates router and reuse the established 404-cross-org / 403-other-recruiter gate. Documents come back as part of the existing `CandidateDetail` fetch. The frontend gains a multipart branch in its fetch client, a profile Documents editor, and an interactive wizard step that holds files in memory and uploads them after the candidate is created.

**Tech Stack:** Backend — FastAPI, async SQLAlchemy 2.0, asyncpg, Pydantic v2, httpx, pytest (`uv`). Frontend — React 19 + Vite + TS strict, Tailwind v4 (pnpm). Storage — Supabase Storage (private bucket).

**Source design:** [`docs/superpowers/specs/2026-06-28-candidate-documents-design.md`](../specs/2026-06-28-candidate-documents-design.md).

## Global Constraints

- **No new schema/migration.** The `candidate_document` table, the `CandidateDocument` model, the `Candidate.documents` relationship (`cascade="all, delete-orphan"`), and the `DocumentType` enum already exist. Do not write a migration.
- **`DocumentType` is compliance-only:** `residency_proof`, `visa_proof`, `i94`, `other`. Do NOT add `resume` — no resume upload or parsing in this chunk.
- **Allowed uploads:** content-type ∈ {`application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/png`, `image/jpeg`}; **max 10 MB**.
- **Status codes:** invalid `doc_type` → 422 (Form-enum validation); unsupported content-type → **415**; oversize → **413**; cross-org candidate → 404; same-org other-recruiter → 403.
- **Secrets:** the Supabase service key is resolved only via `secrets.supabase_service_key()`; never logged, never in responses, never in the frontend bundle. `storage_path` is internal — never returned to the client.
- **Bucket is private.** Object path: `{org_id}/{candidate_id}/{uuid}{ext}`. Downloads use a signed URL with a **300 s** TTL.
- **One new dependency only:** `python-multipart` (FastAPI requires it for `UploadFile`/`Form`). No others. `httpx` is already a backend dep; the frontend uses native `fetch` only (no axios/ky).
- **Two-sided contract:** any change to backend schemas/routes requires regenerating `backend/openapi.json` (`uv run python -m callup.openapi_export`), guarded by `tests/test_openapi_export.py`; the frontend regenerates `packages/shared-types/openapi.d.ts` (`pnpm gen:types`), guarded by frontend CI. Never hand-edit either generated file.
- **Frontend has NO test suite.** Do not add `*.test.ts(x)` or a runner. Verify frontend with `pnpm tsc --noEmit` + `pnpm lint` + manual browser check.
- **Backend style:** ruff line-length 100; async route handlers; validate at boundaries; routes stay thin (storage I/O in the service module).

---

## File Structure

**Backend**
- Create: `backend/src/callup/services/storage.py` — Supabase Storage REST client (`upload`, `create_signed_url`, `remove`).
- Create: `backend/tests/services/test_storage.py` — storage-client unit tests (mocked transport, no network).
- Modify: `backend/src/callup/api/schemas.py` — add `DocumentOut`; add `documents: list[DocumentOut]` to `CandidateDetail`.
- Modify: `backend/src/callup/db/repositories.py` — `selectinload(Candidate.documents)` in `get_candidate_detail`; add `add_document`, `delete_document`.
- Modify: `backend/src/callup/api/routes/candidates.py` — `documents` block in `_detail`; three new endpoints.
- Modify: `backend/tests/api/test_candidates.py` — fixtures + endpoint tests.
- Modify: `backend/pyproject.toml` (+ `uv.lock`) — add `python-multipart`.
- Regenerate: `backend/openapi.json`.

**Frontend**
- Create: `frontend/src/lib/docTypes.ts` — shared `doc_type` option list + label helper.
- Create: `frontend/src/components/profile/DocumentsEditor.tsx` — profile documents section.
- Modify: `frontend/src/lib/http.ts` — `FormData` branch.
- Modify: `frontend/src/lib/api.ts` — `upload` method.
- Modify: `frontend/packages/shared-types/index.ts` — `DocumentOut` alias.
- Modify: `frontend/src/components/wizard/DocumentsStep.tsx` — interactive staged-file UI.
- Modify: `frontend/src/pages/AddCandidate.tsx` — staged-docs state + post-create upload.
- Modify: `frontend/src/pages/CandidateProfile.tsx` — replace the Documents placeholder.
- Regenerate: `frontend/packages/shared-types/openapi.d.ts`.

**Docs**
- Modify: `docs/todos.md` — mark Slice 4 Chunk 8 complete.

---

## Task 1: Storage client (`services/storage.py`)

**Files:**
- Create: `backend/src/callup/services/storage.py`
- Test: `backend/tests/services/test_storage.py`

**Interfaces:**
- Consumes: `callup.config.settings` (`supabase_url`, `storage_bucket`), `callup.secrets.supabase_service_key()`.
- Produces:
  - `async def upload(path: str, content: bytes, content_type: str) -> None`
  - `async def create_signed_url(path: str, expires_in: int = 300) -> str`
  - `async def remove(path: str) -> None`
  - `def _client() -> httpx.AsyncClient` (test seam — tests monkeypatch this to inject a `MockTransport`).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/services/test_storage.py`:

```python
import httpx
import pytest

from callup.services import storage


def _mock(handler):
    """Patch storage._client to return an AsyncClient backed by a MockTransport."""
    transport = httpx.MockTransport(handler)
    return lambda: httpx.AsyncClient(
        transport=transport, base_url=f"{storage.settings.supabase_url}/storage/v1"
    )


async def test_upload_puts_bytes_with_auth_and_content_type(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["ctype"] = request.headers.get("content-type")
        seen["body"] = request.content
        return httpx.Response(200, json={"Key": "ok"})

    monkeypatch.setattr(storage, "_client", _mock(handler))
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")

    await storage.upload("org/cand/abc.pdf", b"PDFBYTES", "application/pdf")

    assert seen["method"] == "POST"
    assert seen["url"].endswith(f"/object/{storage.settings.storage_bucket}/org/cand/abc.pdf")
    assert seen["auth"] == "Bearer svc-key"
    assert seen["ctype"] == "application/pdf"
    assert seen["body"] == b"PDFBYTES"


async def test_create_signed_url_builds_absolute_url(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"signedURL": "/object/sign/bucket/org/cand/abc.pdf?token=t"})

    monkeypatch.setattr(storage, "_client", _mock(handler))
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")

    url = await storage.create_signed_url("org/cand/abc.pdf", expires_in=300)
    assert url == (
        f"{storage.settings.supabase_url}/storage/v1"
        "/object/sign/bucket/org/cand/abc.pdf?token=t"
    )


async def test_remove_issues_delete(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        return httpx.Response(200, json={})

    monkeypatch.setattr(storage, "_client", _mock(handler))
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")

    await storage.remove("org/cand/abc.pdf")
    assert seen["method"] == "DELETE"
    assert seen["url"].endswith(f"/object/{storage.settings.storage_bucket}/org/cand/abc.pdf")


async def test_upload_raises_on_error_status(monkeypatch):
    monkeypatch.setattr(
        storage, "_client", _mock(lambda r: httpx.Response(403, json={"error": "denied"}))
    )
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")
    with pytest.raises(httpx.HTTPStatusError):
        await storage.upload("org/cand/abc.pdf", b"x", "application/pdf")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/services/test_storage.py -q`
Expected: FAIL — `ModuleNotFoundError: callup.services.storage` (module not created yet).

- [ ] **Step 3: Implement the storage client**

Create `backend/src/callup/services/storage.py`:

```python
"""Supabase Storage REST client. The only module that uploads/serves candidate document bytes.

A thin httpx wrapper (no SDK) over the Storage REST API, authenticated with the service-role
key resolved via ``secrets`` — which therefore never leaves the backend. The bucket is private;
downloads are handed out only as short-lived signed URLs.
"""

import httpx

from callup.config import settings
from callup.secrets import supabase_service_key


def _client() -> httpx.AsyncClient:
    """The HTTP client for Storage calls. A test seam: tests patch this to inject a transport."""
    return httpx.AsyncClient(base_url=f"{settings.supabase_url}/storage/v1")


def _auth() -> dict[str, str]:
    key = supabase_service_key()
    return {"Authorization": f"Bearer {key}", "apikey": key}


async def upload(path: str, content: bytes, content_type: str) -> None:
    """Store ``content`` at ``path`` within the bucket. Raises on a non-2xx response."""
    async with _client() as client:
        resp = await client.post(
            f"/object/{settings.storage_bucket}/{path}",
            content=content,
            headers={**_auth(), "Content-Type": content_type},
        )
        resp.raise_for_status()


async def create_signed_url(path: str, expires_in: int = 300) -> str:
    """Return an absolute, time-limited download URL for ``path``."""
    async with _client() as client:
        resp = await client.post(
            f"/object/sign/{settings.storage_bucket}/{path}",
            json={"expiresIn": expires_in},
            headers=_auth(),
        )
        resp.raise_for_status()
        signed = resp.json()["signedURL"]
    return f"{settings.supabase_url}/storage/v1{signed}"


async def remove(path: str) -> None:
    """Delete the object at ``path``. Raises on a non-2xx response."""
    async with _client() as client:
        resp = await client.delete(
            f"/object/{settings.storage_bucket}/{path}", headers=_auth()
        )
        resp.raise_for_status()
```

Note: the test patches `storage.supabase_service_key`, so it must be imported as a name into this module (the `from callup.secrets import supabase_service_key` above does that).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/services/test_storage.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/callup/services/storage.py backend/tests/services/test_storage.py
git commit -m "feat: Supabase Storage REST client for candidate documents"
```

---

## Task 2: `DocumentOut` schema + `CandidateDetail.documents` + `_detail` mapping

**Files:**
- Modify: `backend/src/callup/api/schemas.py`
- Modify: `backend/src/callup/db/repositories.py` (add `selectinload(Candidate.documents)` to `get_candidate_detail`, lines 272-281)
- Modify: `backend/src/callup/api/routes/candidates.py` (`_detail`, after the `certifications` block ~line 129; imports)
- Modify: `backend/tests/api/test_candidates.py` (fixtures + detail assertion)
- Regenerate: `backend/openapi.json`

**Interfaces:**
- Produces: `DocumentOut(id: uuid.UUID, doc_type: str, filename: str | None, created_at: _dt.datetime)`; `CandidateDetail.documents: list[DocumentOut]`; `_detail()` now populates `documents`.

- [ ] **Step 1: Update the test fixtures and detail assertion**

In `backend/tests/api/test_candidates.py`, add `CandidateDocument` to the model import (line 8-15 block):

```python
from callup.db.models import (
    Candidate,
    CandidateCertification,
    CandidateDocument,
    CandidateEducation,
    CandidateExperience,
    CandidateProject,
    User,
)
```

In `_candidate(...)` (currently ends with `cand.experience = []` then `return cand`, ~line 138), set documents so `_detail` can serialize them:

```python
    cand.experience = []
    cand.documents = []
    return cand
```

In `_detailed_candidate(...)`, before `return cand` (~line 496), add a document:

```python
    cand.documents = [
        CandidateDocument(
            id=uuid.uuid4(),
            doc_type="visa_proof",
            storage_path="org/cand/abc.pdf",
            filename="visa.pdf",
        )
    ]
    return cand
```

Extend `test_get_candidate_detail_shape` (after the certifications assertion, ~line 526):

```python
        assert len(body["documents"]) == 1
        assert body["documents"][0]["doc_type"] == "visa_proof"
        assert body["documents"][0]["filename"] == "visa.pdf"
        assert "storage_path" not in body["documents"][0]  # internal, never exposed
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/api/test_candidates.py::test_get_candidate_detail_shape -q`
Expected: FAIL — `KeyError: 'documents'` (CandidateDetail has no `documents` field yet).

- [ ] **Step 3: Add the schema**

In `backend/src/callup/api/schemas.py`, add `DocumentOut` next to the other `*Out` classes (after `CertificationOut`, ~line 98):

```python
class DocumentOut(BaseModel):
    id: uuid.UUID
    doc_type: str
    filename: str | None
    created_at: _dt.datetime
```

Add `documents` to `CandidateDetail` (after `certifications`, ~line 120):

```python
    certifications: list[CertificationOut]
    documents: list[DocumentOut]
```

- [ ] **Step 4: Eager-load documents in the repository**

In `backend/src/callup/db/repositories.py`, add documents to `get_candidate_detail`'s options (the block at ~lines 275-280):

```python
        .options(
            selectinload(Candidate.experience),
            selectinload(Candidate.education),
            selectinload(Candidate.projects),
            selectinload(Candidate.certifications),
            selectinload(Candidate.documents),
        )
```

- [ ] **Step 5: Map documents in `_detail`**

In `backend/src/callup/api/routes/candidates.py`, add `DocumentOut` to the schema import block (lines 7-20), then add a `documents` block to `_detail` after the `certifications=[...]` list (~line 129, before the closing `)`):

```python
        documents=[
            DocumentOut(
                id=d.id,
                doc_type=d.doc_type,
                filename=d.filename,
                created_at=d.created_at,
            )
            for d in c.documents
        ],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/test_candidates.py -q`
Expected: PASS (the detail test now sees `documents`; all others still green because fixtures set `cand.documents`).

- [ ] **Step 7: Regenerate the committed OpenAPI and verify the guard**

Run: `cd backend && uv run python -m callup.openapi_export && uv run pytest tests/test_openapi_export.py -q`
Expected: `openapi.json` rewritten; `test_committed_openapi_is_up_to_date` PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/callup/api/schemas.py backend/src/callup/db/repositories.py \
  backend/src/callup/api/routes/candidates.py backend/tests/api/test_candidates.py \
  backend/openapi.json
git commit -m "feat: expose candidate documents in CandidateDetail"
```

---

## Task 3: Repository write helpers (`add_document`, `delete_document`)

**Files:**
- Modify: `backend/src/callup/db/repositories.py` (after `replace_experience`, ~line 418)
- Modify: `backend/tests/db/test_candidates_repo.py` (integration tests)

**Interfaces:**
- Consumes: `get_candidate_detail`; `CandidateDocument` model.
- Produces:
  - `async def add_document(session, candidate: Candidate, doc_type: str, storage_path: str, filename: str | None) -> Candidate` — returns the detail-loaded candidate.
  - `async def delete_document(session, candidate: Candidate, document_id: uuid.UUID) -> Candidate` — removes the matching row via the delete-orphan cascade; returns the detail-loaded candidate.

> The route-level tests in Tasks 4–5 (which mock these) are the fast-suite gate. The integration
> tests below require live Supabase credentials and run only under `-m integration`; run them
> against the live DB as the final integration check (as done for `create_candidate` in chunk 5).

- [ ] **Step 1: Write the failing integration tests**

In `backend/tests/db/test_candidates_repo.py`, add (mirroring the existing integration style — reuse that file's `SessionFactory`/org/user setup helpers; the snippet below assumes a created candidate `cand` and `session` as the existing tests do):

```python
import uuid

import pytest

from callup.db import repositories


@pytest.mark.integration
async def test_add_and_delete_document(session, cand):  # reuse existing fixtures/setup
    updated = await repositories.add_document(
        session, cand, "visa_proof", f"{cand.org_id}/{cand.id}/x.pdf", "visa.pdf"
    )
    assert len(updated.documents) == 1
    doc = updated.documents[0]
    assert doc.doc_type == "visa_proof"
    assert doc.filename == "visa.pdf"
    assert doc.org_id == cand.org_id  # TenantMixin stamped

    after = await repositories.delete_document(session, updated, doc.id)
    assert after.documents == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/db/test_candidates_repo.py -m integration -q`
Expected: FAIL — `AttributeError: module 'callup.db.repositories' has no attribute 'add_document'`. (If no live DB, this also errors at connect — that's acceptable; the behavior is enforced by Tasks 4–5's mocked route tests in the fast suite.)

- [ ] **Step 3: Implement the helpers**

In `backend/src/callup/db/repositories.py`, after `replace_experience` (~line 418), add. Match the established pre-commit PK-capture + re-fetch pattern:

```python
async def add_document(
    session: AsyncSession,
    candidate: Candidate,
    doc_type: str,
    storage_path: str,
    filename: str | None,
) -> Candidate:
    """Append one document row to a candidate and return it detail-loaded.

    The PK is captured before commit because the default expire-on-commit would otherwise turn
    the post-commit child reads into illegal async lazy loads; we re-fetch with
    ``get_candidate_detail`` to return a fully eager-loaded graph.
    """
    candidate_id = candidate.id
    org_id = candidate.org_id
    candidate.documents.append(
        CandidateDocument(
            org_id=org_id,
            doc_type=doc_type,
            storage_path=storage_path,
            filename=filename,
        )
    )
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed


async def delete_document(
    session: AsyncSession, candidate: Candidate, document_id: uuid.UUID
) -> Candidate:
    """Remove the candidate's document with ``document_id`` and return it detail-loaded.

    Filtering the collection lets the ``delete-orphan`` cascade delete the row; the PK is captured
    before commit so the post-commit re-fetch (eager) is not an illegal async lazy load.
    """
    candidate_id = candidate.id
    org_id = candidate.org_id
    candidate.documents = [d for d in candidate.documents if d.id != document_id]
    await session.commit()
    refreshed = await get_candidate_detail(session, candidate_id, org_id)
    assert refreshed is not None  # just updated within this transaction
    return refreshed
```

Ensure `CandidateDocument` is imported in `repositories.py` (it imports the other child models near the top — add `CandidateDocument` to that import list).

- [ ] **Step 4: Verify the fast suite still passes (regression)**

Run: `cd backend && uv run pytest -m "not integration" -q`
Expected: PASS (no behavior change to existing fast tests). Run the integration test against live DB if credentials are available (Expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add backend/src/callup/db/repositories.py backend/tests/db/test_candidates_repo.py
git commit -m "feat: add_document / delete_document repository helpers"
```

---

## Task 4: Upload endpoint (`POST /candidates/{id}/documents`)

**Files:**
- Modify: `backend/pyproject.toml` + `uv.lock` (add `python-multipart`)
- Modify: `backend/src/callup/api/routes/candidates.py` (imports; allowed-types map; route)
- Modify: `backend/tests/api/test_candidates.py` (upload tests)
- Regenerate: `backend/openapi.json`

**Interfaces:**
- Consumes: `storage.upload` (Task 1), `repositories.add_document` (Task 3), `repositories.get_candidate_detail`, `_ensure_access`, `_detail`, `DocumentType` enum.
- Produces: `POST /candidates/{candidate_id}/documents` (multipart `file` + `doc_type`), 201 → `CandidateDetail`.

- [ ] **Step 1: Add the dependency**

Run: `cd backend && uv add python-multipart`
(Justification for the commit message: FastAPI requires `python-multipart` to parse `multipart/form-data`; it cannot be reasonably hand-written. It is the only new runtime dep in this chunk.)

- [ ] **Step 2: Write the failing tests**

In `backend/tests/api/test_candidates.py`, add (the suite already imports `repositories`; add `from callup.services import storage` at the top with the other imports):

```python
async def test_upload_document_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_upload(path, content, content_type):
        captured["path"] = path
        captured["content"] = content
        captured["content_type"] = content_type

    async def fake_add(session, candidate, doc_type, storage_path, filename):
        captured["doc_type"] = doc_type
        captured["storage_path"] = storage_path
        captured["filename"] = filename
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "add_document", fake_add)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    monkeypatch.setattr(storage, "upload", fake_upload)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                f"/candidates/{CAND}/documents",
                files={"file": ("visa.pdf", b"PDFDATA", "application/pdf")},
                data={"doc_type": "visa_proof"},
            )
        assert resp.status_code == 201
        assert captured["content"] == b"PDFDATA"
        assert captured["content_type"] == "application/pdf"
        assert captured["doc_type"] == "visa_proof"
        assert captured["filename"] == "visa.pdf"
        assert captured["storage_path"].startswith(f"{ORG}/{CAND}/")
        assert captured["storage_path"].endswith(".pdf")
        assert captured["path"] == captured["storage_path"]  # same path to storage + DB
    finally:
        app.dependency_overrides.clear()


async def test_upload_rejects_unsupported_type_returns_415(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    called = {"uploaded": False}

    async def fake_upload(path, content, content_type):
        called["uploaded"] = True

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(storage, "upload", fake_upload)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                f"/candidates/{CAND}/documents",
                files={"file": ("evil.exe", b"MZ", "application/x-msdownload")},
                data={"doc_type": "other"},
            )
        assert resp.status_code == 415
        assert called["uploaded"] is False
    finally:
        app.dependency_overrides.clear()


async def test_upload_rejects_oversize_returns_413(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    called = {"uploaded": False}

    async def fake_upload(path, content, content_type):
        called["uploaded"] = True

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(storage, "upload", fake_upload)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        big = b"0" * (10 * 1024 * 1024 + 1)
        async with await _client() as c:
            resp = await c.post(
                f"/candidates/{CAND}/documents",
                files={"file": ("big.pdf", big, "application/pdf")},
                data={"doc_type": "other"},
            )
        assert resp.status_code == 413
        assert called["uploaded"] is False
    finally:
        app.dependency_overrides.clear()


async def test_upload_invalid_doc_type_returns_422(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                f"/candidates/{CAND}/documents",
                files={"file": ("x.pdf", b"x", "application/pdf")},
                data={"doc_type": "bogus"},
            )
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_upload_recruiter_cannot_upload_to_others(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(OTHER)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                f"/candidates/{CAND}/documents",
                files={"file": ("x.pdf", b"x", "application/pdf")},
                data={"doc_type": "other"},
            )
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_upload_cross_org_returns_404(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return None

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                f"/candidates/{CAND}/documents",
                files={"file": ("x.pdf", b"x", "application/pdf")},
                data={"doc_type": "other"},
            )
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && uv run pytest tests/api/test_candidates.py -k upload -q`
Expected: FAIL — 404/405 (route not defined yet) / `NameError` on `storage`.

- [ ] **Step 4: Implement the route**

In `backend/src/callup/api/routes/candidates.py`:

Update the FastAPI import (line 3):

```python
from fastapi import APIRouter, Form, HTTPException, UploadFile, status
```

Add to the schema import block: `DocumentOut`. Add new imports near the top:

```python
from callup.db.enums import DocumentType, RecruiterRole
from callup.services import storage
```

After the `_resolve_assignee` helper (~line 48), add the allowed-types map and constants:

```python
# Content-type → stored file extension. The authoritative allow-list for uploads.
_ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
```

Add the route (after `replace_certifications`, end of file):

```python
@router.post(
    "/candidates/{candidate_id}/documents",
    response_model=CandidateDetail,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    candidate_id: uuid.UUID,
    actor: CurrentUser,
    session: SessionDep,
    file: UploadFile,
    doc_type: DocumentType = Form(...),
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported file type"
        )
    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file exceeds 10 MB limit"
        )
    path = f"{actor.org_id}/{candidate_id}/{uuid.uuid4()}{ext}"
    await storage.upload(path, content, file.content_type)
    updated = await repositories.add_document(
        session, candidate, doc_type.value, path, file.filename
    )
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")
```

(`DocumentType` is a `StrEnum`, so FastAPI validates the `doc_type` form field and returns 422 on an invalid value automatically.)

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && uv run pytest tests/api/test_candidates.py -k upload -q`
Expected: PASS (6 upload tests).

- [ ] **Step 6: Regenerate OpenAPI + guard + full fast suite**

Run: `cd backend && uv run python -m callup.openapi_export && uv run pytest -m "not integration" -q`
Expected: `openapi.json` rewritten; entire fast suite PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/src/callup/api/routes/candidates.py \
  backend/tests/api/test_candidates.py backend/openapi.json
git commit -m "feat: upload candidate document endpoint (multipart, validated)"
```

---

## Task 5: Download + delete endpoints

**Files:**
- Modify: `backend/src/callup/api/routes/candidates.py` (two routes + a `DocumentUrlOut` schema or inline dict)
- Modify: `backend/src/callup/api/schemas.py` (`DocumentUrlOut`)
- Modify: `backend/tests/api/test_candidates.py` (download/delete tests + a `_document` helper)
- Regenerate: `backend/openapi.json`

**Interfaces:**
- Consumes: `storage.create_signed_url`, `storage.remove` (Task 1); `repositories.delete_document` (Task 3); `get_candidate_detail`, `_ensure_access`, `_detail`.
- Produces:
  - `GET /candidates/{candidate_id}/documents/{document_id}/download` → `DocumentUrlOut(url: str)`.
  - `DELETE /candidates/{candidate_id}/documents/{document_id}` → `CandidateDetail`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/api/test_candidates.py`, add a document helper near `_detailed_candidate` and the tests:

```python
DOC = uuid.uuid4()


def _candidate_with_doc(owner_id: uuid.UUID) -> Candidate:
    cand = _detailed_candidate(owner_id)
    cand.documents = [
        CandidateDocument(
            id=DOC,
            doc_type="visa_proof",
            storage_path=f"{ORG}/{CAND}/abc.pdf",
            filename="visa.pdf",
        )
    ]
    return cand


async def test_download_document_returns_signed_url(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _candidate_with_doc(ACTOR)

    async def fake_signed(path, expires_in=300):
        captured["path"] = path
        captured["expires_in"] = expires_in
        return "https://signed.example/abc.pdf?token=t"

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(storage, "create_signed_url", fake_signed)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}/documents/{DOC}/download")
        assert resp.status_code == 200
        assert resp.json()["url"] == "https://signed.example/abc.pdf?token=t"
        assert captured["path"] == f"{ORG}/{CAND}/abc.pdf"
        assert captured["expires_in"] == 300
    finally:
        app.dependency_overrides.clear()


async def test_download_unknown_document_returns_404(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)  # has a different document id

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}/documents/{uuid.uuid4()}/download")
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_delete_document_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _candidate_with_doc(ACTOR)

    async def fake_remove(path):
        captured["removed"] = path

    async def fake_delete(session, candidate, document_id):
        captured["deleted"] = document_id
        candidate.documents = []
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "delete_document", fake_delete)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    monkeypatch.setattr(storage, "remove", fake_remove)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.delete(f"/candidates/{CAND}/documents/{DOC}")
        assert resp.status_code == 200
        assert resp.json()["documents"] == []
        assert captured["removed"] == f"{ORG}/{CAND}/abc.pdf"
        assert captured["deleted"] == DOC
    finally:
        app.dependency_overrides.clear()


async def test_delete_recruiter_cannot_delete_others(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _candidate_with_doc(OTHER)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.delete(f"/candidates/{CAND}/documents/{DOC}")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/api/test_candidates.py -k "download or delete_document" -q`
Expected: FAIL — routes not defined (404/405).

- [ ] **Step 3: Add the schema**

In `backend/src/callup/api/schemas.py`, after `DocumentOut`:

```python
class DocumentUrlOut(BaseModel):
    url: str
```

- [ ] **Step 4: Implement the routes**

In `backend/src/callup/api/routes/candidates.py`, add `DocumentUrlOut` to the schema imports, then add both routes after `upload_document`:

```python
@router.get(
    "/candidates/{candidate_id}/documents/{document_id}/download",
    response_model=DocumentUrlOut,
)
async def download_document(
    candidate_id: uuid.UUID,
    document_id: uuid.UUID,
    actor: CurrentUser,
    session: SessionDep,
) -> DocumentUrlOut:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    doc = next((d for d in candidate.documents if d.id == document_id), None)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    url = await storage.create_signed_url(doc.storage_path)
    return DocumentUrlOut(url=url)


@router.delete(
    "/candidates/{candidate_id}/documents/{document_id}", response_model=CandidateDetail
)
async def delete_document(
    candidate_id: uuid.UUID,
    document_id: uuid.UUID,
    actor: CurrentUser,
    session: SessionDep,
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    doc = next((d for d in candidate.documents if d.id == document_id), None)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    await storage.remove(doc.storage_path)
    updated = await repositories.delete_document(session, candidate, document_id)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")
```

(The route function is named `delete_document` and so is the repository helper — they live in different modules, no clash. The route calls `repositories.delete_document(...)`.)

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && uv run pytest tests/api/test_candidates.py -k "download or delete_document" -q`
Expected: PASS (4 tests).

- [ ] **Step 6: Regenerate OpenAPI + guard + full fast suite**

Run: `cd backend && uv run python -m callup.openapi_export && uv run pytest -m "not integration" -q`
Expected: `openapi.json` rewritten; full fast suite PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/callup/api/schemas.py backend/src/callup/api/routes/candidates.py \
  backend/tests/api/test_candidates.py backend/openapi.json
git commit -m "feat: download (signed URL) + delete candidate document endpoints"
```

---

## Task 6: Frontend types + multipart client + doc-type helper

**Files:**
- Regenerate: `frontend/packages/shared-types/openapi.d.ts`
- Modify: `frontend/packages/shared-types/index.ts`
- Modify: `frontend/src/lib/http.ts`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/docTypes.ts`

**Interfaces:**
- Produces: `DocumentOut` type alias; `api.upload<T>(path, form, options?)`; `DOC_TYPES` + `docTypeLabel`.

> Frontend has no tests — verify each step with `pnpm tsc --noEmit` and `pnpm lint`.

- [ ] **Step 1: Regenerate shared types from the new contract**

Run: `cd frontend && pnpm gen:types`
Expected: `packages/shared-types/openapi.d.ts` now includes `DocumentOut`, `DocumentUrlOut`, and the new document paths.

- [ ] **Step 2: Add the friendly alias**

In `frontend/packages/shared-types/index.ts`, after the `CandidateDetail` alias (~line 25):

```typescript
/** Backend candidate document (generated). */
export type DocumentOut = components['schemas']['DocumentOut']
```

- [ ] **Step 3: Add the FormData branch to the fetch wrapper**

In `frontend/src/lib/http.ts`, replace the `fetch` call body assembly (lines 42-50) so a `FormData` body is sent as-is with no JSON `Content-Type`:

```typescript
    const isForm = body instanceof FormData
    response = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: controller.signal,
    })
```

- [ ] **Step 4: Add the `upload` method**

In `frontend/src/lib/api.ts`, add to the `api` object (after `delete`, ~line 35):

```typescript
  upload: <T>(path: string, form: FormData, options?: RequestOptions) =>
    send<T>('POST', path, form, options),
```

- [ ] **Step 5: Create the shared doc-type helper**

Create `frontend/src/lib/docTypes.ts`:

```typescript
// The candidate compliance document types (mirrors backend DocumentType). Used by the wizard
// Documents step and the profile Documents editor for the type <select> and badge labels.
export const DOC_TYPES = [
  { value: 'residency_proof', label: 'Residency proof' },
  { value: 'visa_proof', label: 'Visa proof' },
  { value: 'i94', label: 'I-94' },
  { value: 'other', label: 'Other' },
] as const

export function docTypeLabel(value: string): string {
  return DOC_TYPES.find((d) => d.value === value)?.label ?? value
}
```

- [ ] **Step 6: Verify types + lint**

Run: `cd frontend && pnpm tsc --noEmit && pnpm lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/shared-types/openapi.d.ts frontend/packages/shared-types/index.ts \
  frontend/src/lib/http.ts frontend/src/lib/api.ts frontend/src/lib/docTypes.ts
git commit -m "feat: multipart upload client + document types (frontend)"
```

---

## Task 7: Profile Documents editor

**Files:**
- Create: `frontend/src/components/profile/DocumentsEditor.tsx`
- Modify: `frontend/src/pages/CandidateProfile.tsx` (replace the placeholder ~lines 378-382; import)

**Interfaces:**
- Consumes: `api.upload`, `api.get`, `api.delete`; `DocumentOut`, `CandidateDetail`; `DOC_TYPES`, `docTypeLabel`; `Section`.
- Produces: `<DocumentsEditor id candidateId items canEdit onSaved />` — same prop shape as the other section editors.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/profile/DocumentsEditor.tsx`:

```tsx
import { useRef, useState } from 'react'
import type { CandidateDetail, DocumentOut } from '@callup/shared-types'
import { api } from '@/lib/api'
import { DOC_TYPES, docTypeLabel } from '@/lib/docTypes'
import Section from '@/components/profile/Section'
import { Field, inputClass } from '@/components/wizard/Field'

const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg'

export default function DocumentsEditor({
  id,
  candidateId,
  items,
  canEdit,
  onSaved,
}: {
  id: string
  candidateId: string
  items: DocumentOut[]
  canEdit: boolean
  onSaved: (updated: CandidateDetail) => void
}) {
  const [docType, setDocType] = useState<string>('residency_proof')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', docType)
    try {
      const updated = await api.upload<CandidateDetail>(`/candidates/${candidateId}/documents`, form)
      onSaved(updated)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload document')
    } finally {
      setBusy(false)
    }
  }

  async function download(doc: DocumentOut) {
    setError(null)
    try {
      const { url } = await api.get<{ url: string }>(
        `/candidates/${candidateId}/documents/${doc.id}/download`,
      )
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open document')
    }
  }

  async function remove(doc: DocumentOut) {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.delete<CandidateDetail>(
        `/candidates/${candidateId}/documents/${doc.id}`,
      )
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete document')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section id={id} title="Documents">
      {items.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No documents uploaded.</p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] text-foreground">
                  {doc.filename ?? '(unnamed)'}
                </div>
                <span className="text-[11px] text-muted-foreground">{docTypeLabel(doc.doc_type)}</span>
              </div>
              <div className="flex flex-none items-center gap-2">
                <button
                  type="button"
                  onClick={() => download(doc)}
                  className="rounded-[8px] border border-input bg-card px-3 py-1 text-[12.5px] hover:bg-[#f4f4f5]"
                >
                  Download
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(doc)}
                    disabled={busy}
                    className="text-[12.5px] text-destructive hover:underline disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <Field label="Type">
            <select
              className={inputClass}
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              {DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
            className="text-[13px] file:mr-3 file:rounded-[8px] file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-[12.5px] hover:file:bg-[#f4f4f5]"
          />
          {busy && <span className="text-[12.5px] text-muted-foreground">Uploading…</span>}
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
    </Section>
  )
}
```

- [ ] **Step 2: Wire it into the profile**

In `frontend/src/pages/CandidateProfile.tsx`, add the import next to the other section editors (~line 16):

```typescript
import DocumentsEditor from '@/components/profile/DocumentsEditor'
```

Replace the placeholder `<Section id="documents">…</Section>` block (lines 378-382) with:

```tsx
              <DocumentsEditor
                id="documents"
                candidateId={detail.id}
                items={detail.documents}
                canEdit={!editing}
                onSaved={setDetail}
              />
```

- [ ] **Step 3: Verify types + lint**

Run: `cd frontend && pnpm tsc --noEmit && pnpm lint`
Expected: both clean.

- [ ] **Step 4: Manual browser smoke (profile)**

With backend (`:8000`) and frontend (`:5173`) running, open a candidate profile → Documents section: pick a type, choose a PDF → it appears in the list; **Download** opens the file in a new tab; **Delete** removes it. Try a `.txt` (rejected with an error message). Confirm an oversize file (>10 MB) is rejected.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/profile/DocumentsEditor.tsx frontend/src/pages/CandidateProfile.tsx
git commit -m "feat: candidate profile documents section (upload/download/delete)"
```

---

## Task 8: Wizard Documents step (hold, then upload after create)

**Files:**
- Modify: `frontend/src/components/wizard/DocumentsStep.tsx`
- Modify: `frontend/src/pages/AddCandidate.tsx`

**Interfaces:**
- Produces: `StagedDoc = { file: File; docType: string }` (exported from `DocumentsStep`); `<DocumentsStep docs setDocs />`.
- Consumes: `api.upload`; `DOC_TYPES`, `docTypeLabel`.

- [ ] **Step 1: Make the step interactive**

Replace `frontend/src/components/wizard/DocumentsStep.tsx` entirely:

```tsx
import { useRef, useState } from 'react'
import { DOC_TYPES, docTypeLabel } from '@/lib/docTypes'
import { Field, inputClass } from '@/components/wizard/Field'

const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg'

export type StagedDoc = { file: File; docType: string }

export default function DocumentsStep({
  docs,
  setDocs,
}: {
  docs: StagedDoc[]
  setDocs: (docs: StagedDoc[]) => void
}) {
  const [docType, setDocType] = useState<string>('residency_proof')
  const fileRef = useRef<HTMLInputElement>(null)

  function add(file: File) {
    setDocs([...docs, { file, docType }])
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted-foreground">
        Add work-authorization documents (PDF, Word, or image, up to 10&nbsp;MB). They upload when
        you create the candidate — unlike the rest of the form, staged files are not saved in the
        draft, so they won&rsquo;t survive a page refresh.
      </p>

      {docs.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No documents added yet.</p>
      )}
      {docs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {docs.map((d, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px]">{d.file.name}</div>
                <span className="text-[11px] text-muted-foreground">{docTypeLabel(d.docType)}</span>
              </div>
              <button
                type="button"
                onClick={() => setDocs(docs.filter((_, j) => j !== i))}
                className="flex-none text-[12.5px] text-destructive hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <Field label="Type">
          <select className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) add(f)
          }}
          className="text-[13px] file:mr-3 file:rounded-[8px] file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-[12.5px] hover:file:bg-[#f4f4f5]"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Hold staged docs in AddCandidate and upload after create**

In `frontend/src/pages/AddCandidate.tsx`:

Update the import to pull the type:

```typescript
import DocumentsStep, { type StagedDoc } from '@/components/wizard/DocumentsStep'
```

Add staged-docs state next to the other `useState`s (~after line 91):

```typescript
  const [docs, setDocs] = useState<StagedDoc[]>([])
```

Render the step with props (line 203):

```tsx
            {step === 4 && <DocumentsStep docs={docs} setDocs={setDocs} />}
```

Replace `create()` (lines 147-164) so documents upload after the candidate exists:

```typescript
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
      // The candidate now exists; upload staged documents against its id. A failed upload is
      // non-fatal — the candidate is created, so navigate to the profile to finish there.
      let uploadFailed = false
      for (const d of docs) {
        const form = new FormData()
        form.append('file', d.file)
        form.append('doc_type', d.docType)
        try {
          await api.upload<CandidateDetail>(`/candidates/${created.id}/documents`, form)
        } catch {
          uploadFailed = true
        }
      }
      clearDraft()
      navigate(`/candidates/${created.id}`, uploadFailed ? { state: { uploadFailed: true } } : undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create candidate')
    } finally {
      setSubmitting(false)
    }
  }
```

(The `uploadFailed` navigation state is informational only; the profile is the source of truth for which documents actually landed, so no extra handling is required on the profile.)

- [ ] **Step 3: Verify types + lint**

Run: `cd frontend && pnpm tsc --noEmit && pnpm lint`
Expected: both clean.

- [ ] **Step 4: Manual browser smoke (wizard)**

Start the add-candidate wizard → Basics (name + title) → Documents step: stage a PDF (type = Visa proof), stage a second file, remove one → Review → **Create candidate**. Land on the new profile; the staged document(s) appear in the Documents section and download correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/DocumentsStep.tsx frontend/src/pages/AddCandidate.tsx
git commit -m "feat: wizard documents step uploads after candidate creation"
```

---

## Task 9: Reconciliations + final verification

**Files:**
- Modify: `docs/todos.md`

- [ ] **Step 1: Mark the chunk complete in the roadmap**

In `docs/todos.md`, under the Slice 4 progress, mark Chunk 8 (Documents & Storage) complete with a one-line note: backend storage client + upload/download/delete endpoints; profile + wizard document UI; private bucket, signed-URL downloads. (No `docs/database-schema-v1.md` change — the table and its `org_id` are already documented.)

- [ ] **Step 2: Full backend fast suite + contract guard**

Run: `cd backend && uv run pytest -m "not integration" -q`
Expected: PASS, including `test_committed_openapi_is_up_to_date`.

- [ ] **Step 3: Frontend contract-drift + type + lint check**

Run: `cd frontend && pnpm gen:types && git diff --exit-code packages/shared-types/openapi.d.ts && pnpm tsc --noEmit && pnpm lint`
Expected: no diff (types already committed), tsc + lint clean.

- [ ] **Step 4: Integration check (live DB), if credentials available**

Run: `cd backend && uv run pytest tests/db/test_candidates_repo.py -m integration -q`
Expected: PASS (`add_document` / `delete_document` round-trip against Supabase).

- [ ] **Step 5: Commit**

```bash
git add docs/todos.md
git commit -m "docs: mark Slice 4 Chunk 8 (documents & storage) complete"
```

---

## Self-review notes (coverage vs. design)

- Backend proxy upload → Task 4. Hold-then-upload-after-create → Task 8. Compliance-only `doc_type` (no resume) → Global Constraints + `DocumentType` reused unchanged. File types/size → Task 4 (`_ALLOWED_TYPES`, `_MAX_UPLOAD_BYTES`). Private bucket / `{org_id}/{candidate_id}/{uuid}{ext}` path / 300 s TTL → Tasks 1 & 4 & 5. `storage_path` never exposed → `DocumentOut` omits it + asserted in Task 2. Two-sided contract regen → Tasks 2/4/5 (backend) + 6/9 (frontend). No migration → Global Constraints (table/model/enum/relationship pre-exist).
- Status codes are explicit and asserted: 422 (doc_type), 415 (type), 413 (size), 403 (other-recruiter), 404 (cross-org / unknown document).
```
