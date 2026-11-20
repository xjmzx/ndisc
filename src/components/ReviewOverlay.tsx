import { useEffect, useState } from "react";
import { Play, X } from "lucide-react";
import { cn } from "../lib/cn";
import { useReview, type ReviewTab } from "../lib/review";
import { labelArtKinds, type LabelArtCheck, type LabelArtItem } from "../lib/tauri";
import { LocalCoverDetails } from "./ReleaseList";
import type { LabelEntry } from "./LabelPanel";

// The Review overlay (docs/backlog.md, "Review overlay"): the results of
// Local covers vs Blossom and of Check label art, in an overlay over the app
// like Relays & servers, but nearly window-sized. It opens itself when a
// check finishes; the summary line a check leaves behind opens it again.
//
// It stays MOUNTED while closed (hidden), so ticks and filters survive
// closing it. A fresh cover check remounts the cover results (`key`).

// The label results' filter chips: every flagged image, or one flag.
export type ArtFilter = "flagged" | "low" | "over" | "png" | "shape" | "other" | "elsewhere" | "unreadable";

export function artPasses(f: ArtFilter, r: LabelArtItem, check: LabelArtCheck): boolean {
  switch (f) {
    case "low":
      return r.lowRes;
    case "over":
      return r.overSize;
    case "png":
      return r.png;
    case "shape":
      return r.notSquare;
    case "other":
      return r.otherFormat;
    case "elsewhere":
      return !!check.primary && !r.onPrimary;
    case "unreadable":
      return !!r.unreadable;
    default:
      return labelArtKinds(r, check).length > 0;
  }
}

function normaliseName(s: string): string {
  return s.trim().toLowerCase();
}

