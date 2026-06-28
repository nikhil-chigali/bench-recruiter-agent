# Chunk 8 — Candidate Documents & Storage (design)

Detailed design for the final candidates-feature chunk. This elaborates the high-level
Chunk 8 entry in [`2026-06-25-candidates-feature-design.md`](./2026-06-25-candidates-feature-design.md);
that document remains the source of truth for the surrounding feature. Built last because it
is the heaviest, most isolated infra (Supabase Storage).

## Goal

Upload, list, download, and delete a candidate's **compliance documents** (work-authorization
proof) from both the add-candidate wizard and the profile Documents section.

## Scope decisions (settled in brainstorming)

- **Upload path: backend proxy.** The browser POSTs the file to FastAPI; the backend validates
  type/size, uploads to Storage with the service key, then writes the `candidate_document` row.
  One request, the service key never leaves the backend, and validation is authoritative
  server-side. Candidate docs are small, so proxying bytes through Railway is a non-issue. (Not
  signed direct-upload — that is two-phase with orphan risk and weaker server-side validation.)
- **Wizard documents: hold, then upload after create.** The wizard's Documents step (index 4)
  precedes candidate creation at Review (index 5). Chosen files are held in React state lifted
  into `AddCandidate`, **deliberately not in the localStorage draft** (`File` objects can't be
  serialized). On create: `POST /candidates` first, then upload the held files to the new id,
  then navigate. Caveat surfaced in the UI: staged documents do not survive a page refresh
  (the rest of the draft does).
- **Document types: compliance only.** `doc_type ∈ {residency_proof, visa_proof, i94, other}`
  (the existing `DocumentType` enum). **No resume** — the profile itself is the master resume,
  and resume parsing is explicitly out of scope at this stage. Tailored resumes are generated
  per-application and stored separately on `application.resume_storage_path`; they are not
  `candidate_document` rows.
- **File constraints:** allow `pdf`, `doc`, `docx`, `png`, `jpg`/`jpeg`; reject everything
  else; **10 MB** max.
- **Bucket privacy / path / TTL:** the bucket stays **private** (proof docs are sensitive;
  backend service-key access only — no public/RLS read yet). Object path is
  `{org_id}/{candidate_id}/{uuid}{ext}` (org-prefixed so a future RLS path policy is trivial);
  the original filename is kept in the `filename` column. Downloads use a **signed URL with a
  300 s TTL**.

## What already exists (no work needed)

Discovered during exploration — these were scaffolded in the initial schema:

- Table `candidate_document` + indexes — in migration `161a7bd63439`. **No new migration.**
- `CandidateDocument` model and the `Candidate.documents` relationship with
  `cascade="all, delete-orphan"` — `src/callup/db/models/candidate.py`.
- `DocumentType` enum (`residency_proof / visa_proof / i94 / other`) — `src/callup/db/enums.py`.
- Storage config — `src/callup/config.py`: `supabase_url`, `supabase_service_key`,
  `storage_bucket = "candidate-files"`; accessor `secrets.supabase_service_key()`.

Chunk 8 is therefore pure wiring: a storage client, three endpoints, schemas, the two frontend
surfaces, and contract/test updates.

## Architecture

### Backend

**Storage client — new `src/callup/services/storage.py`.** A thin `httpx` wrapper over the
Supabase Storage REST API (no new runtime dep — `httpx` is already present). The only consumer
of `secrets.supabase_service_key()` + `settings.supabase_url` + `settings.storage_bucket`.
Functions:

- `async upload(path: str, content: bytes, content_type: str) -> None`
- `async create_signed_url(path: str, expires_in: int = 300) -> str`
- `async remove(path: str) -> None`

**Endpoints — added to `src/callup/api/routes/candidates.py`** (mirroring the chunk-7
child-section convention). Every handler runs the established gate first:
`get_candidate_detail(session, id, actor.org_id)` → 404 on cross-org (org-scoped fetch returns
`None`), then `_ensure_access(actor, candidate)` → 403 for a recruiter touching another
recruiter's candidate.

- **`POST /candidates/{candidate_id}/documents`** — `multipart/form-data` with
  `file: UploadFile` and `doc_type: str = Form(...)`. Validates: `doc_type` against
  `DocumentType`, content-type/extension against the allowed set, and byte length ≤ 10 MB.
  Computes the object path, calls `storage.upload`, inserts the row, returns the full
  **`CandidateDetail`** (the same "return whole detail" idiom the section editors consume via
  `onSaved(setDetail)`). Requires the one new dependency, `python-multipart` (FastAPI mandates
  it for `UploadFile`/`Form`).
