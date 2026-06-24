import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, UploadCloud, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  listReleases,
  publishRelease,
  setReleaseLabel,
  setReleaseNotes,
  type Release,
} from "../lib/tauri";
import { cn } from "../lib/cn";
import {
  hasBandcampReceipt,
  isHttpUrl,
  SOURCE_PLATFORMS,
  sourcePlatform,
} from "../lib/source";

// Minimal full-screen tabular view for batch-editing release metadata. Dense,
// functional, no cover art / colours / badges — density over decoration. Only
// the two fields with per-row setters today (label, comment=notes) are inline
// editable; artist/album/year are read-only here (edit them in the detail
// panel until they grow setters). Sorting is client-side over the full list.

// "source" is a synthetic sort key (the platform-dot column) — not a Column.
type SortKey = "source" | "artist" | "title" | "label" | "notes" | "year";
type SortDir = "asc" | "desc";

interface Column {
  key: SortKey;
  // Header label — "album" maps to title, "comment" to notes, per the spec.
  label: string;
  get: (r: Release) => string | number | null | undefined;
  editable: boolean;
  // Right-align numeric columns; left for text.
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: "artist", label: "artist", get: (r) => r.artist, editable: false },
  { key: "title", label: "album", get: (r) => r.title, editable: false },
  { key: "label", label: "label", get: (r) => r.label, editable: true },
  { key: "notes", label: "comment", get: (r) => r.notes, editable: true },
  { key: "year", label: "year", get: (r) => r.year, editable: false, numeric: true },
];

// One grid template shared by the header and every row so columns line up.
// Two leading 0.85rem indicator columns: publish-state dot (not sortable) then
// the Bandcamp dot (sortable via its header).
const GRID =
  "grid-cols-[0.85rem_0.85rem_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.7fr)_3.5rem]";

function compare(a: Release, b: Release, key: SortKey, dir: SortDir): number {
  const col = COLUMNS.find((c) => c.key === key)!;
  const av = col.get(a);
  const bv = col.get(b);
  // Nulls / blanks always sort to the end regardless of direction.
  const aEmpty = av == null || av === "";
  const bEmpty = bv == null || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  let r: number;
  if (col.numeric) {
    r = Number(av) - Number(bv);
  } else {
    r = String(av).localeCompare(String(bv), undefined, {
      sensitivity: "base",
    });
  }
  return dir === "asc" ? r : -r;
}

