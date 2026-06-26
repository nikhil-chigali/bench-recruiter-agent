from fastapi import APIRouter

from callup.api.deps import CurrentUser, SessionDep
from callup.api.schemas import CandidateCard
from callup.db import repositories
from callup.db.enums import RecruiterRole
from callup.services.candidates.roster import years_of_experience

router = APIRouter(tags=["candidates"])


@router.get("/candidates", response_model=list[CandidateCard])
async def list_candidates(actor: CurrentUser, session: SessionDep) -> list[CandidateCard]:
    # A recruiter sees only their own bench; owner/admin see the whole org.
    scope_user_id = actor.id if actor.role == RecruiterRole.RECRUITER.value else None
    candidates = await repositories.list_candidates(session, actor.org_id, scope_user_id)
    members = await repositories.list_members(session, actor.org_id)
    name_by_id = {m.id: m.name for m in members}
    return [
        CandidateCard(
            id=c.id,
            name=c.name,
            title=c.title,
            status=c.status,
            work_authorization=c.work_authorization,
            years_experience=years_of_experience(c.experience),
            location=c.location,
            primary_skills=c.primary_skills,
            recruiter_id=c.user_id,
            recruiter_name=name_by_id.get(c.user_id, "—"),
        )
        for c in candidates
    ]
