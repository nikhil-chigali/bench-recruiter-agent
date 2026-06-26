import datetime as _dt
import uuid

from pydantic import BaseModel


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    org_id: uuid.UUID
    org_name: str


class MemberOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    status: str
    expires_at: _dt.datetime


class InvitationCreatedOut(InvitationOut):
    accept_url: str


class InvitationPreviewOut(BaseModel):
    org_name: str
    role: str
    email: str
    status: str
    email_matches: bool


class CandidateCard(BaseModel):
    id: uuid.UUID
    name: str
    title: str | None
    status: str
    work_authorization: str | None
    years_experience: int
    location: str | None
    primary_skills: list[str]
    recruiter_id: uuid.UUID
    recruiter_name: str


class ExperienceOut(BaseModel):
    id: uuid.UUID
    company: str
    position: str | None
    start_date: _dt.date | None
    end_date: _dt.date | None
    description: list[str] | None
    tech_stack: list[str] | None


class EducationOut(BaseModel):
    id: uuid.UUID
    university: str
    location: str | None
    degree: str | None
    cgpa: float | None
    coursework: str | None
    start_date: _dt.date | None
    end_date: _dt.date | None


class ProjectOut(BaseModel):
    id: uuid.UUID
    title: str
    project_link: str | None
    github_link: str | None
    description: list[str] | None
    tech_stack: list[str] | None


class CertificationOut(BaseModel):
    id: uuid.UUID
    name: str
    issued_by: str | None
    badge_url: str | None
    issued_on: _dt.date | None
    verification_url: str | None


class CandidateDetail(BaseModel):
    id: uuid.UUID
    name: str
    title: str | None
    status: str
    work_authorization: str | None
    years_experience: int
    location: str | None
    primary_skills: list[str]
    recruiter_id: uuid.UUID
    recruiter_name: str
    email: str | None
    phone: str | None
    linkedin_url: str | None
    github_url: str | None
    portfolio_url: str | None
    summary: str | None
    experience: list[ExperienceOut]
    education: list[EducationOut]
    projects: list[ProjectOut]
    certifications: list[CertificationOut]
