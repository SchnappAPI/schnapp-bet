import { cn } from './cn';

export interface PulseDotProps {
  tone?: 'live' | 'idle' | 'offline';
  className?: string;
}

const toneClasses = {
  live: 'bg-neg',
  idle: 'bg-fg-subtle',
  offline: 'bg-fg-disabled',
};

export function PulseDot({ tone = 'live', className }: PulseDotProps) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)} aria-hidden="true">
      {tone === 'live' && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neg opacity-60" />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', toneClasses[tone])} />
    </span>
  );
}
