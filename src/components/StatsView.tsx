import { useEffect, useState } from "react";
import { Section } from "./Section";
import {
  getLibraryBreakdown,
  type LibraryBreakdown,
  type BreakdownRow,
} from "../lib/tauri";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: LibraryBreakdown }
  | { kind: "error"; message: string };

// The Stats view replaces the 3-panel library grid when active. It owns its
// own data fetch and re-fetches when `reloadKey` changes so newly added /
// removed releases reflect in the breakdowns without a manual refresh.
export function StatsView({ reloadKey }: { reloadKey: number }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getLibraryBreakdown()
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((e) => {
        if (!cancelled) setState({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (state.kind === "loading") {
    return (
      <div className="rounded-xl bg-panel border border-surface/60 shadow-md p-6 text-sm text-muted">
        loading library breakdown…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="rounded-xl bg-panel border border-alert/60 shadow-md p-6 text-sm text-alert">
        couldn't load breakdown: {state.message}
      </div>
    );
  }

  const { genre, country, year, medium, label } = state.data;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <BreakdownCardScaffold title="Genre" rows={genre} />
      <BreakdownCardScaffold title="Medium" rows={medium} />
      <BreakdownCardScaffold title="Year" rows={year} />
      <BreakdownCardScaffold title="Country" rows={country} />
      <BreakdownCardScaffold
        title="Label"
        rows={label}
        topN={20}
        className="md:col-span-2"
      />
    </div>
  );
}

// Phase 2 placeholder: each card just shows its first N rows as a simple
// value/count list. Phase 4 replaces the body with the real visualisations
// (stacked colour bar for genre/medium, top-N row bars for country/label,
// 2-layer sparkline for year). Shape and contract stay the same.
function BreakdownCardScaffold({
  title,
  rows,
  topN,
  className,
}: {
  title: string;
  rows: BreakdownRow[];
  topN?: number;
  className?: string;
}) {
  const display = topN ? rows.slice(0, topN) : rows;
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <Section
      title={title}
      right={
        <span className="text-xs text-muted font-mono">
          {rows.length} {rows.length === 1 ? "bucket" : "buckets"} ·{" "}
          {total.toLocaleString()} tally
        </span>
      }
      className={className}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted italic">no data yet</p>
      ) : (
        <ul className="text-xs font-mono space-y-1 max-h-[18rem] overflow-y-auto">
          {display.map((r) => (
            <li
              key={r.value}
              className="flex justify-between gap-3 tabular-nums"
            >
              <span className="text-fg/80 truncate">{r.value}</span>
              <span className="text-accent shrink-0">
                {r.count.toLocaleString()}
              </span>
            </li>
          ))}
          {topN && rows.length > topN && (
            <li className="text-muted italic pt-1">
              … +{rows.length - topN} more
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}
