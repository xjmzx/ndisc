import { useEffect, useRef, useState } from "react";
import {
  Disc3,
  FolderSearch,
  ImageOff,
  Music,
  MoreVertical,
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
import { LeafDots } from "./LeafIcon";
import {
  deleteRelease,
  extractEmbeddedCovers,
  listReleases,
  reconcilePublished,
  rescanLocalCovers,
  scanLibraryChanges,
  setCoverArtUrl,
  unpublishRelease,
  updateReleasePath,
  type ExtractSummary,
  type ImportProgress,
  type GenreFilter,
  type LabelFilter,
  type LibraryScanSummary,
  type OrphanEvent,
  type OrphanInfo,
  type PublishedFilter,
  type ReconcileSummary,
  type Release,
  type RescanSummary,
} from "../lib/tauri";
import { coverImageSrc } from "../lib/cover";
import { cn } from "../lib/cn";

export interface FilterContext {
  query: string;
  medium: "physical" | "digital" | null;
  needsCoverOnly: boolean;
  publishedFilter: PublishedFilter | null;
  labelFilter: LabelFilter | null;
  genreFilter: GenreFilter | null;
  count: number;
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
  const [publishedFilter, setPublishedFilter] =
    useState<"" | PublishedFilter>("");
  const [labelFilter, setLabelFilter] = useState<"" | LabelFilter>("");
  const [genreFilter, setGenreFilter] = useState<"" | GenreFilter>("");
  const [items, setItems] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline cover-paste state (only used when needsCoverOnly is true).
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());
  const [savingId, setSavingId] = useState<number | null>(null);
  const [autoFocusPending, setAutoFocusPending] = useState(false);
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Cover-cleanup background ops. Extract reads embedded artwork from audio
  // file tags; rescan walks album directories for a wider set of cover
  // filename patterns.
  type OpKind = "extract" | "rescan" | "scan" | "reconcile";
  const [activeOp, setActiveOp] = useState<OpKind | null>(null);
  const [opProgress, setOpProgress] = useState<ImportProgress | null>(null);
  const [opSummary, setOpSummary] = useState<
    | { kind: "extract"; data: ExtractSummary }
    | { kind: "rescan"; data: RescanSummary }
    | { kind: "scan"; data: LibraryScanSummary }
    | { kind: "reconcile"; data: ReconcileSummary }
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

  async function runBackgroundOp(kind: OpKind) {
    if (activeOp !== null) return;

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
        if (!prev || prev.kind !== "scan") return prev;
        return {
          kind: "scan",
          data: {
            ...prev.data,
            scanned: Math.max(0, prev.data.scanned - 1),
            orphaned: Math.max(0, prev.data.orphaned - 1),
            orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
          },
        };
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
        if (!prev || prev.kind !== "scan") return prev;
        return {
          kind: "scan",
          data: {
            ...prev.data,
            orphaned: Math.max(0, prev.data.orphaned - 1),
            refreshed: prev.data.refreshed + 1,
            orphans: prev.data.orphans.filter((o) => o.id !== orphan.id),
          },
        };
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
        publishedFilter || undefined,
        labelFilter || undefined,
        genreFilter || undefined,
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
  }, [reloadKey, medium, needsCoverOnly, publishedFilter, labelFilter, genreFilter]);

  // Bubble filter state + visible-items count up so other panels (like the
  // Nostr publish-library button) can render contextual UI.
  useEffect(() => {
    if (!onFilterChange) return;
    onFilterChange({
      query,
      medium: medium === "" ? null : medium,
      needsCoverOnly,
      publishedFilter: publishedFilter === "" ? null : publishedFilter,
      labelFilter: labelFilter === "" ? null : labelFilter,
      genreFilter: genreFilter === "" ? null : genreFilter,
      count: items.length,
    });
  }, [
    query,
    medium,
    needsCoverOnly,
    publishedFilter,
    labelFilter,
    genreFilter,
    items.length,
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
        <FilterToggle
          Icon={Radio}
          value={publishedFilter}
          onChange={(v) => setPublishedFilter(v as "" | PublishedFilter)}
          filledValue="published"
          outlinedValue="unpublished"
          tooltipDefault="Filter by Nostr publish state — click cycles published / unpublished / any"
          tooltipFilled="Status: published (click for unpublished)"
          tooltipOutlined="Status: unpublished (click to clear)"
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

      {!activeOp && opSummary && (
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
            {opSummary.kind !== "reconcile" &&
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

      {!activeOp && opSummary?.kind === "scan" && opSummary.data.orphans.length > 0 && (
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
      <ul className="mt-1 h-[calc(100vh-220px)] lg:h-auto lg:flex-1 lg:min-h-0
                     overflow-auto rounded-md divide-y divide-surface/60
                     bg-bg/50 [scrollbar-gutter:stable]">
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
              className={cn(
                "cursor-pointer hover:bg-surface/40 text-xs",
                "flex items-stretch",
                selected?.id === r.id && "bg-surface/70",
              )}
            >
              <div
                className="shrink-0 w-4 pt-3.5 flex justify-center
                           border-r border-surface/40"
                aria-hidden={marker === ""}
              >
                <span
                  className="text-[9px] font-mono font-semibold uppercase
                             leading-none text-fg"
                >
                  {marker}
                </span>
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5 pl-2 pr-3 py-2">
              <div className="flex items-center gap-2">
                <CoverThumb src={thumb} />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate",
                      selected?.id === r.id ? "text-accent" : "text-fg",
                    )}
                  >
                    {r.artist} <span className="text-muted">·</span> {r.title}
                  </div>
                  <div className="text-muted text-[10px] truncate">
                    {[r.year, r.format, r.label, r.catalogNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Leaf meter — present (green) vs expected (faint) tracks
                      for this release. Shown for counted (folder-backed)
                      releases; physical/uncounted rows have no leaves. */}
                  {(r.trackCount != null || r.trackTotal != null) && (
                    <LeafDots
                      n={r.trackCount ?? 0}
                      total={r.trackTotal}
                      maxCols={8}
                    />
                  )}
                  {/* Nostr purple is fixed across both themes — not the
                      theme-variable mauve token. Lit = published. */}
                  <span
                    title={
                      r.lastPublishedAt != null
                        ? "published to Nostr"
                        : "not published to Nostr"
                    }
                    aria-label={
                      r.lastPublishedAt != null
                        ? "published to Nostr"
                        : "not published to Nostr"
                    }
                    className={cn(
                      "shrink-0 w-2.5 h-2.5 rounded-full",
                      r.lastPublishedAt != null
                        ? "bg-[#a78bfa]"
                        : "bg-[#a78bfa]/25",
                    )}
                  />
                  {r.medium && (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded w-14 text-center",
                        r.medium === "digital"
                          ? "bg-digital/20 text-digital"
                          : "bg-ok/20 text-ok",
                      )}
                    >
                      {r.medium}
                    </span>
                  )}
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
