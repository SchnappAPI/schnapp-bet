"""
calibration_core.py

Sport-aware probability calibration for the prop grading models.
Used by weekly_calibration.py (fit + gated publish) and by the per-sport
grading scripts (load + apply).

Design (docs/superpowers/specs/2026-07-11-calibration-v2-nfl-model-design.md):

- One calibrator per sport in common.grade_calibration, keyed (sport, bucket_min).
- Three candidate methods fit on a chronological train split, scored on a
  holdout of the most recent HOLDOUT_DAYS, by log loss:
    identity  - passthrough (always in the pool; the floor)
    platt     - p' = expit(a * logit(p) + b), 2-parameter MLE
    isotonic  - 0.05 buckets, empirical-Bayes shrinkage toward the pooled
                mean (n/(n+SHRINKAGE_K)), PAV, evaluated by piecewise-linear
                interpolation between bucket centers (no step edges)
- The winner replaces production ONLY if it beats the currently-active
  calibrator on the same holdout (gate). Metrics (Brier, log loss, ECE)
  are snapshotted to common.grade_calibration_history every run.
- Cold-start: when a sport has fewer than LIVE_CORPUS_MIN live resolved
  rows, the corpus is unioned with backtest rows from
  common.calibration_corpus (written by seed_calibration_corpus.py).

Storage encoding in common.grade_calibration:
    identity - single row, bucket_min = -1, method = 'identity'
    platt    - single row, bucket_min = -1, method = 'platt', param_a/param_b
    isotonic - one row per bucket, method = 'isotonic'
    (no rows for a sport = identity)
"""

import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit, logit
from sqlalchemy import text

log = logging.getLogger(__name__)

BUCKET_WIDTH = 0.05
MIN_BUCKET_SIZE = 20
# Well-sampled bucket qualification for the probability cap: n >= 30 (do not lower).
WELL_SAMPLED_THRESHOLD = 30
SHRINKAGE_K = 50  # empirical-Bayes prior weight per bucket
HOLDOUT_DAYS = 7
MIN_CORPUS_ROWS = 300  # below this, skip the sport entirely
LIVE_CORPUS_MIN = 2000  # below this, union backtest seed rows
GATE_MARGIN = 1e-4  # candidate must beat production log loss by this
EPS = 1e-6

SPORTS = ("nba", "mlb", "nfl")


# ---------------------------------------------------------------------------
# Schema (idempotent; safe to call every run)
# ---------------------------------------------------------------------------


