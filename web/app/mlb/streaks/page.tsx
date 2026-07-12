import { Suspense } from "react";
import MlbStreaksBoard from "./MlbStreaksBoard";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

export default async function MlbStreaksPage() {
  if (!(await isPageVisible("page.mlb.streaks"))) {
    return <ComingSoon label="MLB Streaks" />;
  }
  return (
    <Suspense
      fallback={
        <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
      }
    >
      <MlbStreaksBoard />
    </Suspense>
  );
}
