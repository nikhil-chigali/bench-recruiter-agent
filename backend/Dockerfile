# Callup backend — FastAPI on Railway.
# Build context is the `backend/` directory (set Root Directory = backend on the
# Railway service). Binds 0.0.0.0:$PORT, which Railway injects at runtime.

FROM python:3.12-slim

# uv: fast, reproducible installs from uv.lock. Copy the static binary from the
# official image rather than pip-installing it.
COPY --from=ghcr.io/astral-sh/uv:0.11.23 /uv /uvx /bin/

# Don't build a venv-in-a-venv; install straight into the image's environment.
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

WORKDIR /app

# 1) Dependency layer — cached unless the lockfile or manifest changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 2) Application layer — source, migrations, alembic config.
COPY . .
RUN uv sync --frozen --no-dev

# Railway provides $PORT. Migrations run via the service's pre-deploy command
# (`uv run alembic upgrade head`), not here, so a failed migration never starts
# a half-deployed server. `sh -c` so $PORT is expanded at runtime.
CMD ["sh", "-c", "uv run uvicorn callup.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
