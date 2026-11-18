import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Release } from "../lib/tauri";
import { cn } from "../lib/cn";
import type { ReleaseLayout } from "./ViewToggle";

// Home's cover grid: glmps's three grid densities (`grid` / `grid-sm` /
// `grid-xs`) over the list's own filtered `items`, so search and every filter
// apply unchanged. Paging is nview's: 60 tiles, then 60 more each time the
// sentinel nears the bottom of the scroll box.
const PAGE_SIZE = 60;

const COLS: Record<Exclude<ReleaseLayout, "list">, string> = {
  grid: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3",
  "grid-sm": "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8 gap-2",
  "grid-xs": "grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 2xl:grid-cols-12 gap-1.5",
};

export function CoverGrid({
  items,
  layout,
  onSelect,
}: {
  items: Release[];
  layout: Exclude<ReleaseLayout, "list">;
  onSelect: (r: Release) => void;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const boxRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // A new result set (search, filter, reload) starts again at the top.
  useEffect(() => {
    setShown(PAGE_SIZE);
    boxRef.current?.scrollTo({ top: 0 });
  }, [items]);

  const paged = items.slice(0, shown);
  const hasMore = items.length > paged.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!hasMore || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          setShown((s) => Math.min(s + PAGE_SIZE, items.length));
      },
      { root: boxRef.current, rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // Re-key on paged.length so a sentinel still in view keeps filling.
  }, [hasMore, paged.length, items.length]);

  return (
    <div
      ref={boxRef}
      className="h-full overflow-auto rounded-md bg-bg/50 p-2 [scrollbar-gutter:stable]"
    >
      {items.length === 0 ? (
        <p className="px-1 py-3 text-muted text-xs">No releases match.</p>
      ) : (
        <ul className={cn("grid", COLS[layout])}>
          {paged.map((r) => (
            <Tile key={r.id ?? `${r.artist}-${r.title}`} release={r} layout={layout} onSelect={onSelect} />
          ))}
        </ul>
      )}
      {hasMore ? (
        <div ref={sentinelRef} className="py-4 text-center font-mono text-[10px] text-muted tabular-nums">
          {paged.length.toLocaleString()} / {items.length.toLocaleString()}
        </div>
      ) : (
        paged.length > 0 && (
          <div className="py-4 text-center font-mono text-[10px] text-muted tabular-nums">
            that’s everything · {items.length.toLocaleString()}{" "}
            {items.length === 1 ? "release" : "releases"}
          </div>
        )
      )}
    </div>
  );
}

// Local file first (no network), then the published URL.
function useCover(r: Release): [string | null, () => void] {
  const local = r.coverArtPath?.trim() ? convertFileSrc(r.coverArtPath.trim()) : null;
  const web = r.coverArtUrl?.trim() || null;
  const [src, setSrc] = useState<string | null>(local ?? web);
  useEffect(() => setSrc(local ?? web), [local, web]);
  const onError = () => setSrc((s) => (s === local && web ? web : null));
  return [src, onError];
}

function Tile({
  release: r,
  layout,
  onSelect,
}: {
  release: Release;
  layout: Exclude<ReleaseLayout, "list">;
  onSelect: (r: Release) => void;
}) {
  const [src, onError] = useCover(r);
  const physical = r.medium === "physical";
  const label = `${r.artist} – ${r.title}`;

  // Cover wall: artwork and a tiny medium dot, nothing else.
  if (layout === "grid-xs") {
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelect(r)}
          title={label}
          className="group block w-full rounded-md border border-surface bg-panel
                     hover:border-accent/50 transition-colors overflow-hidden"
        >
          <div className="relative aspect-square bg-surface/40 grid place-items-center text-muted/50">
            <MediumDot physical={physical} className="absolute top-1 left-1 z-10" />
            {src ? (
              <img src={src} alt="" loading="lazy" onError={onError} className="w-full h-full object-cover" />
            ) : (
              <span className="font-mono text-[8px] uppercase tracking-widest">
                {physical ? "phys" : "digi"}
              </span>
            )}
          </div>
        </button>
      </li>
    );
  }

  const sm = layout === "grid-sm";
  const facets = [r.year, r.format, r.label, r.country].filter(Boolean).join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(r)}
        title={label}
        className="group block w-full text-left rounded-lg border border-surface bg-panel
                   hover:border-accent/50 transition-colors overflow-hidden"
      >
        <div className="relative aspect-square bg-surface/40 grid place-items-center text-muted/50 text-xs">
          <span
            className={cn(
              "absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded border",
              "bg-panel/80 backdrop-blur-sm font-mono uppercase tracking-widest",
              sm ? "text-[8px] px-1 py-0.5" : "text-[9px] px-1.5 py-0.5",
              physical ? "border-medium/40 text-medium" : "border-surface text-muted",
            )}
          >
            <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" className="shrink-0">
              <circle
                cx="3"
                cy="3"
                r="2.2"
                fill={physical ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
            {!sm && (physical ? "physical" : "digital")}
          </span>
          {src ? (
            <img src={src} alt="" loading="lazy" onError={onError} className="w-full h-full object-cover" />
          ) : (
            <span className={cn("font-mono uppercase tracking-widest", sm && "text-[9px]")}>
              {physical ? "physical" : "digital"}
            </span>
          )}
        </div>
        <div className={sm ? "p-2 space-y-0.5" : "p-3 space-y-1"}>
          <div className="uppercase tracking-wider text-accent/70 truncate text-[10px]">{r.artist}</div>
          <div
            className={cn(
              "font-medium text-fg group-hover:text-accent transition-colors",
              sm ? "text-[10px] leading-tight line-clamp-1" : "text-sm leading-snug line-clamp-2",
            )}
          >
            {r.title}
          </div>
          {facets && (
            <div className={cn("text-muted truncate", sm ? "text-[10px]" : "text-[11px]")}>{facets}</div>
          )}
        </div>
      </button>
    </li>
  );
}

function MediumDot({ physical, className }: { physical: boolean; className?: string }) {
  return (
    <span
      title={physical ? "physical release" : "digital release"}
      aria-hidden="true"
      className={cn(
        "w-1.5 h-1.5 rounded-full border",
        physical ? "bg-medium border-medium/50" : "bg-muted/60 border-surface",
        className,
      )}
    />
  );
}
