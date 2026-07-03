import { Suspense } from 'react';
import MlbGradesPageInner from './MlbGradesPageInner';
import ComingSoon from '@/components/ComingSoon';
import { isPageVisible } from '@/lib/feature-flags';

export default async function MlbGradesPage() {
  if (!(await isPageVisible('page.mlb.grades'))) return <ComingSoon label="At a Glance" />;

  return (
    <Suspense fallback={<div className="p-4 text-sm text-fg-subtle">Loading...</div>}>
      <MlbGradesPageInner />
    </Suspense>
  );
}
