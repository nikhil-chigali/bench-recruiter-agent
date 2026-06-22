from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from callup.auth.jwt import AuthError, JWKSUnavailable, TokenClaims, verify_token
from callup.db import repositories
from callup.db.models import User
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


async def get_current_user(claims: CurrentClaims, session: SessionDep) -> User:
    """Resolve the onboarded user for the authenticated request.

    For business routes that require an existing user. Raises 403 if the request has
    authenticated but not yet onboarded (no user row). Does not provision.
    """
    user = await repositories.get_user(session, claims.sub)
    if user is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not onboarded")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
