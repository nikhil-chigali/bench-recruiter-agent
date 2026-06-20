import os

# Provide dummy required config before any callup import, so the fast suite can build the
# app without real credentials or a live DB. The engine connects lazily, so a placeholder
# DATABASE_URL is fine for tests that don't touch the database.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/callup_test"
)
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
