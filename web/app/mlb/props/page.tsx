import { Suspense } from "react";
import MlbPropsBoard from "./MlbPropsBoard";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

export default async function MlbPropsPage() {
  if (!(await isPageVisible("page.mlb.props"))) {
    return <ComingSoon label="MLB Props" />;
  }
  return (
    <Suspense
      fallback={
        <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
      }
    >
      <MlbPropsBoard />
    </Suspense>
  );
}
