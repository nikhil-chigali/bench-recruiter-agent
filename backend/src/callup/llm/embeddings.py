import hashlib
from typing import Protocol

from callup.config import settings


class Embedder(Protocol):
    async def embed(self, text: str) -> list[float]: ...


class StubEmbedder:
    """Deterministic placeholder for the walking skeleton — stable but not semantic.
    Replaced by a real embedding backend in Phase 3 (real matching)."""

    def __init__(self, dim: int | None = None) -> None:
        self._dim = dim if dim is not None else settings.embedding_dim

    async def embed(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        return [(digest[i % len(digest)] / 255.0) * 2.0 - 1.0 for i in range(self._dim)]
