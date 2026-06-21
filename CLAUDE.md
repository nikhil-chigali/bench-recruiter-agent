# Callup — agent notes (root)

Callup automates bench-sales recruiting: fetch and normalize job postings, match bench candidates to them, generate truthful tailored documents, assist applications, and draft hiring-manager outreach. This file holds the **universal** rules for the whole monorepo. Stack-specific conventions live in [`backend/CLAUDE.md`](./backend/CLAUDE.md) and [`frontend/CLAUDE.md`](./frontend/CLAUDE.md) — read the one for the area you're touching, then this.

## Monorepo layout

```text
callup/
├── backend/      # FastAPI + background workers (Python, uv) — Dockerfile for Railway
├── frontend/     # React SPA (Vite + TS, pnpm) — Dockerfile + Caddyfile for Railway
└── docs/         # scope, plans, schema, deployment guide
```

Deployment: Railway hosts compute (API, workers, frontend); Supabase hosts Postgres + pgvector and Storage. Treat both as given — do not introduce alternative infra without a decision recorded in the commit. Each service deploys from its own `Dockerfile`; the full Railway setup (two services, env-var inventory, deploy order, secrets) is in [`docs/deployment.md`](./docs/deployment.md).

## Dependency policy

Default: write it yourself. Reach for a library only when the alternative would be non-trivial, error-prone, or reinvention of a standard. Every dependency is a liability — bundle size, supply-chain risk, future upgrade work.

**OK to depend on:**
- Things that are genuinely hard to get right (HTTP clients, ASGI servers, SQL drivers, parsers, LLM SDKs, ORM, migrations, auth SDKs, browser automation).
- The declared stack (FastAPI, React, Vite, Supabase clients, the LLM/embedding SDK, Playwright, etc.).

**Not OK:**
- Helper libraries that wrap 5–20 lines of stdlib or platform APIs.
- Frameworks where a function would do.
- "Nicer API" layers on top of an already-present dependency.

Before adding a runtime dep, answer in the commit message:
1. What exactly does it do that we can't write in <30 lines of clear code?
2. How often does it get used?
3. What's its maintenance / transitive-dep footprint?

Per-stack specifics live in `backend/CLAUDE.md` and `frontend/CLAUDE.md`.

## Configuration

A single settings module is the source of truth for environment per service (`backend/src/callup/config.py`, `frontend/src/lib/env.ts`). Do not call `os.getenv` / read `process.env` or `import.meta.env` directly in app code. Do not call `load_dotenv` anywhere. If a third-party SDK reads env vars directly, mirror them in the settings module — don't sprinkle `setdefault` elsewhere.

Fail fast on startup if required config is missing. No silent fallbacks that hide real config errors.

## Secrets

Candidate Dice credentials, Gmail OAuth tokens, and provider keys are resolved in exactly one place per service and passed around as opaque references, never as values. Secrets never enter logs, worker payloads, API responses, or the frontend bundle. See `backend/CLAUDE.md` for the resolution module.

## Code style (universal)

- Small, obvious functions. A 15-line function with clear names beats a three-class abstraction.
- No premature abstraction. Three similar lines is better than a badly-named base class. Extract when there's a third caller, not a hypothetical one.
- No error handling for cases that can't happen. Trust internal callers and framework guarantees. Validate only at boundaries: HTTP input, external APIs, DB writes, untrusted parsing.
- No backwards-compat shims unless explicitly asked for.
- No feature flags added speculatively. (The `OUTREACH_SEND_ENABLED` gate is a deliberate exception — it's a scoped product decision, not speculation.)
- Comments: explain *why* when non-obvious, never *what*. Remove stale TODOs.
- Keep files focused. Prefer small modules.

## Build philosophy

Wire end-to-end first, then deepen (walking skeleton). New pipeline stages land as typed stubs that pass data through before they get real logic, so the seams are proven before any one component is finished. Don't complete one service in isolation while the rest of the graph is disconnected.

## Truthful-only generation

A hard product constraint, not a style preference: generated resumes, cover letters, and outreach must never invent skills, employers, dates, or experience. Generators draw only from verified candidate facts, and generated documents are validated against those facts before use. This rule outranks "make it sound better." Enforcement details are in `backend/CLAUDE.md`.