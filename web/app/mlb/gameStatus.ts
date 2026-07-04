// Shared MLB game-status classification. mlb.games.game_status holds 'F' for
// finals, otherwise the MLB Stats API detailedState string ("Scheduled",
// "Pre-Game", "Warmup", "In Progress", ...). One home for the pregame
// allowlist so the list page, game page, and tabs never disagree.

const PREGAME_PREFIXES = [
  "Preview",
  "Scheduled",
  "Pre-Game",
  "Warmup",
  "Delayed Start",
  "Postponed",
  "Suspended",
  "Cancelled",
];

export function isFinalStatus(status: string | null): boolean {
  return status === "F" || status === "Final" || status === "Game Over";
}

export function isLiveStatus(status: string | null): boolean {
  if (!status || isFinalStatus(status)) return false;
  return !PREGAME_PREFIXES.some((p) => status.startsWith(p));
}
