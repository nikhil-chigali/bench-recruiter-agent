"""Supabase Auth Admin API client. Deletes auth users (service-key authenticated)."""

import logging
import uuid

import httpx

from callup import secrets
from callup.config import settings

logger = logging.getLogger(__name__)


async def delete_auth_users(ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Delete Supabase auth users by id. Returns the ids that failed (already logged).

    A 200/204/404 counts as success (404 = already deleted). Other statuses and network
    errors are logged and collected — one failure never aborts the rest.
    """
    if not ids:
        return []
    base = settings.supabase_url
    if not base:
        raise RuntimeError("supabase_url is not configured")
    key = secrets.supabase_service_key()
    failed: list[uuid.UUID] = []
    async with httpx.AsyncClient(
        base_url=base.rstrip("/"),
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=10.0,
    ) as client:
        for uid in ids:
            try:
                resp = await client.delete(f"/auth/v1/admin/users/{uid}")
            except httpx.HTTPError as exc:
                logger.warning("auth user delete network error for %s: %s", uid, exc)
                failed.append(uid)
                continue
            if resp.status_code in (200, 204, 404):
                continue
            logger.warning("auth user delete failed for %s: HTTP %s", uid, resp.status_code)
            failed.append(uid)
    return failed
