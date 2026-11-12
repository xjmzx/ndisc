import { useEffect, useMemo, useState } from "react";
import { FolderX, Loader2, Trash2, Undo2, X } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  clearMissingIgnoredFolders,
  forgetMergedPath,
  listMergedPaths,
  trashIgnoredFolder,
  type MergedPath,
} from "../lib/tauri";
import { Tick } from "./BatchEditView";

// Folders a rescan is told to skip (the `merged_paths` table): releases deleted
// with "keep files, don't re-import", and the losing copies of resolved
// duplicates. Un-ignoring drops the row; the next rescan imports the folder.
// Trash moves a folder still on disk to the OS Trash and keeps the row, marked
// trashed, so a restored copy stays out until it is un-ignored. "Clear not on
// disk" drops rows whose folder is gone — except trashed ones, for that reason.
// A trashed row's own button is Drop: it forgets the folder entirely, which is
// the same operation as Un-ignore, named for what the user means by it.
// Tick boxes select rows for the batch bar (shift-click ticks a run).
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
  const missingCount = rows?.filter((r) => !r.exists && !r.trashed).length ?? 0;
  const [cleared, setCleared] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

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

  const isTrashed = (r: MergedPath) => r.trashed && !r.exists;
  const picked = shown.filter((r) => selected.has(r.path));
  const toTrash = picked.filter((r) => r.exists);
  const toDrop = picked.filter(isTrashed);
  const toUnignore = picked.filter((r) => !isTrashed(r));
  const allTicked = shown.length > 0 && shown.every((r) => selected.has(r.path));

  function toggle(path: string, e: React.MouseEvent) {
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(path);
      if (e.shiftKey && anchor) {
        const a = shown.findIndex((r) => r.path === anchor);
        const b = shown.findIndex((r) => r.path === path);
        if (a >= 0 && b >= 0) {
          for (const r of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(r.path);
            else next.delete(r.path);
          }
          return next;
        }
      }
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
    setAnchor(path);
  }

  // Run one action over many rows, one at a time, keeping going past a refusal
  // so one bad folder doesn't stop the rest; the first error is shown.
  async function runBatch(
    verb: string,
    list: MergedPath[],
    one: (path: string) => Promise<void>,
  ) {
    setBusy("__batch__");
    setError(null);
    let failed = 0;
    let firstError: string | null = null;
    for (const [i, r] of list.entries()) {
      setProgress(`${verb} ${i + 1}/${list.length}`);
      try {
        await one(r.path);
      } catch (e) {
        failed++;
        firstError ??= `${r.path}: ${String(e)}`;
      }
    }
    setProgress(null);
    setBusy(null);
    setSelected(new Set());
    if (failed) setError(`${failed} failed — ${firstError}`);
  }

  async function trashSelected() {
    const n = toTrash.length;
    const ok = await ask(
      `Move ${n} folder${n === 1 ? "" : "s"} and everything in them to the Trash?\n\n` +
        "They stay on the ignore list, marked trashed, so a rescan won't import " +
        "them if they're restored.",
      { title: "Trash ignored folders", kind: "warning" },
    );
    if (!ok) return;
    await runBatch("trashing", toTrash, async (path) => {
      await trashIgnoredFolder(path);
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.path === path
              ? { ...r, trashed: true, exists: false, hasAudio: false }
              : r,
          ) ?? null,
      );
    });
  }

  async function dropSelected() {
    const n = toDrop.length;
    const ok = await ask(
      `Drop ${n} trashed folder${n === 1 ? "" : "s"} from the discography?\n\n` +
        "ndisc forgets them entirely. If one ever comes back at the same path, " +
        "a rescan imports it.",
      { title: "Drop trashed folders", kind: "warning" },
    );
    if (!ok) return;
    await runBatch("dropping", toDrop, async (path) => {
      await forgetMergedPath(path);
      setRows((prev) => prev?.filter((r) => r.path !== path) ?? null);
    });
  }

  async function unIgnoreSelected() {
    const n = toUnignore.length;
    const ok = await ask(
      `Un-ignore ${n} folder${n === 1 ? "" : "s"}? The next rescan imports ` +
        `${n === 1 ? "it" : "them"} as new releases.`,
      { title: "Un-ignore folders", kind: "info" },
    );
    if (!ok) return;
    await runBatch("un-ignoring", toUnignore, async (path) => {
      await forgetMergedPath(path);
      setRows((prev) => prev?.filter((r) => r.path !== path) ?? null);
      setFreed((x) => x + 1);
    });
  }

  async function unIgnore(path: string, drop: boolean) {
    setBusy(path);
    setError(null);
    try {
      await forgetMergedPath(path);
      setRows((prev) => prev?.filter((r) => r.path !== path) ?? null);
      if (!drop) setFreed((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function trashFolder(path: string) {
    const ok = await ask(
      `Move this folder and everything in it to the Trash?\n\n${path}\n\n` +
        "It stays on the ignore list, marked trashed, so a rescan won't import " +
        "it if it's restored. Un-ignore it later to allow that.",
      { title: "Trash ignored folder", kind: "warning" },
    );
    if (!ok) return;
    setBusy(path);
    setError(null);
    try {
      await trashIgnoredFolder(path);
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.path === path
              ? { ...r, trashed: true, exists: false, hasAudio: false }
              : r,
          ) ?? null,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function clearMissing() {
    const ok = await ask(
      `Drop ${missingCount} ignored folder${missingCount === 1 ? "" : "s"} that ` +
        "no longer exist on disk? If one comes back at the same path, a rescan " +
        "will import it. Trashed folders are kept.",
      { title: "Clear folders not on disk", kind: "warning" },
    );
    if (!ok) return;
    setBusy("__clear__");
    setError(null);
    try {
      const n = await clearMissingIgnoredFolders();
      setCleared(n);
      setRows(await listMergedPaths());
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
          imports it as a new release; that works for trashed folders too, once
          they're back on disk. Highlighted rows are on disk with audio in them
          — a rescan is hiding them now. Trash moves a folder to the system
          Trash and keeps it ignored.
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
              {missingCount > 0 && (
                <button
                  onClick={clearMissing}
                  disabled={busy !== null}
                  title="Drop rows whose folder is gone from disk (trashed rows are kept)"
                  className="shrink-0 text-[11px] text-muted hover:text-fg disabled:opacity-40"
                >
                  {busy === "__clear__"
                    ? "clearing…"
                    : `clear ${missingCount} not on disk`}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 mb-2 px-2 min-h-[1.5rem] text-[11px]">
              <Tick
                checked={allTicked}
                onClick={() =>
                  setSelected(
                    allTicked ? new Set() : new Set(shown.map((r) => r.path)),
                  )
                }
                title={allTicked ? "Untick all" : "Tick every folder shown"}
                label="Select all shown"
              />
              {selected.size === 0 ? (
                <span className="text-muted">
                  tick folders to act on several at once (shift-click for a run)
                </span>
              ) : (
                <>
                  <span className="text-accent font-medium">
                    {progress ?? `${picked.length} selected`}
                  </span>
                  {toTrash.length > 0 && (
                    <button
                      onClick={trashSelected}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded
                                 bg-alert/15 text-alert hover:bg-alert/25
                                 disabled:opacity-40"
                    >
                      <Trash2 size={11} /> Trash {toTrash.length}
                    </button>
                  )}
                  {toDrop.length > 0 && (
                    <button
                      onClick={dropSelected}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded
                                 bg-alert/15 text-alert hover:bg-alert/25
                                 disabled:opacity-40"
                    >
                      <X size={11} /> Drop {toDrop.length}
                    </button>
                  )}
                  {toUnignore.length > 0 && (
                    <button
                      onClick={unIgnoreSelected}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded
                                 bg-accent/15 text-accent hover:bg-accent/25
                                 disabled:opacity-40"
                    >
                      <Undo2 size={11} /> Un-ignore {toUnignore.length}
                    </button>
                  )}
                  <button
                    onClick={() => setSelected(new Set())}
                    disabled={busy !== null}
                    className="ml-auto text-muted hover:text-fg disabled:opacity-40"
                  >
                    clear
                  </button>
                </>
              )}
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
                  <span className="pt-0.5">
                    <Tick
                      checked={selected.has(r.path)}
                      onClick={(e) => toggle(r.path, e)}
                      title="Select (shift-click for a run)"
                      label={`Select ${r.path}`}
                    />
                  </span>
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
                  {r.exists && (
                    <button
                      onClick={() => trashFolder(r.path)}
                      disabled={busy !== null}
                      title="Move this folder to the Trash; it stays ignored"
                      aria-label="Trash folder"
                      className="shrink-0 px-1.5 py-0.5 rounded text-muted
                                 hover:text-alert hover:bg-alert/10 text-[11px]
                                 transition-colors inline-flex items-center
                                 disabled:opacity-40"
                    >
                      {busy === r.path ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Trash2 size={11} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => unIgnore(r.path, isTrashed(r))}
                    disabled={busy !== null}
                    title={
                      isTrashed(r)
                        ? "Drop from the discography — ndisc forgets this folder entirely; if it ever comes back, a rescan imports it"
                        : "Drop this folder from the ignore list — the next rescan imports it"
                    }
                    className="shrink-0 px-2 py-0.5 rounded bg-accent/15 text-accent
                               hover:bg-accent hover:text-bg text-[11px] font-medium
                               transition-colors inline-flex items-center gap-1
                               disabled:opacity-40"
                  >
                    {busy === r.path ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : isTrashed(r) ? (
                      <X size={11} />
                    ) : (
                      <Undo2 size={11} />
                    )}
                    {isTrashed(r) ? "Drop" : "Un-ignore"}
                  </button>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="py-6 text-center text-muted text-xs">
                  no folder matches
                </li>
              )}
            </ul>

            {cleared !== null && (
              <p className="mt-3 text-[11px] text-ok">
                Cleared {cleared} folder{cleared === 1 ? "" : "s"} not on disk.
              </p>
            )}
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
  if (r.trashed && !r.exists) {
    return r.survivorId === null
      ? "deleted, folder trashed"
      : `duplicate of ${survivor(r)}, folder trashed`;
  }
  if (r.survivorId === null)
    return `deleted, ${r.trashed ? "trashed earlier" : "files kept"} · ${state}`;
  return `duplicate of ${survivor(r)}${r.trashed ? " · trashed" : ""} · ${state}`;
}

function survivor(r: MergedPath): string {
  return r.survivorArtist || r.survivorTitle
    ? `${r.survivorArtist ?? "?"} — ${r.survivorTitle ?? "?"}`
    : `release #${r.survivorId} (gone)`;
}
