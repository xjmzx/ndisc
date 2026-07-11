import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  KeyRound,
  Radio,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
import {
  generateKeypair,
  importKeypair,
  publishByIds,
  unpublishByIds,
  type PublishLibrarySummary,
  type PublishProgress,
} from "../lib/tauri";
import { publishStateMeta } from "../lib/publishState";
import type { FilterContext } from "./ReleaseList";

interface NostrPanelProps {
  relays: string[];
  setRelays: (next: string[]) => void;
  filterContext: FilterContext;
  npub: string | null;
  onIdentityChanged: (next: string | null) => void;
}

type Phase = "loggedOut" | "reveal" | "loggedIn";
type PublishPhase = "idle" | "confirm" | "running" | "done";
type LibraryAction = "publish" | "unpublish";

export interface ProfileMeta {
  name?: string;
  display_name?: string;
  nip05?: string;
  picture?: string;
}

// Every filter the release list applies must be reflected here — the bulk ops
// act on the exact visible id set, and this description is what the confirm
// dialog shows, so an omission would misrepresent the affected set.
function isFilterActive(f: FilterContext): boolean {
  return (
    f.query.trim() !== "" ||
    f.medium !== null ||
    f.needsCoverOnly ||
    f.publishStateFilter !== null ||
    f.labelFilter !== null ||
    f.genreFilter !== null ||
    f.videoFilter !== null ||
    f.coverLinkFilter !== null
  );
}

function describeFilter(f: FilterContext): string {
  const parts: string[] = [];
  if (f.medium) parts.push(f.medium);
  if (f.publishStateFilter)
    parts.push(publishStateMeta(f.publishStateFilter).label.toLowerCase());
  if (f.labelFilter === "with_label") parts.push("has label");
  if (f.labelFilter === "without_label") parts.push("no label");
  if (f.genreFilter === "with_genre") parts.push("has genre");
  if (f.genreFilter === "without_genre") parts.push("no genre");
  if (f.videoFilter === "with_video") parts.push("has video");
  if (f.videoFilter === "without_video") parts.push("audio-only");
  if (f.coverLinkFilter === "with_link") parts.push("has web image");
  if (f.coverLinkFilter === "without_link") parts.push("no web image");
  if (f.needsCoverOnly) parts.push("no cover");
  if (f.query.trim()) parts.push(`search "${f.query.trim()}"`);
  return parts.join(", ");
}

