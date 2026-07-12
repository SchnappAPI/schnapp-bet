"""
mlb_prop_projections.py

Odds-free batter-prop projection engine (prop-v1). For an as-of date, computes
each active batter's calibrated per-game probability for three markets and
writes them to mlb.batter_prop_projections:

    HR   - P(>=1 home run)
    HRR  - P(hits + runs + RBI >= 1.5)  (i.e. >= 2)
    HITS - P(>=1 hit)

This engine is COMPLETELY UNRELATED TO ODDS (owner constraint): no lines, no
implied probabilities, no market data in any input, feature, or output. It is a
pure outcome projector, validated only against realized results.

Model (prop-v1), all from data STRICTLY BEFORE the as-of date (no leakage):

    p = shrink(career per-game rate, league mean, K=40) x form_multiplier

  - "shrink" is empirical-Bayes: a thin sample regresses toward the league
    mean; an established hitter barely moves. K=40 games of league prior.
  - form_multiplier (HR only): a batter squaring the ball up recently
    (trailing-20-game barrels per game) nudges the HR rate up/down. HRR and
    HITS are stable enough that the pooled rate carries them on its own.

The pooled + shrunk rates are already well-calibrated out-of-sample (backtested
on held-out 2026: predicted tracks actual within ~1-3 pts per decile, and the
model's Brier beats the league-flat and raw-rate baselines for both HR and
HRR). A learned isotonic calibration layer is a prop-v1.1 refinement; matchup
context (park, platoon, pitcher) is prop-v1.1 as well - applied per slate on
top of these base projections.

Outcomes come from two facts, joined per batter-game:
  - mlb.player_at_bats : home runs + barrels (EV>=95 & LA 8-32, ETL-lockstep).
  - mlb.batting_stats  : hits / runs / RBI (deduped to one row per
                         (game, player); its batter_game_id embeds team_id so a
                         game can carry a stray second row - take the row with
                         the most plate appearances).

DDL for mlb.batter_prop_projections is owned by this script (guarded CREATE),
matching the mlb.* convention. Idempotent: re-running an as-of date MERGEs in
place. Runs in GitHub Actions on mac-runner; credentials from the environment.
"""

import argparse
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from shared.db import get_engine, record_workflow_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

MODEL_VERSION = "prop-v1.1"

# League per-game base rates (share of qualifying batter-games clearing each
# market), measured over 2024-2026. These are the empirical-Bayes shrink
# targets and the "x vs average" denominators.
LEAGUE_HR = 0.108
LEAGUE_HRR = 0.432
LEAGUE_HITS = 0.580

SHRINK_K = 40  # games of league prior mixed into each batter's rate
MIN_PRIOR_GAMES = 20  # need this much history before projecting a batter
ACTIVE_WINDOW_DAYS = 14  # only project batters who played within this window
HR_PROB_CAP = 0.60  # guard against a runaway multiplied HR rate

DDL_CREATE = """
IF OBJECT_ID('mlb.batter_prop_projections', 'U') IS NULL
CREATE TABLE mlb.batter_prop_projections (
    batter_id          INT           NOT NULL,
    as_of_date         DATE          NOT NULL,
    market             VARCHAR(8)    NOT NULL,   -- 'HR' | 'HRR' | 'HITS'
    prob               DECIMAL(6,4)  NOT NULL,   -- projected probability 0..1
    base_rate          DECIMAL(6,4)  NOT NULL,   -- league mean for the market
    lift               DECIMAL(6,3)  NOT NULL,   -- prob / base_rate (x vs avg)
    tier               VARCHAR(12)   NOT NULL,   -- Elite|Strong|AboveAvg|Average|Fade
    prior_games        INT           NOT NULL,
    recent_barrels_pg  DECIMAL(5,3)  NULL,       -- trailing-20g barrels/game
    model_version      VARCHAR(16)   NOT NULL,
    created_at         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_batter_prop_projections
        PRIMARY KEY (batter_id, as_of_date, market)
);
"""

