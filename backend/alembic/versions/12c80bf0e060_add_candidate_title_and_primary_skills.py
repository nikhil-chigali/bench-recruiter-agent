"""add candidate title and primary_skills

Adds two headline columns to ``candidate``: ``title`` (nullable text — the candidate's
role/headline, e.g. "Sr. Java Developer") and ``primary_skills`` (jsonb ``string[]``,
NOT NULL default ``[]``). Both are validated/required at the create API boundary in a later
chunk. ``years_experience`` is intentionally *not* stored — it is derived on read from
``candidate_experience`` date ranges.

Revision ID: 12c80bf0e060
Revises: 62800661e14c
Create Date: 2026-06-25 21:22:10.215248

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "12c80bf0e060"
down_revision: Union[str, Sequence[str], None] = "62800661e14c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("candidate", sa.Column("title", sa.Text(), nullable=True))
    op.add_column(
        "candidate",
        sa.Column(
            "primary_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("candidate", "primary_skills")
    op.drop_column("candidate", "title")
