import { useEffect, useMemo, useState } from "react";
import { FolderX, Loader2, Undo2, X } from "lucide-react";
import {
  forgetMergedPath,
  listMergedPaths,
  type MergedPath,
} from "../lib/tauri";

// Folders a rescan is told to skip (the `merged_paths` table): releases deleted
// with "keep files, don't re-import", and the losing copies of resolved
// duplicates. Un-ignoring drops the row; the next rescan imports the folder.
//
// Rows whose folder is on disk with audio are the ones a rescan is hiding right
// now — a re-rip into an old path lands here silently — so they sort first.
export function IgnoredFoldersDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<MergedPath[] | null>(null);
  const [query, setQuery] = useState("");
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freed, setFreed] = useState(0);

  useEffect(() => {
    listMergedPaths()
      .then(setRows)
      .catch((e) => setError(String(e)));
  }, []);

  const hiddenCount = rows?.filter((r) => r.hasAudio).length ?? 0;

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !hiddenOnly || r.hasAudio)
      .filter(
        (r) =>
          !q ||
          r.path.toLowerCase().includes(q) ||
          `${r.survivorArtist ?? ""} ${r.survivorTitle ?? ""}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => Number(b.hasAudio) - Number(a.hasAudio));
  }, [rows, query, hiddenOnly]);

  async function unIgnore(path: string) {
    setBusy(path);
    setError(null);
    try {
      await forgetMergedPath(path);
      setRows((prev) => prev?.filter((r) => r.path !== path) ?? null);
      setFreed((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center p-4
                 bg-bg/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl mt-4 mb-4 max-h-[calc(100%-2rem)] flex flex-col
                   rounded-lg border border-surface/70 bg-panel shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-fg inline-flex items-center gap-1.5">
            <FolderX size={15} /> Ignored folders
            {rows && (
              <span className="text-muted font-normal">
                · {rows.length.toLocaleString()}
                {hiddenCount > 0 && (
                  <span className="text-warn"> · {hiddenCount} hiding audio</span>
                )}
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

        <p className="text-[11px] text-muted mb-3">
          A rescan skips these folders. Un-ignore one and the next rescan
          imports it as a new release. Highlighted rows are on disk with audio
          in them — a rescan is hiding them now.
        </p>

        {!rows ? (
          <div className="py-8 grid place-items-center text-muted">
            {error ? null : <Loader2 size={16} className="animate-spin" />}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-muted text-sm">
            No folder is ignored.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter folders…"
                className="flex-1 px-3 py-1.5 rounded-md bg-surface text-fg
                           placeholder:text-muted outline-none border
                           border-transparent focus:border-accent/50 text-xs"
                spellCheck={false}
              />
              <button
                onClick={() => setHiddenOnly((v) => !v)}
                aria-pressed={hiddenOnly}
                className={
                  "shrink-0 text-[11px] " +
                  (hiddenOnly ? "text-warn" : "text-muted hover:text-fg")
                }
              >
                {hiddenOnly ? "show all" : `hiding audio only (${hiddenCount})`}
              </button>
            </div>

            <ul className="flex-1 min-h-0 overflow-y-auto space-y-1">
              {shown.map((r) => (
                <li
                  key={r.path}
                  className={
                    "flex items-start gap-2 px-2 py-1.5 rounded " +
                    (r.hasAudio
                      ? "bg-warn/10 border-l-2 border-warn"
                      : "bg-surface/20")
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        "block text-[11px] font-mono break-all " +
                        (r.exists ? "text-fg" : "text-muted line-through")
                      }
                    >
                      {r.path}
                    </span>
                    <span className="block mt-0.5 text-[10px] text-muted truncate">
                      {describe(r)} ·{" "}
                      {new Date(r.mergedAt * 1000).toLocaleDateString()}
                    </span>
                  </span>
                  <button
                    onClick={() => unIgnore(r.path)}
                    disabled={busy !== null}
                    title="Drop this folder from the ignore list — the next rescan imports it"
                    className="shrink-0 px-2 py-0.5 rounded bg-accent/15 text-accent
                               hover:bg-accent hover:text-bg text-[11px] font-medium
                               transition-colors inline-flex items-center gap-1
                               disabled:opacity-40"
                  >
                    {busy === r.path ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Undo2 size={11} />
                    )}
                    Un-ignore
                  </button>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="py-6 text-center text-muted text-xs">
                  no folder matches
                </li>
              )}
            </ul>

            {freed > 0 && (
              <p className="mt-3 text-[11px] text-ok">
                {freed} folder{freed === 1 ? "" : "s"} un-ignored — rescan the
                library folder to import {freed === 1 ? "it" : "them"}.
              </p>
            )}
          </>
        )}

        {error && (
          <p className="mt-2 text-[11px] text-alert font-mono break-all">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function describe(r: MergedPath): string {
  const state = !r.exists
    ? "not on disk"
    : r.hasAudio
      ? "on disk, has audio"
      : "on disk, no audio";
  if (r.survivorId === null) return `deleted, files kept · ${state}`;
  const kept =
    r.survivorArtist || r.survivorTitle
      ? `${r.survivorArtist ?? "?"} — ${r.survivorTitle ?? "?"}`
      : `release #${r.survivorId} (gone)`;
  return `duplicate of ${kept}${r.trashed ? " · trashed" : ""} · ${state}`;
}
