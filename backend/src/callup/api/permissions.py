from fastapi import HTTPException, status

from callup.db.enums import RecruiterRole
from callup.db.models import Recruiter

_OWNER = RecruiterRole.OWNER.value
_ADMIN = RecruiterRole.ADMIN.value
_RECRUITER = RecruiterRole.RECRUITER.value


def ensure_owner(actor: Recruiter) -> None:
    if actor.role != _OWNER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")


def ensure_manager(actor: Recruiter) -> None:
    if actor.role not in (_OWNER, _ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")


def ensure_can_manage(actor: Recruiter, target_role: str) -> None:
    """Owner manages any non-owner; admin manages only recruiters; recruiter manages none."""
    if actor.role == _OWNER:
        if target_role == _OWNER:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot manage the owner")
        return
    if actor.role == _ADMIN and target_role == _RECRUITER:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
