import { Suspense } from "react";
import MlbResearchView from "./MlbResearchView";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

export default async function MlbResearchPage() {
  if (!(await isPageVisible("page.mlb.research"))) {
    return <ComingSoon label="MLB Research" />;
  }
  return (
    <Suspense
      fallback={
        <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
      }
    >
      <MlbResearchView />
    </Suspense>
  );
}
