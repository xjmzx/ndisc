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
  musicbrainzId?: string | null;
  releaseType?: string | null;
  category?: string | null;
  lastPublishedAt?: number | null;
  lastPublishedNaddr?: string | null;
  addedAt?: number | null;
  updatedAt?: number | null;
}

export type PublishedFilter = "published" | "unpublished";
export type LabelFilter = "with_label" | "without_label";

export interface Stats {
  total: number;
  physical: number;
  digital: number;
  uniqueArtists: number;
  yearMin: number | null;
  yearMax: number | null;
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
): Promise<Release[]> {
  return invoke<Release[]>("list_releases", {
    query,
    medium,
    needsCover,
    publishedFilter,
    labelFilter,
  });
}

export async function deleteRelease(id: number): Promise<void> {
  return invoke("delete_release", { id });
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

export async function setReleaseCatalogNumber(
  releaseId: number,
  value: string | null,
): Promise<void> {
  return invoke("set_release_catalog_number", { releaseId, value });
}

export async function listDistinctLabels(): Promise<string[]> {
  return invoke<string[]>("list_distinct_labels");
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
