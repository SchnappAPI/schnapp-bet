import type { HTMLAttributes } from 'react';
import { cn } from './cn';

type Tone =
  | 'neutral'
  | 'pos'
  | 'neg'
  | 'warn'
  | 'info'
  | 'brand'
  | 'sport-nba'
  | 'sport-mlb'
  | 'sport-nfl'
  | 'sport-lol';

type Size = 'xs' | 'sm';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: Size;
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface text-fg-muted border-border',
  pos: 'bg-pos-muted text-pos border-pos/30',
  neg: 'bg-neg-muted text-neg border-neg/30',
  warn: 'bg-warn-muted text-warn border-warn/30',
  info: 'bg-info-muted text-info border-info/30',
  brand: 'bg-brand-muted text-brand border-brand/30',
  'sport-nba': 'bg-sport-nba/10 text-sport-nba border-sport-nba/30',
  'sport-mlb': 'bg-sport-mlb/10 text-sport-mlb border-sport-mlb/30',
  'sport-nfl': 'bg-sport-nfl/10 text-sport-nfl border-sport-nfl/30',
  'sport-lol': 'bg-sport-lol/10 text-sport-lol border-sport-lol/30',
};

const sizeClasses: Record<Size, string> = {
  xs: 'h-4 px-1 text-[10px] leading-none tracking-wide',
  sm: 'h-5 px-1.5 text-[11px] leading-none tracking-wide',
};

export function Chip({
  tone = 'neutral',
  size = 'xs',
  className,
  ...props
}: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-sm border font-medium uppercase',
        toneClasses[tone],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
