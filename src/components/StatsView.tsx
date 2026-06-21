import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Section } from "./Section";
import { genreDisplay } from "../lib/genre";
import {
  getLibraryBreakdown,
  type LibraryBreakdown,
  type BreakdownRow,
} from "../lib/tauri";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: LibraryBreakdown }
  | { kind: "error"; message: string };

// Aggressive sub-linear exponent for the bars that tend to have ONE runaway
// category: Genre (electronic dominates) and Country (the user's home country
// dominates). At k≈0.33 the leader renders ~2× the next-nearest rather than
// its true multiple (UK is ~9.75× US by count but ~2.1× by bar), and the long
// tail lifts into visibility. It's an intentional visual distortion — the
// numeric counts/percentages beside each bar stay honest. Tuning knob; lower =
// flatter. Per-project autonomy per schema/visualisations.md (glmps uses its
// own). Charts with small, balanced category sets (Medium, Format) stay at 1.0.
const DOMINANT_SKEW = 0.33;

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
    // One 2-column grid for all three rows. Each grid row stretches both cells
    // to equal height (the default), so every section's top/bottom boundary —
    // and every gap — lines up across the left/right divide. Row 2's left cell
    // holds Medium + Format stacked; together they fill the cell, matching
    // Genre's height on the right. Section labels are gone; the charts + the
    // Totals block (row-1 left, above Medium) carry the figures.
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {/* Row 1: Totals | Year */}
      <TotalsCard data={state.data} />
      <YearCard rows={year} />
      {/* Row 2: Medium + Format (stacked, filling the cell) | Genre */}
      <div className="flex flex-col gap-2">
        <StackedBarCard
          title="Medium"
          rows={medium}
          colorFor={mediumColor}
          displayFor={mediumLabel}
          scalingExponent={1.0}
          barHeight="lg"
          className="flex-1"
        />
        <StackedBarCard
          title="Format"
          rows={format}
          colorFor={formatColor}
          displayFor={formatLabel}
          scalingExponent={1.0}
          barHeight="lg"
          className="flex-1"
        />
      </div>
      <StackedBarCard
        title="Genre"
        rows={genre}
        colorFor={(v) => `rgb(var(--c-g-${v}))`}
        displayFor={genreDisplay}
        scalingExponent={DOMINANT_SKEW}
        barHeight="sm"
      />
      {/* Row 3: Country | Label — both run two columns (16/page) so the long
          tails of countries and labels are browsable without endless paging.
          Country shares the aggressive DOMINANT_SKEW so a home-country monopoly
          (here UK) doesn't crush the rest. */}
      <RankedRowsCard
        title="Country"
        rows={country}
        reloadKey={reloadKey}
        scalingExponent={DOMINANT_SKEW}
        columns={2}
        tintFor={(_row, rank, total) => gradientTint(rank - 1, total)}
      />
      <RankedRowsCard
        title="Label"
        rows={label}
        reloadKey={reloadKey}
        columns={2}
        tintFor={(_row, rank, total) => labelTierTint(rank, total)}
      />
    </div>
  );
}

// --- TotalsCard -------------------------------------------------------------

