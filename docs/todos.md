# Callup — build roadmap

Feature slices in build order. Each is a **walking skeleton**: wired end-to-end and
testable in the browser before the next one starts, then deepened later. The pipeline
this builds toward: fetch & normalize job postings → match bench candidates → generate
truthful tailored documents → assist applications → draft hiring-manager outreach.

Status: ⬜ not started · ▶ in progress · ✅ done

| # | Slice | Delivers (testable on screen) | Status |
|---|-------|-------------------------------|--------|
| 0 | DB schema v1 | 10 base tables live in Supabase | ✅ |
| 1 | **Auth + recruiter/org bootstrap** | Email login → protected home greets you, shows your org; first sign-in provisions your `recruiter` + owned `org` | ✅ |
| 2 | Candidate intake | Create / list / view candidates with the full profile (education, experience, certs, projects) | ▶ |
| 3 | Candidate documents | Upload candidate files to Supabase Storage; list them on the candidate | ⬜ |
| 4 | Job postings (manual) | Create / list / view job postings by hand, incl. hiring-side contact | ⬜ |
| 5 | Job ingestion (Dice) | Autonomous worker fetches + normalizes + dedupes Dice postings into the same job list | ⬜ |
| 6 | Matching | Embeddings + similarity + LLM re-rank; ranked candidate↔job matches surfaced in the UI | ⬜ |
| 7 | Document generation | Truthful tailored resume / cover letter, validated against verified candidate facts | ⬜ |
| 8 | Applications | Create application records against a job, track status, application dashboard | ⬜ |
| 9 | Assisted apply session | Playwright worker + live SSE session with the mandatory human-approve-submit step | ⬜ |
| 10 | Outreach | Draft hiring-manager emails (Gmail); sending gated by `OUTREACH_SEND_ENABLED` | ⬜ |

## Notes on ordering

- **Auth first (1)** so every later row has a real `recruiter_id` / `org_id` — no
  seeded dev identity to rip out later.
- **Manual job postings (4) before Dice ingestion (5):** prove the job model + UI by
  hand, then make the worker just another writer into the same tables.
- **Matching (6) needs candidates + jobs (2, 4/5)** to have anything to rank.
- **Generation (7) before applications (8):** an application attaches a generated,
  fact-checked resume.
- **Assisted apply (9)** is the most complex (browser worker + SSE + human-in-loop);
  it comes after the documents it submits exist.
- **Outreach (10)** last; send stays behind the `OUTREACH_SEND_ENABLED` gate.

Each slice gets its own design spec under `docs/superpowers/specs/` and an
implementation plan before code. Deferred schema pieces (pgvector embeddings, Dice
ingestion fields, fitment scores, normalized contacts, apply-session state machine,
separate outreach record) land as migrations when their slice arrives — see
[`database-schema-v1.md`](./database-schema-v1.md).
