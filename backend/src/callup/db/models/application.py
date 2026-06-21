import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from callup.db.base import Base, TenantMixin, TimestampMixin
from callup.db.enums import ApplicationStatus, OutreachEmailStatus


class Application(Base, TenantMixin, TimestampMixin):
    __tablename__ = "application"
    __table_args__ = (
        UniqueConstraint("candidate_id", "job_posting_id", name="uq_application_candidate_job"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("candidate.id"), index=True, nullable=False
    )
    job_posting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_posting.id"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, default=ApplicationStatus.DRAFT.value
    )
    applied_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_by: Mapped[str | None] = mapped_column(String)  # agent | human
    outreach_email_status: Mapped[str] = mapped_column(
        String, nullable=False, default=OutreachEmailStatus.NOT_SENT.value
    )
    outreach_email_body: Mapped[str | None] = mapped_column(Text)
    resume_storage_path: Mapped[str | None] = mapped_column(Text)  # Supabase Storage
