import { useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Check, Loader2, StickyNote, Trash2, X } from "lucide-react";
import { clearReleaseNotes, type NoteGroup } from "../lib/tauri";

// Review every distinct note in the catalogue and clear the unwanted ones in
// bulk. Notes are a release's published content, and many arrived from file
// tags rather than from the owner — a store's "Visit https://…" line, a
// ripper's watermark. Grouped by text, sixty releases sharing one line are one
// tick rather than sixty edits.
//
// Clearing writes to the catalogue and marks the releases stale. It does not
// publish: the relays keep the old note until those releases are republished.
export function NotesReviewDialog({
  groups,
  onClose,
  onCleared,
}: {
  groups: NoteGroup[];
  onClose: () => void;
  // Called with the number of releases changed, after a successful clear.
  onCleared: (n: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? groups.filter((g) => g.note.toLowerCase().includes(q)) : groups;
  }, [groups, query]);

  const totalReleases = groups.reduce((n, g) => n + g.count, 0);
  const pickedGroups = groups.filter((g) => picked.has(g.note));
  const pickedReleases = pickedGroups.reduce((n, g) => n + g.count, 0);
  const pickedPublished = pickedGroups.reduce((n, g) => n + g.published, 0);
  const allShownPicked =
    shown.length > 0 && shown.every((g) => picked.has(g.note));

  function toggle(note: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(note)) next.delete(note);
      else next.add(note);
      return next;
    });
  }

  function toggleShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const g of shown) {
        if (allShownPicked) next.delete(g.note);
        else next.add(g.note);
      }
      return next;
    });
  }

  async function clearPicked() {
    if (busy || pickedReleases === 0) return;
    const yes = await ask(
      `Clear the notes on ${pickedReleases.toLocaleString()} release${
        pickedReleases === 1 ? "" : "s"
      } (${pickedGroups.length} distinct note${
        pickedGroups.length === 1 ? "" : "s"
      })?\n\n` +
        "The cleared text is kept on record in the database, and scans no " +
        "longer copy file comments back into notes." +
        (pickedPublished > 0
          ? `\n\n${pickedPublished.toLocaleString()} of these are published. ` +
            "They are marked stale; the relays keep the old note until you " +
            "publish them again."
          : ""),
      { title: "Clear notes", kind: "warning" },
    );
    if (!yes) return;
    setBusy(true);
    setError(null);
    try {
      const n = await clearReleaseNotes(pickedGroups.map((g) => g.note));
      setCleared(n);
      onCleared(n);
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
        className="w-full max-w-3xl mt-4 mb-4 max-h-[calc(100%-2rem)] flex flex-col
                   rounded-lg border border-surface/70 bg-panel shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-fg inline-flex items-center gap-1.5">
            <StickyNote size={15} /> Notes review
            <span className="text-muted font-normal">
              · {groups.length} distinct on {totalReleases.toLocaleString()}{" "}
              release{totalReleases === 1 ? "" : "s"}
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
          A release's note is published with it. Tick the ones that are not
          yours to say — store links and watermarks left in file tags — and
          clear them together. Nothing is published from here.
        </p>

        {cleared !== null ? (
          <div className="py-8 text-center text-sm text-fg">
            Cleared the notes on {cleared.toLocaleString()} release
            {cleared === 1 ? "" : "s"}.
            <div className="mt-1 text-[11px] text-muted">
              Publish the stale releases from the Nostr panel to take the old
              notes off the relays.
            </div>
          </div>
        ) : groups.length === 0 ? (
          <div className="py-8 text-center text-muted text-sm">
            No release has a note.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter notes…"
                className="flex-1 px-3 py-1.5 rounded-md bg-surface text-fg
                           placeholder:text-muted outline-none border
                           border-transparent focus:border-accent/50 text-xs"
                spellCheck={false}
              />
              <button
                onClick={toggleShown}
                className="shrink-0 text-[11px] text-muted hover:text-fg"
              >
                {allShownPicked ? "untick" : "tick"} the {shown.length} shown
              </button>
            </div>

            <ul className="flex-1 min-h-0 overflow-y-auto space-y-1">
              {shown.map((g) => (
                <li key={g.note}>
                  <label
                    className="flex items-start gap-2 px-2 py-1.5 rounded
                               bg-surface/20 hover:bg-surface/40 cursor-pointer"
                  >
                    {/* Our own box, not the platform's: WebKitGTK draws the
                        native one oversized with a clipped tick (see TickBox
                        in ReleaseDetail). The real input stays for keyboard
                        and a11y. */}
                    <span className="relative mt-0.5 shrink-0 grid place-items-center w-3.5 h-3.5">
                      <input
                        type="checkbox"
                        checked={picked.has(g.note)}
                        onChange={() => toggle(g.note)}
                        className="peer appearance-none m-0 w-3.5 h-3.5 rounded-[3px] cursor-pointer
                                   border border-muted/40 bg-surface/40 transition-colors
                                   hover:border-accent/50 checked:border-accent/70
                                   checked:bg-accent/15 focus-visible:outline
                                   focus-visible:outline-1 focus-visible:outline-accent"
                      />
                      <Check
                        size={10}
                        strokeWidth={3}
                        className="pointer-events-none absolute text-accent opacity-0
                                   peer-checked:opacity-100"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-mono text-fg break-words whitespace-pre-wrap">
                        {g.note}
                      </span>
                      <span className="block mt-0.5 text-[10px] text-muted truncate">
                        {g.examples.join(" · ")}
                        {g.count > g.examples.length &&
                          ` · and ${g.count - g.examples.length} more`}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-[10px] font-mono text-muted tabular-nums"
                      title={`${g.count} release${g.count === 1 ? "" : "s"}, ${g.published} published`}
                    >
                      {g.count}
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="py-6 text-center text-muted text-xs">
                  no note matches
                </li>
              )}
            </ul>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted">
                {pickedGroups.length === 0
                  ? "nothing ticked"
                  : `${pickedGroups.length} note${pickedGroups.length === 1 ? "" : "s"} ticked · ${pickedReleases.toLocaleString()} release${pickedReleases === 1 ? "" : "s"}`}
              </span>
              <button
                onClick={clearPicked}
                disabled={busy || pickedReleases === 0}
                className="shrink-0 px-2.5 py-1 rounded bg-alert/15 text-alert
                           hover:bg-alert hover:text-bg text-[11px] font-medium
                           transition-colors inline-flex items-center gap-1
                           disabled:opacity-40 disabled:hover:bg-alert/15
                           disabled:hover:text-alert"
              >
                {busy ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Trash2 size={11} />
                )}
                Clear notes on {pickedReleases.toLocaleString()} release
                {pickedReleases === 1 ? "" : "s"}
              </button>
            </div>
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
