"""
generate_supplemental.py

Generates the "Supplemental" game tab payload for every NBA game scheduled today.
Runs after intraday grading as part of the refresh-data workflow.

For each game:
1. Pulls graded prop targets from common.daily_grades
2. Pulls recent regular-season roster averages for both teams
3. Pulls all graded players' full grade detail for context
4. Calls Claude (claude-sonnet-4-6) with structured data to derive:
   - Game scenarios (3 most likely outcomes with probabilities)
   - Correlated prop pairs (top 3 ranked by joint certainty)
   - Breakout candidates (bench/role players with upside)
5. Merges AI narrative with structured DB data into a single payload

Output table: common.game_supplemental (game_date, game_id, payload JSON)

Payload shape:
{
  "scenarios": [
    {"label": str, "probability": int, "description": str, "propsAffected": [str]}
  ],
  "correlatedPairs": [
    {
      "rank": int,
      "label": str,
      "jointProbability": int,
      "reasoning": str,
      "legs": [
        {"playerName": str, "marketLabel": str, "line": float, "price": int,
         "hitRatePct": float, "direction": str}
      ]
    }
  ],
  "breakoutCandidates": [
    {
      "playerName": str, "teamTricode": str, "reasoning": str,
      "targetMarket": str, "targetLine": float, "targetPrice": int
    }
  ],
  "propTargets": [
    {
      "playerName": str, "teamTricode": str, "marketLabel": str,
      "outcomeName": str, "line": float, "price": int,
      "hitRatePct": float, "oppHitRatePct": float,
      "sampleSize": int, "compositeGrade": float
    }
  ],
  "rosterAnalysis": {
    "away": {"tricode": str, "players": [...]},
    "home": {"tricode": str, "players": [...]}
  }
}
"""

import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta

import anthropic
import pandas as pd
from sqlalchemy import create_engine, text

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STANDARD_MARKETS = {
    "player_points", "player_rebounds", "player_assists", "player_threes",
    "player_blocks", "player_steals",
    "player_points_rebounds_assists", "player_points_rebounds",
    "player_points_assists", "player_rebounds_assists",
}

MARKET_LABELS = {
    "player_points":                  "PTS",
    "player_rebounds":                "REB",
    "player_assists":                 "AST",
    "player_threes":                  "3PM",
    "player_blocks":                  "BLK",
    "player_steals":                  "STL",
    "player_points_rebounds_assists": "PRA",
    "player_points_rebounds":         "PR",
    "player_points_assists":          "PA",
    "player_rebounds_assists":        "RA",
}

MIN_SAMPLE           = 15
MIN_HIT_RATE         = 0.60
MIN_PRICE            = -300
MAX_PRICE            = 300
ROSTER_LOOKBACK      = 60
ROSTER_MIN_MIN       = 10
ROSTER_MIN_GAMES     = 5
STARTER_MIN_THRESHOLD = 28.0

CLAUDE_MODEL = "claude-sonnet-4-6"

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def today_et() -> str:
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d")


def get_engine(max_retries=3, retry_wait=30):
    conn_str = (
        f"mssql+pyodbc://{os.environ['SQL_USERNAME']}:"
        f"{os.environ['SQL_PASSWORD']}@"
        f"{os.environ['SQL_SERVER']}/"
        f"{os.environ['SQL_DATABASE']}"
        "?driver=ODBC+Driver+18+for+SQL+Server"
        f"&Encrypt=yes&TrustServerCertificate={os.environ.get('SQL_TRUST_CERT', 'no')}"
        "&Connection+Timeout=90"
    )
    engine = create_engine(conn_str, fast_executemany=False)
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            log.info("Database connection established.")
            return engine
        except Exception as exc:
            log.warning(f"DB connection attempt {attempt}/{max_retries} failed: {exc}")
            if attempt < max_retries:
                time.sleep(retry_wait)
    raise RuntimeError("Could not connect to database after retries.")