def ensure_calibration_schema(engine):
    """Add the sport dimension and v2 columns. Backfills sport from
    model_version on the two big grading tables (mlb-* -> mlb, nfl-* -> nfl,
    everything else including NULL is NBA-era)."""
    with engine.begin() as conn:
        for tbl in ("common.daily_grades", "common.player_tier_lines"):
            schema, table = tbl.split(".")
            conn.execute(
                text(f"""
                IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                               WHERE TABLE_SCHEMA='{schema}' AND TABLE_NAME='{table}'
                                 AND COLUMN_NAME='sport')
                    ALTER TABLE {tbl} ADD sport VARCHAR(10) NULL
            """)
            )
        conn.execute(
            text("""
            UPDATE common.daily_grades
               SET sport = CASE WHEN model_version LIKE 'mlb%' THEN 'mlb'
                                WHEN model_version LIKE 'nfl%' THEN 'nfl'
                                ELSE 'nba' END
             WHERE sport IS NULL
        """)
        )
        conn.execute(
            text("""
            UPDATE common.player_tier_lines
               SET sport = CASE WHEN model_version LIKE 'mlb%' THEN 'mlb'
                                WHEN model_version LIKE 'nfl%' THEN 'nfl'
                                ELSE 'nba' END
             WHERE sport IS NULL
        """)
        )
        conn.execute(
            text("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes
                           WHERE name = 'ix_daily_grades_sport_date'
                             AND object_id = OBJECT_ID('common.daily_grades'))
                CREATE INDEX ix_daily_grades_sport_date
                    ON common.daily_grades (sport, grade_date) INCLUDE (outcome)
        """)
        )

        # grade_calibration: sport + method columns, PK widened to (sport, bucket_min).
        conn.execute(
            text("""
            IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                           WHERE TABLE_SCHEMA='common' AND TABLE_NAME='grade_calibration'
                             AND COLUMN_NAME='sport')
            BEGIN
                ALTER TABLE common.grade_calibration
                    ADD sport VARCHAR(10) NOT NULL DEFAULT 'nba',
                        method VARCHAR(10) NOT NULL DEFAULT 'isotonic',
                        param_a FLOAT NULL,
                        param_b FLOAT NULL;
            END
        """)
        )
        # Swap the PK to (sport, bucket_min). The old constraint's name is
        # discovered dynamically — it varies by creation path and collation
        # (pk_grade_calibration vs PK_grade_calibration vs system-generated);
        # keying on a literal name would silently no-op and the first
        # multi-sport publish would then collide on the single-column PK.
        conn.execute(
            text("""
            DECLARE @pk sysname = (
                SELECT kc.name FROM sys.key_constraints kc
                WHERE kc.parent_object_id = OBJECT_ID('common.grade_calibration')
                  AND kc.type = 'PK');
            IF @pk IS NOT NULL AND @pk <> 'pk_grade_calibration_v2'
            BEGIN
                EXEC('ALTER TABLE common.grade_calibration DROP CONSTRAINT [' + @pk + '];
                      ALTER TABLE common.grade_calibration
                          ADD CONSTRAINT pk_grade_calibration_v2 PRIMARY KEY (sport, bucket_min);');
            END
        """)
        )

        # history: per-run quality metrics
        for col, sqltype in (
            ("method", "VARCHAR(10)"),
            ("brier", "FLOAT"),
            ("log_loss", "FLOAT"),
            ("ece", "FLOAT"),
            ("n_corpus", "INT"),
            ("gate_passed", "BIT"),
        ):
            conn.execute(
                text(f"""
                IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                               WHERE TABLE_SCHEMA='common' AND TABLE_NAME='grade_calibration_history'
                                 AND COLUMN_NAME='{col}')
                    ALTER TABLE common.grade_calibration_history ADD {col} {sqltype} NULL
            """)
            )

        # Backtest seed corpus (written by seed_calibration_corpus.py)
        conn.execute(
            text("""
            IF NOT EXISTS (SELECT 1 FROM sys.objects
                           WHERE object_id = OBJECT_ID('common.calibration_corpus') AND type = 'U')
            CREATE TABLE common.calibration_corpus (
                sport       VARCHAR(10)  NOT NULL,
                grade_date  DATE         NOT NULL,
                player_id   BIGINT       NOT NULL,
                market_key  VARCHAR(100) NOT NULL,
                tier        VARCHAR(10)  NOT NULL,
                line_value  FLOAT        NOT NULL,
                raw_prob    FLOAT        NOT NULL,
                hit         BIT          NOT NULL,
                source      VARCHAR(20)  NOT NULL DEFAULT 'backtest',
                created_at  DATETIME2    NOT NULL DEFAULT GETUTCDATE(),
                CONSTRAINT pk_calibration_corpus
                    PRIMARY KEY (sport, grade_date, player_id, market_key, tier)
            )
        """)
        )
    log.info("Calibration schema ensured (sport columns, v2 calibration tables).")


# ---------------------------------------------------------------------------
# Corpus
# ---------------------------------------------------------------------------


def fetch_corpus(engine, sport, window_days):
    """Resolved (raw_prob, hit, grade_date) corpus for one sport.

    Live rows: every tier-line probability joined to its resolved Over
    outcome (Won/Lost only; Push and DNP are excluded by the IN filter).
    When the live corpus is thin (< LIVE_CORPUS_MIN), backtest seed rows
    from common.calibration_corpus are unioned in; live data supersedes
    the seed entirely once it clears the threshold.
    """
    sql = text("""
        SELECT tp.raw_prob, tp.grade_date,
               CASE WHEN dg.outcome = 'Won' THEN 1.0 ELSE 0.0 END AS hit
          FROM (
              SELECT grade_date, game_id, player_id, market_key, sport,
                     safe_line AS line, safe_prob AS raw_prob
                FROM common.player_tier_lines
               WHERE safe_line IS NOT NULL AND safe_prob IS NOT NULL
              UNION ALL
              SELECT grade_date, game_id, player_id, market_key, sport,
                     value_line, value_prob
                FROM common.player_tier_lines
               WHERE value_line IS NOT NULL AND value_prob IS NOT NULL
              UNION ALL
              SELECT grade_date, game_id, player_id, market_key, sport,
                     highrisk_line, highrisk_prob
                FROM common.player_tier_lines
               WHERE highrisk_line IS NOT NULL AND highrisk_prob IS NOT NULL
              UNION ALL
              SELECT grade_date, game_id, player_id, market_key, sport,
                     lotto_line, lotto_prob
                FROM common.player_tier_lines
               WHERE lotto_line IS NOT NULL AND lotto_prob IS NOT NULL
          ) tp
         INNER JOIN common.daily_grades dg
                ON dg.grade_date = tp.grade_date
               AND dg.game_id    = tp.game_id
               AND dg.player_id  = tp.player_id
               AND dg.market_key = tp.market_key
               AND dg.line_value = tp.line
               AND dg.outcome_name = 'Over'
         WHERE dg.outcome IN ('Won', 'Lost')
           AND tp.sport = :sport
           AND tp.grade_date >= DATEADD(day, -:window, CAST(GETUTCDATE() AS DATE))
    """)
    live = pd.read_sql(sql, engine, params={"sport": sport, "window": int(window_days)})
    live["is_seed"] = 0

    if len(live) >= LIVE_CORPUS_MIN:
        return live

    seed = pd.read_sql(
        text("""SELECT raw_prob, grade_date,
                       CAST(hit AS FLOAT) AS hit
                  FROM common.calibration_corpus WHERE sport = :sport"""),
        engine,
        params={"sport": sport},
    )
    if seed.empty:
        return live
    seed["is_seed"] = 1
    log.info(f"[{sport}] live corpus {len(live)} < {LIVE_CORPUS_MIN}; unioned {len(seed)} backtest seed rows.")
    return pd.concat([live, seed], ignore_index=True)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def _clip(p):
    return np.clip(np.asarray(p, dtype=float), EPS, 1.0 - EPS)


def brier_score(p, y):
    p = np.asarray(p, dtype=float)
    y = np.asarray(y, dtype=float)
    return float(np.mean((p - y) ** 2))


def log_loss_score(p, y):
    p = _clip(p)
    y = np.asarray(y, dtype=float)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def ece_score(p, y, n_bins=10):
    """Expected calibration error over equal-width bins."""
    p = np.asarray(p, dtype=float)
    y = np.asarray(y, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    total = len(p)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi) if hi < 1.0 else (p >= lo) & (p <= hi)
        n = int(mask.sum())
        if n == 0:
            continue
        ece += (n / total) * abs(float(y[mask].mean()) - float(p[mask].mean()))
    return float(ece)


# ---------------------------------------------------------------------------
# Calibrator representation
#
# A calibrator is a plain dict:
#   {"method": "identity"}
#   {"method": "platt", "a": float, "b": float}
#   {"method": "isotonic", "x": [bucket centers], "y": [iso rates],
#    "cap": float | None, "buckets": DataFrame}   # buckets only present at fit time
# ---------------------------------------------------------------------------


def apply_calibrator(cal, p):
    """Vectorized: raw prob(s) -> calibrated prob(s). Accepts scalar or array."""
    scalar = np.isscalar(p)
    p_arr = _clip(p if not scalar else [p])
    if cal is None or cal["method"] == "identity":
        out = np.asarray(p_arr, dtype=float)
    elif cal["method"] == "platt":
        out = expit(cal["a"] * logit(p_arr) + cal["b"])
    elif cal["method"] == "isotonic":
        out = np.interp(p_arr, cal["x"], cal["y"])
        if cal.get("cap") is not None:
            out = np.minimum(out, cal["cap"])
    else:
        raise ValueError(f"Unknown calibration method {cal['method']}")
    out = np.clip(out, 0.0, 1.0)
    return float(out[0]) if scalar else out


def _pav_isotonic(y, w):
    """Pool-adjacent-violators, weighted, non-decreasing."""
    blocks = [[float(y[i]) * float(w[i]), float(w[i]), 1] for i in range(len(y))]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] / blocks[i][1] > blocks[i + 1][0] / blocks[i + 1][1]:
            merged = [blocks[i][0] + blocks[i + 1][0], blocks[i][1] + blocks[i + 1][1], blocks[i][2] + blocks[i + 1][2]]
            blocks[i : i + 2] = [merged]
            if i > 0:
                i -= 1
        else:
            i += 1
    out = []
    for b in blocks:
        out.extend([b[0] / b[1]] * b[2])
    return np.array(out)


def fit_identity(_p, _y):
    return {"method": "identity"}


def fit_platt(p, y):
    """2-parameter Platt scaling on the logit of the raw prob, by MLE."""
    z = logit(_clip(p))
    y = np.asarray(y, dtype=float)

    def nll(params):
        a, b = params
        q = np.clip(expit(a * z + b), EPS, 1 - EPS)
        return -np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))

    res = minimize(nll, np.array([1.0, 0.0]), method="L-BFGS-B")
    if not res.success:
        log.warning(f"Platt optimizer: {res.message}")
    a, b = float(res.x[0]), float(res.x[1])
    # A negative slope means the fit inverted the ranking (pathological corpus);
    # refuse it rather than publish an anti-monotone calibrator.
    if a <= 0:
        return None
    return {"method": "platt", "a": a, "b": b}


def fit_isotonic(p, y):
    """Bucketed, shrunken, PAV-monotone fit evaluated by linear interpolation.

    Bucket hit rates are shrunk toward the pooled mean by n/(n+SHRINKAGE_K)
    before PAV so thin buckets cannot drag the curve. The probability cap is
    the max EMPIRICAL (unshrunk) rate among well-sampled buckets, matching
    the long-standing n >= 30 rule.
    """
    df = pd.DataFrame({"p": np.asarray(p, dtype=float), "y": np.asarray(y, dtype=float)})
    df["bucket"] = (df["p"] // BUCKET_WIDTH) * BUCKET_WIDTH
    stats = df.groupby("bucket").agg(n=("y", "size"), rate=("y", "mean")).reset_index().sort_values("bucket")
    stats = stats[stats["n"] >= MIN_BUCKET_SIZE].reset_index(drop=True)
    if len(stats) < 3:
        return None

    pooled = float(df["y"].mean())
    n = stats["n"].values.astype(float)
    shrunk = (n * stats["rate"].values + SHRINKAGE_K * pooled) / (n + SHRINKAGE_K)
    iso = _pav_isotonic(shrunk, n)

    well = stats[stats["n"] >= WELL_SAMPLED_THRESHOLD]
    cap = float(well["rate"].max()) if len(well) else float(iso.max())

    centers = (stats["bucket"] + BUCKET_WIDTH / 2).values.astype(float)
    buckets = pd.DataFrame(
        {
            "bucket_min": stats["bucket"].astype(float).values,
            "bucket_max": (stats["bucket"] + BUCKET_WIDTH).astype(float).values,
            "n": stats["n"].astype(int).values,
            "empirical_hit_rate": stats["rate"].astype(float).values,
            "isotonic_hit_rate": iso.astype(float),
        }
    )
    return {"method": "isotonic", "x": centers.tolist(), "y": iso.tolist(), "cap": cap, "buckets": buckets}


# ---------------------------------------------------------------------------
# Load / publish
# ---------------------------------------------------------------------------


def load_calibrator(engine, sport):
    """Read the active calibrator for a sport. Absent rows -> identity."""
    try:
        rows = pd.read_sql(
            text("""SELECT bucket_min, bucket_max, method, param_a, param_b,
                           isotonic_hit_rate, max_well_sampled_rate
                      FROM common.grade_calibration
                     WHERE sport = :s ORDER BY bucket_min"""),
            engine,
            params={"s": sport},
        )
    except Exception as exc:
        log.info(f"load_calibrator({sport}): {exc}; identity.")
        return {"method": "identity"}
    if rows.empty:
        return {"method": "identity"}
    method = rows.iloc[0]["method"] or "isotonic"
    if method == "identity":
        return {"method": "identity"}
    if method == "platt":
        return {"method": "platt", "a": float(rows.iloc[0]["param_a"]), "b": float(rows.iloc[0]["param_b"])}
    centers = ((rows["bucket_min"] + rows["bucket_max"]) / 2).values.astype(float)
    cap = rows["max_well_sampled_rate"].iloc[0]
    return {
        "method": "isotonic",
        "x": centers.tolist(),
        "y": rows["isotonic_hit_rate"].astype(float).tolist(),
        "cap": float(cap) if pd.notna(cap) else None,
    }


def publish_calibrator(engine, sport, cal):
    """Replace the sport's rows in common.grade_calibration (DELETE + INSERT)."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM common.grade_calibration WHERE sport = :s"), {"s": sport})
        if cal["method"] in ("identity", "platt"):
            conn.execute(
                text("""
                INSERT INTO common.grade_calibration
                    (sport, bucket_min, bucket_max, sample_size,
                     empirical_hit_rate, isotonic_hit_rate,
                     max_well_sampled_rate, method, param_a, param_b)
                VALUES (:s, -1, -1, 0, 0, 0, NULL, :m, :a, :b)
            """),
                {"s": sport, "m": cal["method"], "a": cal.get("a"), "b": cal.get("b")},
            )
        else:
            for _, r in cal["buckets"].iterrows():
                conn.execute(
                    text("""
                    INSERT INTO common.grade_calibration
                        (sport, bucket_min, bucket_max, sample_size,
                         empirical_hit_rate, isotonic_hit_rate,
                         max_well_sampled_rate, method, param_a, param_b)
                    VALUES (:s, :bmin, :bmax, :n, :ehr, :ihr, :cap, 'isotonic', NULL, NULL)
                """),
                    {
                        "s": sport,
                        "bmin": float(r["bucket_min"]),
                        "bmax": float(r["bucket_max"]),
                        "n": int(r["n"]),
                        "ehr": float(r["empirical_hit_rate"]),
                        "ihr": float(r["isotonic_hit_rate"]),
                        "cap": cal.get("cap"),
                    },
                )
    log.info(f"[{sport}] published {cal['method']} calibrator.")


