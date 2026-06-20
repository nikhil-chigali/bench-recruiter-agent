# Team invitations & roles — design (Slice 3)

Date: 2026-06-20
Status: approved — ready for implementation plan

The third feature slice, and the second half of the org/team effort begun in slice 2.
Slice 2 established explicit onboarding (create an org, become owner) and a dashboard
shell built to grow a body. This slice fills that body: owner/admin invite teammates via
email-bound shareable links, members are listed and managed with role-gated permissions,
and the owner gets the full org lifecycle (ownership transfer + org deletion).

Candidate work (slice 4) begins only after this lands.

## Foundational decisions (carried from slice 2, confirmed)

- **One org per person.** `recruiter.org_id` stays a single FK; no membership join table,
  no org switching. Joining an org via an invite creates the one recruiter row for that
  user.
- **Roles:** `owner` (creator, full control, protected), `admin`, `recruiter`.
- **Invites = email-bound shareable links.** No email-sending dependency: the inviter
  copies the generated link and delivers it however they like. The link carries a secret
  token; accepting it requires the signed-in user's email to match the invite.
- **Permission hierarchy:** owner > admins (peers) > recruiters.
  - Owner/admin can invite, change roles, and remove members.
  - **Admins act on recruiters only.** Modifying or removing an `admin` or the `owner` is
    owner-only.
  - Role changes move members between `{admin, recruiter}`. Promotion to `owner` happens
    only via ownership transfer.
  - The owner is never demotable or removable except via transfer. Transfer and org
    deletion are owner-only.

## Goal

An owner or admin invites a teammate (email + role) and gets a copyable accept link. The
invitee signs in, opens the link, and joins the org with the assigned role. The dashboard
shows the member roster with role-gated management controls. The owner can transfer
ownership or delete the org.

**Testable on screen:** owner invites `alice@x.com` as `recruiter` → copies the link →
Alice (signed in as `alice@x.com`) opens it → sees "invited to {org} as recruiter" →
sets a display name → accepts → lands on the dashboard → appears in the owner's roster.
Owner changes her role to `admin`, then removes her (she reverts to onboarding). Owner
transfers ownership to a member, then deletes the org. In Supabase, the `invitation` row
is `accepted`, the member's `recruiter` row carries the right `org_id`/`role`, and after
deletion no `invitation`/`recruiter`/`org` rows for that org remain.

## Scope

**In:** `invitation` table + migration; invite create/list/revoke; invite lookup + accept
(email-bound, single-use, expiring); member roster + role change + remove; ownership
transfer; org deletion (cascade); permission enforcement; the accept-invite page; an
onboarding hint; dashboard members/invites/danger-zone sections; the `RequireAuth`
return-location fix.

**Out (later slices):** self-service "leave org"; bulk/open invites; email delivery;
candidates and any cascade into candidate/job/application data (those tables don't exist
yet — deletion cascade today covers only invitations + members + the org); audit log.

## Data model

### `invitation` table — `db/models/invitation.py`

Uses `TenantMixin` (adds `org_id`) + `TimestampMixin`, like `Recruiter`.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK→org | tenancy (TenantMixin), indexed |
| `email` | text | invitee, stored lowercased |
| `role` | text | `admin` or `recruiter` — never `owner` |
| `token_hash` | text, unique, indexed | sha256 hex of the raw token; raw token never stored |
| `status` | text | `pending` / `accepted` / `revoked` |
| `invited_by` | uuid FK→recruiter | who created it |
| `expires_at` | timestamptz | created + 7 days |
| `accepted_at` | timestamptz, null | set on accept |
| `accepted_by` | uuid FK→recruiter, null | the member row created on accept |
| `created_at` / `updated_at` | timestamptz | TimestampMixin |

Expiry is **computed** from `expires_at` at read time, not stored as a fourth status
value. `status` only tracks the explicit lifecycle (`pending`→`accepted`/`revoked`).

### `db/enums.py`

Add `InvitationStatus(StrEnum)`: `PENDING = "pending"`, `ACCEPTED = "accepted"`,
`REVOKED = "revoked"`. Stored as plain strings and validated at the boundary, consistent
with `RecruiterRole`.

### Migration

New Alembic migration (autogenerate → review → `uv run alembic upgrade head`), plus a
table row and detail section in `alembic/README.md`. Register the model in
`db/models/__init__.py`.

## Token & security mechanics

- Raw token: `secrets.token_urlsafe(32)`. The DB stores only `sha256(token)` (hex). The
  raw value appears exactly once, embedded in the `accept_url` returned to the inviter. A
  DB leak cannot reconstruct working links.
