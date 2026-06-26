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