def write_history_snapshot(engine, sport, cal, metrics, n_corpus, window_days, gate_passed, model_version):
    """One snapshot row (plus bucket rows for isotonic) in grade_calibration_history."""
    snap = datetime.now(timezone.utc).date()
    rows = cal.get("buckets") if cal["method"] == "isotonic" else None
    with engine.begin() as conn:
        conn.execute(
            text("""DELETE FROM common.grade_calibration_history
                             WHERE snapshot_date = :d AND sport = :s"""),
            {"d": snap, "s": sport},
        )
        if rows is not None:
            iterable = rows.iterrows()
        else:
            iterable = [
                (0, {"bucket_min": -1, "bucket_max": -1, "n": 0, "empirical_hit_rate": 0.0, "isotonic_hit_rate": 0.0})
            ]
        for _, r in iterable:
            conn.execute(
                text("""
                INSERT INTO common.grade_calibration_history
                    (snapshot_date, sport, bucket_min, bucket_max, sample_size,
                     empirical_hit_rate, isotonic_hit_rate, max_well_sampled_rate,
                     window_days, model_version, method, brier, log_loss, ece,
                     n_corpus, gate_passed)
                VALUES (:d, :s, :bmin, :bmax, :n, :ehr, :ihr, :cap, :wd, :mv,
                        :m, :br, :ll, :ece, :nc, :gp)
            """),
                {
                    "d": snap,
                    "s": sport,
                    "bmin": float(r["bucket_min"]),
                    "bmax": float(r["bucket_max"]),
                    "n": int(r["n"]),
                    "ehr": float(r["empirical_hit_rate"]),
                    "ihr": float(r["isotonic_hit_rate"]),
                    "cap": cal.get("cap"),
                    "wd": int(window_days),
                    "mv": model_version,
                    "m": cal["method"],
                    "br": metrics.get("brier"),
                    "ll": metrics.get("log_loss"),
                    "ece": metrics.get("ece"),
                    "nc": int(n_corpus),
                    "gp": 1 if gate_passed else 0,
                },
            )


