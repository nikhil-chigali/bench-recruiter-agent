import uuid
from datetime import date

from sqlalchemy import Date, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from callup.db.base import Base, TenantMixin, TimestampMixin


class JobPosting(Base, TenantMixin, TimestampMixin):
    __tablename__ = "job_posting"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    work_authorization: Mapped[str | None] = mapped_column(String)  # required/accepted
    posted_date: Mapped[date | None] = mapped_column(Date)
    employment_type: Mapped[str | None] = mapped_column(String)
    company: Mapped[str | None] = mapped_column(Text)  # hiring company
    # Hiring-side recruiter the BSR emails outreach to (not the bench-sales recruiter).
    contact_name: Mapped[str | None] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(Text)
    contact_company: Mapped[str | None] = mapped_column(Text)
