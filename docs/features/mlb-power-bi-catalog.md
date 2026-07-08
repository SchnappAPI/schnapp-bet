# MLB Power BI Source Catalog (`mlbSavantV3`)

Reverse-engineering record of the retired Power BI report `mlbSavantV3` (and its desktop
siblings) — the batter prop-research surface the in-app **MLB Research Dashboard** was
ported from. This consolidates the three catalog documents produced 2026-07 (data
sources, page/visual inventory, and nine consolidated data entities) into one file.

This is the **source record**: what the PBI file contained. It does not track build
state. For the reconciliation against the live schema and the phased build sequence, see
[`mlb-research-dashboard.md`](./mlb-research-dashboard.md) and its companion
[`mlb-research-dashboard-remainder.md`](./mlb-research-dashboard-remainder.md). The
pre-compute decision this catalog motivated is recorded in
[ADR-20260420-2](../decisions/ADR-20260420-2-mlb-preaggregated-stats.md).

The report had eight pages — **Game, New, Extra, Criteria, EV, MAIN, VS, Proj** — which
collapse to five distinct concepts (New / Extra / Criteria / MAIN are copies of one
batter page). Two "Duplicate of…" pages, including a standalone pitcher page, were
deleted during cleanup.

## 1. Data sources

### Primary — MLB Stats API (`statsapi.mlb.com/api/v1`)

- **`/game/{gameID}/withMetrics`** — the workhorse. One call returns box-score stats,
  season-to-date stats embedded per player, play-by-play, pitch-level events, and hit
  data. Every box-score, season-stat, and play-by-play query pulls from this endpoint.
- **`/schedule`** (with hydration) — probable pitchers and team schedule.
- **`/sports/1/players`** — player roster and metadata.
- **`/people/{playerID}/stats`** (various `stats=` params) — situational split stats.

### Secondary — Baseball Savant (`baseballsavant.mlb.com`)

- **`/statcast_search`** — pitch-level Statcast: exit velocity, launch angle, bat speed,
  attack angle, timing metrics, swing/whiff/barrel flags, expected stats.
- **`/gf?game_pk=`** — live box score (the live BoxScore query).
- **Flat Excel exports** — `mlbSavantStatcast-2024-25.xlsx` and
  `mlbSavantStatcast-2025-26.xlsx` hold the 2024/2025 Savant data.

## 2. Model tables (as built in Power BI)

| Table        | Grain               | Key fields                                                                                                                                                                             |
| ------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAME**     | one row / game      | gameID, gameDate, gameDateTime, officialDate, statusID, gameDisplay, awayTeamID, homeTeamID, venueID, gameType, dayNight, doubleHeader, gamesInSeries, seriesGameNumber, gameDateIndex |
| **TEAMGAME** | one row / team-game | teamGameID, gameID, gameDate, side (H/A), teamID, vsTeamID, pitcherID, vsPitcherID, teamScore, vsTeamScore, teamIsWinner, vsTeamIsWinner                                               |
| **PLAYER**   | one row / player    | playerID, playerName, teamID, positionID, battingHand, pitchingHand, strikeZoneTop, strikeZoneBottom, shortName, playerNumber                                                          |
| **TEAM**     | one row / team      | teamID, teamName, venueID, nextTeamID, nextGameID, nextGameDate, ballparkPalTeam (BallparkPal name map, stored as compressed binary)                                                   |
| **VENUE**    | static lookup       | loaded from an Excel table, not the API                                                                                                                                                |

Computed keys/flags added in Power Query: `officialDate` / `officialDateTime`
(reschedule-aware), `isGame` (real game vs makeup placeholder), `gameDateIndex` (ordinal
within a date), `teamGameIndex` (sequential game number per team).

## 3. Stat tables

### Box Score — Hitting

- **Game** (`stats.batting`): plateAppearances, atBats, hits, doubles, triples, homeRuns,
  totalBases, strikeouts, walks, runs, rbi, intentionalWalks, hitByPitch, stolenBases,
  leftOnBase, sacBunts, sacFlies, flyOuts, groundOuts, airOuts, popOuts, lineOuts,
  atBatsPerHomeRun.
- **Season** (`seasonStats.batting`): all Game fields plus avg, obp, slg, ops, babip,
  groundOutsToAirouts.

### Box Score — Pitching

