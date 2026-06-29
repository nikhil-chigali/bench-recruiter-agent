"""Supabase Storage REST client. The only module that uploads/serves candidate document bytes.

A thin httpx wrapper (no SDK) over the Storage REST API, authenticated with the service-role
key resolved via ``secrets`` — which therefore never leaves the backend. The bucket is private;
downloads are handed out only as short-lived signed URLs.
"""

import httpx

from callup.config import settings
from callup.secrets import supabase_service_key


def _client() -> httpx.AsyncClient:
    """The HTTP client for Storage calls. A test seam: tests patch this to inject a transport."""
    return httpx.AsyncClient(base_url=f"{settings.supabase_url}/storage/v1")


def _auth() -> dict[str, str]:
    key = supabase_service_key()
    return {"Authorization": f"Bearer {key}", "apikey": key}


async def upload(path: str, content: bytes, content_type: str) -> None:
    """Store ``content`` at ``path`` within the bucket. Raises on a non-2xx response."""
    async with _client() as client:
        resp = await client.post(
            f"/object/{settings.storage_bucket}/{path}",
            content=content,
            headers={**_auth(), "Content-Type": content_type},
        )
        resp.raise_for_status()


async def create_signed_url(path: str, expires_in: int = 300) -> str:
    """Return an absolute, time-limited download URL for ``path``."""
    async with _client() as client:
        resp = await client.post(
            f"/object/sign/{settings.storage_bucket}/{path}",
            json={"expiresIn": expires_in},
            headers=_auth(),
        )
        resp.raise_for_status()
        signed = resp.json()["signedURL"]
    return f"{settings.supabase_url}/storage/v1{signed}"


async def remove(path: str) -> None:
    """Delete the object at ``path``. Raises on a non-2xx response."""
    async with _client() as client:
        resp = await client.delete(f"/object/{settings.storage_bucket}/{path}", headers=_auth())
        resp.raise_for_status()
