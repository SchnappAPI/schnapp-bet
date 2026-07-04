"""
mlb_lineup_poll.py

Intraday MLB lineup + probable pitcher poller. Runs every 30 minutes during
the daily game window via mlb-lineups.yml.

Confirmed lineups post to the MLB Stats API roughly 1-4 hours before first
pitch. One schedule call with the probablePitcher and lineups hydrates covers
every game of the day:

    schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,lineups

Per run:
    1. Early-exit unless mlb.games has non-final games today.
    2. Targeted UPDATE of mlb.games probable pitcher id/name (never a
       full-row upsert - the nightly box-score MERGE owns the other columns),
       then a set-based hand fix from mlb.players.pitch_hand scoped to today.
       COALESCE semantics: a hydrate dropout never nulls a known pitcher, so
       a scratch with no announced replacement keeps the stale pitcher until
       the nightly ETL reconciles - deliberate never-null-out policy.
    3. Targeted UPDATE of mlb.games status/scores from the same payload:
       live scores land intraday and finals land the same night (winner
       flags only on finals). The 09:00 UTC nightly remains the reconciler.
    4. For each team whose lineup has posted: upsert the 9 confirmed rows
       into mlb.daily_lineups FIRST, then prune rows not in the posted nine
       (scratches, re-posts). Write-then-prune means a failed write leaves
       the previous confirmed lineup intact rather than an empty one. Games
       in Pre-Game/Warmup with no hydrate lineup fall back to the game's
       /boxscore battingOrder scan.

mlb.daily_lineups stores CONFIRMED lineups only. The web tier derives a
"projected" fallback from recent batting orders when no row exists yet, so
this table never mixes facts with heuristics.

DDL for mlb.daily_lineups is owned by this script (guarded CREATE), matching
the mlb.* convention: the loading script owns its table.

Runs exclusively in GitHub Actions on mac-runner. Credentials come from the
environment (1Password service account resolution in the workflow).
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import statsapi
from sqlalchemy import text

from shared.db import get_engine, upsert

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

BOXSCORE_TIMEOUT = 20  # seconds per fallback boxscore call
BETWEEN_GAMES_DELAY = 0.5

# Detailed states in which a posted lineup is expected to exist even if the
# lineups hydrate came back empty (fallback trigger).
PREGAME_POSTED_STATES = {"Pre-Game", "Warmup"}

DDL_CREATE = """
IF OBJECT_ID('mlb.daily_lineups', 'U') IS NULL
CREATE TABLE mlb.daily_lineups (
    game_pk       INT          NOT NULL,
    team_id       INT          NOT NULL,
    player_id     INT          NOT NULL,
    game_date     DATE         NOT NULL,
    batting_order INT          NOT NULL,
    position      VARCHAR(5)   NULL,
    is_confirmed  BIT          NOT NULL DEFAULT 1,
    source        VARCHAR(20)  NOT NULL DEFAULT 'lineups-hydrate',
    updated_at    DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_daily_lineups PRIMARY KEY (game_pk, team_id, player_id)
);
"""

DDL_INDEX = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_daily_lineups_date'
      AND object_id = OBJECT_ID('mlb.daily_lineups')
)
CREATE INDEX IX_daily_lineups_date ON mlb.daily_lineups (game_date);
"""


def ensure_table(engine):
    with engine.begin() as conn:
        conn.execute(text(DDL_CREATE))
        conn.execute(text(DDL_INDEX))


def get_todays_nonfinal_games(engine, today):
    """Return {game_pk: row_dict} for today's non-final games in mlb.games."""
    with engine.connect() as conn:
        rows = [
            dict(row._mapping)
            for row in conn.execute(
                text(
                    "SELECT game_pk, game_date, game_status, "
                    "       away_team_id, home_team_id "
                    "FROM mlb.games "
                    "WHERE game_date = :today "
                    "  AND (game_status IS NULL OR game_status <> 'F')"
                ),
                {"today": today},
            )
        ]
    return {r["game_pk"]: r for r in rows}


