"use client";

import { useEffect, useState } from "react";
import PropMatrix, { type MatrixRow } from "@/components/PropMatrix";

interface Props {
  gameId: string;
  selectedDate: string;
}

export default function PropsSection({ gameId, selectedDate }: Props) {
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/grades?date=${selectedDate}&gameId=${gameId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setRows(data.grades ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gameId, selectedDate]);

  if (loading) {
    return <div className="px-4 py-6 text-sm text-fg-subtle">Loading...</div>;
  }
  if (error) {
    return <div className="px-4 py-6 text-sm text-neg">Error: {error}</div>;
  }
  if (!rows.length) {
    return (
      <div className="px-4 py-6 text-sm text-fg-subtle">
        No props graded for this game.
      </div>
    );
  }
  return (
    <PropMatrix rows={rows} gradeDate={selectedDate} outcomeFilter="Over" />
  );
}
