// Shared constants for the MLB research routes.
// Baserunning noise event types excluded from PA counting at the at-bat
// grain — keep in lockstep with etl/mlb_play_by_play.py.
export const NOISE_EVENTS = [
  "caught_stealing_2b",
  "caught_stealing_3b",
  "caught_stealing_home",
  "pickoff_1b",
  "pickoff_2b",
  "pickoff_caught_stealing_2b",
  "pickoff_caught_stealing_3b",
  "pickoff_caught_stealing_home",
  "pickoff_error_1b",
  "stolen_base_2b",
  "wild_pitch",
];

export const NOISE_EVENTS_SQL = NOISE_EVENTS.map((e) => `'${e}'`).join(",");
