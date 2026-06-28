from datetime import date

from callup.db.models import CandidateExperience
from callup.services.candidates.roster import years_of_experience


def _exp(start: date | None, end: date | None) -> CandidateExperience:
    return CandidateExperience(start_date=start, end_date=end)


def test_years_zero_when_no_experience():
    assert years_of_experience([]) == 0


def test_years_zero_when_no_start_dates():
    assert years_of_experience([_exp(None, None)]) == 0


def test_years_span_single_role():
    assert years_of_experience([_exp(date(2016, 1, 1), date(2025, 1, 1))]) == 9


def test_years_uses_today_for_present_role():
    assert years_of_experience([_exp(date(2020, 1, 1), None)], today=date(2025, 1, 1)) == 5


def test_years_span_across_multiple_roles():
    exps = [_exp(date(2016, 1, 1), date(2020, 1, 1)), _exp(date(2020, 1, 1), date(2025, 1, 1))]
    assert years_of_experience(exps) == 9
