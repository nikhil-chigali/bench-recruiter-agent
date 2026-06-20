import datetime as dt
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from callup.auth import jwt as auth_jwt
from callup.auth.jwt import AuthError, verify_token


@pytest.fixture
def keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    return private_key, private_key.public_key()


@pytest.fixture(autouse=True)
def _patch_jwks(monkeypatch, keypair):
    _, public_key = keypair

    class _FakeKey:
        key = public_key

    class _FakeClient:
        def get_signing_key_from_jwt(self, token):
            return _FakeKey()

    monkeypatch.setattr(auth_jwt, "_client", lambda: _FakeClient())


def _make_token(private_key, **overrides):
    now = dt.datetime.now(tz=dt.UTC)
    payload = {
        "sub": str(uuid.uuid4()),
        "email": "rec@example.com",
        "aud": "authenticated",
        "exp": now + dt.timedelta(hours=1),
        "iat": now,
    }
    payload.update(overrides)
    return jwt.encode(payload, private_key, algorithm="ES256")


def test_verify_token_valid(keypair):
    private_key, _ = keypair
    sub = uuid.uuid4()
    token = _make_token(private_key, sub=str(sub))
    claims = verify_token(token)
    assert claims.sub == sub
    assert claims.email == "rec@example.com"


def test_verify_token_expired(keypair):
    private_key, _ = keypair
    now = dt.datetime.now(tz=dt.UTC)
    token = _make_token(private_key, exp=now - dt.timedelta(hours=1))
    with pytest.raises(AuthError):
        verify_token(token)


def test_verify_token_wrong_audience(keypair):
    private_key, _ = keypair
    token = _make_token(private_key, aud="not-authenticated")
    with pytest.raises(AuthError):
        verify_token(token)


def test_verify_token_missing_email(keypair):
    private_key, _ = keypair
    token = _make_token(private_key, email=None)
    with pytest.raises(AuthError):
        verify_token(token)
