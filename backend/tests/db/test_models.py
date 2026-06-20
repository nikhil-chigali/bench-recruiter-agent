from callup.db.enums import InvitationStatus
from callup.db.models import Base, Invitation


def test_invitation_status_values():
    assert {s.value for s in InvitationStatus} == {"pending", "accepted", "revoked"}


def test_invitation_table_registered():
    table = Base.metadata.tables["invitation"]
    expected = {
        "id",
        "org_id",
        "email",
        "role",
        "token_hash",
        "status",
        "invited_by",
        "expires_at",
        "accepted_at",
        "accepted_by",
        "created_at",
        "updated_at",
    }
    assert expected <= set(table.columns.keys())
    assert table.columns["token_hash"].unique is True


def test_invitation_model_importable():
    assert Invitation.__tablename__ == "invitation"
