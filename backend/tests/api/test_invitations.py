import uuid
from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError

from callup.api.deps import get_current_claims, get_current_recruiter
from callup.auth.jwt import TokenClaims
from callup.db import repositories
from callup.db.models import Invitation, Org, Recruiter
from callup.db.session import get_session
from callup.main import app

SUB = uuid.uuid4()
ORG = uuid.uuid4()


def _claims() -> TokenClaims:
    return TokenClaims(sub=SUB, email="actor@example.com")


def _actor(role: str) -> Recruiter:
    return Recruiter(id=SUB, org_id=ORG, role=role, name="Actor", email="actor@example.com")


class _SessionNoRecruiter:
    async def get(self, model, pk):
        return None


async def _client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_invite_rejects_owner_role():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("owner")
    try:
        async with await _client() as c:
            resp = await c.post("/invitations", json={"email": "a@x.com", "role": "owner"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_admin_cannot_invite_admin():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("admin")
    try:
        async with await _client() as c:
            resp = await c.post("/invitations", json={"email": "a@x.com", "role": "admin"})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_list_invitations():
    app.dependency_overrides[get_current_recruiter] = lambda: _actor("recruiter")
    try:
        async with await _client() as c:
            resp = await c.get("/invitations")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_accept_email_mismatch(monkeypatch):
    inv = Invitation(
        id=uuid.uuid4(),
        org_id=ORG,
        email="other@example.com",
        role="recruiter",
        invited_by=uuid.uuid4(),
        token_hash="h",
        status="pending",
        expires_at=datetime.now(tz=UTC) + timedelta(days=7),
    )

    async def fake_lookup(session, token_hash):
        return inv

    monkeypatch.setattr(repositories, "get_invitation_by_token_hash", fake_lookup)
    app.dependency_overrides[get_current_claims] = _claims
    app.dependency_overrides[get_session] = lambda: _SessionNoRecruiter()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/invitations/accept", json={"token": "raw", "display_name": "Actor"}
            )
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_accept_non_pending_conflicts(monkeypatch):
    inv = Invitation(
        id=uuid.uuid4(),
        org_id=ORG,
        email="actor@example.com",
        role="recruiter",
        invited_by=uuid.uuid4(),
        token_hash="h",
        status="revoked",
        expires_at=datetime.now(tz=UTC) + timedelta(days=7),
    )

    async def fake_lookup(session, token_hash):
        return inv

    monkeypatch.setattr(repositories, "get_invitation_by_token_hash", fake_lookup)
    app.dependency_overrides[get_current_claims] = _claims
    app.dependency_overrides[get_session] = lambda: _SessionNoRecruiter()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/invitations/accept", json={"token": "raw", "display_name": "Actor"}
            )
        assert resp.status_code == 409
    finally:
        app.dependency_overrides.clear()


async def test_accept_expired_conflicts(monkeypatch):
    inv = Invitation(
        id=uuid.uuid4(),
        org_id=ORG,
        email="actor@example.com",
        role="recruiter",
        invited_by=uuid.uuid4(),
        token_hash="h",
        status="pending",
        expires_at=datetime.now(tz=UTC) - timedelta(days=1),
    )

    async def fake_lookup(session, token_hash):
        return inv

    monkeypatch.setattr(repositories, "get_invitation_by_token_hash", fake_lookup)
    app.dependency_overrides[get_current_claims] = _claims
    app.dependency_overrides[get_session] = lambda: _SessionNoRecruiter()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/invitations/accept", json={"token": "raw", "display_name": "Actor"}
            )
        assert resp.status_code == 409
    finally:
        app.dependency_overrides.clear()


async def test_lookup_returns_expired_status(monkeypatch):
    inv = Invitation(
        id=uuid.uuid4(),
        org_id=ORG,
        email="actor@example.com",
        role="recruiter",
        invited_by=uuid.uuid4(),
        token_hash="h",
        status="pending",
        expires_at=datetime.now(tz=UTC) - timedelta(days=1),
    )

    async def fake_lookup(session, token_hash):
        return inv

    class _SessionWithOrg:
        async def get(self, model, pk):
            if model is Org:
                return Org(id=ORG, name="Acme")
            return None

    monkeypatch.setattr(repositories, "get_invitation_by_token_hash", fake_lookup)
    app.dependency_overrides[get_current_claims] = _claims
    app.dependency_overrides[get_session] = lambda: _SessionWithOrg()
    try:
        async with await _client() as c:
            resp = await c.get("/invitations/lookup?token=raw")
        assert resp.status_code == 200
        assert resp.json()["status"] == "expired"
    finally:
        app.dependency_overrides.clear()


async def test_accept_race_conflicts(monkeypatch):
    inv = Invitation(
        id=uuid.uuid4(),
        org_id=ORG,
        email="actor@example.com",
        role="recruiter",
        invited_by=uuid.uuid4(),
        token_hash="h",
        status="pending",
        expires_at=datetime.now(tz=UTC) + timedelta(days=7),
    )

    async def fake_lookup(session, token_hash):
        return inv

    async def fake_accept(*args, **kwargs):
        raise IntegrityError("stmt", {}, Exception("dup"))

    monkeypatch.setattr(repositories, "get_invitation_by_token_hash", fake_lookup)
    monkeypatch.setattr(repositories, "accept_invitation", fake_accept)
    app.dependency_overrides[get_current_claims] = _claims
    app.dependency_overrides[get_session] = lambda: _SessionNoRecruiter()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/invitations/accept", json={"token": "raw", "display_name": "Actor"}
            )
        assert resp.status_code == 409
    finally:
        app.dependency_overrides.clear()
