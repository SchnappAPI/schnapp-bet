import { Suspense } from 'react';
import NflPageInner from './NflPageInner';
import ComingSoon from '@/components/ComingSoon';
import { isPageVisible } from '@/lib/feature-flags';

export default async function NflPage() {
  if (!(await isPageVisible('sport.nfl'))) return <ComingSoon label="NFL" />;
  return (
    <Suspense fallback={<div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>}>
      <NflPageInner />
    </Suspense>
  );
}
