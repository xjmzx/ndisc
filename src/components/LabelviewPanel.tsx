import { useEffect, useMemo, useState } from "react";
import { Check, ImageOff, Link2Off, List, Search, X } from "lucide-react";
import { Section } from "./Section";
import { listDistinctLabels } from "../lib/tauri";
import type { LabelEntry } from "./LabelPanel";

interface Props {
  labels: LabelEntry[];
  setLabels: (next: LabelEntry[]) => void;
  reloadKey: number;
  onPick: (name: string, existingUrl: string, existingSite: string) => void;
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
}: Props) {
  const [distinct, setDistinct] = useState<string[]>([]);
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
    () => new Set(distinct.map(normaliseName)),
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
    mode === "orphans" ? orphans.map((l) => l.name) : distinct;

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

  const headerRight = (
    <div className="flex items-center gap-1">
      {orphansToggle}
      {noArtToggle}
    </div>
  );

  return (
    <Section title="Labels" icon={<List size={16} />} right={headerRight}>
      <div className="relative mb-1">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === "orphans" ? "search orphans…" : "search labels…"
          }
          spellCheck={false}
          className="w-full pl-7 pr-2 py-1 rounded-md bg-surface text-fg
                     text-xs outline-none border border-transparent
                     focus:border-accent/50 placeholder:text-muted"
        />
      </div>
      {/* Fixed height (5 rows: 24px each + 2px gap) so the panel keeps its
          size whether the library is empty (fresh install) or populated. */}
      <ul
        className="h-[128px] overflow-y-auto pr-1 space-y-0.5
                   [scrollbar-gutter:stable]"
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
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() =>
                  onPick(name, entry?.imageUrl ?? "", entry?.siteUrl ?? "")
                }
                title={
                  hasImage
                    ? `Edit image for ${name}`
                    : `Supply image for ${name}`
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
                  <Check size={12} />
                </span>
                <span className="truncate">{truncateForDisplay(name)}</span>
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
      <div className="px-2 pt-1 text-[10px] text-muted tabular-nums text-center">
        {(() => {
          const noun = mode === "orphans" ? "orphan" : "label";
          const total =
            mode === "orphans" ? orphans.length : distinct.length;
          const denom = noArtOnly ? artFiltered.length : total;
          const suffix = noArtOnly ? " without art" : "";
          const head = query.trim()
            ? `${filtered.length} of ${denom} ${noun}s${suffix}`
            : `${denom} ${noun}${denom === 1 ? "" : "s"}${suffix}`;
          return (
            <>
              {head}
              {!noArtOnly && mode === "library" && (
                <>
                  {" | "}
                  {labelledCount} labelled
                </>
              )}
            </>
          );
        })()}
      </div>
    </Section>
  );
}