def fetch_hydrated_schedule(date_str, retries=3, pause=5):
    """One schedule call carrying probable pitchers + posted lineups."""
    for attempt in range(1, retries + 1):
        try:
            data = statsapi.get(
                "schedule",
                {
                    "sportId": 1,
                    "date": date_str,
                    "hydrate": "probablePitcher,lineups",
                },
            )
            games = []
            for d in data.get("dates", []):
                games.extend(d.get("games", []))
            return games
        except Exception as exc:
            log.warning("schedule hydrate failed (attempt %d/%d): %s",
                        attempt, retries, exc)
            if attempt < retries:
                time.sleep(pause)
    raise RuntimeError(f"schedule hydrate failed after {retries} attempts")


def update_probable_pitchers(engine, sched_games, db_games, today):
    """
    Targeted UPDATE of probable pitcher id/name on mlb.games, then a
    set-based hand fix from mlb.players scoped to today. Never a full-row
    upsert: score/status columns are update_game_scores's job, everything
    else belongs to the nightly MERGE.
    """
    updates = []
    for g in sched_games:
        game_pk = g.get("gamePk")
        if game_pk not in db_games:
            continue
        teams = g.get("teams", {})
        away = teams.get("away", {}).get("probablePitcher") or {}
        home = teams.get("home", {}).get("probablePitcher") or {}
        if not away and not home:
            continue
        updates.append({
            "game_pk": game_pk,
            "away_id": away.get("id"),
            "away_name": away.get("fullName"),
            "home_id": home.get("id"),
            "home_name": home.get("fullName"),
        })

    if not updates:
        log.info("No probable pitchers to update.")
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE mlb.games SET "
                "  away_pitcher_id   = COALESCE(:away_id, away_pitcher_id), "
                "  away_pitcher_name = COALESCE(:away_name, away_pitcher_name), "
                "  home_pitcher_id   = COALESCE(:home_id, home_pitcher_id), "
                "  home_pitcher_name = COALESCE(:home_name, home_pitcher_name) "
                "WHERE game_pk = :game_pk"
            ),
            updates,
        )
        conn.execute(
            text(
                "UPDATE g SET away_pitcher_hand = p.pitch_hand "
                "FROM mlb.games g "
                "JOIN mlb.players p ON p.player_id = g.away_pitcher_id "
                "WHERE g.game_date = :today "
                "  AND p.pitch_hand IS NOT NULL "
                "  AND (g.away_pitcher_hand IS NULL "
                "       OR g.away_pitcher_hand <> p.pitch_hand); "
                "UPDATE g SET home_pitcher_hand = p.pitch_hand "
                "FROM mlb.games g "
                "JOIN mlb.players p ON p.player_id = g.home_pitcher_id "
                "WHERE g.game_date = :today "
                "  AND p.pitch_hand IS NOT NULL "
                "  AND (g.home_pitcher_hand IS NULL "
                "       OR g.home_pitcher_hand <> p.pitch_hand);"
            ),
            {"today": today},
        )
    log.info("Probable pitchers updated for %d game(s).", len(updates))


