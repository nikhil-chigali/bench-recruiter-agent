# Callup — frontend

The React SPA for Callup — the recruiter-facing portal (auth, onboarding, dashboard, and
the candidate/job/application surfaces as they land). Conventions live in
[`CLAUDE.md`](./CLAUDE.md).

Plain React + Vite + TypeScript (strict). Not Next.js. Tailwind + shadcn/ui for UI,
React Router for routing, `@supabase/supabase-js` for email auth.

## Setup

Requires [pnpm](https://pnpm.io/). From `frontend/`:

```bash
pnpm install            # install deps (respects .npmrc minimum-release-age)
cp .env.example .env    # then fill in the VITE_* vars below
```

`.env` (all client vars must be prefixed `VITE_`):

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000          # the backend API
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable/anon key>    # public by design (ships in the bundle)
```

The Supabase URL + anon key are the same public values the backend holds as `SUPABASE_URL`
and `SUPABASE_PUBLIC_KEY`.

## Run

```bash
pnpm dev                # Vite dev server on http://localhost:5173
```

Open `http://localhost:5173` (not `127.0.0.1`) — the backend's CORS allows the
`localhost:5173` origin, so the API calls (e.g. `/me`) only succeed from that host.

## Verify

No test runner (see [`CLAUDE.md`](./CLAUDE.md) — correctness comes from simple, well-typed
code plus manual browser checks):

```bash
pnpm tsc --noEmit       # type-check
pnpm lint               # eslint
pnpm build              # production build
```
