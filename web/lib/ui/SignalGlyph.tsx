import { cn } from './cn';

// Matches lib/signals.ts exports — 7 signals, uppercase.
export type Signal =
  | 'HOT'
  | 'COLD'
  | 'DUE'
  | 'FADE'
  | 'STREAK'
  | 'SLUMP'
  | 'LONGSHOT';

interface Spec {
  glyph: string;
  toneClass: string;
  label: string;
}

// Tone mapping locked in plan §15.9:
//   warn  → HOT
//   neg   → COLD, SLUMP
//   brand → DUE, FADE  (regression-flagging, neutral attention)
//   info  → STREAK, LONGSHOT
const SPECS: Record<Signal, Spec> = {
  HOT:      { glyph: '▲', toneClass: 'text-warn',  label: 'Hot streak' },
  COLD:     { glyph: '▼', toneClass: 'text-neg',   label: 'Cold streak' },
  DUE:      { glyph: '◆', toneClass: 'text-brand', label: 'Regression upside' },
  FADE:     { glyph: '◇', toneClass: 'text-brand', label: 'Regression downside' },
  STREAK:   { glyph: '◀', toneClass: 'text-info',  label: 'Hit streak' },
  SLUMP:    { glyph: '▶', toneClass: 'text-neg',   label: 'Miss streak' },
  LONGSHOT: { glyph: '✦', toneClass: 'text-info',  label: 'Longshot value' },
};

export interface SignalGlyphProps {
  signal: Signal;
  showLabel?: boolean;
  className?: string;
}

export function SignalGlyph({ signal, showLabel = false, className }: SignalGlyphProps) {
  const spec = SPECS[signal];
  return (
    <span
      title={spec.label}
      className={cn('inline-flex items-center gap-1 leading-none', spec.toneClass, className)}
      aria-label={spec.label}
    >
      <span aria-hidden="true">{spec.glyph}</span>
      {showLabel && <span className="text-[10px] font-medium tracking-wide uppercase">{signal}</span>}
    </span>
  );
}
