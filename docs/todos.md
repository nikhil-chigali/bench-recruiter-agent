# Callup — build roadmap

Feature slices in build order. Each is a **walking skeleton**: wired end-to-end and
testable in the browser before the next one starts, then deepened later. The pipeline
this builds toward: fetch & normalize job postings → match bench candidates → generate
truthful tailored documents → assist applications → draft hiring-manager outreach.

Status: ⬜ not started · ▶ in progress · ✅ done

| # | Slice | Delivers (testable on screen) | Status |
|---|-------|-------------------------------|--------|
| 0 | DB schema v1 | 10 base tables live in Supabase | ✅ |
| 1 | Auth + recruiter/org bootstrap | Email login → first sign-in establishes your identity | ✅ |
| 2 | Onboarding + dashboard | First sign-in → onboarding (create org, become owner) → dashboard showing org + your role | ✅ |
| 3 | Team invitations & roles | Owner/admin invite recruiters/admins via shareable link; members management + role-gated permissions | ✅ |
| 4 | Candidate intake | Create / list / view candidates with the full profile (education, experience, certs, projects) | ▶ |
| 5 | Candidate documents | Upload candidate files to Supabase Storage; list them on the candidate | ⬜ |
| 6 | Job postings (manual) | Create / list / view job postings by hand, incl. hiring-side contact | ⬜ |
| 7 | Job ingestion (Dice) | Autonomous worker fetches + normalizes + dedupes Dice postings into the same job list | ⬜ |
| 8 | Matching | Embeddings + similarity + LLM re-rank; ranked candidate↔job matches surfaced in the UI | ⬜ |
| 9 | Document generation | Truthful tailored resume / cover letter, validated against verified candidate facts | ⬜ |
| 10 | Applications | Create application records against a job, track status, application dashboard | ⬜ |
| 11 | Assisted apply session | Playwright worker + live SSE session with the mandatory human-approve-submit step | ⬜ |
| 12 | Outreach | Draft hiring-manager emails (Gmail); sending gated by `OUTREACH_SEND_ENABLED` | ⬜ |

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

Each slice gets its own design spec under `docs/superpowers/specs/` and an
implementation plan before code. Deferred schema pieces (pgvector embeddings, Dice
ingestion fields, fitment scores, normalized contacts, apply-session state machine,
separate outreach record) land as migrations when their slice arrives — see
[`database-schema-v1.md`](./database-schema-v1.md).

## Slice 4 progress (candidate intake — built in chunks)

Slice 4 is large, so it ships as chunks with their own plans under
[`docs/superpowers/plans/`](./superpowers/plans/); the design + full chunk roadmap is in
[`docs/superpowers/specs/2026-06-25-candidates-feature-design.md`](./superpowers/specs/2026-06-25-candidates-feature-design.md).

- ✅ **Chunk 1 — foundation:** `candidate.title` + `candidate.primary_skills` columns (migration
  `12c80bf0e060`), `candidateStatus` util, shared `AppLayout`, `/candidates` route.
- ✅ **Chunk 2 — roster read:** role-scoped `GET /candidates` + the filterable roster (status
  tabs, search, recruiter grouping, list/grid). Filtering is client-side (see follow-up below).
- ✅ **Chunk 2.5 — shared-types pipeline:** `@callup/shared-types` generated from a committed
  `backend/openapi.json` via `openapi-typescript`, with two-sided drift checks.
- ✅ **Chunk 3 — quick-view drawer + status change:** RBAC-guarded `PATCH /candidates/:id` and the
  card → drawer → optimistic status change; "Open full profile" → `/candidates/:id`.
- ✅ **Chunk 4 — full profile view:** RBAC-guarded `GET /candidates/:id` (candidate + experience/
  education/projects/certifications, scoped via the shared `_ensure_access` helper) and the read-only
  `/candidates/:id` profile page (breadcrumb, section nav, header reusing the Chunk-3 status changer,
  composed sections, documents placeholder).
