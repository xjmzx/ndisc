import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Circle,
  Disc3,
  Film,
  FolderCog,
  FolderSearch,
  FolderSync,
  ImageOff,
  Link2,
  Music,
  MoreVertical,
  Radar,
  Share2,
  Radio,
  RefreshCw,
  SatelliteDish,
  ScanLine,
  Search,
  Tag,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { CountBadge, LeafDots } from "./LeafIcon";
import {
  auditRelays,
  deleteRelease,
  exportPublishedManifest,
  extractEmbeddedCovers,
  getLibraryRoot,
  listReleases,
  publishByIds,
  purgeRelayEvents,
  reconcileLibrary,
  reconcilePublished,
  rescanLocalCovers,
  scanLibraryChanges,
  setCoverArtUrl,
  setLibraryRoot,
  unpublishRelease,
  updateReleasePath,
  type ExtractSummary,
  type ImportProgress,
  type CoverLinkFilter,
  type GenreFilter,
  type LabelFilter,
  type LibraryReconcileSummary,
  type LibraryScanSummary,
  type OrphanEvent,
  type OrphanInfo,
  type PublishState,
  type ManifestSummary,
  type PurgeSummary,
  type ReconcileSummary,
  type RelayAudit,
  type Release,
  type RescanSummary,
  type VideoFilter,
} from "../lib/tauri";
import { coverImageSrc } from "../lib/cover";
import { sourcePlatform } from "../lib/source";
import {
  PUBLISH_STATES,
  publishStateMeta,
  publishStateOf,
} from "../lib/publishState";
import { cn } from "../lib/cn";

// Single source of truth for the release filter set — consumed by the list
// query, the filter description, AND the bulk publish/unpublish ops. Every
// filter that narrows the visible list lives here so the ops can never operate
// on a broader set than the user sees. `visibleIds` is the exact id set on
// screen; the bulk ops act on it directly (belt), while the filter fields drive
// the human-readable description (braces).
export interface FilterContext {
  query: string;
  medium: "physical" | "digital" | null;
  needsCoverOnly: boolean;
  publishStateFilter: PublishState | null;
  labelFilter: LabelFilter | null;
  genreFilter: GenreFilter | null;
  videoFilter: VideoFilter | null;
  coverLinkFilter: CoverLinkFilter | null;
  count: number;
  visibleIds: number[];
}

interface Props {
  reloadKey: number;
  onSelect: (r: Release) => void;
  selected: Release | null;
  onFilterChange?: (ctx: FilterContext) => void;
  relays: string[];
}

type MediumFilter = "" | "physical" | "digital";

// Alphabetical index bucket for the left rail. Keys off the artist (the list's
// sort key). Diacritics fold to their base letter so accents don't spawn
// stray buckets; digits map to themselves; everything else (symbols, empty,
// non-Latin) collapses under "#". Order of markers down the rail: # · 0–9 · A–Z.
function indexBucket(artist: string | null | undefined): string {
  const raw = (artist ?? "").trim();
  if (!raw) return "#";
  const c = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .charAt(0)
    .toUpperCase();
  if (c >= "A" && c <= "Z") return c;
  if (c >= "0" && c <= "9") return c;
  return "#";
}

