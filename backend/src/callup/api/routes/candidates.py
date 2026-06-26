import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from callup.api.deps import CurrentUser, SessionDep
from callup.api.schemas import CandidateCard
from callup.db import repositories
from callup.db.enums import CandidateStatus, RecruiterRole
from callup.db.models import Candidate
from callup.services.candidates.roster import years_of_experience

router = APIRouter(tags=["candidates"])

_CANDIDATE_STATUSES = {s.value for s in CandidateStatus}


class CandidateStatusUpdateIn(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in _CANDIDATE_STATUSES:
            raise ValueError("status must be on_bench, interviewing, or placed")
        return v


def _card(c: Candidate, recruiter_name: str) -> CandidateCard:
    return CandidateCard(
        id=c.id,
        name=c.name,
        title=c.title,
        status=c.status,
        work_authorization=c.work_authorization,
        years_experience=years_of_experience(c.experience),
        location=c.location,
        primary_skills=c.primary_skills,
        recruiter_id=c.user_id,
        recruiter_name=recruiter_name,
    )


@router.get("/candidates", response_model=list[CandidateCard])
async def list_candidates(actor: CurrentUser, session: SessionDep) -> list[CandidateCard]:
    # A recruiter sees only their own bench; owner/admin see the whole org.
    scope_user_id = actor.id if actor.role == RecruiterRole.RECRUITER.value else None
    candidates = await repositories.list_candidates(session, actor.org_id, scope_user_id)
    members = await repositories.list_members(session, actor.org_id)
    name_by_id = {m.id: m.name for m in members}
    return [_card(c, name_by_id.get(c.user_id, "—")) for c in candidates]


@router.patch("/candidates/{candidate_id}", response_model=CandidateCard)
async def update_candidate(
    candidate_id: uuid.UUID,
    body: CandidateStatusUpdateIn,
    actor: CurrentUser,
    session: SessionDep,
) -> CandidateCard:
    candidate = await repositories.get_candidate(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    # A recruiter may edit only their own candidates; owner/admin may edit any in the org.
    if actor.role == RecruiterRole.RECRUITER.value and candidate.user_id != actor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
    updated = await repositories.update_candidate_status(session, candidate, body.status)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _card(updated, member.name if member is not None else "—")
