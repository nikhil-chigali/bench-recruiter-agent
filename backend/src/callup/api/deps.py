from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from callup.auth.jwt import AuthError, JWKSUnavailable, verify_token
from callup.db import repositories
from callup.db.models import Recruiter
from callup.db.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_current_recruiter(request: Request, session: SessionDep) -> Recruiter:
    """Resolve the authenticated recruiter, provisioning org+recruiter on first sight.

    Routes depend on this for identity and org_id scoping. Missing/invalid token -> 401;
    key-server outage -> 503.
    """
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")

    try:
        claims = verify_token(token)
    except AuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    except JWKSUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "auth key server unavailable"
        ) from exc

    recruiter = await repositories.get_recruiter(session, claims.sub)
    if recruiter is None:
        recruiter = await repositories.provision_recruiter(
            session, claims.sub, claims.email, claims.email.split("@")[0]
        )
    return recruiter


CurrentRecruiter = Annotated[Recruiter, Depends(get_current_recruiter)]
