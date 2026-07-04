"""One-shot Phase 4.5 verification (PR #11) — delete with phase45-verify.yml.

Read-only. Mirrors the SQL in web/app/api/mlb/research/leaders/route.ts so
the endpoint's queries are exercised against the live DB before the web
build ships them.
"""

from sqlalchemy import text

from shared.db import get_engine

# Must match WHIFF_CALL_CODES in web/app/api/mlb/research/leaders/route.ts.
WHIFF_CALL_CODES = "'S','W','M','Q'"

AT_BAT_RAIL = """
    SELECT TOP 5
        ab.batter_id, p.player_name, t.team_abbreviation, ab.game_pk,
        ab.result_event_type, ab.hit_launch_speed, ab.hit_launch_angle,
        ab.hit_total_distance, ab.hit_bat_speed, ab.home_run_ballparks
    FROM mlb.player_at_bats ab
    LEFT JOIN mlb.players p ON p.player_id = ab.batter_id
    LEFT JOIN mlb.teams t
        ON t.team_id = CASE WHEN ab.is_top_inning = 1
                            THEN ab.away_team_id ELSE ab.home_team_id END
    WHERE ab.game_date = :d AND {tail}
"""

PITCHER_RAIL = f"""
    SELECT TOP 5
        x.pitcher_id, p.player_name, t.team_abbreviation, x.game_pk,
        x.maxVelo, x.whiffs, x.pitches
    FROM (
        SELECT pbp.pitcher_id, pbp.game_pk,
               MIN(CASE WHEN pbp.is_top_inning = 1
                        THEN pbp.home_team_id ELSE pbp.away_team_id END) AS team_id,
               MAX(pbp.pitch_start_speed) AS maxVelo,
               SUM(CASE WHEN pbp.pitch_call_code IN ({WHIFF_CALL_CODES})
                        THEN 1 ELSE 0 END) AS whiffs,
               COUNT(*) AS pitches
        FROM mlb.play_by_play pbp
        WHERE pbp.game_date = :d AND pbp.is_pitch = 1
          AND pbp.pitcher_id IS NOT NULL
        GROUP BY pbp.pitcher_id, pbp.game_pk
    ) x
    LEFT JOIN mlb.players p ON p.player_id = x.pitcher_id
    LEFT JOIN mlb.teams t ON t.team_id = x.team_id
    ORDER BY {{order}}
"""


def dump(title, rows):
    print(f"\n=== {title} ===")
    if not rows:
        print("  (no rows)")
    for r in rows:
        print("  " + " | ".join(str(v) for v in r))


def main():
    engine = get_engine()
    with engine.connect() as conn:
        print("=== pitch_call_code frequencies (is_pitch = 1) ===")
        print("expect swing-and-miss descriptions on exactly: S, W, M, Q")
        for code, desc, n in conn.execute(
            text("""
                SELECT pitch_call_code, MIN(play_event_description), COUNT(*)
                FROM mlb.play_by_play
                WHERE is_pitch = 1
                GROUP BY pitch_call_code
                ORDER BY COUNT(*) DESC
            """)
        ):
            print(f"  {str(code):>4}  {n:>9}  {desc}")

        resolved = conn.execute(
            text("SELECT CONVERT(VARCHAR(10), MAX(game_date), 120) FROM mlb.player_at_bats")
        ).scalar()
        print(f"\n=== resolvedDate (latest loaded at-bats day) === {resolved}")

        d = {"d": resolved}
        dump(
            "top EV",
            conn.execute(
                text(AT_BAT_RAIL.format(tail="ab.hit_launch_speed IS NOT NULL") + " ORDER BY ab.hit_launch_speed DESC"),
                d,
            ).fetchall(),
        )
        dump(
            "HR/park near-miss (>=1 park, not a HR)",
            conn.execute(
                text(
                    AT_BAT_RAIL.format(tail="ab.home_run_ballparks >= 1 AND ab.result_event_type <> 'home_run'")
                    + " ORDER BY ab.home_run_ballparks DESC, "
                    "ab.hit_launch_speed DESC"
                ),
                d,
            ).fetchall(),
        )
        dump(
            "top bat speed",
            conn.execute(
                text(AT_BAT_RAIL.format(tail="ab.hit_bat_speed IS NOT NULL") + " ORDER BY ab.hit_bat_speed DESC"),
                d,
            ).fetchall(),
        )
        dump(
            "top pitch velo",
            conn.execute(text(PITCHER_RAIL.format(order="x.maxVelo DESC")), d).fetchall(),
        )
        dump(
            "most whiffs",
            conn.execute(text(PITCHER_RAIL.format(order="x.whiffs DESC")), d).fetchall(),
        )


if __name__ == "__main__":
    main()
