# Candidates feature — design (Slice 4)

Date: 2026-06-25
Status: approved — chunked roadmap; each chunk gets its own implementation plan

The fourth feature slice and the first real product surface beyond org/team management.
It lights up the `Candidates` nav item (currently a `SOON` placeholder) and delivers the
full candidate management experience: a filterable roster, a quick-view drawer, a full
profile (view + edit), and a six-step add wizard — all role-aware.

This is a **large** slice. It is delivered as a sequence of **chunks** (a thin foundation,
then vertical feature slices). Each chunk is independently plannable, ends in a demoable
end-to-end capability, and gets its **own** implementation plan written when it is picked
up. This document is the shared reference all of those plans draw from.

## Source design

The hi-fi mockup is the claude.ai/design project `Callup Candidates Hi-Fi.dc.html`
(project id `433f7a3d-d935-4c7c-9e31-ba0fe2902a35`). It is a single component with a
`screen` state machine (`roster | profile | add`), a quick-view drawer overlay, and a
mockup-only "review toolbar" used to switch screens and viewer-role. The review toolbar is
**not** application UI and is dropped. Sample data (Northstar Staffing, Priya/Sam, the ten
candidates) is illustrative only.

## Foundational decisions (locked)

1. **Headline fields.** Add `title` and `primary_skills` as real columns on `candidate`
   (recruiter-curated, captured in wizard step 1). **Derive** `years_experience` on read
   from `candidate_experience` start/end dates (a null end date = present). The mockup's
   free-text experience dates ("2021 – Present") become **structured start/end date
   inputs**, since the derived years depend on real dates.
2. **Documents are in v1.** Real Supabase Storage upload, file-type/size validation, signed
   download URLs, and `candidate_document` CRUD. (Heaviest, most isolated infra → built
   last; see chunk 8.)
3. **Reassignment is in v1.** Owner/admin group the bench by recruiter and reassign via
   `candidate.user_id` (already a column — no migration). Reconcile the "future scope" note
   in `docs/database-schema-v1.md`.
4. **Drafts are localStorage.** The add-wizard draft and the roster resume-draft banner are
   browser-local (`callup_candidate_draft`). No draft backend in v1.
5. **Full child editing in v1.** Experience, education, projects, and certifications get
   per-section add/edit/delete editors on the profile, plus their backend CRUD.

## Goal

A recruiter opens `Candidates` and sees the bench they're allowed to see, filtered by
status / recruiter / search, in list or grid. They open a candidate for a quick view,
change status inline, open the full profile, edit it, manage its child records, and add new
candidates through a guided wizard — all enforcing org tenancy and role permissions.

**Testable on screen (whole slice):** sign in → `Candidates` nav active → roster shows
real candidates scoped to role → filter/search works → click a candidate → drawer →
change status (persists) → open profile → edit Overview + reassign (owner/admin) → add/edit
child records → upload a document (downloads via signed URL) → add a new candidate through
the wizard (draft survives refresh) → it appears on the roster.

## Scope

**In:** everything in the four surfaces below, role-scoped, backed by a new candidate API
(slice 4 — none exists today). The `candidate` schema additions. A shared app layout
extracted so Team and Candidates share one shell.

**Out (later slices):** matching/fitment, job postings, applications, outreach, the apply
session, Dice ingestion, candidate embeddings, server-persisted drafts, cross-org sharing,
bulk import, candidate delete/archive (not in the mockup — add later if needed).

## The four surfaces

### Roster (`/candidates`)
Shared sidebar shell + header (title, role-dependent subtitle, search by name/title/skill,
"Add candidate"). Controls row: status segmented control (All / On bench / Interviewing /
Placed) with live counts and colored dots; recruiter filter dropdown (owner/admin only);
list/grid view toggle. Resume-draft banner when a local draft exists. Results **group by
recruiter** for owner/admin when no recruiter filter is set, otherwise flat. List rows and
grid cards show avatar, name · title, skill chips (+overflow), work auth, years, location,
status pill. Empty state.

### Quick-view drawer (overlay on roster)
Right-side panel: avatar, name, title, **inline status changer** (pill → dropdown), primary
skills, work auth / experience / location, assigned recruiter, "Open full profile".

### Full profile (`/candidates/:id`)
Breadcrumb top bar (← Candidates / name; `EDITING` badge in edit mode; Edit vs
Cancel/Save). Left section nav (Overview / Experience / Education / Projects /
Certifications / Documents). **View mode:** header card (avatar, name, title, work-auth /
years / location chips, status changer, recruiter line), summary + skills + links card,
experience card, education card, projects/certs/documents card. **Edit mode:** Overview
fields inline (name, title, skills chips, work auth, years*, location, summary, assigned
recruiter for owner/admin). Child sections are managed by their own per-section editors
(chunk 7) / the documents section (chunk 8). *Years is derived/read-only on the profile;
it reflects experience entries.

