"""add candidate status

Adds the ``candidate.status`` pipeline-stage column (stored as a plain string token,
validated at the boundary via ``callup.db.enums.CandidateStatus``). Values: ``on_bench``,
``interviewing``, ``placed``. NOT NULL with a server default of ``on_bench`` so the column
adds cleanly and every candidate always has a status.

Revision ID: 62800661e14c
Revises: b1d2e3f40512
Create Date: 2026-06-25 19:03:09.927084

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "62800661e14c"
down_revision: Union[str, Sequence[str], None] = "b1d2e3f40512"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "candidate",
        sa.Column("status", sa.String(), nullable=False, server_default="on_bench"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("candidate", "status")