function LabelArtDetails({
  check,
  labels,
  onPick,
}: {
  check: LabelArtCheck;
  labels: LabelEntry[];
  onPick: (name: string, url: string, site: string) => void;
}) {
  const [filter, setFilter] = useState<ArtFilter>("flagged");
  const byName = new Map(labels.map((l) => [normaliseName(l.name), l]));
  const shown = check.items.filter((r) => artPasses(filter, r, check));
  return (
    <div className="text-xs">
      <p className="text-muted">
        Read from each image’s first bytes; nothing is changed. Low-res is a long side under{" "}
        {check.lowPx} px; over {check.libraryPx} px and PNG aren’t optimised for publishing; not
        square is more than {check.squareTolerancePct}% off. Click a label to edit it.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
        {(
          [
            ["flagged", "Flagged"],
            ["low", "Low-res"],
            ["over", `Over ${check.libraryPx}`],
            ["png", "PNG"],
            ["shape", "Not square"],
            ["other", "Other format"],
            ["elsewhere", "Not on primary"],
            ["unreadable", "Unreadable"],
          ] as const
        )
          .map(([k, label]) => [k, label, check.items.filter((r) => artPasses(k, r, check)).length] as const)
          .filter(([k, , n]) => k === "flagged" || n > 0)
          .map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={cn(
                "px-2 py-0.5 rounded",
                filter === k ? "bg-accent/15 text-accent" : "bg-surface text-muted hover:text-fg",
              )}
            >
              {label} <span className="font-mono">{n}</span>
            </button>
          ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-1">
        {shown.map((r) => (
          <li key={r.url} className="flex items-center gap-3 px-2 py-1.5 rounded bg-bg/50">
            <img
              src={r.url}
              loading="lazy"
              alt=""
              className="w-14 h-14 object-contain bg-surface rounded shrink-0"
              title={r.url}
            />
            <span className="min-w-0">
              <span className="block truncate">
                {r.labels.slice(0, 6).map((name, i) => (
                  <span key={name}>
                    {i > 0 && <span className="text-muted">, </span>}
                    <button
                      type="button"
                      onClick={() => {
                        const e = byName.get(normaliseName(name));
                        onPick(name, e?.imageUrl ?? r.url, e?.siteUrl ?? "");
                      }}
                      className="text-fg hover:text-accent"
                    >
                      {name}
                    </button>
                  </span>
                ))}
                {r.labels.length > 6 && (
                  <span className="text-muted" title={r.labels.join(", ")}>
                    {" "}
                    and {r.labels.length - 6} more
                  </span>
                )}
              </span>
              <span className="block text-[10px] text-muted font-mono truncate" title={r.unreadable ?? r.url}>
                {r.dims ? `${r.dims[0]}×${r.dims[1]}` : "size ?"} · {r.format} · {r.host}
                {(() => {
                  // The format is printed already; don't repeat it as a flag.
                  const k = labelArtKinds(r, check).filter((x) => x !== r.format);
                  return k.length > 0 ? ` · ${k.join(" · ")}` : "";
                })()}
              </span>
            </span>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-2 py-1 text-muted">nothing here: every label image is in shape</li>
        )}
      </ul>
    </div>
  );
}

export function ReviewOverlay({
  labels,
  onPickLabel,
}: {
  labels: LabelEntry[];
  // Close the overlay and open this label in the Labels page's form.
  onPickLabel: (name: string, url: string, site: string) => void;
}) {
  const review = useReview();
  const { open, close, tab, setTab, cover, coverActions, label } = review;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const tabs: [ReviewTab, string, number | null][] = [
    ["covers", "Covers", cover ? cover.data.differing.length + cover.data.quality.length : null],
    [
      "labels",
      "Labels",
      label ? label.items.filter((r) => artPasses("flagged", r, label)).length : null,
    ],
  ];

  const runCovers = () => {
    if (!coverActions || coverActions.busy) return;
    // The check's progress line is the release list's, under the overlay.
    close();
    coverActions.check();
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 p-4 bg-bg/70 backdrop-blur-sm",
        open ? "flex" : "hidden",
      )}
      onClick={close}
    >
      <div
        role="dialog"
        aria-label="Review"
        className="w-full h-full flex flex-col rounded-lg border border-surface/70 bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-surface/60">
          <h3 className="text-sm font-medium text-fg">Review</h3>
          <div className="flex items-center gap-1">
            {tabs.map(([k, name, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={cn(
                  "px-3 py-1 rounded-md text-xs transition-colors",
                  tab === k ? "bg-fg text-bg" : "bg-surface text-muted hover:text-fg",
                )}
              >
                {name}
                {n !== null && <span className="ml-1.5 font-mono opacity-70">{n}</span>}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {tab === "covers" ? (
            <button
              type="button"
              onClick={runCovers}
              disabled={!coverActions || coverActions.busy}
              title={
                coverActions
                  ? "Run Local covers vs Blossom again. Its progress shows in the release list; this opens again when it finishes."
                  : "The cover check runs from Home: open Home first."
              }
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface text-xs text-muted
                         hover:text-fg disabled:opacity-40"
            >
              <Play size={12} />
              {cover ? "Run again" : "Run the check"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void review.runLabelCheck()}
              disabled={review.labelRunning || labels.length === 0}
              title="Check label art again: every published label image's size, format and shape."
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface text-xs text-muted
                         hover:text-fg disabled:opacity-40"
            >
              <Play size={12} />
              {label ? "Run again" : "Run the check"}
            </button>
          )}
          <button type="button" onClick={close} className="text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
          <div className={tab === "covers" ? "" : "hidden"}>
            {cover ? (
              <>
                {!coverActions && (
                  <p className="mb-2 px-3 py-2 rounded-md bg-surface/40 text-xs text-warn">
                    Uploading and saving run from Home. Open Home and press Review on the
                    summary line to act on these.
                  </p>
                )}
                <LocalCoverDetails
                  key={cover.run}
                  check={cover.data}
                  uploads={cover.uploads}
                  saves={cover.saves}
                  onUpload={(ids) => coverActions?.upload(ids)}
                  onSaveFromBlossom={(ids) => coverActions?.save(ids)}
                />
              </>
            ) : (
              <p className="text-xs text-muted">
                No cover check yet. Local covers vs Blossom compares every published release’s
                cover on disk with the image readers see.
              </p>
            )}
          </div>
          <div className={tab === "labels" ? "" : "hidden"}>
            {review.labelRunning && (
              <p className="mb-2 px-3 py-2 rounded-md bg-surface/40 text-xs text-muted">
                {review.labelProgress
                  ? `reading label images ${review.labelProgress.current} / ${review.labelProgress.total} · ${review.labelProgress.currentDir}`
                  : "reading label images…"}
              </p>
            )}
            {review.labelError && (
              <p className="mb-2 text-xs text-warn">{review.labelError}</p>
            )}
            {label ? (
              <LabelArtDetails
                check={label}
                labels={labels}
                onPick={(n, u, site) => {
                  close();
                  onPickLabel(n, u, site);
                }}
              />
            ) : (
              !review.labelRunning && (
                <p className="text-xs text-muted">
                  No label check yet. Check label art reads every published label image’s size,
                  format and shape.
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
