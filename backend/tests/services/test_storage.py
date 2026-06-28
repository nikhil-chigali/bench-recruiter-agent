import httpx
import pytest

from callup.services import storage


def _mock(handler):
    """Patch storage._client to return an AsyncClient backed by a MockTransport."""
    transport = httpx.MockTransport(handler)
    return lambda: httpx.AsyncClient(
        transport=transport, base_url=f"{storage.settings.supabase_url}/storage/v1"
    )


async def test_upload_puts_bytes_with_auth_and_content_type(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["ctype"] = request.headers.get("content-type")
        seen["body"] = request.content
        return httpx.Response(200, json={"Key": "ok"})

    monkeypatch.setattr(storage, "_client", _mock(handler))
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")

    await storage.upload("org/cand/abc.pdf", b"PDFBYTES", "application/pdf")

    assert seen["method"] == "POST"
    assert seen["url"].endswith(f"/object/{storage.settings.storage_bucket}/org/cand/abc.pdf")
    assert seen["auth"] == "Bearer svc-key"
    assert seen["ctype"] == "application/pdf"
    assert seen["body"] == b"PDFBYTES"


async def test_create_signed_url_builds_absolute_url(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        body = {"signedURL": "/object/sign/bucket/org/cand/abc.pdf?token=t"}
        return httpx.Response(200, json=body)

    monkeypatch.setattr(storage, "_client", _mock(handler))
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")

    url = await storage.create_signed_url("org/cand/abc.pdf", expires_in=300)
    assert url == (
        f"{storage.settings.supabase_url}/storage/v1"
        "/object/sign/bucket/org/cand/abc.pdf?token=t"
    )


async def test_remove_issues_delete(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["url"] = str(request.url)
        return httpx.Response(200, json={})

    monkeypatch.setattr(storage, "_client", _mock(handler))
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")

    await storage.remove("org/cand/abc.pdf")
    assert seen["method"] == "DELETE"
    assert seen["url"].endswith(f"/object/{storage.settings.storage_bucket}/org/cand/abc.pdf")


async def test_upload_raises_on_error_status(monkeypatch):
    monkeypatch.setattr(
        storage, "_client", _mock(lambda r: httpx.Response(403, json={"error": "denied"}))
    )
    monkeypatch.setattr(storage, "supabase_service_key", lambda: "svc-key")
    with pytest.raises(httpx.HTTPStatusError):
        await storage.upload("org/cand/abc.pdf", b"x", "application/pdf")