# The model, expressed in-DB as a CTE chain ending in `projected`. Every window
# is strictly before :as_of, so a row is a genuine pre-game projection. T-SQL
# forbids a WITH clause inside a derived table, so the CTEs sit at statement
# top level and the MERGE consumes `projected` directly. :as_of and :version
# are bound by the caller; model constants are interpolated once at import.
MERGE_SQL = f"""
WITH pab AS (
    SELECT batter_id, game_pk, game_date,
        MAX(CASE WHEN result_event_type = 'home_run' THEN 1 ELSE 0 END) AS hr,
        SUM(CASE WHEN hit_launch_speed >= 95
                  AND hit_launch_angle BETWEEN 8 AND 32 THEN 1 ELSE 0 END) AS barrels
    FROM mlb.player_at_bats
    WHERE game_date < :as_of
    GROUP BY batter_id, game_pk, game_date
),
bs AS (
    SELECT batter_id, game_pk, game_date, hrr, hit
    FROM (
        SELECT player_id AS batter_id, game_pk, game_date,
            CASE WHEN (hits + runs + rbi) >= 2 THEN 1 ELSE 0 END AS hrr,
            CASE WHEN hits >= 1 THEN 1 ELSE 0 END AS hit,
            ROW_NUMBER() OVER (PARTITION BY game_pk, player_id
                               ORDER BY plate_appearances DESC) AS rn
        FROM mlb.batting_stats
        WHERE game_date < :as_of AND (at_bats > 0 OR plate_appearances > 0)
    ) z
    WHERE rn = 1
),
fact AS (
    SELECT
        COALESCE(p.batter_id, b.batter_id) AS batter_id,
        COALESCE(p.game_pk,   b.game_pk)   AS game_pk,
        COALESCE(p.game_date, b.game_date) AS game_date,
        ISNULL(p.hr, 0)      AS hr,
        ISNULL(p.barrels, 0) AS barrels,
        ISNULL(b.hrr, 0)     AS hrr,
        ISNULL(b.hit, 0)     AS hit
    FROM pab p
    FULL OUTER JOIN bs b ON p.batter_id = b.batter_id AND p.game_pk = b.game_pk
),
recent AS (
    SELECT batter_id, AVG(1.0 * barrels) AS brl_pg
    FROM (
        SELECT batter_id, barrels,
            ROW_NUMBER() OVER (PARTITION BY batter_id
                               ORDER BY game_date DESC, game_pk DESC) AS rn
        FROM fact
    ) r
    WHERE rn <= 20
    GROUP BY batter_id
),
agg AS (
    SELECT f.batter_id,
        COUNT(*)         AS g,
        SUM(f.hr)        AS hr_g,
        SUM(f.hrr)       AS hrr_g,
        SUM(f.hit)       AS hit_g,
        MAX(f.game_date) AS last_game,
        MAX(r.brl_pg)    AS brl_pg
    FROM fact f
    LEFT JOIN recent r ON r.batter_id = f.batter_id
    GROUP BY f.batter_id
),
model AS (
    SELECT batter_id, g, brl_pg,
        (hr_g  + {SHRINK_K} * {LEAGUE_HR})   / (g + {SHRINK_K}.0) AS base_hr,
        (hrr_g + {SHRINK_K} * {LEAGUE_HRR})  / (g + {SHRINK_K}.0) AS base_hrr,
        (hit_g + {SHRINK_K} * {LEAGUE_HITS}) / (g + {SHRINK_K}.0) AS base_hit,
        CASE WHEN brl_pg > 0.9  THEN 1.35
             WHEN brl_pg > 0.6  THEN 1.15
             WHEN brl_pg < 0.25 THEN 0.70
             ELSE 1.0 END AS hr_form
    FROM agg
    WHERE g >= {MIN_PRIOR_GAMES}
      AND last_game >= DATEADD(day, -{ACTIVE_WINDOW_DAYS}, :as_of)
),
projected AS (
    SELECT
        batter_id,
        CAST(:as_of AS DATE)         AS as_of_date,
        market,
        prob,
        base_rate,
        CAST(prob / base_rate AS DECIMAL(6,3)) AS lift,
        g                             AS prior_games,
        CAST(brl_pg AS DECIMAL(5,3))  AS recent_barrels_pg,
        CAST(:version AS VARCHAR(16)) AS model_version
    FROM model
    CROSS APPLY (VALUES
        ('HR',   CAST(CASE WHEN base_hr * hr_form > {HR_PROB_CAP}
                           THEN {HR_PROB_CAP} ELSE base_hr * hr_form END AS DECIMAL(6,4)),
                 CAST({LEAGUE_HR} AS DECIMAL(6,4))),
        ('HRR',  CAST(base_hrr AS DECIMAL(6,4)), CAST({LEAGUE_HRR} AS DECIMAL(6,4))),
        ('HITS', CAST(base_hit AS DECIMAL(6,4)), CAST({LEAGUE_HITS} AS DECIMAL(6,4)))
    ) AS m(market, prob, base_rate)
),
ranked AS (
    -- prop-v1.1: tier by the batter's probability percentile WITHIN the market,
    -- not by lift. Lift (prob / league avg) is structurally capped for
    -- high-base-rate markets — you cannot be 2x more likely than average to
    -- get a hit when average is 58%, so HITS/HRR could never reach Elite/Strong
    -- and collapsed to Average/Fade. Percentile gives every market a full
    -- Elite->Fade spread (Elite = the day's top plays for THAT market) and is
    -- exactly what the transparency board checks (do top tiers hit more).
    SELECT *,
        PERCENT_RANK() OVER (PARTITION BY market ORDER BY prob) AS pctile
    FROM projected
),
tiered AS (
    SELECT *,
        CASE WHEN pctile >= 0.95 THEN 'Elite'
             WHEN pctile >= 0.85 THEN 'Strong'
             WHEN pctile >= 0.65 THEN 'AboveAvg'
             WHEN pctile >= 0.35 THEN 'Average'
             ELSE 'Fade' END AS tier
    FROM ranked
)
MERGE mlb.batter_prop_projections AS t
USING tiered AS s
ON (t.batter_id = s.batter_id AND t.as_of_date = s.as_of_date AND t.market = s.market)
WHEN MATCHED THEN UPDATE SET
    t.prob = s.prob, t.base_rate = s.base_rate, t.lift = s.lift, t.tier = s.tier,
    t.prior_games = s.prior_games, t.recent_barrels_pg = s.recent_barrels_pg,
    t.model_version = s.model_version, t.created_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT
    (batter_id, as_of_date, market, prob, base_rate, lift, tier, prior_games,
     recent_barrels_pg, model_version)
    VALUES
    (s.batter_id, s.as_of_date, s.market, s.prob, s.base_rate, s.lift, s.tier,
     s.prior_games, s.recent_barrels_pg, s.model_version);
"""


