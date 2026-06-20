from collections.abc import AsyncGenerator

from sqlalchemy import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from callup.config import settings


def engine_url() -> URL:
    """The DB URL with any inline password stripped when database_password is set."""
    url = make_url(settings.database_url)
    if settings.database_password:
        url = url.set(password=None)
    return url


def engine_connect_args() -> dict:
    """asyncpg connect args: SSL and an out-of-URL password (avoids URL-encoding issues).

    "require" encrypts without verifying the cert chain — needed for the Supabase pooler,
    whose chain isn't in the system trust store. Switch to a verifying context with
    Supabase's CA pinned for production-grade verification.
    """
    args: dict = {}
    if settings.database_ssl:
        args["ssl"] = "require"
    if settings.database_password:
        args["password"] = settings.database_password
    return args


# Engine is created at import but connects lazily on first use.
engine: AsyncEngine = create_async_engine(
    engine_url(),
    pool_pre_ping=True,
    connect_args=engine_connect_args(),
)

SessionFactory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine, expire_on_commit=False
)


async def get_session() -> AsyncGenerator[AsyncSession]:
    async with SessionFactory() as session:
        yield session
