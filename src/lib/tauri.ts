import { invoke } from "@tauri-apps/api/core";

export interface Release {
  id?: number;
  artist: string;
  title: string;
  year?: number | null;
  medium?: "physical" | "digital" | null;
  format?: string | null;
  label?: string | null;
  catalogNumber?: string | null;
  country?: string | null;
  condition?: string | null;
  notes?: string | null;
  source?: string | null;
  filePath?: string | null;
  coverArtPath?: string | null;
  coverArtUrl?: string | null;
  discogsId?: number | null;
  bandcampId?: string | null;
  releaseType?: string | null;
  category?: string | null;
  // v2: three ordered genre slots (primary / secondary / tertiary). Each
  // slot is one of the 22 valid slugs (see schema/release.v2.json) or null.
  // Invariants (distinct, dense ordering) enforced by
  // setReleaseGenres in the backend.
  genrePrimary?: string | null;
  genreSecondary?: string | null;
  genreTertiary?: string | null;
  lastPublishedAt?: number | null;
  lastPublishedNaddr?: string | null;
  addedAt?: number | null;
  updatedAt?: number | null;
  // Leaf count — audio files in the release folder (0–99). Local-only,
  // derived from filePath on import / recount; null when unknown (e.g. a
  // physical release with no folder). Not published to Nostr.
  trackCount?: number | null;
  // Expected total tracks (from the TRACKTOTAL tag, else file count). A
  // release property — IS published as the `tracks` tag. present (trackCount)
  // vs total = how many tracks are missing locally.
  trackTotal?: number | null;
  // Physical disc count, from the Discogs enrichment pass (sum of format
  // quantities). Null for digital / un-enriched rows. DB-local — not published
  // to Nostr yet.
  discTotal?: number | null;
  // Count of video (audio-visual) files in the release folder, extension-
  // detected on recount. >0 means the release carries video and IS published
  // as the additive `video` tag. Null when unscanned, 0 when audio-only.
  videoCount?: number | null;
}

export type PublishedFilter = "published" | "unpublished";
export type LabelFilter = "with_label" | "without_label";
export type GenreFilter = "with_genre" | "without_genre";
export type VideoFilter = "with_video" | "without_video";

export interface Stats {
  total: number;
  physical: number;
  digital: number;
  uniqueArtists: number;
  yearMin: number | null;
  yearMax: number | null;
}

// Multi-dimension library composition for the Stats view. Each breakdown
// is a list of { value, count } rows. Year rows hold the year as text
// ("1968") — parse to int if you need positions on a sparkline. Sorted
// server-side: count DESC + alpha tiebreak for genre/country/medium/label,
// year ASC for year. Future dimensions (e.g. a price rollup mirroring
// Discogs) drop in as new sibling fields without changing BreakdownRow.
export interface BreakdownRow {
  value: string;
  count: number;
}

export interface LibraryBreakdown {
  genre: BreakdownRow[];
  country: BreakdownRow[];
  year: BreakdownRow[];
  // Binary physical/digital split — the high-level shape kept alongside
  // the more granular format breakdown for at-a-glance reading.
  medium: BreakdownRow[];
  // 9 quality/media buckets: "lossless" | "lossy" | "vinyl_12" | "vinyl_10"
  // | "vinyl_7" | "cd" | "cassette" | "box" | "other_physical".
  // Bucketing happens server-side via bucket_format() — see Rust lib.rs.
  format: BreakdownRow[];
  label: BreakdownRow[];
}

