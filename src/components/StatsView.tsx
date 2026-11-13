import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Section } from "./Section";
import { genreDisplay } from "../lib/genre";
import { sourceColor } from "../lib/source";
import { useSourceMetaVersion } from "../hooks/useSourceMeta";
import {
  getLibraryBreakdown,
  listDistinctSources,
  type LibraryBreakdown,
  type BreakdownRow,
} from "../lib/tauri";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: LibraryBreakdown; source: BreakdownRow[] }
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
  const [page, setPage] = useState<StatsPage>(readStatsPage);
  const choosePage = (next: StatsPage) => {
    setPage(next);
    writeStatsPage(next);
  };
  // Source colours live in localStorage; re-render when one is edited.
  useSourceMetaVersion();

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([getLibraryBreakdown(), listDistinctSources()])
      .then(([data, sources]) => {
        if (!cancelled)
          setState({
            kind: "ready",
            data,
            source: sourceRows(sources, total(data.medium)),
          });
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
    // A header row — the two page buttons in the left quarter, the totals in
    // the other three — and one 2-column grid per page below. The totals sit in the header so the
    // headline figures stay put whichever half is open. Each grid row
    // stretches both cells to equal height (the default), so card edges line
    // up across the left/right divide.
    <div className="flex flex-col gap-2">
      {/* The page switch takes a quarter of the width, the totals the rest. */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <StatsSwitch page={page} onChange={choosePage} />
        <TotalsCard data={state.data} className="md:col-span-3" />
      </div>
      {page === "music" ? (
        // Four equal quarters, each the same card: a stacked bar of the
        // largest few with the rest as one "Other" segment, then a legend of
        // every row, 16 to a page. The bar gives the shape at a glance; the
        // pages keep every label and genre reachable. Each grid row stretches
        // its two cards to one height, so the pagers line up.
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <PagedBarCard
            title="Genre"
            heading="Genre (share of genre tags)"
            rows={genreRows(genre)}
            colorFor={genreColor}
            displayFor={genreDisplay}
            barTop={12}
            scalingExponent={DOMINANT_SKEW}
            reloadKey={reloadKey}
          />
          <PagedBarCard
            title="Country"
            heading="Country"
            rows={country}
            colorFor={rankTint(country, 8)}
            barTop={8}
            scalingExponent={DOMINANT_SKEW}
            reloadKey={reloadKey}
          />
          <PagedBarCard
            title="Label"
            heading="Label"
            rows={label}
            colorFor={rankTint(label, 12)}
            barTop={12}
            scalingExponent={1.0}
            reloadKey={reloadKey}
          />
          <PagedBarCard
            title="Source"
            heading="Source library"
            rows={state.source}
            colorFor={sourceBarColor}
            displayFor={sourceLabel}
            barTop={9}
            pinned={(v) => v === SOURCE_UNSET}
            scalingExponent={1.0}
            reloadKey={reloadKey}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {/* Media kind | Format side by side, then the years full width and
              tall enough to read one by one, grouped by decade. */}
          <StackedBarCard
            title="Medium"
            heading="Media Kind"
            rows={medium}
            colorFor={mediumColor}
            displayFor={mediumLabel}
            scalingExponent={1.0}
            barHeight="half"
          />
          <StackedBarCard
            title="Format"
            heading="Format"
            rows={format}
            colorFor={formatColor}
            displayFor={formatLabel}
            scalingExponent={1.0}
            barHeight="half"
          />
          <YearCard
            rows={year}
            title="Collection (By Year and Decade)"
            className="md:col-span-2"
            tall
          />
        </div>
      )}
    </div>
  );
}

// --- StatsSwitch ------------------------------------------------------------

// Stats is split in two halves: what the music is (Music) and how you hold it
// (Library). Both halves are always named, so the one not on screen can't be
// overlooked. The choice is remembered per
// viewer (localStorage; the page still works without it).
type StatsPage = "music" | "library";
const STATS_PAGE_KEY = "ndisc.statsPage";

function readStatsPage(): StatsPage {
  try {
    return localStorage.getItem(STATS_PAGE_KEY) === "library" ? "library" : "music";
  } catch {
    return "music";
  }
}

function writeStatsPage(page: StatsPage): void {
  try {
    localStorage.setItem(STATS_PAGE_KEY, page);
  } catch {
    // Storage unavailable — the choice just isn't remembered.
  }
}

const STATS_PAGES: { key: StatsPage; title: string }[] = [
  { key: "music", title: "Music" },
  { key: "library", title: "Library" },
];

function StatsSwitch({
  page,
  onChange,
  className,
}: {
  page: StatsPage;
  onChange: (page: StatsPage) => void;
  className?: string;
}) {
  return (
    // Stretches to the totals card's height; each button fills its half.
    <div
      role="tablist"
      aria-label="Stats pages"
      className={
        "grid grid-cols-2 gap-1 p-1 rounded-xl bg-panel border border-surface/60 shadow-md " +
        (className ?? "")
      }
    >
      {STATS_PAGES.map((p) => {
        const active = p.key === page;
        return (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.key)}
            className={
              // No outline: the open page is the brighter fill and the accent
              // text. A closed page rests at a dimmer fill and lifts to the
              // open page's fill on hover.
              "flex items-center justify-center rounded-lg px-3 py-2 min-w-0 " +
              "transition-colors " +
              (active
                ? "bg-surface text-accent"
                : "bg-surface/60 text-fg hover:bg-surface")
            }
          >
            <span className="text-sm font-semibold truncate">{p.title}</span>
          </button>
        );
      })}
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
    // One line of six in the header's right half, beside the page buttons.
    // Each figure takes its natural width and the row spreads them evenly, so
    // the widest (the year span) never gets squeezed; on a narrow window they
    // wrap.
    <Section dense className={className} bodyClassName="justify-center">
      <dl className="flex flex-wrap justify-between gap-x-4 gap-y-2 font-mono">
        {items.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1 min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-muted truncate">
              {k}
            </dt>
            <dd className="text-accent tabular-nums text-xl font-semibold leading-none whitespace-nowrap">
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

// Acquisition source, counted by release. Releases with no source make one
// trailing "not set" row (total minus the named ones), so the gap stays visible
// rather than the named sources reading as the whole library.
//
// Sources are free text, so the list can grow without limit; the legend pages
// hold them all. "Not set" stays last and always has its own bar segment.
const SOURCE_UNSET = "__unset";

function sourceRows(
  sources: { name: string; count: number }[],
  releases: number,
): BreakdownRow[] {
  const rows: BreakdownRow[] = [...sources]
    .sort((a, b) => b.count - a.count)
    .map((s) => ({ value: s.name, count: s.count }));
  const unset = releases - total(rows);
  if (unset > 0) rows.push({ value: SOURCE_UNSET, count: unset });
  return rows;
}

// Genre rows: the genres in use, by count. Contract genres nobody uses are
// left out; they only lengthened the list with zeros.
function genreRows(rows: BreakdownRow[]): BreakdownRow[] {
  return [...rows].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

function genreColor(value: string): string {
  return `rgb(var(--c-g-${value}))`;
}

// The source's own colour (user-set or seeded). A "<name> (partial)" source
// with no colour of its own borrows a paler <name>. Uncoloured sources get a
// neutral tone, and "not set" a fainter one, so the two never read as the same.
function sourceBarColor(value: string): string {
  if (value === SOURCE_UNSET) return "rgb(var(--c-muted) / 0.4)";
  const own = sourceColor(value);
  if (own) return own;
  const base = /^(.*)\s+\(partial\)$/i.exec(value)?.[1];
  const baseColor = base ? sourceColor(base) : null;
  if (baseColor) return `color-mix(in srgb, ${baseColor} 55%, transparent)`;
  return "rgb(var(--c-fg) / 0.55)";
}

function sourceLabel(value: string): string {
  if (value === SOURCE_UNSET) return "Not set";
  return value;
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

// Colour by rank along the mauve → digital theme axis, for lists with no
// colours of their own (Country, Label). The largest `top` rows step along the
// gradient, the same colours in the bar and beside their legend rows; every
// row past them is muted, as part of the bar's "Other".
function rankTint(rows: BreakdownRow[], top: number): (value: string) => string {
  const rank = new Map(rows.map((r, i) => [r.value, i]));
  const n = Math.min(top, rows.length);
  return (value) => {
    const i = rank.get(value) ?? n;
    return i < n ? gradientTint(i, n) : "rgb(var(--c-muted) / 0.5)";
  };
}

// --- StackedBarCard (Medium + Format) ---------------------------------------

interface StackedBarCardProps {
  title: string;
  rows: BreakdownRow[];
  colorFor: (value: string) => string;
  displayFor?: (value: string) => string;
  // Sub-linear (< 1) softens dominant slugs so the tail stays readable;
  // linear (= 1) is honest for small categorical sets.
  scalingExponent: number;
  // Bar thickness: "md" (default h-3) for Medium, Source and Format; "lg"
  // (3×, h-9) for a lone small set that can afford a chunkier band; "sm"
  // (½, h-1.5) for Genre, which has many rows and wants the height for its legend.
  barHeight?: "sm" | "md" | "half" | "lg";
  // Tighter legend row spacing — used by Genre to claw back vertical height so
  // the lower Country/Label cards rise on-screen.
  denseRows?: boolean;
  // Draw the stacked bar above the legend (default). Genre turns it off: with
  // dozens of thin slivers the counts in the legend carry the information.
  showBar?: boolean;
  // Visible card title, top left. Off by default: the Music tab's cards and
  // the bar's aria-label use `title` without showing it.
  heading?: string;
  className?: string;
}

function StackedBarCard({
  title,
  heading,
  rows,
  colorFor,
  displayFor = (v) => v,
  scalingExponent,
  barHeight = "md",
  denseRows = false,
  showBar = true,
  className,
}: StackedBarCardProps) {
  const barH =
    barHeight === "lg"
      ? "h-9"
      : barHeight === "half"
        ? "h-[18px]" // half of "lg"
        : barHeight === "sm"
          ? "h-1.5"
          : "h-3";
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
    <Section dense title={heading} className={className}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted italic">no data yet</p>
      ) : (
        <div className={denseRows ? "space-y-2" : "space-y-3"}>
          {showBar && (
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
          )}
          <ul
            className={`grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs font-mono ${
              denseRows ? "gap-y-0.5" : "gap-y-1"
            }`}
          >
            {rows.map((r) => (
              // Same column template as RankedRow so the chip (in the rank
              // gutter, right-aligned), label, count and percent line up across
              // every card — Medium/Format/Genre chips sit exactly above the
              // Country/Label rank numbers.
              <li
                key={r.value}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem_2.5rem] items-center gap-2 tabular-nums"
              >
                <span
                  className="inline-block w-2 h-2 rounded-sm justify-self-end"
                  style={{ backgroundColor: colorFor(r.value) }}
                  aria-hidden="true"
                />
                <span className="text-fg/80 truncate">
                  {displayFor(r.value)}
                </span>
                <span className="text-accent text-right">
                  {r.count.toLocaleString()}
                </span>
                <span className="text-muted text-right">
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

// --- PagedBarCard (the Music page's four quarters) ---------------------------

// A legend page is two columns of LEGEND_ROWS_PER_COLUMN; rows run down the
// left column, then the right.
const LEGEND_ROWS_PER_COLUMN = 8;
const LEGEND_PAGE = LEGEND_ROWS_PER_COLUMN * 2;
const BAR_OTHER = "__bar_other";

interface PagedBarCardProps {
  title: string;
  heading: string;
  rows: BreakdownRow[]; // largest first
  colorFor: (value: string) => string;
  displayFor?: (value: string) => string;
  // The bar shows the largest `barTop` rows as their own segments; the rest
  // join one muted "Other" segment, with its real count.
  barTop: number;
  // Rows that always get their own segment wherever they rank (Source's
  // "not set", so the gap stays visible).
  pinned?: (value: string) => boolean;
  // Sub-linear (< 1) softens a dominant segment's width so the rest stay
  // readable; the counts and percentages stay honest. 1 = honest widths.
  scalingExponent: number;
  // Back to page one when the data is reloaded.
  reloadKey: number;
}

function PagedBarCard({
  title,
  heading,
  rows,
  colorFor,
  displayFor = (v) => v,
  barTop,
  pinned = () => false,
  scalingExponent,
  reloadKey,
}: PagedBarCardProps) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [reloadKey]);

  const totalCount = total(rows);
  const ranked = rows.filter((r) => !pinned(r.value));
  const head = ranked.slice(0, barTop);
  const restCount = total(ranked.slice(barTop));
  const restN = ranked.length - head.length;
  const barRows: BreakdownRow[] = [
    ...head,
    ...(restN > 0 ? [{ value: BAR_OTHER, count: restCount }] : []),
    ...rows.filter((r) => pinned(r.value)),
  ];
  const barColor = (v: string) => (v === BAR_OTHER ? "rgb(var(--c-muted) / 0.5)" : colorFor(v));
  const barLabel = (v: string) => (v === BAR_OTHER ? `Other (${restN.toLocaleString()})` : displayFor(v));
  const scaled = barRows.map((r) => Math.pow(r.count, scalingExponent));
  const scaledSum = scaled.reduce((a, b) => a + b, 0);

  const totalPages = Math.max(1, Math.ceil(rows.length / LEGEND_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * LEGEND_PAGE;
  const end = Math.min(start + LEGEND_PAGE, rows.length);
  const visible = rows.slice(start, end);
  const columns = [visible.slice(0, LEGEND_ROWS_PER_COLUMN), visible.slice(LEGEND_ROWS_PER_COLUMN)];

  return (
    <Section dense title={heading}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted italic">no data yet</p>
      ) : (
        <div className="flex flex-col gap-3 flex-1">
          <div
            // Same height as StackedBarCard's "half" bar, so the bars on both
            // Stats pages match; thin enough that Music fits without scrolling.
            className="flex h-[18px] gap-0.5 overflow-hidden rounded-sm bg-surface"
            aria-label={`${title} composition`}
          >
            {barRows.map((r, i) => (
              <div
                key={r.value}
                style={{
                  width: `${scaledSum === 0 ? 0 : (scaled[i] / scaledSum) * 100}%`,
                  minWidth: "2px",
                  backgroundColor: barColor(r.value),
                }}
                title={`${barLabel(r.value)}: ${r.count.toLocaleString()} (${pct(r.count, totalCount)})`}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 items-start">
            {columns.map((col, ci) => (
              <ul key={ci} className="text-xs font-mono space-y-1 min-w-0">
                {col.map((r) => (
                  // Same column template as StackedBarCard's legend, so chips,
                  // labels, counts and percentages line up across every card.
                  <li
                    key={r.value}
                    className="grid grid-cols-[1.5rem_minmax(0,1fr)_3.5rem_2.5rem] items-center gap-2 tabular-nums"
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-sm justify-self-end"
                      style={{ backgroundColor: colorFor(r.value) }}
                      aria-hidden="true"
                    />
                    <span className="text-fg/80 truncate" title={displayFor(r.value)}>
                      {displayFor(r.value)}
                    </span>
                    <span className="text-accent text-right">{r.count.toLocaleString()}</span>
                    <span className="text-muted text-right">{pct(r.count, totalCount)}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-auto flex items-center justify-end gap-2 pt-1 text-[10px] font-mono text-muted tabular-nums">
              <span>
                {start + 1}–{end} of {rows.length.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                title="Previous page"
                aria-label={`${title}: previous page`}
                className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed
                           text-muted hover:text-accent transition-colors"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                title="Next page"
                aria-label={`${title}: next page`}
                className="p-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed
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
  title?: string;
  className?: string;
  // Taller bars, when the card has a page row to itself.
  tall?: boolean;
}

// The YEAR card always shows YEAR_DECADES whole decades: the current one
// (its future years as empty slots) and the ones before it. The window slides
// on as the decade turns (1950s–2020s today, 1960s–2030s from 2030), so every
// library gets the same layout. Releases older than the window fold into one
// narrow "earlier" bar at the left, so nothing drops off. Years before
// YEAR_FLOOR are treated as typos, and years past the current decade as
// mistagged; both are left off the chart (they still count everywhere else).
const YEAR_DECADES = 8;
const YEAR_FLOOR = 1900;
const EARLIER_SLOTS = 3; // width of the "earlier" bar, in year slots

function YearCard({ rows, title, className, tall = false }: YearCardProps) {
  // Parse "1968" → 1968; ignore unparseable rows defensively.
  const parsed: { year: number; count: number }[] = rows
    .map((r) => ({ year: Number(r.value), count: r.count }))
    .filter((r) => Number.isFinite(r.year));

  if (parsed.length === 0) {
    return (
      <Section dense title={title} className={className}>
        <p className="text-xs text-muted italic">no data yet</p>
      </Section>
    );
  }

  const lastDecade = Math.floor(new Date().getFullYear() / 10) * 10;
  const minYear = lastDecade - (YEAR_DECADES - 1) * 10;
  const maxYear = lastDecade + 9;
  const lookup = new Map(
    parsed
      .filter((p) => p.year >= minYear && p.year <= maxYear)
      .map((p) => [p.year, p.count]),
  );
  const earlier = parsed
    .filter((p) => p.year >= YEAR_FLOOR && p.year < minYear)
    .reduce((a, p) => a + p.count, 0);
  if (lookup.size === 0 && earlier === 0) {
    return (
      <Section dense title={title} className={className}>
        <p className="text-xs text-muted italic">no data yet</p>
      </Section>
    );
  }

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
    <Section dense title={title} className={className}>
      {/* Inset from the card's edges so the first and last boxes don't run up
          against the border. Each decade is one faint box holding its years
          and, under a rule, its label. Inside, the years sit side by side with
          no gap, each in its own faint full-height cell, so a decade reads as a
          block of ten slots and an empty year is a visibly empty slot. The
          colour runs along the theme gradient across all of them. */}
      <div className="flex flex-1 gap-2 px-6" aria-label="releases per year">
        {earlier > 0 && (
          // One bar for everything older than the window, EARLIER_SLOTS
          // year-slots wide. Scaled like the rest but capped at full height.
          <div
            className="flex min-w-0 flex-col rounded-sm border border-muted/30"
            style={{ flexGrow: EARLIER_SLOTS, flexBasis: 0 }}
            title={`before ${minYear}: ${earlier.toLocaleString()}`}
          >
            <div className={`flex ${tall ? "h-64" : "h-32"} items-end`}>
              <div
                className="flex-1 bg-muted/60"
                style={{ height: `${Math.min(100, (earlier / maxCount) * 100)}%` }}
              />
            </div>
            <div className="border-t border-muted/30 py-1 text-center text-[10px] font-mono text-muted truncate">
              &lt;{minYear}
            </div>
          </div>
        )}
        {decadeGroups.map((g) => (
          <div
            key={g.decade}
            className="flex min-w-0 flex-col rounded-sm border border-muted/30"
            style={{ flexGrow: g.years.length, flexBasis: 0 }}
          >
            <div className={`flex ${tall ? "h-64" : "h-32"}`}>
              {g.years.map((d, i) => (
                <div
                  key={d.year}
                  className={`flex flex-1 min-w-[2px] items-end ${
                    i < g.years.length - 1 ? "border-r border-muted/15" : ""
                  }`}
                  title={`${d.year}: ${d.count.toLocaleString()}`}
                >
                  <div
                    className="w-full"
                    style={{
                      height: `${d.count === 0 ? 0 : (d.count / maxCount) * 100}%`,
                      backgroundColor: yearGradientColor((d.year - minYear) / span),
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="border-t border-muted/30 py-1 text-center text-[10px] font-mono text-fg/70 truncate">
              {g.decade}s
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
