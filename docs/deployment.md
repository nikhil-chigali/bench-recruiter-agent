# Deploying Callup to Railway

Callup runs as **two Railway services** in one project — the FastAPI backend and the
Vite SPA — both pointing at the same GitHub repo, plus the existing **Supabase** project
for Postgres + Auth. Each service sets a different **Root Directory** so Railway builds the
right subtree of the monorepo.

```text
Browser ──► Frontend service (static SPA)  ──► Backend service (FastAPI) ──► Supabase
            Root Directory = frontend/          Root Directory = backend/     (Postgres + Auth)
```

The browser talks to the backend over its **public** URL — the SPA runs on the user's
machine, so it cannot use Railway private networking. `VITE_API_BASE_URL` must be the
backend's public domain.

Both services build from a committed `Dockerfile` (`backend/Dockerfile`,
`frontend/Dockerfile`); Railway uses it automatically when it's present in the root
directory.

CI (GitHub Actions) and the deploy-gating strategy are already wired in the repo and
documented in the **Continuous integration** and **Continuous delivery** sections below.
If you're picking this up fresh, jump to **Next steps** at the end — it's the remaining
dashboard checklist.

---

## Backend service

**Settings**
- **Root Directory:** `backend`
- **Builder:** Dockerfile (auto-detected)
- **Start command:** baked into the image — `uvicorn callup.main:app --host 0.0.0.0 --port $PORT`. Do not override with the dev entry point (`callup.main:run` binds localhost only).
- **Healthcheck Path:** `/health`
- **Pre-deploy Command:** `uv run alembic upgrade head` — applies migrations against `DATABASE_URL` before each release, so a failed migration never starts a half-deployed server.

**Variables** (Railway → service → Variables; read by `callup.config.settings`, matched case-insensitively to the field names):

| Variable | Secret | Notes |
|---|---|---|
| `DATABASE_URL` | contains password | `postgresql+asyncpg://...` — Supabase **Session pooler** or direct connection, **not** the transaction pooler. No `?sslmode=` in the URL. |
| `DATABASE_PASSWORD` | 🔒 | Optional. Set the password here (separate from the URL) so special characters don't need URL-encoding; it overrides any password embedded in `DATABASE_URL`. |
| `DATABASE_SSL` | — | Leave unset (defaults `true`). Supabase requires SSL. |
| `ANTHROPIC_API_KEY` | 🔒 | **Required at boot** even though LLM features aren't wired yet — the field has no default, so the app won't start without it. |
| `SUPABASE_URL` | public | e.g. `https://<ref>.supabase.co`. Needed for JWT verification (JWKS) and the Auth Admin client. |
| `SUPABASE_SERVICE_KEY` | 🔒🔒 | Service-role key. Powers member/org auth-account deletion. **Backend only — never expose to the frontend.** |
| `FRONTEND_ORIGIN` | public | The deployed frontend URL, for CORS. **No trailing slash** — CORS does an exact string match against the browser's `Origin` header (which never carries a trailing slash), so a value like `…railway.app/` rejects *every* request (preflight 400, no `access-control-allow-origin` on the response). Without it set at all, the browser blocks every API call. |
| `ENVIRONMENT` | — | `production`. |

---

## Frontend service

**Settings**
- **Root Directory:** `frontend`
- **Builder:** Dockerfile (auto-detected). Build stage runs `pnpm build`; serve stage is Caddy with an SPA fallback to `index.html` (so `/accept-invite` and other client routes resolve).

**Variables** — all `VITE_*` are **build-time** and **public** (they're inlined into the JS bundle). Railway passes service variables to the Docker build as `ARG`s automatically.

| Variable | Notes |
|---|---|
| `VITE_API_BASE_URL` | Backend's **public** Railway domain, e.g. `https://callup-api.up.railway.app`. **No trailing slash** — the API client joins it as `` `${base}${path}` `` where every path already starts with `/`, so a trailing slash yields `//me` and the request 404s. |
| `VITE_SUPABASE_URL` | Same Supabase URL as the backend. |
| `VITE_SUPABASE_ANON_KEY` | The publishable/anon key — public by design. **Never** put a secret in a `VITE_*` var; it ships in the bundle. |

> Because Vite inlines these at build time, **changing any `VITE_*` value requires a
> rebuild**, not just a restart.

---

## Deploy order (resolves the chicken-and-egg)

The backend's CORS needs the frontend URL; the frontend build needs the backend URL.

1. **Deploy the backend first.** Set its variables (`FRONTEND_ORIGIN` can be a placeholder for now). Generate a public domain → e.g. `callup-api.up.railway.app`.
2. **Configure and deploy the frontend** with `VITE_API_BASE_URL` pointing at that backend domain. Generate its domain → e.g. `callup-web.up.railway.app`.
3. **Set the backend's `FRONTEND_ORIGIN`** to the frontend domain and redeploy the backend (changing a variable triggers a redeploy).

---

## Database connection

Use the Supabase **Session pooler** connection (IPv4-friendly, port 5432, supports
prepared statements) or the direct connection — **not** the transaction pooler (port
6543), which breaks asyncpg prepared statements and Alembic. From the Supabase dashboard's
Connect dialog:

1. Take the Session-pooler connection string.
2. Change the scheme to `postgresql+asyncpg://`.
3. Remove any `?sslmode=...` (asyncpg rejects it; SSL is handled by `DATABASE_SSL=true`).
4. Put the password in `DATABASE_PASSWORD` rather than inline.

---

## Secrets handling, in one place

- **Backend secrets** (`DATABASE_URL`/`DATABASE_PASSWORD`, `ANTHROPIC_API_KEY`,
  `SUPABASE_SERVICE_KEY`) live only in Railway's per-service Variables store (encrypted,
  not in git). Pydantic reads them from the process environment; the only module that
  resolves the sensitive ones is `backend/src/callup/secrets.py`.
