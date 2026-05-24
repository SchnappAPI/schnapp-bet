import { Suspense } from "react";
import MlbGamePageInner from "./MlbGamePageInner";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

type Props = { params: Promise<{ gamePk: string }> };

export default async function MlbGamePage({ params }: Props) {
  if (!(await isPageVisible("sport.mlb"))) return <ComingSoon label="MLB" />;
  const { gamePk } = await params;
  return (
    <Suspense
      fallback={<div className="p-4 text-sm text-fg-subtle">Loading...</div>}
    >
      <MlbGamePageInner gamePk={gamePk} />
    </Suspense>
  );
}
