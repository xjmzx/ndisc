import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileMusic,
  ImageDown,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RefreshCcw,
  Sparkles,
  StickyNote,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useReactions } from "../hooks/useReactions";
import { REACTION_DOWN, REACTION_UP, displayCount } from "../lib/rating";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { CountBadge, LeafDots } from "./LeafIcon";
import { SUBTLE_BUTTON_CLS } from "../lib/buttonStyles";
import { coverImageSrc } from "../lib/cover";
import { genreDisplay, GENRE_ORDER } from "../lib/genre";
import {
  deleteRelease,
  enrichDiscogsRelease,
  restoreRelease,
  publishRelease,
  refreshRelease,
  setCoverArtUrl,
  setReleaseCatalogNumber,
  setReleaseDiscogsId,
  setReleaseCategory,
  setReleaseCondition,
  setReleaseCountry,
  setReleaseGenres,
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

// Flat, alphabetical genre options for one slot — the 35 active slugs (from
// lib/genre, so a retired compound pair can never be offered) minus anything
// already chosen in an earlier slot. The release-viewer dropdown lists genres
// only: no family grouping. Sorted by display label (case-insensitive), so
// `rnb` sorts as "R&B". All slugs are pure peers — no parent+sub gating.
function genreOptionsForSlot(
  slotIndex: number,
  currentSlots: (string | null)[],
): string[] {
  const excluded = new Set<string>(
    currentSlots.slice(0, slotIndex).filter((s): s is string => !!s),
  );
  return GENRE_ORDER.filter((o) => !excluded.has(o)).sort((a, b) =>
    genreDisplay(a).localeCompare(genreDisplay(b), undefined, {
      sensitivity: "base",
    }),
  );
}

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
  const [enriching, setEnriching] = useState(false);
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
        text: "Add at least one relay in the Nostr panel.",
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
        text: "Add at least one relay in the Nostr panel.",
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

  // Changes a single genre slot. Cascade-clears later slots that are no
  // longer valid given the new value (e.g. swap primary to `electronic` and
  // any electronic-sub in slot 2/3 becomes invalid → cleared). Then
  // compacts to keep density (no holes). Writes all three slots atomically
  // via setReleaseGenres.
  async function onChangeGenreSlot(slot: number, newValue: string | null) {
    if (!release.id) return;
    const slots: (string | null)[] = [
      release.genrePrimary ?? null,
      release.genreSecondary ?? null,
      release.genreTertiary ?? null,
    ];
    slots[slot] = newValue;
    for (let i = slot + 1; i < 3; i++) {
      if (slots[i]) {
        const allowed = new Set(genreOptionsForSlot(i, slots));
        if (!allowed.has(slots[i] as string)) slots[i] = null;
      }
    }
    const present = slots.filter((s): s is string => !!s);
    const dense: [string | null, string | null, string | null] = [
      present[0] ?? null,
      present[1] ?? null,
      present[2] ?? null,
    ];
    await setReleaseGenres(release.id, dense[0], dense[1], dense[2]);
    onChanged({
      ...release,
      genrePrimary: dense[0],
      genreSecondary: dense[1],
      genreTertiary: dense[2],
    });
  }

  async function onChangeCatalogNumber(v: string | null) {
    if (!release.id) return;
    await setReleaseCatalogNumber(release.id, v);
    onChanged({ ...release, catalogNumber: v });
  }

  // Accepts a bare id or a discogs.com/release/… URL (parsed backend-side; an
  // invalid value rejects and EditableText surfaces it inline). Mirrors the
  // backend's source-canonicalisation so the optimistic update stays coherent.
  async function onChangeDiscogsId(v: string | null) {
    if (!release.id) return;
    const id = await setReleaseDiscogsId(release.id, v ?? "");
    const sourceIsDiscogs = (release.source ?? "").includes(
      "discogs.com/release/",
    );
    const sourceIsEmpty = (release.source ?? "").trim() === "";
    let source = release.source ?? null;
    if (id != null && (sourceIsEmpty || sourceIsDiscogs)) {
      source = `https://www.discogs.com/release/${id}`;
    } else if (id == null && sourceIsDiscogs) {
      source = null;
    }
    onChanged({ ...release, discogsId: id, source });
  }

  // Pull track + disc counts from Discogs for just this release (vs the batch
  // panel). Needs a discogs_id and a saved token.
  async function onEnrich() {
    if (!release.id || release.discogsId == null || enriching) return;
    setEnriching(true);
    setLatestOp(null);
    try {
      const res = await enrichDiscogsRelease(release.id);
      if (res.status === "no_discogs_id") {
        setLatestOp({ kind: "error", text: "no Discogs id set" });
        return;
      }
      // Backend clears publish state when a published release's track_total
      // changes — mirror that so the chip doesn't read stale.
      const totalChanged =
        res.trackTotal != null && res.trackTotal !== release.trackTotal;
      const cleared = totalChanged && release.lastPublishedAt != null;
      if (cleared) setLastPublish(null);
      onChanged({
        ...release,
        trackTotal: res.trackTotal ?? release.trackTotal,
        discTotal: res.discTotal ?? release.discTotal,
        ...(cleared
          ? { lastPublishedAt: null, lastPublishedNaddr: null }
          : {}),
      });
      setLatestOp({
        kind: "info",
        text: `enriched — ${res.trackTotal ?? "?"} tracks · ${
          res.discTotal ?? "?"
        } disc${res.discTotal === 1 ? "" : "s"}`,
      });
    } catch (e) {
      setLatestOp({ kind: "error", text: String(e) });
    } finally {
      setEnriching(false);
    }
  }

  const primaryFields: [string, unknown][] = [
    ["year", release.year],
    ["medium", release.medium],
    ["format", release.format],
    ["label", release.label],
    ["catalog #", release.catalogNumber],
    ["source", release.source],
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
    >
      <div className="flex gap-4 items-stretch">
        <CoverArt
          src={coverSrc}
          alt={`${release.artist} — ${release.title}`}
        />
        {/* Fields on the left, actions top-right — the actions sit on the
            same row as `year` (the first field) and the top of the cover,
            rather than in the Section title row, so long release names get
            the full title width and don't wrap. */}
        <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5
                         text-xs min-w-0">
            {primaryFields.map(([label, value]) => (
              <NaRow key={label} label={label} value={toDisplay(value)} />
            ))}
            {(release.trackCount != null || release.trackTotal != null) && (
              <>
                <dt className="text-muted">tracks</dt>
                <dd className="text-fg/90 min-w-0 flex items-center">
                  {/* dots are the count — present (solid) over expected (faint);
                      exact figures + missing count on hover. Keyed on file_path
                      (a folder to count), not medium: folder-linked → present
                      vs total; object-only (no folder) → present = total, all
                      solid (you own it; tracks can't be "missing"). Wide pack
                      (maxCols 17) so even the 99-cap stacks in ≤6 rows and grows
                      horizontally instead of towering and pushing panels down. */}
                  <LeafDots
                    n={
                      (release.filePath
                        ? release.trackCount
                        : release.trackTotal) ?? 0
                    }
                    total={release.trackTotal}
                    maxCols={17}
                  />
                </dd>
              </>
            )}
            {release.discTotal != null && release.discTotal > 0 && (
              <>
                <dt className="text-muted">discs</dt>
                <dd className="text-fg/90 min-w-0 flex items-center">
                  {/* Same green badge as the release scroll's disc mark, but a
                      touch smaller and a rounded square (not a circle) so it
                      reads tidily inline next to the label. */}
                  <CountBadge
                    value={release.discTotal}
                    title={`${release.discTotal} disc${
                      release.discTotal === 1 ? "" : "s"
                    }`}
                    shapeClassName="rounded-[3px]"
                    colorClassName="bg-ok/70 text-bg"
                    size={17}
                  />
                </dd>
              </>
            )}
          </dl>
          <div className="flex items-center gap-3 shrink-0">
            {release.id != null && lastPublish && (
              <ReactionButtons releaseId={release.id} />
            )}
            <button onClick={onDelete} className={SUBTLE_BUTTON_CLS}>
              <Trash2 size={12} /> delete
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[max-content_1fr] gap-x-3 items-center
                      text-xs max-w-md">
        <span className="text-muted flex items-center" title="cover url">
          <ImageIcon size={14} aria-label="cover url" />
        </span>
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
        {/* Discogs id — editable (bare id or a release URL); paired with a
            per-release enrich button that pulls track + disc counts. */}
        <div className="inline-flex items-center gap-1.5">
          <EditableText
            value={release.discogsId != null ? String(release.discogsId) : null}
            onChange={onChangeDiscogsId}
            ariaLabel="discogs id"
            placeholder="discogs id"
            width="w-28"
          />
          {release.discogsId != null && (
            <button
              type="button"
              onClick={onEnrich}
              disabled={enriching}
              title="Pull track + disc counts from Discogs for this release"
              className={SUBTLE_BUTTON_CLS}
            >
              {enriching ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              enrich
            </button>
          )}
        </div>
        {(() => {
          const slots = [
            release.genrePrimary ?? null,
            release.genreSecondary ?? null,
            release.genreTertiary ?? null,
          ];
          return (
            <>
              <EditableEnum
                value={slots[0]}
                options={genreOptionsForSlot(0, slots)}
                onChange={(v) => onChangeGenreSlot(0, v)}
                ariaLabel="primary genre"
                displayFn={genreDisplay}
                placeholder="genre"
                width="w-32"
              />
              {/* Progressive disclosure — slot 2 only when slot 1 is set,
                  slot 3 only when slot 2 is set. Matches the density rule
                  visually and reduces field-row width pressure. */}
              {slots[0] && (
                <EditableEnum
                  value={slots[1]}
                  options={genreOptionsForSlot(1, slots)}
                  onChange={(v) => onChangeGenreSlot(1, v)}
                  ariaLabel="secondary genre"
                  displayFn={genreDisplay}
                  placeholder="+ 2nd"
                  width="w-28"
                />
              )}
              {slots[1] && (
                <EditableEnum
                  value={slots[2]}
                  options={genreOptionsForSlot(2, slots)}
                  onChange={(v) => onChangeGenreSlot(2, v)}
                  ariaLabel="tertiary genre"
                  displayFn={genreDisplay}
                  placeholder="+ 3rd"
                  width="w-28"
                />
              )}
            </>
          );
        })()}
        <EditableEnum
          value={release.condition ?? null}
          options={CONDITION_OPTIONS}
          onChange={onChangeCondition}
          ariaLabel="condition"
          displayFn={abbreviateCondition}
          placeholder="condition"
          width="w-32"
        />
        <NotesField value={release.notes ?? null} />
      </div>

      <div className="mt-4 pt-3 border-t border-surface/60">
        <div className="flex flex-wrap gap-x-2 gap-y-2 items-center">
          <button
            onClick={onPublish}
            disabled={publishing || unpublishing || relays.length === 0}
            className={ACTION_ICON_BUTTON_CLS}
            title={
              relays.length === 0
                ? "Add a relay in the Nostr panel first"
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

// Read-only notes field. Sits in the editable-field row so it occupies a
// stable slot whether or not the release has notes — no more appearing and
// disappearing block. Long/multi-line notes truncate; full text is in the
// title tooltip. Sized to roughly match the cover-url field.
function NotesField({ value }: { value: string | null }) {
  const shown = value && value.trim().length > 0 ? value.trim() : null;
  return (
    <div
      title={shown ? `notes: ${shown}` : "no notes set"}
      aria-label="notes"
      className="w-[12rem] max-w-full h-6 inline-flex items-center gap-1.5
                 px-1.5 rounded bg-surface/40 border border-surface/60
                 text-fg/90"
    >
      <StickyNote size={10} className="shrink-0 text-muted/50" />
      <span className={`truncate ${shown ? "" : "italic text-muted/50"}`}>
        {shown ?? "notes"}
      </span>
    </div>
  );
}

interface EditableEnumProps {
  value: string | null;
  // Flat option list OR grouped via <optgroup> — exactly one is provided.
  options?: string[];
  groups?: { label: string; options: string[] }[];
  onChange: (v: string | null) => Promise<void> | void;
  ariaLabel?: string;
  displayFn?: (s: string) => string;
  placeholder?: string;
  width?: string;
}

function EditableEnum({
  value,
  options,
  groups,
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
        {groups
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o} value={o}>
                    {displayFn ? displayFn(o) : o}
                  </option>
                ))}
              </optgroup>
            ))
          : (options ?? []).map((o) => (
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

// Compact thumbs-up/down with count + own-reaction highlight. Shown in
// the ReleaseDetail header when the user is signed in; gracefully
// degrades to disabled+muted buttons otherwise. Reactions live on the
// release's replaceable address (kind:31237:pubkey:disco-vault:id) so
// ndisc.view and other web clients aggregate them identically.
function ReactionButtons({ releaseId }: { releaseId: number }) {
  const { forRelease, react, unreact, canReact, busy } = useReactions();
  const agg = forRelease(releaseId);
  const isBusy = busy === releaseId;
  const myUp = agg.mine != null;

  async function onUp() {
    if (!canReact || isBusy) return;
    if (myUp) await unreact(releaseId);
    else await react(releaseId, REACTION_UP);
  }
  async function onDown() {
    if (!canReact || isBusy) return;
    if (myUp) await unreact(releaseId);
    await react(releaseId, REACTION_DOWN);
  }

  return (
    <div className="inline-flex items-center gap-1 text-[11px]">
      <button
        onClick={onUp}
        disabled={!canReact || isBusy}
        title={
          !canReact
            ? "load a Nostr identity to react"
            : myUp
              ? "remove your reaction"
              : "upvote"
        }
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 rounded " +
          "disabled:opacity-40 disabled:cursor-not-allowed " +
          (myUp
            ? "bg-ok/15 text-ok"
            : "text-muted hover:text-fg hover:bg-surface/40")
        }
      >
        {isBusy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <ThumbsUp size={11} />
        )}
        {displayCount(agg.up)}
      </button>
      <button
        onClick={onDown}
        disabled={!canReact || isBusy}
        title={!canReact ? "load a Nostr identity to react" : "downvote"}
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 rounded " +
          "disabled:opacity-40 disabled:cursor-not-allowed " +
          "text-muted hover:text-alert hover:bg-surface/40"
        }
      >
        <ThumbsDown size={11} />
        {displayCount(agg.down)}
      </button>
    </div>
  );
}