- **Frontend `VITE_*` values are public** and end up in the client bundle — keep real
  secrets out of them entirely.
- **`.env` files stay local and gitignored.** Railway never sees them; it injects its own
  variables. There is no `load_dotenv` in app code.

---

## Gotchas checklist

- Bind `0.0.0.0` + `$PORT` — never `127.0.0.1` or a hardcoded port (the image already does).
- `VITE_*` changes need a **rebuild** to take effect.
- **No trailing slash** on `FRONTEND_ORIGIN` or `VITE_API_BASE_URL`. A trailing `/` breaks
  CORS on the backend (exact-match against the browser `Origin`) and produces `//path` 404s
  on the frontend — and the CORS failure hides the 404 until you fix both.
- Never put `SUPABASE_SERVICE_KEY` (or any secret) in a `VITE_*` var.
- The SPA must use the backend's **public** URL, not `*.railway.internal`.
- Set `FRONTEND_ORIGIN` or CORS blocks the SPA.
- Background workers (`backend/src/callup/workers/`) aren't wired to an entry point yet.
  When they are, run them as a **third** Railway service reusing the backend image with a
  different start command.

---

## Continuous integration (CI)

Two GitHub Actions workflows in `.github/workflows/`, one per service (kept separate):

| Workflow | Job | Steps |
|---|---|---|
| `backend-ci.yml` | `backend` | `uv sync --frozen` → `ruff check .` → `black --check .` → `pytest -m "not integration"` |
| `frontend-ci.yml` | `frontend` | `pnpm install --frozen-lockfile` → `eslint` → `tsc -b` → `vite build` |

**Triggers:** every **pull request**, plus **pushes to `develop` and `master`**. They are
intentionally **not** path-filtered: these are meant to be *required status checks*, and a
path-skipped workflow never reports its check — which would deadlock a PR on "waiting for
status." A feature-branch push with no open PR runs nothing; an open PR doesn't double-run.

**Excluded from CI:** the integration suite (`pytest -m integration`) needs live
Supabase/LLM credentials, so it stays out of the default run. There is no frontend test
runner by design (see `frontend/CLAUDE.md`).

> If per-service skipping ever becomes worth it, keep the workflows always-triggering and
> gate the *steps* with `dorny/paths-filter` (a filter job + `if:`), rather than
> `on: paths:` — that avoids the required-check deadlock.

## Continuous delivery (CD): how deploys are gated

We use **option (a)** — the gate lives in GitHub; Railway deploys a protected branch.

- Railway's production services deploy from **`master`** (auto-deploy on push, i.e. on merge).
- A **branch-protection rule on `master`** requires a PR plus the `backend` and `frontend`
  checks to pass before merge.
- So code reaches `master` only through a vetted PR → Railway only ever deploys green code.
  `master` is "always deployable" by construction; Railway itself doesn't need to know CI
  exists.

**Flow:** work on `develop` / feature branches → open a PR into `master` → both checks pass
→ merge → Railway deploys `master`.

> The alternative (option b) is to point Railway at the working branch and enable its
> "Wait for CI" toggle, which puts the gate inside Railway instead of GitHub. We chose (a)
> for the cleaner, Git-enforced separation (a protected, always-deployable `master`).

---

## Next steps (do this tomorrow)

**Already in the repo — nothing to do:** per-service `Dockerfile`s (build-verified),
both CI workflows (passing on `develop`), and `backend/.env.example`.

**Remaining dashboard setup:**

1. **Branch protection (GitHub).** Settings → Branches → add a rule for `master`: require a
   pull request before merging, and require the status checks **`backend`** and
   **`frontend`** (they'll be selectable since both have already reported). Recommended:
   include administrators / disallow bypass so direct pushes to `master` are blocked too.
2. **Merge the code onto `master`.** Railway deploys `master`, but it's currently behind
   `develop`. Once CI is green, merge the open `develop → master` PR so `master` holds the
   deployable code.
3. **Railway backend service.** New Project → Deploy from GitHub repo → this repo →
   **Root Directory `backend`**, **deploy branch `master`**. Add the backend variables (see
   the *Backend service* table; minimum: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY` — `FRONTEND_ORIGIN` can be a placeholder for now). Set
   **Pre-deploy Command** `uv run alembic upgrade head` and **Healthcheck Path** `/health`.
   Generate a public domain (e.g. `callup-api.up.railway.app`).
4. **Railway frontend service** (same project, same repo). **Root Directory `frontend`**,
   **deploy branch `master`**. Set `VITE_API_BASE_URL` to the backend's public domain, plus
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Generate a public domain.
5. **Close the loop.** Set the backend's `FRONTEND_ORIGIN` to the frontend domain and
   redeploy the backend (a variable change triggers it).
6. **Smoke test.** Open the frontend domain, sign in, confirm the dashboard loads (backend
   reachable + CORS OK). Check Railway logs: migrations applied in pre-deploy, `/health`
   returning 200.

> **First-run tip:** to validate the build/deploy pipeline *before* branch protection and
> the merge are in place, you can temporarily point a Railway service at `develop`, confirm
> it deploys, then switch its deploy branch to `master`.