def ensure_table(engine):
    with engine.begin() as conn:
        conn.execute(text("""
IF NOT EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA='common' AND TABLE_NAME='game_supplemental'
)
CREATE TABLE common.game_supplemental(
    supplemental_id  INT IDENTITY(1,1) NOT NULL,
    game_date        DATE          NOT NULL,
    game_id          VARCHAR(15)   NOT NULL,
    generated_at     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    payload          NVARCHAR(MAX) NOT NULL,
    CONSTRAINT pk_game_supplemental PRIMARY KEY (supplemental_id),
    CONSTRAINT uq_game_supplemental UNIQUE (game_date, game_id)
)
"""))
    log.info("common.game_supplemental verified.")


def fetch_todays_games(engine, grade_date: str) -> pd.DataFrame:
    return pd.read_sql(text("""
        SELECT s.game_id, s.home_team_tricode, s.away_team_tricode
        FROM nba.schedule s
        WHERE CAST(s.game_date AS DATE) = :gd
          AND s.game_status IN (1, 2)
    """), engine, params={"gd": grade_date})


def fetch_all_grades(engine, grade_date: str, game_id: str) -> pd.DataFrame:
    """All graded Over rows for this game regardless of filters — used for Claude context."""
    mkt_list = ", ".join(f"'{m}'" for m in STANDARD_MARKETS)
    return pd.read_sql(text(f"""
        SELECT
            dg.player_name,
            dg.market_key,
            dg.line_value,
            dg.over_price,
            dg.weighted_hit_rate,
            dg.hit_rate_opp,
            dg.sample_size_60,
            dg.composite_grade,
            dg.trend_grade,
            dg.momentum_grade,
            dg.pattern_grade,
            dg.matchup_grade,
            CASE
                WHEN p.team_id = s.home_team_id THEN s.home_team_tricode
                ELSE s.away_team_tricode
            END AS team_tricode
        FROM common.daily_grades dg
        JOIN odds.event_game_map egm ON egm.event_id = dg.event_id
        JOIN nba.schedule s         ON s.game_id = egm.game_id
        LEFT JOIN nba.players p     ON p.player_id = dg.player_id
        WHERE egm.game_id     = :gid
          AND dg.grade_date   = :gd
          AND dg.outcome_name = 'Over'
          AND dg.market_key   IN ({mkt_list})
          AND dg.sample_size_60 >= 10
        ORDER BY dg.composite_grade DESC
    """), engine, params={"gid": game_id, "gd": grade_date})


def fetch_prop_targets(engine, grade_date: str, game_id: str) -> list:
    """Filtered prop targets for the structured display table."""
    mkt_list = ", ".join(f"'{m}'" for m in STANDARD_MARKETS)
    df = pd.read_sql(text(f"""
        SELECT
            dg.player_name,
            dg.market_key,
            dg.line_value,
            dg.over_price,
            dg.weighted_hit_rate,
            dg.hit_rate_opp,
            dg.sample_size_60,
            dg.composite_grade,
            CASE
                WHEN p.team_id = s.home_team_id THEN s.home_team_tricode
                ELSE s.away_team_tricode
            END AS team_tricode
        FROM common.daily_grades dg
        JOIN odds.event_game_map egm ON egm.event_id = dg.event_id
        JOIN nba.schedule s         ON s.game_id = egm.game_id
        LEFT JOIN nba.players p     ON p.player_id = dg.player_id
        WHERE egm.game_id          = :gid
          AND dg.grade_date        = :gd
          AND dg.outcome_name      = 'Over'
          AND dg.sample_size_60    >= :min_sample
          AND dg.weighted_hit_rate >= :min_hr
          AND dg.over_price        BETWEEN :min_price AND :max_price
          AND dg.market_key        IN ({mkt_list})
        ORDER BY dg.composite_grade DESC, dg.weighted_hit_rate DESC
    """), engine, params={
        "gid": game_id, "gd": grade_date,
        "min_sample": MIN_SAMPLE, "min_hr": MIN_HIT_RATE,
        "min_price": MIN_PRICE, "max_price": MAX_PRICE,
    })

    rows = []
    for _, r in df.iterrows():
        rows.append({
            "playerName":     r["player_name"],
            "teamTricode":    r["team_tricode"] or "",
            "marketKey":      r["market_key"],
            "marketLabel":    MARKET_LABELS.get(r["market_key"], r["market_key"]),
            "outcomeName":    "Over",
            "line":           float(r["line_value"]),
            "price":          int(r["over_price"]) if pd.notna(r["over_price"]) else None,
            "hitRatePct":     round(float(r["weighted_hit_rate"]) * 100, 1) if pd.notna(r["weighted_hit_rate"]) else None,
            "oppHitRatePct":  round(float(r["hit_rate_opp"]) * 100, 1) if pd.notna(r["hit_rate_opp"]) else None,
            "sampleSize":     int(r["sample_size_60"]) if pd.notna(r["sample_size_60"]) else 0,
            "compositeGrade": round(float(r["composite_grade"]), 1) if pd.notna(r["composite_grade"]) else None,
        })
    return rows


