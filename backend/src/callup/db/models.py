import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base. Business tables register on ``Base.metadata`` and are picked
    up by Alembic autogenerate (see ``alembic/env.py``)."""


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TenantMixin:
    # org_id ships on every business table from the first migration even though MVP runs
    # single-org. Enabling multi-recruiter is RLS + middleware, never a column-shape change.
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)


# Business models (Candidate, JobPosting, FitmentScore, ...) land per phase.
