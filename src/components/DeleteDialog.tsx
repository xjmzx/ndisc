import { useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { cn } from "../lib/cn";
import {
  deleteRelease,
  deleteReleaseWithFiles,
  deleteReleaseIgnorePath,
  type Release,
  type ResolveSummary,
} from "../lib/tauri";
import { hasLiveEvent } from "./MergeConfirm";

function fmtBytes(n: number): string {
  if (n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/** Delete a release, with a choice about the files on disk.
 *
 *  Two genuinely different intents, so they are two buttons rather than a
 *  checkbox: "I catalogued this wrong" (drop the row, keep the music) versus
 *  "I don't want this music" (drop both). Trashing is offered only for
 *  unpublished releases with a folder inside the library root — the backend
 *  refuses anything else. */
export function DeleteDialog({
  release,
  onCancel,
  onDone,
}: {
  release: Release;
  onCancel: () => void;
  onDone: (mode: "row" | "ignore" | "files", summary?: ResolveSummary) => void;
}) {
  const [busy, setBusy] = useState<null | "row" | "ignore" | "files">(null);
  const [error, setError] = useState<string | null>(null);

  const published = hasLiveEvent(release);
  const dir = (release.filePath ?? "").trim();
  // Why trashing isn't on the table, when it isn't.
  const blocked = published
    ? "published — Unpublish it first, so no naddr points at missing files"
    : !dir
      ? "no folder on disk for this release"
      : null;

  const details = [
    release.medium && `medium: ${release.medium}`,
    release.year && `year: ${release.year}`,
    release.format && `format: ${release.format}`,
    release.catalogNumber && `catalog: ${release.catalogNumber}`,
    release.discogsId && `discogs: ${release.discogsId}`,
  ].filter(Boolean) as string[];

  async function run(mode: "row" | "ignore" | "files") {
    if (!release.id) return;
    setBusy(mode);
    setError(null);
    try {
      if (mode === "row") {
        await deleteRelease(release.id);
        onDone("row");
      } else if (mode === "ignore") {
        await deleteReleaseIgnorePath(release.id);
        onDone("ignore");
      } else {
        onDone("files", await deleteReleaseWithFiles(release.id));
      }
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

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
            <Trash2 size={14} /> Delete release
          </h3>
          <button onClick={onCancel} className="text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="text-xs text-fg/90">
          {release.artist} — {release.title}
        </div>
        {details.length > 0 && (
          <div className="mt-0.5 text-[11px] text-muted">{details.join(" · ")}</div>
        )}
        {dir && (
          <div className="mt-0.5 text-[11px] text-muted truncate" title={dir}>
            {dir}
          </div>
        )}

        <div className="mt-3 space-y-2">
          <button
            onClick={() => run("row")}
            disabled={busy !== null}
            className="w-full text-left rounded border border-surface/60 bg-surface/20
                       hover:border-accent/50 p-2 disabled:opacity-40 transition-colors"
          >
            <div className="text-xs text-fg/90 inline-flex items-center gap-1.5">
              {busy === "row" && <Loader2 size={12} className="animate-spin" />}
              Remove from library
            </div>
            <div className="text-[11px] text-muted">
              Drops the database row only — the files stay exactly where they are.
              {dir && " A rescan will find the folder again and re-import it."}
              {published && (
                <span className="text-nostr">
                  {" "}
                  Its published Nostr event stays live until you Unpublish it.
                </span>
              )}
            </div>
          </button>

          {dir && (
            <button
              onClick={() => run("ignore")}
              disabled={busy !== null}
              className="w-full text-left rounded border border-surface/60 bg-surface/20
                         hover:border-accent/50 p-2 disabled:opacity-40 transition-colors"
            >
              <div className="text-xs text-fg/90 inline-flex items-center gap-1.5">
                {busy === "ignore" && <Loader2 size={12} className="animate-spin" />}
                Remove and don't re-import
              </div>
              <div className="text-[11px] text-muted">
                Drops the row and keeps the files, but records the folder so a
                rescan won't bring it back. For folders you want on disk but not
                in the catalogue. Undoable.
              </div>
            </button>
          )}

          <button
            onClick={() => run("files")}
            disabled={busy !== null || blocked !== null}
            title={blocked ?? "Move the folder to Trash — ndisc cannot undo this"}
            className={cn(
              "w-full text-left rounded border p-2 transition-colors",
              blocked
                ? "border-surface/60 bg-surface/10 opacity-50 cursor-not-allowed"
                : "border-alert/50 bg-alert/10 hover:border-alert",
            )}
          >
            <div className="text-xs text-alert inline-flex items-center gap-1.5">
              {busy === "files" && <Loader2 size={12} className="animate-spin" />}
              Remove and move files to Trash
            </div>
            <div className="text-[11px] text-muted">
              {blocked ? (
                <span className="inline-flex items-center gap-1 text-warn">
                  <AlertTriangle size={11} /> unavailable — {blocked}
                </span>
              ) : (
                "Drops the row and moves the folder to your desktop Trash. Recoverable there; ndisc cannot undo it."
              )}
            </div>
          </button>
        </div>

        {error && <div className="mt-2 text-[11px] text-alert">{error}</div>}

        <div className="mt-3 flex justify-end">
          <button
            onClick={onCancel}
            disabled={busy !== null}
            className="text-[11px] text-muted hover:text-fg disabled:opacity-40"
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export { fmtBytes };
