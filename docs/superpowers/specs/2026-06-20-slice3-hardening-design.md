# Slice 3 hardening — design

Date: 2026-06-20
Status: approved — ready for implementation plan

Follow-up hardening on slice 3 (team invitations & roles), driven by end-to-end browser
testing. Four changes: tighten the admin invite UI, add confirmation steps to the two
destructive member actions, fix a foreign-key bug that broke member removal, and extend
both removal paths to delete the underlying Supabase auth accounts.

## Motivation

E2E testing surfaced one critical bug and three UX gaps:

- **Remove member is broken.** `repositories.remove_member` does a bare `DELETE recruiter`,
  which violates `invitation_accepted_by_fkey` (and `invitation_invited_by_fkey`) for any
  member referenced by an invitation row — i.e. every member who accepted an invite. The
  500 reached the browser as a misleading "Failed to fetch" (CORS headers are not applied
  to unhandled-exception responses).
- Admins are shown an "admin" option when inviting, even though the backend 403s it.
- Role changes apply instantly with no confirmation.
- Removing a member / deleting an org leaves the members' Supabase auth login accounts
  behind in `auth.users`.

## Decisions (confirmed)

- **Org deletion deletes all members' auth accounts, including the owner's own.** After a
  successful delete the owner is signed out to `/login`.
- **Removing a single member also deletes that member's auth account.** They cannot sign
  back in; they would have to sign up fresh.
- Role-change confirmation is a lightweight inline Confirm/Cancel; member removal uses a
  modal dialog with a typed `remove` gate.

## Scope

**In:** role-gated invite dropdown; inline role-change confirmation; remove-member FK fix;
typed-confirmation remove dialog; a Supabase auth-admin client; a membership service that
orchestrates DB deletion + auth-account deletion for remove-member and delete-org; the
post-delete sign-out on the frontend.

**Out:** changing how invitation history is retained beyond what the FK fix requires; any
CORS-on-500 middleware change (the 500 disappears once the FK bug is fixed; the broader
"surface 500s through CORS" item stays a tracked follow-up); bulk member operations.

## Item 1 — Role-gated invite dropdown (frontend only)

`frontend/src/components/InvitesSection.tsx`. The role `<Select>` options depend on the
current user's role from `useProfile()`:

- owner → `recruiter`, `admin`
- admin → `recruiter` only

Default selected role stays `recruiter`. The backend already rejects an admin inviting an
admin (403); this removes the dead option so the UI matches the rule.

## Item 2 — Role-change confirmation (frontend only)

`frontend/src/components/MembersSection.tsx`. Today the per-row role `<Select>` PATCHes
immediately in `onValueChange`. Replace with a pending model:

- Selecting a new role sets a per-row `pendingRole` (keyed by member id) and reveals inline
  **Confirm** and **Cancel** buttons next to that row's select.
- **Confirm** fires `PATCH /members/{id} {role: pendingRole}`, then `load()` and clears the
  pending state.
- **Cancel** clears the pending state; the select reverts to the member's current role.
- The select shows `pendingRole` when set, otherwise the member's stored role.

No new primitive. Errors continue to surface via the existing `setError`.

## Item 3 — Remove member: FK fix + typed-confirmation dialog

### Backend FK fix — `repositories.remove_member`

`invited_by` is `NOT NULL`, so its reference cannot be nulled. Before deleting the
recruiter row, delete the invitation rows that reference the member from either side:

```python
async def remove_member(session: AsyncSession, member: Recruiter) -> None:
    await session.execute(
        delete(Invitation).where(
            or_(Invitation.invited_by == member.id, Invitation.accepted_by == member.id)
        )
    )
    await session.delete(member)
    await session.commit()
```

(`or_` imported from `sqlalchemy`.) This mirrors `delete_org`, which already clears
invitations before recruiters. Deleting the member's associated invitation records is
acceptable — they are history tied to a member who is being removed.

### Frontend dialog — `MembersSection.tsx` + shadcn `dialog`

Add the shadcn `dialog` primitive (`pnpm dlx shadcn@latest add dialog`). The per-row
**Remove** button opens a modal (a React modal, never a native browser dialog):

- The dialog names the member ("Remove Test Recruiter2 (rec2@org.com)?") and warns the
  action also deletes their login account and cannot be undone.
- A text input requires the exact word `remove` to enable the destructive confirm button.
- Confirm fires `DELETE /members/{id}`, then `load()` and closes the dialog; the input
  resets on open/close. Cancel/close discards.

## Item 4 — Auth-account deletion (backend)

Both remove-member and delete-org delete the relevant Supabase auth accounts via the Auth
Admin API. Routes stay thin; SQL stays in repositories; the external HTTP call and the
DB+auth orchestration live in new modules.

### `secrets.supabase_service_key()`

Add an accessor in `callup/secrets.py` returning `settings.supabase_service_key`. Raise a
clear error if it is unset (the two delete endpoints require it). The key is resolved only
here and never logged or returned.

