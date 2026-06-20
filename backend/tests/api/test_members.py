import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_recruiter
from callup.db import repositories
from callup.db.models import Recruiter
from callup.db.session import get_session
from callup.main import app

ORG = uuid.uuid4()
ACTOR = uuid.uuid4()
TARGET = uuid.uuid4()


def _actor(role: str) -> Recruiter:
    return Recruiter(id=ACTOR, org_id=ORG, role=role, name="Actor", email="actor@example.com")


def _target(role: str) -> Recruiter:
    return Recruiter(id=TARGET, org_id=ORG, role=role, name="Target", email="t@example.com")


class _Session:
    async def get(self, model, pk):
        return None


async def _client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_admin_cannot_change_admin_role(monkeypatch):
    async def fake_get_member(session, rid, org_id):
        return _target("admin")

    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("admin")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/members/{TARGET}", json={"role": "recruiter"})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_cannot_remove_owner(monkeypatch):
    async def fake_get_member(session, rid, org_id):
        return _target("owner")

    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.delete(f"/members/{TARGET}")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_patch_to_owner_rejected():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/members/{TARGET}", json={"role": "owner"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_transfer_requires_owner():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("admin")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/orgs/transfer-ownership", json={"recruiter_id": str(TARGET)})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_delete_org_requires_owner():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.delete("/orgs/current")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()
