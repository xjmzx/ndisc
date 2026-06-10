import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  KeyRound,
  Radio,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Section } from "./Section";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
import {
  generateKeypair,
  importKeypair,
  publishLibrary,
  type PublishLibrarySummary,
  type PublishProgress,
} from "../lib/tauri";

interface FilterContext {
  query: string;
  medium: "physical" | "digital" | null;
  needsCoverOnly: boolean;
  publishedFilter: "published" | "unpublished" | null;
  labelFilter: "with_label" | "without_label" | null;
  count: number;
}

interface NostrPanelProps {
  relays: string[];
  setRelays: (next: string[]) => void;
  filterContext: FilterContext;
  npub: string | null;
  onIdentityChanged: (next: string | null) => void;
}

type Phase = "loggedOut" | "reveal" | "loggedIn";
type PublishPhase = "idle" | "confirm" | "running" | "done";

export interface ProfileMeta {
  name?: string;
  display_name?: string;
  nip05?: string;
  picture?: string;
}

function isFilterActive(f: FilterContext): boolean {
  return (
    f.query.trim() !== "" ||
    f.medium !== null ||
    f.needsCoverOnly ||
    f.publishedFilter !== null ||
    f.labelFilter !== null
  );
}

function describeFilter(f: FilterContext): string {
  const parts: string[] = [];
  if (f.medium) parts.push(f.medium);
  if (f.publishedFilter) parts.push(f.publishedFilter);
  if (f.labelFilter === "with_label") parts.push("has label");
  if (f.labelFilter === "without_label") parts.push("no label");
  if (f.query.trim()) parts.push(`search "${f.query.trim()}"`);
  if (f.needsCoverOnly) parts.push("no cover");
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

  async function runPublishLibrary() {
    if (relays.length === 0) {
      setPublishError("Add at least one relay before publishing.");
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

      const summary = await publishLibrary(
        relays,
        isFilterActive(filterContext)
          ? {
              query: filterContext.query.trim() || undefined,
              medium: filterContext.medium ?? undefined,
              needsCover: filterContext.needsCoverOnly || undefined,
              publishedFilter: filterContext.publishedFilter ?? undefined,
              labelFilter: filterContext.labelFilter ?? undefined,
            }
          : undefined,
      );
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
    <Section title="Nostr" icon={<Radio size={16} />}>
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
              progress={publishProgress}
              summary={publishSummary}
              relayCount={relays.length}
              error={publishError}
              filterContext={filterContext}
              onAskConfirm={() => {
                setPublishError(null);
                setPublishPhase("confirm");
              }}
              onCancel={() => setPublishPhase("idle")}
              onConfirm={runPublishLibrary}
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
  progress: PublishProgress | null;
  summary: PublishLibrarySummary | null;
  relayCount: number;
  error: string | null;
  filterContext: FilterContext;
  onAskConfirm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onAcknowledgeDone: () => void;
}

function PublishLibraryBlock({
  phase,
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
  const buttonLabel = filterActive
    ? `Publish ${filterContext.count.toLocaleString()} filtered ` +
      `release${filterContext.count === 1 ? "" : "s"}`
    : "Publish library";
  const filterDescription = filterActive ? describeFilter(filterContext) : "";
  if (phase === "idle") {
    return (
      <>
        <button
          onClick={onAskConfirm}
          disabled={relayCount === 0 || (filterActive && filterContext.count === 0)}
          className={`${DB_BUTTON_CLS} mt-3 w-full justify-center
                      disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Upload size={14} /> {buttonLabel}
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
    return (
      <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3">
        <div className="flex items-center gap-2 text-warn font-semibold text-xs">
          <AlertTriangle size={14} /> Publishing is public and permanent
        </div>
        <p className="mt-1 text-xs text-fg/90">
          {filterActive ? (
            <>
              <span className="font-mono text-accent">
                {count?.toLocaleString()}
              </span>{" "}
              release{count === 1 ? "" : "s"} matching the current filter
              (<span className="font-mono">{filterDescription}</span>) will
              be signed and broadcast to{" "}
            </>
          ) : (
            "Each release in your library will be signed and broadcast to "
          )}
          <span className="font-mono text-accent">{relayCount}</span>{" "}
          {relayCount === 1 ? "relay" : "relays"} as a kind:31237 event.
          Relays cache and indexers archive — once out there, the data is
          effectively forever.
        </p>
        <div className="mt-2 flex justify-end gap-2 text-xs">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                       text-fg"
          >
            cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md bg-accent text-bg font-semibold
                       hover:opacity-90 flex items-center gap-1.5"
          >
            <Upload size={12} />{" "}
            {filterActive ? "Yes, publish filtered" : "Yes, publish all"}
          </button>
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
          publishing {progress.current.toLocaleString()} /{" "}
          {total.toLocaleString()}
        </div>
        <div className="mt-1 h-2 rounded-full bg-surface overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-150"
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
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Tile label="total" value={summary.total} />
          <Tile label="published" value={summary.published} tone="ok" />
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