export function NostrPanel({
  relays,
  setRelays,
  filterContext,
  npub,
  onIdentityChanged,
}: NostrPanelProps) {
  const [newRelay, setNewRelay] = useState("");

  const [revealedNsec, setRevealedNsec] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [publishPhase, setPublishPhase] = useState<PublishPhase>("idle");
  // Which bulk op the confirm/running/done cycle refers to. Only one library
  // op runs at a time, so a single phase + action pair covers both.
  const [libraryAction, setLibraryAction] =
    useState<LibraryAction>("publish");
  const [publishProgress, setPublishProgress] =
    useState<PublishProgress | null>(null);
  const [publishSummary, setPublishSummary] =
    useState<PublishLibrarySummary | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const phase: Phase = revealedNsec
    ? "reveal"
    : npub
      ? "loggedIn"
      : "loggedOut";

  function addRelay() {
    const url = newRelay.trim();
    if (!url || relays.includes(url)) return;
    setRelays([...relays, url]);
    setNewRelay("");
  }

  async function onGenerate() {
    setError(null);
    setBusy(true);
    try {
      const kp = await generateKeypair();
      setRevealedNsec(kp.nsec);
      onIdentityChanged(kp.npub);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!pasteValue.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const n = await importKeypair(pasteValue.trim());
      setPasteValue("");
      onIdentityChanged(n);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Reset transient panel state when the user logs out from the header.
  useEffect(() => {
    if (npub !== null) return;
    setRevealedNsec(null);
    setPublishPhase("idle");
    setPublishProgress(null);
    setPublishSummary(null);
    setPublishError(null);
    setError(null);
  }, [npub]);

  async function runLibraryOp() {
    if (relays.length === 0) {
      setPublishError(
        libraryAction === "publish"
          ? "Add at least one relay before publishing."
          : "Add at least one relay before unpublishing.",
      );
      return;
    }
    setPublishError(null);
    setPublishSummary(null);
    setPublishProgress({
      current: 0,
      total: 0,
      title: "",
      artist: "",
      acceptedBy: [],
      rejected: [],
    });
    setPublishPhase("running");

    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<number>("publish:started", (e) => {
          setPublishProgress((p) => ({
            current: p?.current ?? 0,
            total: e.payload,
            title: p?.title ?? "",
            artist: p?.artist ?? "",
            acceptedBy: p?.acceptedBy ?? [],
            rejected: p?.rejected ?? [],
          }));
        }),
      );
      unlisteners.push(
        await listen<PublishProgress>("publish:progress", (e) => {
          setPublishProgress(e.payload);
        }),
      );

      // Act on exactly the ids the release list is showing — count, filter
      // description, and operation are all the same set, by construction.
      const ids = filterContext.visibleIds;
      const summary =
        libraryAction === "publish"
          ? await publishByIds(ids, relays)
          : await unpublishByIds(ids, relays);
      setPublishSummary(summary);
      setPublishPhase("done");
    } catch (e) {
      setPublishError(String(e));
      setPublishPhase("confirm");
    } finally {
      unlisteners.forEach((f) => f());
    }
  }

  function confirmRevealed() {
    setRevealedNsec(null);
  }

  return (
    <Section title="" icon={<Radio size={16} />}>
      {phase === "loggedOut" && (
        <>
          <p className="text-xs text-muted">
            ndisc uses a Nostr keypair to sign your published releases.
            Generate a new identity or paste an existing nsec — your secret
            key is stored in the OS keychain (libsecret on Linux), never in
            plain files.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onGenerate}
              disabled={busy}
              className="px-3 py-2 rounded-md bg-accent text-bg font-semibold
                         hover:opacity-90 disabled:opacity-50 flex items-center
                         gap-2 text-xs"
            >
              <KeyRound size={14} /> Generate new identity
            </button>
          </div>

          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted mb-1">
              or paste existing nsec
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onImport()}
                placeholder="nsec1…"
                className="flex-1 px-3 py-1.5 rounded-md bg-surface text-fg
                           placeholder:text-muted outline-none border
                           border-transparent focus:border-accent/50 text-xs
                           font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                onClick={onImport}
                disabled={busy || !pasteValue.trim()}
                className="px-3 py-1.5 rounded-md bg-surface
                           hover:bg-surfaceHover text-fg disabled:opacity-50
                           text-xs"
              >
                Import
              </button>
            </div>
          </div>

          {error && <div className="mt-2 text-alert text-xs">{error}</div>}
        </>
      )}

      {phase === "reveal" && revealedNsec && (
        <>
          <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-xs">
            <div className="flex items-center gap-2 text-warn font-semibold mb-1">
              <ShieldCheck size={14} /> Save this secret key
            </div>
            <p className="text-fg/90">
              This is the only time the nsec will be shown. Anyone with it
              can post as you and access this collection. Store it somewhere
              safe (password manager, paper backup) before continuing.
            </p>
          </div>

          <FieldRow label="nsec" value={revealedNsec} mono mask />

          <div className="mt-3 flex justify-end">
            <button
              onClick={confirmRevealed}
              className="px-3 py-1.5 rounded-md bg-accent text-bg
                         font-semibold hover:opacity-90 text-xs"
            >
              I've saved it · continue
            </button>
          </div>
        </>
      )}

      {phase === "loggedIn" && npub && (
        <>
          <div className="max-w-md">
            <div className="text-xs text-muted mb-1">Relays</div>
            <ul className="space-y-1 mb-2">
              {relays.map((r) => (
                <li
                  key={r}
                  className="px-2 py-1 rounded bg-bg/50 font-mono text-xs flex
                             items-center justify-between gap-2"
                >
                  <span className="truncate">{r}</span>
                  <button
                    onClick={() => setRelays(relays.filter((x) => x !== r))}
                    className="text-muted hover:text-alert text-xs"
                    aria-label={`Remove ${r}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                type="text"
                value={newRelay}
                onChange={(e) => setNewRelay(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRelay()}
                placeholder="wss://relay.example.com"
                className="flex-1 px-3 py-1.5 rounded-md bg-surface text-fg
                           placeholder:text-muted outline-none border
                           border-transparent focus:border-accent/50 text-xs
                           font-mono"
                spellCheck={false}
              />
              <button
                onClick={addRelay}
                disabled={!newRelay.trim()}
                className={`${DB_BUTTON_CLS} disabled:opacity-50`}
              >
                Add
              </button>
            </div>
          </div>

          <div className="max-w-md">
            <PublishLibraryBlock
              phase={publishPhase}
              action={libraryAction}
              progress={publishProgress}
              summary={publishSummary}
              relayCount={relays.length}
              error={publishError}
              filterContext={filterContext}
              onAskConfirm={(action) => {
                setLibraryAction(action);
                setPublishError(null);
                setPublishPhase("confirm");
              }}
              onCancel={() => setPublishPhase("idle")}
              onConfirm={runLibraryOp}
              onAcknowledgeDone={() => {
                setPublishPhase("idle");
                setPublishProgress(null);
                setPublishSummary(null);
              }}
            />
          </div>

          {error && <div className="mt-2 text-alert text-xs">{error}</div>}
        </>
      )}
    </Section>
  );
}

interface PublishLibraryBlockProps {
  phase: PublishPhase;
  action: LibraryAction;
  progress: PublishProgress | null;
  summary: PublishLibrarySummary | null;
  relayCount: number;
  error: string | null;
  filterContext: FilterContext;
  onAskConfirm: (action: LibraryAction) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onAcknowledgeDone: () => void;
}

function PublishLibraryBlock({
  phase,
  action,
  progress,
  summary,
  relayCount,
  error,
  filterContext,
  onAskConfirm,
  onCancel,
  onConfirm,
  onAcknowledgeDone,
}: PublishLibraryBlockProps) {
  const filterActive = isFilterActive(filterContext);
  const countLabel = `${filterContext.count.toLocaleString()} filtered release${
    filterContext.count === 1 ? "" : "s"
  }`;
  const filterDescription = filterActive ? describeFilter(filterContext) : "";
  const disabled = relayCount === 0 || filterContext.count === 0;
  if (phase === "idle") {
    return (
      <>
        <button
          onClick={() => onAskConfirm("publish")}
          disabled={disabled}
          className={`${DB_BUTTON_CLS} mt-3 w-full justify-center
                      disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Upload size={14} />{" "}
          {filterActive ? `Publish ${countLabel}` : "Publish library"}
        </button>
        <button
          onClick={() => onAskConfirm("unpublish")}
          disabled={disabled}
          title="Broadcast kind:5 deletions to retract these releases from relays"
          className="mt-2 w-full flex items-center justify-center gap-1.5
                     px-3 py-1.5 rounded-md text-xs text-alert
                     border border-alert/40 hover:bg-alert/10
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
        >
          <Trash2 size={14} />{" "}
          {filterActive ? `Unpublish ${countLabel}` : "Unpublish library"}
        </button>
        {filterActive && (
          <div className="mt-1 text-[10px] text-muted text-center">
            filter: {filterDescription}
          </div>
        )}
        {error && <div className="mt-2 text-alert text-xs">{error}</div>}
      </>
    );
  }

  if (phase === "confirm") {
    const count = filterActive ? filterContext.count : null;
    const scope = filterActive ? (
      <>
        <span className="font-mono text-accent">{count?.toLocaleString()}</span>{" "}
        release{count === 1 ? "" : "s"} matching the current filter (
        <span className="font-mono">{filterDescription}</span>)
      </>
    ) : (
      "Each release in your library"
    );
    return (
      <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3">
        <div className="flex items-center gap-2 text-warn font-semibold text-xs">
          <AlertTriangle size={14} />{" "}
          {action === "publish"
            ? "Publishing is public and permanent"
            : "Unpublishing broadcasts deletions"}
        </div>
        <p className="mt-1 text-xs text-fg/90">
          {action === "publish" ? (
            <>
              {scope} will be signed and broadcast to{" "}
              <span className="font-mono text-accent">{relayCount}</span>{" "}
              {relayCount === 1 ? "relay" : "relays"} as a kind:31237 event.
              Relays cache and indexers archive — once out there, the data is
              effectively forever.
            </>
          ) : (
            <>
              A kind:5 deletion referencing {scope} will be signed and sent to{" "}
              <span className="font-mono text-accent">{relayCount}</span>{" "}
              {relayCount === 1 ? "relay" : "relays"}, and the local publish
              markers cleared. Deletions are advisory — relays that don't honour
              kind:5 (and any cache or indexer) may keep the original events.
            </>
          )}
        </p>
        <div className="mt-2 flex justify-end gap-2 text-xs">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                       text-fg"
          >
            cancel
          </button>
          {action === "publish" ? (
            <button
              onClick={onConfirm}
              className="px-3 py-1.5 rounded-md bg-accent text-bg font-semibold
                         hover:opacity-90 flex items-center gap-1.5"
            >
              <Upload size={12} />{" "}
              {filterActive ? "Yes, publish filtered" : "Yes, publish all"}
            </button>
          ) : (
            <button
              onClick={onConfirm}
              className="px-3 py-1.5 rounded-md bg-alert text-bg font-semibold
                         hover:opacity-90 flex items-center gap-1.5"
            >
              <Trash2 size={12} />{" "}
              {filterActive ? "Yes, unpublish filtered" : "Yes, unpublish all"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "running" && progress) {
    const total = progress.total || 0;
    const ratio = total > 0 ? Math.min(1, progress.current / total) : 0;
    return (
      <div className="mt-3">
        <div className="text-xs text-muted">
          {action === "publish" ? "publishing" : "unpublishing"}{" "}
          {progress.current.toLocaleString()} / {total.toLocaleString()}
        </div>
        <div className="mt-1 h-2 rounded-full bg-surface overflow-hidden">
          <div
            className={`h-full transition-[width] duration-150 ${
              action === "publish" ? "bg-accent" : "bg-alert"
            }`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] font-mono text-fg/70 truncate">
          {progress.artist && progress.title
            ? `${progress.artist} — ${progress.title}`
            : "…"}
        </div>
        {progress.rejected.length > 0 && (
          <div className="mt-1 text-[10px] text-alert/80 truncate">
            last error: {progress.rejected[0].relay} —{" "}
            {progress.rejected[0].error}
          </div>
        )}
      </div>
    );
  }

  if (phase === "done" && summary) {
    return (
      <div className="mt-3">
        <div
          className={cn(
            "grid gap-2 text-xs",
            summary.skipped > 0 ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          <Tile label="total" value={summary.total} />
          <Tile
            label={action === "publish" ? "published" : "unpublished"}
            value={summary.published}
            tone="ok"
          />
          {summary.skipped > 0 && (
            <Tile label="skipped" value={summary.skipped} />
          )}
          <Tile label="failed" value={summary.failed} tone="alert" />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            onClick={onAcknowledgeDone}
            className="px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                       text-fg text-xs"
          >
            ok
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "alert";
}) {
  const valueCls =
    tone === "ok" ? "text-ok" : tone === "alert" ? "text-alert" : "text-fg";
  return (
    <div className="rounded-md bg-surface/50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`font-mono text-sm ${valueCls}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  mono,
  mask,
}: {
  label: string;
  value: string;
  mono?: boolean;
  mask?: boolean;
}) {
  const [shown, setShown] = useState(!mask);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const display = !shown
    ? value.slice(0, 8) + "…" + value.slice(-4)
    : value;

  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <div
          className={`flex-1 px-2 py-1.5 rounded-md bg-surface text-xs break-all ${
            mono ? "font-mono" : ""
          }`}
        >
          {display}
        </div>
        {mask && (
          <button
            onClick={() => setShown((v) => !v)}
            className="px-2 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                       text-muted text-[10px]"
          >
            {shown ? "hide" : "show"}
          </button>
        )}
        <button
          onClick={copy}
          className="px-2 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                     text-fg text-xs flex items-center gap-1"
          title="Copy to clipboard"
        >
          <Copy size={11} /> {copied ? "✓" : ""}
        </button>
      </div>
    </div>
  );
}
