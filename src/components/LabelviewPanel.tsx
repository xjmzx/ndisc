import { useEffect, useMemo, useState } from "react";
import { Check, List, Search } from "lucide-react";
import { Section } from "./Section";
import { listDistinctLabels } from "../lib/tauri";
import type { LabelEntry } from "./LabelPanel";

interface Props {
  labels: LabelEntry[];
  reloadKey: number;
  onPick: (name: string, existingUrl: string, existingSite: string) => void;
}

const MAX_DISPLAY = 36;
// Safety cap on how many label rows we render at once. The list scrolls,
// so this only guards against a pathological label count; if a library
// ever exceeds it, pagination would be the next step.
const MAX_ROWS = 500;

function normaliseName(s: string): string {
  return s.trim().toLowerCase();
}

function truncateForDisplay(s: string): string {
  return s.length > MAX_DISPLAY ? s.slice(0, MAX_DISPLAY - 1) + "…" : s;
}

export function LabelviewPanel({ labels, reloadKey, onPick }: Props) {
  const [distinct, setDistinct] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listDistinctLabels()
      .then(setDistinct)
      .catch(() => setDistinct([]));
  }, [reloadKey]);

  const byName = new Map(
    labels.map((l) => [normaliseName(l.name), l] as const),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return distinct;
    return distinct.filter((n) => n.toLowerCase().includes(q));
  }, [distinct, query]);

  const visible = filtered.slice(0, MAX_ROWS);

  // How many of the filtered labels have artwork supplied — i.e. a label
  // entry with a non-empty image URL. Mirrors the lit checkmarks in the list.
  const labelledCount = filtered.reduce((n, name) => {
    const entry = byName.get(normaliseName(name));
    return n + (entry != null && entry.imageUrl.length > 0 ? 1 : 0);
  }, 0);

  return (
    <Section title="Labels" icon={<List size={16} />}>
      <div className="relative mb-1">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search labels…"
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
            {distinct.length === 0 ? "no labels in library" : "no matches"}
          </li>
        )}
      </ul>
      <div className="px-2 pt-1 text-[10px] text-muted tabular-nums text-center">
        {query.trim()
          ? `${filtered.length} of ${distinct.length} labels`
          : `${distinct.length} labels`}
        {" | "}
        {labelledCount} labelled
      </div>
    </Section>
  );
}
