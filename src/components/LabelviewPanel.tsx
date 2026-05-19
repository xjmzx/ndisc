import { useEffect, useMemo, useState } from "react";
import { Check, List, Search } from "lucide-react";
import { Section } from "./Section";
import { listDistinctLabels } from "../lib/tauri";
import type { LabelEntry } from "./LabelPanel";

interface Props {
  labels: LabelEntry[];
  reloadKey: number;
  onPick: (name: string, existingUrl: string) => void;
}

const MAX_DISPLAY = 36;
// Cap how many label rows we render, regardless of how many the backend
// returned. Keeps the picker compact and predictable.
const MAX_ROWS = 40;

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
  const hiddenCount = Math.max(0, filtered.length - visible.length);

  return (
    <Section title="Labels" icon={<List size={16} />}>
      {distinct.length === 0 ? (
        <div className="text-xs text-muted py-2">no labels in library</div>
      ) : (
        <>
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
        <ul
          className="max-h-[200px] overflow-y-auto pr-1 space-y-0.5
                     [scrollbar-gutter:stable]"
        >
          {visible.map((name) => {
            const entry = byName.get(normaliseName(name));
            const hasImage = entry != null && entry.imageUrl.length > 0;
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => onPick(name, entry?.imageUrl ?? "")}
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
                  <span className="truncate">
                    {truncateForDisplay(name)}
                  </span>
                </button>
              </li>
            );
          })}
          {hiddenCount > 0 && (
            <li className="px-2 pt-1 text-[10px] text-muted">
              +{hiddenCount} more (top {MAX_ROWS} shown)
            </li>
          )}
          {filtered.length === 0 && (
            <li className="px-2 py-1 text-[10px] text-muted">
              no matches
            </li>
          )}
        </ul>
        </>
      )}
    </Section>
  );
}
