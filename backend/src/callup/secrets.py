"""The only module that resolves credentials and tokens.

Secrets are resolved here and handed to callers at the point of use. They must never
be logged, placed in worker payloads, or returned in API responses. Gmail OAuth tokens
and candidate Dice credentials are resolved here when those features land; for now this
exposes the provider keys held in settings as opaque accessors.
"""

from callup.config import settings


def anthropic_api_key() -> str:
    return settings.anthropic_api_key


def database_url() -> str:
    return settings.database_url


# Resolved when their features land:
# - gmail_oauth_token(recruiter_id): the recruiter's connected Gmail token (outreach send).
# - dice_credentials(...): candidate Dice credentials are entered live per apply session
#   and are never stored — they do not pass through this module.
