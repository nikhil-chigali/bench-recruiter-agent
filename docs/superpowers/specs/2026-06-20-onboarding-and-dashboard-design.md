# Onboarding + dashboard — design (Slice 2)

Date: 2026-06-20
Status: approved — ready for implementation plan

The second feature slice. It replaces slice 1's silent org auto-provisioning with a
deliberate onboarding step, and gives the app a real dashboard surface to grow from.
It is the first of a two-slice org/team effort:

- **Slice 2 (this spec):** explicit onboarding (create an org, become owner) + dashboard.
- **Slice 3 (later spec):** team invitations (shareable token links) + roles/permissions
  + members management on the dashboard.

Candidates work begins only after both land.

## Foundational decisions (apply to both slices)

- **One org per person.** `recruiter.org_id` stays a single FK; no membership join table,
  no org switching. Onboarding is create-or-join, once.
- **Roles:** `owner` (org creator, full control, protected), `admin` and `recruiter`.
  Owner & admin manage the team; recruiter cannot. Admins cannot remove/demote the owner;
  ownership transfer and org deletion are owner-only (Slice 3+). Slice 2 only creates the
  owner; the other roles arrive via invitations in Slice 3.
- **Invites = shareable token links** (Slice 3). No email-sending dependency.

## Goal (Slice 2)

A newly authenticated user with no recruiter row is routed to an onboarding screen where
they set a display name and create an org, becoming its owner. After that they land on a
dashboard showing the org name, their name, and their role. Sign-out returns to login.

**Testable on screen:** sign up → land on `/onboarding` (not a silent dashboard) → enter
display name + org name → land on the dashboard showing the org → refresh persists →
sign out → `/login`. In Supabase, exactly one `org` (owned by you) and one `recruiter`
(role `owner`, `id` = your auth user id) exist.

## Scope

**In:** remove silent auto-provisioning; `GET /me` reports onboarding state; `POST /orgs`
onboarding action; a `ProfileProvider` that drives routing; an onboarding page; a
dashboard page (app-shell layout) replacing the bare greeting.

**Out (Slice 3 or later):** invitations, joining an existing org, the members list,
role assignment/removal, permission enforcement beyond "owner is the creator", ownership
transfer, org deletion, candidates.

## Backend

### `api/deps.py` — split the dependency

Slice 1's `get_current_recruiter` both verified the token and auto-provisioned. Split it:

- `get_current_claims(request) -> TokenClaims` and `CurrentClaims = Annotated[TokenClaims,
  Depends(get_current_claims)]`. Verifies the bearer via `verify_token`; maps `AuthError`
  → 401, `JWKSUnavailable` → 503, missing/malformed header → 401. **No DB access.** This
  is the base auth dependency for `/me` and `/orgs`.
- `get_current_recruiter(claims: CurrentClaims, session) -> Recruiter` and
  `CurrentRecruiter`. Looks up the recruiter by `claims.sub`; if absent, raises **403**
  `"not onboarded"`. **Does not provision.** For future business routes that require an
  onboarded recruiter. (No route uses it in Slice 2, but it defines the pattern and
  replaces the old provisioning dependency cleanly.)

### `db/repositories.py`

- Keep `get_recruiter(session, recruiter_id) -> Recruiter | None`.
- Replace `provision_recruiter` with
  `create_owned_org(session, recruiter_id, email, org_name, display_name) -> Recruiter`.
  Same FK-safe ordering as before: insert `org` (name = `org_name`, owner null) → flush →
  insert `recruiter` (`id=recruiter_id`, `org_id`, `role=owner`, `name=display_name`,
  `email`) → flush → set `org.owner_recruiter_id` → commit. Idempotency: on
  `IntegrityError` (recruiter already exists, race), roll back and return the existing row.

### `api/routes/me.py`

- `GET /me` (uses `CurrentClaims`) → `MeOut`:
  ```python
  class RecruiterOut(BaseModel):
      id: uuid.UUID
      email: str
      name: str
      role: str
      org_id: uuid.UUID
      org_name: str

  class MeOut(BaseModel):
      onboarded: bool
      recruiter: RecruiterOut | None
  ```
  Look up the recruiter by `claims.sub`. Found → `MeOut(onboarded=True, recruiter=...)`
  (org_name via `session.get(Org, ...)`). Absent → `MeOut(onboarded=False, recruiter=None)`.

### `api/routes/orgs.py` (new)

- `POST /orgs` (uses `CurrentClaims`) → body:
  ```python
  class OrgCreateIn(BaseModel):
      org_name: str   # trimmed, 1..120 chars after strip
      display_name: str  # trimmed, 1..120 chars after strip
  ```
  Validate non-empty after strip (Pydantic field validators). If `get_recruiter(sub)` is
  not None → **409** `"already onboarded"`. Else `create_owned_org(sub, claims.email,
  org_name, display_name)` → return `RecruiterOut`. Register the router in `main.py`.

