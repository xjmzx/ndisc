import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Circle,
  Copy,
  KeyRound,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
import {
  checkRelays,
  generateKeypair,
  importKeypair,
  publishByIds,
  unpublishByIds,
  type PublishLibrarySummary,
  publishBlossomServers,
  type PublishProgress,
  type RelayHealth,
} from "../lib/tauri";
import { publishStateMeta } from "../lib/publishState";
import type { FilterContext } from "./ReleaseList";

interface NostrPanelProps {
  relays: string[];
  setRelays: (next: string[]) => void;
  // Blossom servers holding cover images, in order: first is the primary.
  blossomServers: string[];
  setBlossomServers: (next: string[]) => void;
  filterContext: FilterContext;
  npub: string | null;
  onIdentityChanged: (next: string | null) => void;
  // The keyring backend this build actually compiled in, from keyring_backend().
  // Passed in rather than named here: this panel used to hardcode "libsecret on
  // Linux" on every platform, which is the exact bug keyring_backend() was added
  // to end (see its doc comment in lib.rs). Shares the one value App.tsx already
  // fetches for the footer, so the two cannot drift apart again.
  keyringStore: string;
  // The Relays & servers window. Lifted to App so the release list's ⋮ menu
  // can open it too.
  relaysOpen: boolean;
  setRelaysOpen: (open: boolean) => void;
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
    f.publishStateFilter !== null ||
    f.labelFilter !== null ||
    f.genreFilter !== null ||
    f.videoFilter !== null ||
    f.coverLinkFilter !== null ||
    f.sourceFilter !== null ||
    f.sourceLinkFilter !== null
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
  if (f.sourceFilter?.startsWith("source:"))
    parts.push(`source ${f.sourceFilter.slice("source:".length)}`);
  if (f.sourceFilter === "unset") parts.push("no source set");
  if (f.sourceLinkFilter === "with_source") parts.push("has source link");
  if (f.sourceLinkFilter === "without_source") parts.push("no source link");
  if (f.query.trim()) parts.push(`search "${f.query.trim()}"`);
  return parts.join(", ");
}

