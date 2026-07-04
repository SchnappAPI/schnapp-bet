"use client";

import { heatColorFor } from "@/lib/colorScale";

// Heatmap table cell: percentile-shaded background within the visible
// column (web/lib/colorScale.ts). Null-safe — missing values render a
// dash on a transparent background. Pass the same `values` array for
// every cell in a column so ranks agree.

export default function HeatCell({
  value,
  values,
  format,
  invert = false,
  className = "",
}: {
  value: number | null | undefined;
  values: (number | null | undefined)[];
  format?: (v: number) => string;
  invert?: boolean;
  className?: string;
}) {
  const display =
    value == null || Number.isNaN(value)
      ? "-"
      : format
        ? format(value)
        : String(value);
  return (
    <td
      className={`text-center py-1 px-1.5 tabular-nums ${className}`}
      style={{ background: heatColorFor(value, values, invert) }}
    >
      {display}
    </td>
  );
}