def fetch_roster_analysis(engine, grade_date: str, home_tricode: str, away_tricode: str) -> dict:
    df = pd.read_sql(text("""
        WITH game_totals AS (
            SELECT
                bs.player_id,
                bs.player_name,
                bs.team_tricode,
                bs.game_id,
                SUM(CAST(bs.minutes AS FLOAT)) AS min_played,
                SUM(bs.pts)   AS pts,
                SUM(bs.reb)   AS reb,
                SUM(bs.ast)   AS ast,
                SUM(bs.fg3m)  AS fg3m,
                SUM(bs.stl)   AS stl,
                SUM(bs.blk)   AS blk
            FROM nba.player_box_score_stats bs
            JOIN nba.games g ON g.game_id = bs.game_id
            WHERE bs.team_tricode IN (:home, :away)
              AND g.season_type  = 'Regular Season'
              AND g.game_date    >= DATEADD(day, -:lookback, CAST(:gd AS DATE))
              AND g.game_date    <  CAST(:gd AS DATE)
            GROUP BY bs.player_id, bs.player_name, bs.team_tricode, bs.game_id
            HAVING SUM(CAST(bs.minutes AS FLOAT)) >= :min_min
        )
        SELECT
            player_id,
            player_name,
            team_tricode,
            COUNT(*)         AS games,
            AVG(min_played)  AS avg_min,
            AVG(CAST(pts  AS FLOAT)) AS avg_pts,
            AVG(CAST(reb  AS FLOAT)) AS avg_reb,
            AVG(CAST(ast  AS FLOAT)) AS avg_ast,
            AVG(CAST(fg3m AS FLOAT)) AS avg_3pm,
            AVG(CAST(stl  AS FLOAT)) AS avg_stl,
            AVG(CAST(blk  AS FLOAT)) AS avg_blk
        FROM game_totals
        GROUP BY player_id, player_name, team_tricode
        HAVING COUNT(*) >= :min_games
        ORDER BY team_tricode, AVG(min_played) DESC
    """), engine, params={
        "home": home_tricode, "away": away_tricode,
        "lookback": ROSTER_LOOKBACK, "gd": grade_date,
        "min_min": ROSTER_MIN_MIN, "min_games": ROSTER_MIN_GAMES,
    })

    result = {
        "away": {"tricode": away_tricode, "players": []},
        "home": {"tricode": home_tricode, "players": []},
    }
    for _, r in df.iterrows():
        side = "home" if r["team_tricode"] == home_tricode else "away"
        avg_min = float(r["avg_min"]) if pd.notna(r["avg_min"]) else 0.0
        result[side]["players"].append({
            "playerName": r["player_name"],
            "avgMin":     round(avg_min, 1),
            "avgPts":     round(float(r["avg_pts"]), 1) if pd.notna(r["avg_pts"]) else 0.0,
            "avgReb":     round(float(r["avg_reb"]), 1) if pd.notna(r["avg_reb"]) else 0.0,
            "avgAst":     round(float(r["avg_ast"]), 1) if pd.notna(r["avg_ast"]) else 0.0,
            "avg3pm":     round(float(r["avg_3pm"]), 1) if pd.notna(r["avg_3pm"]) else 0.0,
            "avgStl":     round(float(r["avg_stl"]), 1) if pd.notna(r["avg_stl"]) else 0.0,
            "avgBlk":     round(float(r["avg_blk"]), 1) if pd.notna(r["avg_blk"]) else 0.0,
            "games":      int(r["games"]),
            "isStarter":  avg_min >= STARTER_MIN_THRESHOLD,
        })
    return result


