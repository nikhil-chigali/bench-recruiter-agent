# Auth + recruiter/org bootstrap — design

Date: 2026-06-20
Status: approved — ready for implementation plan

The first end-to-end feature slice. A walking skeleton that puts real Supabase
identity and tenancy under everything built afterward, so no later feature has to
swap out a seeded/dev recruiter id.

## Goal

A recruiter can sign up / sign in with email, land on a protected home that greets
them and shows their org, and sign out. On first authenticated request the backend
auto-provisions the recruiter's `recruiter` row and a new `org` they own.

**Testable on screen:** open app → redirected to `/login` → sign up or sign in →
protected home greets you by name and shows your org → refresh keeps you logged in →
sign out returns to `/login`. In Supabase, your `org` + `recruiter` rows now exist.

## Decisions

- **Auth sequencing:** auth first, then features. Everything later sits on real
  identity + tenancy from day one.
- **Org provisioning:** first-time sign-in → a freshly created org with the user as
  its owner (`role=owner`, `org.owner_recruiter_id = recruiter.id`). One tenant per
  user for the MVP; inviting other recruiters into an org is a later feature.
- **Token trust:** verify the Supabase JWT locally against the project's **asymmetric
  signing keys** via the JWKS endpoint. No shared secret, no per-request call to
  Supabase. Project confirmed to use asymmetric JWT keys.

## Scope

**In:** Supabase email login UI, React Router protected shell, backend JWKS JWT
verification, `GET /me` that auto-provisions on first call and returns the current
recruiter.

**Out (deferred to later todos):** password reset / email-confirmation polish,
inviting recruiters into an existing org, role-based permissions enforcement,
candidate / job / application features.

## Dependency note

Adds **PyJWT** (with crypto extra) to the backend. Justification per the root
dependency policy: cryptographic JWT signature verification against a rotating JWKS
is squarely in the "genuinely hard to get right" category. Used on every
authenticated request (the `CurrentRecruiter` dependency). Small, widely used,
minimal transitive footprint (`cryptography`).

## Backend

### `config.py`

- `supabase_url` is already present (optional). It becomes effectively required for
  auth; keep the type but document that auth fails fast if unset.
- Add `supabase_jwt_aud: str = "authenticated"` (the audience claim Supabase issues).
- JWKS URL is derived, not stored: `{supabase_url}/auth/v1/.well-known/jwks.json`.

### `auth/jwt.py` (new module)

- `TokenClaims` dataclass: `sub: uuid.UUID`, `email: str`.
- A module-level cached `PyJWKClient` pointed at the derived JWKS URL (keys fetched
  once and cached; PyJWKClient handles caching/rotation).
- `verify_token(token: str) -> TokenClaims`: resolve signing key from the token's
  `kid`, verify signature + `aud` (== `supabase_jwt_aud`) + `exp`, return claims.
- Verification failures raise an auth error mapped to HTTP 401. A JWKS *fetch/network*
  failure is distinct and maps to 503 (not 401) — a key-server outage is not an
  invalid token.

### `db/repositories.py`

- `get_recruiter(session, recruiter_id) -> Recruiter | None`.
- `provision_recruiter(session, recruiter_id, email, name) -> Recruiter`, in one
  transaction:
  1. insert `org` (`name = "{email}'s workspace"`, `owner_recruiter_id = NULL`),
  2. insert `recruiter` (`id = recruiter_id`, `org_id = org.id`,
     `role = owner`, `email`, `name`),
  3. set `org.owner_recruiter_id = recruiter.id`.
- Idempotent: on a PK/unique-violation race (two first requests at once), roll back
  and re-fetch the existing recruiter.
- `name` source: the token has no name claim; default `name` to the email local-part
  for now (editable once a profile feature exists).

### `api/deps.py`

- `CurrentRecruiter` dependency: read the bearer from the `Authorization` header →
  `verify_token` → `get_recruiter`; if `None`, `provision_recruiter`. Returns the
  `Recruiter` model. Every future business route depends on this for identity and
  `org_id` scoping. Missing/invalid token → 401.

### `api/routes/me.py` (new route)

- `GET /me` → `RecruiterOut` (`id`, `email`, `name`, `role`, `org_id`, `org_name`).
- Thin: returns the `CurrentRecruiter`. This is the call that triggers first-time
  provisioning.
- `RecruiterOut` Pydantic schema lives here (or a small `schemas.py`). Never echoes
  the token or any secret.
- Router registered in `main.py`.

### CORS

- The SPA is a separate origin in dev (`localhost:5173` → API `127.0.0.1:8000`). Add
  FastAPI `CORSMiddleware` allowing the frontend origin, `Authorization` header, and
  the methods used. Origin comes from settings (a `frontend_origin` setting), not
  hardcoded.

## Frontend

### `lib/auth.tsx`

- `AuthProvider` + `useAuth()` over `supabase.auth`. Exposes `session`, `loading`,
  `signIn(email, password)`, `signUp(email, password)`, `signOut()`.
- Subscribes to `supabase.auth.onAuthStateChange` so refresh / logout propagate; owns
  *session state only* — request wiring stays in the existing `api` client, which
  already injects the bearer.

### `pages/Login.tsx`

- Native `<form>` + `FormData`: email + password, a sign-in / sign-up toggle.
- shadcn `card`, `input`, `label`, `button` (add the missing primitives via
  `pnpm dlx shadcn@latest add`).
- Surfaces Supabase auth errors (bad password, user already exists) inline.

### `pages/Home.tsx`

- Protected. On mount, `api.get('/me')`; greet by name, show org name + role.
- Sign-out button.

### `components/RequireAuth.tsx`

- If no session → `<Navigate to="/login" replace>`. While `loading` → a spinner.

### `App.tsx`

- Wrap in `<BrowserRouter>` + `<AuthProvider>`.
- Routes: `/login` (public), `/` (protected `Home`), catch-all → `/`.

## Data flow

Sign in (Supabase, client-side) → supabase-js stores the session → navigate to `/` →
`Home` calls `GET /me` with the bearer → backend verifies the JWT via JWKS → looks up
recruiter by `sub` → not found → provisions org + recruiter → returns `RecruiterOut`
→ Home renders name / org.

## Error handling

| Case | Behavior |
|------|----------|
| No / expired / invalid token | 401; frontend bounces to `/login` |
| JWKS fetch / key-server failure | 503 (not 401) — outage ≠ invalid token |
| Provisioning race (concurrent first requests) | caught, re-fetch existing row, succeed |
| Supabase auth error (bad password, user exists) | surfaced inline on the login form |

## Testing

Per `backend/CLAUDE.md` (unit-first, no network in the fast suite):

- `verify_token`: generate a local keypair, sign a token, monkeypatch the JWKS client
  to return the test public key; assert a valid token verifies and that
  expired / wrong-`aud` / bad-signature tokens are rejected.
- `provision_recruiter`: idempotency (second call returns the same row) and correct
  owner wiring (`org.owner_recruiter_id == recruiter.id`, `role == owner`,
  `recruiter.org_id == org.id`).
- No frontend tests (per `frontend/CLAUDE.md`) — manual in-browser plus
  `pnpm tsc --noEmit` and `pnpm lint`.

## Out of scope / follow-ups

- Editing recruiter profile (set a real `name`).
- Inviting other recruiters into an org (turns one-per-org into multi-member).
- Role-based permission enforcement (the `role` column exists but isn't gated yet).
- RLS policies (multi-tenant hardening) — middleware + RLS later, never a column-shape
  migration.
