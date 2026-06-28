"""Emit the backend's OpenAPI schema to a committed file the frontend generates types from.

Run ``uv run python -m callup.openapi_export`` to rewrite ``backend/openapi.json``. The fast
suite's ``test_committed_openapi_is_up_to_date`` (and therefore CI) fails if the committed file
drifts from the code, so the contract the frontend types are generated from always matches the API.
"""

import json
from pathlib import Path
from typing import Any

from callup.main import app

# backend/src/callup/openapi_export.py -> parents[2] == backend/
OPENAPI_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


def openapi_bytes() -> bytes:
    """The app's OpenAPI schema as deterministic UTF-8 JSON (sorted keys, trailing newline)."""
    schema: dict[str, Any] = app.openapi()
    return (json.dumps(schema, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_openapi() -> None:
    OPENAPI_PATH.write_bytes(openapi_bytes())


if __name__ == "__main__":
    write_openapi()
    print(f"wrote {OPENAPI_PATH}")
