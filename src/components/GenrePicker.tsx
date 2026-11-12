import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { getLibraryBreakdown } from "../lib/tauri";
import { TickBox } from "./TickBox";
import {
  GENRE_COMBINING,
  GENRE_ELECTRONIC_DANCE,
  GENRE_OTHER,
  GENRE_SLOT_CAP,
  genreDisplay,
} from "../lib/genre";

// The genre editor shared by Release detail and Add release.
//
//  • Quick checkboxes for the broad genres most releases carry — electronic
//    plus the Discogs top-level genres in use in the catalogue. Convenience
//    only: each is an ordinary slug taking one of the five slots.
//  • Every other slug (styles, combining forms) is a removable chip, added
//    from one type-to-search field, grouped like the contract and listed
//    most-used first.
//
// Order isn't chosen here: the caller saves in house order (electronic →
// genres → combining forms), so the picker only adds and removes.
export const QUICK_GENRES = [
  "electronic",
  "rock",
  "jazz",
  "hip-hop",
  "reggae",
  "pop",
  "classical",
] as const;
const QUICK = new Set<string>(QUICK_GENRES);

const GROUPS: { title: string; slugs: readonly string[] }[] = [
  { title: "electronic & dance", slugs: GENRE_ELECTRONIC_DANCE },
  { title: "other genres", slugs: GENRE_OTHER },
  { title: "combining forms", slugs: GENRE_COMBINING },
];

// Usage counts across the catalogue, fetched once per session — the order
// only needs to be roughly right, not live.
let usagePromise: Promise<Map<string, number>> | null = null;
function loadUsage(): Promise<Map<string, number>> {
  usagePromise ??= getLibraryBreakdown()
    .then((b) => new Map(b.genre.map((r) => [r.value, r.count])))
    .catch(() => new Map());
  return usagePromise;
}

export function GenrePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void | Promise<void>;
}) {
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let live = true;
    loadUsage().then((u) => live && setUsage(u));
    return () => {
      live = false;
    };
  }, []);

  const full = value.length >= GENRE_SLOT_CAP;
  const add = (slug: string) => {
    if (full || value.includes(slug)) return;
    void onChange([...value, slug]);
  };
  const remove = (slug: string) => void onChange(value.filter((g) => g !== slug));

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Suggestions: not already chosen, matching the query (prefix matches
  // first), grouped, most-used first within each group.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const score = (g: string) => {
      if (!q) return 0;
      const names = [g, genreDisplay(g).toLowerCase()];
      if (names.some((n) => n.startsWith(q))) return 0;
      if (names.some((n) => n.includes(q))) return 1;
      return -1;
    };
    return GROUPS.map((grp) => ({
      title: grp.title,
      slugs: grp.slugs
        .filter((g) => g !== "electronic" && !value.includes(g) && score(g) >= 0)
        .sort(
          (a, b) =>
            score(a) - score(b) || (usage.get(b) ?? 0) - (usage.get(a) ?? 0),
        ),
    })).filter((grp) => grp.slugs.length > 0);
  }, [query, value, usage]);
  const flat = groups.flatMap((g) => g.slugs);

  useEffect(() => setHi(0), [query]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(slug: string) {
    add(slug);
    setQuery("");
    setHi(0);
  }

  const chips = value.filter((g) => !QUICK.has(g));

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {QUICK_GENRES.map((g) => {
        const on = value.includes(g);
        const blocked = !on && full;
        return (
          <label
            key={g}
            title={
              blocked
                ? "All five genre slots are taken — remove one first"
                : g === "electronic"
                  ? "Electronic — published as the first genre"
                  : `${genreDisplay(g)}`
            }
            className={
              "h-6 inline-flex items-center gap-1.5 text-[11px] text-fg/80 " +
              "select-none whitespace-nowrap " +
              (blocked ? "opacity-50 pointer-events-none" : "cursor-pointer")
            }
          >
            <TickBox
              checked={on}
              onChange={(c) => (c ? add(g) : remove(g))}
              ariaLabel={genreDisplay(g)}
            />
            {genreDisplay(g)}
          </label>
        );
      })}

      {chips.map((g) => (
        <span
          key={g}
          className="h-6 inline-flex items-center gap-1 pl-1.5 pr-1 rounded
                     bg-surface/40 border border-surface/60 text-xs text-fg/90"
        >
          {genreDisplay(g)}
          <button
            type="button"
            onClick={() => remove(g)}
            className="text-muted/60 hover:text-alert"
            aria-label={`Remove ${genreDisplay(g)}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}

      <div ref={boxRef} className="relative">
        <input
          type="text"
          value={query}
          disabled={full}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHi((i) => Math.min(i + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && flat[hi]) pick(flat[hi]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={full ? "5 of 5" : "+ style…"}
          aria-label="add a style"
          spellCheck={false}
          className="w-28 h-6 px-1.5 py-0 rounded bg-surface/40 hover:bg-surface/70
                     text-xs text-fg/90 outline-none border border-surface/60
                     hover:border-accent/50 focus:border-accent/50 transition-colors
                     placeholder:italic placeholder:text-muted/50
                     disabled:opacity-50 disabled:pointer-events-none"
        />
        {open && !full && flat.length > 0 && (
          <div
            className="absolute z-30 left-0 top-7 w-56 max-h-64 overflow-y-auto
                       rounded-md border border-surface/70 bg-panel shadow-xl py-1"
          >
            {groups.map((grp) => (
              <div key={grp.title}>
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-muted">
                  {grp.title}
                </div>
                {grp.slugs.map((g) => {
                  const idx = flat.indexOf(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(g)}
                      onMouseEnter={() => setHi(idx)}
                      className={
                        "w-full flex items-center justify-between gap-2 px-2 py-1 text-left text-xs " +
                        (idx === hi ? "bg-surface text-fg" : "text-fg/80")
                      }
                    >
                      {genreDisplay(g)}
                      {(usage.get(g) ?? 0) > 0 && (
                        <span className="text-[10px] text-muted font-mono">
                          {usage.get(g)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
