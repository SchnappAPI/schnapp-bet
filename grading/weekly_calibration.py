"""
weekly_calibration.py

Recalibrates the prop grading models on a rolling window of resolved
tier-line outcomes — one calibrator per sport (nba/mlb/nfl) via
grading/calibration_core.py: candidate selection (identity / Platt /
shrunk-isotonic) on a chronological holdout, published only when the
winner beats the currently-active calibrator (gate), with Brier /
log-loss / ECE snapshotted to common.grade_calibration_history.

Per ADR-20260425-3: this script (Sunday 06:00 UTC cron) is the only
writer of common.grade_calibration. Daily grading reads, never refits.

The NBA logistic grade-weight fitting (market-group shadow backtest into
common.grade_weights) is NBA-only: its feature set is NBA-native.

Window: rolling 30 days by default. Configurable via --window-days.
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit
from sqlalchemy import create_engine, text

from grading.calibration_core import SPORTS, calibrate_sport, ensure_calibration_schema

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# Calibrator constants (bucket width, n>=30 cap rule, shrinkage, gate) live in
# grading/calibration_core.py — this module only orchestrates.
DEFAULT_WINDOW_DAYS = 30

# Logistic model constants
LOGISTIC_WINDOW_DAYS = 90
LOGISTIC_MIN_ROWS = 50  # skip a market group if fewer resolved outcomes
LOGISTIC_C = 1.0  # inverse L2 regularization strength
OPP_SHRINKAGE_K = 25  # prior-sample constant for hit_rate_opp shrinkage
ROLE_VOL_SCALE = 15.0  # divide role_volatility by this to normalize to ~0-1

# Shadow backtest split (chronological)
BACKTEST_TRAIN_DAYS = 30
BACKTEST_HOLDOUT_DAYS = 7

MARKET_GROUP_MAP = {
    "player_points": "Volume",
    "player_points_alternate": "Volume",
    "player_points_rebounds_assists": "Volume",
    "player_points_rebounds_assists_alternate": "Volume",
    "player_points_rebounds": "Volume",
    "player_points_rebounds_alternate": "Volume",
    "player_points_assists": "Volume",
    "player_points_assists_alternate": "Volume",
    "player_rebounds_assists": "Volume",
    "player_rebounds_assists_alternate": "Volume",
    "player_threes": "Rate",
    "player_threes_alternate": "Rate",
    "player_steals": "Rate",
    "player_steals_alternate": "Rate",
    "player_blocks": "Rate",
    "player_blocks_alternate": "Rate",
    "player_rebounds": "Counting",
    "player_rebounds_alternate": "Counting",
    "player_assists": "Counting",
    "player_assists_alternate": "Counting",
}

LOGISTIC_FEATURE_NAMES = [
    "relevance_hit_rate",
    "log_effective_n",
    "momentum_norm",
    "pattern_norm",
    "hit_rate_opp_shrunk",
    "role_volatility_norm",
    "opp_ratio_minutes",
]


def get_engine():
    trust = os.environ.get("SQL_TRUST_CERT", "no")
    conn_str = (
        f"mssql+pyodbc://{os.environ['SQL_USERNAME']}:"
        f"{os.environ['SQL_PASSWORD']}@"
        f"{os.environ['SQL_SERVER']}/"
        f"{os.environ['SQL_DATABASE']}"
        "?driver=ODBC+Driver+18+for+SQL+Server"
        f"&Encrypt=yes&TrustServerCertificate={trust}"
        "&Connection+Timeout=90"
    )
    return create_engine(conn_str, fast_executemany=False)


def ensure_grade_weights_table(engine):
    """Create common.grade_weights if it does not exist."""
    with engine.begin() as conn:
        conn.execute(
            text("""
            IF NOT EXISTS (SELECT 1 FROM sys.objects
                           WHERE object_id = OBJECT_ID('common.grade_weights') AND type = 'U')
            BEGIN
                CREATE TABLE common.grade_weights (
                    weight_id        INT IDENTITY(1,1) PRIMARY KEY,
                    market_group     VARCHAR(20)  NOT NULL,
                    feature_name     VARCHAR(50)  NOT NULL,
                    coefficient      FLOAT        NOT NULL,
                    intercept        FLOAT        NOT NULL,
                    holdout_score    FLOAT        NULL,
                    production_score FLOAT        NULL,
                    effective_from   DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
                    is_active        BIT          NOT NULL DEFAULT 1,
                    model_version    VARCHAR(50)  NOT NULL,
                    created_at       DATETIME2    NOT NULL DEFAULT GETUTCDATE()
                );
                CREATE INDEX ix_grade_weights_group_active
                    ON common.grade_weights (market_group, is_active, effective_from DESC);
            END
        """)
        )


def ensure_calibration_log_table(engine):
    """Create common.calibration_history if it does not exist."""
    with engine.begin() as conn:
        conn.execute(
            text("""
            IF NOT EXISTS (SELECT 1 FROM sys.objects
                           WHERE object_id = OBJECT_ID('common.calibration_history') AND type = 'U')
            BEGIN
                CREATE TABLE common.calibration_history (
                    run_id           INT IDENTITY(1,1) PRIMARY KEY,
                    snapshot_date    DATE         NOT NULL,
                    market_group     VARCHAR(20)  NOT NULL,
                    n_train          INT          NULL,
                    n_holdout        INT          NULL,
                    candidate_score  FLOAT        NULL,
                    production_score FLOAT        NULL,
                    weights_updated  BIT          NOT NULL DEFAULT 0,
                    model_version    VARCHAR(50)  NULL,
                    created_at       DATETIME2    NOT NULL DEFAULT GETUTCDATE()
                );
            END
        """)
        )


def ensure_model_performance_table(engine):
    """Create common.model_performance if it does not exist."""
    with engine.begin() as conn:
        conn.execute(
            text("""
            IF NOT EXISTS (SELECT 1 FROM sys.objects
                           WHERE object_id = OBJECT_ID('common.model_performance') AND type = 'U')
            BEGIN
                CREATE TABLE common.model_performance (
                    perf_id                     INT IDENTITY(1,1) PRIMARY KEY,
                    snapshot_date               DATE         NOT NULL,
                    model_version               VARCHAR(50)  NULL,
                    market_group                VARCHAR(20)  NOT NULL,
                    n_resolved                  INT          NOT NULL,
                    hit_rate                    FLOAT        NULL,
                    avg_ev_pct                  FLOAT        NULL,
                    profit_weighted_score       FLOAT        NULL,
                    composite_grade_correlation FLOAT        NULL,
                    created_at                  DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
                    CONSTRAINT uq_model_performance UNIQUE (snapshot_date, market_group)
                );
            END
        """)
        )


def fetch_resolved_for_performance(engine, window_days):
    """Pull resolved Over grades needed for model performance metrics.

    Fetches composite_grade (pre-v2 baseline), model_prob/implied_prob/ev_pct
    (Phase 5 columns, NULL for pre-Phase-5 rows), and outcome_binary.
    Only Over outcome_name rows are included so hit_rate = Over hit rate.
    """
    market_keys_in = ", ".join(f"'{k}'" for k in MARKET_GROUP_MAP)
    sql = text(f"""
        SELECT
            dg.market_key,
            dg.composite_grade,
            dg.model_prob,
            dg.implied_prob,
            dg.ev_pct,
            CASE dg.outcome WHEN 'Won' THEN 1.0 ELSE 0.0 END AS outcome_binary
        FROM common.daily_grades dg
        WHERE dg.grade_date >= DATEADD(day, :window_neg, CAST(GETUTCDATE() AS DATE))
          AND dg.outcome IN ('Won', 'Lost')
          AND dg.outcome_name = 'Over'
          AND dg.market_key IN ({market_keys_in})
    """)
    return pd.read_sql(sql, engine, params={"window_neg": -int(window_days)})


def write_calibration_log(
    engine, market_group, n_train, n_holdout, candidate_score, production_score, weights_updated, model_version
):
    """Upsert one calibration log row for (snapshot_date, market_group)."""
    snapshot_date = datetime.now(timezone.utc).date()
    with engine.begin() as conn:
        conn.execute(
            text("""
                DELETE FROM common.calibration_history
                 WHERE snapshot_date = :snap AND market_group = :g
            """),
            {"snap": snapshot_date, "g": market_group},
        )
        conn.execute(
            text("""
                INSERT INTO common.calibration_history
                    (snapshot_date, market_group, n_train, n_holdout,
                     candidate_score, production_score, weights_updated, model_version)
                VALUES (:snap, :g, :nt, :nh, :cs, :ps, :wu, :mv)
            """),
            {
                "snap": snapshot_date,
                "g": market_group,
                "nt": n_train,
                "nh": n_holdout,
                "cs": float(candidate_score) if candidate_score is not None else None,
                "ps": float(production_score) if production_score is not None else None,
                "wu": 1 if weights_updated else 0,
                "mv": model_version,
            },
        )
    log.info(
        f"Logged calibration: group={market_group}, candidate={candidate_score}, "
        f"production={production_score}, updated={weights_updated}."
    )


def fetch_grade_corpus(engine, window_days):
    """Pull resolved daily_grades rows with Phase 2 features for logistic training.

    Computes opp_ratio_minutes as (avg minutes last 7 days) / (avg minutes days 8-35)
    from nba.player_usage_stats. Defaults to 1.0 when usage data is absent.
    """
    market_keys_in = ", ".join(f"'{k}'" for k in MARKET_GROUP_MAP)
    sql = text(f"""
        SELECT
            dg.player_id,
            dg.market_key,
            dg.grade_date,
            dg.over_price,
            dg.relevance_hit_rate,
            dg.effective_n,
            dg.momentum_grade,
            dg.pattern_grade,
            dg.hit_rate_opp,
            dg.sample_size_opp,
            dg.role_volatility,
            COALESCE(
                (SELECT AVG(us_r.minutes * 1.0)
                   FROM nba.player_usage_stats us_r
                  WHERE us_r.player_id = dg.player_id
                    AND us_r.game_date >= DATEADD(day, -7, dg.grade_date)
                    AND us_r.game_date <  dg.grade_date)
                / NULLIF(
                    (SELECT AVG(us_h.minutes * 1.0)
                       FROM nba.player_usage_stats us_h
                      WHERE us_h.player_id = dg.player_id
                        AND us_h.game_date >= DATEADD(day, -35, dg.grade_date)
                        AND us_h.game_date <  DATEADD(day, -7, dg.grade_date)),
                    0), 1.0) AS opp_ratio_minutes,
            CASE dg.outcome WHEN 'Won' THEN 1 ELSE 0 END AS outcome_binary
        FROM common.daily_grades dg
        WHERE dg.grade_date >= DATEADD(day, :window_neg, CAST(GETUTCDATE() AS DATE))
          AND dg.outcome IN ('Won', 'Lost')
          AND dg.relevance_hit_rate IS NOT NULL
          AND dg.effective_n IS NOT NULL
          AND dg.market_key IN ({market_keys_in})
    """)
    return pd.read_sql(sql, engine, params={"window_neg": -window_days})


def assemble_features(df_group):
    """Build feature matrix X and target vector y for one market group slice.

    Applies opponent hit-rate shrinkage toward the group mean, normalizes
    momentum/pattern to [0,1], and log-transforms effective_n. Rows with
    any NULL required feature are dropped with a warning.

    Returns (X, y, feature_names) or (None, None, None) if too few rows remain.
    """
    df = df_group.copy()
    pop_mean = df["relevance_hit_rate"].mean()

    n_opp = df["sample_size_opp"].fillna(0)
    h_opp = df["hit_rate_opp"].fillna(pop_mean)
    df["hit_rate_opp_shrunk"] = (n_opp * h_opp + OPP_SHRINKAGE_K * pop_mean) / (n_opp + OPP_SHRINKAGE_K)

    df["log_effective_n"] = np.log1p(df["effective_n"].clip(lower=0))
    df["momentum_norm"] = df["momentum_grade"].fillna(50.0) / 100.0
    df["pattern_norm"] = df["pattern_grade"].fillna(50.0) / 100.0
    df["role_volatility_norm"] = df["role_volatility"].fillna(0.0) / ROLE_VOL_SCALE
    df["opp_ratio_minutes"] = df["opp_ratio_minutes"].fillna(1.0).clip(0.1, 5.0)

    required = [
        "relevance_hit_rate",
        "log_effective_n",
        "momentum_norm",
        "pattern_norm",
        "hit_rate_opp_shrunk",
        "role_volatility_norm",
        "opp_ratio_minutes",
    ]
    before = len(df)
    df = df.dropna(subset=required)
    dropped = before - len(df)
    if dropped:
        log.warning(f"Dropped {dropped} rows with NULL features.")

    if len(df) < LOGISTIC_MIN_ROWS:
        return None, None, None

    X = df[LOGISTIC_FEATURE_NAMES].values.astype(float)
    y = df["outcome_binary"].values.astype(float)
    return X, y, LOGISTIC_FEATURE_NAMES


def _fit_logistic(X, y):
    """Minimize logistic cross-entropy with L2 regularization via L-BFGS-B.

    Returns (coef, intercept) where coef is a 1-D array of length n_features.
    """
    n = X.shape[1]

    def loss(params):
        w, b = params[:n], params[n]
        p = np.clip(expit(X @ w + b), 1e-9, 1 - 1e-9)
        nll = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
        return nll + (0.5 / LOGISTIC_C) * np.dot(w, w)

    result = minimize(loss, np.zeros(n + 1), method="L-BFGS-B")
    if not result.success:
        log.warning(f"Logistic optimizer: {result.message}")
    return result.x[:n], float(result.x[n])


def _implied_prob(prices):
    """Vectorized American odds → implied probability. prices is a numpy float array."""
    pos = prices >= 0
    return np.where(pos, 100.0 / (prices + 100.0), np.abs(prices) / (np.abs(prices) + 100.0))


def score_holdout(df_holdout, coef, intercept, pop_mean):
    """Compute flat-$1 profit-weighted score on holdout rows using candidate weights.

    Feature engineering mirrors assemble_features but uses training pop_mean for
    opponent shrinkage so holdout statistics don't leak into the normalization.
    Returns (score: float, n_scored: int).
    """
    if df_holdout.empty:
        return 0.0, 0

    df = df_holdout.copy()
    n_opp = df["sample_size_opp"].fillna(0)
    h_opp = df["hit_rate_opp"].fillna(pop_mean)
    df["hit_rate_opp_shrunk"] = (n_opp * h_opp + OPP_SHRINKAGE_K * pop_mean) / (n_opp + OPP_SHRINKAGE_K)
    df["log_effective_n"] = np.log1p(df["effective_n"].clip(lower=0))
    df["momentum_norm"] = df["momentum_grade"].fillna(50.0) / 100.0
    df["pattern_norm"] = df["pattern_grade"].fillna(50.0) / 100.0
    df["role_volatility_norm"] = df["role_volatility"].fillna(0.0) / ROLE_VOL_SCALE
    df["opp_ratio_minutes"] = df["opp_ratio_minutes"].fillna(1.0).clip(0.1, 5.0)

    required = LOGISTIC_FEATURE_NAMES + ["over_price"]
    df = df.dropna(subset=required)
    if df.empty:
        return 0.0, 0

    X = df[LOGISTIC_FEATURE_NAMES].values.astype(float)
    prices = df["over_price"].values.astype(float)

    model_prob = expit(X @ coef + intercept)
    implied = _implied_prob(prices)
    payout = np.where(prices >= 0, prices / 100.0, 100.0 / np.abs(prices))
    ev_pct = (model_prob * payout - (1.0 - model_prob)) * 100.0

    score = float(ev_pct[model_prob > implied].sum())
    return score, len(df)


def get_production_score(engine, market_group, df_holdout, pop_mean):
    """Score the currently-active weights for market_group against the holdout set.

    Returns 0.0 if no active weights exist (candidate wins unconditionally on first run).
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT feature_name, coefficient, intercept
                  FROM common.grade_weights
                 WHERE market_group = :g AND is_active = 1
                 ORDER BY feature_name
            """),
            {"g": market_group},
        ).fetchall()

    if not rows:
        return 0.0

    weight_map = {r[0]: r[1] for r in rows}
    intercept = float(rows[0][2])
    coef = np.array([weight_map.get(fn, 0.0) for fn in LOGISTIC_FEATURE_NAMES])

    score, _ = score_holdout(df_holdout, coef, intercept, pop_mean)
    return score


def write_model_performance(engine, df, model_version):
    """Compute per-market-group performance metrics and upsert to common.model_performance.

    Writes three rows per run (Volume / Rate / Counting). Idempotent: deletes
    today's rows then inserts fresh. Skips groups with no resolved rows.
    """
    ensure_model_performance_table(engine)

    if df is None or df.empty:
        log.warning("No resolved rows for model performance; skipping.")
        return 0

    df = df.copy()
    df["market_group"] = df["market_key"].map(MARKET_GROUP_MAP)
    df = df.dropna(subset=["market_group"])

    snapshot_date = datetime.now(timezone.utc).date()
    rows = []

    for group in ("Volume", "Rate", "Counting"):
        g = df[df["market_group"] == group]
        if g.empty:
            log.warning(f"model_performance: no resolved rows for group={group}; skipping row.")
            continue

        n = len(g)
        hit_rate = float(g["outcome_binary"].mean())

        ev_valid = g["ev_pct"].dropna()
        avg_ev_pct = float(ev_valid.mean()) if not ev_valid.empty else None

        pos_ev = g[g["model_prob"].notna() & g["implied_prob"].notna() & (g["model_prob"] > g["implied_prob"])]
        pws = float(pos_ev["ev_pct"].sum()) if not pos_ev.empty else 0.0

        valid_corr = g[["composite_grade", "outcome_binary"]].dropna()
        if len(valid_corr) >= 2:
            corr = float(np.corrcoef(valid_corr["composite_grade"].values, valid_corr["outcome_binary"].values)[0, 1])
        else:
            corr = None

        rows.append(
            {
                "snap": snapshot_date,
                "mv": model_version,
                "g": group,
                "n": n,
                "hr": hit_rate,
                "aev": avg_ev_pct,
                "pws": pws,
                "cgc": corr,
            }
        )

    if not rows:
        log.warning("model_performance: no groups produced rows; nothing written.")
        return 0

    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM common.model_performance WHERE snapshot_date = :snap"),
            {"snap": snapshot_date},
        )
        for r in rows:
            conn.execute(
                text("""
                    INSERT INTO common.model_performance
                        (snapshot_date, model_version, market_group, n_resolved,
                         hit_rate, avg_ev_pct, profit_weighted_score,
                         composite_grade_correlation)
                    VALUES (:snap, :mv, :g, :n, :hr, :aev, :pws, :cgc)
                """),
                r,
            )
    log.info(f"Wrote {len(rows)} model_performance rows for snapshot_date={snapshot_date}.")
    return len(rows)


def write_grade_weights(
    engine, market_group, coef, intercept, feature_names, model_version, holdout_score=None, production_score=None
):
    """Deactivate prior weights for this market group and insert fresh rows.

    Each feature gets its own row; the intercept is repeated on all rows so
    Phase 5 can load the full model with a single WHERE market_group = ? query.
    """
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE common.grade_weights SET is_active = 0 WHERE market_group = :g"),
            {"g": market_group},
        )
        for fname, c in zip(feature_names, coef):
            conn.execute(
                text("""
                    INSERT INTO common.grade_weights
                        (market_group, feature_name, coefficient, intercept,
                         holdout_score, production_score, is_active, model_version)
                    VALUES (:g, :fn, :c, :b, :hs, :ps, 1, :mv)
                """),
                {
                    "g": market_group,
                    "fn": fname,
                    "c": float(c),
                    "b": intercept,
                    "hs": float(holdout_score) if holdout_score is not None else None,
                    "ps": float(production_score) if production_score is not None else None,
                    "mv": model_version,
                },
            )
    log.info(f"Wrote {len(feature_names)} weight rows for group={market_group}.")


def fit_logistic_models(engine, model_version):
    """Fit one logistic model per market group using a train/holdout shadow backtest.

    Train on days 1–30 (oldest), validate on days 31–37 (most recent week). Write
    weights only if candidate profit-weighted score beats the currently-active production
    weights on the same holdout set. Always logs to common.calibration_history.
    """
    ensure_grade_weights_table(engine)
    ensure_calibration_log_table(engine)

    total_days = BACKTEST_TRAIN_DAYS + BACKTEST_HOLDOUT_DAYS
    df = fetch_grade_corpus(engine, total_days)
    log.info(f"Backtest corpus: {len(df)} resolved rows over {total_days} days.")

    if df.empty:
        log.warning("Empty corpus; skipping logistic fitting.")
        return

    df["market_group"] = df["market_key"].map(MARKET_GROUP_MAP)
    df["grade_date"] = pd.to_datetime(df["grade_date"]).dt.date

    max_date = df["grade_date"].max()
    holdout_start = max_date - pd.Timedelta(days=BACKTEST_HOLDOUT_DAYS - 1)
    df_train_all = df[df["grade_date"] < holdout_start]
    df_holdout_all = df[df["grade_date"] >= holdout_start]

    for group in ("Volume", "Rate", "Counting"):
        df_train = df_train_all[df_train_all["market_group"] == group].reset_index(drop=True)
        df_holdout = df_holdout_all[df_holdout_all["market_group"] == group].reset_index(drop=True)

        X, y, feature_names = assemble_features(df_train)
        if X is None:
            log.warning(f"Group {group}: fewer than {LOGISTIC_MIN_ROWS} train rows — skipping.")
            write_calibration_log(engine, group, len(df_train), len(df_holdout), None, None, False, model_version)
            continue

        coef, intercept = _fit_logistic(X, y)
        pop_mean = float(df_train["relevance_hit_rate"].mean())

        candidate_score, n_scored = score_holdout(df_holdout, coef, intercept, pop_mean)
        production_score = get_production_score(engine, group, df_holdout, pop_mean)

        weights_updated = n_scored > 0 and candidate_score > production_score
        log.info(
            f"Group {group}: train={len(df_train)}, holdout={n_scored}, "
            f"candidate={candidate_score:.4f}, production={production_score:.4f}, "
            f"update={weights_updated}"
        )

        if weights_updated:
            write_grade_weights(
                engine,
                group,
                coef,
                intercept,
                feature_names,
                model_version,
                holdout_score=candidate_score,
                production_score=production_score,
            )

        write_calibration_log(
            engine, group, len(df_train), n_scored, candidate_score, production_score, weights_updated, model_version
        )


def main():
    parser = argparse.ArgumentParser(description="Weekly recalibration of the grading model")
    parser.add_argument("--window-days", type=int, default=DEFAULT_WINDOW_DAYS)
    parser.add_argument("--sport", type=str, default="all", help="nba | mlb | nfl | all (default all)")
    parser.add_argument(
        "--model-version",
        type=str,
        default=None,
        help="Model version stamp to record on the snapshot. "
        "Defaults to looking up the most recent on common.daily_grades.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Compute the calibrator but do not write to DB.")
    args = parser.parse_args()

    engine = get_engine()
    sports = list(SPORTS) if args.sport == "all" else [args.sport]
    log.info(f"Window: {args.window_days} days. Sports: {sports}.")

    if not args.dry_run:
        ensure_calibration_schema(engine)

    def latest_model_version(sport):
        if args.model_version is not None:
            return args.model_version
        with engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT TOP 1 model_version
                      FROM common.daily_grades
                     WHERE model_version IS NOT NULL AND sport = :s
                  ORDER BY grade_date DESC, grade_id DESC
                """),
                {"s": sport},
            ).fetchone()
            return row[0] if row else None

    for sport in sports:
        model_version = latest_model_version(sport)
        log.info(f"[{sport}] model version stamp: {model_version}")
        result = calibrate_sport(engine, sport, args.window_days, model_version, dry_run=args.dry_run)
        log.info(f"[{sport}] calibration result: {result}")

    if "nba" in sports:
        if args.dry_run:
            log.info("Dry run; skipping NBA logistic fitting + model performance.")
        else:
            log.info("Fitting NBA logistic grade models...")
            try:
                fit_logistic_models(engine, latest_model_version("nba"))
            except Exception as exc:
                log.error(f"Logistic model fitting failed: {exc}", exc_info=True)
                raise

            log.info("Writing NBA model performance snapshot...")
            df_perf = fetch_resolved_for_performance(engine, args.window_days)
            write_model_performance(engine, df_perf, latest_model_version("nba"))

    log.info("Weekly calibration done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
