# Callup — backend

FastAPI service and background workers for Callup. Conventions live in
[`CLAUDE.md`](./CLAUDE.md).

## Setup

Requires [uv](https://docs.astral.sh/uv/). From `backend/`:

```bash
uv sync                 # install deps into .venv
cp .env.example .env    # then fill in DATABASE_URL, DATABASE_PASSWORD, ANTHROPIC_API_KEY, ...
```

## Run

```bash
uv run callup           # dev API server on http://127.0.0.1:8000
# equivalently: uv run uvicorn callup.main:app --reload
```

## Database

Schema changes go through Alembic (the source of truth). The migration log and full command
list are in [`alembic/README.md`](./alembic/README.md).

```bash
uv run alembic upgrade head     # apply migrations
```

## Tests & lint

```bash
uv run pytest                   # fast suite (no network / no DB)
uv run ruff check .
```
