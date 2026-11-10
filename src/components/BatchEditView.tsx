import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, UploadCloud, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  listReleases,
  publishRelease,
  setReleaseLabel,
  setReleaseNotes,
  setReleaseSource,
  type Release,
} from "../lib/tauri";
import { cn } from "../lib/cn";
import {
  hasBandcampReceipt,
  isHttpUrl,
  sourceColor,
  sourcePlatform,
} from "../lib/source";
import { useSourceMetaVersion } from "../hooks/useSourceMeta";

// Minimal full-screen tabular view for batch-editing release metadata. Dense,
// functional, no cover art / colours / badges — density over decoration. Only
// the fields with per-row setters today (label, source, notes) are inline
// editable; artist/album/year are read-only here (edit them in the detail
// panel until they grow setters). Sorting is client-side over the full list.

// "source" is a synthetic sort key (the source-dot column) — not a Column.
// "sourceLabel" is the real, editable acquisition-source column (distinct from
// the synthetic dot key).
type SortKey =
  | "source"
  | "artist"
  | "title"
  | "label"
  | "sourceLabel"
  | "notes"
  | "year";
type SortDir = "asc" | "desc";
// Fields the selection bar can set on every ticked row at once.
type BulkField = "sourceLabel" | "label" | "notes";

interface Column {
  key: SortKey;
  // Header label — "album" maps to title, notes keeps its own name (the field is published).
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
  { key: "sourceLabel", label: "source", get: (r) => r.sourceLabel, editable: true },
  { key: "notes", label: "notes", get: (r) => r.notes, editable: true },
  { key: "year", label: "year", get: (r) => r.year, editable: false, numeric: true },
];

// One grid template shared by the header and every row so columns line up.
// A tick box for selecting rows, then two 0.85rem indicator columns:
// publish-state dot (not sortable) then the source dot (sortable via its
// header). Then the six COLUMNS.
const GRID =
  "grid-cols-[1rem_0.85rem_0.85rem_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)_3.5rem]";

// The source dot, for reviewing which releases have a source chosen:
//   • filled — a source is chosen; its own colour, or neutral grey for one
//     without a colour (Record Store, Unknown…);
//   • ring — no source chosen, but the link points at a known store (a
//     Bandcamp URL or receipt), so it's a suggestion, not a choice;
//   • nothing — no source and no hint: a gap to fill in.
type SourceDot =
  | { kind: "chosen"; name: string; color: string }
  | { kind: "hint"; name: string; color: string }
  | { kind: "none" };

const NEUTRAL_DOT = "rgb(var(--c-muted))";

function sourceDot(r: Release): SourceDot {
  const name = (r.sourceLabel ?? "").trim();
  if (name) return { kind: "chosen", name, color: sourceColor(name) ?? NEUTRAL_DOT };
  const p = sourcePlatform(r);
  return p ? { kind: "hint", name: p.label, color: p.color } : { kind: "none" };
}

