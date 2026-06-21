"""Verify Supabase bearer tokens against the project's asymmetric JWKS.

No shared secret and no per-request call to Supabase: PyJWKClient fetches and caches
the public keys, and verification happens locally. AuthError -> HTTP 401 (the token is
missing/invalid); JWKSUnavailable -> HTTP 503 (the key server is unreachable, which is
an outage, not a bad token).
"""

import uuid
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError

from callup.config import settings

# Tolerance for clock skew between Supabase (which stamps `iat`/`exp`) and this server.
# Without it, a token whose `iat` is even a second ahead of our clock is rejected as
# "not yet valid" for the first second or two after sign-in — which races the SPA's first
# /me call and bounces the user back to login. Applies to iat, nbf, and exp.
_CLOCK_SKEW_LEEWAY_SECONDS = 30


class AuthError(Exception):
    """Bearer token is missing or fails verification (-> HTTP 401)."""


class JWKSUnavailable(Exception):
    """Supabase's key server can't be reached (-> HTTP 503)."""


@dataclass(frozen=True)
class TokenClaims:
    sub: uuid.UUID
    email: str


def _jwks_url() -> str:
    base = settings.supabase_url
    if not base:
        raise RuntimeError("SUPABASE_URL is required for auth but is not set")
    return f"{base.rstrip('/')}/auth/v1/.well-known/jwks.json"


_jwk_client: PyJWKClient | None = None


def _client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(_jwks_url())
    return _jwk_client


def verify_token(token: str) -> TokenClaims:
    try:
        signing_key = _client().get_signing_key_from_jwt(token)
    except PyJWKClientConnectionError as exc:
        raise JWKSUnavailable(str(exc)) from exc
    except jwt.PyJWTError as exc:
        raise AuthError(str(exc)) from exc

    try:
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience=settings.supabase_jwt_aud,
            issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
            leeway=_CLOCK_SKEW_LEEWAY_SECONDS,
        )
    except jwt.InvalidTokenError as exc:
        raise AuthError(str(exc)) from exc

    sub = payload.get("sub")
    email = payload.get("email")
    if not sub or not email:
        raise AuthError("token missing required sub/email claim")
    return TokenClaims(sub=uuid.UUID(sub), email=email)
