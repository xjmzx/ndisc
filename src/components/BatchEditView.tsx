import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil } from "lucide-react";
import {
  listReleases,
  setReleaseLabel,
  setReleaseNotes,
  type Release,
} from "../lib/tauri";
import { cn } from "../lib/cn";

// Minimal full-screen tabular view for batch-editing release metadata. Dense,
// functional, no cover art / colours / badges — density over decoration. Only
// the two fields with per-row setters today (label, comment=notes) are inline
// editable; artist/album/year are read-only here (edit them in the detail
// panel until they grow setters). Sorting is client-side over the full list.

type SortKey = "artist" | "title" | "label" | "notes" | "year";
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
const GRID =
  "grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.7fr)_3.5rem]";

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

export function BatchEditView({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("artist");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
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
  }, [reloadKey]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compare(a, b, sortKey, sortDir));
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Optimistic in-place patch after a successful per-row setter, so the cell
  // reflects the new value without a full reload (and keeps current sort).
  function patchRow(id: number, patch: Partial<Release>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="rounded-xl bg-panel border border-surface/60 shadow-md
                    flex flex-col min-h-0 h-full overflow-hidden">
      <div
        className={cn(
          "grid items-center gap-3 px-4 py-2 shrink-0",
          "border-b border-surface/60 bg-panel sticky top-0 z-10",
          "text-xs uppercase tracking-wide text-accent font-medium",
          GRID,
        )}
      >
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
          sorted.map((r) => (
            <div
              key={r.id}
              className={cn(
                "grid items-center gap-3 px-4 py-1 font-mono text-xs",
                "border-b border-surface/30 hover:bg-surface/30 transition-colors",
                GRID,
              )}
            >
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
          ))
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
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={value ? value : "Set value"}
      className="group h-6 inline-flex items-center justify-between gap-1.5
                 px-1.5 py-0 rounded text-left min-w-0
                 hover:bg-surface/70 border border-transparent
                 hover:border-accent/40 transition-colors"
    >
      <span className={cn("truncate", value ? "text-fg/85" : "text-muted/40")}>
        {value || "—"}
      </span>
      <Pencil
        size={9}
        className="shrink-0 text-muted/30 group-hover:text-accent transition-colors"
      />
    </button>
  );
}
