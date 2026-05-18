'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/ui/cn';
import { PulseDot } from '@/lib/ui/PulseDot';

export interface PollingPillProps {
  // Cadence in seconds. Default 30 to align with the dominant SWR refresh.
  intervalSec?: number;
  className?: string;
}

// Visual countdown tied to the dominant polling cadence on the page.
// Phase 1 implementation: pure visual timer (no real SWR integration).
// When SWR fetchers exist, they will reset this via a custom event.
export function PollingPill({ intervalSec = 30, className }: PollingPillProps) {
  const [secondsLeft, setSecondsLeft] = useState(intervalSec);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? intervalSec : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [intervalSec, online]);

  if (!online) {
    return (
      <span
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded border border-border bg-surface px-2 text-[11px]',
          'text-fg-subtle font-mono tabular-nums',
          className
        )}
        title="Offline — showing cached data"
      >
        <PulseDot tone="offline" />
        <span className="uppercase tracking-wider">Offline</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded border border-border bg-surface px-2 text-[11px]',
        'text-fg-muted font-mono tabular-nums',
        className
      )}
      title={`Next refresh in ${secondsLeft}s`}
    >
      <PulseDot tone="live" />
      <span className="uppercase tracking-wider text-fg-muted">Live</span>
      <span className="text-fg">{String(secondsLeft).padStart(2, '0')}s</span>
    </span>
  );
}
