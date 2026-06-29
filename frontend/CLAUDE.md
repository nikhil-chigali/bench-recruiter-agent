# Frontend — agent notes

This is the React SPA for Callup — the recruiter-facing surface for candidate profiles, job matches, the application dashboard, the live apply session, and outreach drafts. Read [../CLAUDE.md](../CLAUDE.md) first — universal building rules live there. This file adds frontend-specific conventions.

## Stack

- **Plain React SPA** (Vite + TypeScript, strict). **Not Next.js** — do not suggest Next, SSR, server components, or file-based routing.
- **Tailwind CSS** for styling. No CSS modules, styled-components, Emotion, or `.module.css` files for component styles. Global theme tokens live in `src/index.css`.
- **shadcn/ui** for UI primitives. Add components with `pnpm dlx shadcn@latest add <name>` — don't hand-roll what shadcn already ships.
- **React Router** for routing.
- **`@supabase/supabase-js`** for auth (email only — no Google sign-in, no SSO providers). Note: the Gmail OAuth used for outreach is a *backend* concern and never touches the SPA.

## Package manager

**`pnpm` only.** Do not use `npm install` or `yarn add`. The lockfile is `pnpm-lock.yaml`. If you see `package-lock.json` or `yarn.lock` appear, that's a bug — delete it.

**Minimum release age: 7 days.** Configured via `.npmrc` (`minimum-release-age=10080` minutes). pnpm will refuse to install any package version published less than 7 days ago. This defends against typosquat / compromised-release attacks where a malicious version of a popular package goes live and gets pulled within hours.

If a fresh package is genuinely required (e.g. urgent security fix in a dep we already use), override per-install and justify in the commit message — don't lower the global threshold.

## Dependency policy

See universal policy in [../CLAUDE.md](../CLAUDE.md). Frontend-specific:

- **HTTP:** use the native `fetch` API through a thin client in `src/lib/http.ts` and the `api` singleton in `src/lib/api.ts`. **No axios, ky, got, superagent, redaxios.**
- **Dates:** use native `Date` and `Intl.DateTimeFormat`. No moment, dayjs, date-fns unless genuinely needed.
- **Utilities:** use native `Array` / `Object` / `Map` methods. No lodash, ramda.
- **State:** `useState` / `useReducer` / `useContext` first. Only reach for external state libraries when the pain is real.
- **Forms:** native `<form>` + `FormData` first.
- **Validation:** only add a schema library when we actually need runtime validation at boundaries.
- **UI components:** shadcn primitives via `pnpm dlx shadcn@latest add <name>`. Don't hand-roll what shadcn already ships.

Before adding a package, check:
1. Is there a native browser or TS/JS API that does this?
2. Does shadcn/ui already cover it?
3. Is it small, well-maintained, and worth the maintenance cost?

If yes to (3), add it — but flag the decision in the commit message.

## Layout (to be created during build)