def update_game_scores(engine, sched_games, db_games):
    """
    Targeted UPDATE of game_status / scores on mlb.games from the same
    hydrated schedule payload, so in-progress scores land intraday and
    finals land the same night instead of at the 09:00 UTC nightly.
    db_games only ever contains non-final rows, so a game is touched
    until the tick that flips it to 'F' and never again; the
    belt-and-suspenders WHERE also refuses to downgrade an 'F'.

    Postponed/Cancelled/Suspended games carry abstractGameState "Final"
    in the API but are NOT finals: they keep their detailedState so the
    makeup-date reload can still reach them. Winner flags are written
    only on true finals, and only when the payload asserts isWinner —
    an absent flag stays NULL for the nightly reconciler (a written 0
    is a fact COALESCE can never repair). abstract_game_state is left
    alone entirely: the nightly owns that column.
    """
    updates = []
    for g in sched_games:
        game_pk = g.get("gamePk")
        if game_pk not in db_games:
            continue
        status = g.get("status") or {}
        abstract = status.get("abstractGameState")
        detailed = status.get("detailedState") or ""
        if not detailed and not abstract:
            continue
        not_played = detailed.startswith(("Postponed", "Cancelled", "Suspended"))
        is_final = not not_played and (
            abstract == "Final" or detailed in ("Final", "Game Over")
        )
        teams = g.get("teams", {})
        away = teams.get("away", {})
        home = teams.get("home", {})

        def winner_flag(side):
            if not is_final or side.get("isWinner") is None:
                return None
            return 1 if side["isWinner"] else 0

        updates.append({
            "game_pk": game_pk,
            "game_status": "F" if is_final else (detailed or None),
            "away_score": away.get("score"),
            "home_score": home.get("score"),
            "away_is_winner": winner_flag(away),
            "home_is_winner": winner_flag(home),
        })

    if not updates:
        log.info("No game status updates.")
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE mlb.games SET "
                "  game_status         = COALESCE(:game_status, game_status), "
                "  away_team_score     = COALESCE(:away_score, away_team_score), "
                "  home_team_score     = COALESCE(:home_score, home_team_score), "
                "  away_is_winner      = COALESCE(:away_is_winner, away_is_winner), "
                "  home_is_winner      = COALESCE(:home_is_winner, home_is_winner) "
                "WHERE game_pk = :game_pk "
                "  AND (game_status IS NULL OR game_status <> 'F' OR :game_status = 'F')"
            ),
            updates,
        )
    finals = sum(1 for u in updates if u["game_status"] == "F")
    log.info("Status/scores updated for %d game(s); %d now final.",
             len(updates), finals)


def rows_from_hydrate(game, db_row, today):
    """
    Build lineup rows from the schedule lineups hydrate for one game.
    Returns {team_id: [row, ...]} containing only teams with a full 9 posted.
    """
    lineups = game.get("lineups") or {}
    # Naive UTC: tz-aware datetimes route through pyodbc as datetimeoffset,
    # a known fast_executemany failure mode against DATETIME2.
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    out = {}
    for key, team_id in (
        ("awayPlayers", db_row["away_team_id"]),
        ("homePlayers", db_row["home_team_id"]),
    ):
        players = lineups.get(key) or []
        if len(players) < 9:
            continue
        if len(players) > 9:
            log.warning("  game_pk %s %s: hydrate returned %d players; using first 9",
                        db_row["game_pk"], key, len(players))
        rows = []
        for order, p in enumerate(players[:9], start=1):
            pid = p.get("id")
            if pid is None:
                continue
            rows.append({
                "game_pk": db_row["game_pk"],
                "team_id": team_id,
                "player_id": pid,
                "game_date": today,
                "batting_order": order,
                "position": (p.get("primaryPosition") or {}).get("abbreviation"),
                "is_confirmed": 1,
                "source": "lineups-hydrate",
                "updated_at": now_utc,
            })
        if len(rows) == 9:
            out[team_id] = rows
    return out


def rows_from_boxscore(game_pk, db_row, today):
    """
    Fallback: scan the game's /boxscore for battingOrder 100..900. Only
    posted lineups carry battingOrder pregame, so an empty scan means the
    lineup simply is not out yet.
    """
    url = f"https://statsapi.mlb.com/api/v1/game/{game_pk}/boxscore"
    try:
        resp = requests.get(url, timeout=BOXSCORE_TIMEOUT)
        resp.raise_for_status()
        box = resp.json()
    except Exception as exc:
        log.warning("  boxscore fallback failed for game_pk %s: %s", game_pk, exc)
        return {}

    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    out = {}
    for side, team_id in (
        ("away", db_row["away_team_id"]),
        ("home", db_row["home_team_id"]),
    ):
        players = (box.get("teams", {}).get(side, {}).get("players") or {})
        rows = []
        for p in players.values():
            order_raw = str(p.get("battingOrder", "")).strip()
            if not order_raw.isdigit():
                continue
            order = int(order_raw)
            if order % 100 != 0 or not 100 <= order <= 900:
                continue  # substitutes carry 101/201/...; starters are hundreds
            pid = (p.get("person") or {}).get("id")
            if pid is None:
                continue
            rows.append({
                "game_pk": game_pk,
                "team_id": team_id,
                "player_id": pid,
                "game_date": today,
                "batting_order": order // 100,
                "position": (p.get("position") or {}).get("abbreviation"),
                "is_confirmed": 1,
                "source": "boxscore",
                "updated_at": now_utc,
            })
        if len(rows) == 9:
            out[team_id] = rows
    return out