export function BatchEditView({
  reloadKey,
  relays,
}: {
  reloadKey: number;
  relays: string[];
}) {
  const [rows, setRows] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("artist");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Releases edited in THIS view session — the precise set the republish
  // button targets (vs the whole "unpublished" bucket, which would also sweep
  // up never-published imports). Editing a published release also clears its
  // publish markers backend-side, so its dot flips to "needs republish".
  const [editedIds, setEditedIds] = useState<Set<number>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [pubDone, setPubDone] = useState(0);
  const [pubStatus, setPubStatus] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    listReleases()
      .then((rs) => {
        if (!cancelled) setRows(rs);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [reloadKey, load]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortKey === "source") {
      // Group by platform: present-first (clustered), grouped in SOURCE_PLATFORMS
      // order; releases with no recognised source sink to the bottom.
      const idx = (r: Release) => {
        const p = sourcePlatform(r);
        return p ? SOURCE_PLATFORMS.indexOf(p) : SOURCE_PLATFORMS.length;
      };
      copy.sort((a, b) => {
        const r = idx(a) - idx(b);
        return sortDir === "asc" ? -r : r; // desc = platforms clustered up top
      });
    } else {
      copy.sort((a, b) => compare(a, b, sortKey, sortDir));
    }
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // source defaults to desc so the first click clusters platform rows to
      // the top (grouped by platform); text/year default to asc.
      setSortDir(key === "source" ? "desc" : "asc");
    }
  }

  // Optimistic in-place patch after a successful per-row setter, so the cell
  // reflects the new value without a full reload (and keeps current sort).
  function patchRow(id: number, patch: Partial<Release>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Republish exactly the releases edited this session. Loops the existing
  // per-release publish (no id-list batch command needed); the replaceable
  // kind:31237 event overwrites the prior one by d-tag. Failed ids stay in the
  // edited set so a retry re-targets only them.
  async function republishEdited() {
    const ids = [...editedIds];
    if (ids.length === 0 || publishing) return;
    setPublishing(true);
    setPubDone(0);
    setPubStatus(null);
    const stillEdited = new Set<number>();
    let failed = 0;
    for (const id of ids) {
      try {
        await publishRelease(id, relays);
      } catch {
        stillEdited.add(id);
        failed++;
      }
      setPubDone((n) => n + 1);
    }
    setEditedIds(stillEdited);
    setPublishing(false);
    setPubStatus(
      failed === 0
        ? `republished ${ids.length}`
        : `${ids.length - failed} republished, ${failed} failed`,
    );
    load(); // pull DB truth so dots reflect the new publish state
  }

  return (
    <div className="rounded-xl bg-panel border border-surface/60 shadow-md
                    flex flex-col min-h-0 h-full overflow-hidden">
      {/* Toolbar: count + republish-edited control. */}
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 shrink-0
                      border-b border-surface/60 text-xs">
        <span className="text-muted">
          {rows.length} releases
          {pubStatus && <span className="ml-3 text-mauve">{pubStatus}</span>}
        </span>
        {editedIds.size > 0 && (
          <button
            type="button"
            onClick={republishEdited}
            disabled={publishing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
                       bg-mauve/15 text-mauve hover:bg-mauve/25 transition-colors
                       disabled:opacity-50"
            title="Republish the releases you edited this session"
          >
            <UploadCloud size={12} />
            {publishing
              ? `publishing ${pubDone}/${editedIds.size}…`
              : `Republish ${editedIds.size} edited`}
          </button>
        )}
      </div>

      <div
        className={cn(
          "grid items-center gap-3 px-4 py-2 shrink-0",
          "border-b border-surface/60 bg-panel sticky top-0 z-10",
          "text-xs uppercase tracking-wide text-accent font-medium",
          GRID,
        )}
      >
        <span aria-hidden="true" />
        <button
          type="button"
          onClick={() => toggleSort("source")}
          className="inline-flex items-center justify-center hover:text-fg transition-colors"
          title="Sort by source platform (cluster to top)"
          aria-label="Sort by source platform"
        >
          <span className="w-2 h-2 rounded-full border border-fg/40" />
          {sortKey === "source" &&
            (sortDir === "asc" ? (
              <ArrowUp size={11} className="shrink-0" />
            ) : (
              <ArrowDown size={11} className="shrink-0" />
            ))}
        </button>
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => toggleSort(c.key)}
            className={cn(
              "inline-flex items-center gap-1 min-w-0 hover:text-fg transition-colors",
              c.numeric ? "justify-end" : "justify-start",
            )}
            title={`Sort by ${c.label}`}
          >
            <span className="truncate">{c.label}</span>
            {sortKey === c.key &&
              (sortDir === "asc" ? (
                <ArrowUp size={11} className="shrink-0" />
              ) : (
                <ArrowDown size={11} className="shrink-0" />
              ))}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted">loading…</div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">no releases</div>
        ) : (
          sorted.map((r) => {
            const published = r.lastPublishedNaddr != null;
            const platform = sourcePlatform(r);
            const platformLinkable = platform != null && isHttpUrl(r.source);
            return (
            <div
              key={r.id}
              className={cn(
                "grid items-center gap-3 px-4 py-1 font-mono text-xs",
                "border-b border-fg/25 hover:bg-surface/30 transition-colors",
                GRID,
              )}
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full justify-self-center shrink-0",
                  published ? "bg-mauve" : "border border-mauve/50",
                )}
                title={
                  published
                    ? "published — current on relays"
                    : "needs republish"
                }
              />
              {platform == null ? (
                <span aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  disabled={!platformLinkable}
                  onClick={() => platformLinkable && openUrl(r.source!)}
                  className={cn(
                    "w-2 h-2 rounded-full justify-self-center shrink-0",
                    platformLinkable &&
                      "cursor-pointer hover:scale-125 transition-transform",
                  )}
                  style={{ backgroundColor: platform.color }}
                  title={
                    platform.label +
                    (platform.key === "bandcamp" && hasBandcampReceipt(r)
                      ? " — purchase receipt in notes"
                      : "") +
                    (platformLinkable ? " · click to open release" : "")
                  }
                  aria-label={`Open ${platform.label} release`}
                />
              )}
              {COLUMNS.map((c) => {
                const raw = c.get(r);
                if (c.editable && r.id != null) {
                  return (
                    <Cell
                      key={c.key}
                      value={raw == null ? "" : String(raw)}
                      onCommit={async (next) => {
                        if (c.key === "label") {
                          await setReleaseLabel(r.id!, next);
                          patchRow(r.id!, { label: next });
                        } else {
                          await setReleaseNotes(r.id!, next);
                          patchRow(r.id!, { notes: next });
                        }
                        // Editing published data clears publish markers backend-
                        // side; mirror that locally and queue for republish.
                        patchRow(r.id!, {
                          lastPublishedAt: null,
                          lastPublishedNaddr: null,
                        });
                        setEditedIds((s) => new Set(s).add(r.id!));
                      }}
                    />
                  );
                }
                return (
                  <span
                    key={c.key}
                    className={cn(
                      "truncate text-fg/85",
                      c.numeric && "text-right tabular-nums",
                      (raw == null || raw === "") && "text-muted/40",
                    )}
                    title={raw == null ? undefined : String(raw)}
                  >
                    {raw == null || raw === "" ? "—" : String(raw)}
                  </span>
                );
              })}
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// A single inline-editable cell: click to edit, commit on blur/Enter, revert
// on Escape. Mirrors EditableText in ReleaseDetail but trimmed for the dense
// table (no per-cell error chip — failures restore the prior value).
function Cell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if ((value || null) === next) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onCommit(next);
      setEditing(false);
    } catch {
      setDraft(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  // One-click clear — equivalent to editing the cell down to empty, but without
  // the select-all/backspace dance. No-op when already empty.
  async function clear(e: React.MouseEvent) {
    e.stopPropagation();
    if (!value) return;
    setSaving(true);
    try {
      await onCommit(null);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        spellCheck={false}
        className="w-full h-6 px-1.5 py-0 rounded bg-surface text-fg outline-none
                   border border-accent/50 text-xs disabled:opacity-50"
      />
    );
  }

  return (
    <div
      className="group h-6 flex items-center gap-1 rounded min-w-0
                 border border-transparent hover:border-accent/40
                 hover:bg-surface/70 transition-colors"
    >
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={value ? value : "Set value"}
        disabled={saving}
        className="flex-1 h-full inline-flex items-center justify-between gap-1.5
                   px-1.5 py-0 text-left min-w-0 disabled:opacity-50"
      >
        <span className={cn("truncate", value ? "text-fg/85" : "text-muted/40")}>
          {value || "—"}
        </span>
        <Pencil
          size={9}
          className="shrink-0 text-muted/30 group-hover:text-accent transition-colors"
        />
      </button>
      {value && (
        <button
          type="button"
          onClick={clear}
          disabled={saving}
          title="Clear"
          aria-label="Clear field"
          className="shrink-0 h-full px-1 inline-flex items-center opacity-0
                     group-hover:opacity-100 text-muted/40 hover:text-alert
                     transition-colors disabled:opacity-50"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
