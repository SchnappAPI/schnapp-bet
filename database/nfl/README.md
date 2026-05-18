# database/nfl/

**STATUS:** idle. Schema exists in sports-modeling; no active development, no downstream product consumer. Ports to schnapp-bet only when NFL web work resumes.

## Planned tables (from sports-modeling)

7 tables loaded via `nflreadpy`:

- `nfl.games`, `nfl.players`
- `nfl.player_game_stats`, `nfl.snap_counts`, `nfl.ftn_charting`
- `nfl.rosters_weekly`
- `nfl.team_game_stats`

## Invariants

- Schema-from-data (per ADR-0014 in sports-modeling): pandas infers types on first run; subsequent runs use `add_missing_columns()` for ADD COLUMN. Drops/renames require manual intervention.
- Fail-soft per table: ETL catches exceptions, logs, continues. Script exits 1 if any table failed but still attempts all others.

See `.claude/rules/database.md` for the auto-loaded ruleset.
