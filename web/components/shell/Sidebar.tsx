"use client";

import Link from "next/link";
import { ChevronsLeft, ChevronsRight, Home, Lock, Trophy } from "lucide-react";
import { Suspense } from "react";
import { cn } from "@/lib/ui/cn";
import { useShell } from "./ShellContext";
import { SidebarLink } from "./SidebarLink";

export interface SidebarProps {
  isAdmin?: boolean;
  // For mobile: the sidebar can render as a slide-over rather than fixed rail.
  // The parent <Shell> decides which mode to use based on viewport.
  variant?: "rail" | "overlay";
  onNavigate?: () => void;
}

export function Sidebar({
  isAdmin = false,
  variant = "rail",
  onNavigate,
}: SidebarProps) {
  const { sidebarOpen, toggleSidebar } = useShell();
  const collapsed = variant === "rail" && !sidebarOpen;
  // In overlay mode, tapping any link should dismiss the overlay so the page
  // takes focus. The parent passes a closer; SidebarLink has no native onClick
  // hook for routed links, so we delegate via a wrapper div with a capture
  // listener that fires before navigation.
  const onLinkActivate = variant === "overlay" ? onNavigate : undefined;

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-raised",
        variant === "rail" && "h-screen sticky top-0",
        variant === "overlay" && "h-full",
        collapsed ? "w-12" : "w-56",
        "transition-[width] duration-fast ease-precise",
      )}
      aria-label="Primary navigation"
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-12 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "px-3",
        )}
      >
        <Link href="/" className="flex items-center gap-2 text-fg">
          <span
            aria-hidden
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-brand text-white text-[11px] font-bold font-mono"
          >
            ▣
          </span>
          {!collapsed && (
            <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em]">
              schnapp
            </span>
          )}
        </Link>
      </div>

      {/* Nav scroll area */}
      <Suspense fallback={<div className="flex-1" />}>
        <nav className="flex-1 overflow-y-auto py-2" onClick={onLinkActivate}>
          <div className="px-2">
            <SidebarLink
              href="/"
              icon={<Home size={14} />}
              label="Today"
              collapsed={collapsed}
            />
          </div>

          <SectionLabel collapsed={collapsed}>NBA</SectionLabel>
          <div className="px-2">
            <SidebarLink
              href="/nba"
              icon={<Trophy size={14} className="text-sport-nba" />}
              label="Games"
              collapsed={collapsed}
            />
          </div>

          <SectionLabel collapsed={collapsed}>MLB</SectionLabel>
          <div className="px-2">
            <SidebarLink
              href="/mlb"
              icon={<Trophy size={14} className="text-sport-mlb" />}
              label="Games"
              collapsed={collapsed}
            />
            <SidebarLink
              href="/mlb/grades"
              icon={<Trophy size={14} className="text-sport-mlb" />}
              label="At-a-Glance"
              collapsed={collapsed}
            />
            <SidebarLink
              href="/mlb/research"
              icon={<Trophy size={14} className="text-sport-mlb" />}
              label="Research"
              collapsed={collapsed}
            />
          </div>

          <SectionLabel collapsed={collapsed}>NFL</SectionLabel>
          <div className="px-2">
            <SidebarLink
              href="/nfl"
              icon={<Trophy size={14} className="text-sport-nfl" />}
              label="Games"
              collapsed={collapsed}
            />
          </div>

          {isAdmin && (
            <>
              <div className="my-2 mx-3 border-t border-border-subtle" />
              <div className="px-2">
                <SidebarLink
                  href="/admin"
                  icon={<Lock size={14} />}
                  label="Admin"
                  collapsed={collapsed}
                />
              </div>
            </>
          )}
        </nav>
      </Suspense>

      {/* Footer: collapse toggle (rail only) */}
      {variant === "rail" && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex h-7 w-full items-center gap-2 rounded px-2 text-fg-subtle hover:bg-surface-hover hover:text-fg",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <ChevronsRight size={14} />
            ) : (
              <ChevronsLeft size={14} />
            )}
            {!collapsed && <span className="text-[11px]">Collapse</span>}
          </button>
        </div>
      )}
    </aside>
  );
}

function SectionLabel({
  children,
  collapsed,
}: {
  children: React.ReactNode;
  collapsed: boolean;
}) {
  if (collapsed)
    return <div className="my-2 mx-3 border-t border-border-subtle" />;
  return (
    <div className="px-4 pt-3 pb-1 text-micro uppercase text-fg-subtle">
      {children}
    </div>
  );
}