## Frontend

### `lib/profile.tsx` — `ProfileProvider` / `useProfile()`

- After `useAuth()` reports a session, fetch `GET /me` once and expose
  `{ loading, onboarded, recruiter, error, refresh }`.
- `recruiter` shape mirrors backend `RecruiterOut` (all strings over the wire).
- On a 401 from `/me`, call `signOut()` (clears the stale session → routing sends the user
  to `/login`). This also implements slice 1's deferred "401 → login" follow-up for `/me`.
- On any other `/me` failure (e.g. 503 JWKS outage, network), set `error` (do not sign
  out); `RequireOnboarded` renders a retry-able error state instead of routing.
- Reset to unloaded when the session goes null (sign-out). `refresh()` re-fetches `/me`
  (used after onboarding completes).
- Mounted inside `AuthProvider` (needs the session) and above the routes.

### Routing — `App.tsx`

- `BrowserRouter` > `AuthProvider` > `ProfileProvider` > `Routes`.
- Routes:
  - `/login` — public.
  - `/onboarding` — requires session; if already onboarded, redirect to `/`.
  - `/` — requires session **and** onboarded (a `RequireOnboarded` gate redirects to
    `/onboarding` when not onboarded); renders `Dashboard`.
  - `*` → `/`.
- `RequireAuth` (existing) gates on session. A new `RequireOnboarded` consumes
  `useProfile()`: while `loading` → spinner; `error` set → retry-able error state;
  `!onboarded` → `<Navigate to="/onboarding" replace>`; else render children.

### `pages/Onboarding.tsx`

- Native `<form>` + `FormData`: `display_name` + `org_name`, submit → `api.post('/orgs',
  { org_name, display_name })`. On success → `await refresh()` → `navigate('/')`. On 409
  (already onboarded) → `await refresh()` → `navigate('/')`. Other errors inline. shadcn
  Card/Input/Label/Button (already present).

### `pages/Dashboard.tsx` (replaces `pages/Home.tsx`)

- App-shell layout: a header bar (org name on the left; your name · role and a sign-out
  button on the right) and a main content area with a summary `Card` (org name, your
  role). Reads from `useProfile()` (no ad-hoc `/me` fetch). Built so Slice 3 can add a
  members section to the body without touching the shell.
- Delete `pages/Home.tsx` (superseded).

## Data flow

login (Supabase) → `ProfileProvider` fetches `/me` → `onboarded:false` → `RequireOnboarded`
redirects to `/onboarding` → submit display+org name → `POST /orgs` creates org + owner
recruiter → `refresh()` re-fetches `/me` (`onboarded:true`) → `/` dashboard renders the org.

## Error handling

| Case | Behavior |
|------|----------|
| `/me` 401 (stale/invalid token) | `ProfileProvider` signs out → routing sends to `/login` |
| `/me` 503 (JWKS outage) | surface a retry-able error state; do not sign out |
| `POST /orgs` 409 (already onboarded) | refresh profile → navigate to `/` |
| `POST /orgs` 422 (blank/too-long names) | inline field error on the onboarding form |
| Provisioning race (concurrent create) | `create_owned_org` catches IntegrityError, returns existing |

## Testing

Per `backend/CLAUDE.md` (unit-first; fast suite no network/no DB) and `frontend/CLAUDE.md`
(no frontend tests):

- `GET /me` — fast route tests via dependency override of `get_current_claims` and the
  session: returns `onboarded:false` with no recruiter, and `onboarded:true` + profile when
  a recruiter exists. (No DB/network.)
- `POST /orgs` — fast route test: 409 when a recruiter already exists (override claims +
  a fake session/repo). Validation: 422 on blank names.
- `create_owned_org` — integration test (live DB, `@pytest.mark.integration`): creates the
  org with the given name owned by the recruiter (role `owner`, name = display_name),
  exactly one org for that owner, and is idempotent on a repeat call. Cleans up (FK-safe:
  null `owner_recruiter_id` → delete recruiter → delete org).
- Update the slice-1 tests that asserted the old auto-provision `/me` shape.
- Frontend: manual in-browser (the testable-on-screen flow above) + `pnpm tsc --noEmit` +
  `pnpm lint`.

## Notes / follow-ups carried forward

- Slice 3 will turn `create_owned_org` into the "create" branch and add a "join via
  invitation" branch; `GET /me`'s `onboarded:false` state is where that branch decision
  surfaces in the UI (offer "create org" vs. "accept invite").
- The integration-test transaction-rollback fixture (see `docs/todos.md` follow-ups)
  remains deferred; this slice keeps the explicit FK-safe cleanup pattern in the meantime.
