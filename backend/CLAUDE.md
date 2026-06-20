# Backend — agent notes

The FastAPI service and background workers for Callup. Read [../CLAUDE.md](../CLAUDE.md) first — universal building rules live there. This file adds backend-specific conventions.

## Stack

- **FastAPI** + **async SQLAlchemy 2.0** + **asyncpg**. Pydantic v2 for all boundary I/O.
- **Supabase Postgres + pgvector** for data; **Supabase Storage** for generated `.docx` artifacts.
- **Background workers** — a Postgres-backed queue (`SELECT … FOR UPDATE SKIP LOCKED`) by default. Two classes: autonomous (fetch/embed/match, cron-driven) and interactive (the Playwright apply session).
- **Playwright** for the assisted-apply browser flow. Runs only in its own worker process — never on the request path.
- **One LLM/embedding SDK** behind the `llm/` abstraction. No second provider SDK imported directly in services.
- **Alembic** for migrations.

## Package manager

**`uv` only.** Run things with `uv run …`. The lockfile is `uv.lock`. Do not use bare `pip install` or add a `requirements.txt`; add deps with `uv add` and justify per the root dependency policy in the commit message.

## Layout

```text
backend/
├── src/callup/
│   ├── main.py            # app factory, lifespan, router registration
│   ├── config.py          # callup.config.settings — single source of truth
│   ├── secrets.py         # the only module that resolves creds/tokens
│   ├── api/               # deps.py, schemas.py + routes/ (thin HTTP layer only)
│   ├── db/                # base.py, enums.py, models/ (package), session.py, repositories.py
│   ├── llm/               # client.py, embeddings.py, prompts/
│   ├── services/          # fetch, candidates, match, generate, apply, outreach
│   └── workers/           # queue.py, scheduler.py, tasks/
├── alembic/
└── tests/
```

**Logic lives in `services/`. `api/routes/` and `workers/tasks/` are thin callers** — this is what lets the apply session be launched by a worker yet stepped through by HTTP handlers without duplicating Playwright logic. Routes never write SQL; all queries (including pgvector) live in `db/repositories.py`.

## Code style (backend-specific)

- Type hints on public functions and module-level things. Don't annotate every local.
- Async by default in request-path code. Don't run blocking I/O on the event loop. Tempfile + small synchronous file reads are OK (they're fast); network calls must be async.
- Use `async def` for all route handlers and any I/O service function.
- Validate at boundaries only. HTTP input is validated by Pydantic models. External API responses (Dice, the LLM provider, Gmail) are validated when parsed. Internal callers are trusted.

## Configuration

- `callup.config.settings` is the single source of truth. Import settings where needed; never call `os.getenv` in app code, never call `load_dotenv`.
- If a third-party SDK reads `os.environ` directly, add the mirror in `config.py` — don't sprinkle `setdefault` elsewhere.
- Fail fast on startup when required env vars are missing.

## Database migrations

- Alembic is the source of truth for schema changes. Do not change tables manually in the Supabase dashboard.
- SQLAlchemy models describe normal tables and columns. Alembic autogenerate creates candidate migrations, but every generated migration must be reviewed before applying.
- Supabase/Postgres-specific features belong in explicit migration operations: `create extension vector`, HNSW indexes (`vector_cosine_ops`), partial indexes, RLS enablement, and RLS policies.
- The `org_id` tenancy column ships on every business table from the first migration even though MVP runs single-org. Turning on multi-recruiter is RLS + middleware, never a column-shape migration — keep it that way.
- Alembic must use the direct/session database connection, **not** the Supabase transaction pooler URL.
- Run migrations from `backend/` with `uv run alembic upgrade head`. The running migration log lives in [`alembic/README.md`](./alembic/README.md) — add a table row and a detail section per migration.
- asyncpg rejects `?sslmode=` in the URL: SSL is configured via the `database_ssl` setting (`connect_args ssl="require"` for the Supabase pooler), and the DB password may be supplied out-of-URL via `database_password` to avoid URL-encoding issues.
- Enum-like columns (roles, statuses, work auth, etc.) are stored as plain strings and validated at the boundary via `callup.db.enums` — not Postgres enum types — so the value sets stay easy to evolve.

## Workers & the apply session

- Autonomous tasks must be idempotent. The fetch upsert is keyed on `(source, position_id)`; a changed `content_hash` refreshes an existing row rather than inserting a duplicate.
- The `queue.py` interface is the only thing that changes if we later adopt Redis/arq — tasks and services must not import queue internals.
- The apply session is a persisted state machine (`apply_sessions.state`). The worker owns *browser* state; the DB row owns *control* state; `NOTIFY`/`LISTEN` bridges the worker and the API, and the API surfaces it to the frontend over SSE. No browser state crosses the API boundary.
- `AWAITING_CONFIRM` (human approves the actual submit) is mandatory, not optional — assisted apply means automation fills, a human submits.
- Never auto-retry a partially-filled application. On error, transition to `FAILED` with a readable message and stop.

## LLM & generation contract

- Fitment, resume, cover, and outreach depend only on the `LLMClient` / `Embedder` protocols in `llm/`. Provider choice is not load-bearing.
- The prompt is part of the product. Generation prompts supply *only* verified `profile_json` facts and forbid invention. A post-generation validator confirms claimed skills/employers/dates are a subset of the profile and regenerates on violation. Do not weaken this to improve phrasing.
- Structured outputs use Pydantic schemas via `complete(schema=…)`; don't parse free text with regex when a schema will do.

## Tests

- Prefer unit over integration. Mock at the service boundary.
- Fast suite (`uv run pytest -m "not integration"`) must stay green and hit no network / no DB.
- Integration tests go behind `@pytest.mark.integration` and may require live LLM / Supabase credentials.
- Tests live next to what they test (`services/match/similarity.py` → `tests/services/match/test_similarity.py`).
- Required coverage: fetch normalize/dedup logic, matching (prefilter + similarity + re-rank), **generation grounding (the no-fabrication contract)**, and the apply-session state transitions.
- Don't mock the LLM in unit tests without also asserting the grounding contract — the prompt is the product.

## Anti-patterns (rejected)

- `os.getenv` / `load_dotenv` in modules.
- Wrapping FastAPI responses in custom envelope classes.
- Over-catching `Exception` just to log and re-raise; let it propagate.
- Shared state through globals instead of FastAPI `app.state` or DI.
- Silent fallbacks that hide real config errors.
- SQL in route handlers, or pgvector queries outside `repositories.py`.
- Running Playwright (or any blocking browser work) on the request path.
- Credentials in worker payloads, logs, or API responses.
- Auto-retrying a submitted-but-uncertain application — risk of double-apply.