- **Email-bound:** accept requires `claims.email == invitation.email` (case-insensitive),
  else 403.
- **Single-use:** accept flips `pending → accepted`; a non-pending or expired invite
  cannot be accepted.
- **Re-invite:** creating an invite for an email that already has a `pending` invite in
  the org revokes the existing pending one and creates a fresh invite (no duplicate
  stacking). Past `accepted`/`revoked` invites are left as history.

## Backend API surface

Logic in repositories (all SQL) and a small permission module; routes stay thin.

### `db/repositories.py` — new functions

- `create_invitation(session, org_id, email, role, invited_by, token_hash, expires_at) -> Invitation`
  (revokes any existing pending invite for the same `(org_id, email)` first).
- `list_pending_invitations(session, org_id) -> list[Invitation]`.
- `get_invitation_by_token_hash(session, token_hash) -> Invitation | None`.
- `revoke_invitation(session, invitation_id, org_id) -> Invitation | None` (org-scoped).
- `accept_invitation(session, invitation, recruiter_id, email, display_name) -> Recruiter`
  (creates the recruiter row with `org_id`/`role` from the invite; sets invite
  `accepted`, `accepted_at`, `accepted_by`; single transaction).
- `list_members(session, org_id) -> list[Recruiter]`.
- `get_member(session, recruiter_id, org_id) -> Recruiter | None` (org-scoped lookup).
- `update_member_role(session, member, role) -> Recruiter`.
- `remove_member(session, member) -> None`.
- `transfer_ownership(session, org, old_owner, new_owner) -> None`
  (new_owner.role→`owner`, old_owner.role→`admin`, `org.owner_recruiter_id`=new_owner.id;
  atomic).
- `delete_org(session, org) -> None` (FK-safe cascade: null `owner_recruiter_id` → delete
  invitations → delete recruiters → delete org).

### `api/permissions.py` (new)

Small pure helpers over `(actor: Recruiter, target_role: str)` — 3+ callers justify
extracting them. They raise `HTTPException` (403) on violation:

- `ensure_owner(actor)` — actor.role is `owner`.
- `ensure_can_manage(actor, target_role)` — owner may manage any non-owner; admin may
  manage only `recruiter`; recruiter may manage nobody.
- Role-target validation (can't target `owner` via manage; can't set role to `owner`)
  lives at the call sites / Pydantic boundary.

Unit-testable in isolation (no DB).

### `api/routes/invitations.py` (new)

Manage endpoints use `CurrentRecruiter`; lookup/accept use `CurrentClaims` (must work
pre-onboarding, like `POST /orgs`).

- `POST /invitations` `{email, role}` — `ensure_can_manage(actor, role)`; reject
  `role == owner` (422). Generate token, create invite, return
  `{id, email, role, status, expires_at, accept_url}` (raw token in `accept_url` once).
- `GET /invitations` — `ensure_can_manage`-gated (owner/admin); list pending invites.
- `DELETE /invitations/{id}` — owner/admin; revoke (org-scoped; 404 if not in org).
- `GET /invitations/lookup?token=…` (`CurrentClaims`) — hash token, look up; return
  `{org_name, role, email, status, email_matches}` for the accept screen. 404 if no match.
- `POST /invitations/accept` `{token, display_name}` (`CurrentClaims`) — validate pending
  + unexpired + `email_matches` + caller not already a member; create the membership;
  return `RecruiterOut`. 403 mismatch; 409 already a member / non-pending / expired.

### `api/routes/members.py` (new)

- `GET /members` (`CurrentRecruiter`, any role) — roster `{id, name, email, role}[]` for
  the caller's org.
- `PATCH /members/{id}` `{role}` (`CurrentRecruiter`) — `get_member` in caller's org (404
  if absent/cross-org); `ensure_can_manage(actor, member.role)`; reject setting `owner`;
  update.
- `DELETE /members/{id}` (`CurrentRecruiter`) — same lookup + `ensure_can_manage`;
  refuse to remove the owner; delete (member reverts to not-onboarded).

### `api/routes/orgs.py` (extend)

- `POST /orgs/transfer-ownership` `{recruiter_id}` — `ensure_owner`; target must be a
  member of the org; perform transfer.
- `DELETE /orgs/current` — `ensure_owner`; cascade delete. Frontend gates with a typed
  confirmation.

Register the new routers in `main.py`.

## Frontend

### Routing — `App.tsx`, `RequireAuth`, `Login`

- New `/accept-invite` route inside `RequireAuth` only (reachable when `onboarded:false`),
  registered before the `*` catch-all so it isn't redirected away.
