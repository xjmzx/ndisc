import { useState } from "react";
import { FileWarning, Loader2, UploadCloud, X } from "lucide-react";
import { queueForRepublish, type ContentAudit } from "../lib/tauri";

// Read-only review of releases whose published event no longer matches the
// catalogue row. Nothing here writes: the audit reports, the operator decides
// (republish from the normal Publish flow, or edit the row).
export function ContentAuditDialog({
  audit,
  onClose,
  onQueued,
}: {
  audit: ContentAudit;
  onClose: () => void;
  onQueued?: (n: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function queueAll() {
    setBusy(true);
    setError(null);
    try {
      const n = await queueForRepublish(audit.drifted.map((d) => d.id));
      setQueued(n);
      onQueued?.(n);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
            <FileWarning size={15} /> Published content audit
            <span className="text-muted font-normal">
              · {audit.drifted.length} drifted of {audit.found}
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
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-[11px] text-muted">
            What the relays are serving, against what this release would emit
            today. The audit itself changes nothing.
          </p>
          {audit.drifted.length > 0 && (
            <button
              onClick={queueAll}
              disabled={busy || queued !== null}
              className="shrink-0 text-[11px] text-nostr hover:text-fg inline-flex
                items-center gap-1 disabled:opacity-50"
              title="Mark these for republish. Nothing is signed or sent — they move into the unpublished bucket for the next Publish pass."
            >
              {busy ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <UploadCloud size={11} />
              )}
              {queued === null
                ? `queue all ${audit.drifted.length} for republish`
                : `queued ${queued}`}
            </button>
          )}
        </div>

        {audit.drifted.length === 0 ? (
          <div className="py-8 text-center text-muted text-sm">
            Every published release matches the wire. 🎉
          </div>
        ) : (
          <div className="space-y-3">
            {audit.drifted.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-surface/60 bg-surface/20 p-3"
              >
                <div className="text-xs text-fg/90 font-medium mb-2 truncate">
                  {r.artist} — {r.title}
                </div>
                <table className="w-full table-fixed text-[11px] font-mono">
                  <thead>
                    <tr className="text-muted">
                      <th className="text-left font-normal w-[12%]">tag</th>
                      <th className="text-left font-normal w-[44%]">
                        on relays
                      </th>
                      <th className="text-left font-normal w-[44%]">
                        would emit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.diffs.map((d) => (
                      <tr key={d.tag} className="align-top">
                        <td className="text-muted pr-2">{d.tag}</td>
                        <td className="text-warn pr-2 break-all">
                          {d.published ?? <span className="text-muted">—</span>}
                        </td>
                        <td className="text-ok break-all">
                          {d.local ?? <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {audit.absent.length > 0 && (
          <p className="mt-3 text-[11px] text-alert font-mono break-all">
            believed published but no relay is serving:{" "}
            {audit.absent.join(", ")}
          </p>
        )}
        {error && (
          <p className="mt-2 text-[11px] text-alert font-mono break-all">
            {error}
          </p>
        )}
        {audit.errors.length > 0 && (
          <p className="mt-2 text-[11px] text-alert font-mono break-all">
            {audit.errors.map((e) => `${e.relay}: ${e.error}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