### `callup/auth/admin.py` — auth-admin client

```python
async def delete_auth_users(ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Delete Supabase auth users by id. Returns the ids that failed (already logged)."""
```

- `DELETE {settings.supabase_url}/auth/v1/admin/users/{id}` via `httpx.AsyncClient`
  (already a dependency), headers `apikey: {key}` and `Authorization: Bearer {key}`.
- Status `200`/`204` and `404` (already gone) count as success.
- Other statuses / network errors: collect the id into the failed list and `log` it; do not
  raise (one failure must not abort the rest).
- Empty `ids` → no-op, returns `[]`.

### `services/membership.py` — orchestration

```python
async def remove_member(session, member) -> None:
    await repositories.remove_member(session, member)        # DB first (transactional)
    await auth_admin.delete_auth_users([member.id])          # then auth, best-effort

async def delete_org(session, org) -> None:
    members = await repositories.list_members(session, org.id)
    ids = [m.id for m in members]                            # capture before delete
    await repositories.delete_org(session, org)              # DB cascade
    await auth_admin.delete_auth_users(ids)                  # all members incl. owner
```

DB rows are deleted first so the app stays consistent even if an auth deletion fails; failed
auth deletions are logged (worst case: an orphaned `auth.users` row — the pre-existing
state, now logged instead of silent).

### Routes

- `DELETE /members/{member_id}` (`api/routes/members.py`): keep the `get_member` lookup +
  `ensure_can_manage(actor, member.role)` checks, then call `membership.remove_member`
  instead of `repositories.remove_member`.
- `DELETE /orgs/current` (`api/routes/orgs.py`): keep `ensure_owner`, then call
  `membership.delete_org` instead of `repositories.delete_org`.

### Frontend — post-delete sign-out

`frontend/src/components/DangerZone.tsx`: on successful `DELETE /orgs/current`, call
`signOut()` (from `useAuth`) so the owner — whose own account is now deleted — lands on
`/login`, instead of `refresh()` → `/onboarding`. (A `/me` call with the deleted account's
token would 401 and sign out anyway; doing it explicitly is cleaner.)

## Data flow

remove: route checks perms → `membership.remove_member` → repo deletes referencing
invitations + recruiter (commit) → `delete_auth_users([id])`.

delete-org: route checks owner → `membership.delete_org` → capture member ids → repo
cascade (null owner FK → invitations → recruiters → org, commit) → `delete_auth_users(ids)`
→ frontend `signOut()` → `/login`.

## Error handling

| Case | Behavior |
|------|----------|
| Remove member referenced by an invitation | FK fix deletes referencing invitations first; succeeds |
| Auth Admin API 404 for an id | treated as already-deleted (success) |
| Auth Admin API 5xx / network error | id collected + logged; request still returns success |
| `supabase_service_key` unset | `secrets.supabase_service_key()` raises (fail-fast); endpoints 500 |
| Admin selects `admin` in invite dropdown | option not shown (owner-only) |
| Role change without Confirm | no PATCH sent; Cancel reverts the select |
| Remove dialog without typing `remove` | confirm button disabled |

## Testing

Per `backend/CLAUDE.md` (unit-first; fast suite no DB/network) and `frontend/CLAUDE.md`
(no frontend tests):

- **Auth-admin client** (fast): with `httpx` transport mocked, assert the correct URL +
  headers per id, `404` treated as success, and a `5xx` id returned in the failed list (not
  raised).
- **Membership service** (fast): with `repositories` and `auth_admin.delete_auth_users`
  monkeypatched, assert `remove_member` deletes DB then calls `delete_auth_users([id])`, and
  `delete_org` captures member ids before the cascade and calls `delete_auth_users` with all
  of them.
- **Route tests** (fast): existing permission paths unchanged; `DELETE /members/{id}` and
  `DELETE /orgs/current` happy paths with the membership service monkeypatched.
- **Integration** (`@pytest.mark.integration`, live DB, auth-admin mocked): `remove_member`
  repo succeeds for a member whose `accepted_by`/`invited_by` is referenced by an invitation
  (the FK regression) — seed org + owner + a member who accepted an invite, remove, assert
  no FK error and the recruiter + referencing invitations are gone.
- **Frontend**: manual — invite dropdown by role, role-change Confirm/Cancel, remove dialog
  typed gate, and post-org-delete sign-out to `/login`.

## Notes / follow-ups

- The CORS-on-500 surfacing (a 500 reaches the browser as "Failed to fetch" because CORS
  headers are not applied to unhandled-exception responses) remains a tracked follow-up; it
  is not needed here because the FK fix removes this slice's 500.
- Auth deletion is non-transactional with the DB by nature; the best-effort + log approach
  is the chosen trade-off. A reconciliation/cleanup job for orphaned auth accounts is out of
  scope.