- **`GET /candidates/{candidate_id}/documents/{document_id}/download`** — returns
  `{ "url": "<signed url>" }` (TTL 300 s). JSON, not a 3xx redirect, so the authenticated SPA
  controls navigation. 404 if the document is not on this candidate.
- **`DELETE /candidates/{candidate_id}/documents/{document_id}`** — best-effort
  `storage.remove` of the object, delete the DB row, return the updated `CandidateDetail`.

**Reads.** Add `selectinload(Candidate.documents)` to `get_candidate_detail`
(`src/callup/db/repositories.py`), a `DocumentOut` Pydantic schema
(`src/callup/api/schemas.py`), and a `documents: list[DocumentOut]` block to the router's
`_detail(...)` mapper — so documents arrive as part of the existing profile fetch; no separate
list endpoint. New repository helpers: `add_document`, `delete_document`, and a `get_document`
(scoped to candidate) for download/delete lookups.

`DocumentOut` fields: `id`, `doc_type`, `filename`, `created_at` (the storage_path is internal —
not exposed; downloads always go through the signed-URL endpoint).

### Frontend

**API client.** `src/lib/http.ts` hardcodes JSON today. Add a multipart branch: when
`body instanceof FormData`, do **not** set `Content-Type` (the browser sets the boundary) and do
**not** `JSON.stringify`. Expose `api.upload<T>(path, formData)` in `src/lib/api.ts` (auth header
still attached). The download endpoint returns JSON `{url}`, so plain `api.get` works, then
`window.open(url)`.

**Wizard.** `src/components/wizard/DocumentsStep.tsx` becomes interactive: a file input + a
`doc_type` select per staged file, listing what will be uploaded. Staged `File`s live in state
lifted into `src/pages/AddCandidate.tsx` (a new `useState`, separate from `draft` — not
persisted). `create()` changes to: `POST /candidates` → for each staged file, `api.upload` to
`/candidates/{created.id}/documents` → `clearDraft()` → navigate. The step shows a "not saved in
draft" note.

**Profile.** New `src/components/profile/DocumentsEditor.tsx` mirroring the existing section
editors (`ExperienceEditor` et al.): a list of rows (filename, `doc_type` badge, Download,
Delete) plus an upload control (file input + `doc_type` select). Upload and delete return
`CandidateDetail` → `onSaved(setDetail)`; download calls the download endpoint and opens the
signed URL. Replaces the placeholder at `src/pages/CandidateProfile.tsx:378`.

**Shared types.** Add a `DocumentOut` alias in `packages/shared-types/index.ts` after
regeneration.

## Contracts

Both committed artifacts must be regenerated (the two-sided drift loop):

1. `uv run python -m callup.openapi_export` (from `backend/`) → updates `backend/openapi.json`
   (guarded by `tests/test_openapi_export.py::test_committed_openapi_is_up_to_date`).
2. `pnpm gen:types` (from `frontend/`) → updates `packages/shared-types/openapi.d.ts` (guarded
   by the frontend-CI `git diff --exit-code`).

## Testing

- **Backend (fast, no network):** mirror the chunk-7 cases in `tests/api/test_candidates.py`
  using `app.dependency_overrides` + `monkeypatch` (the suite's existing idiom, no fixtures):
  upload success, delete success, download returns a URL; 403 for a recruiter on another's
  candidate; 404 cross-org; and validation failures — invalid `doc_type`, disallowed
  content-type, oversize (>10 MB). The storage client is monkeypatched at the boundary so no
  bytes leave the test.
- **Storage client:** a small unit test asserting it builds the correct REST request
  (URL/bucket/path/headers) against a mocked `httpx` transport.
- **Frontend:** `pnpm tsc --noEmit` + `pnpm lint` clean; smoke-test upload→list→download→delete
  on the profile and the wizard hold-then-upload flow in the browser.

## Reconciliations

- `docs/database-schema-v1.md`: no change — the table and its `org_id` are already documented.
- `docs/todos.md`: mark Slice 4 Chunk 8 complete.

## Out of scope

Resume upload/parsing; signed direct-to-Storage uploads; RLS policies on the bucket
(backend-service-key access only for now); document preview/thumbnailing; versioning.
