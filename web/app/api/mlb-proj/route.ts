import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/mlb-proj?gamePk=<pk>
// Returns both lineups for a game with trend stats, pitcher matchup context,
// and tier lines — everything needed to render the Proj (projections) view.
// One call covers the full game rather than per-player fetches.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gamePk = searchParams.get('gamePk');

  if (!gamePk) {
    return NextResponse.json({ error: 'gamePk required' }, { status: 400 });
  }

  let pool: Awaited<ReturnType<typeof getPool>> | null = null;
  try {
    pool = await getPool();

    // 1. Game context
    const gameRes = await pool.request()
      .input('gamePk', parseInt(gamePk))
      .query(`
        SELECT g.game_date, g.away_team_id, g.home_team_id,
               g.away_pitcher_id, g.home_pitcher_id,
               g.away_pitcher_hand, g.home_pitcher_hand,
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
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const gameDate = String(game.game_date).slice(0, 10);

    // 2. Both lineups from batting_stats
    const lineupRes = await pool.request()
      .input('gamePk', parseInt(gamePk))
      .query(`
        SELECT bs.player_id, bs.player_name, bs.team_id, bs.batting_order,
               bs.position_abbreviation, bs.hand_code
        FROM mlb.batting_stats bs
        WHERE bs.game_pk = @gamePk
          AND bs.batting_order % 100 = 0
        ORDER BY bs.team_id, bs.batting_order
      `);
    const allBatters = lineupRes.recordset;

    // Separate into away/home
    const awayBatters = allBatters.filter((b: any) => b.team_id === game.away_team_id);
    const homeBatters = allBatters.filter((b: any) => b.team_id === game.home_team_id);
    const allBatterIds: number[] = allBatters.map((b: any) => b.player_id as number);

    if (allBatterIds.length === 0) {
      // Lineup not yet available — return game context only
      return NextResponse.json({
        gamePk: parseInt(gamePk), gameDate,
        awayTeamId: game.away_team_id, homeTeamId: game.home_team_id,
        awayAbbr: game.away_abbr, homeAbbr: game.home_abbr,
        awayPitcherId: game.away_pitcher_id, awayPitcherName: game.away_pitcher_name,
        awayPitcherHand: game.away_pitcher_hand,
        homePitcherId: game.home_pitcher_id, homePitcherName: game.home_pitcher_name,
        homePitcherHand: game.home_pitcher_hand,
        awayLineup: [], homeLineup: [],
        awayPitcherStats: null, homePitcherStats: null,
        tierLines: [],
        lineupAvailable: false,
      });
    }

    // 3. Stage all batter IDs for multi-row lookups
    await pool.request().query(`CREATE TABLE #proj_batters (batter_id INT PRIMARY KEY)`);
    for (const bid of allBatterIds) {
      await pool.request().input('bid', bid)
        .query(`INSERT INTO #proj_batters VALUES (@bid)`);
    }

    // 4. Most recent trend_stats row before game_date for each batter
    const trendRes = await pool.request()
      .input('gameDate', gameDate)
      .query(`
        SELECT ts.batter_id,
               ts.w10_pa, ts.w10_hit_rate, ts.w10_tb_per_pa, ts.w10_home_runs,
               ts.w10_k_rate, ts.w10_bb_rate, ts.w10_avg_ev, ts.w10_hard_hit_pct,
               ts.w10_barrel_pct, ts.w10_avg_xba,
               ts.w30_pa, ts.w30_hit_rate, ts.w30_tb_per_pa, ts.w30_home_runs,
               ts.w30_k_rate, ts.w30_bb_rate, ts.w30_avg_ev, ts.w30_hard_hit_pct,
               ts.w30_barrel_pct, ts.w30_avg_xba,
               ts.w60_pa, ts.w60_hit_rate, ts.w60_tb_per_pa, ts.w60_home_runs,
               ts.w60_k_rate, ts.w60_bb_rate,
               ts.vs_lhp_pa, ts.vs_lhp_hit_rate,
               ts.vs_rhp_pa, ts.vs_rhp_hit_rate,
               ts.home_pa, ts.home_hit_rate,
               ts.away_pa, ts.away_hit_rate
        FROM mlb.player_trend_stats ts
        INNER JOIN #proj_batters pb ON pb.batter_id = ts.batter_id
        WHERE ts.game_date = (
          SELECT MAX(ts2.game_date)
          FROM mlb.player_trend_stats ts2
          WHERE ts2.batter_id = ts.batter_id AND ts2.game_date < @gameDate
        )
      `);
    const trendMap: Record<number, Record<string, unknown>> = {};
    for (const row of trendRes.recordset) {
      trendMap[row.batter_id as number] = row;
    }

    // 5. Career BvP — away batters vs home pitcher, home batters vs away pitcher
    const bvpBatches: { batterId: number; pitcherId: number }[] = [
      ...awayBatters.map((b: any) => ({ batterId: b.player_id, pitcherId: game.home_pitcher_id })),
      ...homeBatters.map((b: any) => ({ batterId: b.player_id, pitcherId: game.away_pitcher_id })),
    ].filter(p => p.pitcherId != null);

    const bvpMap: Record<number, Record<string, unknown>> = {};
    if (bvpBatches.length > 0) {
      // Stage (batter_id, pitcher_id) pairs
      await pool.request().query(
        `CREATE TABLE #proj_bvp (batter_id INT, pitcher_id INT, PRIMARY KEY (batter_id, pitcher_id))`
      );
      for (const pair of bvpBatches) {
        await pool.request()
          .input('bid', pair.batterId).input('pid', pair.pitcherId)
          .query(`INSERT INTO #proj_bvp VALUES (@bid, @pid)`);
      }
      const bvpRes = await pool.request().query(`
        SELECT bvp.batter_id, bvp.pitcher_id, bvp.plate_appearances,
               bvp.hits, bvp.home_runs, bvp.strikeouts, bvp.walks,
               bvp.batting_avg, bvp.obp, bvp.slg, bvp.ops
        FROM mlb.career_batter_vs_pitcher bvp
        INNER JOIN #proj_bvp pb ON pb.batter_id = bvp.batter_id AND pb.pitcher_id = bvp.pitcher_id
      `);
      await pool.request().query(`DROP TABLE #proj_bvp`);
      for (const row of bvpRes.recordset) {
        bvpMap[row.batter_id as number] = row;
      }
    }

    // 6. Both pitchers' season stats
    const pitcherIds = [game.away_pitcher_id, game.home_pitcher_id].filter(Boolean);
    const pitcherStatsMap: Record<number, Record<string, unknown>> = {};
    if (pitcherIds.length > 0) {
      const pRes = await pool.request().query(`
        SELECT TOP 2 player_id, season_year, era, whip, k_per_9, bb_per_9,
               h_per_9, hr_per_9, batting_avg_against, obp_against, ops_against,
               innings_pitched, games_started, strikeouts
        FROM mlb.pitcher_season_stats
        WHERE player_id IN (${pitcherIds.join(',')})
        ORDER BY season_year DESC
      `);
      for (const row of pRes.recordset) {
        const pid = row.player_id as number;
        if (!pitcherStatsMap[pid]) pitcherStatsMap[pid] = row;
      }
    }

    // 7. Tier lines for all batters in this game (hits, total_bases, home_runs)
    const tierRes = await pool.request()
      .input('gamePk', parseInt(gamePk))
      .query(`
        SELECT tl.player_id, tl.market_key, tl.composite_grade,
               tl.safe_line, tl.safe_prob, tl.safe_price,
               tl.value_line, tl.value_prob, tl.value_price,
               tl.highrisk_line, tl.highrisk_prob, tl.highrisk_price,
               tl.lotto_line, tl.lotto_prob, tl.lotto_price,
               tl.kde_window, tl.grade_date
        FROM common.player_tier_lines tl
        JOIN odds.event_game_map egm ON egm.game_pk = @gamePk
        INNER JOIN #proj_batters pb ON pb.batter_id = tl.player_id
        WHERE tl.game_id = egm.event_id
          AND tl.market_key IN ('batter_hits','batter_total_bases','batter_home_runs')
      `);

    await pool.request().query(`DROP TABLE #proj_batters`);

    // Index tier lines by player_id → market_key
    const tierByPlayer: Record<number, Record<string, unknown>[]> = {};
    for (const row of tierRes.recordset) {
      const pid = row.player_id as number;
      if (!tierByPlayer[pid]) tierByPlayer[pid] = [];
      tierByPlayer[pid].push(row);
    }

    // Assemble lineup objects
    function enrichBatter(batter: any, oppPitcherHand: string | null) {
      return {
        playerId: batter.player_id,
        playerName: batter.player_name,
        teamId: batter.team_id,
        battingOrder: Math.floor(batter.batting_order / 100),
        position: batter.position_abbreviation,
        handCode: batter.hand_code,
        trend: trendMap[batter.player_id] ?? null,
        bvp: bvpMap[batter.player_id] ?? null,
        tierLines: tierByPlayer[batter.player_id] ?? [],
        oppPitcherHand,
      };
    }

    const awayLineup = awayBatters.map((b: any) => enrichBatter(b, game.home_pitcher_hand));
    const homeLineup = homeBatters.map((b: any) => enrichBatter(b, game.away_pitcher_hand));

    return NextResponse.json({
      gamePk: parseInt(gamePk),
      gameDate,
      awayTeamId: game.away_team_id,
      homeTeamId: game.home_team_id,
      awayAbbr: game.away_abbr,
      homeAbbr: game.home_abbr,
      awayPitcherId: game.away_pitcher_id,
      awayPitcherName: game.away_pitcher_name,
      awayPitcherHand: game.away_pitcher_hand,
      homePitcherId: game.home_pitcher_id,
      homePitcherName: game.home_pitcher_name,
      homePitcherHand: game.home_pitcher_hand,
      awayPitcherStats: pitcherStatsMap[game.away_pitcher_id] ?? null,
      homePitcherStats: pitcherStatsMap[game.home_pitcher_id] ?? null,
      awayLineup,
      homeLineup,
      tierLines: tierRes.recordset,
      lineupAvailable: true,
    });
  } catch (err: any) {
    console.error('/api/mlb-proj error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