export interface ImportSummary {
  scanned: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ScanReport {
  totalDirs: number;
  totalFiles: number;
  totalBytes: number;
}

export interface ScanDiscogsReport {
  totalRows: number;
  physical: number;
  digital: number;
  withCondition: number;
}

export interface ScanBandcampReport {
  totalRows: number;
  withLink: number;
  withReceipt: number;
}

export interface BandcampImportSummary {
  scanned: number;
  enriched: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export interface ImportProgress {
  current: number;
  total: number;
  currentDir: string;
}

export async function initDb(): Promise<string> {
  return invoke<string>("init_db");
}

export async function setDbPath(path: string): Promise<string> {
  return invoke<string>("set_db_path", { path });
}

export async function addRelease(release: Release): Promise<number> {
  return invoke<number>("add_release", { release });
}

export async function restoreRelease(release: Release): Promise<number> {
  return invoke<number>("restore_release", { release });
}

export async function listReleases(
  query?: string,
  medium?: "physical" | "digital",
  needsCover?: boolean,
  publishedFilter?: PublishedFilter,
  labelFilter?: LabelFilter,
  genreFilter?: GenreFilter,
  videoFilter?: VideoFilter,
): Promise<Release[]> {
  return invoke<Release[]>("list_releases", {
    query,
    medium,
    needsCover,
    publishedFilter,
    labelFilter,
    genreFilter,
    videoFilter,
  });
}

export async function deleteRelease(id: number): Promise<void> {
  return invoke("delete_release", { id });
}

/**
 * Backfill / refresh each release's leaf count (trackCount) from the audio
 * files in its folder. Default fills only releases whose count is unknown
 * (cheap to call on every launch); `force` recounts every foldered release.
 * Returns how many rows were updated.
 */
export async function recountTracks(force = false): Promise<number> {
  return invoke("recount_tracks", { force });
}

export async function setCoverArtUrl(
  releaseId: number,
  url: string | null,
): Promise<void> {
  return invoke("set_cover_art_url", { releaseId, url });
}

export async function setReleaseType(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_type", { releaseId, value });
}

export async function setReleaseCategory(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_category", { releaseId, value });
}

export async function setReleaseCountry(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_country", { releaseId, value });
}

export async function setReleaseNotes(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_notes", { releaseId, value });
}

export async function setReleaseCondition(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_condition", { releaseId, value });
}

export async function setReleaseLabel(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_label", { releaseId, value });
}

export async function setReleaseGenres(
  releaseId: number,
  primary: string | null,
  secondary: string | null,
  tertiary: string | null,
): Promise<void> {
  return invoke("set_release_genres", {
    releaseId,
    primary,
    secondary,
    tertiary,
  });
}

export async function setReleaseCatalogNumber(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_catalog_number", { releaseId, value });
}

// Set/clear a release's Discogs id from free text (bare integer or a
// discogs.com/release/… URL). Returns the parsed id (null when cleared);
// rejects unparseable input. Also keeps the `source` URL coherent.
export async function setReleaseDiscogsId(
  releaseId: number,
  value: string,
): Promise<number | null> {
  return invoke<number | null>("set_release_discogs_id", { releaseId, value });
}

// Manually set/clear a release's physical disc count (null or <=0 clears).
// Discogs enrichment stays canonical and may overwrite on a later enrich.
export async function setReleaseDiscTotal(
  releaseId: number,
  value: number | null,
): Promise<void> {
  return invoke("set_release_disc_total", { releaseId, value });
}

export interface LabelCount {
  name: string;
  count: number;
  // Top-3 most-tagged genres for this label, across all slots (slot 0/1/2
  // tags treated as equivalent tallies); ranked by count desc with
  // alphabetical tie-break. Slot N is null when the label has fewer than
  // N distinct genres tagged across its releases.
  dominantGenre: string | null;
  dominantGenre2: string | null;
  dominantGenre3: string | null;
}

export async function listDistinctLabels(): Promise<LabelCount[]> {
  return invoke<LabelCount[]>("list_distinct_labels");
}

export async function exportMarkdown(
  destPath: string,
  filter?: {
    query?: string;
    medium?: "physical" | "digital";
    needsCover?: boolean;
    publishedFilter?: PublishedFilter;
    labelFilter?: LabelFilter;
  },
): Promise<number> {
  return invoke<number>("export_markdown", {
    destPath,
    query: filter?.query,
    medium: filter?.medium,
    needsCover: filter?.needsCover,
    publishedFilter: filter?.publishedFilter,
    labelFilter: filter?.labelFilter,
  });
}

export async function getStats(): Promise<Stats> {
  return invoke<Stats>("get_stats");
}

export async function getLibraryBreakdown(): Promise<LibraryBreakdown> {
  return invoke<LibraryBreakdown>("get_library_breakdown");
}

export async function scanDirectory(root: string): Promise<ScanReport> {
  return invoke<ScanReport>("scan_directory", { root });
}

export async function importDirectory(root: string): Promise<ImportSummary> {
  return invoke<ImportSummary>("import_directory", { root });
}

export async function scanDiscogsCsv(path: string): Promise<ScanDiscogsReport> {
  return invoke<ScanDiscogsReport>("scan_discogs_csv", { path });
}

export async function importDiscogsCsv(
  path: string,
  mediumFilter?: "physical" | "digital",
): Promise<ImportSummary> {
  return invoke<ImportSummary>("import_discogs_csv", { path, mediumFilter });
}

export async function scanBandcampCsv(path: string): Promise<ScanBandcampReport> {
  return invoke<ScanBandcampReport>("scan_bandcamp_csv", { path });
}

export async function importBandcampCsv(
  path: string,
): Promise<BandcampImportSummary> {
  return invoke<BandcampImportSummary>("import_bandcamp_csv", { path });
}

// --- Discogs metadata enrichment --------------------------------------------
// Fills track_total + disc_total for Discogs-sourced releases (which the CSV
// export omits) by fetching the canonical release from the Discogs API.

export interface EnrichResult {
  releaseId: number;
  trackTotal: number | null;
  discTotal: number | null;
  // "ok" | "no_discogs_id"
  status: string;
}

export interface EnrichSummary {
  scanned: number;
  enriched: number;
  skipped: number;
  errors: string[];
}

export interface EnrichProgress {
  current: number;
  total: number;
  label: string;
}

// The Discogs personal access token lives in the OS keychain; the frontend
// only ever sees whether one is set, never the value itself.
export async function setDiscogsToken(token: string): Promise<void> {
  await invoke("set_discogs_token", { token });
}

export async function getDiscogsTokenStatus(): Promise<boolean> {
  return invoke<boolean>("get_discogs_token_status");
}

export async function clearDiscogsToken(): Promise<void> {
  await invoke("clear_discogs_token");
}

export async function enrichDiscogsRelease(
  releaseId: number,
): Promise<EnrichResult> {
  return invoke<EnrichResult>("enrich_discogs_release", { releaseId });
}

// Batch-enrich every Discogs release still missing a count (or all, when
// `force`). Emits enrich:started / enrich:progress / enrich:done events.
export async function enrichDiscogsLibrary(
  force = false,
): Promise<EnrichSummary> {
  return invoke<EnrichSummary>("enrich_discogs_library", { force });
}

// --- Embedded cover-art extraction ------------------------------------------

export interface ExtractSummary {
  scanned: number;
  extracted: number;
  noEmbedded: number;
  noAudio: number;
  errors: string[];
}

export async function extractEmbeddedCovers(): Promise<ExtractSummary> {
  return invoke<ExtractSummary>("extract_embedded_covers");
}

export interface RescanSummary {
  scanned: number;
  matched: number;
  noMatch: number;
  noDir: number;
  errors: string[];
}

export async function rescanLocalCovers(): Promise<RescanSummary> {
  return invoke<RescanSummary>("rescan_local_covers");
}

// --- Interop: refresh from disk + sync cover to disk ------------------------

export interface RefreshResult {
  status: string;
  changes: string[];
}

export async function refreshRelease(releaseId: number): Promise<RefreshResult> {
  return invoke<RefreshResult>("refresh_release", { releaseId });
}

export async function updateReleasePath(
  releaseId: number,
  newPath: string,
): Promise<RefreshResult> {
  return invoke<RefreshResult>("update_release_path", { releaseId, newPath });
}

export async function clearReleasePath(releaseId: number): Promise<void> {
  return invoke<void>("clear_release_path", { releaseId });
}

export async function getRelease(id: number): Promise<Release | null> {
  return invoke<Release | null>("get_release", { id });
}

export interface OrphanInfo {
  id: number;
  artist: string;
  title: string;
  filePath: string;
}

export interface LibraryScanSummary {
  scanned: number;
  refreshed: number;
  noChanges: number;
  orphaned: number;
  noAudio: number;
  noPath: number;
  orphans: OrphanInfo[];
  errors: string[];
}

export async function scanLibraryChanges(): Promise<LibraryScanSummary> {
  return invoke<LibraryScanSummary>("scan_library_changes");
}

// One-click library reconcile: discover new album folders under the root, then
// refresh every existing release against disk. `root` defaults to the derived
// common path prefix of all local releases (see get_library_root).
export interface LibraryReconcileSummary {
  root: string;
  imported: number;
  skipped: number;
  refreshed: number;
  noChanges: number;
  orphaned: number;
  noAudio: number;
  orphans: OrphanInfo[];
  errors: string[];
  scannedAt: number;
}

export async function reconcileLibrary(
  root?: string,
): Promise<LibraryReconcileSummary> {
  return invoke<LibraryReconcileSummary>("reconcile_library", {
    root: root ?? null,
  });
}

export async function getLibraryRoot(): Promise<string | null> {
  return invoke<string | null>("get_library_root");
}

export async function setLibraryRoot(root: string): Promise<void> {
  return invoke<void>("set_library_root", { root });
}

export interface LibrarySummary {
  releases: number;
  tracks: number;
  incomplete: number;
  videos: number;
  orphaned: number;
  lastScannedAt: number | null;
  libraryRoot: string | null;
}

export async function getLibrarySummary(): Promise<LibrarySummary> {
  return invoke<LibrarySummary>("get_library_summary");
}

export interface OrphanEvent {
  id: number;
  artist: string;
  title: string;
}

export interface ReconcileSummary {
  eventsFound: number;
  matched: number;
  updated: number;
  alreadyMarked: number;
  unmatched: number;
  orphans: OrphanEvent[];
}

export async function reconcilePublished(
  relays: string[],
): Promise<ReconcileSummary> {
  return invoke<ReconcileSummary>("reconcile_published", { relays });
}

export interface CoverSyncResult {
  status: string;
  written: string | null;
  bytes: number | null;
}

export async function syncCoverToDisk(
  releaseId: number,
): Promise<CoverSyncResult> {
  return invoke<CoverSyncResult>("sync_cover_to_disk", { releaseId });
}

// --- Nostr identity ----------------------------------------------------------

export interface Keypair {
  npub: string;
  nsec: string;
}

export async function generateKeypair(): Promise<Keypair> {
  return invoke<Keypair>("generate_keypair");
}

export async function importKeypair(nsec: string): Promise<string> {
  return invoke<string>("import_keypair", { nsec });
}

export async function getNpub(): Promise<string | null> {
  return invoke<string | null>("get_npub");
}

export async function clearKeypair(): Promise<void> {
  return invoke("clear_keypair");
}

// --- Nostr publish -----------------------------------------------------------

export interface RelayError {
  relay: string;
  error: string;
}

export interface PublishResult {
  eventId: string;
  naddr: string;
  acceptedBy: string[];
  rejected: RelayError[];
}

export interface PublishProgress {
  current: number;
  total: number;
  title: string;
  artist: string;
  acceptedBy: string[];
  rejected: RelayError[];
}

export interface PublishLibrarySummary {
  total: number;
  published: number;
  failed: number;
}

export async function publishRelease(
  releaseId: number,
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("publish_release", { releaseId, relays });
}

export async function unpublishRelease(
  releaseId: number,
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("unpublish_release", { releaseId, relays });
}

export async function publishReaction(
  releaseId: number,
  content: string,
): Promise<PublishResult> {
  return invoke<PublishResult>("publish_reaction", { releaseId, content });
}

export async function deleteReaction(
  reactionEventId: string,
): Promise<PublishResult> {
  return invoke<PublishResult>("delete_reaction", { reactionEventId });
}

/** Publish the labels.v1 manifest (kind:31238). Only entries with a
 *  non-empty name + imageUrl are included; the Rust side drops empties
 *  too. Republishing replaces (d-tag is fixed at `disco-vault:labels`). */
export async function publishLabels(
  labels: Array<{ name: string; imageUrl: string }>,
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("publish_labels", { labels, relays });
}

export async function publishLibrary(
  relays: string[],
  filter?: {
    query?: string;
    medium?: "physical" | "digital";
    needsCover?: boolean;
    publishedFilter?: PublishedFilter;
    labelFilter?: LabelFilter;
  },
): Promise<PublishLibrarySummary> {
  return invoke<PublishLibrarySummary>("publish_library", {
    relays,
    query: filter?.query,
    medium: filter?.medium,
    needsCover: filter?.needsCover,
    publishedFilter: filter?.publishedFilter,
    labelFilter: filter?.labelFilter,
  });
}

// Feed-note drafts — the `current` view authoring side. The published wire
// form is kind:31239 (schema/feed.v1.json); these are the local, editable
// source rows. last_published_at NULL = draft / needs-republish.
export interface FeedDraft {
  id?: number | null;
  title?: string | null;
  body?: string | null;
  releaseRef?: string | null; // the `a` coordinate, or null (standalone)
  images: string[];
  links: string[];
  topics: string[];
  publishedAt?: number | null;
  lastPublishedAt?: number | null;
  lastPublishedEvent?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export async function listFeedDrafts(): Promise<FeedDraft[]> {
  return invoke<FeedDraft[]>("list_feed_drafts");
}

/** Insert (id null) or update a draft; returns the row id. Editing a
 *  previously published draft clears its publish-state → needs republish. */
export async function saveFeedDraft(draft: FeedDraft): Promise<number> {
  return invoke<number>("save_feed_draft", { draft });
}

export async function deleteFeedDraft(id: number): Promise<void> {
  return invoke("delete_feed_draft", { id });
}

export async function publishFeedNote(
  id: number,
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("publish_feed_note", { id, relays });
}

export async function unpublishFeedNote(
  id: number,
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("unpublish_feed_note", { id, relays });
}

// Contributor curation — registry (kind:30000) + sign-off (kind:4550) / revoke.

/** Replace the contributor registry. Accepts npub or hex; the full list is
 *  published each call (empty list removes all contributors). */
export async function publishRegistry(
  contributors: string[],
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("publish_registry", { contributors, relays });
}

/** Owner sign-off (kind:4550) on a contributor feed note. */
export async function approveFeedNote(
  noteAddress: string,
  noteEventId: string,
  authorPubkey: string,
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("approve_feed_note", {
    noteAddress,
    noteEventId,
    authorPubkey,
    relays,
  });
}

/** Revoke a prior sign-off (kind:5 referencing the kind:4550 event). */
export async function revokeApproval(
  approvalEventId: string,
  relays: string[],
): Promise<PublishResult> {
  return invoke<PublishResult>("revoke_approval", { approvalEventId, relays });
}
