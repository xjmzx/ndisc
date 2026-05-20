import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileMusic,
  ImageDown,
  Image as ImageIcon,
  Pencil,
  RefreshCcw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { SUBTLE_BUTTON_CLS } from "../lib/buttonStyles";
import { coverImageSrc } from "../lib/cover";
import {
  deleteRelease,
  restoreRelease,
  publishRelease,
  refreshRelease,
  setCoverArtUrl,
  setReleaseCatalogNumber,
  setReleaseCategory,
  setReleaseCondition,
  setReleaseCountry,
  setReleaseLabel,
  setReleaseType,
  syncCoverToDisk,
  unpublishRelease,
  type RelayError,
  type Release,
} from "../lib/tauri";

const TYPE_OPTIONS = [
  "music",
  "sample",
  "stem",
  "field-recording",
  "message",
  "other",
];

const CATEGORY_OPTIONS = [
  "album",
  "ep",
  "single",
  "compilation",
  "mix",
  "live",
  "soundtrack",
  "bootleg",
  "miscellaneous",
];

// Discogs's full condition grades. Stored verbatim so imported entries map
// cleanly. The collapsed display abbreviates to just the parenthetical grade.
const CONDITION_OPTIONS = [
  "Mint (M)",
  "Near Mint (NM or M-)",
  "Very Good Plus (VG+)",
  "Very Good (VG)",
  "Good Plus (G+)",
  "Good (G)",
  "Fair (F)",
  "Poor (P)",
];

function abbreviateCondition(s: string): string {
  const m = s.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : s;
}

// Compact display form for a NIP-19 naddr: first 12 + last 8 around an ellipsis.
// The full string is still available for selection (DOM has the abbreviated
// text only — Copy/njump.me buttons reference the underlying `lastPublish.naddr`).
function shortenNaddr(s: string): string {
  if (s.length <= 24) return s;
  return `${s.slice(0, 12)}…${s.slice(-8)}`;
}

// All six action buttons in the release detail share the icon-only shape so
// the row can absorb a `flex-1` naddr code element between them on a single
// line.
const ACTION_ICON_BUTTON_CLS =
  "p-2 rounded-md bg-mauve/15 text-mauve " +
  "hover:bg-mauve hover:text-bg transition-colors " +
  "disabled:opacity-40 disabled:cursor-not-allowed " +
  "disabled:hover:bg-mauve/15 disabled:hover:text-mauve";

interface Props {
  release: Release;
  relays: string[];
  onDeleted: () => void;
  onChanged: (updated: Release) => void;
  showUndoToast?: (message: string, undo: () => void | Promise<void>) => void;
}

// Status block at the bottom of the detail panel shows exactly one of:
//   - the publish/unpublish result (with naddr widget on publish)
//   - a one-line info/warn/error from cover edits, refresh, or sync.
// Setting latestOp from any handler replaces whatever was there before.
type LatestOp =
  | { kind: "publish"; naddr: string; eventId: string; acceptedBy: string[]; rejected: RelayError[] }
  | { kind: "unpublish"; eventId: string; acceptedBy: string[]; rejected: RelayError[] }
  | { kind: "info"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "error"; text: string };

