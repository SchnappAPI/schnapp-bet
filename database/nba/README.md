# database/nba/

**STATUS:** design phase. Schema design carries over from sports-modeling; bootstrap.sql lands in the code-port milestone.

## Planned tables (from sports-modeling)

- `nba.schedule` — canonical game list (all statuses).
- `nba.games` — finals only, with home/away scores and tricodes.
- `nba.teams` — static seed of 30 teams.
- `nba.players` — current-season roster.
- `nba.daily_lineups` — official lineup poll output. Keyed by player_name + team_tricode (no player_id); starter positions are full strings (PG, SG, SF, PF, C).
- `nba.player_box_score_stats` — per-player, per-period rows. Periods are `'1Q'`, `'2Q'`, `'3Q'`, `'4Q'`, `'OT'` (VARCHAR(2)). No FullGame row — sum across periods for full-game stats.
- `nba.player_passing_stats` — PT stats (passing) from `leaguedashptstats` (no proxy required).
- `nba.player_rebound_chances` — PT stats (rebounding).
- `nba.player_usage_stats` — added in grading-v2 Phase 1; per-player season usage rates that feed relevance-weighted hit rate.

## Invariants

- `nba.schedule.game_id` prefix `004` = playoffs, `002` = regular season. Filter on prefix to isolate postseason.
- TBD playoff placeholders (`status=1, game_status_text='TBD'`) get inserted with arbitrary dates; filter with `game_status_text != 'TBD' AND game_status = 3` for completed games.
- "Did this player play?" → `minutes > 0` in `player_box_score_stats` or `starter_status != 'Inactive'` in `daily_lineups`. NEVER stat-zero as a non-participation proxy.
- DNP players produce no row in `player_box_score_stats` at all.

See `.claude/rules/database.md` for the auto-loaded ruleset.
