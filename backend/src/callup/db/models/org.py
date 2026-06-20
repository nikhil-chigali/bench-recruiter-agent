import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from callup.db.base import Base, TenantMixin, TimestampMixin
from callup.db.enums import RecruiterRole


class Org(Base, TimestampMixin):
    """The tenant. org_id on every other table points here."""

    __tablename__ = "org"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # Circular with recruiter.org_id; use_alter defers this FK to after both tables exist.
    owner_recruiter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recruiter.id", use_alter=True, name="fk_org_owner_recruiter"),
        nullable=True,
    )


class Recruiter(Base, TenantMixin, TimestampMixin):
    """A bench-sales recruiter (org member). id equals the Supabase auth user id."""

    __tablename__ = "recruiter"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role: Mapped[str] = mapped_column(String, nullable=False, default=RecruiterRole.RECRUITER.value)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
