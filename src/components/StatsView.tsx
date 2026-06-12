import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

  const { genre, country, year, medium, format, label } = state.data;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {/* Row 1: Medium | Year */}
      <StackedBarCard
        title="Medium"
        rows={medium}
        colorFor={mediumColor}
        displayFor={mediumLabel}
        scalingExponent={1.0}
      />
      <YearCard rows={year} />
      {/* Row 2: Format | Genre */}
      <StackedBarCard
        title="Format"
        rows={format}
        colorFor={formatColor}
        displayFor={formatLabel}
        scalingExponent={1.0}
      />
      <StackedBarCard
        title="Genre"
        rows={genre}
        colorFor={(v) => `rgb(var(--c-g-${v}))`}
        displayFor={genreDisplay}
        scalingExponent={0.7}
      />
      {/* Row 3: Country | Label */}
      <RankedRowsCard
        title="Country"
        rows={country}
        reloadKey={reloadKey}
        scalingExponent={0.7}
      />
      <RankedRowsCard
        title="Label"
        rows={label}
        reloadKey={reloadKey}
      />
    </div>
  );
}

// --- helpers ----------------------------------------------------------------

// Display compound slugs with a slash (`classical-folk` → `classical/folk`).
// Idempotent on non-compound slugs. Mirrors the helper in ReleaseDetail.tsx.
function genreDisplay(slug: string): string {
  return slug.replace(/-/g, "/");
}

function mediumColor(value: string): string {
  switch (value) {
    case "physical":
      return "rgb(var(--c-mauve))";
    case "digital":
      return "rgb(var(--c-digital))";
    default:
      return "rgb(var(--c-muted))";
  }
}

function mediumLabel(value: string): string {
  if (value === "physical") return "Physical";
  if (value === "digital") return "Digital";
  return value;
}

// Tone mapping for the 9 Format buckets. Two semantic anchors (lossless=ok,
// lossy=warn) for the digital tier, then a mauve hue family for vinyl (size
// tiers descending in saturation) and an auburn hue family for the residual
// physical sub-tiers (CD / cassette / box).
function formatColor(value: string): string {
  switch (value) {
    case "lossless":
      return "rgb(var(--c-ok))";
    case "lossy":
      return "rgb(var(--c-warn))";
    case "vinyl_12":
      return "rgb(var(--c-mauve))";
    case "vinyl_10":
      return "rgb(var(--c-mauve) / 0.7)";
    case "vinyl_7":
      return "rgb(var(--c-mauve) / 0.45)";
    case "cd":
      return "rgb(var(--c-auburn))";
    case "cassette":
      return "rgb(var(--c-auburn) / 0.7)";
    case "box":
      return "rgb(var(--c-auburn) / 0.45)";
    case "other_physical":
      return "rgb(var(--c-muted))";
    default:
      return "rgb(var(--c-muted))";
  }
}

function formatLabel(value: string): string {
  switch (value) {
    case "lossless":
      return "Lossless";
    case "lossy":
      return "Lossy";
    case "vinyl_12":
      return "Vinyl 12″";
    case "vinyl_10":
      return "Vinyl 10″";
    case "vinyl_7":
      return "Vinyl 7″";
    case "cd":
      return "CD";
    case "cassette":
      return "Cassette";
    case "box":
      return "Box set";
    case "other_physical":
      return "Other physical";
    default:
      return value;
  }
}

function total(rows: BreakdownRow[]): number {
  return rows.reduce((a, r) => a + r.count, 0);
}

function pct(count: number, totalCount: number): string {
  if (totalCount === 0) return "0%";
  const p = (count / totalCount) * 100;
  return p >= 10 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
}

// --- StackedBarCard (Genre + Medium + Format) -------------------------------

interface StackedBarCardProps {
  title: string;
  rows: BreakdownRow[];
  colorFor: (value: string) => string;
  displayFor?: (value: string) => string;
  // Sub-linear (< 1) softens dominant slugs so the tail stays readable;
  // linear (= 1) is honest for small categorical sets.
  scalingExponent: number;
  className?: string;
}

