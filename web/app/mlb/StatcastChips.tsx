"use client";

import {
  chipsForAtBat,
  STATCAST_CHIPS,
  type StatcastChipDef,
} from "./statcastFormat";

// Named-threshold chips for at-bat rows (Savant Gamefeed format) and the
// once-per-page legend that defines them. Chip predicates and definitions
// live in statcastFormat.ts beside the D3 threshold constants.

function Chip({ chip }: { chip: StatcastChipDef }) {
  return (
    <span
      className={`inline-block rounded px-1 py-px text-[9px] font-medium uppercase tracking-wide whitespace-nowrap ${chip.className}`}
    >
      {chip.label}
    </span>
  );
}

export function StatcastChips({
  ev,
  la,
  batSpeed,
}: {
  ev: number | null;
  la: number | null;
  batSpeed: number | null;
}) {
  const chips = chipsForAtBat(ev, la, batSpeed);
  if (chips.length === 0) return null;
  return (
    <span className="inline-flex gap-1 align-middle ml-1.5">
      {chips.map((c) => (
        <Chip key={c.key} chip={c} />
      ))}
    </span>
  );
}

export function StatcastLegend({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-fg-subtle ${className}`}
    >
      {STATCAST_CHIPS.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1">
          <Chip chip={c} />
          <span>{c.desc}</span>
        </span>
      ))}
    </div>
  );
}
