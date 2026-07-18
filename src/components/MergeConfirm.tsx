import { useState } from "react";
import { ArrowRight, Combine, Loader2 } from "lucide-react";
import { cn } from "../lib/cn";
import { SUBTLE_BUTTON_CLS } from "../lib/buttonStyles";
import { mergeReleases, type MergeSummary, type Release } from "../lib/tauri";

// A release has a live event (so merging it as the loser means a retraction)
// when it's published or stale, or still carries a published naddr.
export function hasLiveEvent(r: Release): boolean {
  return (
    r.publishState === "published" ||
    r.publishState === "stale" ||
    !!r.lastPublishedNaddr
  );
}

// The fields a merge folds loser→survivor, for the confirmation preview. A row
// is "absorbed" when the survivor lacks it and the loser has it. `wire` marks a
// field carried on the kind:31237 event — folding one into a PUBLISHED survivor
// re-stales it (mirrors release_event in the Rust backend).
interface FoldField {
  key: string;
  label: string;
  present: (r: Release) => boolean;
  wire: boolean;
}
const FOLD_FIELDS: FoldField[] = [
  { key: "file_path", label: "local folder", present: (r) => !!r.filePath, wire: false },
  { key: "bandcamp_id", label: "Bandcamp receipt", present: (r) => !!r.bandcampId, wire: false },
  { key: "source_label", label: "acquisition source", present: (r) => !!r.sourceLabel, wire: false },
  { key: "cover_art_path", label: "local cover", present: (r) => !!r.coverArtPath, wire: false },
  { key: "track_count", label: "track count", present: (r) => r.trackCount != null, wire: false },
  { key: "source", label: "source URL", present: (r) => !!r.source, wire: true },
  { key: "image", label: "cover image", present: (r) => !!r.coverArtUrl, wire: true },
  { key: "discogs", label: "Discogs id", present: (r) => r.discogsId != null, wire: true },
  { key: "year", label: "year", present: (r) => r.year != null, wire: true },
  { key: "format", label: "format", present: (r) => !!r.format, wire: true },
  { key: "label", label: "label", present: (r) => !!r.label, wire: true },
  { key: "catalog", label: "catalog", present: (r) => !!r.catalogNumber, wire: true },
  { key: "country", label: "country", present: (r) => !!r.country, wire: true },
  { key: "condition", label: "condition", present: (r) => !!r.condition, wire: true },
  { key: "notes", label: "notes", present: (r) => !!r.notes, wire: true },
  { key: "tracks", label: "track total", present: (r) => r.trackTotal != null, wire: true },
  { key: "discs", label: "disc total", present: (r) => r.discTotal != null, wire: true },
  { key: "video", label: "video count", present: (r) => r.videoCount != null, wire: true },
  { key: "genres", label: "genres", present: (r) => !!r.genrePrimary, wire: true },
];

// The merge confirmation diagram + action, shared by the detail panel's "merge"
// flow and the duplicates review. Given two candidate rows it defaults the
// survivor to the PUBLISHED one (swap to override), previews exactly what the
// survivor absorbs, warns about relay retraction / re-stale, and commits.
// Renders inner content only — the caller supplies any modal chrome.
export function MergeConfirm({
  a,
  b,
  relays,
  onCancel,
  cancelLabel = "cancel",
  onMerged,
}: {
  a: Release;
  b: Release;
  relays: string[];
  onCancel: () => void;
  cancelLabel?: string;
  onMerged: (survivorId: number, summary: MergeSummary) => void;
}) {
  const [swap, setSwap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Survivor defaults to the published row; a swap lets the user override.
  let survivor = a;
  let loser = b;
  if (hasLiveEvent(b) && !hasLiveEvent(a)) {
    survivor = b;
    loser = a;
  }
  if (swap) {
    const tmp = survivor;
    survivor = loser;
    loser = tmp;
  }

  const absorbed = FOLD_FIELDS.filter(
    (f) => !f.present(survivor) && f.present(loser),
  );
  const survivorWillStale =
    survivor.publishState === "published" && absorbed.some((f) => f.wire);
  const loserRetract = hasLiveEvent(loser);

  async function confirm() {
    if (survivor.id == null || loser.id == null) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await mergeReleases(survivor.id, loser.id, relays);
      onMerged(survivor.id, summary);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="text-xs">
      <div className="flex items-stretch gap-2">
        <MergeCard label="survivor · kept" tone="keep" r={survivor} />
        <div className="flex items-center text-muted">
          <ArrowRight size={18} />
        </div>
        <MergeCard label="removed" tone="drop" r={loser} />
      </div>

      <div className="mt-3">
        <div className="text-muted mb-1">Survivor absorbs:</div>
        {absorbed.length ? (
          <div className="flex flex-wrap gap-1">
            {absorbed.map((f) => (
              <span
                key={f.key}
                className="px-1.5 py-0.5 rounded bg-surface/70 text-fg/85"
              >
                {f.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-muted/70 italic">
            nothing — the survivor already has every field
          </div>
        )}
      </div>

      {(loserRetract || survivorWillStale) && (
        <div className="mt-3 space-y-1">
          {loserRetract && (
            <div className="text-warn">
              ⚠ The removed release is published — its event will be retracted
              from relays first.
            </div>
          )}
          {survivorWillStale && (
            <div className="text-warn">
              ⚠ The survivor is published and a shared field changes — it will be
              marked stale for re-publish.
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-3 text-alert">{error}</div>}

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-muted hover:text-fg disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSwap((s) => !s)}
            disabled={busy}
            className={SUBTLE_BUTTON_CLS}
            title="Swap which row survives"
          >
            swap survivor
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="px-3 h-7 rounded bg-mauve text-bg hover:bg-mauve/80
                       disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Combine size={12} />
            )}
            merge
          </button>
        </div>
      </div>
    </div>
  );
}

function MergeCard({
  label,
  tone,
  r,
}: {
  label: string;
  tone: "keep" | "drop";
  r: Release;
}) {
  const live = hasLiveEvent(r);
  return (
    <div
      className={cn(
        "flex-1 min-w-0 rounded border p-2",
        tone === "keep" ? "border-ok/60 bg-ok/5" : "border-alert/50 bg-alert/5",
      )}
    >
      <div
        className={cn(
          "uppercase tracking-wide text-[10px] mb-1",
          tone === "keep" ? "text-ok" : "text-alert",
        )}
      >
        {label}
      </div>
      <div className="truncate text-fg/90">{r.artist}</div>
      <div className="truncate text-fg/70">{r.title}</div>
      <div className="mt-1 text-muted flex items-center gap-1.5">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            live ? "bg-mauve" : "bg-muted/40",
          )}
        />
        {[live ? "published" : "unpublished", r.medium]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}
