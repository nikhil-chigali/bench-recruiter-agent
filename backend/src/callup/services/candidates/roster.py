"""Read-side derivations for the candidate roster.

Years of experience is derived here (not stored) from the candidate's experience
date ranges, so the roster and profile always reflect the actual roles on file.
"""

from datetime import date

from callup.db.models import CandidateExperience


def years_of_experience(
    experiences: list[CandidateExperience], *, today: date | None = None
) -> int:
    """Total career span in whole years: earliest start to latest end (null end = today).

    Returns 0 when there are no experience entries with a start date.
    """
    today = today or date.today()
    starts = [e.start_date for e in experiences if e.start_date is not None]
    if not starts:
        return 0
    earliest = min(starts)
    latest = max(e.end_date or today for e in experiences if e.start_date is not None)
    return max(0, (latest - earliest).days // 365)