- **Game** (`stats.pitching`): gamesPitched, battersFaced, atBats, hits, doubles, triples,
  homeRuns, strikeOuts, walks, runs, rbi, intentionalWalks, hitByPitch, stolenBases,
  sacBunts, sacFlies, flyOuts, groundOuts, airOuts, popOuts, lineOuts, gamesStarted,
  gamesFinished, completeGames, shutouts, numberOfPitches, inningsPitched, wins, losses,
  saves, saveOpportunities, holds, blownSaves, earnedRuns, outs, balls, strikes,
  strikePercentage, hitBatsmen, balks, wildPitches, passedBall, runsScoredPer9,
  homeRunsPer9, inheritedRunners, inheritedRunnersScored.
- **Season** (`seasonStats.pitching`): all Game fields plus era, whip, obp, winPercentage,
  strikeoutWalkRatio, pitchesPerInning, strikeoutsPer9Inn, walksPer9Inn, hitsPer9Inn,
  groundOutsToAirouts.

### Statcast pitch-level (Savant `/statcast_search` + flat Excel)

- **Pitch:** pitchName, pitchType, pitchVelocity, zone, balls, strikes, batterSplit,
  pitcherSplit.
- **Contact:** exitVelocity, launchAngle, hitDistance, batSpeed, battedBallType.
- **Outcome flags (0/1):** isPlateAppearance, isAtBat, isWalk, isStrikeout, isHitIntoPlay,
  isBaseHit, isSingle, isDouble, isTriple, isHomeRun, isExtraBaseHit, isHardHit, isBarrel,
  isFoul, isSwing, isWhiff, isTake, isSacrifice, isSacFly.
- **Expected:** expectedBa, expectedSlg.
- **Swing mechanics:** attackAngle, attackDirection, swingPathTilt, isIdealAttackAngle,
  timingZOverUnder, timingYEarlyLate, timingXTiedUpFlail.

### Play-by-play (`/game/{id}/withMetrics` pitch events)

- **At-bat context:** batterGameAtBatID, gameID, teamID, playerID, atBatNumber, vsTeamID,
  isTopInning, inning, pitcherID, batterHandCode, pitcherHandCode, batterSplit,
  pitcherSplit.
- **Pitch event:** playID, pitchNumber, playEvent_code, playEvent_description,
  pitchStartSpeed, pitchCode, pitchZone, strikeZoneTop, strikeZoneBottom.
- **Hit data:** hit_launchSpeed, hit_launchAngle, hit_totalDistance, hit_trajectory,
  hit_hardness, hit_hitProbability, hit_batSpeed.
- **Outcome (last pitch only):** result_eventType, result_rbi, result_isOut,
  atBat_isScoringPlay.
- **Context:** homeRunBallparks, `isLastPitch` flag.

### Situational splits (`/people/{id}/stats?stats=statSplits`)

Home/away, day/night/dome, day of week (Mon–Sun), vs LHP / vs RHP, and each batting-order
position (1–9). A full hitting line per split.

### Career batter-vs-pitcher (`/people/{id}/stats?stats=vsTeam` + Savant career matchup)

PA, AB, H, 1B, 2B, 3B, HR, XBH, SO, BB, BA, SLG, wOBA, xBA, xSLG, xwOBA, exitVelocity,
launchAngle, hitDistance, hardHitPct, barrels, babip, strikeoutPct, walkPct, whiffPct.

### Hot/cold zones (`/people/{id}/stats?stats=hotColdZones`)

Zone (1–13 grid), name (BA / OBP / SLG / xBA …), value, temp (hot / warm / cool / cold),
color.

## 4. Computed vs raw — and the pre-computation gap

**Raw from the API (no transformation):** all counting stats; all pre-computed rate stats
(avg, obp, slg, ops, era, whip, K/9 …); pitch data; Statcast measurements.

**Computed in Power Query:** composite keys `playerGameID` / `teamGameID`
(`playerID-gameID`); `isGame`; `officialDate` / `officialDateTime` (reschedule-aware);
`gameDateIndex`; `teamGameIndex`; `isLastPitch` (max pitch index per at-bat — assigns
result fields to the final pitch only); `batterSplit` / `pitcherSplit` labels from
handedness; `isExtraBaseHit` (= 2B + 3B + HR); `BatterPitcherID` matchup key;
`gameDisplay` (`"AWAY@HOME"`, `"-2"` suffix for doubleheaders).

