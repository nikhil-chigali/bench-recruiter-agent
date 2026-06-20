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
| 3 | Team invitations & roles | Owner/admin invite recruiters/admins via shareable link; members management + role-gated permissions | ▶ |
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
  `provision_recruiter`) currently create rows in the live Supabase DB and clean up in
  a `finally` block — a failed assertion mid-test can orphan rows (it did once, leaving
  a circular-FK'd org+recruiter that had to be deleted by hand). Add a shared
  session-fixture that runs each integration test inside a transaction and rolls back,
  so nothing ever persists. (From slice 1.)
- **Frontend 401 handling.** `ProfileProvider` now signs out on a 401 from `/me`
  (slice 2). Still pending: make this *global* in the `api` client so any 401 from any
  endpoint redirects to `/login`, not just the profile fetch. (Slice 1/2.)
- **Repository unit-of-work.** Move the `commit()` out of `create_owned_org` to the
  request boundary once a route performs multiple writes. (Slice 1/2.)
- **Generate `packages/shared-types`** from the backend OpenAPI schema instead of
  hand-declaring response types (e.g. `Me`) on the frontend. (Slice 1.)
- **Harden the conftest `.env` mini-parser** (quoted values / inline comments) if the
  backend `.env` ever needs them. (Slice 1.)
