"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter, useSearchParams } from "next/navigation";

export interface PlayerLogFiltersMobileProps {
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

export default function PlayerLogFiltersMobile({
  basePath,
  upcomingOppAbbr,
  hasStartedSignal = true,
}: PlayerLogFiltersMobileProps) {
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
    <Dialog.Root>
      <div className="border-b border-border bg-surface px-4 py-3 flex items-center gap-3">
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
                  "px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
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

        <Dialog.Trigger asChild>
          <button
            className={[
              "ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors",
              activeCount > 0
                ? "border-brand text-brand bg-brand-muted"
                : "border-border text-fg-subtle hover:border-border-strong hover:text-fg-muted",
            ].join(" ")}
          >
            <span>Splits</span>
            {activeCount > 0 && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-brand text-fg text-[10px] font-semibold leading-none">
                {activeCount}
              </span>
            )}
            <span className="text-[10px]">&#9662;</span>
          </button>
        </Dialog.Trigger>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
        <Dialog.Content
          className="fixed bottom-0 left-0 right-0 z-50 bg-canvas rounded-t-2xl max-h-[85vh] overflow-y-auto focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-canvas z-10">
            <Dialog.Title className="text-sm font-semibold text-fg">
              Splits
              {activeCount > 0 && (
                <span className="ml-2 text-xs text-brand font-normal">
                  {activeCount} active
                </span>
              )}
            </Dialog.Title>
            <div className="flex items-center gap-4">
              {activeCount > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-fg-disabled hover:text-fg-subtle underline"
                >
                  Clear all
                </button>
              )}
              <Dialog.Close asChild>
                <button className="text-fg-disabled hover:text-fg text-xl leading-none px-1">
                  &#215;
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="px-4 py-5 space-y-5">
            <FilterRow label="Opponent">
              {upcomingOppAbbr && (
                <Chip
                  active={vsUpcoming}
                  onClick={() =>
                    writeParams({
                      vsUpcoming: vsUpcoming ? null : "1",
                      vs: null,
                    })
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
                className="w-24 rounded border border-border bg-surface px-2 py-1.5 uppercase tracking-wider text-fg text-xs placeholder:text-fg-disabled focus:outline-none focus:border-brand"
              />
            </FilterRow>

            <FilterRow label="Location">
              <Chip
                active={ha === "home"}
                onClick={() =>
                  writeParams({ ha: ha === "home" ? null : "home" })
                }
                label="Home"
              />
              <Chip
                active={ha === "away"}
                onClick={() =>
                  writeParams({ ha: ha === "away" ? null : "away" })
                }
                label="Road"
              />
            </FilterRow>

            {hasStartedSignal && (
              <FilterRow label="Role">
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
              </FilterRow>
            )}

            <FilterRow label="Result">
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
            </FilterRow>

            <FilterRow label="Rest">
              <Chip
                active={b2b}
                onClick={() =>
                  writeParams({ b2b: b2b ? null : "1", rest: null })
                }
                label="B2B"
              />
              {["0", "1", "2", "3"].map((b) => (
                <Chip
                  key={b}
                  active={restBuckets.has(b)}
                  onClick={() => toggleRestBucket(b)}
                  label={b === "0" ? "B2B (0d)" : b === "3" ? "3d+" : `${b}d`}
                />
              ))}
            </FilterRow>

            <FilterRow label="Min >">
              <input
                type="number"
                min={0}
                max={60}
                value={minGt ?? ""}
                placeholder="—"
                onChange={(e) => writeParams({ minGt: e.target.value || null })}
                className="w-16 rounded border border-border bg-surface px-2 py-1.5 tabular-nums text-fg text-xs focus:outline-none focus:border-brand"
              />
              <span className="text-xs text-fg-disabled">minutes</span>
            </FilterRow>
          </div>

          <div className="px-4 pb-8 pt-1">
            <Dialog.Close asChild>
              <button className="w-full py-3 bg-brand text-fg text-sm font-semibold rounded-lg transition-colors hover:bg-brand-hover">
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-fg-disabled uppercase tracking-wider text-[10px] w-16 shrink-0 pt-1.5">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1.5 text-xs rounded font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-brand text-fg"
          : "bg-surface text-fg-subtle hover:bg-surface-hover border border-border",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