**The pre-computation gap — the catalog's headline finding.** Power BI held the entire
pitch-level fact table in memory and aggregated it _at report time_ with DAX: rolling
windows (last 7/14/30, L5AB, L2/L3-game), hard-hit rate, barrel rate, whiff rate, K / BB
rate, expected-stat aggregations, HR patterns, and the hot/cold zones. A web app cannot
do this per request. **Rule:** any stat that appears in a visual and can be filtered by
the player selector must be a stored, pre-computed column — not derived at runtime. This
is what maps the report onto ETL tables, and is the decision recorded in ADR-20260420-2.

## 5. Report pages and visuals

Ten PBI pages reduced to five distinct concepts:

| Concept              | PBI page(s)                      | Notes                                                                     |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| Batter analysis      | MAIN (+ New, Extra, Criteria)    | keep MAIN — the most complete copy; the other three are layout variants   |
| Exit velocity        | EV                               | whole-team view, contact quality                                          |
| Career matchups      | VS                               | full-lineup BvP, home/away split                                          |
| Projections          | Proj                             | lineup-wide projection table                                              |
| Game selector        | Game                             | navigation + global filters                                               |
| ~~Pitcher analysis~~ | ~~Duplicate of Extra~~ (deleted) | pitcher data survives only as opposing-SP stats + the pitcher-hand toggle |

The sources below reference the two PBI fact tables: **BATTER** (batter context columns
plus the `_x*` projection columns) and **PLAYS** (Statcast pitch-level rows, aggregated
on the fly by DAX). `Measure.vs*` is the Matchups query output; `pitcherSeasonData` is a
separate query for opposing-pitcher season stats.

### Game

Game selection + global filters before navigating to a player page.

| Visual                 | Source                                  |
| ---------------------- | --------------------------------------- |
| Date slicer            | TEAMGAME.game_date                      |
| Upcoming-game selector | UpcomingGameData.Display Game, gameTime |
| Pitcher-hand toggle    | PLAYS.isNextPitcherHand                 |
| Page navigator         | —                                       |

### Batter analysis (MAIN)

The core page — ten visuals:

1. **Player identity card** — player_name, team_name, gameDisplay, gameTime, batting
   order (`#`), `_battingPosition`. Source: BATTER.
2. **Predictions table** (one row) — projected H, hit prob, R, RBI, BB, K, 1B, 2B, HR,
   XBH, TB, HR prob, HRR. Source: BATTER `_xH, _H_prob, _xR, _xRBI, _xBB, _xK, _x1B, _x2B,
_xHR, _HR_prob, _xTB, _xXBH, _xHRR` — pre-calculated model outputs, stored per
   player-game (not aggregated at display time).
3. **Per-game log** (one row / game) — date, opposing pitcher/team, PA, hits, TB, HR, HRR,
   avg EV, avg xBA, hard-hit flag, XBH, HIP, HIP rate, R, RBI, K, BB, max EV, gameID.
   Source: PLAYS aggregated per game-date per player (Statcast rolled up in DAX).
4. **Per-at-bat log** (one row / at-bat) — AB index, date, opposing pitcher/team, result,
   avg EV, avg LA, avg hit distance, avg xBA, at-bat number, inning, AB count. Source:
   PLAYS grouped by `at_bat_number` within game.
5. **HR pattern card** — HR Hot flag, pattern hit rate, games since last HR, HR pattern
   early, HR pattern late. Source: PLAYS rolling-window measures.
6. **VS-pitcher career summary card** — PA, H, HR, EV, xBA, Barrels, SO vs the current
   pitcher. Source: `Measure.vs*` (Matchups query), one row per batter-pitcher pair.
7. **VS-pitcher career detail table** — pitcher name, PA, H, XBH, HR, EV, xBA, BA, SO,
   BABIP, xwOBA, TB, Barrels, LA, Dist, BB, Whiff%. Same source as #6 (the card is the
   summary; this is the full row).
8. **Pitcher season stats table** — opposing SP: name, ERA, IP, hits allowed, HR allowed,
   batters faced, K, BB, runs allowed, avg against. Source: `pitcherSeasonData` (its own
   query, pulled separately from the batter data).
9. **Team overview pivot** (one row / batter on the team) — player, batting order,
   last-game max EV, L2-game avg EV, L3-game total xBA, adj xBA, avg xBA, HIP rate, BABIP,
   avg, HR Hot, avg EV above escape velocity, PA, HIP, hits, K, XBH, HR, HRR, avg EV,
   hard-hit rate, L2-game HH, L5AB EV, R, RBI, BB, plus VS-career columns (PA, H, XBH, HR,
   EV, xBA, BA, SO) and projection columns (hit prob, xXBH, xTB, xHRR, HR prob). _The most
   complex visual in the file — it joins three sources: PLAYS per player + BATTER
   projections + `Measure.vs_`.\*
