import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_claims
from callup.auth.jwt import TokenClaims
from callup.db.models import User
from callup.db.session import get_session
from callup.main import app

SUB = uuid.uuid4()


def _claims() -> TokenClaims:
    return TokenClaims(sub=SUB, email="jane@example.com")


class _SessionWithUser:
    async def get(self, model, pk):
        return User(
            id=SUB, org_id=uuid.uuid4(), role="owner", name="Jane", email="jane@example.com"
        )


class _SessionNoUser:
    async def get(self, model, pk):
        return None


async def _post_orgs(body, session_override=None):
    app.dependency_overrides[get_current_claims] = _claims
    if session_override is not None:
        app.dependency_overrides[get_session] = session_override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/orgs", json=body)
    finally:
        app.dependency_overrides.clear()


async def test_create_org_conflicts_when_already_onboarded():
    resp = await _post_orgs(
        {"org_name": "Acme", "display_name": "Jane"}, lambda: _SessionWithUser()
    )
    assert resp.status_code == 409


async def test_create_org_rejects_blank_name():
    resp = await _post_orgs({"org_name": "   ", "display_name": "Jane"}, lambda: _SessionNoUser())
    assert resp.status_code == 422


async def test_create_org_requires_token():
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/orgs", json={"org_name": "Acme", "display_name": "Jane"})
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 401
