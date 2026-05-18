import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/mlb-pitcher?gamePk=<pk>&pitcherId=<id>
// Returns pitcher season stats, recent start log (last 10 starts from PBP),
// opposing lineup K-rate profiles from player_trend_stats,
// career BvP (pitcher vs each lineup batter), and tier lines for pitcher_strikeouts.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gamePk     = searchParams.get('gamePk');
  const pitcherId  = searchParams.get('pitcherId');

  if (!gamePk || !pitcherId) {
    return NextResponse.json({ error: 'gamePk and pitcherId required' }, { status: 400 });
  }

  let pool: Awaited<ReturnType<typeof getPool>> | null = null;
  try {
    pool = await getPool();

    // 1. Game context — identify which side this pitcher is on and get the opponent team
    const gameRes = await pool.request()
      .input('gamePk', parseInt(gamePk))
      .query(`
        SELECT g.game_date, g.away_team_id, g.home_team_id,
               g.away_pitcher_id, g.home_pitcher_id,
               g.away_pitcher_hand, g.home_pitcher_hand,
               at.team_abbreviation AS away_abbr,
               ht.team_abbreviation AS home_abbr
        FROM mlb.games g
        LEFT JOIN mlb.teams at ON at.team_id = g.away_team_id
        LEFT JOIN mlb.teams ht ON ht.team_id = g.home_team_id
        WHERE g.game_pk = @gamePk
      `);
    const game = gameRes.recordset[0] ?? null;

    let oppTeamId: number | null = null;
    let pitcherHand: string | null = null;
    if (game) {
      if (parseInt(pitcherId) === game.away_pitcher_id) {
        oppTeamId   = game.home_team_id;
        pitcherHand = game.away_pitcher_hand;
      } else if (parseInt(pitcherId) === game.home_pitcher_id) {
        oppTeamId   = game.away_team_id;
        pitcherHand = game.home_pitcher_hand;
      }
    }
    const gameDate = game?.game_date ? String(game.game_date).slice(0, 10) : null;

    // 2. Pitcher name
    const nameRes = await pool.request()
      .input('pitcherId', parseInt(pitcherId))
      .query(`SELECT TOP 1 player_name FROM mlb.players WHERE player_id = @pitcherId`);
    const pitcherName = nameRes.recordset[0]?.player_name ?? null;

    // 3. Pitcher season stats
    const seasonRes = await pool.request()
      .input('pitcherId', parseInt(pitcherId))
      .query(`
        SELECT TOP 1 player_id, season_year, games_started, innings_pitched,
               strikeouts, walks, hits_allowed, home_runs_allowed, earned_runs,
               era, whip, k_per_9, bb_per_9, h_per_9, hr_per_9,
               batting_avg_against, obp_against, slg_against, ops_against
        FROM mlb.pitcher_season_stats
        WHERE player_id = @pitcherId
        ORDER BY season_year DESC
      `);
    const seasonStats = seasonRes.recordset[0] ?? null;

    // 4. Recent start log — last 10 starts from PBP aggregated per game
    //    Counts strikeouts (pitch_result_code='S' on final pitch of PA where result is strikeout)
    //    Uses player_at_bats for accuracy: result_event_type strikeout/strikeout_double_play
    const startLogRes = await pool.request()
      .input('pitcherId', parseInt(pitcherId))
      .input('gameDate', gameDate ?? '2099-01-01')
      .query(`
        SELECT TOP 10
          ab.game_date,
          g.game_display,
          COUNT(DISTINCT ab.at_bat_number) AS batters_faced,
          SUM(CASE WHEN ab.result_event_type IN ('strikeout','strikeout_double_play') THEN 1 ELSE 0 END) AS strikeouts,
          SUM(CASE WHEN ab.result_event_type IN ('single','double','triple','home_run') THEN 1 ELSE 0 END) AS hits_allowed,
          SUM(CASE WHEN ab.result_event_type = 'home_run' THEN 1 ELSE 0 END) AS hr_allowed,
          SUM(CASE WHEN ab.result_event_type IN ('walk','intent_walk') THEN 1 ELSE 0 END) AS walks,
          CAST(COUNT(DISTINCT ab.at_bat_number) AS FLOAT) / 3.0 AS ip_approx
        FROM mlb.player_at_bats ab
        LEFT JOIN mlb.games g ON g.game_pk = ab.game_pk
        WHERE ab.pitcher_id = @pitcherId
          AND ab.game_date < @gameDate
        GROUP BY ab.game_date, g.game_display
        ORDER BY ab.game_date DESC
      `);
    const startLog = startLogRes.recordset;

    // 5. Opposing lineup — batters from mlb.batting_stats for opp team in this game
    let lineupBatterIds: number[] = [];
    let lineup: Record<string, unknown>[] = [];
    if (oppTeamId) {
      const lineupRes = await pool.request()
        .input('gamePk', parseInt(gamePk))
        .input('teamId', oppTeamId)
        .query(`
          SELECT bs.player_id, bs.player_name, bs.batting_order,
                 bs.position_abbreviation, bs.hand_code
          FROM mlb.batting_stats bs
          WHERE bs.game_pk = @gamePk
            AND bs.team_id = @teamId
            AND bs.batting_order % 100 = 0
          ORDER BY bs.batting_order
        `);
      lineup = lineupRes.recordset;
      lineupBatterIds = lineup.map((r: any) => r.player_id as number);
    }

    // 6. Trend stats (K-rate profile) for opposing lineup batters
    //    Fetch the most recent trend row before game_date for each batter
    let batterTrendMap: Record<number, Record<string, unknown>> = {};
    if (lineupBatterIds.length > 0) {
      // Stage batter IDs into a temp table to avoid tuple-IN limitation
      const createTmp = `
        CREATE TABLE #opp_batters (batter_id INT PRIMARY KEY);
      `;
      await pool.request().query(createTmp);

      for (const bid of lineupBatterIds) {
        await pool.request()
          .input('bid', bid)
          .query(`INSERT INTO #opp_batters (batter_id) VALUES (@bid)`);
      }

      const trendRes = await pool.request()
        .input('gameDate', gameDate ?? '2099-01-01')
        .query(`
          SELECT ts.batter_id,
                 ts.w10_k_rate, ts.w30_k_rate, ts.w60_k_rate,
                 ts.w10_pa, ts.w30_pa, ts.w60_pa,
                 ts.w30_avg_ev, ts.w30_hard_hit_pct, ts.w30_barrel_pct, ts.w30_avg_xba,
                 ts.vs_lhp_pa, ts.vs_lhp_hit_rate,
                 ts.vs_rhp_pa, ts.vs_rhp_hit_rate
          FROM mlb.player_trend_stats ts
          INNER JOIN #opp_batters ob ON ob.batter_id = ts.batter_id
          WHERE ts.game_date = (
            SELECT MAX(ts2.game_date)
            FROM mlb.player_trend_stats ts2
            WHERE ts2.batter_id = ts.batter_id
              AND ts2.game_date < @gameDate
          )
        `);

      await pool.request().query(`DROP TABLE #opp_batters`);

      for (const row of trendRes.recordset) {
        batterTrendMap[row.batter_id as number] = row;
      }
    }

    // 7. Career BvP — pitcher vs each opposing batter (reverse direction)
    let bvpMap: Record<number, Record<string, unknown>> = {};
    if (lineupBatterIds.length > 0) {
      const createTmp2 = `CREATE TABLE #opp_batters2 (batter_id INT PRIMARY KEY);`;
      await pool.request().query(createTmp2);

      for (const bid of lineupBatterIds) {
        await pool.request()
          .input('bid', bid)
          .query(`INSERT INTO #opp_batters2 (batter_id) VALUES (@bid)`);
      }

      const bvpRes = await pool.request()
        .input('pitcherId', parseInt(pitcherId))
        .query(`
          SELECT bvp.batter_id, bvp.plate_appearances, bvp.at_bats,
                 bvp.hits, bvp.home_runs, bvp.walks, bvp.strikeouts,
                 bvp.batting_avg, bvp.obp, bvp.slg, bvp.ops,
                 bvp.last_faced_date
          FROM mlb.career_batter_vs_pitcher bvp
          INNER JOIN #opp_batters2 ob ON ob.batter_id = bvp.batter_id
          WHERE bvp.pitcher_id = @pitcherId
        `);

      await pool.request().query(`DROP TABLE #opp_batters2`);

      for (const row of bvpRes.recordset) {
        bvpMap[row.batter_id as number] = row;
      }
    }

    // 8. Tier lines for pitcher_strikeouts in this game
    const tierRes = await pool.request()
      .input('pitcherId', parseInt(pitcherId))
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
        WHERE tl.player_id = @pitcherId
          AND tl.game_id = egm.event_id
          AND tl.market_key = 'pitcher_strikeouts'
      `);
    const tierLines = tierRes.recordset;

    // Assemble lineup with trend and BvP attached
    const lineupEnriched = lineup.map((batter: any) => ({
      ...batter,
      trend: batterTrendMap[batter.player_id] ?? null,
      bvp:   bvpMap[batter.player_id] ?? null,
    }));

    return NextResponse.json({
      pitcherId: parseInt(pitcherId),
      pitcherName,
      pitcherHand,
      gameDate,
      oppTeamId,
      seasonStats,
      startLog,
      lineup: lineupEnriched,
      tierLines,
    });
  } catch (err: any) {
    console.error('/api/mlb-pitcher error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
