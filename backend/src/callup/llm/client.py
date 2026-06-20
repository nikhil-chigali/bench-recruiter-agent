from typing import Protocol, TypeVar

from anthropic import AsyncAnthropic
from pydantic import BaseModel

from callup import secrets
from callup.config import settings

T = TypeVar("T", bound=BaseModel)


class LLMClient(Protocol):
    """The seam every generator depends on. Provider choice is not load-bearing."""

    async def complete(self, *, prompt: str, schema: type[T]) -> T:
        """Return a structured result validated against ``schema``.

        Generation prompts supply only verified profile facts and forbid invention;
        a post-generation validator (Phase 4) confirms claims are a subset of the profile.
        """
        ...


class AnthropicLLMClient:
    """Thin wrapper over the Anthropic SDK. Services depend on the LLMClient protocol,
    not on this class."""

    def __init__(self) -> None:
        self._client = AsyncAnthropic(api_key=secrets.anthropic_api_key())
        self._model = settings.llm_model

    async def complete(self, *, prompt: str, schema: type[T]) -> T:
        raise NotImplementedError("Structured completion lands with fitment scoring (Phase 3).")
