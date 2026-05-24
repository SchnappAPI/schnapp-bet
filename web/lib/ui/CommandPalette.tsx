"use client";

import { Command } from "cmdk";
import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { cn } from "./cn";

export interface CommandPaletteProps {
  children?: ReactNode;
  placeholder?: string;
}

interface SearchResponse {
  players: Array<{
    id: number;
    name: string;
    team_abbr: string | null;
    sport: "nba" | "mlb";
  }>;
  games: Array<{
    id: string;
    label: string;
    sport: "nba" | "mlb";
    date: string;
  }>;
}

// Global ⌘K / Ctrl+K palette. Wraps cmdk with our token styling.
// Children are <Command.Group>...<Command.Item>...</Command.Item></Command.Group> blocks.
// Open state is managed here via the global hotkey + Escape; consumers can
// also open it imperatively via the exported `openCommandPalette()` event.
const OPEN_EVENT = "schnapp:open-command-palette";

export function openCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  }
}

export function CommandPalette({
  children,
  placeholder = "Search players, games, actions…",
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Reset query whenever palette closes so the next open starts clean.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const trimmed = query.trim();
  const swrKey =
    open && trimmed.length >= 2
      ? `/api/search?q=${encodeURIComponent(trimmed)}&types=players,games&limit=8`
      : null;
  const { data } = useSWR<SearchResponse>(swrKey, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 250,
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/70 pt-[15vh] backdrop-blur-sm"
      onClick={(e: React.MouseEvent) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="presentation"
    >
      <Command
        label="Command palette"
        loop
        className={cn(
          "w-full max-w-xl rounded-lg border border-border-strong bg-surface shadow-pop",
          "overflow-hidden font-sans",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-fg-subtle"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            className="flex-1 bg-transparent py-3 text-body text-fg placeholder:text-fg-subtle outline-none"
          />
          <kbd className="font-mono text-[10px] px-1 py-0.5 border border-border-strong rounded-sm bg-inset text-fg-subtle">
            ESC
          </kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-body text-fg-subtle">
            No results.
          </Command.Empty>
          {data?.players?.length ? (
            <CommandGroup heading="Players">
              {data.players.map((p) => (
                <CommandItem
                  key={`player-${p.sport}-${p.id}`}
                  value={`player ${p.name} ${p.team_abbr ?? ""} ${p.sport}`}
                  onSelect={() => {
                    setOpen(false);
                    window.location.href =
                      p.sport === "nba"
                        ? `/nba/player/${p.id}`
                        : `/mlb/player/${p.id}`;
                  }}
                >
                  <span className="font-mono text-data text-fg">{p.name}</span>
                  {p.team_abbr && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                      {p.team_abbr} · {p.sport.toUpperCase()}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {data?.games?.length ? (
            <CommandGroup heading="Games">
              {data.games.map((g) => (
                <CommandItem
                  key={`game-${g.sport}-${g.id}`}
                  value={`game ${g.label} ${g.sport}`}
                  onSelect={() => {
                    setOpen(false);
                    window.location.href =
                      g.sport === "nba"
                        ? `/nba?gameId=${encodeURIComponent(g.id)}&date=${g.date}`
                        : `/mlb/game/${g.id}`;
                  }}
                >
                  <span className="font-mono text-data text-fg">{g.label}</span>
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
                    {g.sport.toUpperCase()}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {children}
        </Command.List>
      </Command>
    </div>
  );
}

// Styled wrappers consumers use to build the palette content.
export const CommandGroup = Command.Group;

export function CommandItem({
  children,
  onSelect,
  value,
  shortcut,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  value?: string;
  shortcut?: string;
  className?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-body text-fg-muted",
        "aria-selected:bg-brand-muted aria-selected:text-fg",
        className,
      )}
    >
      <span className="flex items-center gap-2 truncate">{children}</span>
      {shortcut && (
        <kbd className="font-mono text-[10px] px-1 py-0.5 border border-border rounded-sm bg-inset text-fg-subtle">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
