import { Suspense } from "react";
import MlbHardHitLive from "../MlbHardHitLive";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

export default async function MlbLivePage() {
  if (!(await isPageVisible("page.mlb.live"))) {
    return <ComingSoon label="MLB Live" />;
  }
  return (
    <Suspense
      fallback={
        <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
      }
    >
      <MlbHardHitLive />
    </Suspense>
  );
}