# ---------------------------------------------------------------------------
# Claude prompt construction and parsing
# ---------------------------------------------------------------------------

def build_prompt(
    away_tricode: str,
    home_tricode: str,
    grades_df: pd.DataFrame,
    roster: dict,
    prop_targets: list,
) -> str:
    """Build the structured prompt for Claude."""

    # Grades summary — top 30 rows by composite grade
    grades_lines = []
    for _, r in grades_df.head(30).iterrows():
        hr  = round(float(r["weighted_hit_rate"]) * 100, 1) if pd.notna(r["weighted_hit_rate"]) else None
        ohr = round(float(r["hit_rate_opp"]) * 100, 1) if pd.notna(r["hit_rate_opp"]) else None
        cg  = round(float(r["composite_grade"]), 1) if pd.notna(r["composite_grade"]) else None
        mkt = MARKET_LABELS.get(r["market_key"], r["market_key"])
        price = int(r["over_price"]) if pd.notna(r["over_price"]) else None
        price_str = (f"+{price}" if price and price > 0 else str(price)) if price else "n/a"
        grades_lines.append(
            f"  {r['player_name']} ({r['team_tricode']}) | {mkt} {r['line_value']} {price_str} | "
            f"hit%={hr} opp%={ohr} n={int(r['sample_size_60']) if pd.notna(r['sample_size_60']) else 0} "
            f"composite={cg}"
        )
    grades_block = "\n".join(grades_lines) if grades_lines else "  (no graded props)"

    # Roster summaries
    def roster_block(side: str) -> str:
        players = roster[side]["players"]
        lines = []
        for p in players[:12]:
            role = "starter" if p["isStarter"] else "bench"
            lines.append(
                f"  {p['playerName']} ({role}) | {p['avgMin']}min {p['avgPts']}pts "
                f"{p['avgReb']}reb {p['avgAst']}ast {p['avg3pm']}3pm | {p['games']}g"
            )
        return "\n".join(lines) if lines else "  (no data)"

    away_roster = roster_block("away")
    home_roster = roster_block("home")

    # Prop targets for context
    targets_lines = []
    for t in prop_targets[:15]:
        price = t["price"]
        price_str = (f"+{price}" if price and price > 0 else str(price)) if price else "n/a"
        targets_lines.append(
            f"  {t['playerName']} ({t['teamTricode']}) | {t['marketLabel']} {t['line']} {price_str} | "
            f"hit%={t['hitRatePct']} opp%={t['oppHitRatePct']} grade={t['compositeGrade']}"
        )
    targets_block = "\n".join(targets_lines) if targets_lines else "  (no targets)"

    return f"""You are an NBA prop betting analyst. Analyze this game and produce a structured JSON response.

GAME: {away_tricode} @ {home_tricode} (away @ home)

GRADED PROPS (top 30 by composite grade, regular season data):
{grades_block}

FILTERED PROP TARGETS (hit% >= 60%, price -300 to +300, n >= 15):
{targets_block}

AWAY ROSTER ({away_tricode}) — last 60 days regular season averages:
{away_roster}

HOME ROSTER ({home_tricode}) — last 60 days regular season averages:
{home_roster}

Produce a JSON object with exactly these four keys:

1. "scenarios": array of exactly 3 objects, each with:
   - "label": short title (e.g. "Home team blowout")
   - "probability": integer 0-100 (three must sum to 100)
   - "description": 2-3 sentence game script
   - "propsAffected": array of player name strings whose props are most impacted by this scenario

2. "correlatedPairs": array of exactly 3 objects ranked by joint certainty, each with:
   - "rank": 1, 2, or 3
   - "label": short descriptive label
   - "jointProbability": integer 0-100 (estimated joint hit probability)
   - "reasoning": 2-3 sentences explaining why these legs correlate and why they hold across scenarios
   - "legs": array of exactly 2 objects, each with:
     - "playerName": string
     - "marketLabel": string (use the label from the graded props, e.g. "PTS", "REB", "PRA")
     - "line": number
     - "price": integer (American odds)
     - "hitRatePct": number
     - "direction": "Over" or "Under"

3. "breakoutCandidates": array of 2-4 objects for bench or role players with single-game eruption potential, each with:
   - "playerName": string
   - "teamTricode": string
   - "reasoning": 2-3 sentences explaining the role expansion path and ceiling
   - "targetMarket": string (e.g. "PTS", "3PM")
   - "targetLine": number
   - "targetPrice": integer (American odds, use null if unknown)

4. "avoidList": array of 2-4 objects for props that look appealing but have structural weaknesses, each with:
   - "playerName": string
   - "marketLabel": string
   - "line": number
   - "reasoning": 1-2 sentences explaining why to avoid

Use only players from the graded props and roster data above. Base all reasoning on the actual hit rates, grades, and minutes provided. Do not invent statistics. Respond with valid JSON only — no markdown, no explanation outside the JSON."""


