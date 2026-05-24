"use client";

import { useRouter, useSearchParams } from "next/navigation";

export interface PlayerLogFiltersProps {
  basePath: string;
  upcomingOppAbbr?: string | null;
  hasStartedSignal?: boolean;
}

const RANGE_OPTIONS: { key: string; label: string }[] = [
  { key: "l5", label: "L5" },
  { key: "l10", label: "L10" },
  { key: "l20", label: "L20" },
  { key: "season", label: "Season" },
];

const FILTER_KEYS = [
  "range",
  "vs",
  "vsUpcoming",
  "ha",
  "starter",
  "minGt",
  "wl",
  "rest",
  "b2b",
  "since",
  "until",
] as const;

export default function PlayerLogFilters({
  basePath,
  upcomingOppAbbr,
  hasStartedSignal = true,
}: PlayerLogFiltersProps) {
  const router = useRouter();
  const sp = useSearchParams();

  const range = sp.get("range") ?? "season";
  const vs = sp.get("vs");
  const vsUpcoming = sp.get("vsUpcoming") === "1";
  const ha = sp.get("ha");
  const starter = sp.get("starter");
  const minGt = sp.get("minGt");
  const wl = sp.get("wl");
  const rest = sp.get("rest");
  const b2b = sp.get("b2b") === "1";

  function writeParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${basePath}?${next.toString()}`);
  }

  function clearAll() {
    const next = new URLSearchParams(sp.toString());
    for (const k of FILTER_KEYS) next.delete(k);
    router.replace(
      next.toString() ? `${basePath}?${next.toString()}` : basePath,
    );
  }

  const activeCount = FILTER_KEYS.reduce((n, k) => {
    if (k === "range") return n;
    const v = sp.get(k);
    if (v != null && v !== "" && v !== "0") return n + 1;
    return n;
  }, 0);

  const restBuckets = new Set(
    (rest ?? "").split(",").filter((s) => s.length > 0),
  );

  function toggleRestBucket(bucket: string) {
    const next = new Set(restBuckets);
    if (next.has(bucket)) next.delete(bucket);
    else next.add(bucket);
    writeParams({ rest: next.size ? [...next].join(",") : null, b2b: null });
  }

  return (
    <div className="border-b border-border bg-surface px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
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

        <div className="ml-auto flex items-center gap-2">
          <span className="text-fg-disabled">
            {activeCount > 0
              ? `${activeCount} filter${activeCount === 1 ? "" : "s"}`
              : "No filters"}
          </span>
          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="text-fg-disabled hover:text-fg-subtle underline"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-fg-disabled uppercase tracking-wider text-[10px]">
          Splits
        </span>

        {upcomingOppAbbr && (
          <Chip
            active={vsUpcoming}
            onClick={() =>
              writeParams({ vsUpcoming: vsUpcoming ? null : "1", vs: null })
            }
            label={`vs Upcoming (${upcomingOppAbbr})`}
          />
        )}

        <input
          type="text"
          value={vs ?? ""}
          maxLength={3}
          placeholder="vs TEAM"
          onChange={(e) =>
            writeParams({
              vs: e.target.value.toUpperCase() || null,
              vsUpcoming: null,
            })
          }
          className="w-20 rounded border border-border bg-surface px-2 py-1 uppercase tracking-wider text-fg placeholder:text-fg-disabled focus:outline-none focus:border-brand"
        />

        <Chip
          active={ha === "home"}
          onClick={() => writeParams({ ha: ha === "home" ? null : "home" })}
          label="Home"
        />
        <Chip
          active={ha === "away"}
          onClick={() => writeParams({ ha: ha === "away" ? null : "away" })}
          label="Road"
        />

        {hasStartedSignal && (
          <>
            <Chip
              active={starter === "1"}
              onClick={() =>
                writeParams({ starter: starter === "1" ? null : "1" })
              }
              label="Starter"
            />
            <Chip
              active={starter === "0"}
              onClick={() =>
                writeParams({ starter: starter === "0" ? null : "0" })
              }
              label="Bench"
            />
          </>
        )}

        <label className="flex items-center gap-1 text-fg-subtle">
          <span className="text-fg-disabled">Min &gt;</span>
          <input
            type="number"
            min={0}
            max={60}
            value={minGt ?? ""}
            placeholder="—"
            onChange={(e) => writeParams({ minGt: e.target.value || null })}
            className="w-12 rounded border border-border bg-surface px-1.5 py-0.5 tabular-nums text-fg focus:outline-none focus:border-brand"
          />
        </label>

        <Chip
          active={wl === "w"}
          onClick={() => writeParams({ wl: wl === "w" ? null : "w" })}
          label="W"
        />
        <Chip
          active={wl === "l"}
          onClick={() => writeParams({ wl: wl === "l" ? null : "l" })}
          label="L"
        />

        <Chip
          active={b2b}
          onClick={() => writeParams({ b2b: b2b ? null : "1", rest: null })}
          label="B2B"
        />

        <div className="flex items-center gap-1">
          <span className="text-fg-disabled">Rest</span>
          {["0", "1", "2", "3"].map((b) => (
            <Chip
              key={b}
              active={restBuckets.has(b)}
              onClick={() => toggleRestBucket(b)}
              label={b === "3" ? "3+" : b}
              compact
            />
          ))}
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
