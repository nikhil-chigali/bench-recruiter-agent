import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_recruiter
from callup.db.models import Org, Recruiter
from callup.db.session import get_session
from callup.main import app


class _FakeSession:
    async def get(self, model, pk):
        return Org(id=pk, name="Acme workspace")


def _fake_recruiter() -> Recruiter:
    return Recruiter(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        role="owner",
        name="Jane",
        email="jane@example.com",
    )


async def test_me_returns_recruiter_profile():
    recruiter = _fake_recruiter()
    app.dependency_overrides[get_current_recruiter] = lambda: recruiter
    app.dependency_overrides[get_session] = lambda: _FakeSession()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/me")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "jane@example.com"
    assert body["role"] == "owner"
    assert body["org_name"] == "Acme workspace"
    assert "token" not in body


async def test_me_without_token_is_unauthorized():
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/me")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 401