- ✅ **Chunk 5 — add wizard (create):** role-scoped `POST /candidates` (creates the candidate +
  experience/education/projects/certifications in one transaction; assignee resolved server-side —
  recruiter→self, owner/admin→chosen org member or 400, default self) and the 6-step `/candidates/new`
  wizard (localStorage draft autosave, "Save & exit", roster "Add candidate" button + resume-draft
  banner). Documents step is a placeholder (Chunk 8). Both contract artifacts regenerated.
- ✅ **Chunk 6 — profile edit + reassignment:** `PATCH /candidates/:id` generalized to a partial
  `CandidateUpdate` (status + Overview fields name/title/primary_skills/work_authorization/location/
  summary + `user_id` reassignment, owner/admin only and guarded), returning the full `CandidateDetail`;
  profile edit mode (Edit/Cancel/Save, `EDITING` badge, shared `SkillsChipEditor`, owner/admin "Assigned
  to" select). Both contract artifacts regenerated.
- ✅ **Chunk 7 — child section editors:** role-guarded section-replace endpoints
  `PUT /candidates/:id/{experience|education|projects|certifications}` (each takes the full list and
  replaces that section's rows in one transaction via the `delete-orphan` cascade, returning the full
  `CandidateDetail`); the four `…In` schemas expanded to all editable fields (shared with the create
  wizard); per-section profile editors (view ↔ edit, add/remove rows, Save/Cancel) reusing
  `SkillsChipEditor` + a new `StringListEditor`. Both contract artifacts regenerated.
- ✅ **Post-chunk polish (UI + intake completion).** A pass over the shipped chunks: (a) completed the
  add-wizard to **full field coverage** — experience/projects gain highlights + tech stack, education
  gains location/CGPA/coursework/dates, certifications gain issued-on/badge/verification URLs — and
  extended `CandidateCreate` + `create_candidate` with candidate-level
  `linkedin_url`/`github_url`/`portfolio_url`/`summary` so intake matches the schema (both contract
  artifacts regenerated). (b) UI affordances: a sticky Save/Cancel action bar shared across the section
  editors (`EditActions`); status chips show an editable caret + hover while the read-only roster chip
  stays plain; the unsaved-draft banner uses shadcn buttons and names the candidate; and a redesigned
  candidate **not-found / load-error** screen (`CandidateLoadError`) with a full-width header, a status
  indicator, the requested path, and a retry for non-404 failures.
- ✅ **Chunk 8 — documents & storage:** backend Supabase Storage REST client + upload (multipart, 10 MB / PDF·Office·image validation, compliance-only `doc_type`) / download (signed URL, 300 s TTL) / delete endpoints; profile Documents section + wizard Documents step; private bucket, `{org_id}/{candidate_id}/{uuid}{ext}` path, `storage_path` never exposed in `DocumentOut`. Both contract artifacts regenerated.

## Follow-ups (tech debt, not slice-blocking)

Carried out of completed slices; fold into a later slice when convenient.

- **Integration test transaction-rollback fixture.** DB integration tests (e.g.
  `create_owned_org`) currently create rows in the live Supabase DB and clean up in
  a `finally` block — a failed assertion mid-test can orphan rows (it did once, leaving
  a circular-FK'd org+recruiter that had to be deleted by hand). Add a shared
  session-fixture that runs each integration test inside a transaction and rolls back,
  so nothing ever persists. When it lands, also restore the stronger idempotency
  assertion (`second.name == "Jane"`) dropped in slice 2. (From slice 1/2.)
- ~~**`create_candidate` real-persistence coverage.** Chunk 5's six `POST /candidates` tests
  all monkeypatch `repositories.create_candidate`, so the fast suite never exercises the actual
  child INSERTs, `org_id` propagation, the pre-commit PK capture, or the `get_candidate_detail`
  re-fetch.~~ **DONE (Candidates chunk 5 final-review follow-up).** Added
  `tests/db/test_candidates_repo.py::test_create_candidate_persists_graph_and_reloads_detail`
  (`@pytest.mark.integration`): seeds an org+owner, calls the real `create_candidate`, then re-fetches
  in a fresh session and asserts the candidate + every child carry `org_id`, `status == on_bench`, and
  the detail is fully populated; cleans up in `finally` (children cascade on candidate delete). Also
  added the three fast-suite asserts the review flagged to `tests/api/test_candidates.py`
  (owner-defaults-to-self; blank-`name` → 422; invalid-`work_authorization` → 422). **Caveat:** like the
  other DB integration tests, it still writes to live Supabase and cleans up in a `finally` — it should
  migrate onto the transaction-rollback fixture above once that lands. (Slice 4 — Candidates chunk 5.)
- **Onboarding/profile sign-out robustness.** In `frontend/src/lib/profile.tsx`, set
  `loading:false` directly on the 401 branch (don't rely on the session-null effect),
  and handle a `signOut()` rejection so a failed sign-out can't strand the user on the
  retry screen with a stale session. (Slice 2.)
- ~~**Cold-load deep-link bounce.** Cold-loading any protected deep link
  (`/candidates/:id`, `/candidates`, `/`, `/accept-invite`) bounced to the dashboard and
  lost the URL.~~ **FIXED (commit `d1138cb`, found during chunk 4 smoke test.)** Root cause:
  `ProfileProvider` acted on the transiently-null session during Supabase's cold-load
  session restore, flipping `loading→false`, so `RequireOnboarded` redirected to
  `/onboarding` (then on to `/`) before the `/me` fetch even started. Fix gates the
  profile-load effect on `auth.loading` so it waits for the initial auth resolution
  instead of reacting to the transient null. Related to the profile-robustness item
  above. (Slice 4 — Candidates chunk 4 smoke test.)
- **201 happy-path route test for `POST /orgs`** with a fake session that returns the
  org on backfill (success path is currently only covered via the `create_owned_org`
  integration test). (Slice 2.)
- **Frontend 401 handling.** `ProfileProvider` now signs out on a 401 from `/me`
  (slice 2). Still pending: make this *global* in the `api` client so any 401 from any
  endpoint redirects to `/login`, not just the profile fetch. (Slice 1/2.)
- **Repository unit-of-work.** Move the `commit()` out of `create_owned_org` to the
  request boundary once a route performs multiple writes. (Slice 1/2.)
- ~~**Generate `packages/shared-types`** from the backend OpenAPI schema instead of
  hand-declaring response types on the frontend.~~ **DONE in Candidates Chunk 2.5** — pnpm
  workspace + `openapi-typescript` generating `@callup/shared-types` from a committed
  `backend/openapi.json`, with two-sided drift checks (backend pytest + frontend CI) and all
  hand-declared backend shapes (`CandidateCard`, `Member`, invitation types, `User`, `Me`)
  migrated. (Slice 1 → Slice 4 chunk 2.5.)
- **Shared-types drift loop assumes both CI workflows stay un-path-filtered.** The
  backend→`openapi.json`→`openapi.d.ts` drift loop is airtight *only because* neither
  `backend-ci.yml` nor `frontend-ci.yml` is path-filtered, so every PR runs both guards. Both
  files note a possible future "path-filter upgrade." If `frontend-ci.yml` is ever filtered to
  `frontend/**`, a backend-only PR that regenerates `backend/openapi.json` would skip the
  frontend drift step and let a stale `openapi.d.ts` merge. If that upgrade is made, the
  frontend workflow's trigger paths MUST also include `backend/openapi.json`. (Slice 4 chunk 2.5.)
- **Harden the conftest `.env` mini-parser** (quoted values / inline comments) if the
  backend `.env` ever needs them. (Slice 1.)
- **Partial unique index on invitations.** Add `unique(org_id, email) WHERE status =
  'pending'` in a migration so "one pending invite per email per org" and the
  concurrent-accept guard are enforced at the DB, not just in application logic. Today
  `create_invitation` revokes-then-inserts (a benign TOCTOU under concurrency) and the
  accept race is handled by catching `IntegrityError` → 409. (Slice 3.)
- **CORS-on-500 surfacing.** Unhandled exceptions return a 500 without CORS headers, so the
  browser sees a misleading "Failed to fetch" instead of the real status — this masked the
  remove-member FK bug during slice-3 testing. Apply CORS headers to error responses (an
  exception handler / middleware) so 500s reach the SPA as real errors. The FK fix removed
  *this* slice's 500, but the masking remains for the next one. (Slice 3 hardening.)
- **Orphaned auth-account reconciliation.** Remove-member and delete-org delete the
  Supabase auth user best-effort: the DB rows are deleted first (transactional) and a failed
  Auth Admin delete is logged, not retried — so a network/5xx blip can leave an orphaned
  `auth.users` row. No reconciliation/cleanup job exists. (Slice 3 hardening.)
- **Profile-less auth users from abandoned signup.** `signUp` creates the `auth.users`
  row immediately (email confirmations off), but a `users` row only lands on onboarding
  (`POST /orgs`) or invite accept — so abandoning onboarding leaves an auth user with no
  profile. The onboarding screen now offers an explicit **Sign out** link, so this is a
  supported exit, not just a back-button accident — which makes profile-less accounts a
  normal, one-click outcome. It stays *recoverable*, not a dead-end: `Login.onSubmit` falls
  back to sign-in when signup reports the email already exists, letting the user resume. We
  deliberately do **not** sweep these accounts (they're harmless — `get_current_user` 403s
  everything but `/me`, `POST /orgs`, and invite-accept). Add a cleanup sweep only if they
  accumulate. (Slice 3 hardening.)
- **Unique token hashes in the member-repo integration test.**
  `tests/db/test_members_repo.py` seeds invitations with hardcoded token-hash strings
  (`"th-accept"`, `"th-sent"`); the `invitation.token_hash` unique constraint means parallel
  integration runs against the shared DB would collide. Use `uuid4().hex`. (Slice 3 hardening.)
- **Drawer can show a stale candidate after a roster refetch.** In `Candidates.tsx`, the
  quick-view drawer's `selected` candidate is a snapshot. If the roster's `useEffect` refetches
  and repopulates `candidates` while the drawer is open (e.g. an `isManager` flip or remount),
  `selected` isn't reconciled against the new array, so the open drawer could show pre-refetch
  data. Reconcile `selected` against the refreshed list (or re-fetch the single candidate) when
  the full profile fetch lands. **Still open** — chunk 4 was read-only and didn't touch the
  drawer, so this wasn't addressed there; fold into a later chunk that reworks the roster/drawer
  (e.g. chunk 6 edit, or server-side filtering below). (Slice 4 — Candidates chunk 3.)
- **Child-editor polish (chunk 7).** Two small deferred items from the chunk-7 final review:
  (1) `EducationEditor` — and now the add-wizard `EducationStep` / `toPayload` — send `cgpa: Number(...)`,
  so a non-numeric value becomes `NaN` → serialized to `null` (silently dropped rather than flagged);
  mitigated today by the `<input type="number">`, but a `Number.isNaN` guard would be stricter. (2) The section-replace validation/RBAC tests are
  representative, not exhaustive — 403 is asserted on experience, 404 on projects, 422 on experience
  only; a couple of parametrized cases would cover education/projects/certifications' required-key and
  date-order validators (the guard/validator code is shared, so risk is low). (Slice 4 — Candidates chunk 7.)
- **Reassign select is blank if `/members` fails to load.** On the profile edit mode
  (`CandidateProfile.tsx`), an owner/admin's "Assigned to" select is populated from `GET /members`;
  if that fetch fails the list is empty and the select renders blank. Verified safe — `draft.user_id`
  stays equal to `detail.recruiter_id`, so `save()` never sends `user_id` and no accidental reassignment
  happens — but the UX is poor. Add a "couldn't load members" hint (and/or seed the current assignee as a
  fallback option). (Slice 4 — Candidates chunk 6.)
- **Server-side candidate filtering + pagination.** The candidates roster (Candidates
  chunk 2) returns the full role-scoped bench and does status/search/recruiter filtering,
  counts, and grouping **client-side** — fine for small benches but doesn't scale (whole-org
  payload, no pagination). Move those filters server-side as `GET /candidates` query params
  and add pagination once benches grow. Authorization/scoping is already server-side; this
  is a perf/scale change, not security. (Slice 4 — Candidates chunk 2.)
