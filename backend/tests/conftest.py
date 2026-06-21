import os
from pathlib import Path

# Load real env values from .env (if present) before setting fast-suite fallbacks.
# This ensures integration tests that require a live DB use the real DATABASE_URL
# rather than the dummy placeholder below.
_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _, _val = _line.partition("=")
            os.environ.setdefault(_key.strip(), _val.strip())

# Provide dummy required config before any callup import, so the fast suite can build the
# app without real credentials or a live DB. The engine connects lazily, so a placeholder
# DATABASE_URL is fine for tests that don't touch the database.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/callup_test")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
