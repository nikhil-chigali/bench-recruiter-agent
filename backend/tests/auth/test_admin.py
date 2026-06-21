import uuid

import httpx
import pytest

from callup.auth import admin
from callup.config import settings

OK = uuid.uuid4()
GONE = uuid.uuid4()
FAIL = uuid.uuid4()


def _patch(monkeypatch, captured):
    monkeypatch.setattr(settings, "supabase_url", "http://test")
    monkeypatch.setattr(settings, "supabase_service_key", "svc-key")
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        uid = request.url.path.rsplit("/", 1)[-1]
        if uid == str(FAIL):
            return httpx.Response(500)
        if uid == str(GONE):
            return httpx.Response(404)
        return httpx.Response(204)

    def fake_client(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(**kwargs)

    monkeypatch.setattr(admin.httpx, "AsyncClient", fake_client)


async def test_delete_auth_users_success_and_failures(monkeypatch):
    captured: list[httpx.Request] = []
    _patch(monkeypatch, captured)
    failed = await admin.delete_auth_users([OK, GONE, FAIL])
    assert failed == [FAIL]  # 200/204/404 succeed; 500 fails
    assert len(captured) == 3
    for req in captured:
        assert req.headers["apikey"] == "svc-key"
        assert req.headers["authorization"] == "Bearer svc-key"
        assert req.url.path.startswith("/auth/v1/admin/users/")


async def test_delete_auth_users_empty_is_noop(monkeypatch):
    captured: list[httpx.Request] = []
    _patch(monkeypatch, captured)
    assert await admin.delete_auth_users([]) == []
    assert captured == []


async def test_delete_auth_users_raises_without_key(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "http://test")
    monkeypatch.setattr(settings, "supabase_service_key", None)
    with pytest.raises(RuntimeError):
        await admin.delete_auth_users([OK])
