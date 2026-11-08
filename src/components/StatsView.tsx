import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Section } from "./Section";
import { genreDisplay, GENRE_ORDER } from "../lib/genre";
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
    // A header row in halves — the two page buttons over the Genre card, the
    // totals over the Country + Label stack — and
    // one 2-column grid per half below. The totals sit in the header so the
    // headline figures stay put whichever half is open. Each grid row
    // stretches both cells to equal height (the default), so card edges line
    // up across the left/right divide.
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <StatsSwitch page={page} onChange={choosePage} />
        <TotalsCard data={state.data} />
      </div>
      {page === "music" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {/* Genre | Country + Label stacked. Genre's two-column list
              sets the height; Country and Label share it. Both rank cards run
              two columns (16/page). Country shares the aggressive
              DOMINANT_SKEW so a home-country monopoly (here UK) doesn't crush
              the rest. */}
          <StackedBarCard
            title="Genre"
            rows={genreRows(genre)}
            colorFor={genreColor}
            displayFor={genreLabel}
            scalingExponent={DOMINANT_SKEW}
            barHeight="sm"
            showBar={false}
          />
          <div className="flex flex-col gap-2">
            <RankedRowsCard
              title="Country"
              rows={country}
              reloadKey={reloadKey}
              scalingExponent={DOMINANT_SKEW}
              columns={2}
              tintFor={(_row, rank, total) => gradientTint(rank - 1, total)}
              className="flex-1"
            />
            <RankedRowsCard
              title="Label"
              rows={label}
              reloadKey={reloadKey}
              columns={2}
              tintFor={(_row, rank, total) => labelTierTint(rank, total)}
              className="flex-1"
            />
          </div>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-2 gap-y-6">
          {/* Digital/Physical and Year each run full width — a slim two-part
              bar, then the years wide enough to read one by one, grouped by
              decade. Source | Format sit side by side below. Each card is
              titled, with a wider gap between rows than on Music. */}
          <StackedBarCard
            title="Medium"
            heading="Media Kind"
            rows={medium}
            colorFor={mediumColor}
            displayFor={mediumLabel}
            scalingExponent={1.0}
            barHeight="half"
            className="md:col-span-2"
          />
          <YearCard
            rows={year}
            title="Collection (By Year and Decade)"
            className="md:col-span-2"
          />
          <StackedBarCard
            title="Source"
            heading="Discography by Source Library"
            rows={state.source}
            colorFor={sourceBarColor}
            displayFor={sourceLabel}
            scalingExponent={1.0}
            barHeight="lg"
          />
          <StackedBarCard
            title="Format"
            heading="Format"
            rows={format}
            colorFor={formatColor}
            displayFor={formatLabel}
            scalingExponent={1.0}
            barHeight="lg"
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
              "flex items-center justify-center rounded-lg px-3 py-2 min-w-0 " +
              "transition-colors border " +
              (active
                ? "bg-surface border-accent/50 text-accent"
                : "border-transparent text-fg/70 hover:bg-surface/60 hover:text-fg")
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
// Sources are free text, so the list can grow without limit. Past the largest
// SOURCE_TOP the rest fold into one "Other (N)" row, which keeps the card's
// height (and the stats layout) fixed. Other is a real segment with its real
// count, so the bar stays exact. A lone leftover source shows by name instead:
// it takes the same one row that "Other (1)" would.
const SOURCE_UNSET = "__unset";
const SOURCE_OTHER = "__other:"; // + the number of sources folded in
const SOURCE_TOP = 9;

// The Genre card lists every contract genre: the ones in use by count, then
// the unused ones at 0, in contract order. It holds at most GENRE_ROWS rows
// (two columns of 27) so it never grows taller than the Country + Label stack
// beside it. Past that, the first GENRE_ROWS - 1 show and the rest fold into
// one "Other (N)" row, with its real count. A lone leftover shows by name
// instead (same one row).
const GENRE_ROWS = 54;
const GENRE_OTHER = "__other:"; // + the number of genres folded in

function genreRows(rows: BreakdownRow[]): BreakdownRow[] {
  const used = new Set(rows.map((r) => r.value));
  const all = [
    ...[...rows].sort((a, b) => b.count - a.count),
    ...GENRE_ORDER.filter((g) => !used.has(g)).map((g) => ({ value: g, count: 0 })),
  ];
  if (all.length <= GENRE_ROWS) return all;
  const head = all.slice(0, GENRE_ROWS - 1);
  const rest = all.slice(GENRE_ROWS - 1);
  return [
    ...head,
    {
      value: `${GENRE_OTHER}${rest.length}`,
      count: rest.reduce((a, r) => a + r.count, 0),
    },
  ];
}

function genreColor(value: string): string {
  return value.startsWith(GENRE_OTHER) ? "rgb(var(--c-muted))" : `rgb(var(--c-g-${value}))`;
}

function genreLabel(value: string): string {
  return value.startsWith(GENRE_OTHER)
    ? `Other (${value.slice(GENRE_OTHER.length)})`
    : genreDisplay(value);
}

function sourceRows(
  sources: { name: string; count: number }[],
  releases: number,
): BreakdownRow[] {
  const named = [...sources].sort((a, b) => b.count - a.count);
  const shown = named.length === SOURCE_TOP + 1 ? named.length : SOURCE_TOP;
  const rows: BreakdownRow[] = named
    .slice(0, shown)
    .map((s) => ({ value: s.name, count: s.count }));
  const rest = named.slice(shown);
  if (rest.length > 0) {
    rows.push({
      value: `${SOURCE_OTHER}${rest.length}`,
      count: rest.reduce((a, s) => a + s.count, 0),
    });
  }
  const unset = releases - total(rows);
  if (unset > 0) rows.push({ value: SOURCE_UNSET, count: unset });
  return rows;
}

// The source's own colour (user-set or seeded). A "<name> (partial)" source
// with no colour of its own borrows a paler <name>. Uncoloured sources get a
// neutral tone, and "not set" a fainter one, so the two never read as the same.
function sourceBarColor(value: string): string {
  if (value === SOURCE_UNSET) return "rgb(var(--c-muted) / 0.4)";
  if (value.startsWith(SOURCE_OTHER)) return "rgb(var(--c-muted))";
  const own = sourceColor(value);
  if (own) return own;
  const base = /^(.*)\s+\(partial\)$/i.exec(value)?.[1];
  const baseColor = base ? sourceColor(base) : null;
  if (baseColor) return `color-mix(in srgb, ${baseColor} 55%, transparent)`;
  return "rgb(var(--c-fg) / 0.55)";
}

function sourceLabel(value: string): string {
  if (value === SOURCE_UNSET) return "Not set";
  if (value.startsWith(SOURCE_OTHER))
    return `Other (${value.slice(SOURCE_OTHER.length)})`;
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
                ? "grid grid-cols-2 gap-x-6 gap-y-1 items-start"
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
  title?: string;
  className?: string;
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

function YearCard({ rows, title, className }: YearCardProps) {
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
      {/* Inset from the card's edges so the first and last bars don't run up
          against the border. The label row shares the inset to stay aligned. */}
      <div className="flex flex-1 flex-col gap-1 px-6">
        {/* One bar per year, grouped by decade: a slightly wider gap between
            decades than between years, so each decade reads as a block while
            the colour still runs along the theme gradient. */}
        <div
          className="flex h-32 items-end gap-2"
          aria-label="releases per year"
        >
          {earlier > 0 && (
            // One bar for everything older than the window, two year-slots
            // wide. Scaled like the rest but capped at full height.
            <div
              className="flex h-full items-end"
              style={{ flexGrow: EARLIER_SLOTS, flexBasis: 0 }}
            >
              <div
                className="flex-1 bg-muted/60"
                style={{ height: `${Math.min(100, (earlier / maxCount) * 100)}%` }}
                title={`before ${minYear}: ${earlier.toLocaleString()}`}
              />
            </div>
          )}
          {decadeGroups.map((g) => (
            <div
              key={g.decade}
              className="flex h-full items-end gap-0.5"
              style={{ flexGrow: g.years.length, flexBasis: 0 }}
            >
              {g.years.map((d) => (
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
          ))}
        </div>
        {/* Decade brackets, one per block above — same flex weights and the
            same gap, so each spans its decade exactly. A faint open-topped
            box (|__ 1990s __|) marks where one decade ends and the next
            begins; the label sits centred in it. */}
        <div className="flex gap-2 text-[10px] font-mono text-fg/70">
          {earlier > 0 && (
            <div
              className="text-center pt-1 pb-1 min-w-0 truncate text-muted"
              style={{ flexGrow: EARLIER_SLOTS, flexBasis: 0 }}
              title={`before ${minYear}: ${earlier.toLocaleString()}`}
            >
              &lt;{minYear}
            </div>
          )}
          {decadeGroups.map((g) => (
            <div
              key={g.decade}
              className="text-center pt-1 pb-1 min-w-0 truncate
                         border border-t-0 border-muted/30 rounded-b-sm"
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
