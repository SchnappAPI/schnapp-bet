import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/mlb-player?gamePk=<pk>&playerId=<id>
// Returns player trend stats, recent game log, career BvP vs today's opposing SP,
// and tier lines from the grading engine for the selected batter in this game.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gamePk   = searchParams.get('gamePk');
  const playerId = searchParams.get('playerId');

  if (!gamePk || !playerId) {
    return NextResponse.json({ error: 'gamePk and playerId required' }, { status: 400 });
  }

  let pool: Awaited<ReturnType<typeof getPool>> | null = null;
  try {
    pool = await getPool();

    // 1. Game context: identify opposing SP and game date
    const gameRes = await pool.request()
      .input('gamePk', parseInt(gamePk))
      .query(`
        SELECT g.game_date, g.away_team_id, g.home_team_id,
               g.away_pitcher_id, g.away_pitcher_hand,
               g.home_pitcher_id, g.home_pitcher_hand,
               at.team_abbreviation AS away_abbr,
               ht.team_abbreviation AS home_abbr,
               ap.player_name AS away_pitcher_name,
               hp.player_name AS home_pitcher_name
        FROM mlb.games g
        LEFT JOIN mlb.teams at ON at.team_id = g.away_team_id
        LEFT JOIN mlb.teams ht ON ht.team_id = g.home_team_id
        LEFT JOIN mlb.players ap ON ap.player_id = g.away_pitcher_id
        LEFT JOIN mlb.players hp ON hp.player_id = g.home_pitcher_id
        WHERE g.game_pk = @gamePk
      `);
    const game = gameRes.recordset[0] ?? null;

    // 2. Determine which SP faces this batter (batter's team vs opposing pitcher)
    let oppPitcherId: number | null = null;
    let oppPitcherName: string | null = null;
    let oppPitcherHand: string | null = null;

    if (game) {
      const teamRes = await pool.request()
        .input('playerId', parseInt(playerId))
        .query(`
          SELECT TOP 1 team_id FROM mlb.player_season_batting
          WHERE player_id = @playerId ORDER BY season_year DESC
        `);
      const batterTeam = teamRes.recordset[0]?.team_id ?? null;
      if (batterTeam) {
        if (batterTeam === game.away_team_id) {
          oppPitcherId   = game.home_pitcher_id;
          oppPitcherName = game.home_pitcher_name;
          oppPitcherHand = game.home_pitcher_hand;
        } else if (batterTeam === game.home_team_id) {
          oppPitcherId   = game.away_pitcher_id;
          oppPitcherName = game.away_pitcher_name;
          oppPitcherHand = game.away_pitcher_hand;
        }
      }
    }

    const gameDate = game?.game_date ? String(game.game_date).slice(0, 10) : null;

    // 3. Trend stats — most recent row before this game
    const trendRes = await pool.request()
      .input('playerId', parseInt(playerId))
      .input('gameDate', gameDate ?? '2099-01-01')
      .query(`
        SELECT TOP 1 ts.*
        FROM mlb.player_trend_stats ts
        WHERE ts.batter_id = @playerId AND ts.game_date < @gameDate
        ORDER BY ts.game_date DESC
      `);
    const trendStats = trendRes.recordset[0] ?? null;

    // 4. Recent game log — last 30 games per-game aggregates
    const gameLogRes = await pool.request()
      .input('playerId', parseInt(playerId))
      .input('gameDate', gameDate ?? '2099-01-01')
      .query(`
        SELECT TOP 30
          ab.game_date,
          SUM(CASE WHEN ab.result_event_type IN ('single','double','triple','home_run') THEN 1 ELSE 0 END) AS hits,
          SUM(CASE ab.result_event_type
              WHEN 'single' THEN 1 WHEN 'double' THEN 2
              WHEN 'triple' THEN 3 WHEN 'home_run' THEN 4
              ELSE 0 END) AS total_bases,
          SUM(CASE WHEN ab.result_event_type = 'home_run' THEN 1 ELSE 0 END) AS home_runs,
          COUNT(*) AS pa,
          SUM(CASE WHEN ab.result_event_type IN ('walk','intent_walk') THEN 1 ELSE 0 END) AS walks,
          SUM(CASE WHEN ab.result_event_type IN ('strikeout','strikeout_double_play') THEN 1 ELSE 0 END) AS strikeouts,
          AVG(CASE WHEN ab.hit_launch_speed IS NOT NULL THEN ab.hit_launch_speed ELSE NULL END) AS avg_ev,
          SUM(CASE WHEN ab.hit_launch_speed >= 95 THEN 1 ELSE 0 END) AS hard_hit,
          SUM(CASE WHEN ab.hit_launch_speed IS NOT NULL THEN 1 ELSE 0 END) AS bbe,
          AVG(CAST(ab.hit_probability AS FLOAT)) AS avg_xba,
          g.game_display
        FROM mlb.player_at_bats ab
        LEFT JOIN mlb.games g ON g.game_pk = ab.game_pk
        WHERE ab.batter_id = @playerId
          AND ab.game_date < @gameDate
          AND ab.result_event_type NOT IN (
            'caught_stealing_2b','caught_stealing_3b','caught_stealing_home',
            'pickoff_1b','pickoff_2b','pickoff_caught_stealing_2b',
            'pickoff_caught_stealing_3b','pickoff_caught_stealing_home',
            'pickoff_error_1b','stolen_base_2b','wild_pitch')
        GROUP BY ab.game_date, g.game_display
        ORDER BY ab.game_date DESC
      `);
    const gameLog = gameLogRes.recordset;

    // 5. Career BvP vs today's opposing SP
    let bvp: Record<string, unknown> | null = null;
    if (oppPitcherId) {
      const bvpRes = await pool.request()
        .input('batterId', parseInt(playerId))
        .input('pitcherId', oppPitcherId)
        .query(`
          SELECT batter_id, pitcher_id, plate_appearances, at_bats, hits,
                 home_runs, walks, strikeouts, total_bases,
                 batting_avg, obp, slg, ops, last_faced_date
          FROM mlb.career_batter_vs_pitcher
          WHERE batter_id = @batterId AND pitcher_id = @pitcherId
        `);
      bvp = bvpRes.recordset[0] ?? null;
    }

    // 6. Opposing pitcher season stats
    let pitcherStats: Record<string, unknown> | null = null;
    if (oppPitcherId) {
      const pRes = await pool.request()
        .input('pitcherId', oppPitcherId)
        .query(`
          SELECT TOP 1 player_id, k_per_9, bb_per_9, h_per_9, era, whip,
                 batting_avg_against, obp_against, ops_against, hr_per_9,
                 strikeouts, innings_pitched, games_started, season_year
          FROM mlb.pitcher_season_stats
          WHERE player_id = @pitcherId
          ORDER BY season_year DESC
        `);
      pitcherStats = pRes.recordset[0] ?? null;
    }

    // 7. Tier lines from grading engine for this player in this game
    const tierRes = await pool.request()
      .input('playerId', parseInt(playerId))
      .input('gamePk', parseInt(gamePk))
      .query(`
        SELECT tl.market_key, tl.composite_grade,
               tl.safe_line, tl.safe_prob, tl.safe_price,
               tl.value_line, tl.value_prob, tl.value_price,
               tl.highrisk_line, tl.highrisk_prob, tl.highrisk_price,
               tl.lotto_line, tl.lotto_prob, tl.lotto_price,
               tl.kde_window, tl.grade_date
        FROM common.player_tier_lines tl
        JOIN odds.event_game_map egm ON egm.game_pk = @gamePk
        WHERE tl.player_id = @playerId
          AND tl.game_id = egm.event_id
          AND tl.market_key IN ('batter_hits','batter_total_bases','batter_home_runs')
      `);
    const tierLines = tierRes.recordset;

    // 8. Player name
    const nameRes = await pool.request()
      .input('playerId', parseInt(playerId))
      .query(`SELECT TOP 1 player_name FROM mlb.players WHERE player_id = @playerId`);
    const playerName = nameRes.recordset[0]?.player_name ?? null;

    return NextResponse.json({
      playerId: parseInt(playerId),
      playerName,
      gameDate,
      trendStats,
      gameLog,
      bvp,
      oppPitcherId,
      oppPitcherName,
      oppPitcherHand,
      pitcherStats,
      tierLines,
    });
  } catch (err: any) {
    console.error('/api/mlb-player error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