export function NostrPanel({
  relays,
  setRelays,
  blossomServers,
  setBlossomServers,
  filterContext,
  npub,
  onIdentityChanged,
  keyringStore,
  relaysOpen,
  setRelaysOpen,
}: NostrPanelProps) {
  const [newRelay, setNewRelay] = useState("");

  // Relay liveness, keyed by url. Probed whenever an identity is loaded: the
  // summary button on Home shows it, and the Relays & servers window lists it.
  const [health, setHealth] = useState<Map<string, RelayHealth>>(new Map());
  const [checking, setChecking] = useState(false);
  const relayKey = relays.join(",");

  useEffect(() => {
    if (!npub || relays.length === 0) return;
    let cancelled = false;

    async function probe() {
      setChecking(true);
      try {
        const rows = await checkRelays(relays);
        if (cancelled) return;
        setHealth(new Map(rows.map((r) => [r.relay, r])));
      } catch {
        if (!cancelled) setHealth(new Map());
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    probe();
    // Re-probe periodically so a relay that drops (or comes back) is visible
    // without a relaunch. 60s is slow enough to be free, fast enough to notice.
    const timer = setInterval(probe, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [npub, relayKey]);

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

  const [newBlossom, setNewBlossom] = useState("");
  // Result of the last server-list publish (kind:10063), shown under the list.
  const [blossomNote, setBlossomNote] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [publishingBlossom, setPublishingBlossom] = useState(false);

  function addBlossom() {
    const typed = newBlossom.trim().replace(/\/+$/, "");
    if (!typed) return;
    // A bare hostname means https — the same rule the backend applies.
    const url = typed.includes("://") ? typed : `https://${typed}`;
    if (!/^https?:\/\/[^/]+/.test(url)) {
      setBlossomNote({ ok: false, text: "a Blossom server is an http(s) address" });
      return;
    }
    if (!blossomServers.includes(url)) {
      setBlossomServers([...blossomServers, url]);
    }
    setNewBlossom("");
    setBlossomNote(null);
  }

  async function onPublishBlossomServers() {
    if (publishingBlossom) return;
    setPublishingBlossom(true);
    setBlossomNote(null);
    try {
      const r = await publishBlossomServers(blossomServers, relays);
      setBlossomNote({
        ok: true,
        text: `server list published to ${r.acceptedBy.length}/${relays.length} relay${relays.length === 1 ? "" : "s"}`,
      });
    } catch (e) {
      setBlossomNote({ ok: false, text: String(e) });
    } finally {
      setPublishingBlossom(false);
    }
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

  // Summary dot: purple when every relay answers, amber when some do, red when
  // none do, grey while unknown.
  const connectedCount = relays.filter((r) => health.get(r)?.ok).length;
  const relayDotClass =
    relays.length === 0
      ? "text-alert"
      : health.size === 0
        ? "text-muted"
        : connectedCount === relays.length
          ? "text-nostr"
          : connectedCount === 0
            ? "text-alert"
            : "text-warn";

  function confirmRevealed() {
    setRevealedNsec(null);
  }

  return (
    <Section title="">
      {phase === "loggedOut" && (
        <>
          <p className="text-xs text-muted">
            ndisc uses a Nostr keypair to sign your published releases.
            Generate a new identity or paste an existing nsec — your secret
            key is stored in the OS keychain ({keyringStore}), never in
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
          {/* One row: relay + server summary (opens the Relays & servers
              window) on the left, publishing on the right. Publishing stays
              on Home because it acts on the release list's current filter. */}
          <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-8">
            <button
              type="button"
              onClick={() => setRelaysOpen(true)}
              title="Relays and Blossom servers — open the list"
              /* On a wide row the summary and the two publish buttons are
                 three equal widths. The row has two gaps, gap-8 (2rem) here
                 and gap-2 (0.5rem) between the buttons, so one third of what
                 is left is (100% - 2.5rem) / 3; the buttons split the rest
                 evenly and come out the same. Change either gap and this
                 calc with it. */
              className="shrink-0 inline-flex items-center justify-center gap-2
                         px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                         text-xs text-fg transition-colors
                         lg:w-[calc((100%-2.5rem)/3)]"
            >
              <Circle
                size={8}
                fill="currentColor"
                className={cn("shrink-0", relayDotClass)}
                aria-hidden="true"
              />
              <span>
                <span className="font-mono">{relays.length}</span>{" "}
                {relays.length === 1 ? "relay" : "relays"} ·{" "}
                <span className="font-mono">{blossomServers.length}</span>{" "}
                {blossomServers.length === 1 ? "server" : "servers"}
              </span>
            </button>
            <div className="flex-1 min-w-0">
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
          </div>
          {error && <div className="mt-2 text-alert text-xs">{error}</div>}
          {relaysOpen && (
            <RelaysDialog
              relays={relays}
              setRelays={setRelays}
              health={health}
              checking={checking}
              newRelay={newRelay}
              setNewRelay={setNewRelay}
              addRelay={addRelay}
              blossomServers={blossomServers}
              setBlossomServers={setBlossomServers}
              newBlossom={newBlossom}
              setNewBlossom={setNewBlossom}
              addBlossom={addBlossom}
              onPublishBlossomServers={onPublishBlossomServers}
              publishingBlossom={publishingBlossom}
              blossomNote={blossomNote}
              onClose={() => setRelaysOpen(false)}
            />
          )}
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
        <div className="flex gap-2">
        <button
          onClick={() => onAskConfirm("publish")}
          disabled={disabled}
          className={`${DB_BUTTON_CLS} flex-1 min-w-0 justify-center font-semibold
                      disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Upload size={14} />{" "}
          {filterActive ? `Publish ${countLabel}` : "Publish library"}
        </button>
        <button
          onClick={() => onAskConfirm("unpublish")}
          disabled={disabled}
          title="Broadcast kind:5 deletions to retract these releases from relays"
          /* Sits in the same mauve family as Publish (bg-mauve/15) but at a
             heavier fill, so the two read as a pair while staying tellable
             apart at a glance. The fill is DELIBERATELY static on hover —
             Publish inverts its fill, so holding this one still and shifting
             only the icon + label (black → mauve) keeps the destructive action
             from flashing a big solid block under the cursor. */
          className="flex-1 min-w-0 flex items-center justify-center gap-1.5
                     px-3 py-1.5 rounded-md text-xs bg-mauve/35 text-bg
                     font-semibold hover:text-mauve
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
        >
          <Trash2 size={14} />{" "}
          {filterActive ? `Unpublish ${countLabel}` : "Unpublish library"}
        </button>
        </div>
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
      <div className="rounded-md border border-warn/40 bg-warn/10 p-3">
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

interface RelaysDialogProps {
  relays: string[];
  setRelays: (r: string[]) => void;
  health: Map<string, RelayHealth>;
  checking: boolean;
  newRelay: string;
  setNewRelay: (v: string) => void;
  addRelay: () => void;
  blossomServers: string[];
  setBlossomServers: (s: string[]) => void;
  newBlossom: string;
  setNewBlossom: (v: string) => void;
  addBlossom: () => void;
  onPublishBlossomServers: () => void;
  publishingBlossom: boolean;
  blossomNote: { ok: boolean; text: string } | null;
  onClose: () => void;
}

// Relays and Blossom servers, as plain rows: set up once, checked now and
// then, so they live in a window rather than on Home. Rows scale to any
// number of servers without reflowing anything else.
function RelaysDialog(p: RelaysDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  const input =
    "flex-1 min-w-0 px-3 py-1.5 rounded-md bg-surface text-fg placeholder:text-muted " +
    "outline-none border border-transparent focus:border-accent/50 text-xs font-mono";
  const row = "flex items-center gap-3 px-2 py-1.5 rounded bg-surface/30 text-xs";

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center p-4
                 bg-bg/70 backdrop-blur-sm"
      onClick={p.onClose}
    >
      <div
        className="w-full max-w-2xl mt-16 max-h-[calc(100%-6rem)] overflow-y-auto
                   rounded-lg border border-surface/70 bg-panel shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-fg">Relays &amp; servers</h3>
          <button
            onClick={p.onClose}
            className="text-muted hover:text-fg"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <h4 className="text-xs text-muted mb-1">
          Relays — where releases are published
          {p.checking && <span className="ml-2 text-[10px]">checking…</span>}
        </h4>
        <ul className="space-y-1 mb-2">
          {p.relays.map((r) => {
            const h = p.health.get(r);
            return (
              <li key={r} className={row}>
                <Circle
                  size={8}
                  fill="currentColor"
                  className={cn(
                    "shrink-0",
                    h?.ok ? "text-nostr" : h ? "text-alert" : "text-muted",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-fg">{r}</span>
                <span
                  className={cn(
                    "shrink-0 w-32 text-right text-[11px]",
                    h?.ok ? "text-muted" : h ? "text-alert" : "text-muted",
                  )}
                  title={h && !h.ok ? (h.error ?? "unreachable") : undefined}
                >
                  {h?.ok
                    ? `connected · ${h.rttMs}ms`
                    : h
                      ? "unreachable"
                      : p.checking
                        ? "checking…"
                        : "—"}
                </span>
                <button
                  onClick={() => p.setRelays(p.relays.filter((x) => x !== r))}
                  className="shrink-0 text-muted hover:text-alert"
                  aria-label={`Remove ${r}`}
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
          {p.relays.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-alert">
              No relays — add one to publish.
            </li>
          )}
        </ul>
        <div className="flex gap-2 mb-5">
          <input
            type="text"
            value={p.newRelay}
            onChange={(e) => p.setNewRelay(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && p.addRelay()}
            placeholder="wss://relay.example.com"
            className={input}
            spellCheck={false}
          />
          <button
            onClick={p.addRelay}
            disabled={!p.newRelay.trim()}
            className={`${DB_BUTTON_CLS} disabled:opacity-50`}
          >
            Add
          </button>
        </div>

        <h4 className="text-xs text-muted mb-1">
          Blossom servers — where cover images are stored, by their hash. The
          first is the primary that cover URLs point at; the rest are mirrors.
        </h4>
        <ul className="space-y-1 mb-2">
          {p.blossomServers.map((srv, i) => (
            <li key={srv} className={row}>
              <span className="min-w-0 flex-1 truncate font-mono text-fg">{srv}</span>
              <span className="shrink-0 w-32 text-right text-[11px] text-muted">
                {i === 0 ? "primary" : "mirror"}
              </span>
              <button
                onClick={() =>
                  p.setBlossomServers(p.blossomServers.filter((x) => x !== srv))
                }
                className="shrink-0 text-muted hover:text-alert"
                aria-label={`Remove ${srv}`}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text"
            value={p.newBlossom}
            onChange={(e) => p.setNewBlossom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && p.addBlossom()}
            placeholder="https://blossom.example.com"
            className={input}
            spellCheck={false}
          />
          <button
            onClick={p.addBlossom}
            disabled={!p.newBlossom.trim()}
            className={`${DB_BUTTON_CLS} disabled:opacity-50`}
          >
            Add
          </button>
        </div>
        {p.blossomServers.length > 0 && (
          <button
            onClick={p.onPublishBlossomServers}
            disabled={p.publishingBlossom || p.relays.length === 0}
            className="mt-2 px-2 py-1 rounded bg-nostr/15 text-nostr
                       hover:bg-nostr hover:text-bg text-[11px] font-medium
                       transition-colors disabled:opacity-50"
            title="Publish this list to your relays (kind:10063) so readers can find a cover by its hash on any of these servers"
          >
            {p.publishingBlossom ? "publishing…" : "Publish server list"}
          </button>
        )}
        {p.blossomNote && (
          <div
            className={cn(
              "mt-1 text-[11px]",
              p.blossomNote.ok ? "text-ok" : "text-alert",
            )}
          >
            {p.blossomNote.text}
          </div>
        )}
      </div>
    </div>
  );
}