### Add wizard (`/candidates/new`)
Breadcrumb top bar (Candidates / New candidate, "Draft saved", "Save & exit"). Left stepper
(6 steps) + progress bar. Steps: 1 Basics (name*, title*, skills, work auth, years,
location, email, phone), 2 Experience (repeatable: company, position, **start/end dates**),
3 Education (repeatable: university, degree), 4 Projects & certifications (repeatable
rows), 5 Documents (upload), 6 Review & create (summary + assignee: select for owner/admin,
auto-self for recruiter). Footer Back/Cancel + Save & continue / Create candidate. Draft
autosaves to localStorage and is resumable from the roster banner.

## Data contract

`candidate` (existing columns: `id, org_id, user_id, name, email, phone, location,
linkedin_url, github_url, portfolio_url, other_urls, work_authorization, summary, status,
created_at, updated_at`) gains:

- `title` — `text`, nullable in DB, **required** at the create-API boundary.
- `primary_skills` — `jsonb`, `NOT NULL` default `[]` (a `string[]`).

`years_experience` is **not** stored — it is derived on read from `candidate_experience`
date ranges. Child tables already exist and need no migration:
`candidate_experience` (company, position, start_date, end_date, description[], tech_stack[]),
`candidate_education` (university, location, degree, cgpa, coursework, start_date, end_date),
`candidate_project` (title, project_link, github_link, description[], tech_stack[]),
`candidate_certification` (name, issued_by, badge_url, issued_on, verification_url),
`candidate_document` (doc_type, storage_path, filename).

Status tokens are `on_bench / interviewing / placed` (`callup.db.enums.CandidateStatus`,
already added by migration `62800661e14c`). The mockup's `bench` maps to `on_bench`.

## RBAC (consistent with slice-3 team rules)

- **owner / admin:** see the whole org bench; roster groups by recruiter when no
  recruiter-filter is set; may reassign candidates; the wizard lets them pick the assignee.
- **recruiter:** sees only candidates with `user_id == self`; flat roster; no reassign; the
  wizard auto-assigns to self.

Enforced **server-side** in every endpoint (org tenancy scope + role write-guards) and
mirrored in the UI. Reassignment and "view any recruiter's candidate" are owner/admin only.

## Status mapping

One shared frontend util maps the token to a label + color set, reused by pills, filter
dots, and the drawer/profile status changers:

| token | label | dot | bg | border | fg |
|---|---|---|---|---|---|
| `on_bench` | On bench | `#16a34a` | `#ecfdf3` | `#bbf7d0` | `#15803d` |
| `interviewing` | Interviewing | `#f59e0b` | `#fffbeb` | `#fde68a` | `#b45309` |
| `placed` | Placed | `#a1a1aa` | `#f4f4f5` | `#e4e4e7` | `#52525b` |

## Architecture & routing

- React Router routes: `/candidates` (roster; drawer is overlay state), `/candidates/:id`
  (profile), `/candidates/new` (wizard). All behind `RequireAuth` + `RequireOnboarded`.
- **Shared `AppLayout`** (sidebar with org name, nav, viewer footer, sign-out) extracted
  from `Dashboard.tsx` so Team and Candidates share one shell; the `Candidates` nav item
  becomes a real link (drop its `SOON` badge). `Dashboard` is refactored to consume it.
- Backend follows existing FastAPI patterns: a candidates router, a service module for
  query/scope/RBAC, Pydantic v2 request/response schemas, async SQLAlchemy. Each backend
  chunk regenerates `packages/shared-types` from the OpenAPI schema; the paired frontend
  consumes the generated types (never hand-redeclares them).
- Styling: port the mockup's inline styles to Tailwind, reusing existing theme tokens
  (`bg-brand`, `border-border`, etc.) and the established sizing idiom from `Dashboard.tsx`.
  Preserve the mockup's content max-widths (roster 1140px, profile 1080px, wizard 1000px).
  No new fonts/CSS files.

## Chunk breakdown (hybrid: foundation, then vertical slices)

Order is fixed; Documents is intentionally last (heaviest, isolated). Until chunk 8, the
wizard's Documents step and the profile's Documents section render placeholders.

