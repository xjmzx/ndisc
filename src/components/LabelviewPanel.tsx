import { useEffect, useMemo, useState } from "react";
import { Check, ImageOff, Link2Off, List, Search, X } from "lucide-react";
import { cn } from "../lib/cn";
import { Section } from "./Section";
import { listDistinctLabels, type LabelCount } from "../lib/tauri";
import { genreDisplay } from "../lib/genre";
import type { LabelEntry } from "./LabelPanel";

interface Props {
  labels: LabelEntry[];
  setLabels: (next: LabelEntry[]) => void;
  reloadKey: number;
  onPick: (name: string, existingUrl: string, existingSite: string) => void;
  // When the right column's detail card is collapsed this panel flexes to
  // fill the freed height — so let the label list grow to fill it (≈24+ rows)
  // instead of its compact fixed 8-row footprint. Responsive to actual height.
  fill?: boolean;
}

const MAX_DISPLAY = 36;
// Safety cap on how many label rows we render at once. The list scrolls,
// so this only guards against a pathological label count; if a library
// ever exceeds it, pagination would be the next step.
const MAX_ROWS = 500;

type Mode = "library" | "orphans";

function normaliseName(s: string): string {
  return s.trim().toLowerCase();
}

function truncateForDisplay(s: string): string {
  return s.length > MAX_DISPLAY ? s.slice(0, MAX_DISPLAY - 1) + "…" : s;
}

