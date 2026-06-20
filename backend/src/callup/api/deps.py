from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from callup.auth.jwt import AuthError, JWKSUnavailable, TokenClaims, verify_token
from callup.db import repositories
from callup.db.models import Recruiter
from callup.db.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_current_claims(request: Request) -> TokenClaims:
    """Verify the bearer token and return its claims. No DB access.

    Base auth dependency for routes that must work pre-onboarding (/me, POST /orgs).
    Missing/invalid token -> 401; key-server outage -> 503.
    """
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        return verify_token(token)
    except AuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    except JWKSUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "auth key server unavailable"
        ) from exc


CurrentClaims = Annotated[TokenClaims, Depends(get_current_claims)]


async def get_current_recruiter(claims: CurrentClaims, session: SessionDep) -> Recruiter:
    """Resolve the onboarded recruiter for the authenticated user.

    For business routes that require an existing recruiter. Raises 403 if the user has
    authenticated but not yet onboarded (no recruiter row). Does not provision.
    """
    recruiter = await repositories.get_recruiter(session, claims.sub)
    if recruiter is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not onboarded")
    return recruiter


CurrentRecruiter = Annotated[Recruiter, Depends(get_current_recruiter)]