// Consolidated library figures — replaces the per-section right-hand counts now
// that the chart sections are label-less. Each figure self-labels, so the card
// itself needs no section title. Releases is the headline; the rest are the
// breadth of the catalogue (distinct labels/countries/genres/formats + the
// year span).
function TotalsCard({
  data,
  className,
}: {
  data: LibraryBreakdown;
  className?: string;
}) {
  const releases = total(data.medium);
  const years = data.year
    .map((r) => Number(r.value))
    .filter((y) => Number.isFinite(y));
  const yearSpan =
    years.length > 0 ? `${Math.min(...years)}–${Math.max(...years)}` : "—";
  const items: [string, string][] = [
    ["releases", releases.toLocaleString()],
    ["labels", data.label.length.toLocaleString()],
    ["countries", data.country.length.toLocaleString()],
    ["genres", data.genre.length.toLocaleString()],
    ["formats", data.format.length.toLocaleString()],
    ["years", yearSpan],
  ];
  return (
    <Section dense className={className}>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2 font-mono">
        {items.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-muted truncate">
              {k}
            </dt>
            <dd className="text-accent tabular-nums text-sm leading-none">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

// --- helpers ----------------------------------------------------------------

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

// Interpolate a positional tint along the mauve → digital theme axis using
// CSS color-mix so both themes adapt: fizx renders plum → cyan, upleb
// renders gold → bright-orange. Index 0 = pure mauve, last index = pure
// digital. Single-item case returns pure mauve.
function gradientTint(index: number, total: number): string {
  const pct = total <= 1 ? 0 : (index / (total - 1)) * 100;
  return `color-mix(in srgb, rgb(var(--c-mauve)), rgb(var(--c-digital)) ${pct}%)`;
}

// Positional gradient for labels, chunked every 5 ranks. Each group of 5
// adjacent ranks shares a tint, with successive groups stepping one
// position further along the mauve → digital theme axis. For ~354 labels
// that's ~71 distinct steps — fine enough to cycle visibly as you
// paginate, coarse enough to read as deliberate bands rather than
// imperceptible per-row noise.
//
// The chunk size is the tuning knob — smaller chunk = more shifts.
const LABEL_CHUNK_SIZE = 5;

function labelTierTint(rank: number, total: number): string {
  const groupIndex = Math.floor((rank - 1) / LABEL_CHUNK_SIZE);
  const totalGroups = Math.max(1, Math.ceil(total / LABEL_CHUNK_SIZE));
  return gradientTint(groupIndex, totalGroups);
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
  // Bar thickness: "md" (default h-3); "lg" (3×, h-9) for Medium + Format whose
  // small balanced sets read as a chunkier band; "sm" (½, h-1.5) for Genre,
  // which has many rows and wants the saved height for its legend.
  barHeight?: "sm" | "md" | "lg";
  // Tighter legend row spacing — used by Genre to claw back vertical height so
  // the lower Country/Label cards rise on-screen.
  denseRows?: boolean;
  className?: string;
}

function StackedBarCard({
  title,
  rows,
  colorFor,
  displayFor = (v) => v,
  scalingExponent,
  barHeight = "md",
  denseRows = false,
  className,
}: StackedBarCardProps) {
  const barH = barHeight === "lg" ? "h-9" : barHeight === "sm" ? "h-1.5" : "h-3";
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
    <Section dense className={className}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted italic">no data yet</p>
      ) : (
        <div className={denseRows ? "space-y-2" : "space-y-3"}>
          <div
            className={`flex ${barH} gap-0.5 overflow-hidden rounded-sm bg-surface`}
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
          <ul
            className={`grid grid-cols-1 sm:grid-cols-2 gap-x-3 text-xs font-mono ${
              denseRows ? "gap-y-0.5" : "gap-y-1"
            }`}
          >
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

// Rows shown per column. With `columns` > 1 the page holds
// ROWS_PER_COLUMN × columns rows (e.g. 2 columns → 16/page).
const ROWS_PER_COLUMN = 8;

interface RankedRowsCardProps {
  title: string;
  rows: BreakdownRow[];
  // Re-fetch trigger from the parent. When it changes (after a refresh /
  // import / publish), the card resets to page 0 so the user doesn't land
  // on a now-invalid trailing page.
  reloadKey: number;
  // Number of side-by-side rank columns. 1 (default) is the single-column
  // list; 2 packs the page into two half-width columns (16 rows/page) with
  // ranks flowing down the left column then the right.
  columns?: number;
  // Sub-linear (< 1) softens bar widths so a dominant top row doesn't crush
  // the tail's visual readability. Counts and percentages in the row text
  // stay honest; only the bar fill is cosmetically scaled. Default 1.0.
  scalingExponent?: number;
  // Per-row bar fill colour. When set, called for each visible row with
  // the row's data plus its 1-based global rank and the total row count.
  // Returns a CSS colour string (or undefined to fall back to bg-accent).
  // Used for Country's positional gradient + Label's count-tier palette.
  tintFor?: (
    row: BreakdownRow,
    rank: number,
    total: number,
  ) => string | undefined;
  className?: string;
}

function RankedRowsCard({
  title,
  rows,
  reloadKey,
  columns = 1,
  scalingExponent = 1.0,
  tintFor,
  className,
}: RankedRowsCardProps) {
  const totalCount = total(rows);
  const pageSize = ROWS_PER_COLUMN * columns;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const [page, setPage] = useState(0);

  // Reset to page 0 on reload — the list shape may have changed underneath.
  useEffect(() => {
    setPage(0);
  }, [reloadKey]);

  // Clamp page if rows shrink without a reloadKey bump.
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const end = Math.min(start + pageSize, rows.length);
  const visible = rows.slice(start, end);

  // Split the visible page into up to `columns` chunks of ROWS_PER_COLUMN.
  // Ranks flow down the first chunk, then the next (1–8 left, 9–16 right).
  const chunks: BreakdownRow[][] = [];
  for (let ci = 0; ci < columns; ci++) {
    chunks.push(visible.slice(ci * ROWS_PER_COLUMN, (ci + 1) * ROWS_PER_COLUMN));
  }

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
    <Section dense className={className}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted italic">no data yet</p>
      ) : (
        <div className="flex flex-col gap-2 flex-1" aria-label={`${title} ranking`}>
          <div
            className={
              columns > 1
                ? "grid grid-cols-2 gap-x-4 gap-y-1 items-start"
                : ""
            }
          >
            {chunks.map((chunk, ci) => (
              <ul
                key={ci}
                className="text-xs font-mono space-y-2 min-w-0"
              >
                {chunk.map((r, i) => {
                  const rank = start + ci * ROWS_PER_COLUMN + i + 1;
                  return (
                    <RankedRow
                      key={r.value}
                      rank={rank}
                      label={r.value}
                      count={r.count}
                      totalCount={totalCount}
                      widthPct={widthPctFor(r.count)}
                      tint={
                        tintFor ? tintFor(r, rank, rows.length) : undefined
                      }
                    />
                  );
                })}
              </ul>
            ))}
          </div>
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
  tint,
}: {
  rank: number;
  label: string;
  count: number;
  totalCount: number;
  widthPct: number;
  // When set, used as the bar fill color (overrides bg-accent). Comes from
  // the parent's positional gradientTint() in gradient mode.
  tint?: string;
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem_2.5rem] items-center gap-2 tabular-nums">
      <span className="text-muted text-right text-[10px]">{rank}.</span>
      <div className="min-w-0">
        <div className="truncate text-fg/85">{label}</div>
        <div className="h-0.5 mt-0.5 rounded-full bg-surface overflow-hidden">
          <div
            className={`h-full transition-[width] duration-150 ${tint ? "" : "bg-accent"}`}
            style={{
              width: `${widthPct}%`,
              ...(tint ? { backgroundColor: tint } : {}),
            }}
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

// Per-year colour along the theme's year-strip gradient. `p` is the year's
// normalised position in the visible window (0 = oldest, 1 = newest). Three
// stops (old → mid → new) interpolated with color-mix so each theme resolves
// its own sweep: fizx deep-blue → light-blue → lime, upleb rust → orange →
// gold. Adjacent years differ slightly, so each decade reads as a horizontal
// gradation rather than a flat block — the glmps hero-title effect.
function yearGradientColor(p: number): string {
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  if (clamped <= 0.5) {
    const t = (clamped / 0.5) * 100;
    return `color-mix(in srgb, rgb(var(--c-year-old)), rgb(var(--c-year-mid)) ${t}%)`;
  }
  const t = ((clamped - 0.5) / 0.5) * 100;
  return `color-mix(in srgb, rgb(var(--c-year-mid)), rgb(var(--c-year-new)) ${t}%)`;
}

// --- YearCard (per-year gradient strip + decade labels) ---------------------

interface YearCardProps {
  rows: BreakdownRow[];
  className?: string;
}

// Rolling window for the YEAR card. The chart always spans the last
// YEAR_WINDOW years up to (and including) the current calendar year, so
// releases drift off the left edge as time passes. Today=2026 → window
// is 1977–2026. Releases tagged earlier than the window are silently
// excluded from this chart; they still show up everywhere else.
const YEAR_WINDOW = 50;

function YearCard({ rows, className }: YearCardProps) {
  // Parse "1968" → 1968; ignore unparseable rows defensively.
  const parsed: { year: number; count: number }[] = rows
    .map((r) => ({ year: Number(r.value), count: r.count }))
    .filter((r) => Number.isFinite(r.year));

  if (parsed.length === 0) {
    return (
      <Section dense className={className}>
        <p className="text-xs text-muted italic">no data yet</p>
      </Section>
    );
  }

  const currentYear = new Date().getFullYear();
  const windowStart = currentYear - YEAR_WINDOW + 1;
  const maxYear = currentYear;
  const minYear = windowStart;
  // Keep only in-window years for the lookup; out-of-window data is
  // dropped from this chart by design.
  const lookup = new Map(
    parsed
      .filter((p) => p.year >= windowStart && p.year <= currentYear)
      .map((p) => [p.year, p.count]),
  );

  // Group by decade — each group holds the densified year sequence for
  // that decade. Densifying ensures every year in the visible range gets
  // a bar slot (zero-height when empty), so the bar grid stays
  // dimensionally aligned with the decade labels underneath.
  const decadeGroups: {
    decade: number;
    years: { year: number; count: number }[];
  }[] = [];
  for (let y = minYear; y <= maxYear; y++) {
    const dec = Math.floor(y / 10) * 10;
    const tail = decadeGroups[decadeGroups.length - 1];
    if (!tail || tail.decade !== dec) {
      decadeGroups.push({ decade: dec, years: [] });
    }
    decadeGroups[decadeGroups.length - 1].years.push({
      year: y,
      count: lookup.get(y) ?? 0,
    });
  }
  // Flatten to one densified year sequence for the bar strip; decadeGroups
  // are kept only to position the labels underneath.
  const allYears = decadeGroups.flatMap((g) => g.years);
  const maxCount = Math.max(...allYears.map((y) => y.count), 1);
  const span = Math.max(1, maxYear - minYear);

  return (
    <Section dense className={className}>
      <div className="flex flex-col gap-1">
        {/* One bar per year, uniformly spaced across the whole window — no
            decade gap or divider. Each year is coloured by its position
            along the theme gradient, so decades are distinguished by colour
            and every decade reads as a *0→*9 horizontal gradation. */}
        <div
          className="flex items-end h-14 gap-px"
          aria-label="releases per year"
        >
          {allYears.map((d) => (
            <div
              key={d.year}
              className="flex-1 min-w-[2px]"
              style={{
                height: `${d.count === 0 ? 0 : (d.count / maxCount) * 100}%`,
                backgroundColor: yearGradientColor((d.year - minYear) / span),
              }}
              title={`${d.year}: ${d.count.toLocaleString()}`}
            />
          ))}
        </div>
        {/* Decade labels, proportionally spaced. No dividers — colour now
            carries the decade distinction. */}
        <div className="flex text-[10px] font-mono text-muted">
          {decadeGroups.map((g) => (
            <div
              key={g.decade}
              className="text-center py-0.5"
              style={{ flexGrow: g.years.length, flexBasis: 0 }}
            >
              {g.decade}s
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
