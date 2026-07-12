import { Suspense } from "react";
import MlbTransparency from "./MlbTransparency";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

export default async function MlbTransparencyPage() {
  if (!(await isPageVisible("page.mlb.transparency"))) {
    return <ComingSoon label="MLB Transparency" />;
  }
  return (
    <Suspense
      fallback={
        <div className="px-4 py-3 text-sm text-fg-subtle">Loading...</div>
      }
    >
      <MlbTransparency />
    </Suspense>
  );
}