// Sort rank: chosen sources first (grouped by name), then hints, then gaps.
// Descending flips it, putting the gaps on top.
function sourceDotRank(d: SourceDot): number {
  return d.kind === "chosen" ? 0 : d.kind === "hint" ? 1 : 2;
}

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
  // Source colours live in localStorage; re-render when one is edited.
  useSourceMetaVersion();
  // Releases edited in THIS view session — the precise set the republish
  // button targets (vs the whole "unpublished" bucket, which would also sweep
  // up never-published imports). Editing a published release also clears its
  // publish markers backend-side, so its dot flips to "needs republish".
  const [editedIds, setEditedIds] = useState<Set<number>>(new Set());
  // Every row changed in this view session, including local-only source
  // edits (which never join the republish queue) — tinted so a run of edits
  // stays visible as you work down the list.
  const [touchedIds, setTouchedIds] = useState<Set<number>>(new Set());
  const touch = (id: number) => setTouchedIds((s) => new Set(s).add(id));
  // Multi-row selection for applying one value to many releases at once.
  // Click a tick to toggle a row; shift-click to tick the whole run between
  // it and the last row you clicked (in the current sort order).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
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
      // Chosen sources first, grouped by name; then hints; then releases with
      // nothing. Descending puts the gaps at the top.
      const key = (r: Release): [number, string] => {
        const d = sourceDot(r);
        return [sourceDotRank(d), d.kind === "none" ? "" : d.name.toLowerCase()];
      };
      copy.sort((a, b) => {
        const [ra, na] = key(a);
        const [rb, nb] = key(b);
        const r = ra - rb || na.localeCompare(nb);
        return sortDir === "asc" ? r : -r;
      });
    } else {
      copy.sort((a, b) => compare(a, b, sortKey, sortDir));
    }
    return copy;
  }, [rows, sortKey, sortDir]);

  // Existing acquisition-source names, for the source cells' autocomplete —
  // derived from the loaded rows so typing stays consistent (no "Bandcamp" vs
  // "bandcamp" drift) without an extra round-trip.
  const sourceNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const s = (r.sourceLabel ?? "").trim();
      if (s) set.add(s);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Every column starts ascending. For the source dot that's chosen
      // sources first (grouped by name); a second click puts the gaps on top.
      setSortDir("asc");
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

  function toggleRow(index: number, shift: boolean) {
    const id = sorted[index]?.id;
    if (id == null) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchor != null) {
        // Tick (or untick) the whole run to match the row just clicked.
        const on = !prev.has(id);
        const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
        for (let i = a; i <= b; i++) {
          const rid = sorted[i]?.id;
          if (rid == null) continue;
          if (on) next.add(rid);
          else next.delete(rid);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setAnchor(index);
  }

  const allTicked = sorted.length > 0 && sorted.every((r) => r.id != null && selected.has(r.id));
  function toggleAll() {
    setSelected(allTicked ? new Set() : new Set(sorted.flatMap((r) => (r.id == null ? [] : [r.id]))));
    setAnchor(null);
  }

  // Esc clears the selection (unless you're typing in a cell).
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) {
        setSelected(new Set());
        setAnchor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  // Apply one value to every ticked release, one at a time. Source is
  // local-only (no republish); label and notes are published data, so those
  // rows join the republish queue. An empty value clears the field.
  async function applyToSelected(field: BulkField, raw: string) {
    const value = raw.trim() === "" ? null : raw.trim();
    const ids = sorted.flatMap((r) => (r.id != null && selected.has(r.id) ? [r.id] : []));
    // Label and notes are published data, so changing many at once asks first.
    if (field !== "sourceLabel") {
      const what = field === "label" ? "label" : "notes";
      const ok = await ask(
        value
          ? `Set the ${what} to "${value}" on ${ids.length} releases? They'll need republishing.`
          : `Clear the ${what} on ${ids.length} releases? They'll need republishing.`,
        { title: `Set ${what}`, kind: "warning" },
      );
      if (!ok) return;
    }
    let done = 0;
    for (const id of ids) {
      setApplying(`${done}/${ids.length}`);
      if (field === "sourceLabel") {
        await setReleaseSource(id, value);
        patchRow(id, { sourceLabel: value });
      } else {
        if (field === "label") {
          await setReleaseLabel(id, value);
          patchRow(id, { label: value });
        } else {
          await setReleaseNotes(id, value);
          patchRow(id, { notes: value });
        }
        patchRow(id, { lastPublishedAt: null, lastPublishedNaddr: null });
        setEditedIds((s) => new Set(s).add(id));
      }
      touch(id);
      done++;
    }
    setApplying(null);
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
        {selected.size > 0 && (
          <SelectionBar
            count={selected.size}
            applying={applying}
            onApply={applyToSelected}
            onClear={() => {
              setSelected(new Set());
              setAnchor(null);
            }}
          />
        )}
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
        <Tick
          checked={allTicked}
          onClick={toggleAll}
          title={allTicked ? "Untick all" : "Tick every release in this list"}
          label="Select all"
        />
        <span aria-hidden="true" />
        <button
          type="button"
          onClick={() => toggleSort("source")}
          className="inline-flex items-center justify-center hover:text-fg transition-colors"
          title="Sort by source — chosen sources, then hints, then none (click again for gaps first)"
          aria-label="Sort by source"
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

      {/* Shared autocomplete for every source cell (option list = names in use). */}
      <datalist id="batch-source-names">
        {sourceNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted">loading…</div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">no releases</div>
        ) : (
          sorted.map((r, index) => {
            const isSelected = r.id != null && selected.has(r.id);
            const published = r.lastPublishedNaddr != null;
            const dot = sourceDot(r);
            const linkable = dot.kind !== "none" && isHttpUrl(r.source);
            return (
            <div
              key={r.id}
              className={cn(
                "grid items-center gap-3 px-4 py-1 font-mono text-xs",
                "border-b border-fg/25 hover:bg-surface/30 transition-colors",
                // Changed this session: a soft accent tint plus a bar on the
                // left edge. The row being edited: a stronger tint.
                r.id != null &&
                  touchedIds.has(r.id) &&
                  "bg-accent/10 shadow-[inset_3px_0_0_rgb(var(--c-accent))]",
                // Ticked for a multi-row edit: the strongest tint. Background
                // only, no outline (the cell being edited has its own border).
                isSelected && "bg-accent/25",
                "focus-within:bg-accent/20",
                GRID,
              )}
            >
              <Tick
                checked={isSelected}
                onClick={(e) => toggleRow(index, e.shiftKey)}
                title="Tick to edit with others · shift-click ticks a run"
                label={`Select ${r.artist} — ${r.title}`}
              />
              <span
                className={cn(
                  "w-2 h-2 rounded-full justify-self-center shrink-0",
                  published ? "bg-nostr" : "border border-nostr/50",
                )}
                title={
                  published
                    ? "published — current on relays"
                    : "needs republish"
                }
              />
              {dot.kind === "none" ? (
                <span aria-hidden="true" title="no source set" />
              ) : (
                <button
                  type="button"
                  disabled={!linkable}
                  onClick={() => linkable && openUrl(r.source!)}
                  className={cn(
                    "w-2 h-2 rounded-full justify-self-center shrink-0",
                    linkable && "cursor-pointer hover:scale-125 transition-transform",
                  )}
                  style={
                    dot.kind === "chosen"
                      ? { backgroundColor: dot.color }
                      : { boxShadow: `inset 0 0 0 1.5px ${dot.color}` }
                  }
                  title={
                    (dot.kind === "chosen"
                      ? dot.name
                      : `no source set — the link suggests ${dot.name}`) +
                    (dot.name.toLowerCase() === "bandcamp" && hasBandcampReceipt(r)
                      ? " — purchase receipt in notes"
                      : "") +
                    (linkable ? " · click to open the link" : "")
                  }
                  aria-label={
                    dot.kind === "chosen" ? `Source: ${dot.name}` : `Suggested source: ${dot.name}`
                  }
                />
              )}
              {COLUMNS.map((c) => {
                const raw = c.get(r);
                if (c.editable && r.id != null) {
                  return (
                    <Cell
                      key={c.key}
                      value={raw == null ? "" : String(raw)}
                      listId={
                        c.key === "sourceLabel" ? "batch-source-names" : undefined
                      }
                      onCommit={async (next) => {
                        if (c.key === "sourceLabel") {
                          // Acquisition source is LOCAL-ONLY — not on the wire,
                          // so no publish-marker clear and no republish queue.
                          await setReleaseSource(r.id!, next);
                          patchRow(r.id!, { sourceLabel: next });
                          touch(r.id!);
                          return;
                        }
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
                        touch(r.id!);
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
  listId,
}: {
  value: string;
  onCommit: (next: string | null) => Promise<void>;
  // Optional <datalist> id for autocomplete (used by the source column).
  listId?: string;
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
        list={listId}
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

// The bar shown while rows are ticked: set one source or label on all of them.
// Leave the box empty to clear the field. Source is local-only; a label change
// queues the rows for republishing.
function SelectionBar({
  count,
  applying,
  onApply,
  onClear,
}: {
  count: number;
  applying: string | null;
  onApply: (field: BulkField, value: string) => Promise<void>;
  onClear: () => void;
}) {
  const [source, setSource] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const busy = applying != null;
  const field = (
    value: string,
    set: (v: string) => void,
    placeholder: string,
    listId: string | undefined,
    apply: () => void,
    verb: string,
  ) => (
    <span className="inline-flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) apply();
        }}
        list={listId}
        placeholder={placeholder}
        disabled={busy}
        className="w-36 px-2 py-0.5 rounded bg-surface text-fg placeholder:text-muted
                   border border-transparent focus:border-accent/50 outline-none"
      />
      <button
        type="button"
        onClick={apply}
        disabled={busy}
        className="px-2 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25
                   transition-colors disabled:opacity-50"
      >
        {value.trim() ? verb : `Clear ${verb.split(" ")[1]}`}
      </button>
    </span>
  );
  return (
    <div className="flex flex-1 items-center gap-3 min-w-0 px-2 py-0.5 rounded-md bg-accent/10">
      <span className="text-accent font-medium whitespace-nowrap">
        {busy ? `applying ${applying}…` : `${count} selected`}
      </span>
      {field(source, setSource, "source…", "batch-source-names", () => void onApply("sourceLabel", source), "Set source")}
      {field(label, setLabel, "label…", undefined, () => void onApply("label", label), "Set label")}
      {field(notes, setNotes, "notes…", undefined, () => void onApply("notes", notes), "Set notes")}
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="ml-auto inline-flex items-center gap-1 text-muted hover:text-fg transition-colors"
        title="Untick all (Esc)"
      >
        <X size={12} /> clear
      </button>
    </div>
  );
}

// A tick box drawn by hand: the native checkbox renders near-black on the dark
// panel. Unticked is a light grey square, ticked fills with the accent colour.
function Tick({
  checked,
  onClick,
  title,
  label,
}: {
  checked: boolean;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        "justify-self-center grid place-items-center w-3.5 h-3.5 rounded-sm border transition-colors",
        checked
          ? "bg-accent border-accent text-bg"
          : "bg-fg/20 border-fg/50 hover:bg-fg/30",
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}
