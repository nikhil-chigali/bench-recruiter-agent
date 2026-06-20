from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Single source of truth for backend configuration.

    Import ``settings`` from here; never read ``os.environ`` directly elsewhere and
    never call ``load_dotenv``. Fields without a default are required — their absence
    raises at import time (fail fast on misconfiguration).
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "development"

    # Database. Use the direct/session connection string (asyncpg driver), NOT the
    # Supabase transaction pooler — Alembic and prepared statements need it.
    # e.g. postgresql+asyncpg://user:pass@host:5432/postgres
    # Do NOT put ?sslmode=... in the URL — asyncpg rejects it; use database_ssl instead.
    database_url: str
    # Supplied separately so passwords with special characters don't need URL-encoding;
    # injected via connect_args and overrides any password in database_url. Optional —
    # leave unset if the password is already embedded (and encoded) in database_url.
    database_password: str | None = None
    database_ssl: bool = True  # Supabase requires SSL; set False for a local non-SSL Postgres.

    # LLM (Anthropic). One provider, accessed only through the llm/ abstraction.
    anthropic_api_key: str
    llm_model: str = "claude-sonnet-4-6"

    # Embeddings. Provider TBD; the backend lives behind llm/embeddings.py.
    embedding_model: str = "stub-embedding-v0"
    embedding_dim: int = 1536

    # Object storage for generated .docx artifacts (Supabase Storage).
    # Optional until resume generation lands; required before Phase 4.
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    storage_bucket: str = "candidate-files"

    # Matching.
    match_freshness_days: int = 30
    match_top_k: int = 25

    # Product gate: public email send stays off unless explicitly enabled.
    outreach_send_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from env / .env


settings = get_settings()
