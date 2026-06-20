# Callup

Callup automates bench-sales recruiting. A recruiter manages a set of consultants
("candidates") and Callup does the heavy lifting: it fetches and normalizes job postings
from Dice, ranks them against each candidate, generates truthful tailored resumes and
hiring-manager outreach drafts, assists with applications, and tracks every application to
completion.

## Monorepo layout

```text
callup/
├── backend/    # FastAPI service + background workers (Python, uv)
├── frontend/   # React SPA — recruiter portal (Vite + TypeScript, pnpm)
└── docs/       # Scope, implementation plan, and flow diagrams
```

Deployment targets Railway for compute and Supabase for Postgres (with pgvector) and
Storage.

## Getting started

Each app has its own setup and conventions:

- **Backend** — see [`backend/CLAUDE.md`](./backend/CLAUDE.md). Run with `uv`.
- **Frontend** — see [`frontend/CLAUDE.md`](./frontend/CLAUDE.md). Run with `pnpm`.

Project-wide conventions and guardrails live in [`CLAUDE.md`](./CLAUDE.md).

## Core constraint

Generated resumes, cover letters, and outreach must never invent skills, employers, dates,
or experience. All generation draws only from verified candidate facts and is validated
against them before use.
