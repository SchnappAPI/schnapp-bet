import { Suspense } from "react";
import MlbPlayerPageInner from "./MlbPlayerPageInner";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

type Props = { params: Promise<{ playerId: string }> };

export default async function MlbPlayerPage({ params }: Props) {
  if (!(await isPageVisible("sport.mlb"))) return <ComingSoon label="MLB" />;
  const { playerId } = await params;
  return (
    <Suspense
      fallback={<div className="p-4 text-sm text-fg-subtle">Loading...</div>}
    >
      <MlbPlayerPageInner playerId={playerId} />
    </Suspense>
  );
}
