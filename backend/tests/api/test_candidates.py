import uuid
from datetime import date

from httpx import ASGITransport, AsyncClient

from callup.api.deps import get_current_user
from callup.db import repositories
from callup.db.models import (
    Candidate,
    CandidateCertification,
    CandidateEducation,
    CandidateExperience,
    CandidateProject,
    User,
)
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


async def test_recruiter_patches_own_status(monkeypatch):
    captured = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        captured["changes"] = changes
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "interviewing"})
        assert resp.status_code == 200
        assert captured["changes"] == {"status": "interviewing"}
        assert resp.json()["status"] == "interviewing"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_edits_own_overview(monkeypatch):
    captured = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        captured["changes"] = changes
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(
                f"/candidates/{CAND}",
                json={
                    "name": "  Arjun M.  ",
                    "title": "Staff Engineer",
                    "primary_skills": ["Go", "  ", "Rust"],
                    "summary": "  Backend.  ",
                    "location": "",
                },
            )
        assert resp.status_code == 200
        changes = captured["changes"]
        assert changes["name"] == "Arjun M."  # trimmed
        assert changes["title"] == "Staff Engineer"
        assert changes["primary_skills"] == ["Go", "Rust"]  # blanks dropped
        assert changes["summary"] == "Backend."  # trimmed
        assert changes["location"] is None  # blank → cleared
        assert "user_id" not in changes  # not sent → not touched
        assert resp.json()["name"] == "Arjun M."
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_patch_others_candidate(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update(session, candidate, changes):
        called["updated"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"status": "placed"})
        assert resp.status_code == 403
        assert called["updated"] is False
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_reassign_returns_403(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)  # the recruiter's OWN candidate

    async def fake_update(session, candidate, changes):
        called["updated"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"user_id": str(OTHER)})
        assert resp.status_code == 403  # reassignment is owner/admin only
        assert called["updated"] is False
    finally:
        app.dependency_overrides.clear()


async def test_owner_patches_any_candidate(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(OTHER)

    async def fake_update(session, candidate, changes):
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return User(id=OTHER, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
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


async def test_owner_reassigns_to_member(monkeypatch):
    captured = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        captured["changes"] = changes
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return User(
            id=user_id, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com"
        )

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"user_id": str(OTHER)})
        assert resp.status_code == 200
        assert captured["changes"]["user_id"] == OTHER
        assert resp.json()["recruiter_id"] == str(OTHER)
        assert resp.json()["recruiter_name"] == "Other Rec"
    finally:
        app.dependency_overrides.clear()


async def test_owner_reassign_to_non_member_returns_400(monkeypatch):
    called = {"updated": False}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        called["updated"] = True
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return None  # requested assignee is not a member of this org

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"user_id": str(OTHER)})
        assert resp.status_code == 400
        assert called["updated"] is False
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


