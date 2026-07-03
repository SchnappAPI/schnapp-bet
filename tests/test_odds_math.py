"""Pure odds-math invariants from the MLB grading model.

These formulas settle real money; a sign or branch flip here ships wrong
EV/tier prices with no crash. First tests in the repo — extend before
touching the math.
"""

import pytest

from grading.mlb_grade_props import american_to_implied, implied_to_american, ev


def test_positive_american_to_implied():
    assert american_to_implied(100) == pytest.approx(0.5)
    assert american_to_implied(150) == pytest.approx(0.4)
    assert american_to_implied(400) == pytest.approx(0.2)


def test_negative_american_to_implied():
    assert american_to_implied(-100) == pytest.approx(0.5)
    assert american_to_implied(-150) == pytest.approx(0.6)
    assert american_to_implied(-400) == pytest.approx(0.8)


def test_implied_to_american_favorites_are_negative():
    assert implied_to_american(0.6) < 0
    assert implied_to_american(0.4) > 0
    assert implied_to_american(0.5) == -100


def test_round_trip_within_rounding():
    for price in (-450, -200, -110, 120, 250, 600):
        prob = american_to_implied(price)
        back = implied_to_american(prob)
        assert back == pytest.approx(price, abs=1)


def test_implied_to_american_degenerate_probs():
    assert implied_to_american(0.0) == 0
    assert implied_to_american(1.0) == 0


def test_ev_sign():
    # Model prob above the implied prob -> positive EV; below -> negative.
    assert ev(0.5, 150) > 0     # implied 0.4
    assert ev(0.3, 150) < 0
    assert ev(american_to_implied(-120), -120) == pytest.approx(0.0)
