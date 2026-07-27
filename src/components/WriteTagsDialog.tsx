import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pencil, X } from "lucide-react";
import { cn } from "../lib/cn";
import {
  previewReleaseTags,
  writeReleaseTags,
  type FileChange,
  type Release,
  type TagEdits,
  type WriteTagsSummary,
} from "../lib/tauri";

// The editable tag fields, in display order. Keys match the TagEdits payload
// (and therefore the backend's ItemKey mapping). `numeric` fields get a number
// input; disc # / disc total start blank so they read as "add" not "already N".
const FIELDS: {
  key: keyof TagEdits;
  label: string;
  numeric?: boolean;
  blankInit?: boolean;
}[] = [
  { key: "album", label: "Album" },
  { key: "artist", label: "Artist" },
  { key: "year", label: "Year" },
  { key: "label", label: "Label" },
  { key: "discNumber", label: "Disc #", numeric: true, blankInit: true },
  { key: "discTotal", label: "Disc total", numeric: true },
];

const FIELD_LABEL: Record<string, string> = {
  album: "Album",
  artist: "Artist",
  year: "Year",
  label: "Label",
  discNumber: "Disc #",
  discTotal: "Disc total",
};

/** Write metadata back to the audio files of a release (folder-level batch).
 *
 *  This is ndisc's one destructive-on-disk edit, so it is two-phase: fill the
 *  fields, PREVIEW the exact per-file deltas, then apply. A value is written to
 *  every audio file in the release folder — correct because one folder is one
 *  release (and, for a multi-disc rip, one disc). Unedited fields are never
 *  sent, so untouched tags (e.g. a rip's DISCOGS_* block) are left alone. */
export function WriteTagsDialog({
  release,
  onCancel,
  onDone,
}: {
  release: Release;
  onCancel: () => void;
  onDone: (summary: WriteTagsSummary) => void;
}) {
  // Prefill from the current release row (which itself mirrors the file tags).
  // Disc # starts blank — it's an additive locator, not a stored release field.
  const initial = useMemo<Record<keyof TagEdits, string>>(
    () => ({
      album: release.title ?? "",
      artist: release.artist ?? "",
      year: release.year != null ? String(release.year) : "",
      label: release.label ?? "",
      discNumber: "",
      discTotal: release.discTotal != null ? String(release.discTotal) : "",
    }),
    [release],
  );
  const [vals, setVals] = useState<Record<keyof TagEdits, string>>(initial);
  const [phase, setPhase] = useState<"form" | "preview">("form");
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dir = (release.filePath ?? "").trim();

  // Only fields the user actually changed become edits; empty string clears.
  function buildEdits(): TagEdits {
    const e: TagEdits = {};
    for (const f of FIELDS) {
      const cur = vals[f.key].trim();
      const init = (initial[f.key] ?? "").trim();
      if (cur !== init) e[f.key] = cur;
    }
    return e;
  }

  const edits = buildEdits();
  const editedKeys = Object.keys(edits);
  const nothingToDo = editedKeys.length === 0;

  async function onPreview() {
    if (!release.id || nothingToDo) return;
    setBusy(true);
    setError(null);
    try {
      const result = await previewReleaseTags(release.id, edits);
      setChanges(result);
      setPhase("preview");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!release.id) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await writeReleaseTags(release.id, edits);
      onDone(summary);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  // Distinct files touched by the preview — the count the Apply button commits.
  const touchedFiles = useMemo(
    () => new Set(changes.map((c) => c.relpath)).size,
    [changes],
  );

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center p-4
                 bg-bg/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg mt-8 rounded-lg border border-surface/70
                   bg-panel shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-fg inline-flex items-center gap-1.5">
            <Pencil size={14} /> Edit file tags
          </h3>
          <button
            onClick={onCancel}
            className="text-muted hover:text-fg"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="text-xs text-fg/90">
          {release.artist} — {release.title}
        </div>
        {dir && (
          <div className="mt-0.5 text-[11px] text-muted truncate" title={dir}>
            {dir}
          </div>
        )}

        {phase === "form" ? (
          <>
            <div className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 items-center">
              {FIELDS.map((f) => (
                <FieldRow
                  key={f.key}
                  label={f.label}
                  numeric={f.numeric}
                  value={vals[f.key]}
                  changed={vals[f.key].trim() !== (initial[f.key] ?? "").trim()}
                  onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))}
                />
              ))}
            </div>

            <div className="mt-3 text-[11px] text-muted">
              Writes to every audio file in the folder — the tags are the
              portable truth every player reads. Blank a field to clear that tag.
              You'll see the exact changes before anything is written.
            </div>

            {error && <div className="mt-2 text-[11px] text-alert">{error}</div>}

            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={onCancel}
                disabled={busy}
                className="text-[11px] text-muted hover:text-fg disabled:opacity-40"
              >
                cancel
              </button>
              <button
                onClick={onPreview}
                disabled={busy || nothingToDo}
                className={cn(
                  "text-xs rounded border px-3 py-1.5 transition-colors",
                  nothingToDo
                    ? "border-surface/60 text-muted opacity-50 cursor-not-allowed"
                    : "border-accent/50 text-accent hover:bg-accent hover:text-bg",
                )}
                title={nothingToDo ? "Edit a field first" : undefined}
              >
                {busy ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> Previewing…
                  </span>
                ) : (
                  "Preview changes"
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 text-[11px] text-warn inline-flex items-center gap-1.5">
              <AlertTriangle size={11} />
              {changes.length === 0
                ? "No files need changing — the tags already match."
                : `${changes.length} tag change${changes.length === 1 ? "" : "s"} across ${touchedFiles} file${touchedFiles === 1 ? "" : "s"}.`}
            </div>

            {changes.length > 0 && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded border border-surface/60 bg-surface/10 p-2 space-y-1.5">
                {changes.map((c, i) => (
                  <div key={i} className="text-[11px]">
                    <span className="text-fg/90">{c.relpath}</span>
                    <span className="text-muted">
                      {" "}
                      · {FIELD_LABEL[c.field] ?? c.field}:{" "}
                    </span>
                    <span className="text-muted line-through">
                      {c.old ?? "∅"}
                    </span>
                    <span className="text-muted"> → </span>
                    <span className="text-accent">{c.new ?? "∅"}</span>
                  </div>
                ))}
              </div>
            )}

            {error && <div className="mt-2 text-[11px] text-alert">{error}</div>}

            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => setPhase("form")}
                disabled={busy}
                className="text-[11px] text-muted hover:text-fg disabled:opacity-40"
              >
                back
              </button>
              <button
                onClick={onApply}
                disabled={busy || changes.length === 0}
                className={cn(
                  "text-xs rounded border px-3 py-1.5 transition-colors",
                  changes.length === 0
                    ? "border-surface/60 text-muted opacity-50 cursor-not-allowed"
                    : "border-alert/50 text-alert hover:bg-alert hover:text-bg",
                )}
              >
                {busy ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> Writing…
                  </span>
                ) : (
                  `Write ${touchedFiles} file${touchedFiles === 1 ? "" : "s"}`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  numeric,
  changed,
  onChange,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  changed: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <label className="text-xs text-muted">{label}</label>
      <input
        type={numeric ? "number" : "text"}
        min={numeric ? 1 : undefined}
        max={numeric ? 99 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full px-2 py-1 rounded bg-surface text-fg text-xs outline-none",
          "border transition-colors focus:border-accent/50",
          numeric &&
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
          changed ? "border-accent/40" : "border-transparent",
        )}
      />
    </>
  );
}