async def test_patch_blank_title_returns_422(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"title": "   "})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_patch_invalid_work_auth_returns_422(monkeypatch):
    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(f"/candidates/{CAND}", json={"work_authorization": "NOPE"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_patch_ignores_unknown_fields(monkeypatch):
    # CandidateUpdate (Pydantic default extra="ignore") drops unknown keys, so identity/derived
    # columns sent by a client never reach the repository's setattr loop.
    captured = {}

    async def fake_get_candidate(session, candidate_id, org_id):
        return _candidate(ACTOR)

    async def fake_update(session, candidate, changes):
        captured["changes"] = changes
        for k, v in changes.items():
            setattr(candidate, k, v)
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate", fake_get_candidate)
    monkeypatch.setattr(repositories, "update_candidate", fake_update)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.patch(
                f"/candidates/{CAND}",
                json={
                    "status": "placed",
                    "org_id": str(uuid.uuid4()),
                    "years_experience": 99,
                    "id": str(uuid.uuid4()),
                },
            )
        assert resp.status_code == 200
        assert captured["changes"] == {"status": "placed"}  # unknown keys dropped, never written
    finally:
        app.dependency_overrides.clear()


def _detailed_candidate(owner_id: uuid.UUID) -> Candidate:
    cand = _candidate(owner_id)
    cand.email = "arjun@example.com"
    cand.phone = "555-0100"
    cand.linkedin_url = "https://linkedin.com/in/arjun"
    cand.github_url = None
    cand.portfolio_url = None
    cand.summary = "Backend engineer."
    cand.experience = [
        CandidateExperience(
            id=uuid.uuid4(),
            company="Acme",
            position="Senior Dev",
            start_date=date(2016, 1, 1),
            end_date=date(2025, 1, 1),
            description=["Built X"],
            tech_stack=["Java"],
        )
    ]
    cand.education = [
        CandidateEducation(
            id=uuid.uuid4(),
            university="MIT",
            location="Cambridge, MA",
            degree="BS CS",
            cgpa=None,
            coursework=None,
            start_date=None,
            end_date=None,
        )
    ]
    cand.projects = [
        CandidateProject(
            id=uuid.uuid4(),
            title="Callup",
            project_link=None,
            github_link=None,
            description=["Did Y"],
            tech_stack=["Go"],
        )
    ]
    cand.certifications = [
        CandidateCertification(
            id=uuid.uuid4(),
            name="AWS SAA",
            issued_by="AWS",
            badge_url=None,
            issued_on=date(2022, 6, 1),
            verification_url=None,
        )
    ]
    return cand


async def test_get_candidate_detail_shape(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary"] == "Backend engineer."
        assert body["years_experience"] == 9
        assert body["recruiter_name"] == "Actor"
        assert body["linkedin_url"] == "https://linkedin.com/in/arjun"
        assert len(body["experience"]) == 1
        assert body["experience"][0]["company"] == "Acme"
        assert body["experience"][0]["tech_stack"] == ["Java"]
        assert len(body["education"]) == 1
        assert body["education"][0]["university"] == "MIT"
        assert len(body["projects"]) == 1
        assert len(body["certifications"]) == 1
        assert body["certifications"][0]["name"] == "AWS SAA"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_gets_own_detail(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 200
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_cannot_get_others_detail(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(OTHER)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


async def test_get_unknown_candidate_returns_404(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return None

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.get(f"/candidates/{CAND}")
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_creates_self_assigned(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["user_id"] = user_id
        captured["name"] = data.name
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "New Cand", "title": "Engineer"})
        assert resp.status_code == 201
        assert captured["user_id"] == ACTOR
        assert captured["name"] == "New Cand"
    finally:
        app.dependency_overrides.clear()


async def test_recruiter_ignores_requested_assignee(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["user_id"] = user_id
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/candidates", json={"name": "X", "title": "Y", "user_id": str(OTHER)}
            )
        assert resp.status_code == 201
        assert captured["user_id"] == ACTOR  # recruiter forced to self, body user_id ignored
    finally:
        app.dependency_overrides.clear()


async def test_owner_creates_with_explicit_assignee(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["user_id"] = user_id
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return User(
            id=user_id, org_id=ORG, role="recruiter", name="Other Rec", email="o@example.com"
        )

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/candidates", json={"name": "X", "title": "Y", "user_id": str(OTHER)}
            )
        assert resp.status_code == 201
        assert captured["user_id"] == OTHER
        assert resp.json()["recruiter_name"] == "Other Rec"
    finally:
        app.dependency_overrides.clear()


async def test_owner_assignee_not_member_returns_400(monkeypatch):
    called = {"created": False}

    async def fake_create(session, org_id, user_id, data):
        called["created"] = True
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return None  # requested assignee is not a member of this org

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/candidates", json={"name": "X", "title": "Y", "user_id": str(OTHER)}
            )
        assert resp.status_code == 400
        assert called["created"] is False
    finally:
        app.dependency_overrides.clear()


async def test_create_persists_children(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["data"] = data
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/candidates",
                json={
                    "name": "X",
                    "title": "Y",
                    "primary_skills": ["Go", "  ", "Rust"],
                    "experience": [
                        {
                            "company": "Acme",
                            "position": "Dev",
                            "start_date": "2020-01-01",
                            "end_date": "2022-01-01",
                        }
                    ],
                    "education": [{"university": "MIT", "degree": "BS"}],
                    "projects": [{"title": "P1"}],
                    "certifications": [{"name": "AWS"}],
                },
            )
        assert resp.status_code == 201
        data = captured["data"]
        assert data.primary_skills == ["Go", "Rust"]  # blanks dropped, order preserved
        assert len(data.experience) == 1 and data.experience[0].company == "Acme"
        assert len(data.education) == 1 and data.education[0].university == "MIT"
        assert len(data.projects) == 1 and data.projects[0].title == "P1"
        assert len(data.certifications) == 1 and data.certifications[0].name == "AWS"
    finally:
        app.dependency_overrides.clear()


async def test_create_requires_title_returns_422(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "X", "title": "   "})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_create_requires_name_returns_422(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "   ", "title": "Y"})
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_create_rejects_invalid_work_authorization_returns_422(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post(
                "/candidates",
                json={"name": "X", "title": "Y", "work_authorization": "NOPE"},
            )
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_owner_with_no_assignee_defaults_to_self(monkeypatch):
    captured = {}

    async def fake_create(session, org_id, user_id, data):
        captured["user_id"] = user_id
        return _detailed_candidate(user_id)

    async def fake_get_member(session, user_id, org_id):
        return _actor("owner")

    monkeypatch.setattr(repositories, "create_candidate", fake_create)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.post("/candidates", json={"name": "X", "title": "Y"})
        assert resp.status_code == 201
        assert captured["user_id"] == ACTOR  # no body user_id → owner assigned to self
    finally:
        app.dependency_overrides.clear()


async def test_replace_experience_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_experience", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/experience",
                json=[
                    {
                        "company": "Acme",
                        "position": "Dev",
                        "start_date": "2020-01-01",
                        "end_date": "2022-01-01",
                        "description": ["Built X", "  "],
                        "tech_stack": ["Go", " ", "Rust"],
                    }
                ],
            )
        assert resp.status_code == 200
        items = captured["items"]
        assert len(items) == 1
        assert items[0].company == "Acme"
        assert items[0].description == ["Built X"]  # blanks dropped
        assert items[0].tech_stack == ["Go", "Rust"]
    finally:
        app.dependency_overrides.clear()


async def test_replace_education_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_education", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/education",
                json=[{"university": "MIT", "degree": "BS", "cgpa": 3.9, "location": "MA"}],
            )
        assert resp.status_code == 200
        assert captured["items"][0].university == "MIT"
        assert captured["items"][0].cgpa == 3.9
    finally:
        app.dependency_overrides.clear()


async def test_replace_projects_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_projects", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/projects",
                json=[{"title": "P1", "github_link": "https://gh/p1", "tech_stack": ["Go"]}],
            )
        assert resp.status_code == 200
        assert captured["items"][0].title == "P1"
        assert captured["items"][0].tech_stack == ["Go"]
    finally:
        app.dependency_overrides.clear()


