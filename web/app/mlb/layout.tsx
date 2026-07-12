// web/app/mlb/layout.tsx
import { MlbFilterProvider } from "@/components/mlb/MlbFilterProvider";
import MlbFilterBar from "@/components/mlb/MlbFilterBar";

export default function MlbLayout({ children }: { children: React.ReactNode }) {
  return (
    <MlbFilterProvider>
      <MlbFilterBar />
      {children}
    </MlbFilterProvider>
  );
}