export function LabelviewPanel({
  labels,
  setLabels,
  reloadKey,
  onPick,
  fill = false,
}: Props) {
  const [distinct, setDistinct] = useState<LabelCount[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("library");
  const [noArtOnly, setNoArtOnly] = useState(false);

  useEffect(() => {
    listDistinctLabels()
      .then(setDistinct)
      .catch(() => setDistinct([]));
  }, [reloadKey]);

  const byName = new Map(
    labels.map((l) => [normaliseName(l.name), l] as const),
  );

  const distinctSet = useMemo(
    () => new Set(distinct.map((d) => normaliseName(d.name))),
    [distinct],
  );

  // Release-count lookup keyed by normalised label name — drives the
  // per-row count chip. Orphans aren't in this map (count would be 0)
  // so the chip stays hidden for them.
  const countByName = useMemo(
    () =>
      new Map(distinct.map((d) => [normaliseName(d.name), d.count] as const)),
    [distinct],
  );

  // Top-3 dominant genres per label (ranked across all slot tags) — drives
  // the per-row 3-cell genre strip. Server-computed in list_distinct_labels.
  // Trailing nulls are valid (label has fewer than 3 distinct genres tagged).
  const genresByName = useMemo(
    () =>
      new Map(
        distinct.map(
          (d) =>
            [
              normaliseName(d.name),
              [d.dominantGenre, d.dominantGenre2, d.dominantGenre3] as (
                | string
                | null
              )[],
            ] as const,
        ),
      ),
    [distinct],
  );

  // Orphans: entries in ndisc.labels whose name doesn't match any release
  // label. They never surface in the release-driven library list, so without
  // this view the only cleanup path is to wait for the LABEL carousel to
  // rotate to them.
  const orphans = useMemo(
    () => labels.filter((l) => !distinctSet.has(normaliseName(l.name))),
    [labels, distinctSet],
  );

  // If the last orphan is removed while we're in orphans view, drop back
  // to the library so the panel doesn't leave the user staring at an empty
  // list with no obvious way out.
  useEffect(() => {
    if (mode === "orphans" && orphans.length === 0) setMode("library");
  }, [mode, orphans.length]);

  const source: string[] =
    mode === "orphans"
      ? orphans.map((l) => l.name)
      : distinct.map((d) => d.name);

  // Optional "no art" filter — keeps only names whose entry is missing or
  // has an empty imageUrl. Useful for finding labels still awaiting art.
  const artFiltered = useMemo(() => {
    if (!noArtOnly) return source;
    return source.filter((n) => {
      const e = byName.get(normaliseName(n));
      return !e || !e.imageUrl;
    });
  }, [source, noArtOnly, byName]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return artFiltered;
    return artFiltered.filter((n) => n.toLowerCase().includes(q));
  }, [artFiltered, query]);

  const visible = filtered.slice(0, MAX_ROWS);

  // How many of the filtered labels have artwork supplied — i.e. a label
  // entry with a non-empty image URL. Mirrors the lit checkmarks in the list.
  const labelledCount = filtered.reduce((n, name) => {
    const entry = byName.get(normaliseName(name));
    return n + (entry != null && entry.imageUrl.length > 0 ? 1 : 0);
  }, 0);

  function removeOrphan(entry: LabelEntry) {
    setLabels(labels.filter((l) => l !== entry));
  }

  const orphansToggle =
    orphans.length > 0 ? (
      <button
        type="button"
        onClick={() =>
          setMode((m) => (m === "orphans" ? "library" : "orphans"))
        }
        title={
          mode === "orphans"
            ? "Back to library"
            : `${orphans.length} orphan${
                orphans.length === 1 ? "" : "s"
              } — no matching release`
        }
        aria-label={
          mode === "orphans" ? "Back to library" : "Show orphan labels"
        }
        aria-pressed={mode === "orphans"}
        className={
          "flex items-center gap-1 px-1.5 py-0.5 rounded-md " +
          "transition-colors text-[10px] tabular-nums " +
          (mode === "orphans"
            ? "text-auburn bg-surface"
            : "text-muted hover:text-auburn hover:bg-surface")
        }
      >
        <Link2Off size={10} />
        {orphans.length}
      </button>
    ) : null;

  const noArtToggle = (
    <button
      type="button"
      onClick={() => setNoArtOnly((v) => !v)}
      title={
        noArtOnly
          ? "Show all labels"
          : "Show only labels without art"
      }
      aria-label={
        noArtOnly ? "Show all labels" : "Show only labels without art"
      }
      aria-pressed={noArtOnly}
      className={
        "transition-colors p-1 rounded-md hover:bg-surface " +
        (noArtOnly
          ? "text-mauve bg-surface"
          : "text-muted hover:text-mauve")
      }
    >
      <ImageOff size={12} />
    </button>
  );

  // Labelled-art indicator — relocated from the old footer into the header.
  // mauve check + "labelled / shown" of the currently-listed labels.
  const shown = filtered.length;
  const labelledPct = shown ? Math.round((labelledCount / shown) * 100) : 0;
  const labelledIndicator =
    mode === "library" ? (
      <span
        title={`${labelledCount} of ${shown} shown labels have artwork (${labelledPct}%)`}
        className="flex items-center gap-0.5 text-[10px] tabular-nums
                   text-muted shrink-0"
      >
        <Check size={10} className="text-mauve" />
        {labelledCount}/{shown}
      </span>
    ) : null;

  const headerRight = (
    <div className="flex items-center gap-1">
      {labelledIndicator}
      {orphansToggle}
      {noArtToggle}
    </div>
  );

  // Search field lives in the Section title slot (no "LABELS" text). The
  // normal-case / tracking-normal / font-normal classes neutralise the h2
  // heading styles the title is nested inside.
  const searchField = (
    <div className="relative w-full normal-case tracking-normal font-normal">
      <Search
        size={12}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={mode === "orphans" ? "search orphans…" : "search labels…"}
        spellCheck={false}
        className="w-full pl-7 pr-2 py-1 rounded-md bg-surface text-fg text-xs
                   outline-none border border-transparent focus:border-accent/50
                   placeholder:text-muted"
      />
    </div>
  );

  return (
    <Section
      title={searchField}
      icon={<List size={16} />}
      right={headerRight}
      className={cn(fill && "min-h-0")}
      bodyClassName={cn(fill && "min-h-0")}
    >
      {/* Compact mode: a fixed height (≈8 rows) absorbing the rows freed by
          moving search + the labelled indicator into the header, so the panel
          keeps its footprint (empty library or not). Fill mode (detail card
          collapsed): the list flexes to fill the freed column height, growing
          the visible row count to whatever fits (≈24+). */}
      <ul
        className={cn(
          "overflow-y-auto pr-1 space-y-0.5 [scrollbar-gutter:stable]",
          fill ? "flex-1 min-h-0" : "h-[200px]",
        )}
      >
        {visible.map((name) => {
          const entry = byName.get(normaliseName(name));
          const hasImage = entry != null && entry.imageUrl.length > 0;
          if (mode === "orphans") {
            return (
              <li key={name}>
                <div
                  className="w-full flex items-center gap-2 px-2 py-1
                             rounded text-left text-xs group hover:bg-surface"
                >
                  <span className="text-auburn/70 shrink-0">
                    <Link2Off size={12} />
                  </span>
                  <span className="truncate flex-1" title={name}>
                    {truncateForDisplay(name)}
                  </span>
                  <button
                    type="button"
                    onClick={() => entry && removeOrphan(entry)}
                    title={`Remove "${name}"`}
                    aria-label={`Remove ${name}`}
                    className="text-muted hover:text-alert transition-colors
                               opacity-0 group-hover:opacity-100
                               focus:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </div>
              </li>
            );
          }
          const count = countByName.get(normaliseName(name)) ?? 0;
          const genres = genresByName.get(normaliseName(name)) ?? [
            null,
            null,
            null,
          ];
          // Compound pair slugs are stored hyphenated (dnb-jungle) and shown
          // with a slash for legibility (dnb/jungle); single hyphenated names
          // (hip-hop) render verbatim. See lib/genre genreDisplay.
          const genreLabels = genres
            .filter((g): g is string => !!g)
            .map(genreDisplay);
          const genreTitle = genreLabels.length
            ? ` · genres: ${genreLabels.join(" / ")}`
            : "";
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() =>
                  onPick(name, entry?.imageUrl ?? "", entry?.siteUrl ?? "")
                }
                title={
                  hasImage
                    ? `Edit image for ${name} — ${count} release${count === 1 ? "" : "s"}${genreTitle}`
                    : `Supply image for ${name} — ${count} release${count === 1 ? "" : "s"}${genreTitle}`
                }
                className="w-full flex items-center gap-2 px-2 py-1
                           rounded hover:bg-surface text-left text-xs"
              >
                <span
                  className={
                    hasImage
                      ? "text-mauve shrink-0"
                      : "text-muted/40 shrink-0"
                  }
                >
                  <Check size={10} />
                </span>
                {/* Top-3 genre strip — three small cells coloured by the
                    --c-g-* var matching each slot's slug. Always rendered
                    so name alignment stays stable; empty cells are subtly
                    outlined. Reads left-to-right as 1st/2nd/3rd by tally. */}
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex items-center gap-px"
                >
                  {genres.map((g, i) => (
                    <span
                      key={i}
                      className="w-1 h-2.5 rounded-sm"
                      style={{
                        backgroundColor: g
                          ? `rgb(var(--c-g-${g}))`
                          : "rgb(var(--c-surface))",
                      }}
                    />
                  ))}
                </span>
                <span className="truncate flex-1">
                  {truncateForDisplay(name)}
                </span>
                {count > 0 && (
                  <span
                    aria-label={`${count} release${count === 1 ? "" : "s"}`}
                    className="shrink-0 px-1 rounded text-[9px] tabular-nums
                               text-muted/80 bg-surface/60"
                  >
                    {count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-2 py-1 text-[10px] text-muted">
            {noArtOnly
              ? mode === "orphans"
                ? "no orphan labels without art"
                : "no labels without art"
              : mode === "orphans"
                ? "no orphan labels"
                : distinct.length === 0
                  ? "no labels in library"
                  : "no matches"}
          </li>
        )}
      </ul>
    </Section>
  );
}
