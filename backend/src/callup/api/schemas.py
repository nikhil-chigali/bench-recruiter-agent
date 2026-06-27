import datetime as _dt
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

from callup.db.enums import CandidateStatus, WorkAuthorization

_WORK_AUTHS = {w.value for w in WorkAuthorization}
_STATUSES = {s.value for s in CandidateStatus}


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


def _clean_str_list(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    return [s.strip() for s in v if s and s.strip()]


class ExperienceIn(BaseModel):
    company: str
    position: str | None = None
    start_date: _dt.date | None = None
    end_date: _dt.date | None = None
    description: list[str] | None = None
    tech_stack: list[str] | None = None

    @field_validator("company")
    @classmethod
    def _company(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company is required")
        return v

    @field_validator("description", "tech_stack")
    @classmethod
    def _lists(cls, v: list[str] | None) -> list[str] | None:
        return _clean_str_list(v)

    @model_validator(mode="after")
    def _dates(self) -> "ExperienceIn":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class EducationIn(BaseModel):
    university: str
    degree: str | None = None
    location: str | None = None
    cgpa: float | None = None
    coursework: str | None = None
    start_date: _dt.date | None = None
    end_date: _dt.date | None = None

    @field_validator("university")
    @classmethod
    def _university(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("university is required")
        return v

    @field_validator("degree", "location", "coursework")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _dates(self) -> "EducationIn":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class ProjectIn(BaseModel):
    title: str
    project_link: str | None = None
    github_link: str | None = None
    description: list[str] | None = None
    tech_stack: list[str] | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title is required")
        return v

    @field_validator("project_link", "github_link")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("description", "tech_stack")
    @classmethod
    def _lists(cls, v: list[str] | None) -> list[str] | None:
        return _clean_str_list(v)


class CertificationIn(BaseModel):
    name: str
    issued_by: str | None = None
    badge_url: str | None = None
    issued_on: _dt.date | None = None
    verification_url: str | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("issued_by", "badge_url", "verification_url")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class CandidateCreate(BaseModel):
    name: str
    title: str
    primary_skills: list[str] = Field(default_factory=list)
    work_authorization: str | None = None
    location: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_url: str | None = None
    summary: str | None = None
    user_id: uuid.UUID | None = None
    experience: list[ExperienceIn] = Field(default_factory=list)
    education: list[EducationIn] = Field(default_factory=list)
    projects: list[ProjectIn] = Field(default_factory=list)
    certifications: list[CertificationIn] = Field(default_factory=list)

    @field_validator("name", "title")
    @classmethod
    def _required_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 200:
            raise ValueError("must be at most 200 characters")
        return v

    @field_validator(
        "location", "email", "phone", "linkedin_url", "github_url", "portfolio_url", "summary"
    )
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("work_authorization")
    @classmethod
    def _work_auth(cls, v: str | None) -> str | None:
        if not v:
            return None
        if v not in _WORK_AUTHS:
            raise ValueError("invalid work authorization")
        return v

    @field_validator("primary_skills")
    @classmethod
    def _skills(cls, v: list[str]) -> list[str]:
        return [s.strip() for s in v if s and s.strip()]


class CandidateUpdate(BaseModel):
    """Partial update for a candidate's Overview + assignee. Every field is optional; only the
    fields the client actually sends are applied (the route uses ``model_dump(exclude_unset=True)``).
    """

    status: str | None = None
    name: str | None = None
    title: str | None = None
    primary_skills: list[str] | None = None
    work_authorization: str | None = None
    location: str | None = None
    summary: str | None = None
    user_id: uuid.UUID | None = None

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("status must not be null")
        if v not in _STATUSES:
            raise ValueError("status must be on_bench, interviewing, or placed")
        return v

    @field_validator("name", "title")
    @classmethod
    def _required_text(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("must not be null")
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 200:
            raise ValueError("must be at most 200 characters")
        return v

    @field_validator("location", "summary")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @field_validator("work_authorization")
    @classmethod
    def _work_auth(cls, v: str | None) -> str | None:
        if not v:
            return None
        if v not in _WORK_AUTHS:
            raise ValueError("invalid work authorization")
        return v

    @field_validator("primary_skills")
    @classmethod
    def _skills(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        return [s.strip() for s in v if s and s.strip()]
