import { Suspense } from 'react';
import GradesPageInner from './GradesPageInner';
import PropMatrixV2 from '@/components/nba/PropMatrix';
import ComingSoon from '@/components/ComingSoon';
import { isPageVisible } from '@/lib/feature-flags';

interface PageProps {
  searchParams: Promise<{ v?: string; date?: string }>;
}

export default async function GradesPage({ searchParams }: PageProps) {
  if (!(await isPageVisible('page.nba.grades'))) return <ComingSoon label="At a Glance" />;

  const sp = await searchParams;
  if (sp.v === '1') {
    return (
      <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading...</div>}>
        <GradesPageInner />
      </Suspense>
    );
  }

  return (
    <div className="p-4">
      <PropMatrixV2 date={sp.date} />
    </div>
  );
}
