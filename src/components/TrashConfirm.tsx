import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import {
  auditReleaseFolder,
  resolveDuplicate,
  type FolderAudit,
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

// Filenames of the same track rarely match across two rips ("01 - Polly.flac"
// vs "Nirvana_Nevermind_06_Polly.flac"), so compare on a squashed form and treat
// one containing the other as a match. Deliberately loose: a false "unique"
// warning is cheap, a missed one costs you a track.
const squash = (f: string) =>
  f
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

function onlyHere(mine: string[], theirs: string[]): string[] {
  const t = theirs.map(squash).filter(Boolean);
  return mine.filter((f) => {
    const s = squash(f);
    return !!s && !t.some((u) => u.includes(s) || s.includes(u));
  });
}

/** Resolve a duplicate by trashing one copy's folder. Shows what each folder
 *  actually holds — size, format, and the tracks only IT has — so the choice is
 *  made on evidence. The trashed folder goes to the desktop Trash; ndisc cannot
 *  undo it. */
export function TrashConfirm({
  a,
  b,
  relays,
  onCancel,
  onResolved,
}: {
  a: Release;
  b: Release;
  relays: string[];
  onCancel: () => void;
  onResolved: (s: ResolveSummary) => void;
}) {
  const [audits, setAudits] = useState<Record<number, FolderAudit>>({});
  const [loading, setLoading] = useState(true);
  // The id whose folder will be TRASHED (the other is kept).
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(
      [a, b]
        .map((r) => r.id)
        .filter((id): id is number => id != null)
        .map((id) => auditReleaseFolder(id).then((f) => [id, f] as const)),
    )
      .then((rows) => {
        if (!live) return;
        setAudits(Object.fromEntries(rows));
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [a, b]);

  const keep = pick == null ? null : pick === a.id ? b : a;
  const doomed = pick == null ? null : pick === a.id ? a : b;
  const doomedAudit = pick == null ? undefined : audits[pick];
  const lost =
    doomed && keep
      ? onlyHere(
          audits[doomed.id!]?.tracks ?? [],
          audits[keep.id!]?.tracks ?? [],
        )
      : [];

  async function confirm() {
    if (!keep?.id || !doomed?.id) return;
    setBusy(true);
    setError(null);
    try {
      onResolved(await resolveDuplicate(keep.id, doomed.id, relays));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" /> reading folders…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted">
        Choose the copy to <span className="text-alert">remove</span>. Its folder
        moves to your desktop Trash; the other is kept.
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[a, b].map((r) => {
          const f = r.id != null ? audits[r.id] : undefined;
          const picked = pick === r.id;
          return (
            <button
              key={r.id}
              onClick={() => r.id != null && setPick(r.id)}
              className={cn(
                "text-left rounded border p-2 transition-colors",
                picked
                  ? "border-alert bg-alert/10"
                  : "border-surface/60 bg-surface/20 hover:border-alert/50",
              )}
            >
              <div className="text-[11px] text-fg/90 truncate">
                {picked ? "remove this" : "keep this"}
                {hasLiveEvent(r) && (
                  <span className="ml-1 text-nostr">· published</span>
                )}
              </div>
              <div className="text-[10px] text-muted truncate" title={f?.dir}>
                {f?.dir || "(no folder)"}
              </div>
              <div className="mt-1 text-[10px] text-fg/70">
                {f?.exists
                  ? `${f.fileCount} files · ${fmtBytes(f.totalBytes)}`
                  : "folder missing on disk"}
              </div>
              {f?.formats?.length ? (
                <div className="text-[10px] text-muted truncate">
                  {f.formats.join(" · ")}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      {pick != null && lost.length > 0 && (
        <div className="rounded border border-warn/50 bg-warn/10 p-2 text-[11px] text-warn">
          <div className="inline-flex items-center gap-1 font-medium">
            <AlertTriangle size={12} />
            {lost.length} track{lost.length === 1 ? "" : "s"} exist only in the
            copy you are removing
          </div>
          <ul className="mt-1 space-y-0.5 text-warn/90">
            {lost.slice(0, 6).map((t) => (
              <li key={t} className="truncate">
                · {t}
              </li>
            ))}
            {lost.length > 6 && <li>· +{lost.length - 6} more</li>}
          </ul>
        </div>
      )}

      {pick != null && hasLiveEvent(doomed!) && (
        <div className="text-[11px] text-nostr">
          That release is published — its event is retracted (kind:5) before the
          folder is trashed. If no relay accepts the retraction, nothing is
          removed.
        </div>
      )}

      {error && <div className="text-[11px] text-alert">{error}</div>}

      <div className="flex items-center justify-between">
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-[11px] text-muted hover:text-fg disabled:opacity-40"
        >
          cancel
        </button>
        <button
          onClick={confirm}
          disabled={busy || pick == null || !doomedAudit?.exists}
          title={
            doomedAudit?.exists === false
              ? "That folder isn't on disk"
              : "Move the folder to Trash — ndisc cannot undo this"
          }
          className="px-2.5 h-7 rounded bg-alert/15 text-alert hover:bg-alert
                     hover:text-bg transition-colors disabled:opacity-40
                     inline-flex items-center gap-1.5 text-xs"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Trash2 size={12} />
          )}
          {doomedAudit
            ? `Move ${doomedAudit.fileCount} files (${fmtBytes(doomedAudit.totalBytes)}) to Trash`
            : "Move to Trash"}
        </button>
      </div>
    </div>
  );
}