def call_claude(prompt: str) -> dict:
    """Call Claude and parse the JSON response."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()

    return json.loads(raw)


def generate_narrative(
    away_tricode: str,
    home_tricode: str,
    grades_df: pd.DataFrame,
    roster: dict,
    prop_targets: list,
) -> dict:
    """Call Claude and return the narrative sections. Falls back to empty structure on error."""
    empty = {
        "scenarios":          [],
        "correlatedPairs":    [],
        "breakoutCandidates": [],
        "avoidList":          [],
    }
    try:
        prompt = build_prompt(away_tricode, home_tricode, grades_df, roster, prop_targets)
        result = call_claude(prompt)
        log.info(
            f"  Claude returned {len(result.get('scenarios', []))} scenarios, "
            f"{len(result.get('correlatedPairs', []))} pairs, "
            f"{len(result.get('breakoutCandidates', []))} breakouts."
        )
        return result
    except Exception as exc:
        log.warning(f"  Claude call failed: {exc}. Using empty narrative.")
        return empty


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def upsert_supplemental(engine, game_date: str, game_id: str, payload: dict):
    payload_json = json.dumps(payload, ensure_ascii=False)
    with engine.begin() as conn:
        conn.execute(text("""
MERGE common.game_supplemental AS t
USING (SELECT :gd AS game_date, :gid AS game_id) AS s
ON (t.game_date = s.game_date AND t.game_id = s.game_id)
WHEN MATCHED THEN
    UPDATE SET t.payload = :payload, t.generated_at = GETUTCDATE()
WHEN NOT MATCHED THEN
    INSERT (game_date, game_id, payload)
    VALUES (:gd, :gid, :payload);
"""), {"gd": game_date, "gid": game_id, "payload": payload_json})
    log.info(
        f"  Upserted supplemental for {game_id} "
        f"({len(payload['propTargets'])} prop targets, "
        f"{len(payload.get('scenarios', []))} scenarios)."
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    engine = get_engine()
    ensure_table(engine)

    grade_date = today_et()
    log.info(f"Generating supplemental data for {grade_date}")

    games = fetch_todays_games(engine, grade_date)
    if games.empty:
        log.info("No games scheduled today. Nothing to do.")
        return

    log.info(f"Found {len(games)} game(s): {list(games['game_id'])}")

    for _, game in games.iterrows():
        game_id       = game["game_id"]
        home_tricode  = game["home_team_tricode"]
        away_tricode  = game["away_team_tricode"]

        log.info(f"Processing {away_tricode} @ {home_tricode} ({game_id})")

        grades_df    = fetch_all_grades(engine, grade_date, game_id)
        prop_targets = fetch_prop_targets(engine, grade_date, game_id)
        roster       = fetch_roster_analysis(engine, grade_date, home_tricode, away_tricode)

        narrative = generate_narrative(away_tricode, home_tricode, grades_df, roster, prop_targets)

        payload = {
            "scenarios":          narrative.get("scenarios", []),
            "correlatedPairs":    narrative.get("correlatedPairs", []),
            "breakoutCandidates": narrative.get("breakoutCandidates", []),
            "avoidList":          narrative.get("avoidList", []),
            "propTargets":        prop_targets,
            "rosterAnalysis":     roster,
        }

        upsert_supplemental(engine, grade_date, game_id, payload)

    log.info("Done.")


if __name__ == "__main__":
    main()
