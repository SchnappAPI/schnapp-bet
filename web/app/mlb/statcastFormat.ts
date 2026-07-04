// Shared Statcast display helpers for MLB views (game Exit Velo tab,
// player Statcast section). Color thresholds are display-only; the
// hard-hit/barrel STAT definitions live with the computations that use
// them and must mirror the ETL (mlb_play_by_play.py):
//   hard-hit = EV >= 95;  barrel = EV >= 95 AND 8 <= LA <= 32.

export function resultColor(resultType: string | null): string {
  if (!resultType) return "text-fg-subtle";
  const t = resultType.toLowerCase();
  if (t.includes("home_run")) return "text-warn";
  if (t.includes("hit") || t === "single" || t === "double" || t === "triple")
    return "text-pos";
  if (t.includes("strikeout")) return "text-neg";
  return "text-fg-subtle";
}

export function resultLabel(resultType: string | null): string {
  if (!resultType) return "-";
  return resultType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function veloColor(velo: number | null): string {
  if (velo == null) return "text-fg-subtle";
  if (velo >= 100) return "text-neg";
  if (velo >= 95) return "text-warn";
  if (velo >= 90) return "text-warn";
  return "text-fg-muted";
}

// hit_probability is stored 0-100 in mlb.player_at_bats; xBA displays on
// the 0-1 batting-average scale (.296). Every xBA render goes through this.
export function fmtXba(hitProbability: number | null): string {
  if (hitProbability == null) return "-";
  return (Number(hitProbability) / 100).toFixed(3).replace(/^0/, "");
}

export const HARD_HIT_EV = 95;
export const BARREL_LA_MIN = 8;
export const BARREL_LA_MAX = 32;

export function isHardHit(ev: number | null): boolean {
  return ev != null && ev >= HARD_HIT_EV;
}

export function isBarrel(ev: number | null, la: number | null): boolean {
  return (
    ev != null &&
    la != null &&
    ev >= HARD_HIT_EV &&
    la >= BARREL_LA_MIN &&
    la <= BARREL_LA_MAX
  );
}
