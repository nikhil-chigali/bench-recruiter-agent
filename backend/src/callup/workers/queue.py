"""Postgres-backed work queue (``SELECT ... FOR UPDATE SKIP LOCKED``).

This module's API is the only thing that changes if we later adopt Redis/arq — tasks and
services must not import queue internals. Autonomous tasks must be idempotent.
"""

from typing import Any


async def enqueue(task: str, payload: dict[str, Any]) -> None:
    raise NotImplementedError("Queue implementation lands in Phase 1 (pipeline runner).")
