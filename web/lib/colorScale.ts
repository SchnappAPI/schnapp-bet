// Percentile-interpolated heat backgrounds for table cells (the PBI
// report's signature visual). A value is ranked against the visible
// column's values; the percentile maps to a green/neutral/red background
// built from the theme's --pos/--neg hues at low alpha so it reads on the
// dark surface without fighting text contrast.

const POS_RGB = "46, 189, 133"; // --pos
const NEG_RGB = "229, 72, 77"; // --neg
const MAX_ALPHA = 0.32;

/** Fraction of `values` at or below `value`, 0..1. Nulls are ignored. */
export function percentileOf(
  value: number,
  values: (number | null | undefined)[],
): number {
  let n = 0;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v == null || Number.isNaN(v)) continue;
    n++;
    if (v < value) below++;
    else if (v === value) equal++;
  }
  if (n <= 1) return 0.5;
  // Midrank so ties land in the middle and a full-tie column stays neutral.
  return (below + equal / 2) / n;
}

/**
 * Percentile (0..1) -> CSS background color. High percentile = green,
 * low = red, midfield fades to transparent. `invert` flips the scale for
 * lower-is-better columns (K%, games since HR).
 */
export function heatBackground(pct: number, invert = false): string {
  const p = invert ? 1 - pct : pct;
  const strength = Math.min(1, Math.abs(p - 0.5) * 2);
  if (strength < 0.08) return "transparent";
  const alpha = (strength * MAX_ALPHA).toFixed(3);
  return p >= 0.5 ? `rgba(${POS_RGB}, ${alpha})` : `rgba(${NEG_RGB}, ${alpha})`;
}

/** One-call helper: value ranked within its column -> background color. */
export function heatColorFor(
  value: number | null | undefined,
  values: (number | null | undefined)[],
  invert = false,
): string {
  if (value == null || Number.isNaN(value)) return "transparent";
  return heatBackground(percentileOf(value, values), invert);
}
