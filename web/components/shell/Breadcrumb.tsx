'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/ui/cn';

// Map raw URL segments / query views to display labels.
const LABELS: Record<string, string> = {
  nba: 'NBA',
  mlb: 'MLB',
  nfl: 'NFL',
  lol: 'LoL',
  grades: 'At-a-Glance',
  player: 'Player',
  props: 'Props',
  admin: 'Admin',
  transparency: 'Transparency',
};

const MLB_VIEW_LABELS: Record<string, string> = {
  game: 'Games',
  vs: 'Vs',
  ev: 'EV',
  proj: 'Projections',
  player: 'Players',
  pitcher: 'Pitchers',
};

export interface BreadcrumbProps {
  className?: string;
}

export function Breadcrumb({ className }: BreadcrumbProps) {
  const pathname = usePathname() ?? '/';
  const search = useSearchParams();

  if (pathname === '/') {
    return <span className={cn('font-mono text-[11px] uppercase tracking-wider text-fg', className)}>Today</span>;
  }

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: string[] = [];

  for (const seg of segments) {
    // Skip dynamic id segments (uuid-ish or numeric)
    if (/^[0-9]+$/.test(seg) || /^[a-f0-9-]{8,}$/.test(seg)) continue;
    crumbs.push(LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1));
  }

  // MLB view crumb from ?view=
  if (segments[0] === 'mlb') {
    const view = search?.get('view');
    if (view && MLB_VIEW_LABELS[view]) crumbs.push(MLB_VIEW_LABELS[view]);
    else if (!view) crumbs.push('Games');
  }

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider', className)}>
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-fg-disabled">/</span>}
          <span className={cn(i === crumbs.length - 1 ? 'text-fg' : 'text-fg-muted')}>{c}</span>
        </span>
      ))}
    </nav>
  );
}
