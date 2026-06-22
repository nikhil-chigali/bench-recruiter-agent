import uuid

from callup.db.models import Org, User
from callup.services import membership

OID = uuid.uuid4()
M1 = uuid.uuid4()
M2 = uuid.uuid4()


async def test_remove_member_deletes_db_then_auth(monkeypatch):
    order: list = []

    async def fake_remove(session, member):
        order.append(("db", member.id))

    async def fake_del(ids):
        order.append(("auth", list(ids)))
        return []

    monkeypatch.setattr(membership.repositories, "remove_member", fake_remove)
    monkeypatch.setattr(membership.auth_admin, "delete_auth_users", fake_del)

    member = User(id=M1, org_id=OID, role="recruiter", name="M", email="m@e.com")
    await membership.remove_member(object(), member)
    assert order == [("db", M1), ("auth", [M1])]


async def test_delete_org_captures_ids_then_cascades(monkeypatch):
    members = [
        User(id=M1, org_id=OID, role="owner", name="O", email="o@e.com"),
        User(id=M2, org_id=OID, role="recruiter", name="R", email="r@e.com"),
    ]
    order: list = []

    async def fake_list(session, org_id):
        order.append(("list", org_id))
        return members

    async def fake_delete_org(session, org):
        order.append(("db", org.id))

    async def fake_del(ids):
        order.append(("auth", list(ids)))
        return []

    monkeypatch.setattr(membership.repositories, "list_members", fake_list)
    monkeypatch.setattr(membership.repositories, "delete_org", fake_delete_org)
    monkeypatch.setattr(membership.auth_admin, "delete_auth_users", fake_del)

    org = Org(id=OID, name="Acme")
    await membership.delete_org(object(), org)
    assert order == [("list", OID), ("db", OID), ("auth", [M1, M2])]
