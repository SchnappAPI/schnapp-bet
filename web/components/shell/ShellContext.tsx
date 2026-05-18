'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Density = 'compact' | 'comfortable';

interface ShellState {
  // Desktop rail: collapsed (icons-only) vs expanded (icons + labels).
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  // Mobile slide-over: hidden vs visible. Independent of the rail state.
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
  density: Density;
  setDensity: (d: Density) => void;
}

const ShellCtx = createContext<ShellState | null>(null);

const SIDEBAR_KEY = 'schnapp.sidebar';
const DENSITY_KEY = 'schnapp.density';

export function ShellProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpenState] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [density, setDensityState] = useState<Density>('compact');

  // Hydrate from localStorage post-mount to avoid SSR/CSR mismatch.
  useEffect(() => {
    const sb = localStorage.getItem(SIDEBAR_KEY);
    if (sb !== null) setSidebarOpenState(sb === 'true');
    const d = localStorage.getItem(DENSITY_KEY);
    if (d === 'comfortable' || d === 'compact') setDensityState(d);
  }, []);

  // Mirror density to <body data-density> for CSS to read.
  useEffect(() => {
    document.body.setAttribute('data-density', density);
  }, [density]);

  function setSidebarOpen(open: boolean) {
    setSidebarOpenState(open);
    localStorage.setItem(SIDEBAR_KEY, String(open));
  }

  function setDensity(d: Density) {
    setDensityState(d);
    localStorage.setItem(DENSITY_KEY, d);
  }

  return (
    <ShellCtx.Provider
      value={{
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar: () => setSidebarOpen(!sidebarOpen),
        overlayOpen,
        setOverlayOpen,
        density,
        setDensity,
      }}
    >
      {children}
    </ShellCtx.Provider>
  );
}

export function useShell(): ShellState {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>');
  return ctx;
}
