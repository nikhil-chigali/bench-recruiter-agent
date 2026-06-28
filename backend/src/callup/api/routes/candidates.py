import uuid
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from callup.api.deps import CurrentUser, SessionDep
from callup.api.schemas import (
    CandidateCard,
    CandidateCreate,
    CandidateDetail,
    CandidateUpdate,
    CertificationIn,
    CertificationOut,
    DocumentOut,
    DocumentUrlOut,
    EducationIn,
    EducationOut,
    ExperienceIn,
    ExperienceOut,
    ProjectIn,
    ProjectOut,
)
from callup.db import repositories
from callup.db.enums import DocumentType, RecruiterRole
from callup.db.models import Candidate, User
from callup.services import storage
from callup.services.candidates.roster import years_of_experience

router = APIRouter(tags=["candidates"])


def _ensure_access(actor: User, candidate: Candidate) -> None:
    """A recruiter may touch only their own candidates; owner/admin may touch any in the org."""
    if actor.role == RecruiterRole.RECRUITER.value and candidate.user_id != actor.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")


async def _resolve_assignee(
    actor: User, requested_user_id: uuid.UUID | None, session: AsyncSession
) -> uuid.UUID:
    """Who the new candidate is assigned to. Recruiters are forced to themselves; owner/admin
    may pick any member of their org (defaulting to self)."""
    if actor.role == RecruiterRole.RECRUITER.value:
        return actor.id
    if requested_user_id is None:
        return actor.id
    member = await repositories.get_member(session, requested_user_id, actor.org_id)
    if member is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "assignee is not a member of this org")
    return member.id


# Content-type → stored file extension. The authoritative allow-list for uploads.
_ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


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


def _detail(c: Candidate, recruiter_name: str) -> CandidateDetail:
    return CandidateDetail(
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
        email=c.email,
        phone=c.phone,
        linkedin_url=c.linkedin_url,
        github_url=c.github_url,
        portfolio_url=c.portfolio_url,
        summary=c.summary,
        experience=[
            ExperienceOut(
                id=e.id,
                company=e.company,
                position=e.position,
                start_date=e.start_date,
                end_date=e.end_date,
                description=e.description,
                tech_stack=e.tech_stack,
            )
            for e in c.experience
        ],
        education=[
            EducationOut(
                id=ed.id,
                university=ed.university,
                location=ed.location,
                degree=ed.degree,
                cgpa=float(ed.cgpa) if ed.cgpa is not None else None,
                coursework=ed.coursework,
                start_date=ed.start_date,
                end_date=ed.end_date,
            )
            for ed in c.education
        ],
        projects=[
            ProjectOut(
                id=p.id,
                title=p.title,
                project_link=p.project_link,
                github_link=p.github_link,
                description=p.description,
                tech_stack=p.tech_stack,
            )
            for p in c.projects
        ],
        certifications=[
            CertificationOut(
                id=ct.id,
                name=ct.name,
                issued_by=ct.issued_by,
                badge_url=ct.badge_url,
                issued_on=ct.issued_on,
                verification_url=ct.verification_url,
            )
            for ct in c.certifications
        ],
        documents=[
            DocumentOut(
                id=d.id,
                doc_type=d.doc_type,
                filename=d.filename,
                created_at=d.created_at,
            )
            for d in c.documents
        ],
    )


@router.get("/candidates", response_model=list[CandidateCard])
async def list_candidates(actor: CurrentUser, session: SessionDep) -> list[CandidateCard]:
    # A recruiter sees only their own bench; owner/admin see the whole org.
    scope_user_id = actor.id if actor.role == RecruiterRole.RECRUITER.value else None
    candidates = await repositories.list_candidates(session, actor.org_id, scope_user_id)
    members = await repositories.list_members(session, actor.org_id)
    name_by_id = {m.id: m.name for m in members}
    return [_card(c, name_by_id.get(c.user_id, "—")) for c in candidates]