10. **Platoon split pivot** (one row per pitcher hand: vs LHP / vs RHP) — L2-game avg EV,
    PA, hits, XBH, avg EV, avg hit dist, L3-game total xBA, adj xBA, avg xBA, HIP rate,
    BABIP, avg, avg EV above escape velocity. Source: PLAYS filtered by `isNextPitcherHand`,
    then aggregated.

### EV

Exit-velocity focus; the whole team at once rather than one selected player.

- **Team EV pivot** (one row / batter, both teams) — player, team, batting order, avg EV,
  max EV, hard-hit rate, walk rate, PA, HIP, hits, XBH, HR, TB, R, RBI, K, avg xBA, avg,
  pattern hit rate, games since HR, HR Hot. Source: PLAYS per player + BATTER context.
- **Per-at-bat log** — same as MAIN #4, but with batter name as a column (not filtered to
  one player).
- Controls: pitcher-hand toggle, game selector, at-bat-number slicer, date-range slicer.
  (The AB-number slicer requires an at-bat index available for filtering.)

### VS

Career-matchup view for the whole lineup at once, split by side.

- **Team VS career pivot** (one row / batter) — PA, H, XBH, HR, EV, xBA, BA, BABIP,
  xwOBA, TB, Barrels, LA, Dist, SO, BB, Whiff%. Source: `Measure.vs*` for all batters.
- **Pitcher season stats** — same `pitcherSeasonData` as MAIN.
- Controls: home/away side slicer (BATTER.Side), game selector.

### Proj

Lineup-wide projections in a single table.

- **Lineup projections pivot** (one row / batter) — batting order, all projection columns
  (`_xH … _xHRR`), plus L5AB EV, career-vs-pitcher HR, and pattern hit rate. Source:
  BATTER `_x*` + PLAYS.L5AB EV + `Measure.vs HR` + PLAYS.Pattern HitRate.
- Controls: game selector, home/away side slicer.

## 6. Consolidated data model (nine entities)

Working backwards from all pages, the distinct data entities the web app needs. Entities
4–7 come from Statcast and must be pre-aggregated from pitch level by the ETL; 3 and 6
also require a model layer on top; the rest are direct API pulls.

1. **Upcoming games** — gameID, gameDisplay, gameTime, awayTeamID, homeTeamID,
   awayPitcherID, homePitcherID, pitcherHand.
2. **Batter context per game** — playerID, playerName, teamID, gameID, battingOrder, side,
   gameDisplay, gameTime.
3. **Batter projections per game** — playerID, gameID, `_xH, _H_prob, _xR, _xRBI, _xBB,
_xK, _x1B, _x2B, _xHR, _HR_prob, _xTB, _xXBH, _xHRR`.
4. **Player game stats** (Statcast per player-game) — playerID, gameID, gameDate,
   opposingPitcherID, opposingTeamID, PA, H, XBH, HR, TB, HRR, avgEV, maxEV, avgLA,
   avgDist, avgXBA, adjXBA, HIP, HIPrate, hardHitRate, BABIP, battingAvg, K, BB, runs,
   RBI, L5AB_EV, last2GameAvgEV, lastGameMaxEV, last3GameTotalXBA, avgEVAboveEscapeVelo,
   last2GameHH.
5. **Player at-bat stats** — playerID, gameID, atBatNumber, inning, result, avgEV, avgLA,
   avgDist, avgXBA.
6. **Player trend / pattern stats** — playerID, asOfDate, patternHitRate, gamesSinceHR,
   hrPatternEarly, hrPatternLate, hrHotFlag.
7. **Player platoon splits** (vs LHP / vs RHP, rolling) — playerID, pitcherHand, PA, H,
   XBH, avgEV, avgDist, last2GameAvgEV, last3GameTotalXBA, adjXBA, avgXBA, HIPrate, BABIP,
   battingAvg, avgEVAboveEscapeVelo.
8. **Career batter-vs-pitcher** (lifetime Savant) — batterID, pitcherID, PA, H, XBH, HR,
   TB, BA, SLG, wOBA, xBA, xSLG, xwOBA, EV, LA, Dist, BABIP, barrels, K, BB, whiffPct,
   hardHitPct.
9. **Pitcher season stats** (opposing SP, from the Stats API) — pitcherID, playerName,
   ERA, IP, hitsAllowed, HRallowed, battersFaced, K, BB, runsAllowed, avgAgainst.
