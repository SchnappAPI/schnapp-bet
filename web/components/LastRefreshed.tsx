'use client';

interface Props {
  ts: Date | null;
}

export default function LastRefreshed({ ts }: Props) {
  if (!ts) return null;
  const h = ts.getHours();
  const m = ts.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayM = String(m).padStart(2, '0');
  return (
    <span className="text-[10px] text-gray-600 tabular-nums whitespace-nowrap">
      {displayH}:{displayM} {ampm}
    </span>
  );
}