export function ReleaseList({
  reloadKey,
  onSelect,
  selected,
  onFilterChange,
  relays,
}: Props) {
  const [query, setQuery] = useState("");
  const [medium, setMedium] = useState<MediumFilter>("");
  const [needsCoverOnly, setNeedsCoverOnly] = useState(false);
  const [publishStateFilter, setPublishStateFilter] =
    useState<"" | PublishState>("");
  const [labelFilter, setLabelFilter] = useState<"" | LabelFilter>("");
  const [genreFilter, setGenreFilter] = useState<"" | GenreFilter>("");
  const [videoFilter, setVideoFilter] = useState<"" | VideoFilter>("");
  const [coverLinkFilter, setCoverLinkFilter] = useState<"" | CoverLinkFilter>(
    "",
  );
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scroll container, for the index-rail jump-to-letter chevrons.
  const listRef = useRef<HTMLUListElement>(null);

  // Jump the list to the next (dir=1) / previous (dir=-1) index character —
  // the nearest first-of-bucket row below / above the current scroll top.
  // Queries the live DOM, so it stays correct under search + filters.
  function jumpBucket(dir: 1 | -1) {
    const ul = listRef.current;
    if (!ul) return;
    const ulTop = ul.getBoundingClientRect().top;
    const offsets = Array.from(
      ul.querySelectorAll<HTMLElement>("li[data-bucket-start]"),
    ).map((el) => el.getBoundingClientRect().top - ulTop);
    const EPS = 2;
    let target: number | null = null;
    if (dir === 1) {
      for (const o of offsets) {
        if (o > EPS) {
          target = o;
          break;
        }
      }
    } else {
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (offsets[i] < -EPS) {
          target = offsets[i];
          break;
        }
      }
    }
    if (target != null) {
      ul.scrollTo({ top: ul.scrollTop + target, behavior: "smooth" });
    }
  }

  // Inline cover-paste state (only used when needsCoverOnly is true).
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());
  const [savingId, setSavingId] = useState<number | null>(null);
  const [autoFocusPending, setAutoFocusPending] = useState(false);
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Cover-cleanup background ops. Extract reads embedded artwork from audio
  // file tags; rescan walks album directories for a wider set of cover
  // filename patterns.
  // "reconcile" = relay publish-state backfill; "reconcileDisk" = the two-phase
  // disk sync (discover new folders + refresh existing) behind "Rescan library
  // folder". Distinct axes, distinct summaries.
  // "audit" = the outbound relay reconcile: ask each relay what it still
  // serves for us and diff against the DB. "purge" = the follow-up action that
  // retracts what shouldn't be there. Both are relay-side; "reconcile" is the
  // inbound direction (relays → local markers).
  type OpKind =
    | "extract"
    | "rescan"
    | "scan"
    | "reconcile"
    | "reconcileDisk"
    | "audit"
    | "purge"
    | "republish"
    | "manifest";
  const [activeOp, setActiveOp] = useState<OpKind | null>(null);
  const [opProgress, setOpProgress] = useState<ImportProgress | null>(null);
  const [opSummary, setOpSummary] = useState<
    | { kind: "extract"; data: ExtractSummary }
    | { kind: "rescan"; data: RescanSummary }
    | { kind: "scan"; data: LibraryScanSummary }
    | { kind: "reconcile"; data: ReconcileSummary }
    | { kind: "reconcileDisk"; data: LibraryReconcileSummary }
    | { kind: "audit"; data: RelayAudit }
    | { kind: "purge"; data: PurgeSummary }
    | { kind: "manifest"; data: ManifestSummary }
    | null
  >(null);

  // Maintenance ops live behind a kebab to keep the toolbar from crowding the
  // search input. Click-outside + Escape close the popover.
  const [maintMenuOpen, setMaintMenuOpen] = useState(false);
  const maintMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!maintMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (
        maintMenuRef.current &&
        !maintMenuRef.current.contains(e.target as Node)
      ) {
        setMaintMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMaintMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [maintMenuOpen]);

  function setDraft(id: number, value: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }

  // Retract the stray events the audit turned up. Destructive on the relay
  // side, so it is a separate opt-in step rather than something the audit does
  // on its own. The backend re-checks every id against the DB and refuses to
  // touch anything still published, so a stale audit can't cause a repeat of
  // the whole-library unpublish.
  async function runPurge(audit: RelayAudit) {
    if (activeOp !== null || audit.purgeable.length === 0) return;
    const n = audit.purgeable.length;
    const yes = await ask(
      `Retract ${n.toLocaleString()} stray event${n === 1 ? "" : "s"} from the relays?\n\n` +
        "These are releases the relays are still serving that your library " +
        "says should not be public — either retracted/never-published " +
        "releases a relay ignored the deletion for, or leftovers whose local " +
        "release no longer exists.\n\n" +
        "A kind:5 deletion naming each event id is signed and sent. Nothing " +
        "in your library is deleted, and anything still marked published is " +
        "skipped.",
      { title: "Purge stray relay events", kind: "warning" },
    );
    if (!yes) return;

    setActiveOp("purge");
    setOpSummary(null);
    setOpProgress({ current: 0, total: n, currentDir: "" });
    setError(null);

    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<number>("purge:started", (e) => {
          setOpProgress({ current: 0, total: e.payload, currentDir: "" });
        }),
      );
      unlisteners.push(
        await listen<ImportProgress>("purge:progress", (e) => {
          setOpProgress(e.payload);
        }),
      );
      const data = await purgeRelayEvents(audit.purgeable, relays);
      setOpSummary({ kind: "purge", data });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      unlisteners.forEach((f) => f());
      setActiveOp(null);
      setOpProgress(null);
    }
  }

  // Re-send releases the DB calls published that some relay isn't serving —
  // either it never took the event, or its copy predates our last edit.
  async function runRepublishMissing(audit: RelayAudit) {
    if (activeOp !== null || audit.missing.length === 0) return;
    const n = audit.missing.length;
    const yes = await ask(
      `Re-publish ${n.toLocaleString()} release${n === 1 ? "" : "s"} to the relays?\n\n` +
        "Your library marks these published, but no relay is serving them — " +
        "so no reader can see them — or the only copies out there are out of " +
        "date.\n\n" +
        "Releases that merely one relay lacks are not included: readers " +
        "union their relay set, so another relay already covers those.",
      { title: "Re-publish unserved releases", kind: "info" },
    );
    if (!yes) return;

    setActiveOp("republish");
    setOpSummary(null);
    setOpProgress(null);
    setError(null);
    try {
      await publishByIds(audit.missing, relays);
      await reload();
      // Re-audit so the panel reflects the relays' new answer rather than a
      // count the user has to take on trust.
      setOpSummary({ kind: "audit", data: await auditRelays(relays) });
    } catch (e) {
      setError(String(e));
    } finally {
      setActiveOp(null);
    }
  }

  async function runBackgroundOp(kind: OpKind) {
    if (activeOp !== null) return;

    // Export the published set for the other suite apps (ntree samples only
    // released material). ndisc is the only app that knows what is published;
    // a shared manifest is how the others find out, without coupling them to
    // this schema or this DB's location.
    if (kind === "manifest") {
      setActiveOp("manifest");
      setOpSummary(null);
      setError(null);
      try {
        setOpSummary({ kind: "manifest", data: await exportPublishedManifest() });
      } catch (e) {
        setError(String(e));
      } finally {
        setActiveOp(null);
      }
      return;
    }

    // The outbound relay audit — read-only, and the only way to see events a
    // relay is serving that the DB has no idea about (ghosts and orphans).
    if (kind === "audit") {
      const yes = await ask(
        "Ask each configured relay what it is currently serving for your " +
          "key, and compare it with your library?\n\n" +
          "Read-only — nothing is signed or sent. Reports, per relay: how " +
          "many releases are live and correct, how many are still being " +
          "served that shouldn't be (relays that ignored a deletion), " +
          "leftovers with no local release, and any published release the " +
          "relay is missing.",
        { title: "Reconcile relays", kind: "info" },
      );
      if (!yes) return;
      setActiveOp("audit");
      setOpSummary(null);
      setOpProgress(null);
      setError(null);
      try {
        setOpSummary({ kind: "audit", data: await auditRelays(relays) });
      } catch (e) {
        setError(String(e));
      } finally {
        setActiveOp(null);
      }
      return;
    }

    // Reconcile is a network op, not a filesystem walk — no progress events,
    // a different summary shape, so it takes its own short path.
    if (kind === "reconcile") {
      const yes = await ask(
        "Fetch your published releases from the configured relays and " +
          "backfill local publish state?\n\n" +
          "Read-only on the relay side — no events are signed or sent. " +
          "Releases that relays already hold but the local DB still marks " +
          "as unpublished get their publish state restored.",
        { title: "Reconcile published state", kind: "info" },
      );
      if (!yes) return;
      setActiveOp("reconcile");
      setOpSummary(null);
      setOpProgress(null);
      setError(null);
      try {
        const data = await reconcilePublished(relays);
        setOpSummary({ kind: "reconcile", data });
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setActiveOp(null);
      }
      return;
    }

    // Disk reconcile — two phases (discover new folders, then refresh
    // existing) with their own import:*/scan:* progress events. Root is the
    // configured/derived library folder; bail with a nudge if there's none.
    if (kind === "reconcileDisk") {
      const root = await getLibraryRoot().catch(() => null);
      if (!root) {
        setError(
          "No library folder is set yet — use “Set library folder…” first.",
        );
        return;
      }
      const yes = await ask(
        `Rescan the library folder for changes?\n\n${root}\n\n` +
          "Phase 1 discovers album folders on disk not yet in the library " +
          "and adds them (existing releases are skipped). Phase 2 re-reads " +
          "every release with a path — recounting tracks and videos, " +
          "backfilling empty labels/notes, and flagging any whose folder " +
          "has gone missing (orphans). Curated labels and Discogs data are " +
          "preserved.",
        { title: "Rescan library folder", kind: "info" },
      );
      if (!yes) return;

      setActiveOp("reconcileDisk");
      setOpSummary(null);
      setOpProgress({ current: 0, total: 0, currentDir: "" });
      setError(null);

      const unlisteners: UnlistenFn[] = [];
      try {
        for (const ev of ["import:started", "scan:started"]) {
          unlisteners.push(
            await listen<number>(ev, (e) => {
              setOpProgress((p) => ({
                current: 0,
                total: e.payload,
                currentDir: p?.currentDir ?? "",
              }));
            }),
          );
        }
        for (const ev of ["import:progress", "scan:progress"]) {
          unlisteners.push(
            await listen<ImportProgress>(ev, (e) => {
              setOpProgress(e.payload);
            }),
          );
        }
        const data = await reconcileLibrary();
        setOpSummary({ kind: "reconcileDisk", data });
        await reload();
      } catch (e) {
        setError(String(e));
      } finally {
        unlisteners.forEach((f) => f());
        setActiveOp(null);
      }
      return;
    }

    const config =
      kind === "extract"
        ? {
            prompt:
              "Scan digital releases without a cover and extract embedded " +
                "artwork from their audio file tags?\n\n" +
                "For each release with embedded artwork, a file named " +
                "cover-extracted.{jpg,png,…} will be written into the album " +
                "directory and used as the local cover.",
            startEvent: "extract:started",
            progressEvent: "extract:progress",
          }
        : kind === "rescan"
          ? {
              prompt:
                "Re-scan album directories for cover-art image files using " +
                  "broader filename matching (albumart.*, art.*, files named " +
                  "after the album, etc.)?\n\n" +
                  "Only releases that still have no cover will be touched — " +
                  "no existing data is overwritten.",
              startEvent: "rescan:started",
              progressEvent: "rescan:progress",
            }
          : {
              prompt:
                "Scan the whole library for filesystem changes?\n\n" +
                  "For each release with a file path, re-reads audio tags " +
                  "and looks up the local cover, updating the DB to match " +
                  "what's on disk. Reports refreshed / unchanged / " +
                  "orphaned (path missing) counts at the end.\n\n" +
                  "Useful after editing files in another music app.",
              startEvent: "scan:started",
              progressEvent: "scan:progress",
            };

    const dialogTitle =
      kind === "extract"
        ? "Extract embedded artwork"
        : kind === "rescan"
          ? "Rescan local covers"
          : "Scan library for changes";
    const yes = await ask(config.prompt, {
      title: dialogTitle,
      kind: "info",
    });
    if (!yes) return;

    setActiveOp(kind);
    setOpSummary(null);
    setOpProgress({ current: 0, total: 0, currentDir: "" });
    setError(null);

    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<number>(config.startEvent, (e) => {
          setOpProgress((p) => ({
            current: p?.current ?? 0,
            total: e.payload,
            currentDir: p?.currentDir ?? "",
          }));
        }),
      );
      unlisteners.push(
        await listen<ImportProgress>(config.progressEvent, (e) => {
          setOpProgress(e.payload);
        }),
      );

      if (kind === "extract") {
        const data = await extractEmbeddedCovers();
        setOpSummary({ kind: "extract", data });
      } else if (kind === "rescan") {
        const data = await rescanLocalCovers();
        setOpSummary({ kind: "rescan", data });
      } else {
        const data = await scanLibraryChanges();
        setOpSummary({ kind: "scan", data });
      }
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      unlisteners.forEach((f) => f());
      setActiveOp(null);
    }
  }

  // Override the auto-derived reconcile root. Prefilled with the current
  // effective root so the picker opens where the library already lives.
  async function setLibraryFolder() {
    setMaintMenuOpen(false);
    const current = await getLibraryRoot().catch(() => null);
    let picked: string | null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Set your music library folder",
        defaultPath: current ?? undefined,
      });
      picked = typeof result === "string" ? result : null;
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!picked) return;
    try {
      await setLibraryRoot(picked);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteOrphan(e: React.MouseEvent, orphan: OrphanInfo) {
    e.preventDefault();
    e.stopPropagation();
    const yes = await ask(
      `Delete the database row for "${orphan.artist} — ${orphan.title}"?\n\n` +
        `Old path: ${orphan.filePath}\n\n` +
        `The release is already missing from disk; this removes the orphaned ` +
        `DB row. Any previously-published Nostr event remains until you ` +
        `Unpublish it.`,
      { title: "Delete orphan", kind: "warning" },
    );
    if (!yes) return;
    try {
      await deleteRelease(orphan.id);
      setOpSummary((prev) => {
        if (prev?.kind === "scan") {
          return {
            kind: "scan",
            data: {
              ...prev.data,
              scanned: Math.max(0, prev.data.scanned - 1),
              orphaned: Math.max(0, prev.data.orphaned - 1),
              orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
            },
          };
        }
        if (prev?.kind === "reconcileDisk") {
          return {
            kind: "reconcileDisk",
            data: {
              ...prev.data,
              orphaned: Math.max(0, prev.data.orphaned - 1),
              orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
            },
          };
        }
        return prev;
      });
      await reload();
    } catch (err) {
      setError(String(err));
    }
  }

  async function relocateOrphan(
    e: React.MouseEvent,
    orphan: OrphanInfo,
  ) {
    e.preventDefault();
    e.stopPropagation();
    let picked: string | null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: `New location for ${orphan.artist} — ${orphan.title}`,
      });
      picked = typeof result === "string" ? result : null;
    } catch (err) {
      setError(String(err));
      return;
    }
    if (!picked) return;

    try {
      await updateReleasePath(orphan.id, picked);
      setOpSummary((prev) => {
        if (prev?.kind === "scan") {
          return {
            kind: "scan",
            data: {
              ...prev.data,
              orphaned: Math.max(0, prev.data.orphaned - 1),
              refreshed: prev.data.refreshed + 1,
              orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
            },
          };
        }
        if (prev?.kind === "reconcileDisk") {
          return {
            kind: "reconcileDisk",
            data: {
              ...prev.data,
              orphaned: Math.max(0, prev.data.orphaned - 1),
              refreshed: prev.data.refreshed + 1,
              orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
            },
          };
        }
        return prev;
      });
      await reload();
    } catch (err) {
      setError(String(err));
    }
  }

  async function unpublishOrphan(
    e: React.MouseEvent,
    orphan: OrphanEvent,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const label =
      [orphan.artist, orphan.title].filter(Boolean).join(" — ") ||
      `disco-vault:${orphan.id}`;
    const yes = await ask(
      `Delete the stale Nostr event for "${label}"?\n\n` +
        `This release has no local row (id ${orphan.id}) — the event is ` +
        `left over from a DB rebuild that shifted release ids. A kind:5 ` +
        `deletion will be sent to your relays to remove it.`,
      { title: "Unpublish orphan", kind: "warning" },
    );
    if (!yes) return;
    try {
      await unpublishRelease(orphan.id, relays);
      setOpSummary((prev) => {
        if (!prev || prev.kind !== "reconcile") return prev;
        return {
          kind: "reconcile",
          data: {
            ...prev.data,
            orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
          },
        };
      });
    } catch (err) {
      setError(String(err));
    }
  }

  async function saveCover(releaseId: number) {
    const url = drafts.get(releaseId)?.trim();
    if (!url || savingId !== null) return;
    setSavingId(releaseId);
    setError(null);
    try {
      await setCoverArtUrl(releaseId, url);
      const savedIdx = items.findIndex((r) => r.id === releaseId);
      const nextId =
        savedIdx >= 0 && savedIdx + 1 < items.length
          ? items[savedIdx + 1].id
          : undefined;
      setItems((prev) => prev.filter((r) => r.id !== releaseId));
      setDrafts((prev) => {
        const next = new Map(prev);
        next.delete(releaseId);
        return next;
      });
      if (nextId !== undefined) {
        requestAnimationFrame(() => {
          inputRefs.current.get(nextId)?.focus();
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const list = await listReleases(
        query,
        medium || undefined,
        needsCoverOnly ? true : undefined,
        publishStateFilter || undefined,
        labelFilter || undefined,
        genreFilter || undefined,
        videoFilter || undefined,
        coverLinkFilter || undefined,
      );
      setItems(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, medium, needsCoverOnly, publishStateFilter, labelFilter, genreFilter, videoFilter, coverLinkFilter]);

  // Bubble the FULL filter set + the exact visible id list up so the Nostr
  // panel's bulk ops act on precisely what's on screen (and describe it in
  // full). Every filter must be represented here — a missing one silently
  // broadens the op vs the view.
  const visibleIds = items
    .map((r) => r.id)
    .filter((id): id is number => id !== undefined);
  const visibleIdsKey = visibleIds.join(",");
  useEffect(() => {
    if (!onFilterChange) return;
    onFilterChange({
      query,
      medium: medium === "" ? null : medium,
      needsCoverOnly,
      publishStateFilter: publishStateFilter === "" ? null : publishStateFilter,
      labelFilter: labelFilter === "" ? null : labelFilter,
      genreFilter: genreFilter === "" ? null : genreFilter,
      videoFilter: videoFilter === "" ? null : videoFilter,
      coverLinkFilter: coverLinkFilter === "" ? null : coverLinkFilter,
      count: items.length,
      visibleIds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    query,
    medium,
    needsCoverOnly,
    publishStateFilter,
    labelFilter,
    genreFilter,
    videoFilter,
    coverLinkFilter,
    visibleIdsKey,
    onFilterChange,
  ]);

  // When the no-cover filter is turned on, autofocus the first row's URL
  // input once the list has loaded.
  useEffect(() => {
    if (needsCoverOnly) {
      setAutoFocusPending(true);
    } else {
      setDrafts(new Map());
      inputRefs.current.clear();
    }
  }, [needsCoverOnly]);

  useEffect(() => {
    if (!autoFocusPending || items.length === 0) return;
    const firstId = items[0].id;
    if (firstId !== undefined) {
      requestAnimationFrame(() => {
        inputRefs.current.get(firstId)?.focus();
      });
    }
    setAutoFocusPending(false);
  }, [items, autoFocusPending]);

  const publishedCount = items.filter(
    (r) => r.lastPublishedAt != null,
  ).length;
  const unpublishedCount = items.length - publishedCount;

  return (
    <Section
      title=""
      icon={<Disc3 size={16} />}
      bodyClassName="lg:min-h-0"
      right={
        <span className="text-xs text-muted">
          <span className="text-accent font-mono">{items.length}</span>{" "}
          {items.length === 1 ? "release" : "releases"}
          {items.length > 0 && (
            <>
              <span className="ml-1">
                ·{" "}
                <span className="text-mauve font-mono">
                  {publishedCount}
                </span>{" "}
                published
              </span>
              <span className="ml-1">
                ·{" "}
                <span className="text-fg font-mono">
                  {unpublishedCount}
                </span>{" "}
                unpublished
              </span>
            </>
          )}
          {needsCoverOnly && (
            <span className="ml-1 text-warn">· no cover</span>
          )}
        </span>
      }
      className="lg:flex-1 lg:min-h-0"
    >
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reload()}
            placeholder="search …"
            className="w-full pl-7 pr-3 py-2 rounded-md bg-surface text-fg
                       placeholder:text-muted outline-none border border-transparent
                       focus:border-accent/50 text-xs"
            spellCheck={false}
          />
        </div>
        <FilterToggle
          Icon={Disc3}
          value={medium}
          onChange={(v) => setMedium(v as MediumFilter)}
          filledValue="physical"
          outlinedValue="digital"
          tooltipDefault="Filter by medium — click cycles physical / digital / any"
          tooltipFilled="Medium: physical (click for digital)"
          tooltipOutlined="Medium: digital (click to clear)"
        />
        <PublishStateFilter
          value={publishStateFilter}
          onChange={setPublishStateFilter}
        />
        <FilterToggle
          Icon={Tag}
          value={labelFilter}
          onChange={(v) => setLabelFilter(v as "" | LabelFilter)}
          filledValue="with_label"
          outlinedValue="without_label"
          tooltipDefault="Filter by presence of a record label — click cycles has / no / any"
          tooltipFilled="Label: has label (click for no label)"
          tooltipOutlined="Label: no label (click to clear)"
        />
        <FilterToggle
          Icon={Music}
          value={genreFilter}
          onChange={(v) => setGenreFilter(v as "" | GenreFilter)}
          filledValue="with_genre"
          outlinedValue="without_genre"
          tooltipDefault="Filter by presence of a genre tag — click cycles has / no / any"
          tooltipFilled="Genre: has genre (click for no genre)"
          tooltipOutlined="Genre: no genre (click to clear)"
        />
        <FilterToggle
          Icon={Film}
          value={videoFilter}
          onChange={(v) => setVideoFilter(v as "" | VideoFilter)}
          filledValue="with_video"
          outlinedValue="without_video"
          tooltipDefault="Filter by audio-visual content — click cycles has video / audio-only / any"
          tooltipFilled="Video: has video (click for audio-only)"
          tooltipOutlined="Video: audio-only (click to clear)"
        />
        <FilterToggle
          Icon={Link2}
          value={coverLinkFilter}
          onChange={(v) => setCoverLinkFilter(v as "" | CoverLinkFilter)}
          filledValue="with_link"
          outlinedValue="without_link"
          tooltipDefault="Filter by web image link — click cycles has link / no link / any"
          tooltipFilled="Web image: has link (click for no link)"
          tooltipOutlined="Web image: no link (click to clear)"
        />
        <button
          onClick={() => setNeedsCoverOnly((v) => !v)}
          className={cn(
            "p-2 rounded-md text-fg",
            needsCoverOnly
              ? "bg-accent text-bg"
              : "bg-surface hover:bg-surfaceHover",
          )}
          title={
            needsCoverOnly
              ? "Showing only releases without a cover (click to clear)"
              : "Show only releases without a cover"
          }
          aria-pressed={needsCoverOnly}
        >
          <ImageOff size={14} />
        </button>
        <div className="relative" ref={maintMenuRef}>
          <button
            onClick={() => setMaintMenuOpen((v) => !v)}
            className="p-2 rounded-md bg-surface hover:bg-surfaceHover text-fg"
            title="Library maintenance"
            aria-haspopup="menu"
            aria-expanded={maintMenuOpen}
          >
            <MoreVertical
              size={14}
              className={activeOp ? "animate-pulse text-accent" : ""}
            />
          </button>
          {maintMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 z-20 w-72
                         rounded-md bg-panel border border-surface/60
                         shadow-lg overflow-hidden text-xs"
            >
              <MaintMenuItem
                icon={<Wand2 size={14} />}
                label="Extract embedded artwork"
                detail="Pull cover art from digital releases"
                active={activeOp === "extract"}
                disabled={activeOp !== null}
                onClick={() => {
                  setMaintMenuOpen(false);
                  runBackgroundOp("extract");
                }}
              />
              <MaintMenuItem
                icon={<FolderSearch size={14} />}
                label="Rescan local covers"
                detail="Scan and match local files and dirs"
                active={activeOp === "rescan"}
                disabled={activeOp !== null}
                onClick={() => {
                  setMaintMenuOpen(false);
                  runBackgroundOp("rescan");
                }}
              />
              <MaintMenuItem
                icon={<ScanLine size={14} />}
                label="Scan library for changes"
                detail="Re-read tags and cover art"
                active={activeOp === "scan"}
                disabled={activeOp !== null}
                onClick={() => {
                  setMaintMenuOpen(false);
                  runBackgroundOp("scan");
                }}
              />
              <MaintMenuItem
                icon={<FolderSync size={14} />}
                label="Rescan library folder"
                detail="Find new folders + refresh existing"
                active={activeOp === "reconcileDisk"}
                disabled={activeOp !== null}
                onClick={() => {
                  setMaintMenuOpen(false);
                  runBackgroundOp("reconcileDisk");
                }}
              />
              <MaintMenuItem
                icon={<FolderCog size={14} />}
                label="Set library folder…"
                detail="Choose the root the rescan walks"
                active={false}
                disabled={activeOp !== null}
                onClick={setLibraryFolder}
              />
              <MaintMenuItem
                icon={<SatelliteDish size={14} />}
                label="Reconcile published state"
                detail="Backfill publish markers from relays"
                active={activeOp === "reconcile"}
                disabled={activeOp !== null}
                onClick={() => {
                  setMaintMenuOpen(false);
                  runBackgroundOp("reconcile");
                }}
              />
              <MaintMenuItem
                icon={<Radar size={14} />}
                label="Reconcile relays"
                detail="What each relay serves vs the library"
                active={activeOp === "audit"}
                disabled={activeOp !== null}
                onClick={() => {
                  setMaintMenuOpen(false);
                  runBackgroundOp("audit");
                }}
              />
              <MaintMenuItem
                icon={<Share2 size={14} />}
                label="Export published manifest"
                detail="Share the released set with the other suite apps"
                active={activeOp === "manifest"}
                disabled={activeOp !== null}
                onClick={() => {
                  setMaintMenuOpen(false);
                  runBackgroundOp("manifest");
                }}
              />
            </div>
          )}
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="p-2 rounded-md bg-surface hover:bg-surfaceHover text-fg
                     disabled:opacity-50"
          title="Reload"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-alert font-mono break-all">{error}</p>
      )}

      {activeOp && opProgress && (
        <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs">
          <div className="flex justify-between text-muted">
            <span>
              {activeOp === "extract"
                ? "extracting embedded artwork"
                : activeOp === "rescan"
                  ? "scanning for local cover files"
                  : activeOp === "reconcileDisk"
                    ? "reconciling library folder"
                    : activeOp === "purge"
                      ? "retracting stray events from relays"
                      : "scanning library for changes"}{" "}
              <span className="font-mono text-fg">
                {opProgress.current.toLocaleString()}/
                {(opProgress.total || 0).toLocaleString()}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{
                width: `${
                  opProgress.total > 0
                    ? Math.min(
                        100,
                        (opProgress.current / opProgress.total) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="mt-1 text-[10px] font-mono text-fg/60 truncate">
            {opProgress.currentDir}
          </div>
        </div>
      )}

      {activeOp === "reconcile" && (
        <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs
                        text-muted flex items-center gap-2">
          <SatelliteDish size={12} className="animate-pulse text-accent" />
          contacting relays — fetching published releases…
        </div>
      )}

      {activeOp === "audit" && (
        <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs
                        text-muted flex items-center gap-2">
          <Radar size={12} className="animate-pulse text-accent" />
          querying relays — this walks the full event set, give it a moment…
        </div>
      )}

      {activeOp === "republish" && (
        <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs
                        text-muted flex items-center gap-2">
          <SatelliteDish size={12} className="animate-pulse text-accent" />
          re-publishing missing releases…
        </div>
      )}

      {!activeOp && opSummary?.kind === "audit" && (
        <RelayAuditPanel
          audit={opSummary.data}
          onPurge={() => runPurge(opSummary.data)}
          onRepublish={() => runRepublishMissing(opSummary.data)}
          onDismiss={() => setOpSummary(null)}
        />
      )}

      {!activeOp && opSummary && opSummary.kind !== "audit" && (
        <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs
                        flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {opSummary.kind === "extract" && (
              <>
                <span className="text-ok">
                  extracted{" "}
                  <span className="font-mono">{opSummary.data.extracted}</span>
                </span>
                <span className="text-muted">
                  no embedded{" "}
                  <span className="font-mono">
                    {opSummary.data.noEmbedded}
                  </span>
                </span>
                {opSummary.data.noAudio > 0 && (
                  <span className="text-muted">
                    no audio{" "}
                    <span className="font-mono">{opSummary.data.noAudio}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind === "rescan" && (
              <>
                <span className="text-ok">
                  matched{" "}
                  <span className="font-mono">{opSummary.data.matched}</span>
                </span>
                <span className="text-muted">
                  no match{" "}
                  <span className="font-mono">{opSummary.data.noMatch}</span>
                </span>
                {opSummary.data.noDir > 0 && (
                  <span className="text-muted">
                    no dir{" "}
                    <span className="font-mono">{opSummary.data.noDir}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind === "scan" && (
              <>
                <span className="text-ok">
                  refreshed{" "}
                  <span className="font-mono">{opSummary.data.refreshed}</span>
                </span>
                <span className="text-muted">
                  unchanged{" "}
                  <span className="font-mono">{opSummary.data.noChanges}</span>
                </span>
                {opSummary.data.orphaned > 0 && (
                  <span className="text-warn">
                    orphaned{" "}
                    <span className="font-mono">{opSummary.data.orphaned}</span>
                  </span>
                )}
                {opSummary.data.noAudio > 0 && (
                  <span className="text-muted">
                    no audio{" "}
                    <span className="font-mono">{opSummary.data.noAudio}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind === "reconcileDisk" && (
              <>
                <span className="text-ok">
                  new{" "}
                  <span className="font-mono">{opSummary.data.imported}</span>
                </span>
                <span className="text-ok">
                  refreshed{" "}
                  <span className="font-mono">{opSummary.data.refreshed}</span>
                </span>
                <span className="text-muted">
                  unchanged{" "}
                  <span className="font-mono">{opSummary.data.noChanges}</span>
                </span>
                {opSummary.data.orphaned > 0 && (
                  <span className="text-warn">
                    orphaned{" "}
                    <span className="font-mono">{opSummary.data.orphaned}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind === "reconcile" && (
              <>
                <span className="text-ok">
                  restored{" "}
                  <span className="font-mono">{opSummary.data.updated}</span>
                </span>
                <span className="text-muted">
                  already marked{" "}
                  <span className="font-mono">
                    {opSummary.data.alreadyMarked}
                  </span>
                </span>
                <span className="text-muted">
                  on relays{" "}
                  <span className="font-mono">
                    {opSummary.data.eventsFound}
                  </span>
                </span>
                {opSummary.data.unmatched > 0 && (
                  <span className="text-warn">
                    no local match{" "}
                    <span className="font-mono">
                      {opSummary.data.unmatched}
                    </span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind === "manifest" && (
              <>
                <span className="text-ok">
                  exported{" "}
                  <span className="font-mono">{opSummary.data.releases}</span>{" "}
                  released
                </span>
                {opSummary.data.withoutPath > 0 && (
                  <span
                    className="text-muted"
                    title="Published, but with no folder on disk — nothing can sample them"
                  >
                    no folder{" "}
                    <span className="font-mono">
                      {opSummary.data.withoutPath}
                    </span>
                  </span>
                )}
                <span className="text-muted font-mono truncate max-w-[22rem]">
                  {opSummary.data.path}
                </span>
              </>
            )}
            {opSummary.kind === "purge" && (
              <>
                <span className="text-ok">
                  retracted{" "}
                  <span className="font-mono">{opSummary.data.purged}</span>
                </span>
                {opSummary.data.skipped > 0 && (
                  <span className="text-muted">
                    left alone (still published){" "}
                    <span className="font-mono">{opSummary.data.skipped}</span>
                  </span>
                )}
                {opSummary.data.failed > 0 && (
                  <span className="text-warn">
                    failed{" "}
                    <span className="font-mono">{opSummary.data.failed}</span>
                  </span>
                )}
              </>
            )}
            {opSummary.kind !== "reconcile" &&
              opSummary.kind !== "manifest" &&
              opSummary.data.errors.length > 0 && (
                <span className="text-alert">
                  errors{" "}
                  <span className="font-mono">
                    {opSummary.data.errors.length}
                  </span>
                </span>
              )}
          </div>
          <button
            onClick={() => setOpSummary(null)}
            className="text-muted hover:text-fg text-[10px] px-1"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {!activeOp &&
        (opSummary?.kind === "scan" || opSummary?.kind === "reconcileDisk") &&
        opSummary.data.orphans.length > 0 && (
        <details className="mt-2 px-3 py-2 rounded-md bg-surface/40">
          <summary className="text-warn cursor-pointer text-xs">
            {opSummary.data.orphans.length} orphan
            {opSummary.data.orphans.length === 1 ? "" : "s"} — path missing on
            disk
          </summary>
          <ul className="mt-2 max-h-64 overflow-auto space-y-1 text-[10px]">
            {opSummary.data.orphans.map((o) => (
              <li
                key={o.id}
                className="px-2 py-1 rounded bg-bg/50 flex items-start gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-fg">
                    {o.artist}{" "}
                    <span className="text-muted">·</span> {o.title}
                  </div>
                  <div className="text-muted font-mono break-all">
                    {o.filePath}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    onClick={(e) => relocateOrphan(e, o)}
                    className="px-2 py-1 rounded bg-mauve/15 text-mauve
                               hover:bg-mauve hover:text-bg text-[10px]
                               font-medium transition-colors"
                    title="Pick the new directory for this release"
                  >
                    Locate…
                  </button>
                  <button
                    onClick={(e) => deleteOrphan(e, o)}
                    className="px-2 py-1 rounded text-muted hover:text-alert
                               text-[10px] font-medium transition-colors"
                    title="Remove this orphaned row from the database"
                  >
                    delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!activeOp &&
        opSummary?.kind === "reconcile" &&
        opSummary.data.orphans.length > 0 && (
          <details className="mt-2 px-3 py-2 rounded-md bg-surface/40">
            <summary className="text-warn cursor-pointer text-xs">
              {opSummary.data.orphans.length} orphan
              {opSummary.data.orphans.length === 1 ? "" : "s"} — published on
              relays, no local release
            </summary>
            <ul className="mt-2 max-h-64 overflow-auto space-y-1 text-[10px]">
              {opSummary.data.orphans.map((o) => (
                <li
                  key={o.id}
                  className="px-2 py-1 rounded bg-bg/50 flex items-start gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-fg">
                      {o.artist || "—"}{" "}
                      <span className="text-muted">·</span> {o.title || "—"}
                    </div>
                    <div className="text-muted font-mono">
                      disco-vault:{o.id}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <button
                      onClick={(e) => unpublishOrphan(e, o)}
                      className="px-2 py-1 rounded bg-mauve/15 text-mauve
                                 hover:bg-mauve hover:text-bg text-[10px]
                                 font-medium transition-colors"
                      title="Send a kind:5 deletion to remove this stale event from your relays"
                    >
                      Unpublish
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}

      {/* At lg+ the app is a fixed one-screen shell: the list flex-fills its
          column (capped to the viewport) and scrolls internally through the
          rest of the DB — so it shows as many rows as the monitor allows.
          Below lg the layout stacks and scrolls as a page, so we fall back to
          the viewport-minus-chrome height. */}
      <div className="relative mt-1 h-[calc(100vh-220px)] lg:h-auto lg:flex-1
                      lg:min-h-0">
        {/* Jump to previous / next index character. Pinned over the rail
            gutter; up = previous letter, down = next. */}
        <button
          type="button"
          onClick={() => jumpBucket(-1)}
          title="Jump to previous letter"
          aria-label="Jump to previous index letter"
          className="absolute left-0 top-1 z-10 grid place-items-center w-5 h-5
                     rounded bg-surface/90 text-fg ring-1 ring-fg/15
                     hover:bg-surfaceHover shadow-sm"
        >
          <ChevronUp size={12} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => jumpBucket(1)}
          title="Jump to next letter"
          aria-label="Jump to next index letter"
          className="absolute left-0 bottom-1 z-10 grid place-items-center
                     w-5 h-5 rounded bg-surface/90 text-fg ring-1 ring-fg/15
                     hover:bg-surfaceHover shadow-sm"
        >
          <ChevronDown size={12} strokeWidth={2.5} />
        </button>
      <ul
        ref={listRef}
        className="h-full overflow-auto rounded-md
                   bg-bg/50 [scrollbar-gutter:stable]"
      >
        {items.length === 0 && !loading && !error && (
          <li className="px-3 py-3 text-muted text-xs">
            {needsCoverOnly
              ? "All releases in this view have cover art."
              : "Empty library — add your first release on the right."}
          </li>
        )}
        {items.map((r, idx) => {
          const thumb = coverImageSrc(r);
          const showInlineEditor = needsCoverOnly && r.id !== undefined;
          const draftValue = r.id !== undefined ? drafts.get(r.id) ?? "" : "";
          const saveDisabled =
            !draftValue.trim() || savingId !== null;
          // Index rail: show the bucket marker only on the first row of each
          // run (the artist sort makes these runs contiguous), blank on the
          // continuations — so the left edge reads # · 0–9 · A–Z top to bottom.
          const bucket = indexBucket(r.artist);
          const marker =
            idx === 0 || indexBucket(items[idx - 1].artist) !== bucket
              ? bucket
              : "";
          return (
            <li
              key={r.id}
              onClick={() => onSelect(r)}
              data-bucket-start={marker ? "" : undefined}
              className={cn(
                "cursor-pointer hover:bg-surface/40 text-xs",
                "flex items-stretch",
                selected?.id === r.id && "bg-surface/70",
              )}
            >
              <div
                className="shrink-0 w-6 relative"
                aria-hidden={marker === ""}
              >
                {/* ruler ticks only: a short stub per release, longer where
                    the index character changes (top edge = the row boundary).
                    The section letter is no longer drawn here — the first
                    artist of each bucket is highlighted in the row instead. */}
                <div
                  className={cn(
                    "absolute right-0 top-0 h-px bg-fg/70",
                    marker ? "w-[6px]" : "w-[3px]",
                  )}
                />
              </div>
              <div
                className={cn(
                  "flex-1 min-w-0 flex flex-col gap-1.5 pl-2 pr-3 py-2",
                  idx > 0 && "border-t border-surface/60",
                )}
              >
              <div className="flex items-center gap-2">
                <CoverThumb src={thumb} />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate",
                      selected?.id === r.id ? "text-accent" : "text-fg",
                    )}
                  >
                    {/* First release of each index bucket: highlight the
                        artist as a tinted pill — this is the section marker
                        now (the gutter letter box is gone). */}
                    {marker ? (
                      <span
                        className="rounded px-1.5 py-0.5"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, rgb(var(--c-digital)) 40%," +
                            " rgb(var(--c-bg)) 60%)",
                        }}
                      >
                        {r.artist}
                      </span>
                    ) : (
                      r.artist
                    )}{" "}
                    <span className="text-muted">·</span> {r.title}
                  </div>
                  <div className="text-muted text-[10px] truncate">
                    {[r.year, r.format, r.label, r.catalogNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Leaf meter — present (green) vs expected (faint) tracks.
                      Completeness is keyed on whether there's a local folder to
                      count (file_path), NOT the medium enum: a folder-linked
                      release (digital, or a physical you've also ripped) shows
                      present-vs-total ("1 of 12"); an object-only release (no
                      folder) can't be "missing" tracks, so present = total →
                      all solid (reads as the release's size). Capped at 4 rows
                      — taller counts collapse to a solid green tile + 8-ball. */}
                  {(r.trackCount != null || r.trackTotal != null) && (
                    <LeafDots
                      n={
                        (r.filePath ? r.trackCount : r.trackTotal) ?? 0
                      }
                      total={r.trackTotal}
                      maxCols={8}
                      maxRows={4}
                    />
                  )}
                  {/* Disc count — same leaf green as the track tile (mauve is
                      reserved suite-wide for the published-to-Nostr state); the
                      circle shape keeps it distinct from the square track tile.
                      Single-disc stays unmarked. */}
                  {r.discTotal != null && r.discTotal > 1 && (
                    <CountBadge
                      value={r.discTotal}
                      title={`${r.discTotal} discs`}
                      shapeClassName="rounded-full"
                      colorClassName="bg-ok/70 text-bg"
                    />
                  )}
                  {/* Audio-visual marker — present when the release folder
                      holds video files. Discoverability only; the count is in
                      the tooltip. */}
                  {r.videoCount != null && r.videoCount > 0 && (
                    <span
                      className="shrink-0 grid place-items-center text-fg/55"
                      title={`${r.videoCount} video file${r.videoCount === 1 ? "" : "s"}`}
                      aria-label="has video"
                    >
                      <Film size={12} />
                    </span>
                  )}
                  {/* State cluster: 4-state publish dot + medium share one
                      neutral rounded-rectangle bg (non-interactive — state
                      only). Dot colour = the shared publish-state vocabulary
                      (never grey · published nostr-purple · stale amber ·
                      retracted red), matching the toolbar state filter. */}
                  <div
                    className={cn(
                      "shrink-0 inline-flex items-center justify-center",
                      "gap-1 px-1.5 h-5 min-w-[38px] rounded-full bg-surface/60",
                      // Linked band: a PHYSICAL release that's been attached to
                      // a local (digital) folder gets a green ring around the
                      // state cluster — visual confirmation the physical object
                      // and its digital version are matched. Digital releases
                      // always have a folder, so they're excluded (a future
                      // "completed" band for digital keys on track == total).
                      r.medium === "physical" &&
                        r.filePath &&
                        "ring-[1.5px] ring-ok",
                    )}
                    title={
                      r.medium === "physical" && r.filePath
                        ? `Linked to a local folder\n${r.filePath}`
                        : undefined
                    }
                  >
                    {(() => {
                      const m = publishStateMeta(publishStateOf(r));
                      return (
                        <span
                          title={`Publish state: ${m.label} — ${m.desc}`}
                          aria-label={`publish state: ${m.label}`}
                          className="inline-flex"
                        >
                          <Circle
                            size={10}
                            fill="currentColor"
                            className={cn("shrink-0", m.dot)}
                          />
                        </span>
                      );
                    })()}
                    {/* Medium — sharpened contrast: physical is a solid filled
                        disc, digital a hollow ring (intangible — no platter).
                        Tinted by source platform (Bandcamp cyan, SoundCloud
                        orange, …) when one is detected, so a release's origin
                        reads at a glance; neutral `text-medium` otherwise. The
                        shape still encodes physical/digital — only colour
                        changes. */}
                    {(() => {
                      const platform = sourcePlatform(r);
                      const tip = platform ? ` · ${platform.label}` : "";
                      const tint = platform
                        ? { color: platform.color }
                        : undefined;
                      if (r.medium === "physical") {
                        return (
                          <span
                            title={`physical${tip}`}
                            aria-label={`physical${tip}`}
                            className={cn(
                              "grid place-items-center",
                              !platform && "text-medium",
                            )}
                            style={tint}
                          >
                            <Disc3 size={12} fill="currentColor" />
                          </span>
                        );
                      }
                      if (r.medium === "digital") {
                        return (
                          <span
                            title={`digital${tip}`}
                            aria-label={`digital${tip}`}
                            className={cn(
                              "grid place-items-center",
                              !platform && "text-medium/70",
                            )}
                            style={tint}
                          >
                            <Circle size={11} />
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              </div>

              {showInlineEditor && (
                <div
                  className="flex gap-1.5 items-center pl-11"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={(el) => {
                      if (r.id !== undefined) {
                        if (el) inputRefs.current.set(r.id, el);
                        else inputRefs.current.delete(r.id);
                      }
                    }}
                    type="text"
                    value={draftValue}
                    onChange={(e) =>
                      r.id !== undefined && setDraft(r.id, e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (r.id !== undefined) saveCover(r.id);
                      }
                    }}
                    placeholder="https://i.nostr.build/…"
                    className="flex-1 px-2 py-1 rounded bg-surface text-fg
                               text-[10px] font-mono outline-none border
                               border-transparent focus:border-accent/50"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (r.id !== undefined) saveCover(r.id);
                    }}
                    disabled={saveDisabled}
                    className="px-2 py-1 rounded bg-accent text-bg font-semibold
                               hover:opacity-90 disabled:opacity-50
                               disabled:cursor-not-allowed text-[10px]"
                  >
                    {savingId === r.id ? "…" : "save"}
                  </button>
                </div>
              )}
              </div>
            </li>
          );
        })}
      </ul>
      </div>
    </Section>
  );
}

// Tri-state icon toggle for binary-ish filters in the RELEASES header.
// Each click cycles the value: "" → filledValue → outlinedValue → "".
// Visual state via the icon's fill: default muted, "filled" = accent + solid,
// "outlined" = accent + stroke only. Same w-9 footprint as the existing
// needsCover and maintenance icon buttons so the whole row reads uniform.
interface FilterToggleProps {
  Icon: LucideIcon;
  value: string;
  onChange: (v: string) => void;
  filledValue: string;
  outlinedValue: string;
  tooltipDefault: string;
  tooltipFilled: string;
  tooltipOutlined: string;
}

function FilterToggle({
  Icon,
  value,
  onChange,
  filledValue,
  outlinedValue,
  tooltipDefault,
  tooltipFilled,
  tooltipOutlined,
}: FilterToggleProps) {
  const state =
    value === filledValue
      ? "filled"
      : value === outlinedValue
        ? "outlined"
        : "default";
  const next =
    state === "default"
      ? filledValue
      : state === "filled"
        ? outlinedValue
        : "";
  const tooltip =
    state === "filled"
      ? tooltipFilled
      : state === "outlined"
        ? tooltipOutlined
        : tooltipDefault;
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={state !== "default"}
      className={cn(
        "p-2 rounded-md transition-colors",
        state === "default" &&
          "bg-surface text-muted hover:text-fg hover:bg-surfaceHover",
        state === "filled" && "bg-accent text-bg",
        state === "outlined" && "bg-surface text-accent hover:bg-surfaceHover",
      )}
    >
      <Icon
        size={14}
        fill={state === "filled" ? "currentColor" : "none"}
      />
    </button>
  );
}

// Four-state publish-state filter. A toggle can't hold four values + "any", so
// this is a small dropdown; the button carries a coloured state dot when a
// state is selected, matching the per-row indicators.
function PublishStateFilter({
  value,
  onChange,
}: {
  value: "" | PublishState;
  onChange: (v: "" | PublishState) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const meta = value !== "" ? publishStateMeta(value) : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={
          meta
            ? `Publish state: ${meta.label} — ${meta.desc}`
            : "Filter by Nostr publish state"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={value !== ""}
        className={cn(
          "relative p-2 rounded-md transition-colors",
          value !== ""
            ? "bg-accent text-bg"
            : "bg-surface text-muted hover:text-fg hover:bg-surfaceHover",
        )}
      >
        <Radio size={14} />
        {meta && (
          <Circle
            size={7}
            className={cn("absolute -top-0.5 -right-0.5", meta.dot)}
            fill="currentColor"
          />
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-52 rounded-md
                     bg-panel border border-surface/60 shadow-lg overflow-hidden
                     text-xs py-1"
        >
          <button
            role="menuitemradio"
            aria-checked={value === ""}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left",
              "hover:bg-surface/60 transition-colors",
              value === "" ? "text-accent" : "text-fg/80",
            )}
          >
            <Circle size={8} className="text-muted/40" />
            Any state
          </button>
          {PUBLISH_STATES.map((s) => (
            <button
              key={s.value}
              role="menuitemradio"
              aria-checked={value === s.value}
              title={s.desc}
              onClick={() => {
                onChange(s.value);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-left",
                "hover:bg-surface/60 transition-colors",
                value === s.value ? "bg-surface/50 text-fg" : "text-fg/80",
              )}
            >
              <Circle size={8} className={s.dot} fill="currentColor" />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Release-row thumbnail. Falls back to a dashed placeholder when there is
// no cover, or when a set cover URL/path fails to load.
function CoverThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = src != null && !failed;

  return (
    <div
      className={cn(
        "shrink-0 w-9 h-9 rounded overflow-hidden flex items-center",
        "justify-center",
        showImage
          ? "bg-surface"
          : "border border-dashed border-mauve/40 bg-mauve/5",
      )}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Disc3 size={14} className="text-mauve/50" />
      )}
    </div>
  );
}

interface MaintMenuItemProps {
  icon: React.ReactNode;
  label: string;
  detail: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}

// The outbound relay audit, one row per relay. The point of the layout is that
// a relay in disagreement with the library is visible at a glance: `ok` is the
// only count that should be non-zero, so ghosts/orphans/missing are tinted and
// everything else stays quiet.
function RelayAuditPanel({
  audit,
  onPurge,
  onRepublish,
  onDismiss,
}: {
  audit: RelayAudit;
  onPurge: () => void;
  onRepublish: () => void;
  onDismiss: () => void;
}) {
  const clean =
    audit.purgeable.length === 0 &&
    audit.missing.length === 0 &&
    audit.rows.every((r) => !r.error);

  return (
    <div className="mt-2 px-3 py-2 rounded-md bg-surface/40 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted">
          library{" "}
          <span className="font-mono text-fg">
            {audit.dbPublished.toLocaleString()}
          </span>{" "}
          published of{" "}
          <span className="font-mono text-fg">
            {audit.dbTotal.toLocaleString()}
          </span>
        </span>
        <button
          onClick={onDismiss}
          className="text-muted hover:text-fg text-[10px] px-1"
          title="Dismiss"
        >
          ✕
        </button>
      </div>

      <div className="mt-1.5 space-y-1">
        {audit.rows.map((r) => (
          <div key={r.relay} className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-mono text-fg/80 truncate">{r.relay}</span>
            {r.error ? (
              <span className="text-alert">unreachable — {r.error}</span>
            ) : (
              <>
                <span className="text-muted">
                  serving <span className="font-mono">{r.live}</span>
                </span>
                <span className="text-nostr">
                  ok <span className="font-mono">{r.ok}</span>
                </span>
                {r.ghosts.length > 0 && (
                  <span
                    className="text-alert"
                    title="Still served, but your library says they should not be public — this relay ignored the deletion"
                  >
                    ghosts <span className="font-mono">{r.ghosts.length}</span>
                  </span>
                )}
                {r.orphans.length > 0 && (
                  <span
                    className="text-alert"
                    title="Still served, but no local release has this id any more"
                  >
                    orphans{" "}
                    <span className="font-mono">{r.orphans.length}</span>
                  </span>
                )}
                {r.missing.length > 0 && (
                  <span
                    className="text-muted"
                    title="Your library says published, but this relay isn't serving it. Harmless on its own — readers union their relay set, so another relay can cover it."
                  >
                    absent{" "}
                    <span className="font-mono">{r.missing.length}</span>
                  </span>
                )}
                {r.stale > 0 && (
                  <span
                    className="text-warn"
                    title="This relay's copy predates your last publish"
                  >
                    stale <span className="font-mono">{r.stale}</span>
                  </span>
                )}
                {r.deletions > 0 && (
                  <span
                    className="text-muted/70"
                    title="kind:5 deletions this relay holds. A relay can store them and still ignore them — nostr-rs-relay only honours deletion by event id."
                  >
                    kind:5 <span className="font-mono">{r.deletions}</span>
                  </span>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {clean ? (
        <p className="mt-2 text-ok">
          Relays agree with the library — nothing to fix.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {audit.purgeable.length > 0 && (
            <button
              onClick={onPurge}
              className="px-2 py-1 rounded-md border border-alert/60 text-alert
                         hover:bg-alert/10"
              title="Sign a kind:5 naming each stray event id and send it to every relay"
            >
              Purge {audit.purgeable.length.toLocaleString()} stray
            </button>
          )}
          {audit.missing.length > 0 && (
            <button
              onClick={onRepublish}
              className="px-2 py-1 rounded-md border border-accent/60 text-accent
                         hover:bg-accent/10"
              title="Releases no relay is serving (invisible to readers), or served only in an out-of-date form. A relay merely lacking its own copy is listed as 'absent' and is not counted here — readers union their relays."
            >
              Re-publish {audit.missing.length.toLocaleString()} unserved
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MaintMenuItem({
  icon,
  label,
  detail,
  active,
  disabled,
  onClick,
}: MaintMenuItemProps) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-start gap-2.5 px-3 py-2 text-left",
        "border-b border-surface/60 last:border-b-0",
        "hover:bg-surface/60 disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          active ? "text-accent animate-pulse" : "text-muted",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-fg">{label}</span>
        <span className="block text-[10px] text-muted leading-snug mt-0.5">
          {detail}
        </span>
      </span>
    </button>
  );
}
