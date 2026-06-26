from callup.openapi_export import OPENAPI_PATH, openapi_bytes


def test_openapi_includes_candidates_contract():
    text = openapi_bytes().decode("utf-8")
    assert '"/candidates"' in text
    assert '"CandidateCard"' in text


def test_committed_openapi_is_up_to_date():
    # Reads bytes (no newline translation) so the check is identical on Windows and Linux CI.
    committed = OPENAPI_PATH.read_bytes()
    assert committed == openapi_bytes(), (
        "backend/openapi.json is stale — regenerate with "
        "`uv run python -m callup.openapi_export`"
    )
