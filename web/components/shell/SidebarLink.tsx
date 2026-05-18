'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/ui/cn';

export interface SidebarLinkProps {
  href: string;
  icon?: ReactNode;
  label: string;
  // For routes where activeness depends on a query param (e.g., /mlb?view=ev)
  // pass the query key + value to compare against.
  matchSearchKey?: string;
  matchSearchValue?: string;
  // When the parent sidebar is collapsed, only icon + tooltip render.
  collapsed?: boolean;
  // Sub-link styling (indent + smaller text).
  nested?: boolean;
  // Disable + dim (e.g., NFL "soon").
  disabled?: boolean;
  // Trailing slot (e.g., a "soon" chip).
  trailing?: ReactNode;
}

export function SidebarLink({
  href,
  icon,
  label,
  matchSearchKey,
  matchSearchValue,
  collapsed = false,
  nested = false,
  disabled = false,
  trailing,
}: SidebarLinkProps) {
  const pathname = usePathname() ?? '';
  const search = useSearchParams();

  // Active when pathname matches and (if a search param is required) it matches too.
  // Pathname match is exact for top-level links and prefix-aware for nested ones.
  const pathOnlyHref = href.split('?')[0];
  const pathActive = pathname === pathOnlyHref;
  let active = pathActive;
  if (active && matchSearchKey) {
    const v = search?.get(matchSearchKey);
    active = (matchSearchValue == null && !v) || v === matchSearchValue;
  }

  const inner = (
    <span
      className={cn(
        'flex w-full items-center gap-2 rounded px-2',
        nested ? 'h-7 text-body' : 'h-8 text-body',
        nested && !collapsed && 'pl-7',
        active
          ? 'bg-brand-muted text-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        disabled && 'pointer-events-none text-fg-disabled',
        collapsed && 'justify-center px-0'
      )}
    >
      {icon && (
        <span className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center', active && 'text-brand')}>
          {icon}
        </span>
      )}
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && trailing}
    </span>
  );

  if (disabled) return <span title={label}>{inner}</span>;

  return (
    <Link href={href} title={label} aria-current={active ? 'page' : undefined}>
      {inner}
    </Link>
  );
}
