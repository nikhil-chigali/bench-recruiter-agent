from callup.config import settings


def test_defaults() -> None:
    assert settings.match_freshness_days == 30
    assert settings.match_top_k == 25
    assert settings.outreach_send_enabled is False
