# Callup — Database Schema v1 (skeleton)

Working ERD for the walking-skeleton scope. The matching pipeline (embeddings, fitment
scores, Dice ingestion metadata, a normalized hiring-contact table, the apply-session
state machine, and a separate outreach record) is intentionally **deferred** and will be
added by later migrations as those phases land.

Status: **locked (v1)** — implemented in Alembic migration `161a7bd63439` and applied to Supabase.
The entity table was later renamed `recruiter` → `users` by migration `b1d2e3f40512` (the
`recruiter` *role* value is unchanged); this ERD reflects the current `users` naming.

## ERD

```mermaid
erDiagram
    ORG ||--o{ USERS : employs
    USERS ||--o{ CANDIDATE : manages
    CANDIDATE ||--o{ CANDIDATE_EDUCATION : has
    CANDIDATE ||--o{ CANDIDATE_EXPERIENCE : has
    CANDIDATE ||--o{ CANDIDATE_CERTIFICATION : has
    CANDIDATE ||--o{ CANDIDATE_PROJECT : has
    CANDIDATE ||--o{ CANDIDATE_DOCUMENT : has
    CANDIDATE ||--o{ APPLICATION : "applies via"
    JOB_POSTING ||--o{ APPLICATION : "targeted by"

    ORG {
        uuid id PK
        text name
        uuid owner_user_id FK "the org owner"
        timestamptz created_at
        timestamptz updated_at
    }
    USERS {
        uuid id PK "= Supabase auth user id"
        uuid org_id FK
        text role "owner | admin | recruiter"
        text name
        text email UK
        timestamptz created_at
        timestamptz updated_at
    }
    CANDIDATE {
        uuid id PK
        uuid org_id FK
        uuid user_id FK
        text name
        text email
        text phone
        text location
        text linkedin_url
        text github_url
        text portfolio_url
        jsonb other_urls
        text work_authorization "see enums"
        text summary
        text status "see enums"
        text title
        jsonb primary_skills "string[]"
        timestamptz created_at
        timestamptz updated_at
    }
    CANDIDATE_EDUCATION {
        uuid id PK
        uuid candidate_id FK
        text university
        text location
        text degree
        numeric cgpa
        text coursework
        date start_date
        date end_date
    }
    CANDIDATE_EXPERIENCE {
        uuid id PK
        uuid candidate_id FK
        text company
        text position
        date start_date
        date end_date
        jsonb description "string[] of bullets"
        jsonb tech_stack "string[]"
    }
    CANDIDATE_CERTIFICATION {
        uuid id PK
        uuid candidate_id FK
        text name
        text issued_by
        text badge_url
        date issued_on
        text verification_url
    }
    CANDIDATE_PROJECT {
        uuid id PK
        uuid candidate_id FK
        text title
        text project_link
        text github_link
        jsonb description "string[] of bullets"
        jsonb tech_stack "string[]"
    }
    CANDIDATE_DOCUMENT {
        uuid id PK
        uuid candidate_id FK
        text doc_type "see enums"
        text storage_path "Supabase Storage"
        text filename
        timestamptz uploaded_at
    }
    JOB_POSTING {
        uuid id PK
        uuid org_id FK
        text title
        text description
        text location
        text work_authorization "required/accepted"
        date posted_date
        text employment_type "see enums"
        text company "hiring company"
        text contact_name "job-posting recruiter"
        text contact_email "outreach recipient"
        text contact_company "agency/firm, nullable"
        timestamptz created_at
        timestamptz updated_at
    }
    APPLICATION {
        uuid id PK
        uuid org_id FK
        uuid candidate_id FK
        uuid job_posting_id FK
        text status "see enums"
        timestamptz applied_on
        text submitted_by "agent | human"
        text outreach_email_status "sent | not_sent"
        text outreach_email_body
        text resume_storage_path "Supabase Storage"
        timestamptz created_at
        timestamptz updated_at
    }
```

## Enumerations

- **users.role:** `owner`, `admin`, `recruiter`.
- **candidate.work_authorization / job_posting.work_authorization:**
  `USC` (US citizen), `GC` (green card), `GC_EAD`, `H1B`, `OPT`, `STEM_OPT`, `L2_EAD`,
  `TN`, `OTHER`. On a candidate it states their status; on a posting it states the
  required/accepted authorization.
- **candidate.status:** `on_bench`, `interviewing`, `placed` (display: "On bench",
  "Interviewing", "Placed"). The candidate's bench pipeline stage; defaults to `on_bench`.
- **job_posting.employment_type:** `CONTRACT_C2C`, `CONTRACT_W2`, `FULL_TIME`.
- **application.status:** `draft`, `applied`, `emailed`, `closed` (terminal: rejected /
  filled / withdrawn / gone cold).
- **application.submitted_by:** `agent`, `human`.
- **application.outreach_email_status:** `sent`, `not_sent`.
- **candidate_document.doc_type:** `residency_proof`, `visa_proof`, `i94`, `other`.

## Notes & conventions

- **Candidate headline fields:** `title` (role headline) and `primary_skills` (a
  `string[]`) are recruiter-curated. `years_experience` is **not** a column — it is derived
  on read from `candidate_experience` date ranges (null end = present).
- **Tenancy:** `org_id` on every business table marks the owning organization (the
  data-isolation boundary). MVP is single-org; multi-recruiter is later enabled via RLS +
  middleware, never a column-shape migration. Distinct from `user_id`, which is
  candidate ownership within an org.
- **Org & roles:** `org_id` is a FK to `ORG`. `users.role` (`owner | admin |
  recruiter`) and `org.owner_user_id` model who administers the org. Role-gated team
  management — invitations, role changes, member removal, ownership transfer, and org
  deletion — shipped in slice 3 (the `INVITATION` table was added by migration
  `e3546d70251d`; it is not drawn in this v1 ERD). Owner/admin can reassign a candidate to
  another org member via `PATCH /candidates/:id` (slice 4 — candidates chunk 6). Still future
  scope: org-level stats.
- **User ↔ auth-user lifecycle:** `users.id` *is* the Supabase auth user id, so
  the two are deleted together. Removing a member (and deleting an org, which cascades to all
  its members) also deletes the corresponding `auth.users` row via the Supabase Auth Admin
  API — best-effort, after the DB delete commits (see [`todos.md`](./todos.md) for the
  orphan-reconciliation follow-up).
- **One recruiter per candidate** for now; a candidate shared across recruiters is a
  future change (would become a join table).
- **Job-posting contact** = the *hiring-side* recruiter the BSR emails outreach to — not
  the bench-sales recruiter. Stored as columns on `job_posting` for the skeleton; may be
  normalized into a contacts table when outreach/enrichment get real.
- **Files in Storage:** tailored resumes and candidate documents live in a Supabase
  Storage bucket; the DB keeps only `*_storage_path` pointers.
- **Application uniqueness:** `unique(candidate_id, job_posting_id)` — a candidate is not
  applied to the same posting twice (re-apply policy default: never).
- All tables carry `created_at` / `updated_at`.

## Deferred to later phases

Candidate `profile_vector` + job `embedding` (pgvector); Dice ingestion fields (`source`,
`external_id`, `content_hash`, `apply_type`, `first_seen`/`last_seen`, `url`); fitment
score (LLM re-rank output); normalized hiring-contact table; apply-session state machine;
separate outreach record (to/cc/subject/sent_at).
