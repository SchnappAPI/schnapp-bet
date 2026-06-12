'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isPublicPath } from '@/lib/public-paths';
import { CommandPalette, CommandGroup, CommandItem } from '@/lib/ui/CommandPalette';
import { cn } from '@/lib/ui/cn';
import { useAuth } from '@/lib/auth-context';
import { ShellProvider, useShell } from './ShellContext';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export interface ShellProps {
  children: ReactNode;
}

// Outer wrapper provides the context; inner content reads it.
export function Shell({ children }: ShellProps) {
  const pathname = usePathname();
  // Public, full-bleed routes render with no shell chrome.
  if (isPublicPath(pathname)) return <>{children}</>;
  return (
    <ShellProvider>
      <ShellInner>{children}</ShellInner>
    </ShellProvider>
  );
}

function ShellInner({ children }: ShellProps) {
  const { density, setDensity, toggleSidebar, overlayOpen, setOverlayOpen } = useShell();
  const { isAdmin } = useAuth();
  const [mobile, setMobile] = useState(false);

  // Track viewport so the sidebar can render as overlay on small screens.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Close the mobile overlay automatically when crossing back to desktop
  // viewport — leaving it open would render the rail twice.
  useEffect(() => {
    if (!mobile && overlayOpen) setOverlayOpen(false);
  }, [mobile, overlayOpen, setOverlayOpen]);

  // Today's date for the top-bar chip.
  const today = new Date();
  const todayLabel = today.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).toUpperCase();

  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      {/* Desktop / tablet rail */}
      {!mobile && <Sidebar isAdmin={isAdmin} variant="rail" />}

      {/* Mobile slide-over */}
      {mobile && overlayOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          onClick={(e: React.MouseEvent) => { if (e.target === e.currentTarget) setOverlayOpen(false); }}
          role="presentation"
        >
          <div className="bg-canvas/70 absolute inset-0 backdrop-blur-sm" />
          <div className="relative h-full w-56">
            <Sidebar isAdmin={isAdmin} variant="overlay" onNavigate={() => setOverlayOpen(false)} />
          </div>
        </div>
      )}

      <div className={cn('flex min-w-0 flex-1 flex-col')}>
        <TopBar todayLabel={todayLabel} />
        <main className="flex-1 overflow-x-hidden">{children}</main>
      </div>

      {/* Global command palette — mounted once, opened from anywhere. */}
      <CommandPalette>
        <CommandGroup heading="Navigate">
          <CommandItem value="today" shortcut="G H" onSelect={() => (window.location.href = '/')}>
            Today
          </CommandItem>
          <CommandItem value="nba games" onSelect={() => (window.location.href = '/nba')}>
            NBA · Games
          </CommandItem>
          <CommandItem value="nba grades" onSelect={() => (window.location.href = '/nba/grades')}>
            NBA · At-a-Glance
          </CommandItem>
          <CommandItem value="mlb games" onSelect={() => (window.location.href = '/mlb')}>
            MLB · Games
          </CommandItem>
          <CommandItem value="mlb projections" onSelect={() => (window.location.href = '/mlb?view=proj')}>
            MLB · Projections
          </CommandItem>
          <CommandItem value="transparency" onSelect={() => (window.location.href = '/transparency')}>
            Transparency
          </CommandItem>
          <CommandItem value="admin" onSelect={() => (window.location.href = '/admin')}>
            Admin
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem
            value="toggle density"
            onSelect={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
          >
            Toggle density · {density === 'compact' ? 'comfortable' : 'compact'}
          </CommandItem>
          <CommandItem value="toggle sidebar" onSelect={toggleSidebar}>
            Toggle sidebar
          </CommandItem>
        </CommandGroup>
      </CommandPalette>
    </div>
  );
}
