# ADR-20260420-2: All MLB visual stats pre-aggregated, none computed at query time

Date: 2026-04-20

Legacy ID: ADR-0004.

## Context

The legacy Power BI file used DAX measures to aggregate Statcast pitch-level data into per-player, per-game, per-at-bat, and rolling-window views at display time. Power BI can do this because it loads the entire fact table into memory and computes against it interactively. A web app cannot afford runtime aggregation of pitch-level data on every page load: latency would be unacceptable and the database would be hammered.

## Decision

The MLB ETL pre-aggregates all visual-feeding entities and stores them in dedicated tables. The pitch-level Statcast data remains an ETL-internal source and is not queried by the web app. The 9 entities identified during the visual catalog: upcoming games, batter context per game, batter projections per game, player game stats, player at-bat stats, player trend/pattern stats, player platoon splits, career batter vs pitcher matchup, and pitcher season stats. Defined in detail in `database/mlb/README.md` when the schema lands.

## Consequences

- ETL becomes more complex: it must produce 9 derived tables on a recurring schedule, with rolling windows recomputed whenever new game data lands.
- Web pages stay fast because every visual reads from a purpose-built table with the data already shaped.
- Adding a new visual stat requires an ETL change to add a column or table, not just a query change.
- The legacy Power Query M code that performed equivalent transformations in PBI is preserved for reference but not for direct reimplementation; Python ETL targets the same final state but is structured differently.