# ---------------------------------------------------------------------------
# Orchestration: fit, gate, publish for one sport
# ---------------------------------------------------------------------------


def calibrate_sport(engine, sport, window_days, model_version, dry_run=False):
    """Full v2 cycle for one sport. Returns a result dict for logging."""
    df = fetch_corpus(engine, sport, window_days)
    n_corpus = len(df)
    log.info(f"[{sport}] corpus: {n_corpus} resolved rows ({int((df['is_seed'] == 1).sum()) if n_corpus else 0} seed).")
    if n_corpus < MIN_CORPUS_ROWS:
        log.warning(f"[{sport}] corpus below {MIN_CORPUS_ROWS}; leaving production untouched.")
        return {"sport": sport, "skipped": True, "n_corpus": n_corpus}

    df = df.copy()
    df["grade_date"] = pd.to_datetime(df["grade_date"]).dt.date
    max_date = df["grade_date"].max()
    holdout_start = max_date - pd.Timedelta(days=HOLDOUT_DAYS - 1)
    # Seed rows are all historical; they train, never judge.
    train = df[(df["grade_date"] < holdout_start) | (df["is_seed"] == 1)]
    hold = df[(df["grade_date"] >= holdout_start) & (df["is_seed"] == 0)]
    if len(hold) < 50 or len(train) < MIN_BUCKET_SIZE * 3:
        # Not enough live holdout to judge candidates; fall back to judging by
        # 5-fold shuffled split on the whole corpus (cold-start path).
        rng = np.random.RandomState(20260711)
        idx = rng.permutation(n_corpus)
        cut = max(int(n_corpus * 0.8), n_corpus - 2000)
        train, hold = df.iloc[idx[:cut]], df.iloc[idx[cut:]]
        log.info(f"[{sport}] thin live holdout; using shuffled 80/20 split ({len(train)}/{len(hold)}).")

    p_tr, y_tr = train["raw_prob"].values, train["hit"].values
    p_ho, y_ho = hold["raw_prob"].values, hold["hit"].values

    candidates = {}
    for name, fitter in (("identity", fit_identity), ("platt", fit_platt), ("isotonic", fit_isotonic)):
        try:
            cal = fitter(p_tr, y_tr)
        except Exception as exc:
            log.warning(f"[{sport}] {name} fit failed: {exc}")
            cal = None
        if cal is not None:
            candidates[name] = cal

    scores = {name: log_loss_score(apply_calibrator(cal, p_ho), y_ho) for name, cal in candidates.items()}
    winner_name = min(scores, key=scores.get)
    winner = candidates[winner_name]

    production = load_calibrator(engine, sport)
    prod_score = log_loss_score(apply_calibrator(production, p_ho), y_ho)
    gate_passed = scores[winner_name] <= prod_score - GATE_MARGIN

    p_cal = apply_calibrator(winner if gate_passed else production, p_ho)
    metrics = {
        "brier": brier_score(p_cal, y_ho),
        "log_loss": log_loss_score(p_cal, y_ho),
        "ece": ece_score(p_cal, y_ho),
    }

    log.info(
        f"[{sport}] holdout log loss: "
        + ", ".join(f"{k}={v:.5f}" for k, v in sorted(scores.items()))
        + f"; production={prod_score:.5f}; winner={winner_name}; "
        f"gate_passed={gate_passed}"
    )

    if dry_run:
        log.info(f"[{sport}] dry run; nothing written.")
    else:
        published = winner if gate_passed else production
        if gate_passed:
            publish_calibrator(engine, sport, winner)
        write_history_snapshot(engine, sport, published, metrics, n_corpus, window_days, gate_passed, model_version)

    return {
        "sport": sport,
        "skipped": False,
        "n_corpus": n_corpus,
        "winner": winner_name,
        "gate_passed": gate_passed,
        "scores": scores,
        "production_score": prod_score,
        "metrics": metrics,
    }
