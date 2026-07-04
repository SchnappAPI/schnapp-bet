"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { SlateGame } from "@/app/api/mlb/research/slate/route";

// Slicer row for /mlb/research, URL-search-param driven like
// web/components/nba/PlayerLogFilters.tsx: game selector, date-range
// chips, pitcher-hand toggle, AB-number chips.

export const RANGE_OPTIONS: {
  key: string;
  label: string;
  days: number | null;
}[] = [
  { key: "l7", label: "L7", days: 7 },
  { key: "l14", label: "L14", days: 14 },
  { key: "l30", label: "L30", days: 30 },
  { key: "season", label: "Season", days: null },
];

const FILTER_KEYS = ["range", "hand", "abNum"] as const;

export default function ResearchFilters({
  basePath,
  games,
  selectedGamePk,
}: {
  basePath: string;
  games: SlateGame[];
  selectedGamePk: number | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const range = sp.get("range") ?? "season";
  const hand = sp.get("hand");
  const abNum = sp.get("abNum");

  function writeParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${basePath}?${next.toString()}`);
  }

  const activeCount = FILTER_KEYS.reduce((n, k) => {
    if (k === "range") return n;
    const v = sp.get(k);
    return v != null && v !== "" ? n + 1 : n;
  }, 0);

  return (
    <div className="border-b border-border bg-surface px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-disabled uppercase tracking-wider text-[10px]">
          Game
        </span>
        {games.map((g) => (
          <Chip
            key={g.gamePk}
            active={g.gamePk === selectedGamePk}
            onClick={() => writeParams({ gamePk: String(g.gamePk) })}
            label={g.gameDisplay}
          />
        ))}
        {games.length === 0 && (
          <span className="text-fg-subtle">No games on this date.</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-fg-disabled uppercase tracking-wider text-[10px]">
          Range
        </span>
        <div className="flex overflow-hidden rounded border border-border">
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => writeParams({ range: opt.key })}
                className={[
                  "px-2.5 py-1 font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-brand text-fg"
                    : "bg-surface text-fg-subtle hover:bg-surface-hover",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <span className="text-fg-disabled uppercase tracking-wider text-[10px]">
          SP Hand
        </span>
        <Chip
          active={hand === "L"}
          onClick={() => writeParams({ hand: hand === "L" ? null : "L" })}
          label="vs LHP"
        />
        <Chip
          active={hand === "R"}
          onClick={() => writeParams({ hand: hand === "R" ? null : "R" })}
          label="vs RHP"
        />

        <span className="text-fg-disabled uppercase tracking-wider text-[10px]">
          AB #
        </span>
        <div className="flex items-center gap-1">
          {["1", "2", "3", "4", "5", "6"].map((n) => (
            <Chip
              key={n}
              active={abNum === n}
              onClick={() => writeParams({ abNum: abNum === n ? null : n })}
              label={n}
              compact
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-fg-disabled">
            {activeCount > 0
              ? `${activeCount} filter${activeCount === 1 ? "" : "s"}`
              : "No filters"}
          </span>
          {activeCount > 0 && (
            <button
              onClick={() => writeParams({ hand: null, abNum: null })}
              className="text-fg-disabled hover:text-fg-subtle underline"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
  compact = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        compact ? "px-1.5 py-0.5" : "px-2.5 py-1",
        "rounded font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-brand text-fg"
          : "bg-surface text-fg-subtle hover:bg-surface-hover border border-border",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
