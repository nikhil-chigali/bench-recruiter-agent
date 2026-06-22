"""rename recruiter to users

Renames the ``recruiter`` entity table to ``users`` and the FK columns that point at
it (``org.owner_recruiter_id`` -> ``owner_user_id``, ``candidate.recruiter_id`` ->
``user_id``). The ``recruiter`` *role* value (owner/admin/recruiter) is unchanged — only
the entity/table is renamed. Data-preserving: pure renames, no drops or recreates.

Revision ID: b1d2e3f40512
Revises: e3546d70251d
Create Date: 2026-06-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b1d2e3f40512'
down_revision: Union[str, Sequence[str], None] = 'e3546d70251d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.rename_table("recruiter", "users")
    op.alter_column("org", "owner_recruiter_id", new_column_name="owner_user_id")
    op.alter_column("candidate", "recruiter_id", new_column_name="user_id")

    # Plain indexes keep their old names after a table rename — realign them with the
    # SQLAlchemy-generated names (op.f("ix_<table>_<col>")) so autogenerate sees no drift.
    op.execute("ALTER INDEX ix_recruiter_org_id RENAME TO ix_users_org_id")
    op.execute("ALTER INDEX ix_candidate_recruiter_id RENAME TO ix_candidate_user_id")

    # Constraints likewise keep their old names; rename so the schema reads as `users`.
    op.execute("ALTER TABLE org RENAME CONSTRAINT fk_org_owner_recruiter TO fk_org_owner_user")
    op.execute("ALTER TABLE users RENAME CONSTRAINT recruiter_pkey TO users_pkey")
    op.execute("ALTER TABLE users RENAME CONSTRAINT recruiter_email_key TO users_email_key")
    op.execute("ALTER TABLE users RENAME CONSTRAINT recruiter_org_id_fkey TO users_org_id_fkey")
    op.execute(
        "ALTER TABLE candidate "
        "RENAME CONSTRAINT candidate_recruiter_id_fkey TO candidate_user_id_fkey"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        "ALTER TABLE candidate "
        "RENAME CONSTRAINT candidate_user_id_fkey TO candidate_recruiter_id_fkey"
    )
    op.execute("ALTER TABLE users RENAME CONSTRAINT users_org_id_fkey TO recruiter_org_id_fkey")
    op.execute("ALTER TABLE users RENAME CONSTRAINT users_email_key TO recruiter_email_key")
    op.execute("ALTER TABLE users RENAME CONSTRAINT users_pkey TO recruiter_pkey")
    op.execute("ALTER TABLE org RENAME CONSTRAINT fk_org_owner_user TO fk_org_owner_recruiter")

    op.execute("ALTER INDEX ix_candidate_user_id RENAME TO ix_candidate_recruiter_id")
    op.execute("ALTER INDEX ix_users_org_id RENAME TO ix_recruiter_org_id")

    op.alter_column("candidate", "user_id", new_column_name="recruiter_id")
    op.alter_column("org", "owner_user_id", new_column_name="owner_recruiter_id")
    op.rename_table("users", "recruiter")
