import { Suspense } from "react";
import GamePageInner from "./GamePageInner";
import ComingSoon from "@/components/ComingSoon";
import { isPageVisible } from "@/lib/feature-flags";

type Props = { params: Promise<{ gameId: string }> };

export default async function GamePage({ params }: Props) {
  if (!(await isPageVisible("page.nba.games")))
    return <ComingSoon label="Game" />;
  const { gameId } = await params;
  return (
    <Suspense
      fallback={<div className="p-4 text-sm text-fg-subtle">Loading...</div>}
    >
      <GamePageInner gameId={gameId} />
    </Suspense>
  );
}
