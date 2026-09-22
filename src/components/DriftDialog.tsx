import { useCallback, useEffect, useState } from "react";
import { FileWarning, Loader2, RotateCw, X } from "lucide-react";
import {
  dismissDriftKeys,
  driftKey,
  withoutDismissed,
} from "../lib/driftDismiss";
import { refreshRelease, type ReleaseDrift } from "../lib/tauri";

// Review of curated fields that disagree with the files on disk.
//
// A library scan NEVER applies these — it only reports them (see
// `refresh_release_inner`, `trust_files = false`). This is where you decide.
// Two outcomes per release:
//
//   Apply   — take the file's values. This runs the ordinary per-release
//             Refresh, so it is a whole-release "trust the file" action, not a
//             single-field patch: any other disk-derived field moves too, and
//             a published release drops to "stale" for republish.
//   Dismiss — keep your value. Remembered against THIS file value, so a later
//             genuine retag surfaces again.
export function DriftDialog({
  drifts,
  onClose,
  onApplied,
  onChanged,
}: {
  drifts: ReleaseDrift[];
  onClose: () => void;
  onApplied: () => void;
  /** Fired whenever the undismissed set shrinks, so the banner can re-count. */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ReleaseDrift[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(withoutDismissed(drifts));
  }, [drifts]);

  useEffect(() => {
    load();
  }, [load]);

  function dismiss(r: ReleaseDrift) {
    dismissDriftKeys(r.fields.map((f) => driftKey(r.id, f)));
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    onChanged();
  }

  async function apply(r: ReleaseDrift) {
    setBusy(r.id);
    setError(null);
    try {
      await refreshRelease(r.id);
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      onChanged();
      onApplied();
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
        className="w-full max-w-3xl mt-4 mb-4 max-h-[calc(100%-2rem)] overflow-y-auto
                   rounded-lg border border-surface/70 bg-panel shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-fg inline-flex items-center gap-1.5">
            <FileWarning size={15} /> Drift review
            <span className="text-muted font-normal">
              · {rows.length} release{rows.length === 1 ? "" : "s"}
            </span>
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
          The scan found these disagreements and changed nothing. Your value is
          kept unless you apply the file's.
        </p>

        {rows.length === 0 ? (
          <div className="py-8 text-center text-muted text-sm">
            Nothing to review. 🎉
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-surface/60 bg-surface/20 p-3"
              >
                <div className="flex items-center justify-between mb-2 gap-3">
                  <div className="text-xs text-fg/90 font-medium truncate">
                    {r.artist} — {r.title}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => dismiss(r)}
                      className="text-[11px] text-muted hover:text-fg"
                      title="Keep my value. Asks again only if the file changes."
                    >
                      keep mine
                    </button>
                    <button
                      onClick={() => apply(r)}
                      disabled={busy === r.id}
                      className="text-[11px] text-nostr hover:text-fg inline-flex items-center gap-1 disabled:opacity-50"
                      title="Take the file's values — runs the per-release Refresh, so other disk-derived fields update too and a published release goes stale."
                    >
                      {busy === r.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <RotateCw size={11} />
                      )}
                      use file
                    </button>
                  </div>
                </div>

                <table className="w-full table-fixed text-[11px] font-mono">
                  <thead>
                    <tr className="text-muted">
                      <th className="text-left font-normal w-[12%]">field</th>
                      <th className="text-left font-normal w-[44%]">
                        yours (kept)
                      </th>
                      <th className="text-left font-normal w-[44%]">on disk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.fields.map((f) => (
                      <tr key={f.field} className="align-top">
                        <td className="text-muted pr-2">{f.field}</td>
                        <td className="text-ok pr-2 break-all">{f.current}</td>
                        <td className="text-warn break-all">{f.onDisk}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-alert font-mono break-all">{error}</p>
        )}
      </div>
    </div>
  );
}
