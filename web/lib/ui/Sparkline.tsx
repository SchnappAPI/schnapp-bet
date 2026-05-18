import { cn } from './cn';

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  baseline?: number;
  className?: string;
  ariaLabel?: string;
}

// Compact path-only sparkline. No axes, no dots — pure signal at a glance.
// If `baseline` is given, the line is colored pos above it and neg below it
// via two stacked paths with clipped masks (kept simple here: single line,
// caller can wrap and apply text-{tone} via className).
export function Sparkline({
  data,
  width = 60,
  height = 16,
  baseline,
  className,
  ariaLabel,
}: SparklineProps) {
  if (data.length === 0) {
    return <span className={cn('inline-block text-fg-disabled', className)} aria-hidden="true">—</span>;
  }

  const min = Math.min(...data, baseline ?? Infinity);
  const max = Math.max(...data, baseline ?? -Infinity);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const path = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('inline-block align-middle', className)}
      role="img"
      aria-label={ariaLabel ?? 'Trend'}
    >
      {baseline !== undefined && (
        <line
          x1={0}
          x2={width}
          y1={height - ((baseline - min) / range) * height}
          y2={height - ((baseline - min) / range) * height}
          stroke="currentColor"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.3}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