export function ReleaseDetail({
  release,
  relays,
  onDeleted,
  onChanged,
  showUndoToast,
}: Props) {
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingCover, setSyncingCover] = useState(false);
  const [latestOp, setLatestOp] = useState<LatestOp | null>(null);
  // Persistent across non-release-switch ops so the copy/njump.me buttons in
  // the action row stay active after a later cover edit / refresh / sync.
  const [lastPublish, setLastPublish] =
    useState<{ naddr: string; eventId: string } | null>(null);
  const [naddrCopied, setNaddrCopied] = useState(false);

  // Reset on release switch. Reseed lastPublish from the DB-persisted naddr
  // when the release has one, so the copy/njump.me buttons stay active across
  // restarts (and on first detail-panel mount of an already-published release).
  // Important: deps only include `release.id` — re-firing on `lastPublishedNaddr`
  // changes would wipe the just-set publish feedback when `onChanged` bubbles
  // the new naddr back through this component as a prop.
  useEffect(() => {
    setLatestOp(null);
    setNaddrCopied(false);
    setLastPublish(
      release.lastPublishedNaddr
        ? { naddr: release.lastPublishedNaddr, eventId: "" }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release.id]);

  async function copyNaddr() {
    if (!lastPublish) return;
    try {
      await navigator.clipboard.writeText(lastPublish.naddr);
      setNaddrCopied(true);
      setTimeout(() => setNaddrCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function openNjump() {
    if (!lastPublish) return;
    try {
      await openUrl(`https://njump.me/${lastPublish.naddr}`);
    } catch {
      /* ignore */
    }
  }

  async function commitCoverUrl(value: string | null) {
    if (!release.id) return;
    try {
      await setCoverArtUrl(release.id, value);
      onChanged({ ...release, coverArtUrl: value });
      setLatestOp({
        kind: "info",
        text: value ? "cover URL saved" : "cover URL cleared",
      });
    } catch (e) {
      setLatestOp({ kind: "error", text: String(e) });
    }
  }

  const coverSrc = coverImageSrc(release);

  async function onDelete() {
    if (!release.id) return;
    const details = [
      release.medium && `medium: ${release.medium}`,
      release.year && `year: ${release.year}`,
      release.format && `format: ${release.format}`,
      release.catalogNumber && `catalog: ${release.catalogNumber}`,
      release.discogsId && `discogs id: ${release.discogsId}`,
      release.filePath && `file path: ${release.filePath}`,
    ]
      .filter(Boolean)
      .join("\n");
    const message =
      `Delete "${release.artist} — ${release.title}"?\n` +
      (details ? `\n${details}\n` : "") +
      `\nThis removes the database row only. Files on disk are not touched, ` +
      `and any previously-published Nostr event remains until you Unpublish it.`;
    const yes = await ask(message, {
      title: "Delete release",
      kind: "warning",
    });
    if (!yes) return;
    const snapshot = release;
    try {
      await deleteRelease(release.id);
      onDeleted();
      showUndoToast?.(
        `Deleted "${snapshot.artist} — ${snapshot.title}"`,
        async () => {
          try {
            await restoreRelease(snapshot);
            onDeleted();
          } catch (e) {
            alert(`Restore failed: ${e}`);
          }
        },
      );
    } catch (e) {
      alert(String(e));
    }
  }

  async function onPublish() {
    if (!release.id) return;
    if (relays.length === 0) {
      setLatestOp({
        kind: "error",
        text: "Add at least one relay in the Nostr Sync panel.",
      });
      return;
    }
    setPublishing(true);
    try {
      const result = await publishRelease(release.id, relays);
      setLatestOp({ kind: "publish", ...result });
      if (result.acceptedBy.length > 0) {
        setLastPublish({ naddr: result.naddr, eventId: result.eventId });
        onChanged({
          ...release,
          lastPublishedAt: Math.floor(Date.now() / 1000),
          lastPublishedNaddr: result.naddr,
        });
      }
    } catch (e) {
      setLatestOp({ kind: "error", text: String(e) });
    } finally {
      setPublishing(false);
    }
  }

  async function onRefresh() {
    if (!release.id) return;
    setRefreshing(true);
    try {
      const result = await refreshRelease(release.id);
      if (result.status === "ok") {
        onChanged({ ...release });
        setLatestOp({
          kind: "info",
          text: `refreshed: ${result.changes.join(", ")}`,
        });
      } else if (result.status === "no_changes") {
        setLatestOp({ kind: "info", text: "no changes — DB already current" });
      } else if (result.status === "missing_path") {
        setLatestOp({ kind: "warn", text: "file path missing on disk" });
      } else if (result.status === "no_audio") {
        setLatestOp({ kind: "warn", text: "no audio files in directory" });
      } else {
        setLatestOp({ kind: "info", text: "release has no file path" });
      }
    } catch (e) {
      setLatestOp({ kind: "error", text: String(e) });
    } finally {
      setRefreshing(false);
    }
  }

  async function onSyncCover() {
    if (!release.id) return;
    setSyncingCover(true);
    try {
      const result = await syncCoverToDisk(release.id);
      if (result.status === "ok" && result.written) {
        onChanged({ ...release, coverArtPath: result.written });
        const bytes = result.bytes ?? 0;
        const size =
          bytes / 1024 < 1024
            ? `${Math.round(bytes / 1024)} KB`
            : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        setLatestOp({
          kind: "info",
          text: `wrote ${size} → ${result.written}`,
        });
      } else if (result.status === "no_url") {
        setLatestOp({ kind: "info", text: "no cover URL to sync" });
      } else if (result.status === "no_path") {
        setLatestOp({ kind: "info", text: "release has no file path" });
      } else if (result.status === "missing_path") {
        setLatestOp({ kind: "warn", text: "file path missing on disk" });
      }
    } catch (e) {
      setLatestOp({ kind: "error", text: String(e) });
    } finally {
      setSyncingCover(false);
    }
  }

  async function onUnpublish() {
    if (!release.id) return;
    if (relays.length === 0) {
      setLatestOp({
        kind: "error",
        text: "Add at least one relay in the Nostr Sync panel.",
      });
      return;
    }
    const yes = await ask(
      `Send NIP-09 deletion request for "${release.artist} — ${release.title}"?\n\nThis asks every configured relay to remove the published event. Well-behaved relays honour it; some may ignore the request.`,
      { title: "Unpublish from Nostr", kind: "warning" },
    );
    if (!yes) return;
    setUnpublishing(true);
    try {
      const result = await unpublishRelease(release.id, relays);
      setLatestOp({
        kind: "unpublish",
        eventId: result.eventId,
        acceptedBy: result.acceptedBy,
        rejected: result.rejected,
      });
      if (result.acceptedBy.length > 0) {
        setLastPublish(null);
        onChanged({
          ...release,
          lastPublishedAt: null,
          lastPublishedNaddr: null,
        });
      }
    } catch (e) {
      setLatestOp({ kind: "error", text: String(e) });
    } finally {
      setUnpublishing(false);
    }
  }

  async function onChangeType(v: string | null) {
    if (!release.id) return;
    await setReleaseType(release.id, v);
    onChanged({ ...release, releaseType: v });
  }

  async function onChangeCategory(v: string | null) {
    if (!release.id) return;
    await setReleaseCategory(release.id, v);
    onChanged({ ...release, category: v });
  }

  async function onChangeCountry(v: string | null) {
    if (!release.id) return;
    await setReleaseCountry(release.id, v);
    onChanged({ ...release, country: v });
  }

  async function onChangeCondition(v: string | null) {
    if (!release.id) return;
    await setReleaseCondition(release.id, v);
    onChanged({ ...release, condition: v });
  }

  async function onChangeLabel(v: string | null) {
    if (!release.id) return;
    await setReleaseLabel(release.id, v);
    onChanged({ ...release, label: v });
  }

  async function onChangeCatalogNumber(v: string | null) {
    if (!release.id) return;
    await setReleaseCatalogNumber(release.id, v);
    onChanged({ ...release, catalogNumber: v });
  }

  const primaryFields: [string, unknown][] = [
    ["year", release.year],
    ["medium", release.medium],
    ["format", release.format],
    ["label", release.label],
    ["catalog #", release.catalogNumber],
    ["source", release.source],
    ["discogs id", release.discogsId],
    ["file path", release.filePath],
  ];

  return (
    <Section
      title={
        <>
          <span className="text-fg">{release.artist} /</span>{" "}
          <span className="text-accent">{release.title}</span>
        </>
      }
      icon={<FileMusic size={16} />}
      right={
        <button onClick={onDelete} className={SUBTLE_BUTTON_CLS}>
          <Trash2 size={12} /> delete
        </button>
      }
    >
      <div className="flex gap-4 items-stretch">
        <CoverArt
          src={coverSrc}
          alt={`${release.artist} — ${release.title}`}
        />
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5
                       text-xs flex-1 min-w-0 self-center">
          {primaryFields.map(([label, value]) => (
            <NaRow key={label} label={label} value={toDisplay(value)} />
          ))}
        </dl>
      </div>

      <div className="mt-4 grid grid-cols-[max-content_1fr] gap-x-3 items-center
                      text-xs max-w-md">
        <span className="text-muted">cover url</span>
        <div className="min-w-0">
          <CoverUrlField
            value={release.coverArtUrl ?? ""}
            onCommit={commitCoverUrl}
            highlight={!coverSrc}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-xs">
        <EditableEnum
          value={release.releaseType ?? null}
          options={TYPE_OPTIONS}
          onChange={onChangeType}
          ariaLabel="type"
          placeholder="type"
          width="w-32"
        />
        <EditableEnum
          value={release.category ?? null}
          options={CATEGORY_OPTIONS}
          onChange={onChangeCategory}
          ariaLabel="category"
          placeholder="category"
          width="w-32"
        />
        <EditableText
          value={release.label ?? null}
          onChange={onChangeLabel}
          ariaLabel="label"
          placeholder="label"
          width="w-40"
        />
        <EditableText
          value={release.catalogNumber ?? null}
          onChange={onChangeCatalogNumber}
          ariaLabel="catalog"
          placeholder="catalog"
          width="w-28"
        />
        <EditableText
          value={release.country ?? null}
          onChange={onChangeCountry}
          ariaLabel="country"
          placeholder="country"
          width="w-32"
        />
        <EditableEnum
          value={release.condition ?? null}
          options={CONDITION_OPTIONS}
          onChange={onChangeCondition}
          ariaLabel="condition"
          displayFn={abbreviateCondition}
          placeholder="condition"
          width="w-32"
        />
      </div>

      {release.notes && (
        <div className="mt-3 text-xs">
          <div className="text-muted mb-1">notes</div>
          <p className="whitespace-pre-wrap text-fg/90">{release.notes}</p>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-surface/60">
        <div className="flex flex-wrap gap-x-2 gap-y-2 items-center">
          <button
            onClick={onPublish}
            disabled={publishing || unpublishing || relays.length === 0}
            className={ACTION_ICON_BUTTON_CLS}
            title={
              relays.length === 0
                ? "Add a relay in the Nostr Sync panel first"
                : publishing
                  ? "publishing…"
                  : "Publish this release as a kind:31237 event"
            }
            aria-label="Publish"
          >
            <Upload size={14} />
          </button>
          <button
            onClick={onUnpublish}
            disabled={publishing || unpublishing || relays.length === 0}
            className={ACTION_ICON_BUTTON_CLS}
            title={
              unpublishing
                ? "unpublishing…"
                : "Send NIP-09 deletion request for the published event"
            }
            aria-label="Unpublish"
          >
            <Undo2 size={14} />
          </button>
          {release.filePath && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className={ACTION_ICON_BUTTON_CLS}
              title={
                refreshing
                  ? "refreshing…"
                  : "Re-read tags + cover from the release's local directory"
              }
              aria-label="Refresh from disk"
            >
              <RefreshCcw size={14} />
            </button>
          )}
          {release.filePath && release.coverArtUrl && (
            <button
              onClick={onSyncCover}
              disabled={syncingCover}
              className={ACTION_ICON_BUTTON_CLS}
              title={
                syncingCover
                  ? "downloading…"
                  : "Download the published cover URL and save it as cover.jpg in the release folder"
              }
              aria-label="Sync cover to disk"
            >
              <ImageDown size={14} />
            </button>
          )}
          <code
            className="px-2 py-1 rounded bg-surface text-fg/80
                       text-[10px] font-mono select-text"
            title={lastPublish?.naddr ?? "not yet published"}
          >
            {lastPublish ? (
              shortenNaddr(lastPublish.naddr)
            ) : (
              <span className="italic text-muted/50">not yet published</span>
            )}
          </code>
          <button
            onClick={copyNaddr}
            disabled={!lastPublish}
            className={ACTION_ICON_BUTTON_CLS}
            title={
              lastPublish
                ? naddrCopied
                  ? "copied"
                  : "Copy naddr to clipboard"
                : "Publish first to get a shareable naddr"
            }
            aria-label="Copy naddr"
          >
            {naddrCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            onClick={openNjump}
            disabled={!lastPublish}
            className={ACTION_ICON_BUTTON_CLS}
            title={
              lastPublish
                ? "View on njump.me"
                : "Publish first to view on njump.me"
            }
            aria-label="View on njump.me"
          >
            <ExternalLink size={14} />
          </button>
        </div>

        {/* Reserve one line for feedback so the panel matches the left column
            height whether or not a message is currently shown. Multi-line
            messages (e.g. rejected relays expanded) still grow the panel. */}
        <div className="mt-2 min-h-[1.25rem]">
          {latestOp && <OpFeedback op={latestOp} />}
        </div>
      </div>
    </Section>
  );
}

function OpFeedback({ op }: { op: LatestOp }) {
  if (op.kind === "publish" || op.kind === "unpublish") {
    const total = op.acceptedBy.length + op.rejected.length;
    const isPublish = op.kind === "publish";
    return (
      <div className="text-xs space-y-1">
        {!isPublish && (
          <div className="text-muted">
            deletion request id{" "}
            <span
              className="font-mono text-fg/60 select-text"
              title={op.eventId}
            >
              {op.eventId.slice(0, 16)}…
            </span>
          </div>
        )}
        {op.acceptedBy.length > 0 && (
          <div className="text-ok">
            {isPublish ? "" : "delete request "}
            accepted by {op.acceptedBy.length} of {total}:{" "}
            <span className="font-mono">{op.acceptedBy.join(", ")}</span>
          </div>
        )}
        {op.rejected.length > 0 && (
          <details>
            <summary className="text-warn cursor-pointer">
              {op.rejected.length} relay
              {op.rejected.length === 1 ? "" : "s"} rejected
            </summary>
            <ul className="mt-1 font-mono text-[10px] text-alert/90 space-y-0.5">
              {op.rejected.map((r, i) => (
                <li key={i} className="break-all">
                  {r.relay} — {r.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }
  const toneCls =
    op.kind === "error"
      ? "text-alert"
      : op.kind === "warn"
        ? "text-warn"
        : "text-ok";
  return <div className={`text-xs ${toneCls}`}>{op.text}</div>;
}

function toDisplay(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function NaRow({ label, value }: { label: string; value: string | null }) {
  const isUrl =
    value !== null &&
    (value.startsWith("http://") || value.startsWith("https://"));
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-fg/90 min-w-0" title={value ?? undefined}>
        {value === null ? (
          <span className="italic text-muted/40">n/a</span>
        ) : isUrl ? (
          <button
            onClick={() => openUrl(value)}
            className="inline-flex items-center gap-1 max-w-full
                       text-mauve hover:text-accent hover:underline
                       transition-colors text-left"
          >
            <span className="truncate select-text">{value}</span>
            <ExternalLink size={10} className="shrink-0" />
          </button>
        ) : (
          <span className="block truncate select-text">{value}</span>
        )}
      </dd>
    </>
  );
}

interface EditableEnumProps {
  value: string | null;
  options: string[];
  onChange: (v: string | null) => Promise<void> | void;
  ariaLabel?: string;
  displayFn?: (s: string) => string;
  placeholder?: string;
  width?: string;
}

function EditableEnum({
  value,
  options,
  onChange,
  ariaLabel,
  displayFn,
  placeholder = "n/a",
  width = "",
}: EditableEnumProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit(v: string) {
    setSaving(true);
    setError(null);
    try {
      await onChange(v === "" ? null : v);
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <select
        autoFocus
        value={value ?? ""}
        disabled={saving}
        aria-label={ariaLabel}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className={`${width} h-6 px-1.5 py-0 rounded bg-surface text-fg
                    outline-none border border-accent/50 text-xs
                    cursor-pointer disabled:opacity-50 appearance-none`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {displayFn ? displayFn(o) : o}
          </option>
        ))}
      </select>
    );
  }

  const shown = value ? (displayFn ? displayFn(value) : value) : null;
  return (
    <>
      <button
        onClick={() => setEditing(true)}
        title={value ? `${placeholder}: ${value}` : `Set ${placeholder}`}
        aria-label={ariaLabel}
        className={`${width} h-6 group inline-flex items-center justify-between
                    gap-1.5 px-1.5 py-0 rounded
                    bg-surface/40 hover:bg-surface/70
                    border border-surface/60 hover:border-accent/50
                    transition-colors text-left text-fg/90`}
      >
        <span className="truncate">
          {shown ?? (
            <span className="italic text-muted/50">{placeholder}</span>
          )}
        </span>
        <Pencil
          size={10}
          className="shrink-0 text-muted/50 group-hover:text-accent transition-colors"
        />
      </button>
      {error && (
        <span className="ml-2 text-alert text-[10px]">{error}</span>
      )}
    </>
  );
}

interface EditableTextProps {
  value: string | null;
  onChange: (v: string | null) => Promise<void> | void;
  ariaLabel?: string;
  placeholder?: string;
  width?: string;
}

function EditableText({
  value,
  onChange,
  ariaLabel,
  placeholder = "n/a",
  width = "w-24",
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if ((value ?? null) === next) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onChange(next);
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        value={draft}
        disabled={saving}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        spellCheck={false}
        className={`${width} h-6 px-1.5 py-0 rounded bg-surface text-fg
                    outline-none border border-accent/50 text-xs
                    placeholder:text-muted/60 disabled:opacity-50`}
      />
    );
  }

  return (
    <>
      <button
        onClick={() => setEditing(true)}
        title={value ? `${placeholder}: ${value}` : `Set ${placeholder}`}
        aria-label={ariaLabel}
        className={`${width} h-6 group inline-flex items-center justify-between
                    gap-1.5 px-1.5 py-0 rounded
                    bg-surface/40 hover:bg-surface/70
                    border border-surface/60 hover:border-accent/50
                    transition-colors text-left text-fg/90`}
      >
        <span
          className={`truncate ${value ? "" : "italic text-muted/50"}`}
        >
          {value ?? placeholder}
        </span>
        <Pencil
          size={10}
          className="shrink-0 text-muted/50 group-hover:text-accent transition-colors"
        />
      </button>
      {error && (
        <span className="ml-2 text-alert text-[10px]">{error}</span>
      )}
    </>
  );
}

interface CoverUrlFieldProps {
  value: string;
  onCommit: (v: string | null) => Promise<void> | void;
  highlight?: boolean;
}

function CoverUrlField({ value, onCommit, highlight }: CoverUrlFieldProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  // Sync local draft when the upstream value changes (e.g. switching releases).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  async function maybeCommit() {
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if ((value || null) === next) return;
    setSaving(true);
    try {
      await onCommit(next);
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setDraft("");
    setSaving(true);
    try {
      await onCommit(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={maybeCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="https://i.nostr.build/…"
        disabled={saving}
        className={
          "flex-1 min-w-0 px-2 py-1 rounded bg-surface/40 text-fg " +
          "outline-none border focus:border-accent/50 text-[10px] " +
          "font-mono placeholder:text-muted/60 disabled:opacity-50 " +
          (highlight && !draft.trim()
            ? "border-mauve/50"
            : "border-surface/60")
        }
        spellCheck={false}
      />
      {value && (
        <button
          onClick={clear}
          disabled={saving}
          className="p-1 rounded hover:bg-surface text-muted
                     hover:text-alert disabled:opacity-50"
          title="Clear cover URL"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

interface CoverArtProps {
  src: string | null;
  alt: string;
}

function CoverArt({ src, alt }: CoverArtProps) {
  // Track load failures so a broken URL/path falls back to the placeholder
  // instead of leaving a blank box. Reset when the release changes.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = src != null && !failed;

  return (
    <div
      className={
        "shrink-0 w-[195px] h-[195px] rounded-md overflow-hidden flex " +
        "items-center justify-center " +
        (showImage
          ? "bg-surface"
          : "border-2 border-dashed border-mauve/50 bg-mauve/5")
      }
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="text-mauve/70 flex flex-col items-center gap-1.5
                     text-[10px] text-center px-2"
        >
          <ImageIcon size={28} strokeWidth={1.5} />
          <span className="uppercase tracking-wide">
            {failed ? "cover failed to load" : "no cover"}
          </span>
        </div>
      )}
    </div>
  );
}

