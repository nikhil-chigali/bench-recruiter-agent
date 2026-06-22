import pytest
from fastapi import HTTPException

from callup.api import permissions
from callup.db.models import User


def _r(role: str) -> User:
    return User(role=role, name="x", email="x@example.com")


def test_ensure_owner_allows_owner():
    permissions.ensure_owner(_r("owner"))  # no raise


@pytest.mark.parametrize("role", ["admin", "recruiter"])
def test_ensure_owner_rejects_non_owner(role):
    with pytest.raises(HTTPException) as e:
        permissions.ensure_owner(_r(role))
    assert e.value.status_code == 403


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_ensure_manager_allows_managers(role):
    permissions.ensure_manager(_r(role))  # no raise


def test_ensure_manager_rejects_recruiter():
    with pytest.raises(HTTPException) as e:
        permissions.ensure_manager(_r("recruiter"))
    assert e.value.status_code == 403


def test_owner_can_manage_admin_and_recruiter():
    permissions.ensure_can_manage(_r("owner"), "admin")
    permissions.ensure_can_manage(_r("owner"), "recruiter")


def test_owner_cannot_manage_owner():
    with pytest.raises(HTTPException) as e:
        permissions.ensure_can_manage(_r("owner"), "owner")
    assert e.value.status_code == 403


def test_admin_can_manage_recruiter_only():
    permissions.ensure_can_manage(_r("admin"), "recruiter")
    for target in ("admin", "owner"):
        with pytest.raises(HTTPException) as e:
            permissions.ensure_can_manage(_r("admin"), target)
        assert e.value.status_code == 403


@pytest.mark.parametrize("target", ["owner", "admin", "recruiter"])
def test_recruiter_can_manage_nobody(target):
    with pytest.raises(HTTPException) as e:
        permissions.ensure_can_manage(_r("recruiter"), target)
    assert e.value.status_code == 403