### Chunk 1 — Foundation
- **Backend:** Alembic migration adding `candidate.title` (text) + `candidate.primary_skills`
  (jsonb, default `[]`); update the SQLAlchemy model; candidate Pydantic schemas
  (`CandidateCard`, `CandidateDetail`, `CandidateCreate`, `CandidateUpdate`) as typed stubs;
  register an empty candidates router.
- **Frontend:** extract shared `AppLayout`/sidebar from `Dashboard.tsx` and refactor
  Dashboard onto it; make `Candidates` a real nav link; add the status-mapping util; add
  `/candidates` route rendering the shell with a placeholder body.
- **Deliverable:** migration round-trips; nav navigates; the shell renders; schemas + types
  scaffolded. Nothing functional yet, but the seams are proven.

### Chunk 2 — Roster read (end-to-end)
- **Backend:** `GET /candidates` — org + role scoping, `status` / `recruiter_id` / `search`
  (name/title/skill) filters, returns card data including derived `years_experience`,
  status, recruiter info, and grouping metadata; service + RBAC.
- **Frontend:** roster header, search, status segmented control with counts, recruiter
  filter (owner/admin), list/grid toggle, candidate card (row + grid), grouped vs flat
  rendering, empty state — wired to the real endpoint.
- **Deliverable:** a working, role-scoped, filterable roster on real data.

### Chunk 3 — Quick-view drawer + status change (end-to-end)
- **Backend:** `PATCH /candidates/:id` accepting a status change (RBAC-guarded).
- **Frontend:** drawer overlay opened from a card; status pill + dropdown menu; optimistic
  update; "Open full profile" navigation.
- **Deliverable:** click a candidate → drawer → change status, persisted.

### Chunk 4 — Full profile view (end-to-end)
- **Backend:** `GET /candidates/:id` returning the candidate + all children (read), scoped.
- **Frontend:** profile route, breadcrumb top bar, section nav, read-only view cards
  (header w/ status changer reused, summary/skills/links, experience, education,
  projects/certs, documents placeholder).
- **Deliverable:** a full read-only profile, deep-linkable.

### Chunk 5 — Add wizard (create, end-to-end)
- **Backend:** `POST /candidates` creating the candidate + children (experience/education/
  projects/certs) in one transaction; assignee logic (owner/admin choose, recruiter self).
- **Frontend:** wizard route, stepper + progress, steps 1–4 + Review, structured start/end
  date inputs, localStorage draft autosave + "Save & exit", roster resume-draft banner
  (resume/discard). Documents step is present but deferred-wired (placeholder until chunk 8).
- **Deliverable:** add a candidate end-to-end; draft survives refresh; appears on roster.

### Chunk 6 — Profile edit + reassignment (end-to-end)
- **Backend:** extend `PATCH /candidates/:id` to Overview fields (name, title,
  primary_skills, work_authorization, location, summary) + reassignment (`user_id`,
  owner/admin only, guarded).
- **Frontend:** profile edit mode (Overview), skills chip editor, work-auth select,
  reassign select for owner/admin, Cancel/Save + `EDITING` badge.
- **Deliverable:** edit a profile's Overview and reassign it (role-permitting).

### Chunk 7 — Child section editors (end-to-end)
- **Backend:** CRUD for `candidate_experience`, `candidate_education`, `candidate_project`,
  `candidate_certification` (nested under the candidate, scoped + guarded).
- **Frontend:** per-section add/edit/delete editors on the profile for each child type.
- **Deliverable:** full management of experience/education/projects/certs from the profile.

### Chunk 8 — Documents & Storage (end-to-end)
- **Backend:** Supabase Storage bucket + access policies; upload endpoint with file-type and
  size validation; signed download URLs; `candidate_document` CRUD. Secrets resolved only
  via `backend/src/callup/secrets.py`.
- **Frontend:** activate the wizard Documents step (upload) and the profile Documents
  section (list, upload, download via signed URL, delete).
- **Deliverable:** upload/download/delete candidate documents, in both wizard and profile.

## Reconciliations (housekeeping these chunks must do)

- `docs/database-schema-v1.md`: add `title` + `primary_skills` to the `CANDIDATE` ER block;
  soften the "assigning candidates across recruiters … future" note now that reassignment
  ships (chunk 1 for columns, chunk 6 for the note).
- `backend/alembic/README.md`: log the new migration (chunk 1).
- Drop the mockup's review toolbar and sample data; do not port them.

## Execution

Per the agreed workflow, **each chunk gets its own implementation plan, written when the
chunk is picked up** (via the writing-plans skill), then implemented with
subagent-driven development. This document is the source of truth those per-chunk plans
draw from; it is not itself an implementation plan. Chunks are taken in order 1 → 8.
