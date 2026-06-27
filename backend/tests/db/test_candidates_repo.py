import uuid
from datetime import date

import pytest
from sqlalchemy import delete, update

from callup.api.schemas import (
    CandidateCreate,
    CertificationIn,
    EducationIn,
    ExperienceIn,
    ProjectIn,
)
from callup.db import repositories
from callup.db.models import Candidate, Org, User
from callup.db.session import SessionFactory

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]


async def _cleanup(candidate_id: uuid.UUID | None, rid: uuid.UUID, org_id: uuid.UUID) -> None:
    async with SessionFactory() as s:
        # Children carry ON DELETE CASCADE, so deleting the candidate removes them too.
        if candidate_id is not None:
            await s.execute(delete(Candidate).where(Candidate.id == candidate_id))
        # Null the circular FK before deleting the user row the org references.
        await s.execute(update(Org).where(Org.id == org_id).values(owner_user_id=None))
        await s.execute(delete(User).where(User.id == rid))
        await s.execute(delete(Org).where(Org.id == org_id))
        await s.commit()


async def test_create_candidate_persists_graph_and_reloads_detail():
    rid = uuid.uuid4()
    email = f"{rid}@example.com"
    org_id = None
    candidate_id = None
    try:
        async with SessionFactory() as session:
            owner = await repositories.create_owned_org(
                session, rid, email, "Acme Staffing", "Jane Doe"
            )
            org_id = owner.org_id

        data = CandidateCreate(
            name="New Cand",
            title="Senior Engineer",
            primary_skills=["Go", "Rust"],
            work_authorization="USC",
            location="Austin, TX",
            email="cand@example.com",
            phone="555-0100",
            experience=[
                ExperienceIn(
                    company="Acme",
                    position="Dev",
                    start_date=date(2020, 1, 1),
                    end_date=date(2022, 1, 1),
                )
            ],
            education=[EducationIn(university="MIT", degree="BS")],
            projects=[ProjectIn(title="P1", project_link="https://p1.example.com")],
            certifications=[CertificationIn(name="AWS", issued_by="Amazon")],
        )

        async with SessionFactory() as session:
            created = await repositories.create_candidate(session, org_id, rid, data)
            candidate_id = created.id
            assert created.org_id == org_id
            assert created.user_id == rid
            assert created.status == "on_bench"

        # Re-fetch in a fresh session to prove the graph actually persisted (not just
        # the in-memory objects from create_candidate's own re-fetch).
        async with SessionFactory() as session:
            detail = await repositories.get_candidate_detail(session, candidate_id, org_id)
            assert detail is not None
            assert detail.title == "Senior Engineer"
            assert detail.primary_skills == ["Go", "Rust"]
            assert detail.work_authorization == "USC"

            assert len(detail.experience) == 1
            assert detail.experience[0].company == "Acme"
            assert detail.experience[0].position == "Dev"
            assert detail.experience[0].start_date == date(2020, 1, 1)
            assert detail.experience[0].org_id == org_id

            assert len(detail.education) == 1
            assert detail.education[0].university == "MIT"
            assert detail.education[0].org_id == org_id

            assert len(detail.projects) == 1
            assert detail.projects[0].title == "P1"
            assert detail.projects[0].org_id == org_id

            assert len(detail.certifications) == 1
            assert detail.certifications[0].name == "AWS"
            assert detail.certifications[0].org_id == org_id
    finally:
        if org_id is not None:
            await _cleanup(candidate_id, rid, org_id)
