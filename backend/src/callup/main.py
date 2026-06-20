from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from callup.api.routes import health, me
from callup.config import settings
from callup.db.session import engine


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Callup API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(me.router)
    return app


app = create_app()


def run() -> None:
    """Console entry point (``uv run callup``) — dev server only."""
    import uvicorn

    uvicorn.run(
        "callup.main:app",
        host="127.0.0.1",
        port=8000,
        reload=settings.environment == "development",
    )
