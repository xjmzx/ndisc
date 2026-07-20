import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Combine, ImageOff, Loader2, Trash2, X } from "lucide-react";
import { TrashConfirm } from "./TrashConfirm";
import { cn } from "../lib/cn";
import { coverImageSrc } from "../lib/cover";
import { releaseSourceColor, releaseSourceName } from "../lib/source";
import { dismissDupKey, getDismissedDupKeys } from "../lib/dupDismiss";
import {
  findDuplicateGroups,
  type DuplicateGroup,
  type MergeSummary,
  type Release,
} from "../lib/tauri";
import { MergeConfirm, hasLiveEvent } from "./MergeConfirm";

// Side-by-side review of suspected-duplicate groups. Read-only until you act:
// compare artwork / provenance / local tracks / metadata, then either merge a
// pair (via the shared MergeConfirm diagram) or acknowledge the group as "not
// duplicates" so it stops surfacing. Nothing auto-merges.
export function DuplicatesDialog({
  relays,
  onClose,
  onResolved,
}: {
  relays: string[];
  onClose: () => void;
  onResolved: () => void;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  // Which two ids (within a group) are picked for a merge, keyed by group key.
  const [picks, setPicks] = useState<Record<string, number[]>>({});
  // The group key currently showing its MergeConfirm panel.
  const [confirming, setConfirming] = useState<string | null>(null);
  // The group key currently showing its TrashConfirm panel (remove-a-copy).
  const [trashing, setTrashing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const dismissed = getDismissedDupKeys();
    findDuplicateGroups()
      .then((gs) => setGroups(gs.filter((g) => !dismissed.has(g.key))))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function togglePick(key: string, id: number) {
    setPicks((p) => {
      const cur = p[key] ?? [];
      let next: number[];
      if (cur.includes(id)) next = cur.filter((x) => x !== id);
      else if (cur.length < 2) next = [...cur, id];
      else next = [cur[1], id]; // keep it to two — drop the oldest
      return { ...p, [key]: next };
    });
  }

  function acknowledge(key: string) {
    dismissDupKey(key);
    setGroups((gs) => gs.filter((g) => g.key !== key));
    onResolved();
  }

  function onMerged(_survivorId: number, _summary: MergeSummary) {
    setConfirming(null);
    setPicks({});
    onResolved();
    load(); // re-derive groups (a 3-group may now be a pair, or resolved)
  }

  // For a group, the pair to merge: an explicit 2-pick, else the two rows.
  function pairFor(g: DuplicateGroup): [Release, Release] | null {
    if (g.releases.length === 2) return [g.releases[0], g.releases[1]];
    const ids = picks[g.key] ?? [];
    if (ids.length !== 2) return null;
    const a = g.releases.find((r) => r.id === ids[0]);
    const b = g.releases.find((r) => r.id === ids[1]);
    return a && b ? [a, b] : null;
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center p-4
                 bg-bg/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl mt-4 mb-4 max-h-[calc(100%-2rem)] overflow-y-auto
                   rounded-lg border border-surface/70 bg-panel shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-fg inline-flex items-center gap-1.5">
            <Combine size={15} /> Duplicate review
            {!loading && (
              <span className="text-muted font-normal">
                · {groups.length} group{groups.length === 1 ? "" : "s"}
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-fg"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted text-sm inline-flex items-center gap-2 w-full justify-center">
            <Loader2 size={14} className="animate-spin" /> scanning…
          </div>
        ) : groups.length === 0 ? (
          <div className="py-8 text-center text-muted text-sm">
            No suspected duplicates. 🎉
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const many = g.releases.length > 2;
              const pair = pairFor(g);
              const isConfirming = confirming === g.key;
              const isTrashing = trashing === g.key;
              return (
                <div
                  key={g.key}
                  className="rounded-lg border border-surface/60 bg-surface/20 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs">
                      <span className="text-fg/90 font-medium">
                        {g.releases[0].artist} — {g.releases[0].title}
                      </span>
                      {many && (
                        <span className="ml-2 inline-flex items-center gap-1 text-warn">
                          <AlertTriangle size={11} />
                          {g.releases.length} possible duplicates
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => acknowledge(g.key)}
                      className="text-[11px] text-muted hover:text-fg inline-flex items-center gap-1"
                      title="Not duplicates — stop showing this group"
                    >
                      <Check size={12} /> not duplicates
                    </button>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {g.releases.map((r) => (
                      <CompareCard
                        key={r.id}
                        r={r}
                        selectable={many}
                        selected={(picks[g.key] ?? []).includes(r.id!)}
                        onToggle={() => r.id != null && togglePick(g.key, r.id)}
                      />
                    ))}
                  </div>

                  {isTrashing && pair ? (
                    <div className="mt-3 rounded border border-alert/40 bg-panel p-3">
                      <TrashConfirm
                        a={pair[0]}
                        b={pair[1]}
                        relays={relays}
                        onCancel={() => setTrashing(null)}
                        onResolved={() => {
                          setTrashing(null);
                          onResolved();
                          load();
                        }}
                      />
                    </div>
                  ) : isConfirming && pair ? (
                    <div className="mt-3 rounded border border-surface/60 bg-panel p-3">
                      <MergeConfirm
                        a={pair[0]}
                        b={pair[1]}
                        relays={relays}
                        cancelLabel="cancel"
                        onCancel={() => setConfirming(null)}
                        onMerged={onMerged}
                      />
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-[11px] text-muted">
                        {many
                          ? pair
                            ? "2 selected — ready to merge"
                            : "select two rows to merge"
                          : "the published row survives; the other is folded in + removed"}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setTrashing(g.key)}
                          disabled={!pair}
                          title="Remove one copy's folder to Trash (for two rips of the same release)"
                          className="px-2.5 h-6 rounded bg-alert/15 text-alert
                                     hover:bg-alert hover:text-bg transition-colors
                                     disabled:opacity-40 inline-flex items-center gap-1.5 text-xs"
                        >
                          <Trash2 size={12} /> remove a copy
                        </button>
                        <button
                          onClick={() => setConfirming(g.key)}
                          disabled={!pair}
                          className="px-2.5 h-6 rounded bg-mauve/15 text-mauve
                                     hover:bg-mauve hover:text-bg transition-colors
                                     disabled:opacity-40 inline-flex items-center gap-1.5 text-xs"
                        >
                          <Combine size={12} /> merge{many ? " selected" : ""}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// One release in a group's side-by-side comparison: artwork, provenance, local
// tracks, and basic metadata. Optionally selectable (for 3+ groups).
function CompareCard({
  r,
  selectable,
  selected,
  onToggle,
}: {
  r: Release;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const cover = coverImageSrc(r);
  const srcColor = releaseSourceColor(r);
  const srcName = releaseSourceName(r);
  const live = hasLiveEvent(r);
  const tracks =
    r.trackCount != null || r.trackTotal != null
      ? `${r.trackCount ?? "?"} / ${r.trackTotal ?? "?"}`
      : "—";
  return (
    <div
      className={cn(
        "shrink-0 w-52 rounded border p-2 text-[11px]",
        selectable && "cursor-pointer",
        selected ? "border-mauve bg-mauve/10" : "border-surface/60 bg-panel",
      )}
      onClick={selectable ? onToggle : undefined}
    >
      <div className="flex gap-2">
        <div className="w-12 h-12 shrink-0 rounded bg-surface/60 overflow-hidden grid place-items-center">
          {cover ? (
            <img
              src={cover}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <ImageOff size={14} className="text-muted/50" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                live ? "bg-mauve" : "bg-muted/40",
              )}
              title={live ? "published" : "unpublished"}
            />
            <span className="text-fg/80 truncate">
              {r.medium ?? "—"}
              {r.format ? ` · ${r.format}` : ""}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-muted truncate">
            {srcName ? (
              <>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: srcColor ?? "rgb(var(--c-muted))" }}
                />
                <span className="truncate">{srcName}</span>
              </>
            ) : (
              <span className="italic text-muted/50">no source</span>
            )}
          </div>
        </div>
        {selectable && (
          <div
            className={cn(
              "w-4 h-4 shrink-0 rounded border grid place-items-center",
              selected
                ? "bg-mauve border-mauve text-bg"
                : "border-muted/50 text-transparent",
            )}
          >
            <Check size={11} />
          </div>
        )}
      </div>

      <dl className="mt-2 space-y-0.5 text-muted">
        <Row k="tracks" v={tracks} />
        <Row k="year" v={r.year != null ? String(r.year) : "—"} />
        <Row k="label" v={r.label ?? "—"} />
        <Row k="catalog" v={r.catalogNumber ?? "—"} />
        <Row k="discogs" v={r.discogsId != null ? String(r.discogsId) : "—"} />
        <Row k="folder" v={r.filePath ?? "—"} mono />
      </dl>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0 text-muted/60">{k}</dt>
      <dd
        className={cn("flex-1 min-w-0 truncate text-fg/75", mono && "font-mono")}
        title={v}
      >
        {v}
      </dd>
    </div>
  );
}
