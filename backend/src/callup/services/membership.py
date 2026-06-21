"""Orchestrates member/org deletion across the DB and Supabase auth.

Routes stay thin and SQL stays in repositories; this layer sequences the DB delete
(transactional) and the best-effort auth-account deletion.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from callup.auth import admin as auth_admin
from callup.db import repositories
from callup.db.models import Org, Recruiter


async def remove_member(session: AsyncSession, member: Recruiter) -> None:
    await repositories.remove_member(session, member)
    await auth_admin.delete_auth_users([member.id])


async def delete_org(session: AsyncSession, org: Org) -> None:
    members = await repositories.list_members(session, org.id)
    ids = [m.id for m in members]
    await repositories.delete_org(session, org)
    await auth_admin.delete_auth_users(ids)