function StackedBarCard({
  title,
  rows,
  colorFor,
  displayFor = (v) => v,
  scalingExponent,
  className,
}: StackedBarCardProps) {
  const totalCount = total(rows);
  // Cosmetic width allocation — bar segments scale ^k so a dominant slug
  // doesn't crush the tail. Numeric percentages in the legend stay honest.
  const scaled = rows.map((r) => Math.pow(r.count, scalingExponent));
  const scaledSum = scaled.reduce((a, b) => a + b, 0);
  const segments = rows.map((r, i) => ({
    row: r,
    widthPct: scaledSum === 0 ? 0 : (scaled[i] / scaledSum) * 100,
  }));

  return (
    <Section
      title={title}
      right={
        <span className="text-xs text-muted font-mono">
          {totalCount.toLocaleString()} tally
        </span>
      }
      className={className}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted italic">no data yet</p>
      ) : (
        <div className="space-y-3">
          <div
            className="flex h-3 gap-px overflow-hidden rounded-sm bg-surface"
            aria-label={`${title} composition`}
          >
            {segments.map(({ row, widthPct }) => (
              <div
                key={row.value}
                style={{
                  width: `${widthPct}%`,
                  minWidth: "2px",
                  backgroundColor: colorFor(row.value),
                }}
                title={`${displayFor(row.value)}: ${row.count.toLocaleString()} (${pct(row.count, totalCount)})`}
              />
            ))}
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-xs font-mono">
            {rows.map((r) => (
              <li
                key={r.value}
                className="flex items-center gap-2 tabular-nums min-w-0"
              >
                <span
                  className="inline-block w-2 h-2 rounded-sm shrink-0"
                  style={{ backgroundColor: colorFor(r.value) }}
                  aria-hidden="true"
                />
                <span className="text-fg/80 truncate flex-1">
                  {displayFor(r.value)}
                </span>
                <span className="text-accent shrink-0">
                  {r.count.toLocaleString()}
                </span>
                <span className="text-muted shrink-0 w-10 text-right">
                  {pct(r.count, totalCount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// --- RankedRowsCard (Country + Label) ---------------------------------------

const ROWS_PER_PAGE = 12;

interface RankedRowsCardProps {
  title: string;
  rows: BreakdownRow[];
  // Re-fetch trigger from the parent. When it changes (after a refresh /
  // import / publish), the card resets to page 0 so the user doesn't land
  // on a now-invalid trailing page.
  reloadKey: number;
  // Sub-linear (< 1) softens bar widths so a dominant top row doesn't crush
  // the tail's visual readability. Counts and percentages in the row text
  // stay honest; only the bar fill is cosmetically scaled. Default 1.0.
  scalingExponent?: number;
  className?: string;
}

function RankedRowsCard({
  title,
  rows,
  reloadKey,
  scalingExponent = 1.0,
  className,
}: RankedRowsCardProps) {
  const totalCount = total(rows);
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const [page, setPage] = useState(0);

  // Reset to page 0 on reload — the list shape may have changed underneath.
  useEffect(() => {
    setPage(0);
  }, [reloadKey]);

  // Clamp page if rows shrink without a reloadKey bump.
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * ROWS_PER_PAGE;
  const end = Math.min(start + ROWS_PER_PAGE, rows.length);
  const visible = rows.slice(start, end);

  // Bar widths are absolute (relative to the catalogue's #1 row) so that
  // paginating reads honestly — page 2's bars genuinely look smaller than
  // page 1's because they ARE smaller. Sub-linear scaling helps when the
  // head dominates by an order of magnitude.
  const headCount = rows.length > 0 ? rows[0].count : 1;
  const widthPctFor = (count: number) =>
    headCount === 0
      ? 0
      : (Math.pow(count, scalingExponent) /
          Math.pow(headCount, scalingExponent)) *
        100;

  const showPager = totalPages > 1;

  return (
    <Section
      title={title}
      right={
        <span className="text-xs text-muted font-mono">
          {rows.length.toLocaleString()}{" "}
          {rows.length === 1 ? "bucket" : "buckets"} ·{" "}
          {totalCount.toLocaleString()} total
        </span>
      }
      className={className}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted italic">no data yet</p>
      ) : (
        <div className="flex flex-col gap-2 flex-1">
          <ul className="text-xs font-mono space-y-1">
            {visible.map((r, i) => (
              <RankedRow
                key={r.value}
                rank={start + i + 1}
                label={r.value}
                count={r.count}
                totalCount={totalCount}
                widthPct={widthPctFor(r.count)}
              />
            ))}
          </ul>
          {showPager && (
            <div
              className="mt-auto flex items-center justify-end gap-2
                         pt-1 text-[10px] font-mono text-muted tabular-nums"
            >
              <span>
                {start + 1}–{end} of {rows.length.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                title="Previous page"
                aria-label="Previous page"
                className="p-1 rounded hover:bg-surface
                           disabled:opacity-30 disabled:cursor-not-allowed
                           text-muted hover:text-accent transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={safePage >= totalPages - 1}
                title="Next page"
                aria-label="Next page"
                className="p-1 rounded hover:bg-surface
                           disabled:opacity-30 disabled:cursor-not-allowed
                           text-muted hover:text-accent transition-colors"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function RankedRow({
  rank,
  label,
  count,
  totalCount,
  widthPct,
}: {
  rank: number;
  label: string;
  count: number;
  totalCount: number;
  widthPct: number;
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem_2.5rem] items-center gap-2 tabular-nums">
      <span className="text-muted text-right text-[10px]">{rank}.</span>
      <div className="min-w-0">
        <div className="truncate text-fg/85">{label}</div>
        <div className="h-0.5 mt-0.5 rounded-full bg-surface overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-150"
            style={{ width: `${widthPct}%` }}
          />
        </div>
      </div>
      <span className="text-accent text-right shrink-0">
        {count.toLocaleString()}
      </span>
      <span className="text-muted text-right shrink-0">
        {pct(count, totalCount)}
      </span>
    </li>
  );
}

// --- YearCard (sparkline + decade lattice) ----------------------------------

interface YearCardProps {
  rows: BreakdownRow[];
  className?: string;
}

function YearCard({ rows, className }: YearCardProps) {
  const totalCount = total(rows);
  // Parse "1968" → 1968; ignore unparseable rows defensively.
  const parsed: { year: number; count: number }[] = rows
    .map((r) => ({ year: Number(r.value), count: r.count }))
    .filter((r) => Number.isFinite(r.year));

  if (parsed.length === 0) {
    return (
      <Section title="Year" className={className}>
        <p className="text-xs text-muted italic">no data yet</p>
      </Section>
    );
  }

  const minYear = parsed[0].year;
  const maxYear = parsed[parsed.length - 1].year;
  // Densify: fill missing years with count 0 so the sparkline columns line
  // up one-per-year and the decade lattice underneath shares the same width
  // allocation without arithmetic gymnastics.
  const dense: { year: number; count: number }[] = [];
  const lookup = new Map(parsed.map((r) => [r.year, r.count]));
  for (let y = minYear; y <= maxYear; y++) {
    dense.push({ year: y, count: lookup.get(y) ?? 0 });
  }
  const maxCount = Math.max(...dense.map((d) => d.count), 1);

  // Group by decade for the lattice. Each decade segment's flex-grow is
  // proportional to the number of years it spans within [minYear, maxYear].
  const decades = new Map<number, { years: number; count: number }>();
  for (const d of dense) {
    const decade = Math.floor(d.year / 10) * 10;
    const entry = decades.get(decade) ?? { years: 0, count: 0 };
    entry.years += 1;
    entry.count += d.count;
    decades.set(decade, entry);
  }
  const decadeList = Array.from(decades.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([decade, info]) => ({
      decade,
      years: info.years,
      count: info.count,
    }));

  return (
    <Section
      title="Year"
      right={
        <span className="text-xs text-muted font-mono">
          {minYear}–{maxYear} · {totalCount.toLocaleString()} total
        </span>
      }
      className={className}
    >
      <div className="space-y-1">
        {/* Per-year sparkline. Each bar takes one flex column; height ∝
            count, scaled to the busiest year. Empty years render an invisible
            column so the lattice underneath stays aligned. */}
        <div
          className="flex items-end h-12 gap-px"
          aria-label="releases per year"
        >
          {dense.map((d) => (
            <div
              key={d.year}
              className="flex-1 min-w-[2px] bg-accent rounded-sm"
              style={{
                height: `${d.count === 0 ? 0 : (d.count / maxCount) * 100}%`,
              }}
              title={`${d.year}: ${d.count.toLocaleString()}`}
            />
          ))}
        </div>
        {/* Decade lattice — each segment flex-grows by year count so it
            aligns under its segment of the sparkline. */}
        <div
          className="flex h-7 gap-px rounded-sm overflow-hidden"
          aria-label="releases per decade"
        >
          {decadeList.map((d) => (
            <div
              key={d.decade}
              className="bg-surface flex flex-col items-center justify-center
                         text-[10px] font-mono leading-tight overflow-hidden
                         px-1"
              style={{ flexGrow: d.years, flexBasis: 0 }}
              title={`${d.decade}s: ${d.count.toLocaleString()}`}
            >
              <span className="text-muted truncate">{d.decade}s</span>
              <span className="text-accent tabular-nums">
                {d.count.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