- **Return-location fix:** `RequireAuth` captures `useLocation()` and redirects with
  `state={{ from: location }}`; `Login` reads `from` and navigates back to
  `from.pathname + from.search` (default `/`) after auth, so `?token=…` survives sign-in.

### `pages/AcceptInvite.tsx` (new)

1. Read `token` from the query; `GET /invitations/lookup`.
2. Valid + pending + email match: show "Invited to **{org}** as **{role}**", a
   display-name field, and **Accept** → `POST /invitations/accept` → `await refresh()` →
   `navigate('/')`.
3. Edge states (no accept button): already onboarded → "already part of {org_name}";
   `email_matches:false` → "this invite is for {email}; you're signed in as
   {claims.email}"; expired / revoked / accepted → matching message; missing/unknown
   token → not-found message.

### `pages/Onboarding.tsx` (extend)

Add a footer hint: "Have an invite? Open the invite link your admin sent you." No
token-pasting box — the link is the path.

### Dashboard sections

`Dashboard.tsx` stays a thin composition; each section is its own small component reading
role from `useProfile()`:

- `components/MembersSection.tsx` (all roles) — roster from `GET /members`. For owner/admin,
  each row shows a role `select` + Remove; controls are hidden/disabled per the permission
  rules (admins get controls only on `recruiter` rows; the owner row is never actionable
  here).
- `components/InvitesSection.tsx` (owner/admin) — invite form (email + role select); on
  success show the `accept_url` with a copy button; pending-invites list with Revoke.
- `components/DangerZone.tsx` (owner) — Transfer ownership (pick a member) and Delete
  organization (typed-confirmation: type the org name to enable). On delete success →
  `refresh()` (the now-not-onboarded user is routed to `/onboarding`).

New shadcn primitive: `select` (`pnpm dlx shadcn@latest add select`) for role pickers.
Response shapes are declared inline through the existing `api` client; generating
`packages/shared-types` remains a tracked follow-up, not this slice.

## Data flow

invite (owner/admin) → `POST /invitations` → copy `accept_url` → invitee opens
`/accept-invite?token=…` (signs in first if needed; token survives via the return-location
fix) → `GET /invitations/lookup` preview → `POST /invitations/accept` creates the member
row + marks invite accepted → `refresh()` → dashboard roster shows the new member.

## Error handling

| Case | Behavior |
|---|---|
| Accept: email mismatch | 403; preview warns, no accept button |
| Accept: expired / revoked / already accepted | 4xx; preview shows the state |
| Accept: caller already a member | 409 "already in an org" |
| Invite: role = `owner` | 422 |
| Manage: admin acting on admin/owner | 403 |
| Manage / target in another org | 404 (don't leak existence) |
| Set member role to `owner` via PATCH | 422 (use transfer) |
| Remove the owner | 403 |
| Transfer / delete by non-owner | 403 |
| Concurrent accept (race) | single-use guard: second accept sees non-pending → 409 |

## Testing

Per `backend/CLAUDE.md` (unit-first; fast suite hits no DB/network) and
`frontend/CLAUDE.md` (no frontend tests):

- **Permission helper unit tests** (`api/permissions.py`) — the owner/admin/recruiter
  matrix in isolation (pure functions, no DB).
- **Fast route tests** (dependency-override `CurrentClaims`/`CurrentRecruiter` + fake
  session/repo): admin can't manage admin/owner; recruiter can't manage; transfer/delete
  owner-only; invite rejects `owner` role (422); PATCH to `owner` rejected (422); accept
  email-mismatch → 403; accept non-pending → 409.
- **Integration tests** (`@pytest.mark.integration`, live DB, FK-safe cleanup): full
  invite → accept creates a member with the invite's role and marks the invite accepted;
  re-invite revokes the prior pending invite; transfer-ownership swaps roles and
  `owner_recruiter_id`; delete-org cascade removes invitations + members + org; token
  lookup/accept match on hash and never persist the raw token.
- **Frontend:** manual in-browser (owner invites → copy link → second account accepts →
  appears in roster → role change → remove → transfer → delete) + `pnpm tsc --noEmit` +
  `pnpm lint`.

## Notes / follow-ups carried forward

- **Member removal & future candidate data.** Removing a member or deleting an org today
  touches only invitations + members. Once candidates/jobs/applications exist, removal must
  reassign or cascade their `recruiter_id`/`org_id` rows — design that with slice 4+.
- **Self-service "leave org"** is intentionally deferred; for now an owner/admin removes a
  member, and the owner exits only via transfer-then-removal or org deletion.
- The integration-test transaction-rollback fixture (see `docs/todos.md` follow-ups)
  remains deferred; this slice keeps the explicit FK-safe cleanup pattern in integration
  tests in the meantime.
