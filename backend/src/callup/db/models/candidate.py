import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from callup.db.base import Base, TenantMixin, TimestampMixin


class Candidate(Base, TenantMixin, TimestampMixin):
    __tablename__ = "candidate"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    github_url: Mapped[str | None] = mapped_column(Text)
    portfolio_url: Mapped[str | None] = mapped_column(Text)
    other_urls: Mapped[list | None] = mapped_column(JSONB)
    work_authorization: Mapped[str | None] = mapped_column(String)
    summary: Mapped[str | None] = mapped_column(Text)

    education: Mapped[list["CandidateEducation"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    experience: Mapped[list["CandidateExperience"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    certifications: Mapped[list["CandidateCertification"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    projects: Mapped[list["CandidateProject"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    documents: Mapped[list["CandidateDocument"]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )


class CandidateEducation(Base, TenantMixin, TimestampMixin):
    __tablename__ = "candidate_education"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidate.id", ondelete="CASCADE"), index=True
    )
    university: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[str | None] = mapped_column(Text)
    degree: Mapped[str | None] = mapped_column(Text)
    cgpa: Mapped[float | None] = mapped_column(Numeric(4, 2))
    coursework: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    candidate: Mapped["Candidate"] = relationship(back_populates="education")


class CandidateExperience(Base, TenantMixin, TimestampMixin):
    __tablename__ = "candidate_experience"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidate.id", ondelete="CASCADE"), index=True
    )
    company: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[list | None] = mapped_column(JSONB)  # string[] of bullets
    tech_stack: Mapped[list | None] = mapped_column(JSONB)  # string[]

    candidate: Mapped["Candidate"] = relationship(back_populates="experience")


class CandidateCertification(Base, TenantMixin, TimestampMixin):
    __tablename__ = "candidate_certification"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidate.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    issued_by: Mapped[str | None] = mapped_column(Text)
    badge_url: Mapped[str | None] = mapped_column(Text)
    issued_on: Mapped[date | None] = mapped_column(Date)
    verification_url: Mapped[str | None] = mapped_column(Text)

    candidate: Mapped["Candidate"] = relationship(back_populates="certifications")


class CandidateProject(Base, TenantMixin, TimestampMixin):
    __tablename__ = "candidate_project"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidate.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    project_link: Mapped[str | None] = mapped_column(Text)
    github_link: Mapped[str | None] = mapped_column(Text)
    description: Mapped[list | None] = mapped_column(JSONB)  # string[] of bullets
    tech_stack: Mapped[list | None] = mapped_column(JSONB)  # string[]

    candidate: Mapped["Candidate"] = relationship(back_populates="projects")


class CandidateDocument(Base, TenantMixin, TimestampMixin):
    __tablename__ = "candidate_document"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidate.id", ondelete="CASCADE"), index=True
    )
    doc_type: Mapped[str] = mapped_column(String, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)  # Supabase Storage
    filename: Mapped[str | None] = mapped_column(Text)

    candidate: Mapped["Candidate"] = relationship(back_populates="documents")
