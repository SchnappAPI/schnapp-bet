"use client";

import { useEffect, useState } from "react";

// Small pulse dot next to the sidebar "Live" link when an MLB game is in
// progress. Polls the lightweight /api/mlb-live-status (one server-cached
// schedule call) every 60s — never the heavy hard-hit feed aggregation.

const POLL_MS = 60_000;

export function MlbLiveNavBadge() {
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/mlb-live-status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { live: false }))
        .then((d) => {
          if (!cancelled) setLive(Boolean(d.live));
        })
        .catch(() => {
          // Badge is decorative — fail silently.
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!live) return null;
  return (
    <span
      aria-label="live game in progress"
      title="Live game in progress"
      className="inline-block h-1.5 w-1.5 rounded-full bg-pos animate-pulse"
    />
  );
}
