import uuid

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_claims
from callup.auth.jwt import TokenClaims
from callup.db.models import Org, Recruiter
from callup.db.session import get_session
from callup.main import app

SUB = uuid.uuid4()
ORG_ID = uuid.uuid4()


def _claims() -> TokenClaims:
    return TokenClaims(sub=SUB, email="jane@example.com")


class _SessionWithRecruiter:
    async def get(self, model, pk):
        if model is Recruiter:
            return Recruiter(
                id=SUB, org_id=ORG_ID, role="owner", name="Jane", email="jane@example.com"
            )
        if model is Org:
            return Org(id=pk, name="Acme workspace")
        return None


class _SessionNoRecruiter:
    async def get(self, model, pk):
        return None


async def _get_me(overrides):
    for dep, override in overrides.items():
        app.dependency_overrides[dep] = override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get("/me")
    finally:
        app.dependency_overrides.clear()


async def test_me_onboarded_returns_profile():
    resp = await _get_me(
        {get_current_claims: _claims, get_session: lambda: _SessionWithRecruiter()}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarded"] is True
    assert body["recruiter"]["email"] == "jane@example.com"
    assert body["recruiter"]["role"] == "owner"
    assert body["recruiter"]["org_name"] == "Acme workspace"
    assert "token" not in body


async def test_me_not_onboarded_returns_flag():
    resp = await _get_me({get_current_claims: _claims, get_session: lambda: _SessionNoRecruiter()})
    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarded"] is False
    assert body["recruiter"] is None


async def test_me_without_token_is_unauthorized():
    resp = await _get_me({})
    assert resp.status_code == 401
