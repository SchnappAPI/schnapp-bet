"""MARKET_CONFIG structural invariants (mlb-v1.1).

The grading loop dispatches on these fields; a missing key surfaces as a
KeyError mid-slate. Keep the config self-consistent."""

from grading.mlb_grade_props import MARKET_CONFIG, compute_composite

FAMILIES = {"batter_rate", "batter_count", "pitcher"}


def test_families_are_known():
    for mk, cfg in MARKET_CONFIG.items():
        assert cfg["family"] in FAMILIES, mk


def test_batter_count_entries_carry_expr_and_ceiling():
    for mk, cfg in MARKET_CONFIG.items():
        if cfg["family"] == "batter_count":
            assert cfg["source"] == "boxscore", mk
            assert cfg.get("expr"), mk
            assert cfg.get("avg_ceil", 0) > 0, mk


def test_pitcher_entries_carry_grade_inputs():
    required = {"season_rate", "rate_ceil", "rate_floor",
                "recent_ceil", "recent_floor",
                "opp_rate_col", "opp_ceil", "opp_floor"}
    for mk, cfg in MARKET_CONFIG.items():
        if cfg["family"] == "pitcher":
            missing = required - set(cfg)
            assert not missing, f"{mk} missing {missing}"
            assert cfg["rate_ceil"] > cfg["rate_floor"], mk
            assert cfg["opp_rate_col"] in (
                "w30_k_rate", "w30_hit_rate", "w30_bb_rate"), mk


def test_batter_rate_entries_use_at_bats():
    for mk, cfg in MARKET_CONFIG.items():
        if cfg["family"] == "batter_rate":
            assert cfg["source"] == "at_bats", mk
            assert cfg.get("stat"), mk


def test_market_count_is_sixteen():
    assert len(MARKET_CONFIG) == 16


def test_composite_no_ev_drops_ev_term():
    # With no_ev, the EV grade must not move the composite.
    a = compute_composite(60.0, 0.0, 40.0, no_ev=True)
    b = compute_composite(60.0, 100.0, 40.0, no_ev=True)
    assert a == b
    # Default path keeps the documented 0.40/0.30/0.30 weights.
    assert compute_composite(100.0, 0.0, 0.0) == 40.0
    assert compute_composite(0.0, 100.0, 0.0) == 30.0
    assert compute_composite(0.0, 0.0, 100.0) == 30.0
