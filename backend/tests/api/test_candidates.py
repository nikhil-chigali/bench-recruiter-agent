import uuid
from datetime import date

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_user
from callup.db import repositories
from callup.db.models import Candidate, CandidateExperience, User
from callup.db.session import get_session
from callup.main import app

ORG = uuid.uuid4()
ACTOR = uuid.uuid4()


def _actor(role: str) -> User:
    return User(id=ACTOR, org_id=ORG, role=role, name="Actor", email="a@example.com")


class _Session:
    async def get(self, model, pk):
        return None


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_recruiter_scoped_to_self(monkeypatch):
    captured = {}

    async def fake_list_candidates(session, org_id, user_id=None):
        captured["user_id"] = user_id
        return []

    async def fake_list_members(session, org_id):
        return []

    monkeypatch.setattr(repositories, "list_candidates", fake_list_candidates)
    monkeypatch.setattr(repositories, "list_members", fake_list_members)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get("/candidates")
        assert resp.status_code == 200
        assert captured["user_id"] == ACTOR
    finally:
        app.dependency_overrides.clear()


async def test_owner_sees_whole_org(monkeypatch):
    captured = {}

    async def fake_list_candidates(session, org_id, user_id=None):
        captured["user_id"] = user_id
        return []

    async def fake_list_members(session, org_id):
        return []

    monkeypatch.setattr(repositories, "list_candidates", fake_list_candidates)
    monkeypatch.setattr(repositories, "list_members", fake_list_members)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get("/candidates")
        assert resp.status_code == 200
        assert captured["user_id"] is None
    finally:
        app.dependency_overrides.clear()


async def test_card_shape_and_derived_years(monkeypatch):
    cand = Candidate(
        id=uuid.uuid4(),
        org_id=ORG,
        user_id=ACTOR,
        name="Arjun Mehta",
        title="Sr. Java Developer",
        status="on_bench",
        work_authorization="H1B",
        location="Dallas, TX",
        primary_skills=["Java", "Spring Boot"],
    )
    cand.experience = [CandidateExperience(start_date=date(2016, 1, 1), end_date=date(2025, 1, 1))]

    async def fake_list_candidates(session, org_id, user_id=None):
        return [cand]

    async def fake_list_members(session, org_id):
        return [_actor("recruiter")]

    monkeypatch.setattr(repositories, "list_candidates", fake_list_candidates)
    monkeypatch.setattr(repositories, "list_members", fake_list_members)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get("/candidates")
        assert resp.status_code == 200
        card = resp.json()[0]
        assert card["name"] == "Arjun Mehta"
        assert card["title"] == "Sr. Java Developer"
        assert card["status"] == "on_bench"
        assert card["years_experience"] == 9
        assert card["primary_skills"] == ["Java", "Spring Boot"]
        assert card["recruiter_id"] == str(ACTOR)
        assert card["recruiter_name"] == "Actor"
    finally:
        app.dependency_overrides.clear()


CAND = uuid.uuid4()
OTHER = uuid.uuid4()


def _candidate(owner_id: uuid.UUID, status: str = "on_bench") -> Candidate:
    cand = Candidate(
        id=CAND,
        org_id=ORG,
        user_id=owner_id,
        name="Arjun Mehta",
        title="Sr. Java Developer",
        status=status,
        work_authorization="H1B",
        location="Dallas, TX",
        primary_skills=["Java"],
    )
    cand.experience = []
    return cand


async def test_recruiter_patches_own_candidate(monkeypatch):
    called = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update_status(session, candidate, new_status):
        called["status"] = new_status
        candidate.status = new_status
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate_status", fake_update_status)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "interviewing"})
        assert resp.status_code == 200
        assert called["status"] == "interviewing"
        assert resp.json()["status"] == "interviewing"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_patch_others_candidate(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update_status(session, candidate, new_status):
        called["updated"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate_status", fake_update_status)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 403
        assert called["updated"] is False
    finally:
        app.dependency_overrides.clear()


async def test_owner_patches_any_candidate(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update_status(session, candidate, new_status):
        candidate.status = new_status
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return User(id=OTHER, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate_status", fake_update_status)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "placed"
        assert resp.json()["recruiter_name"] == "Other Rec"
    finally:
        app.dependency_overrides.clear()


async def test_patch_unknown_candidate_returns_404(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return None

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_patch_invalid_status_returns_422(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "bogus"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()