async def test_replace_certifications_success(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_certifications", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/certifications",
                json=[{"name": "AWS SAA", "issued_by": "Amazon", "issued_on": "2023-05-01"}],
            )
        assert resp.status_code == 200
        assert captured["items"][0].name == "AWS SAA"
        assert captured["items"][0].issued_on == date(2023, 5, 1)
    finally:
        app.dependency_overrides.clear()


async def test_replace_section_empty_list_clears(monkeypatch):
    captured = {}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    async def fake_replace(session, candidate, items):
        captured["items"] = items
        return candidate

    async def fake_get_member(session, user_id, org_id):
        return _actor("recruiter")

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_experience", fake_replace)
    monkeypatch.setattr(repositories, "get_member", fake_get_member)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/experience", json=[])
        assert resp.status_code == 200
        assert captured["items"] == []
    finally:
        app.dependency_overrides.clear()


async def test_replace_recruiter_cannot_edit_others_children(monkeypatch):
    called = {"replaced": False}

    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(OTHER)  # another recruiter's candidate

    async def fake_replace(session, candidate, items):
        called["replaced"] = True
        return candidate

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    monkeypatch.setattr(repositories, "replace_experience", fake_replace)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/experience", json=[])
        assert resp.status_code == 403
        assert called["replaced"] is False
    finally:
        app.dependency_overrides.clear()


async def test_replace_cross_org_candidate_returns_404(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return None  # org-scoped fetch misses → not in this org

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("owner")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/projects", json=[])
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_replace_experience_missing_company_returns_422(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(f"/candidates/{CAND}/experience", json=[{"position": "Dev"}])
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_replace_experience_bad_dates_returns_422(monkeypatch):
    async def fake_get_detail(session, candidate_id, org_id):
        return _detailed_candidate(ACTOR)

    monkeypatch.setattr(repositories, "get_candidate_detail", fake_get_detail)
    app.dependency_overrides[get_current_user] = lambda: _actor("recruiter")
    app.dependency_overrides[get_session] = lambda: _Session()
    try:
        async with await _client() as c:
            resp = await c.put(
                f"/candidates/{CAND}/experience",
                json=[{"company": "Acme", "start_date": "2022-01-01", "end_date": "2020-01-01"}],
            )
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.clear()