def ensure_table(engine):
    with engine.begin() as conn:
        conn.execute(text(DDL_CREATE))


def project_one(engine, as_of):
    """Compute + MERGE projections for a single as-of date. Returns row count."""
    with engine.begin() as conn:
        conn.execute(text(MERGE_SQL), {"as_of": as_of, "version": MODEL_VERSION})
    with engine.connect() as conn:
        n = conn.execute(
            text("SELECT COUNT(*) FROM mlb.batter_prop_projections WHERE as_of_date = :d AND model_version = :v"),
            {"d": as_of, "v": MODEL_VERSION},
        ).scalar()
    return n


def daterange(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def main():
    ap = argparse.ArgumentParser(description="MLB batter-prop projection engine (odds-free)")
    ap.add_argument("--date", help="single as-of date YYYY-MM-DD (default: today UTC)")
    ap.add_argument("--start", help="backfill start date YYYY-MM-DD (inclusive)")
    ap.add_argument("--end", help="backfill end date YYYY-MM-DD (inclusive)")
    args = ap.parse_args()

    engine = get_engine()
    ensure_table(engine)

    if args.start and args.end:
        start = date.fromisoformat(args.start)
        end = date.fromisoformat(args.end)
        log.info("Backfilling projections %s -> %s", start, end)
        total = 0
        for d in daterange(start, end):
            n = project_one(engine, d)
            total += n
            log.info("  %s: %d projection rows", d, n)
        log.info("Backfill complete: %d rows across %s..%s", total, start, end)
    else:
        as_of = date.fromisoformat(args.date) if args.date else datetime.now(timezone.utc).date()
        n = project_one(engine, as_of)
        log.info("Projections for as_of %s: %d rows (%s)", as_of, n, MODEL_VERSION)
        if n == 0:
            log.warning("No projections written for %s - is the slate/history loaded?", as_of)

    record_workflow_run("mlb-prop-projections")


if __name__ == "__main__":
    main()
