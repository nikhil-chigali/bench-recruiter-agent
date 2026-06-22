from fastapi import HTTPException, status

from callup.db.enums import RecruiterRole
from callup.db.models import User

_OWNER = RecruiterRole.OWNER.value
_ADMIN = RecruiterRole.ADMIN.value
_RECRUITER = RecruiterRole.RECRUITER.value


def ensure_owner(actor: User) -> None:
    if actor.role != _OWNER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")


def ensure_manager(actor: User) -> None:
    if actor.role not in (_OWNER, _ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")


def ensure_can_manage(actor: User, target_role: str) -> None:
    """Owner manages any non-owner; admin manages only recruiters; recruiter manages none."""
    if actor.role == _OWNER:
        if target_role == _OWNER:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage the owner")
        return
    if actor.role == _ADMIN and target_role == _RECRUITER:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
