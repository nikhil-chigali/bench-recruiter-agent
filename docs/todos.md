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
| 4 | Candidate intake | Create / list / view candidates with the full profile (education, experience, certs, projects) | ⬜ |
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

## Follow-ups (tech debt, not slice-blocking)

Carried out of completed slices; fold into a later slice when convenient.

- **Integration test transaction-rollback fixture.** DB integration tests (e.g.
  `create_owned_org`) currently create rows in the live Supabase DB and clean up in
  a `finally` block — a failed assertion mid-test can orphan rows (it did once, leaving
  a circular-FK'd org+recruiter that had to be deleted by hand). Add a shared
  session-fixture that runs each integration test inside a transaction and rolls back,
  so nothing ever persists. When it lands, also restore the stronger idempotency
  assertion (`second.name == "Jane"`) dropped in slice 2. (From slice 1/2.)
- **Onboarding/profile sign-out robustness.** In `frontend/src/lib/profile.tsx`, set
  `loading:false` directly on the 401 branch (don't rely on the session-null effect),
  and handle a `signOut()` rejection so a failed sign-out can't strand the user on the
  retry screen with a stale session. (Slice 2.)
- **201 happy-path route test for `POST /orgs`** with a fake session that returns the
  org on backfill (success path is currently only covered via the `create_owned_org`
  integration test). (Slice 2.)
- **Frontend 401 handling.** `ProfileProvider` now signs out on a 401 from `/me`
  (slice 2). Still pending: make this *global* in the `api` client so any 401 from any
  endpoint redirects to `/login`, not just the profile fetch. (Slice 1/2.)
- **Repository unit-of-work.** Move the `commit()` out of `create_owned_org` to the
  request boundary once a route performs multiple writes. (Slice 1/2.)
- **Generate `packages/shared-types`** from the backend OpenAPI schema instead of
  hand-declaring response types (e.g. `Me`) on the frontend. (Slice 1.)
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