```text
frontend/
├── src/
│   ├── components/        # App components. shadcn primitives under components/ui/
│   ├── lib/               # Framework-agnostic helpers (http, api, sse, auth, profile, supabase, env)
│   ├── pages/             # Route-level components (candidates, matches, applications, apply-session, outreach)
│   ├── App.tsx            # Router
│   ├── main.tsx
│   └── index.css          # Tailwind directives + global theme tokens
├── public/                # served verbatim at web root (brand icons under icons/, favicon.svg)
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

Keep imports consistent with the `@/*` alias (e.g. `@/lib/api`, `@/components/ui/button`).

## Code style (frontend-specific)

- **TypeScript strict.** No `any` unless there's no alternative; prefer `unknown` and narrow.
- **Small, composable functions and components** over clever abstractions. Three similar lines > a premature generic.
- **One component = one file.** Components stay small enough to fit on one screen.
- **Tailwind classes inline.** No CSS modules, styled-components, Emotion, or `.module.css` for component styles. Global tokens live in `src/index.css`.

## Configuration

- All env reads go through a single `src/lib/env.ts` module that validates required vars at boot. Never read `import.meta.env.X` directly in components.
- Env vars are prefixed `VITE_` (Vite convention). Anything not prefixed is not exposed to the client.

## Branding & icons

- The brand mark is a `#5b46e0` rounded square with a white network graph. The canonical source
  set lives at the repo root in `assets/icons/`; the **served** copy is in `public/icons/`
  (favicons under `icons/favicon/`, PWA app icons under `icons/app/`, plus `icons/site.webmanifest`).
  `public/` is served verbatim, so these resolve at `/icons/...`. When the mark changes, update
  `assets/icons/` and re-copy into `public/icons/` — they're kept in sync by hand, not by a build step.
- `index.html` wires the favicon links, `apple-touch-icon`, the manifest, and `theme-color`
  (`#5b46e0`); the tab `<title>` is "Callup".
- The in-app logo is the **`BrandMark`** component (`components/BrandMark.tsx`) — a lockup of the
  icon (`<img src="/icons/favicon/favicon.svg">`) plus the "Callup" wordmark, with `light`
  (white wordmark for dark surfaces) and `glow` props. Reuse it for any brand lockup; don't
  hand-roll a logo. The sidebar org-name mark in `AppLayout.tsx` reuses the same icon directly.

## Deployment

- Deploys to Railway from [`frontend/Dockerfile`](./Dockerfile): a pnpm build stage, then
  Caddy ([`Caddyfile`](./Caddyfile)) serving `dist/` with an SPA fallback to `index.html`
  (so client routes like `/accept-invite` resolve).
- `VITE_*` vars are **build-time** — Vite inlines them into the bundle, so they arrive as
  Docker build args and a value change needs a **rebuild**, not a restart. They are also
  **public** (shipped in the bundle): never put a secret in a `VITE_*` var.
- `VITE_API_BASE_URL` must be the backend's **public** Railway URL (the browser can't reach
  Railway private networking). Full setup is in [`docs/deployment.md`](../docs/deployment.md).

## Backend integration

- Talks to the Python backend over JSON. Base URL comes from `VITE_API_BASE_URL`.
- Always use `api.get/post/put/patch/delete` from `@/lib/api` — it handles base URL, JSON, Supabase bearer token, timeouts, and typed `ApiError`s (including the `isNetworkError` flag that distinguishes CORS/network from HTTP errors). For file uploads use `api.upload(path, formData)` — it sends `multipart/form-data` (the `http.ts` client detects a `FormData` body and skips the JSON `Content-Type`); don't hand-build `fetch` calls.
- Auth is Supabase email. The bearer token is injected automatically via the `api` client; never thread tokens through component props.
- Shared request/response types come from `packages/shared-types` (generated from the backend's OpenAPI schema). Don't hand-redeclare backend shapes.

## Live apply session (SSE)

The apply session is the one place the UI holds a live, two-way conversation with a worker. It is **not** plain request/response:

- Subscribe to `GET /apply-sessions/{id}/stream` for live `state` + `pending_prompt` updates. `EventSource` can't attach an `Authorization` header, so use a small fetch-based SSE reader in `src/lib/sse.ts` (native `fetch` + `ReadableStream`) that injects the Supabase bearer — no SSE library.
- When the stream reports a human-in-the-loop pause (login, screener questions, submit approval), render the prompt and POST the recruiter's answer via `api.post('/apply-sessions/{id}/resume', …)`.
- The stream is the source of truth for session state; don't keep a parallel optimistic copy that can drift from the worker.

## Testing

**No frontend tests.** Do not write `*.test.ts` / `*.test.tsx` files or introduce a test runner. We verify the frontend manually in the browser plus `pnpm tsc --noEmit` and `pnpm lint`. If you find yourself reaching for vitest, Playwright, or Cypress — stop. That's not what this project does. Correctness for shared logic comes from keeping it simple and well-typed, not from a test suite.

## Anti-patterns (rejected)

- Reading `import.meta.env.X` directly outside `lib/env.ts`.
- Importing an HTTP or SSE library when `fetch` would do.
- Mixing client state libraries (Zustand + Jotai + Redux) for one project.
- `any` annotations to silence the type-checker.
- Custom CSS files / styled-components alongside Tailwind.
- Re-implementing a shadcn primitive by hand.
- Reaching for Next.js, SSR, or any framework that requires a Node server in front of the SPA.
- Hand-redeclaring backend types instead of using `packages/shared-types`.
- Threading the auth token through props instead of letting the `api` client inject it.