def write_lineups(engine, lineup_rows_by_game_team):
    """
    Upsert the confirmed nine per posted team, THEN prune rows not in the
    posted set (scratches, re-posts). Write-first ordering means a failed or
    quarantined write leaves the previously stored lineup intact instead of
    deleting it and leaving the game bare until the next poll.
    """
    all_rows = [r for rows in lineup_rows_by_game_team.values() for r in rows]
    df = pd.DataFrame(all_rows)
    upsert(engine, df, "mlb", "daily_lineups",
           ["game_pk", "team_id", "player_id"],
           source_workflow="mlb-lineups")

    with engine.begin() as conn:
        for (game_pk, team_id), rows in lineup_rows_by_game_team.items():
            # player_ids come from the API as ints; the IN list is numeric.
            ids = ", ".join(str(int(r["player_id"])) for r in rows)
            conn.execute(
                text(
                    "DELETE FROM mlb.daily_lineups "
                    f"WHERE game_pk = :game_pk AND team_id = :team_id "
                    f"AND player_id NOT IN ({ids})"
                ),
                {"game_pk": game_pk, "team_id": team_id},
            )

    log.info("Wrote %d lineup row(s) across %d team lineup(s).",
             len(all_rows), len(lineup_rows_by_game_team))


def main():
    # Game-day convention: the baseball day rolls at 06:00 Central, so the
    # post-midnight ticks (west-coast finals) still poll yesterday's slate
    # instead of early-exiting on an empty new date. Anchored to
    # America/Chicago explicitly so a runner TZ change cannot move the roll.
    central_now = datetime.now(ZoneInfo("America/Chicago"))
    today = (central_now - timedelta(hours=6)).date().isoformat()
    log.info("=== MLB lineup poll started for %s ===", today)

    engine = get_engine()
    ensure_table(engine)

    db_games = get_todays_nonfinal_games(engine, today)
    if not db_games:
        log.info("No non-final MLB games today. Nothing to do.")
        return

    sched_games = fetch_hydrated_schedule(today)
    sched_by_pk = {g.get("gamePk"): g for g in sched_games}
    log.info("%d game(s) in DB, %d in schedule response.",
             len(db_games), len(sched_games))

    update_probable_pitchers(engine, sched_games, db_games, today)
    update_game_scores(engine, sched_games, db_games)

    lineups = {}
    fallback_pks = []
    for game_pk, db_row in db_games.items():
        game = sched_by_pk.get(game_pk)
        if game is None:
            continue
        posted = rows_from_hydrate(game, db_row, today)
        for team_id, rows in posted.items():
            lineups[(game_pk, team_id)] = rows
        detailed = (game.get("status") or {}).get("detailedState", "")
        missing_sides = 2 - len(posted)
        if missing_sides and detailed in PREGAME_POSTED_STATES:
            fallback_pks.append(game_pk)

    for i, game_pk in enumerate(fallback_pks):
        if i > 0:
            time.sleep(BETWEEN_GAMES_DELAY)
        posted = rows_from_boxscore(game_pk, db_games[game_pk], today)
        for team_id, rows in posted.items():
            lineups.setdefault((game_pk, team_id), rows)

    if not lineups:
        log.info("No lineups posted yet.")
        return

    write_lineups(engine, lineups)
    log.info("=== MLB lineup poll complete ===")


if __name__ == "__main__":
    main()