@router.post("/candidates", response_model=CandidateDetail, status_code=status.HTTP_201_CREATED)
async def create_candidate(
    body: CandidateCreate, actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    assignee_id = await _resolve_assignee(actor, body.user_id, session)
    candidate = await repositories.create_candidate(session, actor.org_id, assignee_id, body)
    member = await repositories.get_member(session, candidate.user_id, actor.org_id)
    return _detail(candidate, member.name if member is not None else "—")


@router.get("/candidates/{candidate_id}", response_model=CandidateDetail)
async def get_candidate(
    candidate_id: uuid.UUID, actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    member = await repositories.get_member(session, candidate.user_id, actor.org_id)
    return _detail(candidate, member.name if member is not None else "—")


@router.patch("/candidates/{candidate_id}", response_model=CandidateDetail)
async def update_candidate(
    candidate_id: uuid.UUID,
    body: CandidateUpdate,
    actor: CurrentUser,
    session: SessionDep,
) -> CandidateDetail:
    candidate = await repositories.get_candidate(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    changes = body.model_dump(exclude_unset=True)
    if "user_id" in changes:
        # Reassignment is owner/admin only, and only to a member of the actor's org.
        if actor.role == RecruiterRole.RECRUITER.value:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "only owner/admin may reassign")
        member = await repositories.get_member(session, changes["user_id"], actor.org_id)
        if member is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "assignee is not a member of this org")
    updated = await repositories.update_candidate(session, candidate, changes)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.put("/candidates/{candidate_id}/experience", response_model=CandidateDetail)
async def replace_experience(
    candidate_id: uuid.UUID, body: list[ExperienceIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_experience(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.put("/candidates/{candidate_id}/education", response_model=CandidateDetail)
async def replace_education(
    candidate_id: uuid.UUID, body: list[EducationIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_education(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.put("/candidates/{candidate_id}/projects", response_model=CandidateDetail)
async def replace_projects(
    candidate_id: uuid.UUID, body: list[ProjectIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_projects(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.put("/candidates/{candidate_id}/certifications", response_model=CandidateDetail)
async def replace_certifications(
    candidate_id: uuid.UUID, body: list[CertificationIn], actor: CurrentUser, session: SessionDep
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    updated = await repositories.replace_certifications(session, candidate, body)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.post(
    "/candidates/{candidate_id}/documents",
    response_model=CandidateDetail,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    candidate_id: uuid.UUID,
    actor: CurrentUser,
    session: SessionDep,
    file: UploadFile,
    doc_type: Annotated[DocumentType, Form()],
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported file type")
    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file exceeds 10 MB limit")
    path = f"{actor.org_id}/{candidate_id}/{uuid.uuid4()}{ext}"
    await storage.upload(path, content, file.content_type)
    updated = await repositories.add_document(
        session, candidate, doc_type.value, path, file.filename
    )
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")


@router.get(
    "/candidates/{candidate_id}/documents/{document_id}/download",
    response_model=DocumentUrlOut,
)
async def download_document(
    candidate_id: uuid.UUID,
    document_id: uuid.UUID,
    actor: CurrentUser,
    session: SessionDep,
) -> DocumentUrlOut:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    doc = next((d for d in candidate.documents if d.id == document_id), None)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    url = await storage.create_signed_url(doc.storage_path)
    return DocumentUrlOut(url=url)


@router.delete(
    "/candidates/{candidate_id}/documents/{document_id}", response_model=CandidateDetail
)
async def delete_document(
    candidate_id: uuid.UUID,
    document_id: uuid.UUID,
    actor: CurrentUser,
    session: SessionDep,
) -> CandidateDetail:
    candidate = await repositories.get_candidate_detail(session, candidate_id, actor.org_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    _ensure_access(actor, candidate)
    doc = next((d for d in candidate.documents if d.id == document_id), None)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    await storage.remove(doc.storage_path)
    updated = await repositories.delete_document(session, candidate, document_id)
    member = await repositories.get_member(session, updated.user_id, actor.org_id)
    return _detail(updated, member.name if member is not None else "—")
