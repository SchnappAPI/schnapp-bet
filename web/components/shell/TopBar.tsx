'use client';

import { Menu, Rows2, Rows3, Search } from 'lucide-react';
import { Suspense } from 'react';
import { cn } from '@/lib/ui/cn';
import { openCommandPalette } from '@/lib/ui/CommandPalette';
import { Breadcrumb } from './Breadcrumb';
import { PollingPill } from './PollingPill';
import { useShell } from './ShellContext';

export interface TopBarProps {
  todayLabel?: string;
  className?: string;
}

export function TopBar({ todayLabel, className }: TopBarProps) {
  const { toggleSidebar, setOverlayOpen, density, setDensity } = useShell();

  // On mobile (< md) the menu button opens the slide-over. On desktop the
  // sidebar's own collapse toggle handles rail width — but we still expose
  // a button on tablet (md..lg) that toggles the rail. Below md the rail
  // is hidden entirely so the only entry point is the overlay.
  const handleMenuClick = () => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) setOverlayOpen(true);
    else toggleSidebar();
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border bg-canvas/80 backdrop-blur-sm px-3',
        className
      )}
    >
      <button
        type="button"
        onClick={handleMenuClick}
        aria-label="Open navigation"
        className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg lg:hidden"
      >
        <Menu size={16} />
      </button>

      <Suspense fallback={<span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">…</span>}>
        <Breadcrumb />
      </Suspense>

      <div className="flex-1" />

      {/* Search trigger — opens the command palette on click or focus */}
      <button
        type="button"
        onClick={openCommandPalette}
        className={cn(
          'hidden md:flex h-7 max-w-sm flex-1 items-center gap-2 rounded border border-border bg-surface px-2',
          'text-[11px] text-fg-subtle hover:bg-surface-hover hover:border-border-strong',
          'transition-colors duration-fast ease-precise'
        )}
        aria-label="Open command palette"
      >
        <Search size={12} />
        <span className="flex-1 text-left">Search players, games…</span>
        <kbd className="font-mono text-[10px] px-1 py-0.5 border border-border-strong rounded-sm bg-inset text-fg-subtle">⌘K</kbd>
      </button>

      <PollingPill />

      <button
        type="button"
        onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
        aria-label={`Toggle density (currently ${density})`}
        title={`Density: ${density} — click for ${density === 'compact' ? 'comfortable' : 'compact'}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        {density === 'compact' ? <Rows3 size={14} /> : <Rows2 size={14} />}
      </button>

      {todayLabel && (
        <span className="hidden sm:inline-flex h-7 items-center rounded border border-border bg-surface px-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted tabular-nums">
          {todayLabel}
        </span>
      )}
    </header>
  );
}
