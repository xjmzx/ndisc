// Tauri commands for ndisc. SQLite-backed local discography.
// See https://tauri.app/develop/calling-rust/

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use std::time::Duration;

use keyring::Entry;
use lofty::config::{ParseOptions, ParsingMode};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::ItemKey;
use nostr_sdk::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

const KEYRING_SERVICE: &str = "ndisc";
const KEYRING_USER: &str = "nostr-nsec";
// Discogs personal access token (for the metadata enrichment pass). Stored in
// the same keychain service as the nsec, under its own user so the two never
// collide; it follows the dev/install service split via keyring_service().
const KEYRING_USER_DISCOGS: &str = "discogs-token";
const LEGACY_KEYRING_SERVICE: &str = "disco-vault";
const LEGACY_BUNDLE_ID: &str = "uk.fizx.discovault";
const KIND_RELEASE: u16 = 31237;
const KIND_LABELS: u16 = 31238;
// Feed note — its OWN kind, deliberately NOT 31238 (that is labels.v1). The
// commentary-points-at-a-release channel. See schema/feed.v1.json.
const KIND_FEED: u16 = 31239;
const KIND_REGISTRY: u16 = 30000; // NIP-51 contributor people set
const KIND_APPROVAL: u16 = 4550; // NIP-72 per-note sign-off
const LABELS_D_TAG: &str = "disco-vault:labels";
const LABELS_ALT: &str = "ndisc record-label image library";

const SCHEMA: &str = r#"
-- Release folders deliberately removed (duplicate resolution: the losing copy
-- was trashed). Import consults this so a rescan does NOT re-import the folder
-- as a fresh release — without it, every resolved duplicate comes back on the
-- next scan, because the row is gone but the folder is still on disk.
CREATE TABLE IF NOT EXISTS merged_paths (
    path        TEXT PRIMARY KEY,
    survivor_id INTEGER,
    trashed     INTEGER NOT NULL DEFAULT 0,
    merged_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS releases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    artist          TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    year            INTEGER,
    medium          TEXT,           -- 'physical' | 'digital'
    format          TEXT,           -- LP, 12", CD, cassette, FLAC, MP3, ...
    label           TEXT,
    catalog_number  TEXT,
    country         TEXT,
    condition       TEXT,           -- M, NM, VG+, VG, G, F, P (physical only)
    notes           TEXT,
    source          TEXT,           -- discogs URL, Bandcamp, store, ...
    file_path       TEXT,           -- digital: path to file/folder
    cover_art_path  TEXT,
    discogs_id      INTEGER,
    bandcamp_id     TEXT,           -- Bandcamp order/receipt id (local-only, purchase provenance); repurposed from the dead musicbrainz_id column
    added_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS releases_artist_idx ON releases(artist);
CREATE INDEX IF NOT EXISTS releases_title_idx  ON releases(title);
CREATE INDEX IF NOT EXISTS releases_year_idx   ON releases(year);
CREATE INDEX IF NOT EXISTS releases_medium_idx ON releases(medium);

-- Feed-note drafts (the `current` view authoring side). The published wire
-- form is kind:31239 per schema/feed.v1.json; this table is the local,
-- editable source. The d-tag identifier is derived from `id` (glmps:<id>),
-- so the row id IS the stable replaceable-event identity. images/links/topics
-- are JSON arrays of strings. last_published_at NULL = draft or needs-republish
-- (an edit clears it, mirroring the release publish-state model).
CREATE TABLE IF NOT EXISTS feed_notes (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    title                TEXT,
    body                 TEXT,
    release_ref          TEXT,           -- the `a` coordinate, or NULL (standalone)
    images               TEXT NOT NULL DEFAULT '[]',  -- JSON array of URLs
    links                TEXT NOT NULL DEFAULT '[]',  -- JSON array of URLs
    topics               TEXT NOT NULL DEFAULT '[]',  -- JSON array of lowercased slugs
    published_at         INTEGER,        -- the published_at tag value (seconds)
    last_published_at    INTEGER,        -- publish-state; NULL = draft / stale
    last_published_event TEXT,           -- event id of the last publish
    publish_state        TEXT DEFAULT 'never',  -- never|published|stale|retracted
    created_at           INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at           INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
"#;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    #[serde(default)]
    pub id: Option<i64>,
    pub artist: String,
    pub title: String,
    pub year: Option<i32>,
    pub medium: Option<String>,
    pub format: Option<String>,
    pub label: Option<String>,
    pub catalog_number: Option<String>,
    pub country: Option<String>,
    pub condition: Option<String>,
    pub notes: Option<String>,
    pub source: Option<String>,
    pub file_path: Option<String>,
    pub cover_art_path: Option<String>,
    pub cover_art_url: Option<String>,
    pub discogs_id: Option<i64>,
    pub bandcamp_id: Option<String>,
    pub release_type: Option<String>,
    pub category: Option<String>,
    // Acquisition source — the user-assigned category for where/how this
    // release was obtained (Bandcamp, a record store, …). Local-only, never
    // published. Null when uncategorised. The colour for a given name is a
    // frontend concern (localStorage["ndisc.sources"]).
    pub source_label: Option<String>,
    // Per-release pairing override. None = auto (follow the source / Discogs
    // inference in isPaired); Some(true) = force paired (exists physical AND
    // digital); Some(false) = force solo. Lets a dual-nature source like
    // Bandcamp be physical for one release and digital-only for another,
    // instead of a single source-wide flag. Local-only, never published.
    #[serde(default)]
    pub paired_override: Option<bool>,
    // Genre slots — primary / secondary / tertiary; ordered (slot 0 wins),
    // each optional, each one of the 35 active slugs in schema/release.v2.json.
    // See genreInvariants there: distinct slugs, no parent+own-sub, dense
    // (no holes — a value at slot N requires every slot < N to be filled).
    // Enforced in set_release_genres.
    #[serde(default)]
    pub genre_primary: Option<String>,
    #[serde(default)]
    pub genre_secondary: Option<String>,
    #[serde(default)]
    pub genre_tertiary: Option<String>,
    #[serde(default)]
    pub last_published_at: Option<i64>,
    #[serde(default)]
    pub last_published_naddr: Option<String>,
    // Four-state publish lifecycle: never | published | stale | retracted.
    // NULL is treated as "never" (older rows predate the column).
    #[serde(default)]
    pub publish_state: Option<String>,
    // Event id of the live kind:31237, so a deletion can name it with an `e`
    // tag (see the migration note — some relays honour nothing else).
    #[serde(default)]
    pub last_published_event_id: Option<String>,
    #[serde(default)]
    pub added_at: Option<i64>,
    #[serde(default)]
    pub updated_at: Option<i64>,
    // Number of audio files in the release folder (the "leaves" on this branch).
    // Local-only: derived from file_path on import / recount, NOT published to
    // Nostr (release.v2 is frozen). Null when unknown (e.g. physical releases
    // with no folder). Capped at 99.
    #[serde(default)]
    pub track_count: Option<i64>,
    // Expected total tracks for the release, read from the audio files'
    // TRACKTOTAL tag (falls back to the file count). Unlike track_count
    // (present files on this device) this is a property of the release, so it
    // IS published — `tracks` tag on kind:31237. present vs total = how many
    // tracks are missing locally.
    #[serde(default)]
    pub track_total: Option<i64>,
    // Number of physical discs (LP/CD/etc.) in the release. Populated by the
    // Discogs enrichment pass (sum of the format quantities) for physical
    // releases that carry a discogs_id; null for folder-imported digital and
    // un-enriched rows. NOT published to Nostr yet (release.v2 is frozen — a
    // `discs` tag would be an additive contract wave). Capped at 99.
    #[serde(default)]
    pub disc_total: Option<i64>,
    // Number of video files (audio-visual content) in the release folder,
    // extension-detected on recount (see VIDEO_EXTS). Local-derived per device,
    // but UNLIKE track_count its >0 truth IS published — the additive `video`
    // tag on kind:31237 (release.v2 additive amendment 2026-06) — so a release
    // that carries video is discoverable by A/V-aware consumers. Null when
    // unscanned; 0 when scanned and audio-only. Capped at 99.
    #[serde(default)]
    pub video_count: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub physical: i64,
    pub digital: i64,
    pub unique_artists: i64,
    pub year_min: Option<i32>,
    pub year_max: Option<i32>,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Debug builds (`tauri dev`) use separate `*-dev` config + DB files so
// development never reads or writes the real release database, which sits in
// the same data directory. Release builds (`tauri build`) are unaffected.
fn default_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(debug_assertions) {
        "discography-dev.db"
    } else {
        "discography.db"
    };
    Ok(app_data_dir(app)?.join(name))
}

fn config_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(debug_assertions) {
        "config.dev.json"
    } else {
        "config.json"
    };
    Ok(app_data_dir(app)?.join(name))
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(cfg) = config_file_path(app) {
        if let Ok(s) = std::fs::read_to_string(&cfg) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Some(p) = v.get("dbPath").and_then(|x| x.as_str()) {
                    let p = PathBuf::from(p);
                    if !p.as_os_str().is_empty() {
                        return Ok(p);
                    }
                }
            }
        }
    }
    default_db_path(app)
}

/// Read the persisted config JSON as an object (empty map if absent/invalid).
fn read_config(app: &tauri::AppHandle) -> serde_json::Map<String, serde_json::Value> {
    if let Ok(cfg) = config_file_path(app) {
        if let Ok(s) = std::fs::read_to_string(&cfg) {
            if let Ok(serde_json::Value::Object(m)) = serde_json::from_str(&s) {
                return m;
            }
        }
    }
    serde_json::Map::new()
}

/// Merge `patch` into the persisted config, preserving all other keys. The old
/// `save_db_path` rewrote the file with only `dbPath`, silently dropping any
/// other settings; every writer now goes through here so keys like
/// `libraryRoot` / `lastScannedAt` survive a `dbPath` change and vice versa.
fn write_config_patch(
    app: &tauri::AppHandle,
    patch: &[(&str, serde_json::Value)],
) -> Result<(), String> {
    let cfg = config_file_path(app)?;
    let mut m = read_config(app);
    for (k, v) in patch {
        m.insert((*k).to_string(), v.clone());
    }
    std::fs::write(&cfg, serde_json::Value::Object(m).to_string())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn save_db_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    write_config_patch(
        app,
        &[(
            "dbPath",
            serde_json::Value::String(path.to_string_lossy().into_owned()),
        )],
    )
}

/// Longest common *directory* prefix (component-wise, so we never split
/// mid-segment) across every non-empty `file_path`, or None when there are
/// none. A library entirely under `/data/music` derives `/data/music`.
fn derive_common_root(conn: &Connection) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT file_path FROM releases WHERE file_path IS NOT NULL AND file_path <> ''")
        .map_err(|e| e.to_string())?;
    let paths: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if paths.is_empty() {
        return Ok(None);
    }
    let split = |p: &str| -> Vec<String> {
        Path::new(p)
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect()
    };
    let mut common = split(&paths[0]);
    for p in &paths[1..] {
        let comps = split(p);
        let mut i = 0;
        while i < common.len() && i < comps.len() && common[i] == comps[i] {
            i += 1;
        }
        common.truncate(i);
        if common.is_empty() {
            break;
        }
    }
    if common.is_empty() {
        return Ok(None);
    }
    let mut pb = PathBuf::new();
    for c in &common {
        pb.push(c);
    }
    Ok(Some(pb.to_string_lossy().into_owned()))
}

/// The library root to reconcile against: the persisted `libraryRoot` when set,
/// else the derived common path prefix of all local releases. Errors when
/// neither is available (no configured root and no local paths to derive from).
fn library_root(app: &tauri::AppHandle) -> Result<String, String> {
    let m = read_config(app);
    if let Some(r) = m.get("libraryRoot").and_then(|v| v.as_str()) {
        if !r.trim().is_empty() {
            return Ok(r.to_string());
        }
    }
    let conn = open(app)?;
    derive_common_root(&conn)?
        .ok_or_else(|| "no library root set and no local file paths to derive one from".into())
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let existing: String = row.get(1).map_err(|e| e.to_string())?;
        if existing == column {
            return Ok(());
        }
    }
    drop(rows);
    drop(stmt);
    conn.execute(
        &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl),
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    rename_legacy_musicbrainz_column(&conn)?;
    ensure_column(&conn, "releases", "cover_art_url", "TEXT")?;
    ensure_column(&conn, "releases", "release_type", "TEXT")?;
    ensure_column(&conn, "releases", "category", "TEXT")?;
    // Legacy single-slot `genre` column — pre-v2 schema. Kept as a tombstone
    // because SQLite can't DROP COLUMN cleanly, and so the v1→v2 backfill
    // below can find data to copy. New code MUST NOT read or write it.
    ensure_column(&conn, "releases", "genre", "TEXT")?;
    ensure_column(&conn, "releases", "genre_primary", "TEXT")?;
    ensure_column(&conn, "releases", "genre_secondary", "TEXT")?;
    ensure_column(&conn, "releases", "genre_tertiary", "TEXT")?;
    // Leaf count — audio files per release folder. See Release.track_count.
    ensure_column(&conn, "releases", "track_count", "INTEGER")?;
    // Expected total tracks (from TRACKTOTAL tags). See Release.track_total.
    ensure_column(&conn, "releases", "track_total", "INTEGER")?;
    // Physical disc count, from Discogs enrichment. See Release.disc_total.
    ensure_column(&conn, "releases", "disc_total", "INTEGER")?;
    // Video-file count (audio-visual presence). See Release.video_count.
    ensure_column(&conn, "releases", "video_count", "INTEGER")?;
    ensure_column(&conn, "releases", "last_published_at", "INTEGER")?;
    ensure_column(&conn, "releases", "last_published_naddr", "TEXT")?;
    ensure_column(&conn, "releases", "publish_state", "TEXT")?;
    // Event id of the last kind:31237 we published for this release. Needed so
    // an unpublish can carry an `e` tag alongside the `a` coordinate: relays
    // running nostr-rs-relay (relay.fizx.uk) only honour NIP-09 deletion by
    // event id and silently ignore `a`-tag deletion of addressable events.
    // NULL for rows published before this column existed — "Reconcile relays"
    // recovers those ids from the relays themselves.
    ensure_column(&conn, "releases", "last_published_event_id", "TEXT")?;
    // Acquisition source — a user-curated, extensible category for where/how a
    // release was obtained (Bandcamp, a record store, a marketplace…). Local-
    // only, never published; distinct from `source` (the release URL) and
    // `bandcamp_id` (a purchase receipt). The vocabulary is the distinct set of
    // values in use (see list_distinct_sources), mirroring how `label` works;
    // per-name colours live in localStorage on the frontend. See Release.source_label.
    ensure_column(&conn, "releases", "source_label", "TEXT")?;
    // Per-release pairing override (NULL auto / 0 solo / 1 paired) — see
    // Release.paired_override. Lets Bandcamp-style dual-nature sources be marked
    // physical per release instead of via one source-wide flag.
    ensure_column(&conn, "releases", "paired_override", "INTEGER")?;
    // Seed the category for rows we already recognise as Bandcamp (a purchase
    // receipt or a Bandcamp source URL) so their grouping ring reads blue
    // without any manual tagging. Idempotent — only fills rows still unset, so
    // a later manual re-categorisation is never clobbered.
    conn.execute(
        "UPDATE releases SET source_label = 'Bandcamp'
           WHERE (source_label IS NULL OR source_label = '')
             AND (source LIKE '%bandcamp.com%'
                  OR source LIKE '%shop.cpurecords.net%'
                  OR (bandcamp_id IS NOT NULL AND bandcamp_id <> ''))",
        [],
    )
    .map_err(|e| e.to_string())?;
    // Backfill the four-state column for rows that predate it: anything with a
    // live publish marker is 'published'; the rest stay NULL (read as 'never').
    // Idempotent — only touches rows still NULL. We can't recover 'stale' or
    // 'retracted' history retroactively, so those begin from the next action.
    conn.execute(
        "UPDATE releases SET publish_state = 'published'
          WHERE publish_state IS NULL AND last_published_at IS NOT NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    backfill_type_category(&conn)?;
    backfill_source(&conn)?;
    backfill_genre_v2(&conn)?;
    backfill_genre_slug_renames(&conn)?;
    backfill_genre_restructure_2026_06(&conn)?;
    backfill_genre_renames_2026_06b(&conn)?;
    Ok(conn)
}

/// One-shot rename of the legacy `musicbrainz_id` column to `bandcamp_id`.
/// The MusicBrainz slot was never populated by any code path, so it is
/// repurposed to hold a Bandcamp order/receipt id (purchase provenance). The
/// migration itself is all-platform; only the catalog that fills the column is
/// Windows-side today. Local-only: never emitted to Nostr (the frozen v2 `i`
/// tag has no bandcamp namespace; the
/// Bandcamp link travels via `source`). Idempotent — once renamed, or on a fresh
/// DB already created with `bandcamp_id`, the column check makes it a no-op.
/// SQLite `RENAME COLUMN` preserves existing row data.
fn rename_legacy_musicbrainz_column(conn: &Connection) -> Result<(), String> {
    let has = |name: &str| -> Result<bool, String> {
        conn.prepare("SELECT 1 FROM pragma_table_info('releases') WHERE name = ?1")
            .map_err(|e| e.to_string())?
            .exists([name])
            .map_err(|e| e.to_string())
    };
    if has("musicbrainz_id")? && !has("bandcamp_id")? {
        conn.execute(
            "ALTER TABLE releases RENAME COLUMN musicbrainz_id TO bandcamp_id",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod bandcamp_id_migration {
    use rusqlite::Connection;

    fn has(c: &Connection, name: &str) -> bool {
        c.prepare("SELECT 1 FROM pragma_table_info('releases') WHERE name = ?1")
            .unwrap()
            .exists([name])
            .unwrap()
    }

    /// Existing Linux/macOS user DB: legacy `musicbrainz_id` column with data
    /// is renamed to `bandcamp_id`, row data preserved, and re-running is safe.
    #[test]
    fn renames_legacy_column_and_preserves_data() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE releases (id INTEGER PRIMARY KEY, artist TEXT, musicbrainz_id TEXT);",
        )
        .unwrap();
        c.execute(
            "INSERT INTO releases (artist, musicbrainz_id) VALUES ('Aphex', 'keep-me')",
            [],
        )
        .unwrap();
        super::rename_legacy_musicbrainz_column(&c).unwrap();
        assert!(has(&c, "bandcamp_id") && !has(&c, "musicbrainz_id"));
        let v: String = c
            .query_row("SELECT bandcamp_id FROM releases WHERE artist = 'Aphex'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "keep-me");
        super::rename_legacy_musicbrainz_column(&c).unwrap(); // idempotent
    }

    /// Already-migrated DB (the live 120-row Windows catalog): `bandcamp_id`
    /// present, no `musicbrainz_id` — the migration must be a clean no-op so
    /// the shipped v0.1.4-beta.2 DB stays openable.
    #[test]
    fn noop_on_already_migrated_db() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE releases (id INTEGER PRIMARY KEY, bandcamp_id TEXT);")
            .unwrap();
        c.execute("INSERT INTO releases (bandcamp_id) VALUES ('order-7891')", [])
            .unwrap();
        super::rename_legacy_musicbrainz_column(&c).unwrap();
        let v: String = c
            .query_row("SELECT bandcamp_id FROM releases", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "order-7891");
    }
}

/// 2026-06b genre round: 1:1 renames poetry → spoken, spiritual → conscious
/// (both retired to `deprecated`, remapped here). Published rows carrying the
/// old slug have their publish-state cleared so the new slug re-emits (the
/// on-relay kind:31237 keeps the old slug until republished; v2 readers treat
/// the retired slug as a valid legacy read). Idempotent — once remapped no row
/// matches, so repeat launches are no-ops and won't re-clear publish state.
fn backfill_genre_renames_2026_06b(conn: &Connection) -> Result<(), String> {
    // Clear publish-state on affected published rows BEFORE the rename (after it
    // they no longer match the old slug).
    conn.execute(
        "UPDATE releases
            SET last_published_at = NULL, last_published_naddr = NULL,
                publish_state = CASE WHEN publish_state = 'published'
                                     THEN 'stale' ELSE publish_state END
          WHERE last_published_at IS NOT NULL
            AND ( genre_primary   IN ('poetry','spiritual')
               OR genre_secondary IN ('poetry','spiritual')
               OR genre_tertiary  IN ('poetry','spiritual') )",
        [],
    )
    .map_err(|e| e.to_string())?;

    for col in &["genre_primary", "genre_secondary", "genre_tertiary", "genre"] {
        conn.execute(
            &format!("UPDATE releases SET {c} = 'spoken' WHERE {c} = 'poetry'", c = col),
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            &format!("UPDATE releases SET {c} = 'conscious' WHERE {c} = 'spiritual'", c = col),
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// One-shot renames of genre slugs that were superseded between v2 minor
/// versions. Idempotent — each UPDATE matches only rows still on the old
/// slug, so once migrated, repeated app starts are no-ops. Affected rows
/// will need re-publishing to update the corresponding kind:31237 events
/// on relays (the published wire data carries the old slug verbatim until
/// then; v2 readers should treat unknown slugs as absent per the strict-
/// but-recoverable validation policy).
fn backfill_genre_slug_renames(conn: &Connection) -> Result<(), String> {
    // v2.1.1 (2026-06-10): dub-techno → dub. The compound was redundant
    // under v2.1's pure-peer model — meaning composes by stacking, so
    // `dub` + `techno` can be tagged independently when applicable.
    //
    // NOTE: the v2.1.2 `classical → classical-folk` rename was REMOVED in the
    // 2026-06 restructure. classical-folk is now a retired compound pair and
    // `classical` is an atomic slug in its own right — keeping the rename
    // would feed backfill_genre_restructure_2026_06 and re-split plain
    // `classical` into classical + folk on every launch. See that function.
    for col in &["genre_primary", "genre_secondary", "genre_tertiary", "genre"] {
        conn.execute(
            &format!(
                "UPDATE releases SET {} = 'dub' WHERE {} = 'dub-techno'",
                col, col
            ),
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 2026-06 genre restructure migration. The four compound slash-pairs were
/// retired and split/collapsed into atomic slugs:
///   classical-folk → classical + folk      drone-noise   → noise
///   dnb-jungle     → dnb + jungle           footwork-trap → footwork
/// Any local row still carrying a pair in a genre slot is remapped to the
/// atomic slug(s), preserving slot order, dropping duplicates, and capping at
/// the 3 dense slots (a split that would overflow keeps the leading atomic and
/// drops the overflow). Affected rows are marked unpublished
/// (last_published_at / _naddr cleared) so their now-stale kind:31237 events
/// can be re-emitted in one pass via Publish Library → unpublished — the new
/// events replace the addressable (kind:31237, same d-tag) events on relays.
/// The legacy single-slot `genre` tombstone (never emitted) is renamed 1:1 to
/// the pair's leading atomic. Idempotent: once migrated, no row matches a
/// pair, so repeat runs are no-ops and won't re-clear publish state.
/// Pure slot remap for the 2026-06 restructure: expand each retired compound
/// pair to its atomic slug(s), de-dupe preserving slot order, and return a
/// dense ≤3-slot array. Factored out of the DB migration so it can be unit
/// tested without a database.
fn remap_restructured_genre_slots(slots: [Option<String>; 3]) -> [Option<String>; 3] {
    fn expand(slug: &str) -> &'static [&'static str] {
        match slug {
            "classical-folk" => &["classical", "folk"],
            "dnb-jungle" => &["dnb", "jungle"],
            "drone-noise" => &["noise"],
            "footwork-trap" => &["footwork"],
            _ => &[],
        }
    }
    let mut out: Vec<String> = Vec::new();
    for slot in slots.iter() {
        let v = match slot {
            Some(v) if !v.is_empty() => v.as_str(),
            _ => continue,
        };
        let expanded = expand(v);
        if expanded.is_empty() {
            if !out.iter().any(|x| x == v) {
                out.push(v.to_string());
            }
        } else {
            for atomic in expanded {
                if !out.iter().any(|x| x == *atomic) {
                    out.push((*atomic).to_string());
                }
            }
        }
    }
    out.truncate(3);
    [out.first().cloned(), out.get(1).cloned(), out.get(2).cloned()]
}

fn backfill_genre_restructure_2026_06(conn: &Connection) -> Result<(), String> {
    // Snapshot the affected rows (immutable borrow released before updating).
    let affected: Vec<(i64, Option<String>, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, genre_primary, genre_secondary, genre_tertiary
                 FROM releases
                 WHERE genre_primary   IN ('classical-folk','dnb-jungle','drone-noise','footwork-trap')
                    OR genre_secondary IN ('classical-folk','dnb-jungle','drone-noise','footwork-trap')
                    OR genre_tertiary  IN ('classical-folk','dnb-jungle','drone-noise','footwork-trap')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };

    for (id, p, s, t) in affected {
        let [new_p, new_s, new_t] = remap_restructured_genre_slots([p, s, t]);
        conn.execute(
            "UPDATE releases
             SET genre_primary = ?1,
                 genre_secondary = ?2,
                 genre_tertiary = ?3,
                 last_published_at = NULL,
                 last_published_naddr = NULL,
                 publish_state = CASE WHEN publish_state = 'published'
                                      THEN 'stale' ELSE publish_state END
             WHERE id = ?4",
            params![new_p, new_s, new_t, id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Legacy single-slot `genre` tombstone — not emitted; rename 1:1 to the
    // pair's leading atomic so it stops surfacing a retired slug.
    for (pair, atomic) in [
        ("classical-folk", "classical"),
        ("dnb-jungle", "dnb"),
        ("drone-noise", "noise"),
        ("footwork-trap", "footwork"),
    ] {
        conn.execute(
            "UPDATE releases SET genre = ?1 WHERE genre = ?2",
            params![atomic, pair],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// One-shot backfill of the v1 single-slot `genre` column into v2's
/// `genre_primary`. Idempotent — only copies when `genre_primary` is
/// still NULL, so once migrated, repeated app starts are no-ops.
fn backfill_genre_v2(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE releases
         SET genre_primary = genre
         WHERE genre IS NOT NULL
           AND genre <> ''
           AND genre_primary IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Converts the legacy provenance-keyword `source` values
/// (`'discogs'`, `'import'`) into the new URL-only semantics:
///   - `source='discogs'` rows → synthesize the Discogs release URL from
///     `discogs_id` when present, otherwise clear to NULL.
///   - `source='import'` rows (or anything that isn't an http(s) URL) → NULL.
/// Idempotent: after the first run the WHERE clauses match nothing.
fn backfill_source(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE releases
         SET source = 'https://www.discogs.com/release/' || discogs_id
         WHERE source = 'discogs' AND discogs_id IS NOT NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE releases
         SET source = NULL
         WHERE source IS NOT NULL
           AND source NOT LIKE 'http://%'
           AND source NOT LIKE 'https://%'",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One-shot backfill for rows imported before `release_type` and `category`
/// existed. Idempotent — only touches rows where the destination column is
/// NULL. After the first run leaves nothing NULL, subsequent calls are no-ops.
fn backfill_type_category(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE releases SET release_type = 'music' WHERE release_type IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, format FROM releases
             WHERE category IS NULL AND format IS NOT NULL AND format <> ''",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for (id, format) in rows {
        if let Some(cat) = category_from_discogs_format(&format) {
            conn.execute(
                "UPDATE releases SET category = ?1 WHERE id = ?2",
                rusqlite::params![cat, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn init_db(app: tauri::AppHandle) -> Result<String, String> {
    let path = db_path(&app)?;
    let _ = open(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_db_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if p.as_os_str().is_empty() {
        return Err("empty path".into());
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    // Open (creates file if missing) and apply schema. CREATE TABLE IF NOT
    // EXISTS makes this safe for both new and existing DBs.
    let conn = Connection::open(&p).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    save_db_path(&app, &p)?;
    Ok(p.to_string_lossy().into_owned())
}

// Restore a release using its prior id. Used by the in-app undo toast so a
// recently-deleted row comes back with the same id (so previously-published
// Nostr d-tags still address it).
#[tauri::command]
fn restore_release(app: tauri::AppHandle, release: Release) -> Result<i64, String> {
    let id = release
        .id
        .ok_or_else(|| "release.id is required for restore".to_string())?;
    let conn = open(&app)?;
    conn.execute(
        "INSERT INTO releases
         (id, artist, title, year, medium, format, label, catalog_number, country,
          condition, notes, source, file_path, cover_art_path, cover_art_url,
          discogs_id, bandcamp_id, release_type, category,
          genre_primary, genre_secondary, genre_tertiary,
          last_published_at, last_published_naddr, added_at, updated_at,
          track_count, track_total, source_label, paired_override)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                 ?29, ?30)",
        params![
            id,
            release.artist,
            release.title,
            release.year,
            release.medium,
            release.format,
            release.label,
            release.catalog_number,
            release.country,
            release.condition,
            release.notes,
            release.source,
            release.file_path,
            release.cover_art_path,
            release.cover_art_url,
            release.discogs_id,
            release.bandcamp_id,
            release.release_type,
            release.category,
            release.genre_primary,
            release.genre_secondary,
            release.genre_tertiary,
            release.last_published_at,
            release.last_published_naddr,
            release.added_at,
            release.updated_at,
            release.track_count,
            release.track_total,
            release.source_label,
            release.paired_override,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn add_release(app: tauri::AppHandle, release: Release) -> Result<i64, String> {
    let conn = open(&app)?;
    conn.execute(
        "INSERT INTO releases
         (artist, title, year, medium, format, label, catalog_number, country,
          condition, notes, source, file_path, cover_art_path, cover_art_url,
          discogs_id, bandcamp_id, release_type, category,
          genre_primary, genre_secondary, genre_tertiary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
        params![
            release.artist,
            release.title,
            release.year,
            release.medium,
            release.format,
            release.label,
            release.catalog_number,
            release.country,
            release.condition,
            release.notes,
            release.source,
            release.file_path,
            release.cover_art_path,
            release.cover_art_url,
            release.discogs_id,
            release.bandcamp_id,
            release.release_type,
            release.category,
            release.genre_primary,
            release.genre_secondary,
            release.genre_tertiary,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn set_cover_art_url(
    app: tauri::AppHandle,
    release_id: i64,
    url: Option<String>,
) -> Result<(), String> {
    let normalized = url.and_then(|s| {
        let t = s.trim().to_owned();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET cover_art_url = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    // cover_art_url is the published `image` tag — editing it makes any prior
    // kind:31237 event stale.
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

/// Clear a release's published-state markers so it re-enters the "unpublished"
/// bucket and gets re-emitted by Publish Library → unpublished (the new
/// replaceable event overwrites the old one by d-tag). Called by every setter
/// that mutates data carried in the kind:31237 event, so an edited-but-
/// published release reads as stale. No-op for never-published rows (markers
/// already NULL). Setters touching ONLY local-only data (file_path,
/// cover_art_path, track_count) deliberately do NOT call this.
fn mark_unpublished(conn: &Connection, release_id: i64) -> Result<(), String> {
    // Editing content that's on-relay makes the live event stale. Only a
    // 'published' row transitions to 'stale'; never/retracted are unaffected.
    conn.execute(
        "UPDATE releases
         SET last_published_at = NULL, last_published_naddr = NULL,
             publish_state = CASE WHEN publish_state = 'published'
                                  THEN 'stale' ELSE publish_state END
         WHERE id = ?1",
        params![release_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn normalize_field(v: Option<String>) -> Option<String> {
    v.and_then(|s| {
        let t = s.trim().to_owned();
        if t.is_empty() { None } else { Some(t) }
    })
}

#[tauri::command]
fn set_release_type(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET release_type = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

#[tauri::command]
fn set_release_category(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET category = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

#[tauri::command]
fn set_release_country(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET country = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

// Notes are free-form and may be multi-line (the CSV import joins a sleeve
// condition + collection notes with '\n'); normalize_field only trims the ends,
// so interior newlines survive. Notes ARE published — they are the kind:31237
// event content (see release_event) — so editing them marks the release stale.
#[tauri::command]
fn set_release_notes(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET notes = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

#[tauri::command]
fn set_release_condition(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET condition = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

// Genre slug groups — mirror schema/release.v2.json `genreSlugs` and
// src/lib/genre.ts. Held here as the canonical EMITTABLE-slug list for publish
// validation; release.v2.json is the wire spec. The grouping is semantic /
// palette ONLY — all 35 active slugs are pure peers and may be freely combined
// (see genreInvariants). The four retired compound pairs (classical-folk,
// dnb-jungle, drone-noise, footwork-trap) are deliberately ABSENT: never
// emitted on new events. They stay valid for legacy *reads* in consumers, but
// the emitter must never write them — backfill_genre_slug_renames migrates any
// local rows still carrying them to the atomic slugs.
const GENRE_ACOUSTIC: &[&str] = &[
    "ambient", "blues", "classical", "disco", "experimental", "folk", "funk",
    "hip-hop", "jazz", "latin", "metal", "pop", "reggae", "rnb",
    "rock", "soul", "soundtrack", "spoken",
];
const GENRE_ELECTRONIC: &[&str] = &[
    "acid", "bass", "breaks", "dnb", "downtempo", "electro", "electronic",
    "footwork", "garage", "house", "jungle", "techno",
];
const GENRE_BRIDGE: &[&str] = &["dub", "noise"];
const GENRE_TERTIARY: &[&str] =
    &["boom-bap", "conscious", "lo-fi", "trance", "trap", "turntablism"];

fn is_valid_genre_slug(s: &str) -> bool {
    GENRE_ACOUSTIC.iter().any(|&g| g == s)
        || GENRE_ELECTRONIC.iter().any(|&g| g == s)
        || GENRE_BRIDGE.iter().any(|&g| g == s)
        || GENRE_TERTIARY.iter().any(|&g| g == s)
}

/// Enforces the v2 invariants from schema/release.v2.json `genreInvariants`:
/// each non-null slot is one of the 35 active slugs; all non-null slots are
/// distinct; dense ordering (no holes — slot N+1 set requires slot N set).
/// No parent+sub gate — `electronic` + `techno` is valid.
fn validate_genre_slots(slots: &[Option<String>; 3]) -> Result<(), String> {
    // Each non-null slot must be a known slug.
    for (i, s) in slots.iter().enumerate() {
        if let Some(v) = s {
            if !is_valid_genre_slug(v) {
                return Err(format!("slot {}: unknown genre slug '{}'", i, v));
            }
        }
    }

    // Density.
    let mut seen_empty = false;
    for (i, s) in slots.iter().enumerate() {
        match s {
            None => seen_empty = true,
            Some(_) if seen_empty => {
                return Err(format!(
                    "slot {}: slots must be dense (cannot skip an earlier slot)",
                    i
                ));
            }
            Some(_) => {}
        }
    }

    // Distinct.
    let mut present: Vec<&str> = Vec::new();
    for s in slots.iter().flatten() {
        if present.contains(&s.as_str()) {
            return Err(format!("duplicate genre slug '{}'", s));
        }
        present.push(s.as_str());
    }

    Ok(())
}

#[tauri::command]
fn set_release_genres(
    app: tauri::AppHandle,
    release_id: i64,
    primary: Option<String>,
    secondary: Option<String>,
    tertiary: Option<String>,
) -> Result<(), String> {
    let slots: [Option<String>; 3] = [
        normalize_field(primary),
        normalize_field(secondary),
        normalize_field(tertiary),
    ];
    validate_genre_slots(&slots)?;
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET genre_primary = ?1,
             genre_secondary = ?2,
             genre_tertiary = ?3,
             updated_at = strftime('%s','now')
         WHERE id = ?4",
        params![slots[0], slots[1], slots[2], release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

#[tauri::command]
fn set_release_label(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET label = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

#[tauri::command]
fn set_release_catalog_number(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET catalog_number = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

// Set (or clear, on empty/None) a release's acquisition-source category. This
// is local-only provenance and is NOT carried in the kind:31237 event, so it
// deliberately does NOT call mark_unpublished — re-tagging where you bought a
// record must not make its published release stale.
#[tauri::command]
fn set_release_source(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_field(value);
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET source_label = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// Set (or clear, on None) a release's pairing override. Local-only, exactly like
// set_release_source — a pairing tweak is provenance, not wire data, and must
// not make a published release stale. None → auto (inference); Some(true) →
// forced paired; Some(false) → forced solo.
#[tauri::command]
fn set_release_paired(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<bool>,
) -> Result<(), String> {
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET paired_override = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![value, release_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// Manually set (or clear, on None/<=0) a release's physical disc count. Discogs
// enrichment also fills disc_total (and stays canonical — a later enrich on a
// Discogs-linked release will overwrite this), but this lets non-Discogs
// releases get a disc count, and acts as an override otherwise. Capped at 99
// to mirror track_total's sanity clamp. Publishes via the additive `discs` tag.
#[tauri::command]
fn set_release_disc_total(
    app: tauri::AppHandle,
    release_id: i64,
    value: Option<i64>,
) -> Result<(), String> {
    let normalized = match value {
        Some(n) if n > 0 => Some(n.min(99)),
        _ => None,
    };
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET disc_total = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![normalized, release_id],
    )
    .map_err(|e| e.to_string())?;
    mark_unpublished(&conn, release_id)?;
    Ok(())
}

// Parse a Discogs release id from free text — a bare integer, or a
// discogs.com release URL (…/release/123456[-slug]). Empty input clears the id.
fn parse_discogs_input(raw: &str) -> Result<Option<i64>, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Ok(None);
    }
    // From a URL, take the run of digits right after "/release/"; otherwise
    // treat the whole string as the id.
    let candidate = if let Some(rest) = t.split("/release/").nth(1) {
        rest.trim_start_matches(['/'])
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
    } else {
        t.to_string()
    };
    match candidate.parse::<i64>() {
        Ok(id) if id > 0 => Ok(Some(id)),
        _ => Err(format!("not a valid Discogs release id or URL: {t}")),
    }
}

// Set (or clear, on empty) a release's discogs_id from free text. Keeps the
// `source` URL coherent: a valid id canonicalises source to the Discogs release
// URL unless source already points elsewhere (e.g. a Bandcamp link the user
// set); clearing the id also clears a source that was a Discogs URL.
#[tauri::command]
fn set_release_discogs_id(
    app: tauri::AppHandle,
    release_id: i64,
    value: String,
) -> Result<Option<i64>, String> {
    let parsed = parse_discogs_input(&value)?;
    let conn = open(&app)?;
    let current_source: Option<String> = conn
        .query_row(
            "SELECT source FROM releases WHERE id = ?1",
            params![release_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let source_is_discogs = current_source
        .as_deref()
        .map(|s| s.contains("discogs.com/release/"))
        .unwrap_or(false);
    let source_is_empty = current_source
        .as_deref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true);

    let new_source: Option<String> = match parsed {
        // Canonicalise source only when it's empty or already a Discogs URL —
        // never clobber a user-set non-Discogs source.
        Some(id) if source_is_empty || source_is_discogs => {
            Some(format!("https://www.discogs.com/release/{id}"))
        }
        Some(_) => current_source,
        // Cleared: drop a now-orphaned Discogs source, keep anything else.
        None if source_is_discogs => None,
        None => current_source,
    };

    conn.execute(
        "UPDATE releases
         SET discogs_id = ?1, source = ?2, updated_at = strftime('%s','now')
         WHERE id = ?3",
        params![parsed, new_source, release_id],
    )
    .map_err(|e| e.to_string())?;
    // discogs_id (`i` tag) and source are both published — mark stale.
    mark_unpublished(&conn, release_id)?;
    Ok(parsed)
}

#[tauri::command]
fn export_markdown(
    app: tauri::AppHandle,
    dest_path: String,
    query: Option<String>,
    medium: Option<String>,
    needs_cover: Option<bool>,
    publish_state_filter: Option<String>,
    label_filter: Option<String>,
) -> Result<usize, String> {
    let releases = list_releases(
        app,
        query,
        medium,
        needs_cover,
        publish_state_filter,
        label_filter,
        None, // genre_filter — export is not genre-scoped
        None, // video_filter — export is not video-scoped
        None, // cover_link_filter — export is not cover-link-scoped
        None, // source_filter — export is not source-scoped
    )?;
    let md = build_markdown(&releases);
    std::fs::write(&dest_path, md).map_err(|e| e.to_string())?;
    Ok(releases.len())
}

fn build_markdown(releases: &[Release]) -> String {
    let mut s = String::new();
    s.push_str("| Cover | Artist | Title | Catalog | Label | Year | Country |\n");
    s.push_str("|-------|--------|-------|---------|-------|------|---------|\n");
    for r in releases {
        let cover = r
            .cover_art_url
            .as_deref()
            .filter(|u| !u.is_empty())
            .map(|u| format!("<img src=\"{}\" width=\"80\">", html_attr_escape(u)))
            .unwrap_or_default();
        let year = r.year.map(|y| y.to_string()).unwrap_or_default();
        s.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            cover,
            md_cell(&r.artist),
            md_cell(&r.title),
            md_cell(r.catalog_number.as_deref().unwrap_or("")),
            md_cell(r.label.as_deref().unwrap_or("")),
            year,
            md_cell(r.country.as_deref().unwrap_or("")),
        ));
    }
    s
}

fn md_cell(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('|', "\\|")
        .replace('\n', " ")
        .replace('\r', "")
}

fn html_attr_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelCount {
    pub name: String,
    pub count: i64,
    // Top-3 most-tagged genres for this label, ranked across all slots
    // (primary/secondary/tertiary treated as equivalent tallies). Ties
    // broken alphabetically. Slot N is None when the label has fewer than
    // N distinct genres tagged across its releases.
    pub dominant_genre: Option<String>,
    pub dominant_genre_2: Option<String>,
    pub dominant_genre_3: Option<String>,
}

/// One acquisition-source category and how many releases carry it. The distinct
/// set of these IS the source vocabulary (there is no separate registry table),
/// mirroring list_distinct_labels. Ordered by count desc, then name.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCount {
    pub name: String,
    pub count: i64,
}

/// Read-only summary of one record label, for the LABEL panel's at-a-glance
/// strip. Purely derived from rows we already have — it adds no publishing
/// surface and cannot mutate the labels.v1 image manifest.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelOverview {
    pub name: String,
    pub releases: i64,
    /// Year span across the label's releases. None when no release has a year.
    pub first_year: Option<i64>,
    pub last_year: Option<i64>,
    /// How many of those releases are live on relays (publish_state).
    pub published: i64,
    /// Audio files across the label's releases (the "leaves").
    pub tracks: i64,
}

#[tauri::command]
fn get_label_overview(
    app: tauri::AppHandle,
    name: String,
) -> Result<LabelOverview, String> {
    let conn = open(&app)?;
    let (releases, first_year, last_year, published, tracks) = conn
        .query_row(
            "SELECT COUNT(*),
                    MIN(year),
                    MAX(year),
                    SUM(CASE WHEN publish_state = 'published' THEN 1 ELSE 0 END),
                    COALESCE(SUM(COALESCE(track_count, 0)), 0)
               FROM releases
              WHERE label = ?1",
            params![name],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(LabelOverview {
        name,
        releases,
        first_year,
        last_year,
        published,
        tracks,
    })
}

// All distinct labels, ordered by release count desc (then alphabetical),
// capped at 500 rows as a defensive ceiling. The UI applies its own display
// cap and search filter on top of this — including single-release labels so
// the user can assign an image to anything they own. Each row is paired with
// its release count so the panel can render a per-label chip.
#[tauri::command]
fn list_distinct_labels(app: tauri::AppHandle) -> Result<Vec<LabelCount>, String> {
    let conn = open(&app)?;
    // Aggregate label rows + top-3 most-tagged genres per label, across
    // ALL slots (primary/secondary/tertiary treated as equivalent tallies).
    // Each release contributes 1-3 slot-tags to its label's pool; we tally,
    // rank by count desc with alphabetical tie-break, then pivot the top
    // three ranks into three named columns for the IPC payload. Labels with
    // no genre data anywhere keep all three dominant_* slots NULL.
    let mut stmt = conn
        .prepare(
            "WITH slot_tags AS (
               SELECT label, genre_primary AS g FROM releases
                 WHERE label IS NOT NULL AND label <> ''
                   AND genre_primary IS NOT NULL AND genre_primary <> ''
               UNION ALL
               SELECT label, genre_secondary FROM releases
                 WHERE label IS NOT NULL AND label <> ''
                   AND genre_secondary IS NOT NULL AND genre_secondary <> ''
               UNION ALL
               SELECT label, genre_tertiary FROM releases
                 WHERE label IS NOT NULL AND label <> ''
                   AND genre_tertiary IS NOT NULL AND genre_tertiary <> ''
             ),
             tally AS (
               SELECT label, g, COUNT(*) AS gn FROM slot_tags GROUP BY label, g
             ),
             ranked AS (
               SELECT label, g,
                 ROW_NUMBER() OVER (
                   PARTITION BY label
                   ORDER BY gn DESC, g COLLATE NOCASE
                 ) AS rk
               FROM tally
             ),
             top3 AS (
               SELECT
                 label,
                 MAX(CASE WHEN rk = 1 THEN g END) AS g1,
                 MAX(CASE WHEN rk = 2 THEN g END) AS g2,
                 MAX(CASE WHEN rk = 3 THEN g END) AS g3
               FROM ranked WHERE rk <= 3 GROUP BY label
             )
             SELECT r.label, COUNT(*) AS n,
                    t.g1 AS dominant_genre,
                    t.g2 AS dominant_genre_2,
                    t.g3 AS dominant_genre_3
             FROM releases r
             LEFT JOIN top3 t ON t.label = r.label
             WHERE r.label IS NOT NULL AND r.label <> ''
             GROUP BY r.label, t.g1, t.g2, t.g3
             ORDER BY n DESC, r.label COLLATE NOCASE
             LIMIT 500",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LabelCount {
                name: row.get::<_, String>(0)?,
                count: row.get::<_, i64>(1)?,
                dominant_genre: row.get::<_, Option<String>>(2)?,
                dominant_genre_2: row.get::<_, Option<String>>(3)?,
                dominant_genre_3: row.get::<_, Option<String>>(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// The acquisition-source vocabulary in use: every distinct `source_label`
/// value and how many releases carry it. Derived from rows (no registry table),
/// mirroring list_distinct_labels — this is what the source filter and the
/// per-source colour UI enumerate.
#[tauri::command]
fn list_distinct_sources(app: tauri::AppHandle) -> Result<Vec<SourceCount>, String> {
    let conn = open(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT source_label, COUNT(*) AS n
             FROM releases
             WHERE source_label IS NOT NULL AND source_label <> ''
             GROUP BY source_label
             ORDER BY n DESC, source_label COLLATE NOCASE
             LIMIT 500",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SourceCount {
                name: row.get::<_, String>(0)?,
                count: row.get::<_, i64>(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn row_to_release(row: &rusqlite::Row) -> rusqlite::Result<Release> {
    Ok(Release {
        id: row.get(0)?,
        artist: row.get(1)?,
        title: row.get(2)?,
        year: row.get(3)?,
        medium: row.get(4)?,
        format: row.get(5)?,
        label: row.get(6)?,
        catalog_number: row.get(7)?,
        country: row.get(8)?,
        condition: row.get(9)?,
        notes: row.get(10)?,
        source: row.get(11)?,
        file_path: row.get(12)?,
        cover_art_path: row.get(13)?,
        discogs_id: row.get(14)?,
        bandcamp_id: row.get(15)?,
        added_at: row.get(16)?,
        updated_at: row.get(17)?,
        cover_art_url: row.get(18)?,
        release_type: row.get(19)?,
        category: row.get(20)?,
        genre_primary: row.get(21)?,
        genre_secondary: row.get(22)?,
        genre_tertiary: row.get(23)?,
        last_published_at: row.get(24)?,
        last_published_naddr: row.get(25)?,
        track_count: row.get(26)?,
        track_total: row.get(27)?,
        disc_total: row.get(28)?,
        video_count: row.get(29)?,
        publish_state: row.get(30)?,
        last_published_event_id: row.get(31)?,
        source_label: row.get(32)?,
        paired_override: row.get(33)?,
    })
}

const RELEASE_SELECT_COLS: &str =
    "id, artist, title, year, medium, format, label, catalog_number,
     country, condition, notes, source, file_path, cover_art_path,
     discogs_id, bandcamp_id, added_at, updated_at, cover_art_url,
     release_type, category, genre_primary, genre_secondary, genre_tertiary,
     last_published_at, last_published_naddr, track_count, track_total,
     disc_total, video_count, publish_state, last_published_event_id,
     source_label, paired_override";

#[tauri::command]
fn list_releases(
    app: tauri::AppHandle,
    query: Option<String>,
    medium: Option<String>,
    needs_cover: Option<bool>,
    publish_state_filter: Option<String>,
    label_filter: Option<String>,
    genre_filter: Option<String>,
    video_filter: Option<String>,
    cover_link_filter: Option<String>,
    source_filter: Option<String>,
) -> Result<Vec<Release>, String> {
    let conn = open(&app)?;
    let q = query.unwrap_or_default();
    let q_like = format!("%{}%", q);

    // SQLite treats NULL and empty string differently; cover may legitimately
    // be either, so check both for emptiness.
    let no_cover_clause = "(cover_art_url IS NULL OR cover_art_url = '')
                       AND (cover_art_path IS NULL OR cover_art_path = '')";
    let cover_filter = match needs_cover {
        Some(true) => format!("AND {}", no_cover_clause),
        Some(false) => format!("AND NOT ({})", no_cover_clause),
        None => String::new(),
    };

    // Four-state publish lifecycle. NULL is read as 'never' (pre-column rows).
    let state_clause = match publish_state_filter.as_deref() {
        Some("never") => "AND (publish_state IS NULL OR publish_state = 'never')",
        Some("published") => "AND publish_state = 'published'",
        Some("stale") => "AND publish_state = 'stale'",
        Some("retracted") => "AND publish_state = 'retracted'",
        _ => "",
    };

    let label_clause = match label_filter.as_deref() {
        Some("with_label") => "AND label IS NOT NULL AND label <> ''",
        Some("without_label") => "AND (label IS NULL OR label = '')",
        _ => "",
    };

    // "Has any genre slot set" check — slot 0 being filled is sufficient
    // because density is enforced (no holes), so genre_primary IS NOT NULL
    // implies at least one slot tagged.
    let genre_clause = match genre_filter.as_deref() {
        Some("with_genre") => "AND genre_primary IS NOT NULL AND genre_primary <> ''",
        Some("without_genre") => "AND (genre_primary IS NULL OR genre_primary = '')",
        _ => "",
    };

    // Audio-visual presence — video_count > 0 means the release carries video.
    let video_clause = match video_filter.as_deref() {
        Some("with_video") => "AND video_count > 0",
        Some("without_video") => "AND (video_count IS NULL OR video_count = 0)",
        _ => "",
    };

    // Published web image link presence — cover_art_url only (a local
    // cover.jpg lives in cover_art_path and does NOT count as a web link).
    let cover_link_clause = match cover_link_filter.as_deref() {
        Some("with_link") => "AND cover_art_url IS NOT NULL AND cover_art_url <> ''",
        Some("without_link") => "AND (cover_art_url IS NULL OR cover_art_url = '')",
        _ => "",
    };

    // Acquisition source. A release is "Bandcamp" if its source is on
    // bandcamp.com, on a known custom storefront, or it carries a purchase
    // receipt (bandcamp_id) — the same predicate the frontend dot uses
    // (src/lib/source.ts). "generic" is the complement: the generic
    // digital-purchase bucket with no recognised source.
    let bc_pred = "(source LIKE '%bandcamp.com%' \
                    OR source LIKE '%shop.cpurecords.net%' \
                    OR (bandcamp_id IS NOT NULL AND bandcamp_id <> ''))";
    let source_clause = match source_filter.as_deref() {
        Some("bandcamp") => format!("AND {bc_pred}"),
        Some("generic") => format!("AND NOT {bc_pred}"),
        _ => String::new(),
    };

    let select_sql = format!(
        "SELECT {cols}
         FROM releases
         WHERE (?1 = '' OR artist LIKE ?2 OR title LIKE ?2
                          OR label  LIKE ?2 OR catalog_number LIKE ?2)
           AND (?3 IS NULL OR medium = ?3)
           {cover}
           {state}
           {label}
           {genre}
           {video}
           {cover_link}
           {source}
         ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
        cols = RELEASE_SELECT_COLS,
        cover = cover_filter,
        state = state_clause,
        label = label_clause,
        genre = genre_clause,
        video = video_clause,
        cover_link = cover_link_clause,
        source = source_clause,
    );
    let mut stmt = conn
        .prepare(&select_sql)
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![q, q_like, medium], row_to_release)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn delete_release(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let conn = open(&app)?;
    conn.execute("DELETE FROM releases WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetch a single release by id — used by the detail view to re-read fresh
/// state (e.g. the recomputed track_count) after a backend mutation whose
/// result doesn't itself carry the full row.
#[tauri::command]
fn get_release(app: tauri::AppHandle, id: i64) -> Result<Option<Release>, String> {
    let conn = open(&app)?;
    let sql = format!("SELECT {} FROM releases WHERE id = ?1", RELEASE_SELECT_COLS);
    conn.query_row(&sql, params![id], row_to_release)
        .optional()
        .map_err(|e| e.to_string())
}

/// Count audio files directly inside `dir` (non-recursive — matches the import
/// grain, where each leaf folder is one release). Capped at 99 ("0–99 leaves").
/// None when the folder can't be read (e.g. an unmounted drive) so the caller
/// leaves track_count untouched and retries later.
/// Count audio + video files in a folder in a single directory read.
/// Returns (audio_count, video_count), each capped at 99. None if the dir
/// can't be read.
fn count_media_in_dir(dir: &str) -> Option<(i64, i64)> {
    let entries = std::fs::read_dir(dir).ok()?;
    let (mut audio, mut video): (i64, i64) = (0, 0);
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        if is_audio(&p) {
            if audio < 99 {
                audio += 1;
            }
        } else if is_video(&p) && video < 99 {
            video += 1;
        }
    }
    Some((audio, video))
}

/// The `video` tag is emitted only when the count is > 0; this is the form a
/// change is compared against to decide publish-staleness (NULL/0 both mean
/// "no tag"). Returns the emitted value, or None when nothing would be emitted.
fn video_emit(count: Option<i64>) -> Option<i64> {
    count.filter(|&n| n > 0)
}

/// Backfill / refresh each release's leaf count (track_count) AND video count
/// (video_count) from its folder, in one walk. Default fills only releases
/// missing EITHER count (NULL) — cheap to call on every launch; `force`
/// recounts every release that has a folder. Returns how many rows were
/// updated.
///
/// track_count is local-only and never affects publishing. video_count's >0
/// truth IS published (the additive `video` tag), so when a recount changes a
/// *published* release's emitted video value (e.g. the first scan finds video
/// on an already-published release), its publish markers are cleared via
/// mark_unpublished — it now reads as "needs republish" so the new tag can be
/// emitted. Audio-only releases (video stays 0) are never affected.
#[tauri::command]
fn recount_tracks(app: tauri::AppHandle, force: Option<bool>) -> Result<usize, String> {
    let conn = open(&app)?;
    let where_clause = if force.unwrap_or(false) {
        "file_path IS NOT NULL AND file_path <> ''"
    } else {
        "(track_count IS NULL OR video_count IS NULL) \
         AND file_path IS NOT NULL AND file_path <> ''"
    };
    let targets: Vec<(i64, String, Option<i64>, Option<String>)> = {
        let sql = format!(
            "SELECT id, file_path, video_count, last_published_naddr \
             FROM releases WHERE {}",
            where_clause
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut v = Vec::new();
        for m in mapped {
            v.push(m.map_err(|e| e.to_string())?);
        }
        v
    };
    let mut updated = 0usize;
    for (id, path, old_video, published_naddr) in targets {
        if let Some((audio, video)) = count_media_in_dir(&path) {
            conn.execute(
                "UPDATE releases SET track_count = ?1, video_count = ?2 WHERE id = ?3",
                params![audio, video, id],
            )
            .map_err(|e| e.to_string())?;
            // Only a *published* release whose emitted video value actually
            // changes needs to drop to "needs republish".
            if published_naddr.is_some()
                && video_emit(old_video) != video_emit(Some(video))
            {
                mark_unpublished(&conn, id)?;
            }
            updated += 1;
        }
    }
    Ok(updated)
}

#[tauri::command]
fn get_stats(app: tauri::AppHandle) -> Result<Stats, String> {
    let conn = open(&app)?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM releases", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let physical: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM releases WHERE medium = 'physical'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let digital: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM releases WHERE medium = 'digital'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let unique_artists: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT artist COLLATE NOCASE) FROM releases",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let year_min: Option<i32> = conn
        .query_row(
            "SELECT MIN(year) FROM releases WHERE year IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let year_max: Option<i32> = conn
        .query_row(
            "SELECT MAX(year) FROM releases WHERE year IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(Stats {
        total,
        physical,
        digital,
        unique_artists,
        year_min,
        year_max,
    })
}

// ---------------------------------------------------------------------------
// Library breakdown — multi-dimension composition for the Stats view
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRow {
    /// The bucket label. Always serialised as a string so the IPC payload
    /// stays uniform across breakdowns; year rows hold the year as text
    /// ("1968"). Frontend parses if it needs the integer.
    pub value: String,
    pub count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBreakdown {
    /// Genre share across all 3 slots — a release tagged with N distinct
    /// genres contributes N tallies (matches the v2.1 pure-peer model where
    /// secondary/tertiary slugs carry the same weight as primary).
    pub genre: Vec<BreakdownRow>,
    /// Country composition; rows with NULL/empty country are dropped.
    pub country: Vec<BreakdownRow>,
    /// Year composition; rows with NULL year are dropped. Sorted ASC so the
    /// frontend sparkline can iterate left-to-right.
    pub year: Vec<BreakdownRow>,
    /// Medium composition — the binary `physical`/`digital` split kept as
    /// the high-level shape, since users still want the simple divide at a
    /// glance even when `format` provides finer granularity. NULL/empty
    /// dropped.
    pub medium: Vec<BreakdownRow>,
    /// Format-quality composition. The varied per-release `format` strings
    /// (e.g. `"FLAC 16/44.1"`, `"MP3 320"`, `"12\", EP, Ltd"`) are bucketed
    /// into 9 tiers by `bucket_format()`: `lossless`, `lossy`, `vinyl_12`,
    /// `vinyl_10`, `vinyl_7`, `cd`, `cassette`, `box`, `other_physical`.
    /// Rows with NULL/empty format are dropped. Sorted by count DESC.
    pub format: Vec<BreakdownRow>,
    /// Label composition; NULL/empty dropped. Full list — the frontend
    /// decides on a top-N cap and "Other (N)" collapse for the chart.
    pub label: Vec<BreakdownRow>,
}

/// Returns the full library composition across five dimensions in a single
/// call. Each row is `(value, count)`. Sorted by count DESC (tie-broken
/// alphabetically) for genre/country/medium/label, and by year ASC for year.
///
/// This is the data source for the Stats view (`<StatsView />`). Future
/// dimensions (e.g. a price/value rollup mirroring Discogs) slot in as new
/// fields on `LibraryBreakdown` without changing the row shape.
#[tauri::command]
fn get_library_breakdown(app: tauri::AppHandle) -> Result<LibraryBreakdown, String> {
    let conn = open(&app)?;
    library_breakdown_from_conn(&conn)
}

/// Connection-level implementation of `get_library_breakdown`, factored out
/// so the SQL can be exercised against an in-memory DB in tests without
/// requiring a Tauri AppHandle.
fn library_breakdown_from_conn(conn: &Connection) -> Result<LibraryBreakdown, String> {
    let collect = |sql: &str| -> Result<Vec<BreakdownRow>, String> {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(BreakdownRow {
                    value: r.get::<_, String>(0)?,
                    count: r.get::<_, i64>(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    };

    // Genre: UNION ALL across the three slot columns, then tally. Pure-peer
    // model — a release tagged classical + downtempo + experimental
    // contributes one tally to each.
    let genre = collect(
        "WITH slot_tags AS (
           SELECT genre_primary   AS g FROM releases WHERE genre_primary   IS NOT NULL AND genre_primary   <> ''
           UNION ALL
           SELECT genre_secondary AS g FROM releases WHERE genre_secondary IS NOT NULL AND genre_secondary <> ''
           UNION ALL
           SELECT genre_tertiary  AS g FROM releases WHERE genre_tertiary  IS NOT NULL AND genre_tertiary  <> ''
         )
         SELECT g, COUNT(*) AS n
         FROM slot_tags
         GROUP BY g
         ORDER BY n DESC, g ASC",
    )?;

    let country = collect(
        "SELECT country, COUNT(*) AS n
         FROM releases
         WHERE country IS NOT NULL AND country <> ''
         GROUP BY country
         ORDER BY n DESC, country ASC",
    )?;

    // Year stored as INTEGER; cast to TEXT for the uniform row shape.
    let year = collect(
        "SELECT CAST(year AS TEXT), COUNT(*) AS n
         FROM releases
         WHERE year IS NOT NULL
         GROUP BY year
         ORDER BY year ASC",
    )?;

    let medium = collect(
        "SELECT medium, COUNT(*) AS n
         FROM releases
         WHERE medium IS NOT NULL AND medium <> ''
         GROUP BY medium
         ORDER BY n DESC, medium ASC",
    )?;

    // Format tiers: bucket the per-release `format` string into a small
    // set of quality categories. Done in Rust rather than CASE-WHEN SQL
    // because the bucketing rules are easier to read and test as a
    // dedicated function (see `bucket_format`).
    let mut format_counts: std::collections::HashMap<&'static str, i64> =
        std::collections::HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT format, COUNT(*) AS n
             FROM releases
             WHERE format IS NOT NULL AND format <> ''
             GROUP BY format",
        )
        .map_err(|e| e.to_string())?;
    let raw = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in raw {
        let (fmt, n) = row.map_err(|e| e.to_string())?;
        *format_counts.entry(bucket_format(&fmt)).or_insert(0) += n;
    }
    let mut format: Vec<BreakdownRow> = format_counts
        .into_iter()
        .map(|(k, n)| BreakdownRow {
            value: k.to_string(),
            count: n,
        })
        .collect();
    // Sort: count DESC, then alpha asc for stable tie-break.
    format.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));

    let label = collect(
        "SELECT label, COUNT(*) AS n
         FROM releases
         WHERE label IS NOT NULL AND label <> ''
         GROUP BY label
         ORDER BY n DESC, label ASC",
    )?;

    Ok(LibraryBreakdown {
        genre,
        country,
        year,
        medium,
        format,
        label,
    })
}

/// Bucket a raw `format` string into one of nine media tiers. Digital
/// tiers split lossless vs lossy; vinyl splits 12"/10"/7"; physical
/// splits CD / cassette / box / residual. Rules (checked in order):
///   1. Contains a lossless stream marker (`FLAC`, `AIFF`, `ALAC`, `AIF `)
///      → `"lossless"`. Catches composite strings like `8xFile, FLAC, Comp`.
///   2. Contains a lossy stream marker (`MP3`, `OGG`, `AAC`, `WMA`) →
///      `"lossy"`. MP3 dominates the data but the lossy bucket covers the
///      family.
///   3. Vinyl size at start. 12"-family (`12"`, `LP`, `2xLP`, `3xLP`,
///      `4xLP`, `2x12"`, `3x12"`) → `"vinyl_12"`. 10"-family → `"vinyl_10"`.
///      7"-family → `"vinyl_7"`.
///   4. CD prefix → `"cd"`. Cassette (`Cass`) → `"cassette"`. Box → `"box"`.
///   5. Anything else (flexi, file, unrecognised) → `"other_physical"`.
/// Case-insensitive; the contains checks run on an uppercased copy.
fn bucket_format(format: &str) -> &'static str {
    let upper = format.to_uppercase();
    if upper.contains("FLAC")
        || upper.contains("AIFF")
        || upper.contains("ALAC")
        || upper.contains("AIF ")
    {
        return "lossless";
    }
    if upper.contains("MP3")
        || upper.contains("OGG")
        || upper.contains("AAC")
        || upper.contains("WMA")
    {
        return "lossy";
    }
    let trimmed = format.trim_start();
    let trimmed_upper = trimmed.to_uppercase();
    // Order matters: check 2x12" / 3x12" before 12" so the wider prefix wins;
    // same for 2x10"/2x7" if they ever appear.
    if trimmed.starts_with("2x12\"")
        || trimmed.starts_with("3x12\"")
        || trimmed.starts_with("12\"")
        || trimmed_upper.starts_with("LP")
        || trimmed_upper.starts_with("2XLP")
        || trimmed_upper.starts_with("3XLP")
        || trimmed_upper.starts_with("4XLP")
    {
        return "vinyl_12";
    }
    if trimmed.starts_with("2x10\"") || trimmed.starts_with("10\"") {
        return "vinyl_10";
    }
    if trimmed.starts_with("2x7\"") || trimmed.starts_with("7\"") {
        return "vinyl_7";
    }
    if trimmed_upper.starts_with("CD") {
        return "cd";
    }
    if trimmed_upper.starts_with("CASS") {
        return "cassette";
    }
    if trimmed_upper.starts_with("BOX") {
        return "box";
    }
    "other_physical"
}

// ---------------------------------------------------------------------------
// Interop: refresh metadata from disk; sync published cover URL to local file
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub status: String, // "ok" | "no_changes" | "missing_path" | "no_path" | "no_audio"
    pub changes: Vec<String>,
}

#[tauri::command]
fn refresh_release(
    app: tauri::AppHandle,
    release_id: i64,
) -> Result<RefreshResult, String> {
    // Per-release Refresh is an explicit "trust the file" action — so it
    // overwrites label with whatever the tag now says (or clears it if the
    // tag is gone). Batch scan callers go through refresh_release_inner with
    // overwrite_label = false to keep curated Discogs labels and bulk-set
    // values safe from accidental rewrites.
    refresh_release_inner(app, release_id, true)
}

fn refresh_release_inner(
    app: tauri::AppHandle,
    release_id: i64,
    overwrite_label: bool,
) -> Result<RefreshResult, String> {
    let conn = open(&app)?;
    let sql = format!(
        "SELECT {} FROM releases WHERE id = ?1",
        RELEASE_SELECT_COLS
    );
    let release: Release = conn
        .query_row(&sql, params![release_id], row_to_release)
        .map_err(|e| e.to_string())?;

    let Some(file_path) = release.file_path.as_deref() else {
        return Ok(RefreshResult {
            status: "no_path".into(),
            changes: vec![],
        });
    };
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Ok(RefreshResult {
            status: "missing_path".into(),
            changes: vec![],
        });
    }

    // Treat file_path as the album dir for folder-imported releases, or fall
    // back to its parent for manually-added single-file entries.
    let dir = if path.is_dir() {
        path.clone()
    } else {
        path.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    };

    let mut audio_files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()))
        .filter(|p| p.is_file() && is_audio(p))
        .collect();
    audio_files.sort();

    if audio_files.is_empty() {
        return Ok(RefreshResult {
            status: "no_audio".into(),
            changes: vec![],
        });
    }

    let info = read_dir_tags(&audio_files);

    let new_artist = info.artist.clone().unwrap_or_else(|| release.artist.clone());
    let new_title = info.title.clone().unwrap_or_else(|| release.title.clone());
    let new_year = info.year.or(release.year);
    let new_format_str = if info.codec.is_some() {
        Some(build_format_string(&info))
    } else {
        release.format.clone()
    };
    // Two modes for label:
    //   overwrite_label = true  (per-release Refresh) — file tag wins, so
    //     editing the GROUPING tag and hitting Refresh propagates the change.
    //     A now-empty tag clears the DB value too.
    //   overwrite_label = false (batch Scan library) — only fill when the DB
    //     value is empty. Protects curated Discogs labels and prior backfills
    //     from getting clobbered by drift in local tags.
    // A Discogs-linked release forces fill-empty even in per-release Refresh:
    // Discogs owns the label (it's enrich-filled), so a local tag must never
    // overwrite/clear it — same "Discogs = canonical" rule as track/disc_total.
    let overwrite_label = overwrite_label && release.discogs_id.is_none();
    let new_label = if overwrite_label {
        info.label.clone()
    } else {
        let current_label_empty = release
            .label
            .as_deref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true);
        if current_label_empty {
            info.label.clone().or_else(|| release.label.clone())
        } else {
            release.label.clone()
        }
    };
    let new_cover_path = find_cover(&dir).or_else(|| release.cover_art_path.clone());

    // notes / source — fill-when-empty in BOTH modes, regardless of
    // `overwrite_label`. We never overwrite a non-empty value, so hand-edited
    // notes and curated source URLs survive a rescan. This only backfills
    // releases that have none yet — e.g. lifting a Bandcamp store URL out of a
    // file's COMMENT tag into `source` (and keeping the raw comment in notes).
    let new_notes = if release.notes.as_deref().map(str::trim).unwrap_or("").is_empty() {
        info.comment.clone().or_else(|| release.notes.clone())
    } else {
        release.notes.clone()
    };
    let new_source = if release.source.as_deref().map(str::trim).unwrap_or("").is_empty() {
        info.source_url.clone().or_else(|| release.source.clone())
    } else {
        release.source.clone()
    };

    // Present (audio files on disk) + expected (TRACKTOTAL tag, else present).
    // present vs total = how many tracks are missing locally.
    let present = (audio_files.len() as i64).min(99);
    let new_track_count = Some(present);
    // Discogs owns the canonical total once a release is linked: a disk refresh
    // must not overwrite the enriched track_total with the local tag value
    // (that's the dual-source guard — Discogs = canonical, disk = present).
    // Present count still updates from disk; disc_total isn't touched here.
    let new_track_total = if release.discogs_id.is_some() {
        release.track_total
    } else {
        Some(info.track_total.unwrap_or(present).min(99))
    };

    // Audio-visual presence — count recognised video files in the same dir, so
    // a Refresh (or the bulk Scan-library-changes pass) picks up videos added
    // after the initial recount. Its >0 truth IS published, so a change on a
    // published release trips publish-staleness after the write.
    let new_video_count: Option<i64> = Some(
        std::fs::read_dir(&dir)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()))
            .filter(|p| p.is_file() && is_video(p))
            .count()
            .min(99) as i64,
    );

    let mut changes: Vec<String> = Vec::new();
    if new_artist != release.artist {
        changes.push("artist".into());
    }
    if new_title != release.title {
        changes.push("title".into());
    }
    if new_year != release.year {
        changes.push("year".into());
    }
    if new_format_str != release.format {
        changes.push("format".into());
    }
    if new_label != release.label {
        changes.push("label".into());
    }
    if new_notes != release.notes {
        changes.push("notes".into());
    }
    if new_source != release.source {
        changes.push("source".into());
    }
    if new_cover_path != release.cover_art_path {
        changes.push("cover_art_path".into());
    }
    if new_track_count != release.track_count {
        changes.push("tracks".into());
    }
    if new_track_total != release.track_total {
        changes.push("track_total".into());
    }
    if new_video_count != release.video_count {
        changes.push("video".into());
    }

    if changes.is_empty() {
        return Ok(RefreshResult {
            status: "no_changes".into(),
            changes,
        });
    }

    conn.execute(
        "UPDATE releases
         SET artist = ?1,
             title = ?2,
             year = ?3,
             format = ?4,
             label = ?5,
             notes = ?6,
             source = ?7,
             cover_art_path = ?8,
             track_count = ?9,
             track_total = ?10,
             video_count = ?11,
             updated_at = strftime('%s','now')
         WHERE id = ?12",
        params![
            new_artist,
            new_title,
            new_year,
            new_format_str,
            new_label,
            new_notes,
            new_source,
            new_cover_path,
            new_track_count,
            new_track_total,
            new_video_count,
            release_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // The `video` tag's emitted value changing on a *published* release makes
    // its kind:31237 event stale — drop it to "needs republish" so the new tag
    // goes out. Other refreshed fields are a disk-sync and don't touch publish
    // state here (consistent with prior behaviour).
    if release.last_published_naddr.is_some()
        && video_emit(release.video_count) != video_emit(new_video_count)
    {
        mark_unpublished(&conn, release_id)?;
    }

    Ok(RefreshResult {
        status: "ok".into(),
        changes,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrphanInfo {
    pub id: i64,
    pub artist: String,
    pub title: String,
    pub file_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanSummary {
    pub scanned: usize,
    pub refreshed: usize,
    pub no_changes: usize,
    pub orphaned: usize,
    pub no_audio: usize,
    pub no_path: usize,
    pub orphans: Vec<OrphanInfo>,
    pub errors: Vec<String>,
}

#[tauri::command]
fn scan_library_changes(
    app: tauri::AppHandle,
) -> Result<LibraryScanSummary, String> {
    // Pull all releases that have a file_path. Physical releases without a
    // path are excluded — there's nothing on disk to scan against. Fetch
    // artist/title up front so we can surface orphan details without a
    // second DB round-trip per orphan.
    let candidates: Vec<(i64, String, String, String)> = {
        let conn = open(&app)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, artist, title, file_path
                 FROM releases
                 WHERE file_path IS NOT NULL AND file_path <> ''
                 ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total = candidates.len();
    let mut summary = LibraryScanSummary {
        scanned: total,
        refreshed: 0,
        no_changes: 0,
        orphaned: 0,
        no_audio: 0,
        no_path: 0,
        orphans: Vec::new(),
        errors: Vec::new(),
    };
    let _ = app.emit("scan:started", total);

    for (i, (release_id, artist, title, file_path)) in candidates.iter().enumerate() {
        let _ = app.emit(
            "scan:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: file_path.clone(),
            },
        );

        match refresh_release_inner(app.clone(), *release_id, false) {
            Ok(result) => match result.status.as_str() {
                "ok" => summary.refreshed += 1,
                "no_changes" => summary.no_changes += 1,
                "missing_path" => {
                    summary.orphaned += 1;
                    summary.orphans.push(OrphanInfo {
                        id: *release_id,
                        artist: artist.clone(),
                        title: title.clone(),
                        file_path: file_path.clone(),
                    });
                }
                "no_audio" => summary.no_audio += 1,
                "no_path" => summary.no_path += 1,
                _ => {}
            },
            Err(e) => summary
                .errors
                .push(format!("release {}: {}", release_id, e)),
        }
    }

    Ok(summary)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryReconcileSummary {
    /// The root that was reconciled against (resolved from config or derived).
    pub root: String,
    // Discovery phase (import_directory) — new album folders found on disk.
    pub imported: usize,
    pub skipped: usize,
    // Refresh phase (scan_library_changes) — existing releases re-read.
    pub refreshed: usize,
    pub no_changes: usize,
    pub orphaned: usize,
    pub no_audio: usize,
    pub orphans: Vec<OrphanInfo>,
    pub errors: Vec<String>,
    /// Unix seconds this reconcile completed (also persisted to config).
    pub scanned_at: i64,
}

/// One-click library reconcile: discover new album folders under `root`
/// (idempotent — `import_directory` skips paths already in the DB) then refresh
/// every release with a path against disk (`scan_library_changes` — recount
/// tracks/videos, backfill empty label/notes/source, flag orphans). Persists
/// the resolved root + completion time + orphan count so the library summary
/// can show a "last scanned" readout without re-walking the disk. `root`
/// defaults to the derived common prefix of all local releases.
#[tauri::command]
fn reconcile_library(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<LibraryReconcileSummary, String> {
    let root = match root {
        Some(r) if !r.trim().is_empty() => r.trim().to_owned(),
        _ => library_root(&app)?,
    };

    let _ = app.emit("reconcile:phase", "discover");
    let import = import_directory(app.clone(), root.clone())?;
    let _ = app.emit("reconcile:phase", "refresh");
    let scan = scan_library_changes(app.clone())?;

    let scanned_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut errors = import.errors;
    errors.extend(scan.errors);

    write_config_patch(
        &app,
        &[
            ("libraryRoot", serde_json::Value::String(root.clone())),
            ("lastScannedAt", serde_json::json!(scanned_at)),
            ("lastOrphaned", serde_json::json!(scan.orphaned)),
        ],
    )?;

    Ok(LibraryReconcileSummary {
        root,
        imported: import.imported,
        skipped: import.skipped,
        refreshed: scan.refreshed,
        no_changes: scan.no_changes,
        orphaned: scan.orphaned,
        no_audio: scan.no_audio,
        orphans: scan.orphans,
        errors,
        scanned_at,
    })
}

/// The effective reconcile root (configured or derived), or None if neither
/// exists yet. Lets the frontend show the current root and prefill the picker.
#[tauri::command]
fn get_library_root(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(library_root(&app).ok())
}

/// Persist an explicit library root (the "Set library folder…" action).
#[tauri::command]
fn set_library_root(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err("empty library root".into());
    }
    write_config_patch(
        &app,
        &[(
            "libraryRoot",
            serde_json::Value::String(trimmed.to_owned()),
        )],
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
    pub releases: i64,
    /// Sum of present track counts (local audio files across the library).
    pub tracks: i64,
    /// Releases missing tracks locally (present < expected TRACKTOTAL).
    pub incomplete: i64,
    /// Releases with at least one recognised video file.
    pub videos: i64,
    /// Orphan count from the last reconcile (path went missing on disk).
    pub orphaned: i64,
    pub last_scanned_at: Option<i64>,
    pub library_root: Option<String>,
}

// ---------------------------------------------------------------------------
// Published manifest — the suite's cross-app bridge
// ---------------------------------------------------------------------------
//
// ndisc is the only app that knows what has been published to Nostr. Other suite
// apps sometimes need that fact — ntree, for instance, wants to sample only the
// released library. Rather than have them read ndisc's SQLite (which would
// couple them to this schema AND this file's location), ndisc EXPORTS a small
// manifest to a suite-shared path and they read that.
//
// This is the "option B, shared manifest" direction already chosen for the
// suite's terrain/roots model. The manifest is derived and disposable: safe to
// regenerate at any time, and nothing breaks if it is absent.

/// Where suite apps look for cross-app state. Deliberately NOT ndisc's own
/// app-data dir — this is shared, not private.
fn suite_shared_dir() -> Result<PathBuf, String> {
    // Deliberately OUTSIDE each app's private data dir — the whole point is that
    // the other suite apps can read it, so every app must resolve this the same
    // way. Linux is unchanged (existing installs depend on the path); macOS gets
    // the same location because nothing there uses it yet, so there is nothing
    // to migrate and consistency beats platform idiom. Windows uses LOCALAPPDATA
    // rather than APPDATA on purpose: everything here is MACHINE-specific
    // (roots.json points at local library paths), so it must not roam.
    #[cfg(windows)]
    {
        let base =
            std::env::var("LOCALAPPDATA").map_err(|e| format!("LOCALAPPDATA: {e}"))?;
        Ok(PathBuf::from(base).join("ndisc-suite"))
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").map_err(|e| format!("HOME: {e}"))?;
        Ok(PathBuf::from(home).join(".local/share/ndisc-suite"))
    }
}

// The WHOLE catalogue (not just published), with the local metadata other suite
// apps need to enrich their own view of the same files — currently label +
// catalog, joined by `dir`. Deliberately a SIBLING of published.json rather than
// an extension of it: published.json means "what ndisc has published" and ntree
// scopes its released filter to it, so it must never gain unpublished rows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueRelease {
    pub id: i64,
    pub artist: String,
    pub title: String,
    /// Absolute path of the release folder on disk — the join key for consumers.
    pub dir: String,
    pub label: Option<String>,
    pub catalog: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueManifest {
    pub version: u32,
    pub generated_at: i64,
    pub library_root: Option<String>,
    pub releases: Vec<CatalogueRelease>,
}

/// Write `catalogue.json` beside `published.json`. Every release that has a
/// folder on disk (the join key); label/catalog are null when unset.
fn write_catalogue_manifest(
    conn: &rusqlite::Connection,
    dir: &std::path::Path,
    library_root: Option<String>,
) -> Result<usize, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, artist, title, file_path,
                    NULLIF(TRIM(COALESCE(label,'')),''),
                    NULLIF(TRIM(COALESCE(catalog_number,'')),'')
               FROM releases
              WHERE file_path IS NOT NULL AND TRIM(file_path) <> ''
              ORDER BY artist, title",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CatalogueRelease {
                id: r.get(0)?,
                artist: r.get(1)?,
                title: r.get(2)?,
                dir: r.get(3)?,
                label: r.get(4)?,
                catalog: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut releases = Vec::new();
    for row in rows {
        releases.push(row.map_err(|e| e.to_string())?);
    }
    let manifest = CatalogueManifest {
        version: 1,
        generated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        library_root,
        releases,
    };
    let path = dir.join("catalogue.json");
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(manifest.releases.len())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRelease {
    pub id: i64,
    pub artist: String,
    pub title: String,
    /// Absolute path of the release folder on disk.
    pub dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedManifest {
    pub version: u32,
    pub generated_at: i64,
    pub library_root: Option<String>,
    pub releases: Vec<ManifestRelease>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSummary {
    pub path: String,
    pub releases: usize,
    /// Published, but with no folder on disk — a consumer cannot act on these,
    /// so they are counted rather than silently dropped.
    pub without_path: usize,
}

/// Write the Nostr-published releases that have a folder on disk to the
/// suite-shared manifest. Read-only against the library.
#[tauri::command]
fn export_published_manifest(app: tauri::AppHandle) -> Result<ManifestSummary, String> {
    let conn = open(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, artist, title, file_path
               FROM releases
              WHERE publish_state = 'published'
              ORDER BY artist, title",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut releases = Vec::new();
    let mut without_path = 0usize;
    for row in rows {
        let (id, artist, title, dir) = row.map_err(|e| e.to_string())?;
        match dir {
            Some(d) if !d.trim().is_empty() => releases.push(ManifestRelease {
                id,
                artist,
                title,
                dir: d,
            }),
            _ => without_path += 1,
        }
    }

    let manifest = PublishedManifest {
        version: 1,
        generated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
        library_root: get_library_root(app.clone()).ok().flatten(),
        releases,
    };

    let dir = suite_shared_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = dir.join("published.json");
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))?;

    // Refresh the sibling catalogue export in the same action, so the two suite
    // manifests never drift apart. Consumers: nplay (label filter).
    write_catalogue_manifest(&conn, &dir, manifest.library_root.clone())?;

    Ok(ManifestSummary {
        path: path.to_string_lossy().to_string(),
        releases: manifest.releases.len(),
        without_path,
    })
}

/// Passive library readout for the header: cheap live SQL for
/// releases/tracks/incomplete/videos, plus orphan count + last-scanned time
/// carried from the last reconcile (so we never re-walk the disk just to
/// render the summary line).
#[tauri::command]
fn get_library_summary(app: tauri::AppHandle) -> Result<LibrarySummary, String> {
    let conn = open(&app)?;
    let scalar = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())
    };
    let releases = scalar("SELECT COUNT(*) FROM releases")?;
    let tracks = scalar("SELECT COALESCE(SUM(track_count), 0) FROM releases")?;
    let incomplete = scalar(
        "SELECT COUNT(*) FROM releases \
         WHERE track_count IS NOT NULL AND track_total IS NOT NULL \
           AND track_count < track_total",
    )?;
    let videos = scalar(
        "SELECT COUNT(*) FROM releases WHERE video_count IS NOT NULL AND video_count > 0",
    )?;

    let m = read_config(&app);
    let orphaned = m.get("lastOrphaned").and_then(|v| v.as_i64()).unwrap_or(0);
    let last_scanned_at = m.get("lastScannedAt").and_then(|v| v.as_i64());
    let library_root = m
        .get("libraryRoot")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| library_root(&app).ok());

    Ok(LibrarySummary {
        releases,
        tracks,
        incomplete,
        videos,
        orphaned,
        last_scanned_at,
        library_root,
    })
}

/// Advisory sanity notes about a folder being linked to a release. Deliberately
/// ADVISORY — odd layouts are legitimate (a release really can live outside the
/// main root), so nothing here refuses anything; it only says what looks off.
/// Exists because a row once ended up pointing at `$HOME`, which then made
/// "sync cover to disk" want to write a cover.jpg into the home directory.
#[tauri::command]
fn inspect_release_path(
    app: tauri::AppHandle,
    path: String,
    release_id: Option<i64>,
) -> Result<Vec<String>, String> {
    let mut notes: Vec<String> = Vec::new();
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(notes);
    }
    let p = PathBuf::from(trimmed);
    if !p.is_dir() {
        notes.push("that path is not a directory".into());
        return Ok(notes);
    }
    // A home directory is essentially never a release folder, and it's the
    // specific mistake that motivated this check.
    if let Ok(home) = std::env::var("HOME") {
        if p == PathBuf::from(&home) {
            notes.push("that is your home directory, not a release folder".into());
        }
    }
    if let Ok(root) = library_root(&app) {
        if !root.trim().is_empty() && !p.starts_with(PathBuf::from(&root)) {
            notes.push(format!("outside the library root ({root})"));
        }
    }
    let audio = std::fs::read_dir(&p)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| {
                    let q = e.path();
                    q.is_file() && is_audio(&q)
                })
                .count()
        })
        .unwrap_or(0);
    if audio == 0 {
        notes.push("no audio files directly in this folder".into());
    }
    let conn = open(&app)?;
    let claimed: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT id, artist, title FROM releases WHERE file_path = ?1 LIMIT 1",
            params![trimmed],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    if let Some((id, artist, title)) = claimed {
        if Some(id) != release_id {
            notes.push(format!("already linked to \"{artist} — {title}\""));
        }
    }
    Ok(notes)
}

#[tauri::command]
fn update_release_path(
    app: tauri::AppHandle,
    release_id: i64,
    new_path: String,
) -> Result<RefreshResult, String> {
    let trimmed = new_path.trim().to_owned();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    {
        let conn = open(&app)?;
        conn.execute(
            "UPDATE releases
             SET file_path = ?1, updated_at = strftime('%s','now')
             WHERE id = ?2",
            params![trimmed, release_id],
        )
        .map_err(|e| e.to_string())?;
    }
    refresh_release(app, release_id)
}

/// Detach a release's local folder — reverts it to "object-only" (no folder to
/// count against), clearing the derived present-count so completeness falls
/// back to present = total. The opposite of update_release_path; used when a
/// path was attached in error or the files have moved out of the library.
#[tauri::command]
fn clear_release_path(app: tauri::AppHandle, release_id: i64) -> Result<(), String> {
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET file_path = NULL, track_count = NULL,
             updated_at = strftime('%s','now')
         WHERE id = ?1",
        params![release_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverSyncResult {
    pub status: String, // "ok" | "no_url" | "no_path" | "missing_path"
    pub written: Option<String>,
    pub bytes: Option<u64>,
}

fn ext_for_content_type(content_type: Option<&str>, url: &str) -> &'static str {
    if let Some(ct) = content_type {
        let lower = ct.to_lowercase();
        if lower.contains("png") {
            return "png";
        }
        if lower.contains("webp") {
            return "webp";
        }
        if lower.contains("gif") {
            return "gif";
        }
        if lower.contains("jpeg") || lower.contains("jpg") {
            return "jpg";
        }
    }
    // Fallback: URL extension.
    if let Some(idx) = url.rfind('.') {
        let ext = &url[idx + 1..].to_lowercase();
        if ["jpg", "jpeg", "png", "webp", "gif"].contains(&ext.as_str()) {
            return if ext == "jpeg" { "jpg" } else { Box::leak(ext.clone().into_boxed_str()) };
        }
    }
    "jpg"
}

#[tauri::command]
async fn sync_cover_to_disk(
    app: tauri::AppHandle,
    release_id: i64,
) -> Result<CoverSyncResult, String> {
    let (file_path, cover_url) = {
        let conn = open(&app)?;
        let row: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT file_path, cover_art_url FROM releases WHERE id = ?1",
                params![release_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        row
    };

    let Some(cover_url) = cover_url.filter(|s| !s.trim().is_empty()) else {
        return Ok(CoverSyncResult {
            status: "no_url".into(),
            written: None,
            bytes: None,
        });
    };
    let Some(file_path) = file_path.filter(|s| !s.trim().is_empty()) else {
        return Ok(CoverSyncResult {
            status: "no_path".into(),
            written: None,
            bytes: None,
        });
    };

    let path = PathBuf::from(&file_path);
    let dir = if path.is_dir() {
        path.clone()
    } else if let Some(parent) = path.parent() {
        parent.to_path_buf()
    } else {
        return Ok(CoverSyncResult {
            status: "missing_path".into(),
            written: None,
            bytes: None,
        });
    };
    if !dir.exists() {
        return Ok(CoverSyncResult {
            status: "missing_path".into(),
            written: None,
            bytes: None,
        });
    }

    let response = reqwest::get(&cover_url)
        .await
        .map_err(|e| format!("fetch {}: {}", cover_url, e))?;
    let ct = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_owned());
    let ext = ext_for_content_type(ct.as_deref(), &cover_url);
    let body = response
        .bytes()
        .await
        .map_err(|e| format!("read body: {}", e))?;

    let out = dir.join(format!("cover.{}", ext));
    std::fs::write(&out, &body).map_err(|e| {
        format!("write {}: {}", out.display(), e)
    })?;

    let out_str = out.to_string_lossy().into_owned();
    let conn = open(&app)?;
    conn.execute(
        "UPDATE releases
         SET cover_art_path = ?1, updated_at = strftime('%s','now')
         WHERE id = ?2",
        params![out_str, release_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(CoverSyncResult {
        status: "ok".into(),
        written: Some(out_str),
        bytes: Some(body.len() as u64),
    })
}

// ---------------------------------------------------------------------------
// Nostr identity (keypair stored in OS keychain)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Keypair {
    pub npub: String,
    pub nsec: String,
}

// Debug builds (`tauri dev`) use a separate keychain service so development
// signs in with its own identity and never reads or writes the real release
// nsec. Release builds keep KEYRING_SERVICE unchanged.
fn keyring_service() -> &'static str {
    if cfg!(debug_assertions) {
        "ndisc-dev"
    } else {
        KEYRING_SERVICE
    }
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(keyring_service(), KEYRING_USER).map_err(|e| e.to_string())
}

fn store_nsec(nsec: &str) -> Result<(), String> {
    keyring_entry()?
        .set_password(nsec)
        .map_err(|e| e.to_string())
}

fn load_nsec() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn keys_from_nsec(nsec: &str) -> Result<Keys, String> {
    let sk = SecretKey::from_bech32(nsec).map_err(|e| format!("invalid nsec: {e}"))?;
    Ok(Keys::new(sk))
}

#[tauri::command]
fn generate_keypair() -> Result<Keypair, String> {
    let keys = Keys::generate();
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    store_nsec(&nsec)?;
    Ok(Keypair { npub, nsec })
}

#[tauri::command]
fn import_keypair(nsec: String) -> Result<String, String> {
    let nsec = nsec.trim().to_owned();
    let keys = keys_from_nsec(&nsec)?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    store_nsec(&nsec)?;
    Ok(npub)
}

#[tauri::command]
fn get_npub() -> Result<Option<String>, String> {
    let Some(nsec) = load_nsec()? else {
        return Ok(None);
    };
    let keys = keys_from_nsec(&nsec)?;
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    Ok(Some(npub))
}

#[tauri::command]
fn clear_keypair() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Discogs API token (for the metadata enrichment pass)
// ---------------------------------------------------------------------------

fn discogs_token_entry() -> Result<Entry, String> {
    Entry::new(keyring_service(), KEYRING_USER_DISCOGS).map_err(|e| e.to_string())
}

fn load_discogs_token() -> Result<Option<String>, String> {
    match discogs_token_entry()?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn clear_discogs_token_inner() -> Result<(), String> {
    match discogs_token_entry()?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Store (or, when given an empty string, clear) the Discogs personal access
// token. The token is never returned to the frontend — only its presence is,
// via get_discogs_token_status.
#[tauri::command]
fn set_discogs_token(token: String) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() {
        return clear_discogs_token_inner();
    }
    discogs_token_entry()?
        .set_password(t)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_discogs_token_status() -> Result<bool, String> {
    Ok(load_discogs_token()?.is_some())
}

#[tauri::command]
fn clear_discogs_token() -> Result<(), String> {
    clear_discogs_token_inner()
}

// ---------------------------------------------------------------------------
// Nostr publish (kind:31237 release events)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelayError {
    pub relay: String,
    pub error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub event_id: String,
    pub naddr: String,
    pub accepted_by: Vec<String>,
    pub rejected: Vec<RelayError>,
}

fn release_d_tag(release_id: i64) -> String {
    format!("disco-vault:{}", release_id)
}

const REACTION_RELAYS_DEFAULT: &[&str] = &["wss://relay.fizx.uk", "wss://nos.lol"];

/// Publish a kind:7 reaction targeting one of the user's own releases.
/// Builds the replaceable address `31237:<my_pk>:disco-vault:<release_id>`
/// from the stored keys, signs the event, publishes to a small relay
/// set. Mirrors the ndisc.view reaction format ([a, p, k] tags) so the
/// web viewer aggregates desktop-published reactions the same way it
/// aggregates its own.
#[tauri::command]
async fn publish_reaction(
    release_id: i64,
    content: String,
) -> Result<PublishResult, String> {
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity in keychain".to_string())?;
    let keys = keys_from_nsec(&nsec)?;
    let d = release_d_tag(release_id);
    let address = format!(
        "{}:{}:{}",
        u16::from(Kind::Custom(KIND_RELEASE)),
        keys.public_key(),
        d
    );

    let tags = vec![
        Tag::parse(["a", &address]).map_err(|e| e.to_string())?,
        Tag::parse(["p", &keys.public_key().to_string()]).map_err(|e| e.to_string())?,
        Tag::parse(["k", &KIND_RELEASE.to_string()]).map_err(|e| e.to_string())?,
    ];

    let event = EventBuilder::new(Kind::Reaction, &content)
        .tags(tags)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;
    let event_id = event.id.to_string();

    let relays: Vec<String> = REACTION_RELAYS_DEFAULT.iter().map(|s| s.to_string()).collect();
    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    if accepted_by.is_empty() {
        let first = rejected
            .first()
            .map(|r| format!("{}: {}", r.relay, r.error))
            .unwrap_or_else(|| "no relays accepted the event".to_string());
        return Err(format!("publish failed — {first}"));
    }

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

/// Publish a kind:5 deletion event for one of our prior kind:7 reactions.
#[tauri::command]
async fn delete_reaction(
    reaction_event_id: String,
) -> Result<PublishResult, String> {
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity in keychain".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let tags = vec![
        Tag::parse(["e", &reaction_event_id]).map_err(|e| e.to_string())?,
        Tag::parse(["k", "7"]).map_err(|e| e.to_string())?,
    ];

    let event = EventBuilder::new(Kind::EventDeletion, "")
        .tags(tags)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;
    let event_id = event.id.to_string();

    let relays: Vec<String> = REACTION_RELAYS_DEFAULT.iter().map(|s| s.to_string()).collect();
    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

fn build_naddr(keys: &Keys, d: &str, relays: &[String]) -> Result<String, String> {
    let relay_hints: Vec<RelayUrl> = relays
        .iter()
        .take(3)
        .filter_map(|r| RelayUrl::parse(r).ok())
        .collect();
    let coordinate = Coordinate::new(Kind::Custom(KIND_RELEASE), keys.public_key())
        .identifier(d.to_string());
    let nip19 = Nip19Coordinate::new(coordinate, relay_hints);
    nip19.to_bech32().map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PublishProgress {
    current: usize,
    total: usize,
    title: String,
    artist: String,
    accepted_by: Vec<String>,
    rejected: Vec<RelayError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishLibrarySummary {
    pub total: usize,
    pub published: usize,
    // Rows left untouched because there was nothing to do (e.g. unpublishing a
    // never-published or already-retracted release — no live event to retract).
    pub skipped: usize,
    pub failed: usize,
}

fn push_tag(tags: &mut Vec<Tag>, name: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    let tag = Tag::parse([name, value]).map_err(|e| e.to_string())?;
    tags.push(tag);
    Ok(())
}

fn release_event(keys: &Keys, r: &Release) -> Result<Event, String> {
    let d = release_d_tag(r.id.unwrap_or_default());
    let mut tags: Vec<Tag> = Vec::new();
    push_tag(&mut tags, "d", &d)?;
    push_tag(&mut tags, "title", &r.title)?;
    push_tag(&mut tags, "artist", &r.artist)?;
    if let Some(t) = r.release_type.as_deref() {
        push_tag(&mut tags, "type", t)?;
    }
    if let Some(c) = r.category.as_deref() {
        push_tag(&mut tags, "category", c)?;
    }
    if let Some(m) = r.medium.as_deref() {
        push_tag(&mut tags, "medium", m)?;
    }
    if let Some(f) = r.format.as_deref() {
        push_tag(&mut tags, "format", f)?;
    }
    if let Some(y) = r.year {
        push_tag(&mut tags, "year", &y.to_string())?;
    }
    if let Some(l) = r.label.as_deref() {
        push_tag(&mut tags, "label", l)?;
    }
    if let Some(c) = r.catalog_number.as_deref() {
        push_tag(&mut tags, "catalog", c)?;
    }
    if let Some(c) = r.country.as_deref() {
        push_tag(&mut tags, "country", c)?;
    }
    if let Some(c) = r.condition.as_deref() {
        push_tag(&mut tags, "condition", c)?;
    }
    if let Some(s) = r.source.as_deref() {
        if s.starts_with("http://") || s.starts_with("https://") {
            push_tag(&mut tags, "source", s)?;
        }
    }
    if let Some(d_id) = r.discogs_id {
        push_tag(&mut tags, "i", &format!("discogs:release:{}", d_id))?;
    }
    // bandcamp_id is intentionally NOT emitted as an `i` tag: the frozen v2
    // schema's `i` namespace is discogs/musicbrainz only, with no Bandcamp slot.
    // The Bandcamp link reaches consumers via the in-contract `source` URL.
    if let Some(url) = r.cover_art_url.as_deref() {
        push_tag(&mut tags, "image", url)?;
    }

    // v2: 0–3 ordered `genre` tags, slot 0 → 2. Order on the wire IS the
    // priority order (first = primary). Density is enforced upstream by
    // set_release_genres so we just emit what's set; a Some in slot N+1
    // without a Some in slot N never lands in the DB.
    for slot in [
        r.genre_primary.as_deref(),
        r.genre_secondary.as_deref(),
        r.genre_tertiary.as_deref(),
    ] {
        if let Some(g) = slot {
            push_tag(&mut tags, "genre", g)?;
        }
    }

    // v2 additive: expected total tracks (the release's canonical size). Local
    // present-count (track_count) is NOT published — only this release-level
    // total. Omitted when unknown. Consumers treat it as optional.
    if let Some(tt) = r.track_total.filter(|&n| n > 0) {
        push_tag(&mut tags, "tracks", &tt.to_string())?;
    }

    // v2 additive: total disc count (Discogs-enrichment-derived). A release
    // property like `tracks`; emitted only when > 0, omitted otherwise.
    if let Some(dt) = r.disc_total.filter(|&n| n > 0) {
        push_tag(&mut tags, "discs", &dt.to_string())?;
    }

    // v2 additive (2026-06): `video` — count of audio-visual files in the
    // release, emitted only when > 0. Presence marks the release as carrying
    // video; A/V-unaware consumers ignore it. See video-incubation note.
    if let Some(vc) = r.video_count.filter(|&n| n > 0) {
        push_tag(&mut tags, "video", &vc.to_string())?;
    }

    let content = r.notes.clone().unwrap_or_default();
    EventBuilder::new(Kind::Custom(KIND_RELEASE), content)
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())
}

async fn build_client(keys: Keys, relays: &[String]) -> Client {
    let client = Client::builder().signer(keys).build();
    for url in relays {
        let _ = client.add_relay(url.as_str()).await;
    }
    client.connect().await;
    client
}

/// Liveness of one configured relay.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelayHealth {
    pub relay: String,
    pub ok: bool,
    /// Round trip to a real answer, not just a socket — see check_one_relay.
    pub rtt_ms: Option<u64>,
    pub error: Option<String>,
}

async fn check_one_relay(url: String) -> RelayHealth {
    let started = std::time::Instant::now();
    let fail = |e: String| RelayHealth {
        relay: url.clone(),
        ok: false,
        rtt_ms: None,
        error: Some(e),
    };

    // No signer: this is a read-only liveness probe, nothing is signed or sent.
    let client = Client::builder().build();
    if let Err(e) = client.add_relay(url.as_str()).await {
        return fail(e.to_string());
    }
    client.connect().await;

    // Issue a trivial REQ rather than trusting the socket. A relay can accept
    // the websocket and then never answer (or reject the subscription); "the
    // TCP connection opened" is not the same claim as "this relay will serve
    // us", and the dot is asserting the latter.
    let filter = Filter::new().kind(Kind::Custom(KIND_RELEASE)).limit(1);
    let result = client.fetch_events(filter, Duration::from_secs(6)).await;
    let _ = client.shutdown().await;

    match result {
        Ok(_) => RelayHealth {
            relay: url,
            ok: true,
            rtt_ms: Some(started.elapsed().as_millis() as u64),
            error: None,
        },
        Err(e) => fail(e.to_string()),
    }
}

/// Probe every configured relay concurrently. Read-only.
#[tauri::command]
async fn check_relays(relays: Vec<String>) -> Result<Vec<RelayHealth>, String> {
    // Concurrent, not sequential: three relays each allowed a 6s timeout would
    // otherwise take 18s to report a single dead one.
    let handles: Vec<_> = relays
        .into_iter()
        .map(|url| tokio::spawn(check_one_relay(url)))
        .collect();

    let mut out = Vec::new();
    for h in handles {
        match h.await {
            Ok(health) => out.push(health),
            Err(e) => return Err(format!("relay check panicked: {e}")),
        }
    }
    Ok(out)
}

fn split_send_output(output: &Output<EventId>) -> (Vec<String>, Vec<RelayError>) {
    let accepted: Vec<String> = output.success.iter().map(|u| u.to_string()).collect();
    let rejected: Vec<RelayError> = output
        .failed
        .iter()
        .map(|(url, err)| RelayError {
            relay: url.to_string(),
            error: err.clone(),
        })
        .collect();
    (accepted, rejected)
}

/// The release coordinate a kind:31237 lives at: "31237:<pubkey>:disco-vault:<id>".
fn release_address(keys: &Keys, release_id: i64) -> String {
    format!(
        "{}:{}:{}",
        u16::from(Kind::Custom(KIND_RELEASE)),
        keys.public_key(),
        release_d_tag(release_id)
    )
}

/// Build the kind:5 that retracts a release.
///
/// Carries BOTH the `a` coordinate and an `e` tag per known event id. The `a`
/// tag alone is not enough: nostr-rs-relay (which relay.fizx.uk runs) only
/// implements NIP-09 deletion by event id, so an `a`-only deletion is stored
/// and never applied — the release stays live forever. strfry (nos.lol) honours
/// `a`. Sending both satisfies each without a second event.
///
/// `event_ids` may be empty (nothing known); the deletion is then `a`-only and
/// will only take on relays that support addressable deletion.
fn release_delete_event(
    keys: &Keys,
    release_id: i64,
    event_ids: &[String],
) -> Result<Event, String> {
    let mut tags = vec![
        Tag::parse(["a", &release_address(keys, release_id)])
            .map_err(|e| e.to_string())?,
        Tag::parse(["k", &KIND_RELEASE.to_string()]).map_err(|e| e.to_string())?,
    ];
    for id in event_ids {
        tags.push(Tag::parse(["e", id]).map_err(|e| e.to_string())?);
    }
    EventBuilder::new(Kind::EventDeletion, "")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn unpublish_release(
    app: tauri::AppHandle,
    release_id: i64,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    // Name the live event explicitly when we know its id (see the doc comment
    // on release_delete_event). Rows published before that column existed have
    // none — "Reconcile relays" is the path that cleans those up.
    let known: Vec<String> = open(&app)?
        .query_row(
            "SELECT last_published_event_id FROM releases WHERE id = ?1",
            params![release_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten()
        .into_iter()
        .collect();

    let event = release_delete_event(&keys, release_id, &known)?;
    let event_id = event.id.to_string();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    // Clear publish-state markers on accepted deletion. The naddr stays a
    // valid address technically, but it points at nothing on relays that
    // honoured the deletion — so we treat the release as unpublished again.
    if !accepted_by.is_empty() {
        let conn = open(&app)?;
        conn.execute(
            "UPDATE releases
             SET last_published_at = NULL, last_published_naddr = NULL,
                 last_published_event_id = NULL,
                 publish_state = CASE WHEN publish_state IN ('published','stale')
                                      THEN 'retracted' ELSE publish_state END
             WHERE id = ?1",
            params![release_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

// ---------------------------------------------------------------------------
// Duplicate detection — suggest suspect same-release rows (never auto-acts)
// ---------------------------------------------------------------------------

/// Normalise a title/artist for duplicate grouping: lowercase, keep only
/// alphanumerics. So "No Comment_0007" == "No Comment 0007" == "nocomment0007",
/// but "Vol.1"/"Vol.2" and "0002"/"0007" stay distinct.
fn dup_norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// The shared normalized key (`artist|title`) — stable id for dismissal.
    pub key: String,
    /// The suspect rows (2+), full records for a side-by-side comparison.
    pub releases: Vec<Release>,
}

/// Suspected-duplicate groups: releases sharing a normalized artist+title key.
/// Read-only — this only surfaces candidates for the review UI; nothing is
/// merged or deleted. Groups of 2+ are returned, largest first then by artist.
#[tauri::command]
fn find_duplicate_groups(app: tauri::AppHandle) -> Result<Vec<DuplicateGroup>, String> {
    let conn = open(&app)?;
    let sql = format!("SELECT {RELEASE_SELECT_COLS} FROM releases");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_release).map_err(|e| e.to_string())?;

    let mut groups: HashMap<String, Vec<Release>> = HashMap::new();
    for r in rows {
        let r = r.map_err(|e| e.to_string())?;
        let a = dup_norm(&r.artist);
        let t = dup_norm(&r.title);
        if a.is_empty() && t.is_empty() {
            continue; // a blank artist+title shouldn't cluster
        }
        groups.entry(format!("{a}|{t}")).or_default().push(r);
    }

    let mut out: Vec<DuplicateGroup> = groups
        .into_iter()
        .filter(|(_, v)| v.len() >= 2)
        .map(|(key, mut releases)| {
            releases.sort_by_key(|r| r.id.unwrap_or_default());
            DuplicateGroup { key, releases }
        })
        .collect();
    out.sort_by(|a, b| {
        b.releases
            .len()
            .cmp(&a.releases.len())
            .then_with(|| {
                a.releases[0]
                    .artist
                    .to_lowercase()
                    .cmp(&b.releases[0].artist.to_lowercase())
            })
            .then_with(|| a.releases[0].title.to_lowercase().cmp(&b.releases[0].title.to_lowercase()))
    });
    Ok(out)
}

// ---------------------------------------------------------------------------
// Merge — collapse two rows that are one logical release into one
// ---------------------------------------------------------------------------

fn str_nonempty(s: &Option<String>) -> bool {
    s.as_deref().map(|x| !x.trim().is_empty()).unwrap_or(false)
}

/// Fold a String field: the survivor's own non-empty value always wins; the
/// loser fills only a gap. Records the field name + whether it's a wire field
/// (carried on the kind:31237 event) when the loser's value is taken.
fn fold_str(
    folded: &mut Vec<String>,
    wire_changed: &mut bool,
    name: &str,
    wire: bool,
    surv: Option<String>,
    lose: Option<String>,
) -> Option<String> {
    if str_nonempty(&surv) {
        return surv;
    }
    if str_nonempty(&lose) {
        folded.push(name.to_string());
        if wire {
            *wire_changed = true;
        }
        return lose;
    }
    surv
}

/// Fold an Option<i64> field (0/negative treated as absent for counts).
fn fold_i64(
    folded: &mut Vec<String>,
    wire_changed: &mut bool,
    name: &str,
    wire: bool,
    surv: Option<i64>,
    lose: Option<i64>,
) -> Option<i64> {
    if surv.map(|n| n > 0).unwrap_or(false) {
        return surv;
    }
    if lose.map(|n| n > 0).unwrap_or(false) {
        folded.push(name.to_string());
        if wire {
            *wire_changed = true;
        }
        return lose;
    }
    surv.or(lose)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeSummary {
    pub survivor_id: i64,
    /// Field names the survivor absorbed from the loser (empty gaps it filled).
    pub folded_fields: Vec<String>,
    /// The loser had a live kind:31237 that we retracted before deleting it.
    pub loser_retracted: bool,
    /// The survivor was published and a wire field changed, so it was flagged
    /// stale for re-publish.
    pub survivor_marked_stale: bool,
}

/// Merge two rows that are the same logical release (a physical Discogs row and
/// its digital Bandcamp/folder twin). The SURVIVOR keeps every non-empty field
/// it already has and absorbs the LOSER's values only where the survivor is
/// empty — provenance (file_path, bandcamp_id, source, discogs_id, covers,
/// source_label), counts, descriptive metadata, and genres (only when the
/// survivor has none). The loser is then deleted. If the loser has a live
/// kind:31237 it is RETRACTED first (kind:5) so no naddr is stranded; if that
/// retraction is rejected by every relay the merge aborts rather than orphan an
/// event. If the survivor is published and a WIRE field changed, it is marked
/// stale so the enriched release re-publishes. Callers pass survivor == the
/// published row (see the UI), so the common path retracts nothing.
// ---- duplicate resolution: audit a folder, then trash the losing copy -------

/// What a release's folder actually contains — the evidence for choosing which
/// duplicate to keep. Purely read-only.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderAudit {
    pub dir: String,
    pub exists: bool,
    pub file_count: usize,
    pub total_bytes: u64,
    /// Distinct "codec sr/depth" summaries across the audio files, e.g.
    /// "flac 192000/24" — reveals a 24/192 copy vs a 16/44.1 one at a glance.
    pub formats: Vec<String>,
    /// Audio file names, so the UI can show what only ONE copy has (the guard
    /// against trashing away a hidden/bonus track).
    pub tracks: Vec<String>,
}

#[tauri::command]
fn audit_release_folder(app: tauri::AppHandle, release_id: i64) -> Result<FolderAudit, String> {
    let release = get_release(app, release_id)?
        .ok_or_else(|| format!("release {release_id} not found"))?;
    let dir = release.file_path.unwrap_or_default();
    let mut out = FolderAudit {
        dir: dir.clone(),
        exists: false,
        file_count: 0,
        total_bytes: 0,
        formats: Vec::new(),
        tracks: Vec::new(),
    };
    let p = PathBuf::from(&dir);
    if dir.trim().is_empty() || !p.is_dir() {
        return Ok(out);
    }
    out.exists = true;
    let mut files: Vec<PathBuf> = std::fs::read_dir(&p)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|q| q.is_file() && is_audio(q))
        .collect();
    files.sort();
    for f in &files {
        out.file_count += 1;
        out.total_bytes += std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        if let Some(n) = f.file_name().and_then(|n| n.to_str()) {
            out.tracks.push(n.to_owned());
        }
    }
    let info = read_dir_tags(&files);
    let fmt = build_format_string(&info);
    if !fmt.trim().is_empty() {
        out.formats.push(fmt);
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSummary {
    pub trashed_dir: String,
    pub files: usize,
    pub bytes: u64,
    /// True when the removed release had a live event that we retracted first.
    pub retracted: bool,
}

/// Resolve a duplicate: move the LOSING release's folder to the OS trash, drop
/// its row, and remember the path so a rescan cannot re-import it.
///
/// Deliberately conservative — every one of these is a refusal, not a warning:
///   • the folder must be inside the configured library root,
///   • it must exist and be a directory,
///   • it must not be the survivor's own folder,
///   • a live published event is retracted FIRST (aborting if no relay accepts),
///     so we never strand an naddr pointing at a release we deleted.
/// Files go to the desktop Trash (recoverable there); ndisc itself cannot undo it.
#[tauri::command]
async fn resolve_duplicate(
    app: tauri::AppHandle,
    keep_id: i64,
    trash_id: i64,
    relays: Vec<String>,
) -> Result<ResolveSummary, String> {
    if keep_id == trash_id {
        return Err("cannot resolve a release against itself".into());
    }
    let keep = get_release(app.clone(), keep_id)?
        .ok_or_else(|| format!("release {keep_id} not found"))?;
    let loser = get_release(app.clone(), trash_id)?
        .ok_or_else(|| format!("release {trash_id} not found"))?;

    let dir = loser.file_path.clone().unwrap_or_default();
    if dir.trim().is_empty() {
        return Err("that release has no folder on disk — nothing to trash".into());
    }
    let target = PathBuf::from(&dir)
        .canonicalize()
        .map_err(|e| format!("{dir}: {e}"))?;
    if !target.is_dir() {
        return Err(format!("not a directory: {}", target.display()));
    }
    // Never the copy being kept.
    if let Some(k) = keep.file_path.as_deref() {
        if let Ok(kp) = PathBuf::from(k).canonicalize() {
            if kp == target {
                return Err("both releases point at the SAME folder — nothing to trash".into());
            }
        }
    }
    // Never outside the library.
    let root = PathBuf::from(library_root(&app)?)
        .canonicalize()
        .map_err(|e| format!("library root: {e}"))?;
    if !target.starts_with(&root) {
        return Err(format!(
            "refused: {} is outside the library root {}",
            target.display(),
            root.display()
        ));
    }

    // Retract before deleting, so no naddr is left pointing at a dead release.
    let live = loser.last_published_naddr.is_some()
        || matches!(loser.publish_state.as_deref(), Some("published") | Some("stale"));
    let mut retracted = false;
    if live {
        let res = unpublish_release(app.clone(), trash_id, relays.clone()).await?;
        if res.accepted_by.is_empty() {
            return Err(format!(
                "aborted: could not retract that release's live event from any relay ({} rejected). Nothing was trashed.",
                res.rejected.len()
            ));
        }
        retracted = true;
    }

    // Measure before moving, so the summary is truthful.
    let mut files = 0usize;
    let mut bytes = 0u64;
    if let Ok(rd) = std::fs::read_dir(&target) {
        for e in rd.filter_map(|e| e.ok()) {
            if e.path().is_file() {
                files += 1;
                bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }

    let moved = target.clone();
    tauri::async_runtime::spawn_blocking(move || trash::delete(&moved))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("trash failed for {}: {e}", target.display()))?;

    let conn = open(&app)?;
    conn.execute("DELETE FROM releases WHERE id = ?1", params![trash_id])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO merged_paths (path, survivor_id, trashed)
         VALUES (?1, ?2, 1)",
        params![dir, keep_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(ResolveSummary {
        trashed_dir: dir,
        files,
        bytes,
        retracted,
    })
}

#[tauri::command]
async fn merge_releases(
    app: tauri::AppHandle,
    survivor_id: i64,
    loser_id: i64,
    relays: Vec<String>,
) -> Result<MergeSummary, String> {
    if survivor_id == loser_id {
        return Err("cannot merge a release with itself".into());
    }
    let survivor = get_release(app.clone(), survivor_id)?
        .ok_or_else(|| format!("survivor release {survivor_id} not found"))?;
    let loser = get_release(app.clone(), loser_id)?
        .ok_or_else(|| format!("loser release {loser_id} not found"))?;
    // Kept aside because the fold consumes it: if the loser had its OWN folder
    // that the survivor doesn't end up owning, that folder is left on disk with
    // no row — and the next library rescan re-imports it as a fresh release,
    // resurrecting the duplicate you just merged. Recorded below so it doesn't.
    let loser_dir = loser.file_path.clone();

    let mut folded: Vec<String> = Vec::new();
    let mut wire = false;
    // Descriptive + provenance (wire flag per release_event's tag set).
    let year = {
        let s = survivor.year.map(i64::from);
        let l = loser.year.map(i64::from);
        fold_i64(&mut folded, &mut wire, "year", true, s, l).map(|n| n as i32)
    };
    let format = fold_str(&mut folded, &mut wire, "format", true, survivor.format, loser.format);
    let label = fold_str(&mut folded, &mut wire, "label", true, survivor.label, loser.label);
    let catalog_number = fold_str(&mut folded, &mut wire, "catalog", true, survivor.catalog_number, loser.catalog_number);
    let country = fold_str(&mut folded, &mut wire, "country", true, survivor.country, loser.country);
    let condition = fold_str(&mut folded, &mut wire, "condition", true, survivor.condition, loser.condition);
    let notes = fold_str(&mut folded, &mut wire, "notes", true, survivor.notes, loser.notes);
    let source = fold_str(&mut folded, &mut wire, "source", true, survivor.source, loser.source);
    let cover_art_url = fold_str(&mut folded, &mut wire, "image", true, survivor.cover_art_url, loser.cover_art_url);
    let release_type = fold_str(&mut folded, &mut wire, "type", true, survivor.release_type, loser.release_type);
    let category = fold_str(&mut folded, &mut wire, "category", true, survivor.category, loser.category);
    let discogs_id = fold_i64(&mut folded, &mut wire, "discogs", true, survivor.discogs_id, loser.discogs_id);
    let track_total = fold_i64(&mut folded, &mut wire, "tracks", true, survivor.track_total, loser.track_total);
    let disc_total = fold_i64(&mut folded, &mut wire, "discs", true, survivor.disc_total, loser.disc_total);
    let video_count = fold_i64(&mut folded, &mut wire, "video", true, survivor.video_count, loser.video_count);
    // Local-only fields (wire = false — never force a re-publish).
    let file_path = fold_str(&mut folded, &mut wire, "file_path", false, survivor.file_path, loser.file_path);
    let bandcamp_id = fold_str(&mut folded, &mut wire, "bandcamp_id", false, survivor.bandcamp_id, loser.bandcamp_id);
    let cover_art_path = fold_str(&mut folded, &mut wire, "cover_art_path", false, survivor.cover_art_path, loser.cover_art_path);
    let source_label = fold_str(&mut folded, &mut wire, "source", false, survivor.source_label, loser.source_label);
    let track_count = fold_i64(&mut folded, &mut wire, "track_count", false, survivor.track_count, loser.track_count);
    // Genres move as a block only when the survivor has none (density/validity
    // are already enforced on each row, so copying all three slots is safe).
    let (gp, gs, gt) = if !str_nonempty(&survivor.genre_primary) && str_nonempty(&loser.genre_primary)
    {
        folded.push("genres".to_string());
        wire = true;
        (loser.genre_primary, loser.genre_secondary, loser.genre_tertiary)
    } else {
        (survivor.genre_primary, survivor.genre_secondary, survivor.genre_tertiary)
    };

    // Retract the loser's live event first (only when it actually has one), so a
    // delete never strands an naddr. Abort if no relay accepts the deletion.
    let loser_live = loser.last_published_naddr.is_some()
        || matches!(loser.publish_state.as_deref(), Some("published") | Some("stale"));
    let mut loser_retracted = false;
    if loser_live {
        let res = unpublish_release(app.clone(), loser_id, relays.clone()).await?;
        if res.accepted_by.is_empty() {
            return Err(format!(
                "aborted: could not retract the other release's live event from any relay ({} rejected). Nothing was merged.",
                res.rejected.len()
            ));
        }
        loser_retracted = true;
    }

    // Apply the fold, delete the loser, and (if needed) re-stale the survivor —
    // all in one transaction so a mid-way failure leaves both rows intact.
    let mut conn = open(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE releases SET
           year = ?2, format = ?3, label = ?4, catalog_number = ?5, country = ?6,
           condition = ?7, notes = ?8, source = ?9, cover_art_url = ?10,
           release_type = ?11, category = ?12, discogs_id = ?13, track_total = ?14,
           disc_total = ?15, video_count = ?16, file_path = ?17, bandcamp_id = ?18,
           cover_art_path = ?19, source_label = ?20, track_count = ?21,
           genre_primary = ?22, genre_secondary = ?23, genre_tertiary = ?24,
           updated_at = strftime('%s','now')
         WHERE id = ?1",
        params![
            survivor_id, year, format, label, catalog_number, country, condition,
            notes, source, cover_art_url, release_type, category, discogs_id,
            track_total, disc_total, video_count, file_path, bandcamp_id,
            cover_art_path, source_label, track_count, gp, gs, gt,
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM releases WHERE id = ?1", params![loser_id])
        .map_err(|e| e.to_string())?;

    // Remember a folder the merge orphaned (loser had one, survivor kept its
    // own), so import skips it instead of re-importing the duplicate. The files
    // are untouched — trashed=0; this only says "not its own release".
    if let Some(d) = loser_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        if Some(d) != file_path.as_deref() {
            tx.execute(
                "INSERT OR REPLACE INTO merged_paths (path, survivor_id, trashed)
                 VALUES (?1, ?2, 0)",
                params![d, survivor_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let survivor_marked_stale = wire && survivor.publish_state.as_deref() == Some("published");
    if survivor_marked_stale {
        tx.execute(
            "UPDATE releases
             SET last_published_at = NULL, last_published_naddr = NULL,
                 publish_state = 'stale'
             WHERE id = ?1",
            params![survivor_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(MergeSummary {
        survivor_id,
        folded_fields: folded,
        loser_retracted,
        survivor_marked_stale,
    })
}

// ---------------------------------------------------------------------------
// Feed notes — kind:31239 authoring (the `current` view publish side)
// ---------------------------------------------------------------------------
// Local drafts live in the `feed_notes` table; publishing emits a kind:31239
// event per schema/feed.v1.json (the SHARED wire contract glmps + ndisc.view
// read via lib/feed.ts resolveFeed). Signing goes through the keychain owner
// key, exactly like releases/reactions — the nsec never leaves the OS keychain.

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeedDraft {
    pub id: Option<i64>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub release_ref: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    pub topics: Vec<String>,
    pub published_at: Option<i64>,
    pub last_published_at: Option<i64>,
    pub last_published_event: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

fn feed_d_tag(note_id: i64) -> String {
    format!("glmps:{}", note_id)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn json_str_array(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn feed_row_to_draft(row: &rusqlite::Row) -> rusqlite::Result<FeedDraft> {
    let images: String = row.get("images")?;
    let links: String = row.get("links")?;
    let topics: String = row.get("topics")?;
    Ok(FeedDraft {
        id: row.get("id")?,
        title: row.get("title")?,
        body: row.get("body")?,
        release_ref: row.get("release_ref")?,
        images: json_str_array(&images),
        links: json_str_array(&links),
        topics: json_str_array(&topics),
        published_at: row.get("published_at")?,
        last_published_at: row.get("last_published_at")?,
        last_published_event: row.get("last_published_event")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const FEED_SELECT_COLS: &str =
    "id, title, body, release_ref, images, links, topics, published_at, \
     last_published_at, last_published_event, created_at, updated_at";

/// Build the kind:31239 feed-note event from a stored draft. Tag shape is
/// pinned to schema/feed.v1.json and the `schema_feed_v1` test.
fn feed_event(keys: &Keys, draft: &FeedDraft) -> Result<Event, String> {
    let id = draft.id.ok_or_else(|| "draft has no id".to_string())?;
    let mut tags: Vec<Tag> = Vec::new();
    push_tag(&mut tags, "d", &feed_d_tag(id))?;
    if let Some(t) = draft.title.as_deref() {
        push_tag(&mut tags, "title", t)?;
    }
    if let Some(a) = draft.release_ref.as_deref() {
        push_tag(&mut tags, "a", a)?;
    }
    let published_at = draft.published_at.unwrap_or_else(now_secs);
    push_tag(&mut tags, "published_at", &published_at.to_string())?;
    for url in &draft.images {
        push_tag(&mut tags, "image", url)?;
    }
    for url in &draft.links {
        push_tag(&mut tags, "r", url)?;
    }
    for t in &draft.topics {
        push_tag(&mut tags, "t", &t.to_lowercase())?;
    }
    // NIP-31 fallback so generic clients show something readable.
    let body = draft.body.clone().unwrap_or_default();
    let alt = draft
        .title
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| body.chars().take(80).collect());
    push_tag(&mut tags, "alt", &alt)?;

    EventBuilder::new(Kind::Custom(KIND_FEED), body)
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_feed_drafts(app: tauri::AppHandle) -> Result<Vec<FeedDraft>, String> {
    let conn = open(&app)?;
    let sql = format!(
        "SELECT {FEED_SELECT_COLS} FROM feed_notes ORDER BY updated_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], feed_row_to_draft)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Insert a new draft or update an existing one. Any edit to a previously
/// published draft clears its publish-state (last_published_at/_event → NULL)
/// so it surfaces as "needs republish" — the release mark_unpublished pattern.
#[tauri::command]
fn save_feed_draft(app: tauri::AppHandle, draft: FeedDraft) -> Result<i64, String> {
    let conn = open(&app)?;
    let images = serde_json::to_string(&draft.images).map_err(|e| e.to_string())?;
    let links = serde_json::to_string(&draft.links).map_err(|e| e.to_string())?;
    let topics = serde_json::to_string(&draft.topics).map_err(|e| e.to_string())?;
    match draft.id {
        Some(id) => {
            conn.execute(
                "UPDATE feed_notes
                 SET title = ?1, body = ?2, release_ref = ?3,
                     images = ?4, links = ?5, topics = ?6,
                     last_published_at = NULL, last_published_event = NULL,
                     updated_at = strftime('%s','now')
                 WHERE id = ?7",
                params![draft.title, draft.body, draft.release_ref, images, links, topics, id],
            )
            .map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO feed_notes (title, body, release_ref, images, links, topics)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![draft.title, draft.body, draft.release_ref, images, links, topics],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

/// Delete a draft locally. Does NOT touch relays — use `unpublish_feed_note`
/// first if the note is live and you want it gone from the network too.
#[tauri::command]
fn delete_feed_draft(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let conn = open(&app)?;
    conn.execute("DELETE FROM feed_notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn publish_feed_note(
    app: tauri::AppHandle,
    id: i64,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let mut draft: FeedDraft = {
        let conn = open(&app)?;
        let sql = format!("SELECT {FEED_SELECT_COLS} FROM feed_notes WHERE id = ?1");
        conn.query_row(&sql, params![id], feed_row_to_draft)
            .map_err(|e| e.to_string())?
    };
    // Stamp published_at on first publish; keep it stable across republishes.
    let published_at = draft.published_at.unwrap_or_else(now_secs);
    draft.published_at = Some(published_at);

    let event = feed_event(&keys, &draft)?;
    let event_id = event.id.to_string();
    let naddr = build_feed_naddr(&keys, &feed_d_tag(id), &relays).unwrap_or_default();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    if !accepted_by.is_empty() {
        let conn = open(&app)?;
        conn.execute(
            "UPDATE feed_notes
             SET published_at = ?1,
                 last_published_at = strftime('%s','now'),
                 last_published_event = ?2
             WHERE id = ?3",
            params![published_at, event_id, id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let first = rejected
            .first()
            .map(|r| format!("{}: {}", r.relay, r.error))
            .unwrap_or_else(|| "no relays accepted the event".to_string());
        return Err(format!("publish failed — {first}"));
    }

    Ok(PublishResult {
        event_id,
        naddr,
        accepted_by,
        rejected,
    })
}

/// NIP-09 delete of a published feed note (kind:5 referencing its address) +
/// clear local publish-state. The draft row stays for re-editing.
#[tauri::command]
async fn unpublish_feed_note(
    app: tauri::AppHandle,
    id: i64,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let address = format!(
        "{}:{}:{}",
        KIND_FEED,
        keys.public_key(),
        feed_d_tag(id)
    );
    let tag_a = Tag::parse(["a", &address]).map_err(|e| e.to_string())?;
    let tag_k = Tag::parse(["k", &KIND_FEED.to_string()]).map_err(|e| e.to_string())?;

    let event = EventBuilder::new(Kind::EventDeletion, "")
        .tags([tag_a, tag_k])
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;
    let event_id = event.id.to_string();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    if !accepted_by.is_empty() {
        let conn = open(&app)?;
        conn.execute(
            "UPDATE feed_notes
             SET last_published_at = NULL, last_published_event = NULL
             WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

fn build_feed_naddr(keys: &Keys, d: &str, relays: &[String]) -> Result<String, String> {
    let relay_hints: Vec<RelayUrl> = relays
        .iter()
        .take(3)
        .filter_map(|r| RelayUrl::parse(r).ok())
        .collect();
    let coordinate = Coordinate::new(Kind::Custom(KIND_FEED), keys.public_key())
        .identifier(d.to_string());
    let nip19 = Nip19Coordinate::new(coordinate, relay_hints);
    nip19.to_bech32().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Contributor curation — registry (kind:30000) + sign-off (kind:4550)
// ---------------------------------------------------------------------------
// The owner curates a small feed: a NIP-51 people set names who may contribute,
// and a NIP-72 approval blesses each contributor note. Both are owner-signed
// (the keychain key, asserted by `load_nsec`) — the trust gate in lib/feed.ts
// keys every check on this pubkey. Mirrors the prototype registry.mjs /
// approve.mjs. The published wire form is pinned by schema/feed.v1.json.

const REGISTRY_D_TAG: &str = "glmps:contributors";

/// Accept an npub or 64-char hex pubkey, return canonical lowercase hex.
fn to_hex_pubkey(s: &str) -> Result<String, String> {
    let s = s.trim();
    let pk = if s.starts_with("npub1") {
        PublicKey::from_bech32(s).map_err(|e| e.to_string())?
    } else {
        PublicKey::from_hex(s).map_err(|e| e.to_string())?
    };
    Ok(pk.to_hex())
}

/// Build the kind:30000 contributor-registry event from already-hex pubkeys.
/// Tag shape pinned to schema/feed.v1.json (`contributor_registry`).
fn registry_event(keys: &Keys, contributor_hexes: &[String]) -> Result<Event, String> {
    let mut tags: Vec<Tag> = vec![
        Tag::parse(["d", REGISTRY_D_TAG]).map_err(|e| e.to_string())?,
        Tag::parse(["title", "glmps contributors"]).map_err(|e| e.to_string())?,
    ];
    for hex in contributor_hexes {
        tags.push(Tag::parse(["p", hex]).map_err(|e| e.to_string())?);
    }
    EventBuilder::new(Kind::Custom(KIND_REGISTRY), "")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())
}

/// Build the kind:4550 sign-off event for a contributor note. Tag shape pinned
/// to schema/feed.v1.json (`approval`).
fn approval_event(
    keys: &Keys,
    note_address: &str,
    note_event_id: &str,
    author_hex: &str,
) -> Result<Event, String> {
    let tags = vec![
        Tag::parse(["a", note_address]).map_err(|e| e.to_string())?,
        Tag::parse(["e", note_event_id]).map_err(|e| e.to_string())?,
        Tag::parse(["p", author_hex]).map_err(|e| e.to_string())?,
        Tag::parse(["k", &KIND_FEED.to_string()]).map_err(|e| e.to_string())?,
    ];
    EventBuilder::new(Kind::Custom(KIND_APPROVAL), "")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())
}

/// Publish (replace) the contributor registry — a NIP-51 kind:30000 people set,
/// `d=glmps:contributors`, one `p` tag per allowed contributor. Replaceable:
/// each call carries the FULL list; an empty list removes all contributors.
#[tauri::command]
async fn publish_registry(
    contributors: Vec<String>,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    // Normalise to hex + dedupe, preserving order.
    let mut seen: HashSet<String> = HashSet::new();
    let mut hexes: Vec<String> = Vec::new();
    for c in &contributors {
        if c.trim().is_empty() {
            continue;
        }
        let hex = to_hex_pubkey(c)?;
        if seen.insert(hex.clone()) {
            hexes.push(hex);
        }
    }

    let event = registry_event(&keys, &hexes)?;
    let event_id = event.id.to_string();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);
    if accepted_by.is_empty() {
        let first = rejected
            .first()
            .map(|r| format!("{}: {}", r.relay, r.error))
            .unwrap_or_else(|| "no relays accepted the event".to_string());
        return Err(format!("publish failed — {first}"));
    }

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

/// Owner sign-off on a contributor feed note — a NIP-72 kind:4550 approval
/// carrying `a` (note address), `e` (note event id), `p` (author), `k`=31239.
#[tauri::command]
async fn approve_feed_note(
    note_address: String,
    note_event_id: String,
    author_pubkey: String,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;
    let author_hex = to_hex_pubkey(&author_pubkey)?;
    let event = approval_event(&keys, &note_address, &note_event_id, &author_hex)?;
    let event_id = event.id.to_string();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);
    if accepted_by.is_empty() {
        let first = rejected
            .first()
            .map(|r| format!("{}: {}", r.relay, r.error))
            .unwrap_or_else(|| "no relays accepted the event".to_string());
        return Err(format!("publish failed — {first}"));
    }

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

/// Revoke an approval — NIP-09 kind:5 referencing the kind:4550 event id.
#[tauri::command]
async fn revoke_approval(
    approval_event_id: String,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let tags = vec![
        Tag::parse(["e", &approval_event_id]).map_err(|e| e.to_string())?,
        Tag::parse(["k", &KIND_APPROVAL.to_string()]).map_err(|e| e.to_string())?,
    ];

    let event = EventBuilder::new(Kind::EventDeletion, "")
        .tags(tags)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;
    let event_id = event.id.to_string();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

/// Inbound shape for `publish_labels`. Carries the per-label image URL
/// the frontend already has (from `localStorage["ndisc.labels"]`).
/// Entries with an empty `name` or `image_url` are dropped at the Rust
/// boundary so the published manifest only contains real entries.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelInput {
    name: String,
    image_url: String,
}

/// Publish the labels.v1 manifest (kind:31238) so consumers (glmps web
/// viewers) can render record-label images on release detail pages.
/// d-tag is fixed at `disco-vault:labels` (one event per author —
/// republishing replaces). Content schema is locked at `labels.v1`.
/// See `schema/labels.v1.json`.
#[tauri::command]
async fn publish_labels(
    labels: Vec<LabelInput>,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let mut labels_obj = serde_json::Map::new();
    for entry in labels {
        let name = entry.name.trim();
        let url = entry.image_url.trim();
        if name.is_empty() || url.is_empty() {
            continue;
        }
        let mut value = serde_json::Map::new();
        value.insert("image".to_string(), serde_json::Value::String(url.to_string()));
        labels_obj.insert(name.to_string(), serde_json::Value::Object(value));
    }

    let content = serde_json::json!({
        "schemaVersion": "labels.v1",
        "labels": labels_obj,
    });
    let content_str = serde_json::to_string(&content).map_err(|e| e.to_string())?;

    let tags = vec![
        Tag::parse(["d", LABELS_D_TAG]).map_err(|e| e.to_string())?,
        Tag::parse(["alt", LABELS_ALT]).map_err(|e| e.to_string())?,
    ];

    let event = EventBuilder::new(Kind::Custom(KIND_LABELS), &content_str)
        .tags(tags)
        .sign_with_keys(&keys)
        .map_err(|e| e.to_string())?;
    let event_id = event.id.to_string();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    if accepted_by.is_empty() {
        let first = rejected
            .first()
            .map(|r| format!("{}: {}", r.relay, r.error))
            .unwrap_or_else(|| "no relays accepted the event".to_string());
        return Err(format!("publish failed — {first}"));
    }

    Ok(PublishResult {
        event_id,
        naddr: String::new(),
        accepted_by,
        rejected,
    })
}

#[tauri::command]
async fn publish_release(
    app: tauri::AppHandle,
    release_id: i64,
    relays: Vec<String>,
) -> Result<PublishResult, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let release: Release = {
        let conn = open(&app)?;
        let sql = format!(
            "SELECT {} FROM releases WHERE id = ?1",
            RELEASE_SELECT_COLS
        );
        conn.query_row(&sql, params![release_id], row_to_release)
            .map_err(|e| e.to_string())?
    };

    let event = release_event(&keys, &release)?;
    let event_id = event.id.to_string();
    let naddr = build_naddr(&keys, &release_d_tag(release_id), &relays).unwrap_or_default();

    let client = build_client(keys, &relays).await;
    let send_result = client.send_event(&event).await;
    let _ = client.shutdown().await;

    let output = send_result.map_err(|e| e.to_string())?;
    let (accepted_by, rejected) = split_send_output(&output);

    // Persist publish state if at least one relay accepted. Mixed-result is
    // still "published" — the event exists on the network from then on.
    if !accepted_by.is_empty() {
        let conn = open(&app)?;
        conn.execute(
            "UPDATE releases
             SET last_published_at = strftime('%s','now'),
                 last_published_naddr = ?1,
                 last_published_event_id = ?2,
                 publish_state = 'published'
             WHERE id = ?3",
            params![naddr, event_id, release_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(PublishResult {
        event_id,
        naddr,
        accepted_by,
        rejected,
    })
}

#[tauri::command]
async fn publish_ids(
    app: tauri::AppHandle,
    ids: Vec<i64>,
    relays: Vec<String>,
) -> Result<PublishLibrarySummary, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    // Resolve the explicit id set to rows in the given order. This is the ONLY
    // bulk publish path — the caller passes exactly the ids on screen, so the
    // operation can never drift from what the user sees (no filter re-derived
    // on the backend). Ids that vanished between resolve and send are skipped.
    let releases = resolve_release_ids(&app, &ids)?;

    let total = releases.len();
    let _ = app.emit("publish:started", total);
    let client = build_client(keys.clone(), &relays).await;

    let mut summary = PublishLibrarySummary {
        total,
        published: 0,
        skipped: 0,
        failed: 0,
    };

    for (i, r) in releases.iter().enumerate() {
        let event = match release_event(&keys, r) {
            Ok(e) => e,
            Err(_) => {
                summary.failed += 1;
                emit_publish_progress(&app, i + 1, total, r, vec![], one_error("could not build event"));
                continue;
            }
        };
        match client.send_event(&event).await {
            Ok(output) => {
                let (accepted_by, rejected) = split_send_output(&output);
                if !accepted_by.is_empty() {
                    summary.published += 1;
                    if let Some(id) = r.id {
                        let naddr = build_naddr(&keys, &release_d_tag(id), &relays)
                            .unwrap_or_default();
                        let conn = open(&app)?;
                        let _ = conn.execute(
                            "UPDATE releases
                             SET last_published_at = strftime('%s','now'),
                                 last_published_naddr = ?1,
                                 last_published_event_id = ?2,
                                 publish_state = 'published'
                             WHERE id = ?3",
                            params![naddr, event.id.to_string(), id],
                        );
                    }
                } else {
                    summary.failed += 1;
                }
                emit_publish_progress(&app, i + 1, total, r, accepted_by, rejected);
            }
            Err(e) => {
                summary.failed += 1;
                emit_publish_progress(&app, i + 1, total, r, vec![], one_error(&e.to_string()));
            }
        }
        // Be polite to relays — don't hammer.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let _ = client.shutdown().await;
    Ok(summary)
}

#[tauri::command]
async fn unpublish_ids(
    app: tauri::AppHandle,
    ids: Vec<i64>,
    relays: Vec<String>,
) -> Result<PublishLibrarySummary, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;
    let releases = resolve_release_ids(&app, &ids)?;

    let total = releases.len();
    let _ = app.emit("publish:started", total);
    let client = build_client(keys.clone(), &relays).await;

    let mut summary = PublishLibrarySummary {
        total,
        published: 0,
        skipped: 0,
        failed: 0,
    };

    for (i, r) in releases.iter().enumerate() {
        // Only a live event can be retracted. never / retracted rows have
        // nothing on relays, so a kind:5 would be noise — skip them and don't
        // mislabel their state.
        let state = r.publish_state.as_deref().unwrap_or("never");
        if state != "published" && state != "stale" {
            summary.skipped += 1;
            emit_publish_progress(&app, i + 1, total, r, vec![], vec![]);
            continue;
        }

        let build = || -> Result<Event, String> {
            let id = r.id.ok_or_else(|| "release has no id".to_string())?;
            let known: Vec<String> =
                r.last_published_event_id.clone().into_iter().collect();
            release_delete_event(&keys, id, &known)
        };
        let event = match build() {
            Ok(e) => e,
            Err(err) => {
                summary.failed += 1;
                emit_publish_progress(&app, i + 1, total, r, vec![], one_error(&err));
                continue;
            }
        };

        match client.send_event(&event).await {
            Ok(output) => {
                let (accepted_by, rejected) = split_send_output(&output);
                if !accepted_by.is_empty() {
                    summary.published += 1;
                    if let Some(id) = r.id {
                        let conn = open(&app)?;
                        let _ = conn.execute(
                            "UPDATE releases
                             SET last_published_at = NULL, last_published_naddr = NULL,
                                 last_published_event_id = NULL,
                                 publish_state = 'retracted'
                             WHERE id = ?1",
                            params![id],
                        );
                    }
                } else {
                    summary.failed += 1;
                }
                emit_publish_progress(&app, i + 1, total, r, accepted_by, rejected);
            }
            Err(e) => {
                summary.failed += 1;
                emit_publish_progress(&app, i + 1, total, r, vec![], one_error(&e.to_string()));
            }
        }
        // Be polite to relays — don't hammer.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let _ = client.shutdown().await;
    Ok(summary)
}

/// Fetch the given release ids in order, skipping any that no longer exist.
/// Shared by the by-id bulk publish/unpublish paths.
fn resolve_release_ids(app: &tauri::AppHandle, ids: &[i64]) -> Result<Vec<Release>, String> {
    let conn = open(app)?;
    let sql = format!("SELECT {} FROM releases WHERE id = ?1", RELEASE_SELECT_COLS);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Ok(r) = stmt.query_row(params![id], row_to_release) {
            out.push(r);
        }
    }
    Ok(out)
}

/// One-line RelayError helper for the "*"-relay (whole-op) failure case.
fn one_error(msg: &str) -> Vec<RelayError> {
    vec![RelayError {
        relay: "*".into(),
        error: msg.to_string(),
    }]
}

/// Emit a `publish:progress` tick. Shared by publish_ids / unpublish_ids so the
/// frontend progress UI is identical for both.
fn emit_publish_progress(
    app: &tauri::AppHandle,
    current: usize,
    total: usize,
    r: &Release,
    accepted_by: Vec<String>,
    rejected: Vec<RelayError>,
) {
    let _ = app.emit(
        "publish:progress",
        PublishProgress {
            current,
            total,
            title: r.title.clone(),
            artist: r.artist.clone(),
            accepted_by,
            rejected,
        },
    );
}

// Backfill local publish state from what relays already hold. Read-only on the
// relay side: no events are signed or sent. For each kind:31237 event authored
// by our key, the `d` tag maps back to a local release id; releases that have
// no publish markers get them written from the event's own created_at.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrphanEvent {
    pub id: i64,
    pub artist: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileSummary {
    pub events_found: usize,
    pub matched: usize,
    pub updated: usize,
    pub already_marked: usize,
    pub unmatched: usize,
    // Relay events whose d-tag maps to no local release — typically left
    // behind when the DB was rebuilt and release ids shifted.
    pub orphans: Vec<OrphanEvent>,
}

// First value of a named tag on an event, e.g. tag_value(ev, "artist").
fn tag_value<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    event.tags.iter().find_map(|t| {
        let s = t.as_slice();
        if s.len() >= 2 && s[0] == name {
            Some(s[1].as_str())
        } else {
            None
        }
    })
}

#[tauri::command]
async fn reconcile_published(
    app: tauri::AppHandle,
    relays: Vec<String>,
) -> Result<ReconcileSummary, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;
    let pubkey = keys.public_key();

    let client = build_client(keys.clone(), &relays).await;
    // Fetch release events and our own deletions together — a non-compliant
    // relay may still serve a release we have already deleted, so we need the
    // kind:5 events to filter those back out (NIP-09).
    let filter = Filter::new()
        .author(pubkey)
        .kinds([Kind::Custom(KIND_RELEASE), Kind::EventDeletion]);
    let fetch = client.fetch_events(filter, Duration::from_secs(10)).await;
    let _ = client.shutdown().await;
    let events = fetch.map_err(|e| e.to_string())?;

    // Release id -> timestamp of the newest kind:5 targeting it, parsed from
    // `a` tags of the form "<kind>:<pubkey>:disco-vault:<id>".
    let mut deleted: HashMap<i64, u64> = HashMap::new();
    for event in events.iter() {
        if event.kind != Kind::EventDeletion {
            continue;
        }
        for tag in event.tags.iter() {
            let s = tag.as_slice();
            if s.len() >= 2 && s[0] == "a" {
                if let Some(d) = s[1].splitn(3, ':').nth(2) {
                    if let Some(id_str) = d.strip_prefix("disco-vault:") {
                        if let Ok(id) = id_str.parse::<i64>() {
                            // Keep the NEWEST deletion per id. A deletion only
                            // kills events created at or before it — a release
                            // retracted and then published again is live, not
                            // deleted. Recording a bare id here (ignoring when
                            // it was deleted) made every id that had ever been
                            // unpublished look permanently dead, which after a
                            // bulk unpublish/republish cycle is the whole
                            // library.
                            let at = event.created_at.as_u64();
                            deleted
                                .entry(id)
                                .and_modify(|t| *t = (*t).max(at))
                                .or_insert(at);
                        }
                    }
                }
            }
        }
    }

    // Newest release event per id, skipping any the user has deleted.
    // Replaceable events should be unique per d-tag, but relays can briefly
    // carry stale copies — hence keeping the newest created_at wins.
    let mut latest: HashMap<i64, &Event> = HashMap::new();
    for event in events.iter() {
        if event.kind != Kind::Custom(KIND_RELEASE) {
            continue;
        }
        let Some(d) = event.tags.identifier() else {
            continue;
        };
        let Some(id_str) = d.strip_prefix("disco-vault:") else {
            continue;
        };
        let Ok(id) = id_str.parse::<i64>() else {
            continue;
        };
        if deleted
            .get(&id)
            .is_some_and(|&at| event.created_at.as_u64() <= at)
        {
            continue;
        }
        latest
            .entry(id)
            .and_modify(|e| {
                if event.created_at > e.created_at {
                    *e = event;
                }
            })
            .or_insert(event);
    }

    let mut summary = ReconcileSummary {
        events_found: latest.len(),
        matched: 0,
        updated: 0,
        already_marked: 0,
        unmatched: 0,
        orphans: Vec::new(),
    };

    let conn = open(&app)?;
    for (id, event) in latest {
        let existing: Option<Option<i64>> = conn
            .query_row(
                "SELECT last_published_at FROM releases WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match existing {
            None => {
                summary.unmatched += 1;
                summary.orphans.push(OrphanEvent {
                    id,
                    artist: tag_value(event, "artist").unwrap_or("").to_string(),
                    title: tag_value(event, "title").unwrap_or("").to_string(),
                });
            }
            Some(Some(_)) => {
                summary.matched += 1;
                summary.already_marked += 1;
                // Already marked published — but still adopt the event id the
                // relay is serving. Rows published before that column existed
                // have none, and without it their deletion can only carry an
                // `a` tag, which relays like nostr-rs-relay ignore outright.
                // This is the backfill path that makes those rows retractable.
                conn.execute(
                    "UPDATE releases SET last_published_event_id = ?1
                      WHERE id = ?2
                        AND (last_published_event_id IS NULL
                             OR last_published_event_id <> ?1)",
                    params![event.id.to_string(), id],
                )
                .map_err(|e| e.to_string())?;
            }
            Some(None) => {
                summary.matched += 1;
                let naddr = build_naddr(&keys, &release_d_tag(id), &relays)
                    .unwrap_or_default();
                conn.execute(
                    "UPDATE releases
                     SET last_published_at = ?1, last_published_naddr = ?2,
                         last_published_event_id = ?3,
                         publish_state = 'published'
                     WHERE id = ?4",
                    params![
                        event.created_at.as_u64() as i64,
                        naddr,
                        event.id.to_string(),
                        id
                    ],
                )
                .map_err(|e| e.to_string())?;
                summary.updated += 1;
            }
        }
    }

    summary.orphans.sort_by_key(|o| o.id);
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Relay reconciliation — what each relay actually serves, vs what we think
// ---------------------------------------------------------------------------
//
// reconcile_published (above) is the INBOUND direction: relays are the truth,
// local publish markers get backfilled from them. This is the OUTBOUND audit:
// the DB is the truth, and we ask each relay what it is still serving in our
// name. They diverge for two reasons that no amount of local bookkeeping can
// see:
//
//   * ghosts  — a release we retracted (or never published) that a relay still
//     serves, because it ignored our kind:5. relay.fizx.uk runs nostr-rs-relay,
//     which only honours deletion by `e` tag; every `a`-only deletion we ever
//     sent it was stored and never applied.
//   * orphans — an event whose d-tag points at a release id that no longer
//     exists locally (the DB was rebuilt and ids shifted). Nothing in the DB
//     can ever drive a deletion for these, so they are immortal until swept.
//
// Both are only discoverable by asking the relay, and both are fixable only by
// naming the live event id — which is why the audit collects them.

/// One relay's answer, and how it lines up with the DB.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayAuditRow {
    pub relay: String,
    /// Distinct release coordinates this relay is serving for us.
    pub live: usize,
    /// Live, and the DB agrees it should be (publish_state = 'published').
    pub ok: usize,
    /// Live and expected, but the relay's copy predates our last publish.
    pub stale: usize,
    /// Live, but the DB says this release is not published. Should not exist.
    pub ghosts: Vec<i64>,
    /// Live, but there is no local release with this id at all.
    pub orphans: Vec<i64>,
    /// The DB says published, but this relay is not serving it.
    pub missing: Vec<i64>,
    /// kind:5 deletions this relay is holding for us (stored ≠ applied).
    pub deletions: usize,
    /// Set when the relay could not be reached; the counts are then meaningless.
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayAudit {
    pub rows: Vec<RelayAuditRow>,
    /// Union across relays of everything that should not be live anywhere —
    /// the exact id set the purge acts on.
    pub purgeable: Vec<i64>,
    /// Union across relays of releases the DB calls published but that some
    /// relay is not serving. Re-publishing fixes them.
    pub missing: Vec<i64>,
    pub db_total: usize,
    pub db_published: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeSummary {
    pub total: usize,
    pub purged: usize,
    pub failed: usize,
    /// Ids that turned out to be legitimately published and were left alone.
    pub skipped: usize,
    pub errors: Vec<RelayError>,
}

/// Every event of the given kinds that a single relay holds for `pubkey`.
///
/// Pages backwards through `until` rather than issuing one unbounded REQ:
/// relays cap a single response (nostr-rs-relay at 500), so a naive fetch of a
/// 2,600-event library silently returns a fifth of it and every diff computed
/// from it is wrong. Stops when a page adds nothing new.
async fn fetch_all_from_relay(
    relay: &str,
    keys: &Keys,
    kinds: Vec<Kind>,
) -> Result<Vec<Event>, String> {
    let client = Client::builder().signer(keys.clone()).build();
    client
        .add_relay(relay)
        .await
        .map_err(|e| e.to_string())?;

    // try_connect_relay, NOT connect(): connect() returns immediately and the
    // socket comes up in the background, so the first REQ could fire before the
    // relay was reachable and come back empty. That empty page then looked like
    // "this relay serves nothing" — a healthy relay holding 1,732 events was
    // reported as `serving 0`, and every release on it as `absent`. A relay we
    // cannot reach must be an error, never an empty result.
    client
        .try_connect_relay(relay, Duration::from_secs(15))
        .await
        .map_err(|e| e.to_string())?;

    let pubkey = keys.public_key();

    let mut all: HashMap<EventId, Event> = HashMap::new();
    let mut until: Option<Timestamp> = None;

    // 40 pages x 500 = 20k events, far above any realistic library; the loop
    // is bounded so a misbehaving relay can't spin us forever.
    for _ in 0..40 {
        let mut filter = Filter::new()
            .author(pubkey)
            .kinds(kinds.clone())
            .limit(500);
        if let Some(u) = until {
            filter = filter.until(u);
        }
        let page = client
            .fetch_events(filter, Duration::from_secs(30))
            .await
            .map_err(|e| e.to_string())?;

        let before = all.len();
        let mut oldest: Option<u64> = None;
        for event in page.into_iter() {
            let at = event.created_at.as_u64();
            oldest = Some(oldest.map_or(at, |o: u64| o.min(at)));
            all.insert(event.id, event);
        }
        // No new events on this page — either the relay is dry, or it keeps
        // returning the same boundary batch. Either way, done.
        if all.len() == before {
            break;
        }
        let Some(o) = oldest else { break };
        // Step to `oldest` INCLUSIVE, not oldest - 1. A bulk publish stamps
        // hundreds of events with the same created_at, so a page boundary can
        // fall in the middle of one second; excluding that second drops every
        // event in it that didn't fit on the page. Overlap is free — events are
        // deduped by id — whereas a gap is silent and corrupts the diff.
        until = Some(Timestamp::from(o));
    }

    let _ = client.shutdown().await;
    Ok(all.into_values().collect())
}

/// Release id from a "disco-vault:<id>" d-tag.
fn release_id_from_d(d: &str) -> Option<i64> {
    d.strip_prefix("disco-vault:")?.parse::<i64>().ok()
}

/// Ask every configured relay what it is serving for us, and diff it against
/// the DB. Read-only: signs and sends nothing.
#[tauri::command]
async fn audit_relays(
    app: tauri::AppHandle,
    relays: Vec<String>,
) -> Result<RelayAudit, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    // Local truth: id -> (publish_state, last_published_at, last_published_event_id).
    let (db_state, db_total, db_published) = {
        let conn = open(&app)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, publish_state, last_published_at, last_published_event_id
                   FROM releases",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut map: HashMap<i64, (String, Option<i64>, Option<String>)> = HashMap::new();
        for row in rows {
            let (id, state, at, event_id) = row.map_err(|e| e.to_string())?;
            map.insert(id, (state.unwrap_or_else(|| "never".into()), at, event_id));
        }
        let published = map.values().filter(|(s, _, _)| s == "published").count();
        let total = map.len();
        (map, total, published)
    };

    let mut rows: Vec<RelayAuditRow> = Vec::new();
    let mut purgeable: HashSet<i64> = HashSet::new();
    // Ids for which at least one relay serves an event that is NOT older than
    // our last publish — i.e. somebody out there has the current version.
    //
    // This is the only thing that decides whether a release needs re-publishing.
    // A reader unions its relays and keeps the newest event per coordinate
    // (NIP-01 replaceable), so one relay holding a stale copy is harmless as
    // long as another holds the current one — the newer event wins. Counting a
    // release as "needs work" because SOME relay lags would flag the whole
    // library the moment one under-populated relay (primal) is in the list.
    let mut current_anywhere: HashSet<i64> = HashSet::new();

    for relay in &relays {
        let events = match fetch_all_from_relay(
            relay,
            &keys,
            vec![Kind::Custom(KIND_RELEASE), Kind::EventDeletion],
        )
        .await
        {
            Ok(e) => e,
            Err(err) => {
                rows.push(RelayAuditRow {
                    relay: relay.clone(),
                    live: 0,
                    ok: 0,
                    stale: 0,
                    ghosts: Vec::new(),
                    orphans: Vec::new(),
                    missing: Vec::new(),
                    deletions: 0,
                    error: Some(err),
                });
                continue;
            }
        };

        let deletions = events
            .iter()
            .filter(|e| e.kind == Kind::EventDeletion)
            .count();

        // Newest release event per id — what this relay would actually serve.
        let mut latest: HashMap<i64, &Event> = HashMap::new();
        for event in events.iter() {
            if event.kind != Kind::Custom(KIND_RELEASE) {
                continue;
            }
            let Some(id) = event.tags.identifier().and_then(release_id_from_d) else {
                continue;
            };
            latest
                .entry(id)
                .and_modify(|e| {
                    if event.created_at > e.created_at {
                        *e = event;
                    }
                })
                .or_insert(event);
        }

        let mut row = RelayAuditRow {
            relay: relay.clone(),
            live: latest.len(),
            ok: 0,
            stale: 0,
            ghosts: Vec::new(),
            orphans: Vec::new(),
            missing: Vec::new(),
            deletions,
            error: None,
        };

        for (id, event) in latest.iter() {
            match db_state.get(id) {
                None => {
                    row.orphans.push(*id);
                    purgeable.insert(*id);
                }
                Some((state, at, event_id)) if state == "published" => {
                    // Identity, not timestamps: if the relay is serving the very
                    // event id we last published, it is current — no clock
                    // comparison can be more authoritative than that.
                    //
                    // Comparing created_at against last_published_at is what a
                    // previous version did, and it produced phantom staleness:
                    // the event is signed, send_event then waits on the relays,
                    // and only afterwards is the DB stamped — so a slow relay
                    // opens a gap of seconds between the two. Any fixed
                    // tolerance is a guess about relay latency.
                    let current = match (event_id, at) {
                        (Some(known), _) => event.id.to_string() == *known,
                        // Rows published before last_published_event_id existed
                        // have no id to match on. Fall back to timestamps, with
                        // a tolerance generous enough to survive a slow publish.
                        (None, Some(t)) => {
                            (event.created_at.as_u64() as i64) >= t - 300
                        }
                        (None, None) => false,
                    };
                    if current {
                        row.ok += 1;
                        current_anywhere.insert(*id);
                    } else {
                        row.stale += 1;
                    }
                }
                Some((state, _, _)) if state == "stale" => {
                    // Edited since publishing, so by definition NO relay can
                    // hold the current version — we never sent it. (The stored
                    // event id still matches what is live, which is exactly why
                    // this cannot be decided by id-matching alone.) Always needs
                    // a re-publish; never a purge — the live event is real and
                    // intentional, just out of date.
                    row.stale += 1;
                }
                Some(_) => {
                    // never / retracted locally, yet still being served: the
                    // relay is publishing something we did not ask it to.
                    row.ghosts.push(*id);
                    purgeable.insert(*id);
                }
            }
        }

        // Per-relay gaps, reported honestly in this relay's row — a relay that
        // holds only a slice of the library shows it here. This does NOT feed
        // the re-publish set (see live_anywhere).
        for (id, (state, _, _)) in db_state.iter() {
            if (state == "published" || state == "stale") && !latest.contains_key(id) {
                row.missing.push(*id);
            }
        }

        row.ghosts.sort_unstable();
        row.orphans.sort_unstable();
        row.missing.sort_unstable();
        rows.push(row);
    }

    let mut purgeable: Vec<i64> = purgeable.into_iter().collect();
    purgeable.sort_unstable();

    // The re-publish set: releases we call published or stale for which NO relay
    // holds the current event — either nothing serves them at all, or every copy
    // out there is out of date. Those, and only those, are actually broken.
    //
    // Deliberately NOT "missing from some relay" or "stale on some relay": with
    // an under-populated relay in the list (primal holds 34 of 1,731) either of
    // those would offer to re-publish almost the whole library, which is a
    // redundancy choice, not a repair. Readers union their relays and take the
    // newest event, so one lagging relay changes nothing they see.
    let mut missing: Vec<i64> = db_state
        .iter()
        .filter(|(id, (state, _, _))| {
            (state == "published" || state == "stale") && !current_anywhere.contains(id)
        })
        .map(|(id, _)| *id)
        .collect();
    missing.sort_unstable();

    Ok(RelayAudit {
        rows,
        purgeable,
        missing,
        db_total,
        db_published,
    })
}

/// Retract stray events (ghosts + orphans) from the relays.
///
/// Re-fetches the live events itself rather than trusting ids passed in from an
/// older audit, because the deletion must name the event id it is killing and
/// that id can only come from the relay. Every id is re-checked against the DB
/// first: anything that is legitimately published is skipped, so a stale UI can
/// never talk this into deleting live releases.
#[tauri::command]
async fn purge_relay_events(
    app: tauri::AppHandle,
    ids: Vec<i64>,
    relays: Vec<String>,
) -> Result<PurgeSummary, String> {
    if relays.is_empty() {
        return Err("no relays configured".into());
    }
    if ids.is_empty() {
        return Err("nothing to purge".into());
    }
    let nsec = load_nsec()?.ok_or_else(|| "no Nostr identity stored".to_string())?;
    let keys = keys_from_nsec(&nsec)?;

    let wanted: HashSet<i64> = ids.iter().copied().collect();

    // Collect every event id each coordinate is currently served under, across
    // all relays. A coordinate can carry different event ids on different
    // relays (a re-publish one relay took and another missed), and NIP-09
    // deletion by `e` names one specific event — so tag them all.
    let mut event_ids: HashMap<i64, HashSet<String>> = HashMap::new();
    for relay in &relays {
        let events =
            fetch_all_from_relay(relay, &keys, vec![Kind::Custom(KIND_RELEASE)]).await;
        let Ok(events) = events else { continue };
        for event in events {
            let Some(id) = event.tags.identifier().and_then(release_id_from_d) else {
                continue;
            };
            if wanted.contains(&id) {
                event_ids
                    .entry(id)
                    .or_default()
                    .insert(event.id.to_string());
            }
        }
    }

    // Belt and braces: never retract something the DB still calls live. 'stale'
    // counts as live — it means published-then-edited, so the event on the
    // relay is intentional and merely out of date; retracting it would silently
    // pull a release the user still wants public.
    let published: HashSet<i64> = {
        let conn = open(&app)?;
        let mut stmt = conn
            .prepare(
                "SELECT id FROM releases
                  WHERE publish_state IN ('published','stale')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        let mut set = HashSet::new();
        for row in rows {
            set.insert(row.map_err(|e| e.to_string())?);
        }
        set
    };

    let total = ids.len();
    let _ = app.emit("purge:started", total);
    let client = build_client(keys.clone(), &relays).await;

    let mut summary = PurgeSummary {
        total,
        purged: 0,
        failed: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    for (i, id) in ids.iter().enumerate() {
        let _ = app.emit(
            "purge:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: format!("disco-vault:{id}"),
            },
        );

        if published.contains(id) {
            summary.skipped += 1;
            continue;
        }

        let known: Vec<String> = event_ids
            .get(id)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();

        let event = match release_delete_event(&keys, *id, &known) {
            Ok(e) => e,
            Err(err) => {
                summary.failed += 1;
                summary.errors.push(RelayError {
                    relay: format!("disco-vault:{id}"),
                    error: err,
                });
                continue;
            }
        };

        match client.send_event(&event).await {
            Ok(output) => {
                let (accepted_by, rejected) = split_send_output(&output);
                if accepted_by.is_empty() {
                    summary.failed += 1;
                    summary.errors.extend(rejected);
                } else {
                    summary.purged += 1;
                    // Ghosts with a local row: their state is already never or
                    // retracted (that is what made them ghosts), so there is
                    // nothing to update. Orphans have no row at all. Just make
                    // sure no stale publish marker survives.
                    let conn = open(&app)?;
                    let _ = conn.execute(
                        "UPDATE releases
                         SET last_published_at = NULL, last_published_naddr = NULL,
                             last_published_event_id = NULL,
                             publish_state = CASE
                                 WHEN publish_state IN ('published','stale')
                                 THEN 'retracted' ELSE publish_state END
                         WHERE id = ?1",
                        params![id],
                    );
                }
            }
            Err(err) => {
                summary.failed += 1;
                summary.errors.push(RelayError {
                    relay: format!("disco-vault:{id}"),
                    error: err.to_string(),
                });
            }
        }

        // Same courtesy pacing as the bulk publish — a few hundred deletions
        // in a tight loop trips relay rate limits and gets us dropped.
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let _ = client.shutdown().await;
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Local library import (digital releases)
// ---------------------------------------------------------------------------

const AUDIO_EXTS: &[&str] = &[
    "flac", "mp3", "m4a", "alac", "aac", "ogg", "opus", "wav", "wave", "aiff",
    "aif", "ape", "wv", "dsf", "dff", "mka",
];

// Recognised video (audio-visual) container extensions. Extension-based by
// design (see schema/video-incubation-2026-06.md): simple and cheap. Accepted
// caveat — an audio-only .mp4/.mkv would count as video; stream-level probing
// is deferred to the cross-suite file-awareness layer.
const VIDEO_EXTS: &[&str] = &[
    "mp4", "mkv", "mov", "webm", "m4v", "avi", "wmv", "flv", "mpg", "mpeg",
    "ogv",
];

fn is_video(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| VIDEO_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

const COVER_IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

fn is_image_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| COVER_IMAGE_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

// Score a filename stem as a likely album-front cover. Higher = more likely.
// Returns 0 for files that match alternate-art patterns (back cover, tray,
// disc art, etc.) so we never prefer those even if no obvious cover exists.
fn cover_name_score(stem: &str, dir_name: &str) -> u32 {
    let stem_lc = stem.to_lowercase();
    let dir_lc = dir_name.to_lowercase();

    // Alternate-art patterns: standalone token, qualifier prefix/suffix, or
    // compound "back cover" forms. Veto outright.
    const NEG: &[&str] = &[
        "back", "tray", "inlay", "inside", "booklet", "spine", "label", "obi",
        "disc",
    ];
    for tok in NEG {
        if stem_lc == *tok
            || stem_lc.ends_with(&format!("_{}", tok))
            || stem_lc.ends_with(&format!("-{}", tok))
            || stem_lc.ends_with(&format!(" {}", tok))
            || stem_lc.starts_with(&format!("{}_", tok))
            || stem_lc.starts_with(&format!("{}-", tok))
            || stem_lc.starts_with(&format!("{} ", tok))
        {
            return 0;
        }
    }
    if stem_lc.contains("back cover")
        || stem_lc.contains("back_cover")
        || stem_lc.contains("back-cover")
        || stem_lc.contains("disc art")
    {
        return 0;
    }

    // Strict known names.
    match stem_lc.as_str() {
        "cover" | "folder" | "front" => return 100,
        "albumart" | "albumartlarge" | "albumartsmall" => return 95,
        "art" | "artwork" => return 90,
        _ => {}
    }

    if stem_lc.starts_with("cover") {
        return 85;
    }
    if stem_lc.starts_with("front") {
        return 80;
    }
    if stem_lc.starts_with("folder") {
        return 75;
    }
    if stem_lc.starts_with("albumart") {
        return 72;
    }
    if !dir_lc.is_empty() && stem_lc == dir_lc {
        return 70;
    }
    if !dir_lc.is_empty() && stem_lc.contains(&dir_lc) {
        return 60;
    }
    if stem_lc.contains("cover") {
        return 50;
    }
    if stem_lc.contains("front") {
        return 45;
    }
    0
}

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn find_cover(dir: &Path) -> Option<String> {
    let dir_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let entries = std::fs::read_dir(dir).ok()?;
    let images: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_image_ext(p))
        .collect();
    if images.is_empty() {
        return None;
    }

    let mut scored: Vec<(u32, &PathBuf)> = images
        .iter()
        .map(|p| {
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            (cover_name_score(stem, dir_name), p)
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));

    let (best_score, best_path) = scored[0].clone();
    if best_score > 0 {
        return Some(best_path.to_string_lossy().into_owned());
    }

    // No name match anywhere; if only one image lives in the directory it's
    // almost certainly the cover. With multiple unidentified images we bail
    // rather than guess.
    if images.len() == 1 {
        return Some(images[0].to_string_lossy().into_owned());
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanSummary {
    pub scanned: usize,
    pub matched: usize,
    pub no_match: usize,
    pub no_dir: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
fn rescan_local_covers(app: tauri::AppHandle) -> Result<RescanSummary, String> {
    let mut conn = open(&app)?;

    let candidates: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path
                 FROM releases
                 WHERE (cover_art_url IS NULL OR cover_art_url = '')
                   AND (cover_art_path IS NULL OR cover_art_path = '')
                   AND file_path IS NOT NULL AND file_path <> ''
                 ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total = candidates.len();
    let mut summary = RescanSummary {
        scanned: total,
        matched: 0,
        no_match: 0,
        no_dir: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("rescan:started", total);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, (release_id, file_path)) in candidates.iter().enumerate() {
        let path = PathBuf::from(file_path);
        let _ = app.emit(
            "rescan:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: file_path.clone(),
            },
        );

        // Walk the album directory (or its parent for manual file entries).
        let dir = if path.is_dir() {
            path.clone()
        } else if path.is_file() {
            match path.parent() {
                Some(p) => p.to_path_buf(),
                None => {
                    summary.no_dir += 1;
                    continue;
                }
            }
        } else {
            summary.no_dir += 1;
            continue;
        };

        match find_cover(&dir) {
            Some(cover_path) => {
                match tx.execute(
                    "UPDATE releases
                     SET cover_art_path = ?1, updated_at = strftime('%s','now')
                     WHERE id = ?2",
                    params![cover_path, release_id],
                ) {
                    Ok(_) => summary.matched += 1,
                    Err(e) => summary
                        .errors
                        .push(format!("release {}: DB update: {}", release_id, e)),
                }
            }
            None => {
                summary.no_match += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub scanned: usize,
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub total_dirs: usize,
    pub total_files: usize,
    pub total_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportProgress {
    current: usize,
    total: usize,
    current_dir: String,
}

#[tauri::command]
fn scan_directory(root: String) -> Result<ScanReport, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("not a directory: {}", root.display()));
    }
    let mut report = ScanReport {
        total_dirs: 0,
        total_files: 0,
        total_bytes: 0,
    };
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() && is_audio(entry.path()) {
            report.total_files += 1;
            if let Ok(md) = entry.metadata() {
                report.total_bytes += md.len();
            }
            if let Some(parent) = entry.path().parent() {
                if seen.insert(parent.to_path_buf()) {
                    report.total_dirs += 1;
                }
            }
        }
    }
    Ok(report)
}

struct DirInfo {
    artist: Option<String>,
    title: Option<String>,
    year: Option<i32>,
    // Record label, read from the "Grouping" tag first (FLAC GROUPING / ID3
    // TIT1 / MP4 ©grp — surfaced as Grouping in iTunes-style players) and
    // falling back to the canonical "Label" tag (FLAC LABEL or ORGANIZATION /
    // ID3 TPUB / MP4 ©pub).
    label: Option<String>,
    codec: Option<String>,
    bit_depth: Option<u8>,
    sample_rate: Option<u32>,
    bitrate_kbps: Option<u32>,
    // Raw COMMENT tag (FLAC/Vorbis COMMENT, ID3 COMM, MP4 ©cmt). Bandcamp
    // and other digital stores commonly stash the release/store URL here
    // (e.g. "Visit https://artist.bandcamp.com"). Preserved verbatim into
    // `notes`; any http(s) URL inside it is also lifted into `source_url`.
    comment: Option<String>,
    source_url: Option<String>,
    // Expected total tracks, from the TRACKTOTAL / TOTALTRACKS tag (the max
    // declared across the folder's files). Present even when some tracks are
    // missing — the remaining files still declare the full total.
    track_total: Option<i64>,
}

/// Pull the first `http(s)://…` token out of a free-text string, trimming
/// trailing punctuation/brackets. Used to lift a store URL out of a COMMENT
/// tag (e.g. Bandcamp's "Visit https://artist.bandcamp.com") so it can land
/// in `source` — which `backfill_source` requires to be a bare http(s) URL.
fn first_http_url(s: &str) -> Option<String> {
    s.split_whitespace()
        .filter_map(|w| {
            // Locate the scheme inside the token so a leading "(" / "<" etc.
            // (e.g. "(https://example.com)") doesn't defeat the match.
            let start = w.find("https://").or_else(|| w.find("http://"))?;
            let url = w[start..]
                .trim_end_matches(|c: char| matches!(c, '.' | ',' | ')' | ']' | '>' | '"' | '\'' | ';'));
            (url.len() > "https://".len()).then(|| url.to_owned())
        })
        .next()
}

fn read_dir_tags(files: &[PathBuf]) -> DirInfo {
    let mut info = DirInfo {
        artist: None,
        title: None,
        year: None,
        label: None,
        codec: None,
        bit_depth: None,
        sample_rate: None,
        bitrate_kbps: None,
        comment: None,
        source_url: None,
        track_total: None,
    };
    // Relaxed parsing tolerates malformed tag fields (e.g. non-4-digit year
    // strings) instead of erroring out — we'd rather get the artist/album
    // from a file with a bogus year than fall back to dir names.
    let opts = ParseOptions::new().parsing_mode(ParsingMode::Relaxed);
    for f in files {
        let Ok(probe) = Probe::open(f) else { continue };
        let Ok(tagged) = probe.options(opts).read() else {
            continue;
        };
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            if info.artist.is_none() {
                info.artist = tag
                    .get_string(&ItemKey::AlbumArtist)
                    .or_else(|| tag.get_string(&ItemKey::TrackArtist))
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty());
            }
            if info.title.is_none() {
                info.title = tag
                    .get_string(&ItemKey::AlbumTitle)
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty());
            }
            if info.year.is_none() {
                info.year = tag
                    .get_string(&ItemKey::Year)
                    .or_else(|| tag.get_string(&ItemKey::RecordingDate))
                    .or_else(|| tag.get_string(&ItemKey::OriginalReleaseDate))
                    .and_then(|s| s.get(..4).and_then(|p| p.parse::<i32>().ok()));
            }
            if info.label.is_none() {
                info.label = tag
                    .get_string(&ItemKey::ContentGroup)
                    .or_else(|| tag.get_string(&ItemKey::Label))
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty());
            }
            if info.comment.is_none() {
                info.comment = tag
                    .get_string(&ItemKey::Comment)
                    .or_else(|| tag.get_string(&ItemKey::AudioFileUrl))
                    .or_else(|| tag.get_string(&ItemKey::PaymentUrl))
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty());
            }
            if info.source_url.is_none() {
                // Prefer an explicit URL tag; otherwise dig one out of COMMENT.
                info.source_url = tag
                    .get_string(&ItemKey::AudioFileUrl)
                    .or_else(|| tag.get_string(&ItemKey::PaymentUrl))
                    .and_then(first_http_url)
                    .or_else(|| info.comment.as_deref().and_then(first_http_url));
            }
            if info.track_total.is_none() {
                // TRACKTOTAL / TOTALTRACKS — album-wide, so the first file that
                // declares it wins. Parsed to a positive integer.
                info.track_total = tag
                    .get_string(&ItemKey::TrackTotal)
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .filter(|&n| n > 0);
            }
        }
        let props = tagged.properties();
        if info.codec.is_none() {
            info.codec = f
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_uppercase());
        }
        if info.bit_depth.is_none() {
            info.bit_depth = props.bit_depth();
        }
        if info.sample_rate.is_none() {
            info.sample_rate = props.sample_rate();
        }
        if info.bitrate_kbps.is_none() {
            info.bitrate_kbps = props.audio_bitrate();
        }
        if info.artist.is_some()
            && info.title.is_some()
            && info.year.is_some()
            && info.label.is_some()
            && info.codec.is_some()
            && info.track_total.is_some()
        {
            break;
        }
    }
    info
}

fn build_format_string(info: &DirInfo) -> String {
    let codec = info.codec.clone().unwrap_or_else(|| "digital".into());
    if let (Some(bd), Some(sr)) = (info.bit_depth, info.sample_rate) {
        if bd > 0 && sr > 0 {
            let khz = sr as f32 / 1000.0;
            let khz_str = if (khz - khz.trunc()).abs() < 0.05 {
                format!("{:.0}", khz)
            } else {
                format!("{:.1}", khz)
            };
            return format!("{} {}/{}", codec, bd, khz_str);
        }
    }
    if let Some(kbps) = info.bitrate_kbps.filter(|&b| b > 0) {
        return format!("{} {}", codec, kbps);
    }
    codec
}

#[tauri::command]
fn import_directory(app: tauri::AppHandle, root: String) -> Result<ImportSummary, String> {
    let root = PathBuf::from(&root);
    if !root.is_dir() {
        return Err(format!("not a directory: {}", root.display()));
    }

    // Group every audio file by its parent directory. Each parent that
    // directly contains audio files becomes one digital release.
    let mut by_dir: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() && is_audio(entry.path()) {
            if let Some(parent) = entry.path().parent() {
                by_dir
                    .entry(parent.to_path_buf())
                    .or_default()
                    .push(entry.into_path());
            }
        }
    }

    let total = by_dir.len();
    let mut summary = ImportSummary {
        scanned: total,
        imported: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    let _ = app.emit("import:started", total);

    let mut conn = open(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, (dir, files)) in by_dir.into_iter().enumerate() {
        let dir_str = dir.to_string_lossy().into_owned();

        let _ = app.emit(
            "import:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: dir_str.clone(),
            },
        );

        let exists: bool = tx
            .query_row(
                "SELECT 1 FROM releases WHERE file_path = ?1 LIMIT 1",
                params![dir_str],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if exists {
            summary.skipped += 1;
            continue;
        }

        // Deliberately removed as a duplicate — do not resurrect it. The folder
        // may still be on disk (trashing is the user's call, and they may have
        // restored it from Trash), but they have already said it isn't wanted
        // as its own release.
        let resolved: bool = tx
            .query_row(
                "SELECT 1 FROM merged_paths WHERE path = ?1 LIMIT 1",
                params![dir_str],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if resolved {
            summary.skipped += 1;
            continue;
        }

        let info = read_dir_tags(&files);

        let dir_name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();
        let parent_name = dir
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_owned();

        let artist = info.artist.clone().unwrap_or_else(|| {
            if parent_name.is_empty() {
                "Unknown Artist".into()
            } else {
                parent_name
            }
        });
        let title = info.title.clone().unwrap_or_else(|| {
            if dir_name.is_empty() {
                "Unknown Album".into()
            } else {
                dir_name
            }
        });
        let format = build_format_string(&info);
        let cover = find_cover(&dir);

        match tx.execute(
            "INSERT INTO releases
             (artist, title, year, medium, format, label, notes, source,
              file_path, cover_art_path, release_type, track_count, track_total)
             VALUES (?1, ?2, ?3, 'digital', ?4, ?5, ?6, ?7, ?8, ?9, 'music', ?10, ?11)",
            params![
                artist,
                title,
                info.year,
                format,
                info.label,
                info.comment,
                info.source_url,
                dir_str,
                cover,
                (files.len() as i64).min(99),
                // expected = TRACKTOTAL tag, else the present file count.
                info.track_total.unwrap_or(files.len() as i64).min(99),
            ],
        ) {
            Ok(_) => summary.imported += 1,
            Err(e) => summary.errors.push(format!("{}: {}", dir.display(), e)),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Embedded cover-art extraction (digital releases with no cover yet)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractSummary {
    pub scanned: usize,
    pub extracted: usize,
    pub no_embedded: usize,
    pub no_audio: usize,
    pub errors: Vec<String>,
}

fn ext_for_image(mime: Option<&lofty::picture::MimeType>, data: &[u8]) -> &'static str {
    use lofty::picture::MimeType;
    match mime {
        Some(MimeType::Jpeg) => "jpg",
        Some(MimeType::Png) => "png",
        Some(MimeType::Gif) => "gif",
        Some(MimeType::Bmp) => "bmp",
        Some(MimeType::Tiff) => "tiff",
        _ => sniff_image_ext(data),
    }
}

fn sniff_image_ext(data: &[u8]) -> &'static str {
    if data.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else if data.starts_with(&[0x89, 0x50, 0x4e, 0x47]) {
        "png"
    } else if data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"WEBP" {
        "webp"
    } else if data.starts_with(b"GIF8") {
        "gif"
    } else {
        "jpg"
    }
}

fn first_audio_in(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_audio(p))
        .collect();
    paths.sort();
    paths.into_iter().next()
}

fn extract_picture_from(audio_path: &Path) -> Option<(Vec<u8>, &'static str)> {
    let opts = ParseOptions::new().parsing_mode(ParsingMode::Relaxed);
    let probe = Probe::open(audio_path).ok()?;
    let tagged = probe.options(opts).read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let picture = tag.pictures().first()?;
    let data = picture.data().to_vec();
    if data.is_empty() {
        return None;
    }
    let ext = ext_for_image(picture.mime_type(), &data);
    Some((data, ext))
}

#[tauri::command]
fn extract_embedded_covers(app: tauri::AppHandle) -> Result<ExtractSummary, String> {
    let mut conn = open(&app)?;

    // Pull every release that currently lacks a cover URL and a cover path,
    // restricted to digital (physical never has a file_path to extract from).
    let candidates: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path
                 FROM releases
                 WHERE medium = 'digital'
                   AND (cover_art_url IS NULL OR cover_art_url = '')
                   AND (cover_art_path IS NULL OR cover_art_path = '')
                   AND file_path IS NOT NULL AND file_path <> ''
                 ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total = candidates.len();
    let mut summary = ExtractSummary {
        scanned: total,
        extracted: 0,
        no_embedded: 0,
        no_audio: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("extract:started", total);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, (release_id, file_path)) in candidates.iter().enumerate() {
        let path = PathBuf::from(file_path);
        let _ = app.emit(
            "extract:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: file_path.clone(),
            },
        );

        // file_path is typically a directory (album folder); fall back to
        // treating it as a single file for manual entries.
        let (album_dir, audio_path) = if path.is_dir() {
            let Some(audio) = first_audio_in(&path) else {
                summary.no_audio += 1;
                continue;
            };
            (path.clone(), audio)
        } else if path.is_file() && is_audio(&path) {
            let dir = path
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            (dir, path.clone())
        } else {
            summary.no_audio += 1;
            continue;
        };

        let Some((data, ext)) = extract_picture_from(&audio_path) else {
            summary.no_embedded += 1;
            continue;
        };

        let out = album_dir.join(format!("cover-extracted.{}", ext));
        if let Err(e) = std::fs::write(&out, &data) {
            summary
                .errors
                .push(format!("{}: write failed: {}", out.display(), e));
            continue;
        }

        let out_str = out.to_string_lossy().into_owned();
        match tx.execute(
            "UPDATE releases
             SET cover_art_path = ?1, updated_at = strftime('%s','now')
             WHERE id = ?2",
            params![out_str, release_id],
        ) {
            Ok(_) => summary.extracted += 1,
            Err(e) => summary
                .errors
                .push(format!("release {}: DB update: {}", release_id, e)),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Discogs CSV import (physical + digital releases from a Discogs export)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDiscogsReport {
    pub total_rows: usize,
    pub physical: usize,
    pub digital: usize,
    pub with_condition: usize,
}

fn medium_from_format(format: &str) -> &'static str {
    if format.contains("File") {
        "digital"
    } else {
        "physical"
    }
}

fn nonempty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_owned())
    }
}

#[tauri::command]
fn scan_discogs_csv(path: String) -> Result<ScanDiscogsReport, String> {
    let mut reader = csv::Reader::from_path(&path).map_err(|e| e.to_string())?;
    let mut report = ScanDiscogsReport {
        total_rows: 0,
        physical: 0,
        digital: 0,
        with_condition: 0,
    };
    for result in reader.deserialize::<HashMap<String, String>>() {
        let row = result.map_err(|e| e.to_string())?;
        report.total_rows += 1;
        let format = row.get("Format").map(String::as_str).unwrap_or("");
        if medium_from_format(format) == "digital" {
            report.digital += 1;
        } else {
            report.physical += 1;
        }
        if row
            .get("Collection Media Condition")
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            report.with_condition += 1;
        }
    }
    Ok(report)
}

#[tauri::command]
fn import_discogs_csv(
    app: tauri::AppHandle,
    path: String,
    // "physical" | "digital" to import only that medium; None imports both.
    medium_filter: Option<String>,
) -> Result<ImportSummary, String> {
    let mut reader = csv::Reader::from_path(&path).map_err(|e| e.to_string())?;

    // Collect rows first so we know the total before emitting events.
    let rows: Vec<HashMap<String, String>> = reader
        .deserialize::<HashMap<String, String>>()
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let total = rows.len();
    let mut summary = ImportSummary {
        scanned: total,
        imported: 0,
        skipped: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("import:started", total);

    let mut conn = open(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, row) in rows.iter().enumerate() {
        let artist = nonempty(row.get("Artist").map(String::as_str).unwrap_or(""));
        let title = nonempty(row.get("Title").map(String::as_str).unwrap_or(""));
        let format = row.get("Format").map(String::as_str).unwrap_or("");
        let label = nonempty(row.get("Label").map(String::as_str).unwrap_or(""));
        let catalog = nonempty(row.get("Catalog#").map(String::as_str).unwrap_or(""));
        let year: Option<i32> = row
            .get("Released")
            .and_then(|s| s.trim().parse::<i32>().ok())
            .filter(|&y| y > 0);
        let discogs_id: Option<i64> = row
            .get("release_id")
            .and_then(|s| s.trim().parse::<i64>().ok());
        let media_cond =
            nonempty(row.get("Collection Media Condition").map(String::as_str).unwrap_or(""));
        let sleeve_cond =
            nonempty(row.get("Collection Sleeve Condition").map(String::as_str).unwrap_or(""));
        let user_notes =
            nonempty(row.get("Collection Notes").map(String::as_str).unwrap_or(""));
        let country = nonempty(row.get("Country").map(String::as_str).unwrap_or(""));

        // Discogs guarantees artist+title, but defend against bad rows.
        let (Some(artist), Some(title)) = (artist, title) else {
            summary.errors.push(format!("row {}: missing artist or title", i + 1));
            continue;
        };

        // Sleeve condition has no native column; fold into notes when present.
        let notes = match (sleeve_cond, user_notes) {
            (Some(s), Some(n)) => Some(format!("Sleeve: {}\n{}", s, n)),
            (Some(s), None) => Some(format!("Sleeve: {}", s)),
            (None, n) => n,
        };

        let _ = app.emit(
            "import:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: format!("{} — {}", artist, title),
            },
        );

        // Idempotency: skip if this Discogs release is already in the DB.
        if let Some(d_id) = discogs_id {
            let exists: bool = tx
                .query_row(
                    "SELECT 1 FROM releases WHERE discogs_id = ?1 LIMIT 1",
                    params![d_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);
            if exists {
                summary.skipped += 1;
                continue;
            }
        }

        let medium = medium_from_format(format);

        // Skip rows that don't match the requested medium, if one was given.
        if let Some(ref want) = medium_filter {
            if medium != want.as_str() {
                summary.skipped += 1;
                continue;
            }
        }

        let format_opt = nonempty(format);
        let category = category_from_discogs_format(format);

        let source = discogs_id
            .map(|id| format!("https://www.discogs.com/release/{}", id));

        match tx.execute(
            "INSERT INTO releases
             (artist, title, year, medium, format, label, catalog_number,
              country, condition, notes, source, discogs_id, release_type,
              category)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                     'music', ?13)",
            params![
                artist,
                title,
                year,
                medium,
                format_opt,
                label,
                catalog,
                country,
                media_cond,
                notes,
                source,
                discogs_id,
                category,
            ],
        ) {
            Ok(_) => summary.imported += 1,
            Err(e) => summary.errors.push(format!("row {}: {}", i + 1, e)),
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Bandcamp collection import (mirrors the Discogs CSV import). Folds a Bandcamp
// collection CSV (columns: artist,title,link,receipt[,art_id,type]) into the
// catalog: ENRICHES an existing release when artist+title fuzzy-match (sets the
// `source` link if empty, `bandcamp_id` receipt, cover from art_id) — the Linux
// /data/music case — else INSERTS a new digital release — the Windows case.
// Cross-platform; the only published tag it touches is `source` (same shape).
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBandcampReport {
    pub total_rows: usize,
    pub with_link: usize,
    pub with_receipt: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BandcampImportSummary {
    pub scanned: usize,
    pub enriched: usize,
    pub inserted: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

// Fold common Latin-1 accents to ASCII so "Röskva" matches a "Roskva" folder.
fn bc_fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        'ý' | 'ÿ' => 'y',
        _ => c,
    }
}

// Lowercase + accent-fold + split into ASCII-alphanumeric tokens (len > 1).
fn bc_tokens(s: &str) -> Vec<String> {
    let folded: String = s
        .chars()
        .flat_map(|c| c.to_lowercase())
        .map(bc_fold)
        .collect();
    folded
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() > 1)
        .map(|t| t.to_string())
        .collect()
}

fn bc_cover_url(art_id: &str) -> Option<String> {
    let id = art_id.trim();
    if id.is_empty() || id == "0" {
        None
    } else {
        Some(format!("https://f4.bcbits.com/img/a{}_16.jpg", id))
    }
}

#[tauri::command]
fn scan_bandcamp_csv(path: String) -> Result<ScanBandcampReport, String> {
    let mut reader = csv::Reader::from_path(&path).map_err(|e| e.to_string())?;
    let mut report = ScanBandcampReport {
        total_rows: 0,
        with_link: 0,
        with_receipt: 0,
    };
    for result in reader.deserialize::<HashMap<String, String>>() {
        let row = result.map_err(|e| e.to_string())?;
        report.total_rows += 1;
        if row.get("link").map(|s| !s.trim().is_empty()).unwrap_or(false) {
            report.with_link += 1;
        }
        if row.get("receipt").map(|s| !s.trim().is_empty()).unwrap_or(false) {
            report.with_receipt += 1;
        }
    }
    Ok(report)
}

struct BcRel {
    id: i64,
    artist: Vec<String>,
    title: Vec<String>,
    has_source: bool,
    has_cover: bool,
    digital: bool,
}

#[tauri::command]
fn import_bandcamp_csv(
    app: tauri::AppHandle,
    path: String,
) -> Result<BandcampImportSummary, String> {
    let mut reader = csv::Reader::from_path(&path).map_err(|e| e.to_string())?;
    let rows: Vec<HashMap<String, String>> = reader
        .deserialize::<HashMap<String, String>>()
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let total = rows.len();
    let mut summary = BandcampImportSummary {
        scanned: total,
        enriched: 0,
        inserted: 0,
        skipped: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("import:started", total);

    let mut conn = open(&app)?;

    // Index every existing release once for fuzzy artist+title matching.
    let mut existing: Vec<BcRel> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, artist, title, source, cover_art_url, medium FROM releases")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in mapped {
            let (id, artist, title, source, cover, medium) = row.map_err(|e| e.to_string())?;
            existing.push(BcRel {
                id,
                artist: bc_tokens(&artist),
                title: bc_tokens(&title),
                has_source: source.map(|s| !s.trim().is_empty()).unwrap_or(false),
                has_cover: cover.map(|s| !s.trim().is_empty()).unwrap_or(false),
                digital: medium.as_deref() == Some("digital"),
            });
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (i, row) in rows.iter().enumerate() {
        let artist = nonempty(row.get("artist").map(String::as_str).unwrap_or(""));
        let title = nonempty(row.get("title").map(String::as_str).unwrap_or(""));
        let link = nonempty(row.get("link").map(String::as_str).unwrap_or(""));
        let receipt = nonempty(row.get("receipt").map(String::as_str).unwrap_or(""));
        let art_id = row.get("art_id").map(String::as_str).unwrap_or("");
        let typ = row.get("type").map(String::as_str).unwrap_or("");

        let (Some(artist), Some(title)) = (artist, title) else {
            summary.errors.push(format!("row {}: missing artist or title", i + 1));
            continue;
        };
        let Some(link) = link else {
            // Nothing to fold in without a release link.
            summary.skipped += 1;
            continue;
        };

        let _ = app.emit(
            "import:progress",
            ImportProgress {
                current: i + 1,
                total,
                current_dir: format!("{} — {}", artist, title),
            },
        );

        let at = bc_tokens(&artist);
        let tt = bc_tokens(&title);
        let cover = bc_cover_url(art_id);

        // Best fuzzy match: artist tokens ≥60% present AND title tokens ≥60%.
        let mut best: Option<usize> = None;
        let mut best_score = 0.0f32;
        if !at.is_empty() && !tt.is_empty() {
            for (idx, rel) in existing.iter().enumerate() {
                if rel.artist.is_empty() || rel.title.is_empty() {
                    continue;
                }
                let a_ov =
                    at.iter().filter(|t| rel.artist.contains(t)).count() as f32 / at.len() as f32;
                if a_ov < 0.6 {
                    continue;
                }
                let t_cov =
                    tt.iter().filter(|t| rel.title.contains(t)).count() as f32 / tt.len() as f32;
                if t_cov < 0.6 {
                    continue;
                }
                let score = a_ov + t_cov + if rel.digital { 0.1 } else { 0.0 };
                if score > best_score {
                    best_score = score;
                    best = Some(idx);
                }
            }
        }

        if let Some(idx) = best {
            // Enrich: set source only if empty (protect Discogs URLs); set the
            // receipt; set cover only if empty.
            let rel_id = existing[idx].id;
            let set_source = !existing[idx].has_source;
            let set_cover = !existing[idx].has_cover && cover.is_some();
            match tx.execute(
                "UPDATE releases SET
                   source        = CASE WHEN ?2 THEN ?3 ELSE source END,
                   bandcamp_id   = COALESCE(?4, bandcamp_id),
                   cover_art_url = CASE WHEN ?5 THEN ?6 ELSE cover_art_url END,
                   updated_at    = strftime('%s','now')
                 WHERE id = ?1",
                params![rel_id, set_source, link, receipt, set_cover, cover],
            ) {
                Ok(_) => {
                    summary.enriched += 1;
                    if set_source {
                        existing[idx].has_source = true;
                    }
                    if set_cover {
                        existing[idx].has_cover = true;
                    }
                }
                Err(e) => summary.errors.push(format!("row {}: {}", i + 1, e)),
            }
        } else {
            // Insert a new digital release (purchased, not yet filed locally).
            let category = match typ {
                "a" => Some("album"),
                "t" => Some("single"),
                _ => None,
            };
            let inserted_tokens = (at, tt);
            match tx.execute(
                "INSERT INTO releases
                   (artist, title, medium, source, bandcamp_id, cover_art_url,
                    release_type, category)
                 VALUES (?1, ?2, 'digital', ?3, ?4, ?5, 'music', ?6)",
                params![artist, title, link, receipt, cover, category],
            ) {
                Ok(_) => {
                    summary.inserted += 1;
                    existing.push(BcRel {
                        id: tx.last_insert_rowid(),
                        artist: inserted_tokens.0,
                        title: inserted_tokens.1,
                        has_source: true,
                        has_cover: cover.is_some(),
                        digital: true,
                    });
                }
                Err(e) => summary.errors.push(format!("row {}: {}", i + 1, e)),
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

/// Infer a category from a Discogs CSV Format column. Discogs typically
/// puts the broad release type as a substring like "12\", EP" or "LP, Album".
fn category_from_discogs_format(format: &str) -> Option<&'static str> {
    let lower = format.to_lowercase();
    if lower.contains("mixed") {
        return Some("mix");
    }
    if lower.contains("live") {
        return Some("live");
    }
    if lower.contains("comp") {
        return Some("compilation");
    }
    if lower.contains("ep") {
        return Some("ep");
    }
    if lower.contains("single") {
        return Some("single");
    }
    if lower.contains("album") {
        return Some("album");
    }
    if lower.contains("miscellaneous") {
        return Some("miscellaneous");
    }
    None
}

// ---------------------------------------------------------------------------
// Discogs metadata enrichment
//
// Discogs CSV exports carry no track or disc counts, so physical (Discogs-
// imported) releases land with track_total / disc_total NULL — they render no
// leaf-dots and publish no `tracks` tag, breaking parity with folder-imported
// digital releases. This pass fetches the canonical release from the Discogs
// API by the stored discogs_id and fills both counts: the tracklist length →
// track_total (which the existing `tracks` tag then publishes), and the sum of
// the format quantities → disc_total (DB-local for now; a published `discs`
// tag would be an additive contract wave, deferred).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DiscogsRelease {
    #[serde(default)]
    tracklist: Vec<DiscogsTrack>,
    #[serde(default)]
    formats: Vec<DiscogsFormat>,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    labels: Vec<DiscogsLabel>,
}

#[derive(Deserialize)]
struct DiscogsLabel {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    catno: Option<String>,
}

#[derive(Deserialize)]
struct DiscogsTrack {
    #[serde(default, rename = "type_")]
    kind: Option<String>,
    #[serde(default)]
    position: Option<String>,
    #[serde(default)]
    sub_tracks: Vec<DiscogsTrack>,
}

#[derive(Deserialize)]
struct DiscogsFormat {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    qty: Option<String>,
    #[serde(default)]
    descriptions: Vec<String>,
    // Free-text qualifier — Discogs stores the vinyl colour here ("Green"),
    // NOT in `descriptions`; the CSV export appends an abbreviated form of it.
    #[serde(default)]
    text: Option<String>,
}

// Count real tracks in a Discogs tracklist. Discogs interleaves "heading" rows
// (section titles, no audio) and "index" rows (a single track holding named
// sub-parts, e.g. a medley); only "track" rows — and the sub_tracks under an
// index — are playable. Older entries omit type_ entirely, so a typed-less row
// with a position counts as a track.
fn count_discogs_tracks(items: &[DiscogsTrack]) -> i64 {
    let mut n = 0i64;
    for t in items {
        match t.kind.as_deref() {
            Some("track") => n += 1,
            Some("index") => {
                let sub = count_discogs_tracks(&t.sub_tracks);
                n += if sub > 0 { sub } else { 1 };
            }
            Some("heading") => {}
            // Unknown / absent type: treat a positioned row as a track.
            _ => {
                if t
                    .position
                    .as_deref()
                    .map(|p| !p.trim().is_empty())
                    .unwrap_or(false)
                {
                    n += 1;
                }
            }
        }
    }
    n
}

// Discogs format names that do NOT denote a physical disc/platter, so their
// `qty` must not be counted as discs: "File" is digital (its qty is the file /
// track count — e.g. "4×File" is 4 tracks, 0 discs); "Box Set" / "All Media"
// are container wrappers whose qty is 1-for-the-box, not a disc count (the
// real discs are the inner format lines). A missing name is assumed physical.
fn is_disc_format(name: Option<&str>) -> bool {
    match name.map(str::trim) {
        Some(n) => !["File", "Box Set", "All Media"]
            .iter()
            .any(|d| n.eq_ignore_ascii_case(d)),
        None => true,
    }
}

// Physical disc count = sum of the per-format quantities across disc-bearing
// formats only (a 2×LP + bonus 7" → 3; a "4×File" digital release → no discs).
// Missing/garbage qty on a physical format counts as 1. Returns None when the
// release has no physical media (digital-only / containers) — that's a real
// "no discs" answer, distinct from an unknown count.
fn parse_disc_total(formats: &[DiscogsFormat]) -> Option<i64> {
    let discs: i64 = formats
        .iter()
        .filter(|f| is_disc_format(f.name.as_deref()))
        .map(|f| {
            f.qty
                .as_deref()
                .and_then(|q| q.trim().parse::<i64>().ok())
                .filter(|&q| q > 0)
                .unwrap_or(1)
        })
        .sum();
    (discs > 0).then_some(discs)
}

async fn fetch_discogs_release(
    id: i64,
    token: Option<String>,
) -> Result<DiscogsRelease, String> {
    let url = format!("https://api.discogs.com/releases/{}", id);
    let client = reqwest::Client::builder()
        // Discogs rejects requests without a descriptive User-Agent.
        .user_agent("ndisc/0.1 (+https://github.com/xjmzx/ndisc)")
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    if let Some(t) = token.filter(|t| !t.trim().is_empty()) {
        req = req.header("Authorization", format!("Discogs token={}", t.trim()));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("discogs {}: {}", id, e))?;
    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("rate_limited".into());
    }
    if !resp.status().is_success() {
        return Err(format!("discogs {}: HTTP {}", id, resp.status()));
    }
    // reqwest's `json` feature isn't enabled; decode the body ourselves.
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("discogs {} body: {}", id, e))?;
    serde_json::from_slice::<DiscogsRelease>(&body)
        .map_err(|e| format!("discogs {} parse: {}", id, e))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnrichResult {
    release_id: i64,
    track_total: Option<i64>,
    disc_total: Option<i64>,
    status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EnrichSummary {
    scanned: usize,
    enriched: usize,
    skipped: usize,
    errors: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EnrichProgress {
    current: usize,
    total: usize,
    label: String,
}

// Write enriched counts back. When the row was already published and EITHER
// published count (track_total → `tracks`, disc_total → `discs`) actually
// changes, clear the publish state so the now-stale kind:31237 event gets
// re-emitted on the next Publish pass — same mechanism the genre restructure
// migration uses. (Both counts gate publish since the 2026-06 `discs` tag.)
fn apply_enrichment(
    conn: &Connection,
    release_id: i64,
    enr: &Enrichment,
) -> Result<(), String> {
    type Row = (
        Option<i64>,    // track_total
        Option<i64>,    // disc_total
        Option<String>, // format
        Option<String>, // category
        Option<String>, // label
        Option<String>, // catalog_number
        Option<String>, // country
        Option<i64>,    // last_published_at
    );
    let (old_tt, old_dt, old_format, old_cat, old_label, old_catno, old_country, published): Row =
        conn.query_row(
            "SELECT track_total, disc_total, format, category, label, catalog_number,
                    country, last_published_at
             FROM releases WHERE id = ?1",
            params![release_id],
            |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
                    r.get(6)?, r.get(7)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    // Fill an EMPTY column from the API value; never clobber a value the user
    // already curated. Returns the resolved value + whether it changed.
    fn fill(cur: Option<String>, api: &Option<String>) -> (Option<String>, bool) {
        let set = |o: &Option<String>| o.as_deref().map_or(false, |s| !s.trim().is_empty());
        if set(&cur) {
            (cur, false)
        } else if set(api) {
            (api.clone(), true)
        } else {
            (cur, false)
        }
    }
    let (category, c_cat) = fill(old_cat, &enr.category);
    let (label, c_lab) = fill(old_label, &enr.label);
    let (catalog, c_cn) = fill(old_catno, &enr.catalog);
    let (country, c_co) = fill(old_country, &enr.country);

    // Format gets richer handling than the other metadata: the stored value is
    // usually non-empty but ABBREVIATED (the Discogs CSV clips "Green"→"Gre"),
    // so plain fill-empty wouldn't fix it. Replace it with the API's spelled-out
    // string when the current value is empty, or is recognisably the clipped
    // form of it; otherwise (a hand-curated, structurally-different format)
    // leave it be.
    let (format, c_fmt) = match enr.format.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(full) => {
            let cur = old_format.as_deref().map(str::trim).unwrap_or("");
            if cur.is_empty() || format_is_abbrev_of(cur, full) {
                let changed = cur != full;
                (Some(full.to_string()), changed)
            } else {
                (old_format.clone(), false)
            }
        }
        None => (old_format.clone(), false),
    };

    // A published event is stale if any emitted field moved. track_total is
    // COALESCE'd (a None API result keeps the existing value); disc_total is
    // authoritative/overwritten (a Some→None — a digital release losing a bogus
    // disc count — is a real change); metadata only changes when newly filled
    // (or, for format, replaced with the un-abbreviated form). `format` is a
    // published tag, so its change must re-flag too.
    let track_changed = enr.track_total.is_some() && enr.track_total != old_tt;
    let disc_changed = enr.disc_total != old_dt;
    let meta_changed = c_cat || c_lab || c_cn || c_co || c_fmt;
    let clear_pub = (track_changed || disc_changed || meta_changed) && published.is_some();

    conn.execute(
        "UPDATE releases SET
             track_total = COALESCE(?1, track_total),
             disc_total = ?2,
             format = ?3,
             category = ?4,
             label = ?5,
             catalog_number = ?6,
             country = ?7,
             last_published_at =
                 CASE WHEN ?8 THEN NULL ELSE last_published_at END,
             last_published_naddr =
                 CASE WHEN ?8 THEN NULL ELSE last_published_naddr END,
             updated_at = strftime('%s','now')
         WHERE id = ?9",
        params![
            enr.track_total,
            enr.disc_total,
            format,
            category,
            label,
            catalog,
            country,
            clear_pub,
            release_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn counts_from(rel: &DiscogsRelease) -> (Option<i64>, Option<i64>) {
    let tracks = count_discogs_tracks(&rel.tracklist).clamp(0, 99);
    let discs = parse_disc_total(&rel.formats).map(|d| d.clamp(1, 99));
    (if tracks > 0 { Some(tracks) } else { None }, discs)
}

// Everything an enrichment pass pulls from a Discogs release. Counts are
// authoritative (overwrite); the metadata fields only ever fill EMPTY columns
// (a release's own curated label/category/etc. is never clobbered).
struct Enrichment {
    track_total: Option<i64>,
    disc_total: Option<i64>,
    format: Option<String>,
    category: Option<String>,
    label: Option<String>,
    catalog: Option<String>,
    country: Option<String>,
}

// Discogs writes "none" (literally) for a catalog-less release — treat as empty.
fn clean_catno(s: Option<&str>) -> Option<String> {
    let t = s?.trim();
    (!t.is_empty() && !t.eq_ignore_ascii_case("none")).then(|| t.to_string())
}

// Reconstruct a Discogs-style format string ("Vinyl, LP, Album") from the API
// formats so category_from_discogs_format can infer the category, exactly as it
// does from the CSV `Format` column.
fn discogs_format_string(formats: &[DiscogsFormat]) -> String {
    formats
        .iter()
        .flat_map(|f| f.name.iter().cloned().chain(f.descriptions.iter().cloned()))
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

// Reconstruct the human format string Discogs shows on the site — e.g.
// `7", Single, Green` or `2x12", Album` — from the API formats. Per medium:
// an `Nx` quantity prefix (N>1), then the format's descriptions and its colour
// `text`, joined with ", "; the medium NAME is kept only for non-vinyl (a
// vinyl's size already rides in `descriptions`, so prepending "Vinyl" would be
// noise). Multiple media are joined with " + ". This is the un-abbreviated
// counterpart to the Discogs CSV `Format` column.
fn discogs_format_display(formats: &[DiscogsFormat]) -> Option<String> {
    let blocks: Vec<String> = formats
        .iter()
        .filter_map(|f| {
            let mut bits: Vec<String> = Vec::new();
            if let Some(n) = f.name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                if !n.eq_ignore_ascii_case("vinyl") {
                    bits.push(n.to_string());
                }
            }
            bits.extend(
                f.descriptions.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            );
            if let Some(t) = f.text.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                bits.push(t.to_string());
            }
            if bits.is_empty() {
                return None;
            }
            let joined = bits.join(", ");
            let qty = f
                .qty
                .as_deref()
                .and_then(|q| q.trim().parse::<i64>().ok())
                .filter(|&q| q > 1);
            Some(match qty {
                Some(q) => format!("{}x{}", q, joined),
                None => joined,
            })
        })
        .collect();
    (!blocks.is_empty()).then(|| blocks.join(" + "))
}

// Is `stored` merely an abbreviated form of `full`? The Discogs CSV `Format`
// column clips descriptor terms (vinyl colour → "Gre", and a handful of edition
// short-codes) while keeping the same tokens in the same order. We treat the
// stored value as safe-to-replace only when it lines up token-for-token with
// the reconstructed full string — each stored token being an exact match, a
// prefix ("Gre" of "Green", "Num" of "Numbered"), or a known non-prefix short
// code ("Ltd" of "Limited Edition"). Anything structurally different is assumed
// hand-curated and left alone.
fn format_is_abbrev_of(stored: &str, full: &str) -> bool {
    fn toks(s: &str) -> Vec<String> {
        s.split([',', '+'])
            .map(|t| t.trim().to_ascii_lowercase())
            .filter(|t| !t.is_empty())
            .collect()
    }
    // Discogs short codes that aren't simple prefixes of the spelled-out term.
    fn alias_matches(short: &str, full: &str) -> bool {
        matches!(
            (short, full),
            ("ltd", "limited edition")
                | ("re", "reissue")
                | ("rp", "repress")
                | ("tp", "test pressing")
                | ("s/sided", "single sided")
                | ("w/lbl", "with label")
                | ("smplr", "sampler")
                | ("mp", "mispress")
        )
    }
    let (a, b) = (toks(stored), toks(full));
    if a.is_empty() || a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(&b)
        .all(|(s, f)| f == s || f.starts_with(s.as_str()) || alias_matches(s, f))
}

fn enrichment_from(rel: &DiscogsRelease) -> Enrichment {
    let (track_total, disc_total) = counts_from(rel);
    Enrichment {
        track_total,
        disc_total,
        format: discogs_format_display(&rel.formats),
        category: category_from_discogs_format(&discogs_format_string(&rel.formats))
            .map(|s| s.to_string()),
        label: rel.labels.first().and_then(|l| l.name.as_deref()).and_then(nonempty),
        catalog: rel.labels.first().and_then(|l| clean_catno(l.catno.as_deref())),
        country: rel.country.as_deref().and_then(nonempty),
    }
}

// Enrich one release by its stored discogs_id (a manual "refresh from Discogs"
// on a single row). Always re-fetches.
#[tauri::command]
async fn enrich_discogs_release(
    app: tauri::AppHandle,
    release_id: i64,
) -> Result<EnrichResult, String> {
    let discogs_id: Option<i64> = {
        let conn = open(&app)?;
        conn.query_row(
            "SELECT discogs_id FROM releases WHERE id = ?1",
            params![release_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    let Some(did) = discogs_id else {
        return Ok(EnrichResult {
            release_id,
            track_total: None,
            disc_total: None,
            status: "no_discogs_id".into(),
        });
    };
    let token = load_discogs_token()?;
    let rel = fetch_discogs_release(did, token).await?;
    let enr = enrichment_from(&rel);
    let (tt, dt) = (enr.track_total, enr.disc_total);
    let conn = open(&app)?;
    apply_enrichment(&conn, release_id, &enr)?;
    Ok(EnrichResult {
        release_id,
        track_total: tt,
        disc_total: dt,
        status: "ok".into(),
    })
}

// Batch pass over every Discogs-sourced release that's still missing a count
// (or all of them, when `force`). Throttled to stay under Discogs' rate limit
// and emits enrich:* events for a progress bar; stops early on a 429.
#[tauri::command]
async fn enrich_discogs_library(
    app: tauri::AppHandle,
    force: Option<bool>,
) -> Result<EnrichSummary, String> {
    let force = force.unwrap_or(false);
    let token = load_discogs_token()?;

    let targets: Vec<(i64, i64, String, String)> = {
        let conn = open(&app)?;
        let sql = if force {
            "SELECT id, discogs_id, artist, title FROM releases
             WHERE discogs_id IS NOT NULL ORDER BY id"
        } else {
            "SELECT id, discogs_id, artist, title FROM releases
             WHERE discogs_id IS NOT NULL
               AND (track_total IS NULL OR disc_total IS NULL)
             ORDER BY id"
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        out
    };

    let total = targets.len();
    let mut summary = EnrichSummary {
        scanned: total,
        enriched: 0,
        skipped: 0,
        errors: Vec::new(),
    };
    let _ = app.emit("enrich:started", total);

    for (i, (rid, did, artist, title)) in targets.iter().enumerate() {
        let _ = app.emit(
            "enrich:progress",
            EnrichProgress {
                current: i + 1,
                total,
                label: format!("{} — {}", artist, title),
            },
        );
        match fetch_discogs_release(*did, token.clone()).await {
            Ok(rel) => {
                let enr = enrichment_from(&rel);
                // Open a fresh connection per item: rusqlite's Connection is
                // !Send and must not be held across the .await above.
                let conn = open(&app)?;
                match apply_enrichment(&conn, *rid, &enr) {
                    Ok(()) => summary.enriched += 1,
                    Err(e) => summary.errors.push(format!("release {}: {}", rid, e)),
                }
            }
            Err(e) if e == "rate_limited" => {
                summary
                    .errors
                    .push(format!("release {}: rate limited — stopped early", rid));
                break;
            }
            Err(e) => {
                summary.skipped += 1;
                summary.errors.push(format!("release {}: {}", rid, e));
            }
        }
        // Polite throttle — Discogs allows ~60 authenticated req/min.
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    }

    let _ = app.emit("enrich:done", summary.clone());
    Ok(summary)
}

// One-shot migration from the disco-vault era. On first launch of the
// renamed binary we move user data (the SQLite DB and config.json) from the
// old app-data directory to the new one. The libsecret nsec is migrated
// separately via `migrate_legacy_keychain`. Idempotent: once user files are
// gone from the legacy path, subsequent runs are no-ops.
//
// We deliberately do NOT rename the whole directory: Tauri creates the new
// `app_data_dir` during webview initialisation (for CacheStorage, localstorage,
// etc.) BEFORE `setup` callbacks run, so the new dir effectively always exists
// by this point. We move individual user files instead, and leave webview
// state (which is per-bundle-id and not portable) where it sits.
fn migrate_legacy_data_dir(app: &tauri::AppHandle) -> Result<(), String> {
    let Ok(home) = std::env::var("HOME") else {
        return Ok(());
    };
    let old_dir = PathBuf::from(&home)
        .join(".local")
        .join("share")
        .join(LEGACY_BUNDLE_ID);
    if !old_dir.exists() {
        return Ok(());
    }

    let new_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    let new_id = new_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    // 64 KiB: bigger than a schema-only SQLite stub (~28 KiB on Linux), small
    // enough that a real disco-vault DB with any releases will exceed it.
    // Used to distinguish "Tauri-created empty file" from "user already
    // started using the new install."
    const STUB_THRESHOLD: u64 = 64 * 1024;

    for filename in ["discography.db", "config.json"] {
        let src = old_dir.join(filename);
        if !src.exists() {
            continue;
        }
        let dst = new_dir.join(filename);

        if dst.exists() {
            let dst_size = std::fs::metadata(&dst)
                .map(|m| m.len())
                .unwrap_or(u64::MAX);
            if dst_size > STUB_THRESHOLD {
                eprintln!(
                    "ndisc: keeping existing {} ({} bytes) at new location; \
                     not overwriting from legacy",
                    filename, dst_size
                );
                continue;
            }
            let _ = std::fs::remove_file(&dst);
        }

        std::fs::rename(&src, &dst).map_err(|e| {
            format!(
                "rename {} -> {}: {}",
                src.display(),
                dst.display(),
                e
            )
        })?;

        if filename == "config.json" && !new_id.is_empty() {
            // Rewrite any legacy path references inside config.json.
            if let Ok(text) = std::fs::read_to_string(&dst) {
                let rewritten = text.replace(LEGACY_BUNDLE_ID, new_id);
                if rewritten != text {
                    let _ = std::fs::write(&dst, rewritten);
                }
            }
        }

        eprintln!(
            "ndisc: migrated {} -> {}",
            src.display(),
            dst.display()
        );
    }

    // If the legacy dir has nothing left, drop it. If it still holds webview
    // state (CacheStorage, localstorage, etc.) we leave it alone — that's
    // orphaned data for a now-defunct bundle id; the user can delete it by
    // hand if they want the space back.
    if let Ok(entries) = std::fs::read_dir(&old_dir) {
        if entries.filter_map(|e| e.ok()).next().is_none() {
            let _ = std::fs::remove_dir(&old_dir);
        }
    }

    Ok(())
}

fn migrate_legacy_keychain() -> Result<(), String> {
    let old = Entry::new(LEGACY_KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| e.to_string())?;
    let secret = match old.get_password() {
        Ok(s) => s,
        Err(keyring::Error::NoEntry) => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let new = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match new.get_password() {
        Ok(_) => return Ok(()), // already migrated; leave old as-is for safety
        Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    new.set_password(&secret).map_err(|e| e.to_string())?;
    // Only delete the legacy entry after a successful write to the new one.
    let _ = old.delete_credential();
    eprintln!(
        "ndisc: migrated keychain entry {} -> {}",
        LEGACY_KEYRING_SERVICE, KEYRING_SERVICE
    );
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The legacy migrations touch the real release data dir + `ndisc`
            // keychain. Skip them entirely in debug builds so `tauri dev`
            // never reads or writes the installed app's data.
            if !cfg!(debug_assertions) {
                if let Err(e) = migrate_legacy_data_dir(&app.handle()) {
                    eprintln!("ndisc: data-dir migration error: {}", e);
                }
                if let Err(e) = migrate_legacy_keychain() {
                    eprintln!("ndisc: keychain migration error: {}", e);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
            set_db_path,
            add_release,
            restore_release,
            set_cover_art_url,
            set_release_type,
            set_release_category,
            set_release_country,
            set_release_notes,
            set_release_condition,
            set_release_label,
            set_release_source,
            set_release_paired,
            set_release_catalog_number,
            set_release_discogs_id,
            set_release_disc_total,
            set_release_genres,
            list_distinct_labels,
            list_distinct_sources,
            get_label_overview,
            export_markdown,
            list_releases,
            get_release,
            delete_release,
            merge_releases,
            audit_release_folder,
            resolve_duplicate,
            find_duplicate_groups,
            recount_tracks,
            publish_reaction,
            delete_reaction,
            publish_labels,
            get_stats,
            get_library_breakdown,
            scan_directory,
            import_directory,
            scan_discogs_csv,
            import_discogs_csv,
            scan_bandcamp_csv,
            import_bandcamp_csv,
            set_discogs_token,
            get_discogs_token_status,
            clear_discogs_token,
            enrich_discogs_release,
            enrich_discogs_library,
            extract_embedded_covers,
            rescan_local_covers,
            refresh_release,
            scan_library_changes,
            reconcile_library,
            get_library_root,
            set_library_root,
            get_library_summary,
            export_published_manifest,
            sync_cover_to_disk,
            update_release_path,
            inspect_release_path,
            clear_release_path,
            generate_keypair,
            import_keypair,
            get_npub,
            clear_keypair,
            publish_release,
            publish_ids,
            unpublish_ids,
            unpublish_release,
            reconcile_published,
            audit_relays,
            purge_relay_events,
            check_relays,
            list_feed_drafts,
            save_feed_draft,
            delete_feed_draft,
            publish_feed_note,
            unpublish_feed_note,
            publish_registry,
            approve_feed_note,
            revoke_approval
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod comment_url {
    use super::*;

    #[test]
    fn lifts_bandcamp_url_from_visit_comment() {
        assert_eq!(
            first_http_url("Visit https://artist.bandcamp.com"),
            Some("https://artist.bandcamp.com".into())
        );
    }

    #[test]
    fn trims_trailing_punctuation() {
        assert_eq!(
            first_http_url("See (https://example.com/album)."),
            Some("https://example.com/album".into())
        );
    }

    #[test]
    fn takes_first_url_when_several() {
        assert_eq!(
            first_http_url("http://a.test and https://b.test"),
            Some("http://a.test".into())
        );
    }

    #[test]
    fn none_when_no_url() {
        assert_eq!(first_http_url("just a plain note"), None);
        assert_eq!(first_http_url(""), None);
        // A bare scheme with no host is rejected (len guard).
        assert_eq!(first_http_url("https://"), None);
    }
}

// ---------------------------------------------------------------------------
// Schema contract test — kind:31237 release event (schema/release.v1.json)
// ---------------------------------------------------------------------------
// Pins `release_event`'s output to the frozen v1 wire contract shared with the
// glmps viewers. A failure here means the emitted event format drifted: that
// is a coordinated v2 bump (add schema/release.v2.json), never a test edit.
#[cfg(test)]
mod schema_v1 {
    use super::*;

    // A release with every optional column null.
    fn base_release() -> Release {
        Release {
            id: Some(42),
            artist: "Aphex Twin".into(),
            title: "Selected Ambient Works 85-92".into(),
            year: None,
            medium: None,
            format: None,
            label: None,
            catalog_number: None,
            country: None,
            condition: None,
            notes: None,
            source: None,
            file_path: None,
            cover_art_path: None,
            cover_art_url: None,
            discogs_id: None,
            bandcamp_id: None,
            release_type: None,
            category: None,
            genre_primary: None,
            genre_secondary: None,
            genre_tertiary: None,
            last_published_at: None,
            last_published_naddr: None,
            publish_state: None,
            last_published_event_id: None,
            added_at: None,
            updated_at: None,
            track_count: None,
            track_total: None,
            disc_total: None,
            video_count: None,
        }
    }

    fn tag_names(ev: &Event) -> Vec<String> {
        let mut names: Vec<String> = ev
            .tags
            .iter()
            .filter_map(|t| t.as_slice().first().cloned())
            .collect();
        names.sort();
        names
    }

    fn i_tags(ev: &Event) -> Vec<String> {
        ev.tags
            .iter()
            .filter_map(|t| {
                let s = t.as_slice();
                if s.len() >= 2 && s[0] == "i" {
                    Some(s[1].clone())
                } else {
                    None
                }
            })
            .collect()
    }

    #[test]
    fn kind_is_frozen_at_31237() {
        assert_eq!(KIND_RELEASE, 31237);
        let ev = release_event(&Keys::generate(), &base_release()).unwrap();
        assert_eq!(ev.kind, Kind::Custom(KIND_RELEASE));
    }

    #[test]
    fn d_tag_uses_frozen_disco_vault_prefix() {
        let ev = release_event(&Keys::generate(), &base_release()).unwrap();
        assert_eq!(tag_value(&ev, "d"), Some("disco-vault:42"));
    }

    #[test]
    fn minimal_release_emits_only_guaranteed_tags() {
        // Every optional column null -> only d/title/artist. Notably NO
        // `medium` tag: consumers must require only `d` structurally.
        let ev = release_event(&Keys::generate(), &base_release()).unwrap();
        assert_eq!(tag_names(&ev), vec!["artist", "d", "title"]);
        assert_eq!(tag_value(&ev, "medium"), None);
        assert_eq!(ev.content, "");
    }

    #[test]
    fn full_release_emits_every_tag_with_pinned_names() {
        let r = Release {
            year: Some(1992),
            medium: Some("digital".into()),
            format: Some("FLAC".into()),
            label: Some("Apollo".into()),
            catalog_number: Some("AMB3922".into()),
            country: Some("UK".into()),
            condition: Some("Near Mint (NM or M-)".into()),
            notes: Some("First three albums, remastered.".into()),
            source: Some("https://www.discogs.com/release/12345".into()),
            cover_art_url: Some("https://i.nostr.build/example.jpg".into()),
            discogs_id: Some(12345),
            bandcamp_id: Some("0000-aphex-saw8592".into()),
            release_type: Some("music".into()),
            category: Some("album".into()),
            ..base_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();

        assert_eq!(ev.content, "First three albums, remastered.");
        assert_eq!(tag_value(&ev, "d"), Some("disco-vault:42"));
        assert_eq!(tag_value(&ev, "title"), Some("Selected Ambient Works 85-92"));
        assert_eq!(tag_value(&ev, "artist"), Some("Aphex Twin"));
        assert_eq!(tag_value(&ev, "type"), Some("music"));
        assert_eq!(tag_value(&ev, "category"), Some("album"));
        assert_eq!(tag_value(&ev, "medium"), Some("digital"));
        assert_eq!(tag_value(&ev, "format"), Some("FLAC"));
        assert_eq!(tag_value(&ev, "year"), Some("1992"));
        assert_eq!(tag_value(&ev, "label"), Some("Apollo"));
        assert_eq!(tag_value(&ev, "catalog"), Some("AMB3922"));
        assert_eq!(tag_value(&ev, "country"), Some("UK"));
        assert_eq!(tag_value(&ev, "condition"), Some("Near Mint (NM or M-)"));
        assert_eq!(
            tag_value(&ev, "source"),
            Some("https://www.discogs.com/release/12345"),
        );
        assert_eq!(
            tag_value(&ev, "image"),
            Some("https://i.nostr.build/example.jpg"),
        );

        // `i` carries the discogs external ID (NIP-73). bandcamp_id is
        // local-only and intentionally never emitted — assert its absence.
        let ids = i_tags(&ev);
        assert!(ids.contains(&"discogs:release:12345".to_string()));
        assert!(!ids.iter().any(|s| s.starts_with("musicbrainz:")));
        assert!(!ids.iter().any(|s| s.starts_with("bandcamp:")));
    }

    #[test]
    fn source_tag_is_omitted_when_not_an_http_url() {
        let r = Release {
            source: Some("not-a-url".into()),
            ..base_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();
        assert_eq!(tag_value(&ev, "source"), None);
    }

    // v2 minimal must be byte-equivalent to v1 minimal: a release with no
    // genre slots set emits the same tag set as v1 with the same fields
    // empty. This is the additive-rule guarantee.
    #[test]
    fn v2_minimal_is_indistinguishable_from_v1_minimal() {
        let ev = release_event(&Keys::generate(), &base_release()).unwrap();
        assert_eq!(tag_names(&ev), vec!["artist", "d", "title"]);
        // No genre tag when all three slots are None.
        assert!(
            ev.tags
                .iter()
                .filter(|t| t.as_slice().first().map(|s| s.as_str()) == Some("genre"))
                .count()
                == 0
        );
    }
}

// ---------------------------------------------------------------------------
// Schema contract test — kind:31237 release event v2 (schema/release.v2.json)
// ---------------------------------------------------------------------------
// Pins release_event()'s v2-specific output to the v2 wire contract shared
// with the glmps viewers. v2 is additive over v1: the only new tag is
// `genre` (0-3 repeatable, ordered). A failure here means v2 emission has
// drifted: that is a coordinated v3 bump, never a test edit.
//
// schema_v1 above still covers the no-genre case as the historic fixture;
// the two modules together cover the rollout window.
#[cfg(test)]
mod schema_v2 {
    use super::*;

    fn base_v2_release() -> Release {
        Release {
            id: Some(42),
            artist: "Aphex Twin".into(),
            title: "Selected Ambient Works 85-92".into(),
            year: None,
            medium: None,
            format: None,
            label: None,
            catalog_number: None,
            country: None,
            condition: None,
            notes: None,
            source: None,
            file_path: None,
            cover_art_path: None,
            cover_art_url: None,
            discogs_id: None,
            bandcamp_id: None,
            release_type: None,
            category: None,
            genre_primary: None,
            genre_secondary: None,
            genre_tertiary: None,
            last_published_at: None,
            last_published_naddr: None,
            publish_state: None,
            last_published_event_id: None,
            added_at: None,
            updated_at: None,
            track_count: None,
            track_total: None,
            disc_total: None,
            video_count: None,
        }
    }

    fn genre_tags(ev: &Event) -> Vec<String> {
        ev.tags
            .iter()
            .filter_map(|t| {
                let s = t.as_slice();
                if s.len() >= 2 && s[0] == "genre" {
                    Some(s[1].clone())
                } else {
                    None
                }
            })
            .collect()
    }

    #[test]
    fn one_slot_emits_one_genre_tag() {
        let r = Release {
            genre_primary: Some("techno".into()),
            ..base_v2_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();
        assert_eq!(genre_tags(&ev), vec!["techno"]);
    }

    #[test]
    fn three_slots_emit_three_genre_tags_in_order() {
        let r = Release {
            genre_primary: Some("techno".into()),
            genre_secondary: Some("dub".into()),
            genre_tertiary: Some("downtempo".into()),
            ..base_v2_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();
        // Order is the priority order — must match field order exactly.
        assert_eq!(
            genre_tags(&ev),
            vec!["techno", "dub", "downtempo"]
        );
    }

    fn tracks_tag(ev: &Event) -> Option<String> {
        ev.tags.iter().find_map(|t| {
            let s = t.as_slice();
            (s.len() >= 2 && s[0] == "tracks").then(|| s[1].clone())
        })
    }

    // v2 additive: expected total tracks. Optional — present only when known.
    #[test]
    fn tracks_tag_emitted_when_total_known() {
        let r = Release {
            track_total: Some(12),
            ..base_v2_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();
        assert_eq!(tracks_tag(&ev), Some("12".into()));
    }

    #[test]
    fn tracks_tag_omitted_when_total_unknown() {
        let ev = release_event(&Keys::generate(), &base_v2_release()).unwrap();
        assert_eq!(tracks_tag(&ev), None);
    }

    fn discs_tag(ev: &Event) -> Option<String> {
        ev.tags.iter().find_map(|t| {
            let s = t.as_slice();
            (s.len() >= 2 && s[0] == "discs").then(|| s[1].clone())
        })
    }

    // v2 additive: total disc count. Optional — emitted only when > 0.
    #[test]
    fn discs_tag_emitted_when_disc_total_known() {
        let r = Release {
            disc_total: Some(32),
            ..base_v2_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();
        assert_eq!(discs_tag(&ev), Some("32".into()));
    }

    #[test]
    fn discs_tag_omitted_when_disc_total_absent_or_zero() {
        let ev = release_event(&Keys::generate(), &base_v2_release()).unwrap();
        assert_eq!(discs_tag(&ev), None);
        let zero = Release {
            disc_total: Some(0),
            ..base_v2_release()
        };
        let ev0 = release_event(&Keys::generate(), &zero).unwrap();
        assert_eq!(discs_tag(&ev0), None);
    }

    #[test]
    fn two_slots_emit_two_genre_tags_in_order() {
        let r = Release {
            genre_primary: Some("electronic".into()),
            genre_secondary: Some("jazz".into()),
            ..base_v2_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();
        assert_eq!(genre_tags(&ev), vec!["electronic", "jazz"]);
    }

    #[test]
    fn atomic_hyphen_slug_emitted_verbatim() {
        // `hip-hop` is a single atomic slug whose name contains a hyphen — it
        // is NOT a compound pair and must emit verbatim on the wire (the slash
        // render rule is scoped to the four retired pairs only).
        let r = Release {
            genre_primary: Some("hip-hop".into()),
            ..base_v2_release()
        };
        let ev = release_event(&Keys::generate(), &r).unwrap();
        assert_eq!(genre_tags(&ev), vec!["hip-hop"]);
    }

    #[test]
    fn deprecated_compound_pairs_rejected_by_validator() {
        // The 2026-06 restructure retired the four compound slash-pairs; they
        // must never validate for a new write (split/collapsed into atomic
        // slugs). They remain valid for legacy *reads* in consumers only.
        for slug in ["classical-folk", "dnb-jungle", "drone-noise", "footwork-trap"] {
            let slots = [Some(slug.to_string()), None, None];
            assert!(
                validate_genre_slots(&slots).is_err(),
                "deprecated pair '{}' must be rejected by the emitter validator",
                slug
            );
        }
    }

    #[test]
    fn restructure_atomic_slugs_accepted_by_validator() {
        // The atomic slugs the pairs split/collapsed into, plus a sampling of
        // the other slugs added in the restructure, must all validate.
        for slug in [
            "classical", "folk", "dnb", "jungle", "noise", "footwork", "blues",
            "latin", "metal", "spoken", "rnb", "soul", "boom-bap", "lo-fi",
            "conscious", "trance", "trap", "disco", "garage", "turntablism",
        ] {
            let slots = [Some(slug.to_string()), None, None];
            assert!(
                validate_genre_slots(&slots).is_ok(),
                "active slug '{}' must be accepted by the emitter validator",
                slug
            );
        }
    }

    // --- 2026-06 restructure DB slot remap ---------------------------------

    fn slot(s: &str) -> Option<String> {
        Some(s.to_string())
    }

    #[test]
    fn remap_collapses_pair_to_single_atomic() {
        // drone-noise → noise, footwork-trap → footwork (1:1 collapses).
        assert_eq!(
            remap_restructured_genre_slots([slot("drone-noise"), None, None]),
            [slot("noise"), None, None]
        );
        assert_eq!(
            remap_restructured_genre_slots([slot("footwork-trap"), None, None]),
            [slot("footwork"), None, None]
        );
    }

    #[test]
    fn remap_splits_pair_into_two_atomics_when_room() {
        // classical-folk alone → classical + folk across the first two slots.
        assert_eq!(
            remap_restructured_genre_slots([slot("classical-folk"), None, None]),
            [slot("classical"), slot("folk"), None]
        );
        // dnb-jungle in slot 0 with another genre in slot 1 → dnb, jungle, x.
        assert_eq!(
            remap_restructured_genre_slots([slot("dnb-jungle"), slot("techno"), None]),
            [slot("dnb"), slot("jungle"), slot("techno")]
        );
    }

    #[test]
    fn remap_split_overflow_drops_the_overflow() {
        // classical-folk + two more = would be 4 slugs; capped to 3 dense.
        assert_eq!(
            remap_restructured_genre_slots([
                slot("classical-folk"),
                slot("ambient"),
                slot("techno"),
            ]),
            [slot("classical"), slot("folk"), slot("ambient")]
        );
    }

    #[test]
    fn remap_dedupes_when_split_atomic_already_present() {
        // dnb-jungle then dnb → dnb + jungle (no duplicate dnb).
        assert_eq!(
            remap_restructured_genre_slots([slot("dnb-jungle"), slot("dnb"), None]),
            [slot("dnb"), slot("jungle"), None]
        );
    }

    #[test]
    fn remap_leaves_active_slugs_untouched() {
        assert_eq!(
            remap_restructured_genre_slots([slot("hip-hop"), slot("jazz"), None]),
            [slot("hip-hop"), slot("jazz"), None]
        );
        assert_eq!(remap_restructured_genre_slots([None, None, None]), [None, None, None]);
    }

    #[test]
    fn validate_genre_slots_accepts_zero_slots() {
        let slots = [None, None, None];
        assert!(validate_genre_slots(&slots).is_ok());
    }

    #[test]
    fn validate_genre_slots_accepts_primary_only() {
        let slots = [Some("techno".into()), None, None];
        assert!(validate_genre_slots(&slots).is_ok());
    }

    #[test]
    fn validate_genre_slots_accepts_three_distinct() {
        let slots = [
            Some("techno".into()),
            Some("dub".into()),
            Some("downtempo".into()),
        ];
        assert!(validate_genre_slots(&slots).is_ok());
    }

    #[test]
    fn validate_genre_slots_rejects_unknown_slug() {
        let slots = [Some("hyperpop".into()), None, None];
        assert!(validate_genre_slots(&slots).is_err());
    }

    #[test]
    fn validate_genre_slots_rejects_duplicate() {
        let slots = [
            Some("techno".into()),
            Some("techno".into()),
            None,
        ];
        assert!(validate_genre_slots(&slots).is_err());
    }

    #[test]
    fn validate_genre_slots_rejects_renamed_2026_06b() {
        // poetry → spoken, spiritual → conscious: the old slugs are retired to
        // `deprecated` and must NOT be emittable (valid on read only).
        for old in ["poetry", "spiritual"] {
            let slots = [Some(old.to_string()), None, None];
            assert!(
                validate_genre_slots(&slots).is_err(),
                "retired slug '{}' must be rejected by the emitter validator",
                old
            );
        }
    }

    #[test]
    fn validate_genre_slots_accepts_electronic_plus_sub() {
        // v2.1: pure peers — `electronic` + `techno` is allowed; meaning
        // composes by stacking slugs.
        let slots = [
            Some("electronic".into()),
            Some("techno".into()),
            None,
        ];
        assert!(validate_genre_slots(&slots).is_ok());
    }

    #[test]
    fn validate_genre_slots_rejects_hole_at_slot_0() {
        let slots = [None, Some("techno".into()), None];
        assert!(validate_genre_slots(&slots).is_err());
    }

    #[test]
    fn validate_genre_slots_rejects_hole_at_slot_1() {
        let slots = [
            Some("techno".into()),
            None,
            Some("jazz".into()),
        ];
        assert!(validate_genre_slots(&slots).is_err());
    }

    #[test]
    fn validate_genre_slots_accepts_cross_family_pair() {
        // techno (electronic sub) + jazz (different main) — peers.
        let slots = [
            Some("techno".into()),
            Some("jazz".into()),
            None,
        ];
        assert!(validate_genre_slots(&slots).is_ok());
    }
}

// ---------------------------------------------------------------------------
// Schema contract test — kind:31239 feed note v1 (schema/feed.v1.json)
// ---------------------------------------------------------------------------
// Pins feed_event()'s output to the feed.v1 wire contract shared with the
// glmps + ndisc.view viewers (lib/feed.ts). A failure here means the emitter
// drifted from the contract: that is a coordinated feed.v2 bump, never a test
// edit. The kind is 31239 — its own kind, NOT 31238 (labels.v1).
#[cfg(test)]
mod schema_feed_v1 {
    use super::*;

    fn base_draft() -> FeedDraft {
        FeedDraft {
            id: Some(7),
            title: None,
            body: None,
            release_ref: None,
            images: vec![],
            links: vec![],
            topics: vec![],
            published_at: Some(1_700_000_000),
            last_published_at: None,
            last_published_event: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn tag1(ev: &Event, name: &str) -> Option<String> {
        ev.tags.iter().find_map(|t| {
            let s = t.as_slice();
            (s.len() >= 2 && s[0] == name).then(|| s[1].clone())
        })
    }
    fn tag_all(ev: &Event, name: &str) -> Vec<String> {
        ev.tags
            .iter()
            .filter_map(|t| {
                let s = t.as_slice();
                (s.len() >= 2 && s[0] == name).then(|| s[1].clone())
            })
            .collect()
    }

    #[test]
    fn kind_is_31239_not_31238() {
        let ev = feed_event(&Keys::generate(), &base_draft()).unwrap();
        assert_eq!(u16::from(ev.kind), 31239);
        assert_ne!(u16::from(ev.kind), KIND_LABELS);
    }

    #[test]
    fn d_tag_is_glmps_id() {
        let ev = feed_event(&Keys::generate(), &base_draft()).unwrap();
        assert_eq!(tag1(&ev, "d"), Some("glmps:7".into()));
    }

    #[test]
    fn body_is_content_and_published_at_emitted() {
        let d = FeedDraft {
            body: Some("a few words".into()),
            ..base_draft()
        };
        let ev = feed_event(&Keys::generate(), &d).unwrap();
        assert_eq!(ev.content, "a few words");
        assert_eq!(tag1(&ev, "published_at"), Some("1700000000".into()));
    }

    #[test]
    fn release_reference_is_an_a_tag() {
        let d = FeedDraft {
            release_ref: Some("31237:abc:disco-vault:314".into()),
            ..base_draft()
        };
        let ev = feed_event(&Keys::generate(), &d).unwrap();
        assert_eq!(tag1(&ev, "a"), Some("31237:abc:disco-vault:314".into()));
    }

    #[test]
    fn standalone_note_has_no_a_tag() {
        let ev = feed_event(&Keys::generate(), &base_draft()).unwrap();
        assert_eq!(tag1(&ev, "a"), None);
    }

    #[test]
    fn images_links_topics_are_repeatable_and_topics_lowercased() {
        let d = FeedDraft {
            images: vec!["https://img/1.jpg".into(), "https://img/2.jpg".into()],
            links: vec!["https://label/x".into()],
            topics: vec!["Shoegaze".into(), "Reissue".into()],
            ..base_draft()
        };
        let ev = feed_event(&Keys::generate(), &d).unwrap();
        assert_eq!(tag_all(&ev, "image"), vec!["https://img/1.jpg", "https://img/2.jpg"]);
        assert_eq!(tag_all(&ev, "r"), vec!["https://label/x"]);
        assert_eq!(tag_all(&ev, "t"), vec!["shoegaze", "reissue"]);
    }

    #[test]
    fn alt_falls_back_to_title_then_body() {
        let titled = FeedDraft {
            title: Some("A headline".into()),
            body: Some("the body".into()),
            ..base_draft()
        };
        assert_eq!(
            tag1(&feed_event(&Keys::generate(), &titled).unwrap(), "alt"),
            Some("A headline".into())
        );
        let untitled = FeedDraft {
            body: Some("body becomes alt".into()),
            ..base_draft()
        };
        assert_eq!(
            tag1(&feed_event(&Keys::generate(), &untitled).unwrap(), "alt"),
            Some("body becomes alt".into())
        );
    }

    // Curation events (Phase 5) — registry (30000) + sign-off (4550).

    #[test]
    fn registry_is_30000_with_fixed_d_and_p_tags() {
        let ev = registry_event(
            &Keys::generate(),
            &["aa".repeat(32), "bb".repeat(32)],
        )
        .unwrap();
        assert_eq!(u16::from(ev.kind), 30000);
        assert_eq!(tag1(&ev, "d"), Some("glmps:contributors".into()));
        assert_eq!(tag_all(&ev, "p"), vec!["aa".repeat(32), "bb".repeat(32)]);
    }

    #[test]
    fn empty_registry_has_no_p_tags() {
        let ev = registry_event(&Keys::generate(), &[]).unwrap();
        assert_eq!(u16::from(ev.kind), 30000);
        assert!(tag_all(&ev, "p").is_empty());
    }

    #[test]
    fn approval_is_4550_with_a_e_p_k_tags() {
        let addr = "31239:cc00112233445566778899aabbccddeeff00112233445566778899aabbccddee:glmps:5";
        let note_id = "ff".repeat(32);
        let author = "dd".repeat(32);
        let ev = approval_event(&Keys::generate(), addr, &note_id, &author).unwrap();
        assert_eq!(u16::from(ev.kind), 4550);
        assert_eq!(tag1(&ev, "a"), Some(addr.into()));
        assert_eq!(tag1(&ev, "e"), Some(note_id));
        assert_eq!(tag1(&ev, "p"), Some(author));
        // k references the approved kind — the feed note kind, 31239.
        assert_eq!(tag1(&ev, "k"), Some("31239".into()));
    }
}

#[cfg(test)]
mod discogs_enrich {
    use super::*;

    fn parse(json: &str) -> DiscogsRelease {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn counts_plain_tracklist_and_single_disc() {
        let rel = parse(
            r#"{
              "formats": [{"name":"Vinyl","qty":"1","descriptions":["LP","Album"]}],
              "tracklist": [
                {"position":"A1","type_":"track","title":"One"},
                {"position":"A2","type_":"track","title":"Two"},
                {"position":"B1","type_":"track","title":"Three"}
              ]
            }"#,
        );
        let (tt, dt) = counts_from(&rel);
        assert_eq!(tt, Some(3));
        assert_eq!(dt, Some(1));
    }

    #[test]
    fn headings_are_not_counted_as_tracks() {
        let rel = parse(
            r#"{
              "formats": [{"qty":"1"}],
              "tracklist": [
                {"position":"","type_":"heading","title":"Side A"},
                {"position":"A1","type_":"track","title":"One"},
                {"position":"","type_":"heading","title":"Side B"},
                {"position":"B1","type_":"track","title":"Two"}
              ]
            }"#,
        );
        assert_eq!(counts_from(&rel).0, Some(2));
    }

    #[test]
    fn index_track_counts_its_subtracks() {
        let rel = parse(
            r#"{
              "formats": [{"qty":"1"}],
              "tracklist": [
                {"position":"A","type_":"index","title":"Medley","sub_tracks":[
                  {"position":"","type_":"track","title":"a"},
                  {"position":"","type_":"track","title":"b"}
                ]},
                {"position":"B","type_":"track","title":"Solo"}
              ]
            }"#,
        );
        // 2 sub-tracks + 1 plain = 3.
        assert_eq!(counts_from(&rel).0, Some(3));
    }

    #[test]
    fn index_track_without_subtracks_counts_one() {
        let rel = parse(
            r#"{"formats":[{"qty":"1"}],"tracklist":[
                {"position":"A","type_":"index","title":"Suite"}
            ]}"#,
        );
        assert_eq!(counts_from(&rel).0, Some(1));
    }

    #[test]
    fn typeless_positioned_rows_count_as_tracks() {
        // Older Discogs entries omit type_ entirely.
        let rel = parse(
            r#"{"formats":[{"qty":"1"}],"tracklist":[
                {"position":"1","title":"One"},
                {"position":"2","title":"Two"}
            ]}"#,
        );
        assert_eq!(counts_from(&rel).0, Some(2));
    }

    #[test]
    fn disc_total_sums_format_quantities() {
        let rel = parse(
            r#"{"tracklist":[],"formats":[
                {"name":"Vinyl","qty":"2"},
                {"name":"Vinyl","qty":"1"}
            ]}"#,
        );
        // 2×LP + bonus 7" = 3 discs; empty tracklist → no track_total.
        let (tt, dt) = counts_from(&rel);
        assert_eq!(dt, Some(3));
        assert_eq!(tt, None);
    }

    #[test]
    fn missing_qty_on_physical_format_floors_to_one() {
        let rel = parse(r#"{"tracklist":[],"formats":[{"name":"CD"}]}"#);
        assert_eq!(counts_from(&rel).1, Some(1));
    }

    #[test]
    fn enrichment_extracts_label_catalog_country_category() {
        let rel = parse(
            r#"{
                "country":"UK",
                "labels":[{"name":"Warp Records","catno":"WARPCD21"}],
                "formats":[{"name":"CD","qty":"1","descriptions":["Album"]}],
                "tracklist":[{"position":"1","type_":"track"}]
            }"#,
        );
        let e = enrichment_from(&rel);
        assert_eq!(e.country.as_deref(), Some("UK"));
        assert_eq!(e.label.as_deref(), Some("Warp Records"));
        assert_eq!(e.catalog.as_deref(), Some("WARPCD21"));
        assert_eq!(e.category.as_deref(), Some("album"));
        assert_eq!(e.track_total, Some(1));
    }

    #[test]
    fn format_display_spells_out_colour_from_text() {
        // The vinyl colour lives in `text`, not `descriptions`; the rebuilt
        // string appends it spelled out (vs the CSV's clipped "Gre").
        let rel = parse(
            r#"{"tracklist":[],"formats":[
                {"name":"Vinyl","qty":"1","text":"Green","descriptions":["7\"","Single"]}
            ]}"#,
        );
        assert_eq!(
            enrichment_from(&rel).format.as_deref(),
            Some("7\", Single, Green")
        );
    }

    #[test]
    fn format_display_keeps_non_vinyl_name_and_qty_prefix() {
        // Non-vinyl keeps its medium name; qty>1 becomes an "Nx" prefix.
        let cd = parse(r#"{"tracklist":[],"formats":[{"name":"CD","qty":"1","descriptions":["Album"]}]}"#);
        assert_eq!(enrichment_from(&cd).format.as_deref(), Some("CD, Album"));
        let dbl = parse(r#"{"tracklist":[],"formats":[{"name":"Vinyl","qty":"2","descriptions":["12\"","Album"]}]}"#);
        assert_eq!(enrichment_from(&dbl).format.as_deref(), Some("2x12\", Album"));
    }

    #[test]
    fn format_display_joins_multiple_media() {
        let rel = parse(
            r#"{"tracklist":[],"formats":[
                {"name":"Vinyl","qty":"1","descriptions":["12\"","Album"]},
                {"name":"CD","qty":"1","descriptions":["Album"]}
            ]}"#,
        );
        assert_eq!(
            enrichment_from(&rel).format.as_deref(),
            Some("12\", Album + CD, Album")
        );
    }

    #[test]
    fn abbrev_detection_matches_clipped_and_short_codes() {
        // Clipped colour, prefix descriptor, and a non-prefix short code.
        assert!(format_is_abbrev_of("7\", Gre", "7\", Green"));
        assert!(format_is_abbrev_of("12\", EP, Num, Cle", "12\", EP, Numbered, Clear"));
        assert!(format_is_abbrev_of("12\", Ltd", "12\", Limited Edition"));
        // An identical (already-full) string trivially "matches".
        assert!(format_is_abbrev_of("CD, Album", "CD, Album"));
    }

    #[test]
    fn abbrev_detection_rejects_structurally_different() {
        // Different token count / hand-curated note must NOT be overwritten.
        assert!(!format_is_abbrev_of("7\", Green vinyl, my note", "7\", Green"));
        assert!(!format_is_abbrev_of("CD", "12\", Album"));
        assert!(!format_is_abbrev_of("", "7\", Green"));
    }

    #[test]
    fn enrichment_treats_catno_none_as_empty() {
        let rel = parse(
            r#"{"labels":[{"name":"Self","catno":"none"}],"formats":[],"tracklist":[]}"#,
        );
        let e = enrichment_from(&rel);
        assert_eq!(e.catalog, None);
        assert_eq!(e.label.as_deref(), Some("Self"));
    }

    #[test]
    fn no_physical_formats_yields_no_disc_count() {
        // No formats at all, and a container-only release, are not "1 disc".
        let empty = parse(r#"{"tracklist":[],"formats":[]}"#);
        assert_eq!(counts_from(&empty).1, None);
        let boxed = parse(r#"{"tracklist":[],"formats":[{"name":"Box Set","qty":"1"}]}"#);
        assert_eq!(counts_from(&boxed).1, None);
    }

    #[test]
    fn digital_file_format_has_no_discs() {
        // Regression: Discogs gives a digital release one "File" format whose
        // qty is the FILE (track) count, not a disc count — "4×File" is 4
        // tracks and 0 discs, never disc_total = 4.
        let rel = parse(
            r#"{"formats":[{"name":"File","qty":"4","descriptions":["ALAC"]}],
                "tracklist":[
                  {"position":"1","type_":"track"},{"position":"2","type_":"track"},
                  {"position":"3","type_":"track"},{"position":"4","type_":"track"}
                ]}"#,
        );
        let (tt, dt) = counts_from(&rel);
        assert_eq!(tt, Some(4));
        assert_eq!(dt, None);
    }

    #[test]
    fn box_set_container_excluded_inner_discs_counted() {
        // A box set lists the container plus the real disc lines; the box's
        // qty=1 must not inflate the count — only the inner CDs count.
        let rel = parse(
            r#"{"tracklist":[],"formats":[
                {"name":"Box Set","qty":"1"},
                {"name":"CD","qty":"5"}
            ]}"#,
        );
        assert_eq!(counts_from(&rel).1, Some(5));
    }

    #[test]
    fn parses_discogs_id_from_bare_int_and_urls() {
        assert_eq!(parse_discogs_input("123456"), Ok(Some(123456)));
        assert_eq!(parse_discogs_input("  789 "), Ok(Some(789)));
        assert_eq!(
            parse_discogs_input("https://www.discogs.com/release/20209-Whatever"),
            Ok(Some(20209)),
        );
        assert_eq!(
            parse_discogs_input("https://www.discogs.com/release/42"),
            Ok(Some(42)),
        );
        assert_eq!(parse_discogs_input(""), Ok(None));
        assert_eq!(parse_discogs_input("   "), Ok(None));
        assert!(parse_discogs_input("not-an-id").is_err());
        assert!(parse_discogs_input("0").is_err());
    }

    #[test]
    fn track_count_caps_at_99() {
        let items: String = (1..=120)
            .map(|i| format!(r#"{{"position":"{i}","type_":"track","title":"t"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let rel = parse(&format!(r#"{{"formats":[{{"qty":"1"}}],"tracklist":[{items}]}}"#));
        assert_eq!(counts_from(&rel).0, Some(99));
    }
}

#[cfg(test)]
mod stats {
    use super::*;
    use rusqlite::Connection;

    /// Spin up an in-memory DB with a `releases` table that mirrors the
    /// columns `library_breakdown_from_conn` reads. Only the columns the
    /// SQL touches need to exist; the production migration is irrelevant
    /// for breakdown testing.
    fn seed_conn(rows: &[(&str, &str, Option<i32>, Option<&str>, Option<&str>, &str, Option<&str>, Option<&str>, Option<&str>)]) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE releases (
               artist          TEXT NOT NULL,
               title           TEXT NOT NULL,
               year            INTEGER,
               medium          TEXT,
               format          TEXT,
               country         TEXT,
               label           TEXT,
               genre_primary   TEXT,
               genre_secondary TEXT,
               genre_tertiary  TEXT
             );",
        )
        .unwrap();
        for (artist, title, year, medium, format, country, label, gp, gs) in rows {
            // (artist, title, year, medium, format, country, label,
            //  genre_primary, genre_secondary). genre_tertiary stays NULL.
            conn.execute(
                "INSERT INTO releases (artist, title, year, medium, format, country, label,
                                       genre_primary, genre_secondary, genre_tertiary)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)",
                params![artist, title, year, medium, format, country, label, gp, gs],
            )
            .unwrap();
        }
        conn
    }

    #[test]
    fn empty_db_yields_empty_breakdowns() {
        let conn = seed_conn(&[]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        assert!(b.genre.is_empty());
        assert!(b.country.is_empty());
        assert!(b.year.is_empty());
        assert!(b.medium.is_empty());
        assert!(b.format.is_empty());
        assert!(b.label.is_empty());
    }

    #[test]
    fn medium_aggregates_binary_divide() {
        let conn = seed_conn(&[
            ("A", "1", None, Some("digital"),  None, "UK", None, None, None),
            ("B", "2", None, Some("digital"),  None, "UK", None, None, None),
            ("C", "3", None, Some("physical"), None, "UK", None, None, None),
            ("D", "4", None, None,             None, "UK", None, None, None),
            ("E", "5", None, Some(""),         None, "UK", None, None, None),
        ]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        let m: Vec<_> = b.medium.iter().map(|r| (r.value.as_str(), r.count)).collect();
        assert_eq!(m, vec![("digital", 2), ("physical", 1)]);
    }

    #[test]
    fn genre_aggregates_across_slots_and_sorts_desc() {
        // electronic shows up 3x across slots, downtempo 2x, jazz 1x.
        let conn = seed_conn(&[
            ("A", "1", Some(2020), None, None, "UK", Some("L1"), Some("electronic"), Some("downtempo")),
            ("B", "2", Some(2021), None, None, "UK", Some("L1"), Some("electronic"), None),
            ("C", "3", Some(2022), None, None, "UK", Some("L2"), Some("electronic"), Some("downtempo")),
            ("D", "4", Some(2023), None, None, "US", Some("L2"), Some("jazz"),       None),
        ]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        let v: Vec<_> = b.genre.iter().map(|r| (r.value.as_str(), r.count)).collect();
        assert_eq!(v, vec![("electronic", 3), ("downtempo", 2), ("jazz", 1)]);
    }

    #[test]
    fn genre_skips_null_and_empty_slots() {
        let conn = seed_conn(&[
            ("A", "1", None, None, None, "UK", None, Some("techno"), Some("")),
            ("B", "2", None, None, None, "UK", None, None,           None),
        ]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        let v: Vec<_> = b.genre.iter().map(|r| (r.value.as_str(), r.count)).collect();
        // Empty string in secondary must NOT become a "" row.
        assert_eq!(v, vec![("techno", 1)]);
    }

    #[test]
    fn country_drops_null_and_empty() {
        let conn = seed_conn(&[
            ("A", "1", None, None, None, "UK", None, None, None),
            ("B", "2", None, None, None, "US", None, None, None),
            ("C", "3", None, None, None, "UK", None, None, None),
            ("D", "4", None, None, None, "",   None, None, None),
            ("E", "5", None, None, None, "",   None, None, None),
        ]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        let v: Vec<_> = b.country.iter().map(|r| (r.value.as_str(), r.count)).collect();
        assert_eq!(v, vec![("UK", 2), ("US", 1)]);
    }

    #[test]
    fn year_sorted_ascending_and_nulls_dropped() {
        let conn = seed_conn(&[
            ("A", "1", Some(2020), None, None, "UK", None, None, None),
            ("B", "2", Some(1968), None, None, "UK", None, None, None),
            ("C", "3", None,       None, None, "UK", None, None, None),
            ("D", "4", Some(2020), None, None, "UK", None, None, None),
            ("E", "5", Some(1992), None, None, "UK", None, None, None),
        ]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        let v: Vec<_> = b.year.iter().map(|r| (r.value.as_str(), r.count)).collect();
        assert_eq!(v, vec![("1968", 1), ("1992", 1), ("2020", 2)]);
    }

    #[test]
    fn label_sorted_desc_with_alpha_tiebreak() {
        let conn = seed_conn(&[
            ("A", "1", None, None, None, "UK", Some("Warp"),    None, None),
            ("B", "2", None, None, None, "UK", Some("Warp"),    None, None),
            ("C", "3", None, None, None, "UK", Some("Apollo"),  None, None),
            ("D", "4", None, None, None, "UK", Some("Apollo"),  None, None),
            ("E", "5", None, None, None, "UK", Some("Rephlex"), None, None),
        ]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        // Warp=2, Apollo=2 (tie -> alpha) then Rephlex=1.
        let l: Vec<_> = b.label.iter().map(|r| (r.value.as_str(), r.count)).collect();
        assert_eq!(l, vec![("Apollo", 2), ("Warp", 2), ("Rephlex", 1)]);
    }

    #[test]
    fn format_buckets_aggregate_through_sql() {
        let conn = seed_conn(&[
            ("A",  "1",  None, None, Some("FLAC 16/44.1"),  "UK", None, None, None),
            ("B",  "2",  None, None, Some("FLAC 24/96"),    "UK", None, None, None),
            ("C",  "3",  None, None, Some("MP3 320"),       "UK", None, None, None),
            ("D",  "4",  None, None, Some("MP3 192"),       "UK", None, None, None),
            ("E",  "5",  None, None, Some("MP3 128"),       "UK", None, None, None),
            ("F",  "6",  None, None, Some("12\", EP, Ltd"), "UK", None, None, None),
            ("G",  "7",  None, None, Some("LP, Album"),     "UK", None, None, None),
            ("H",  "8",  None, None, Some("10\", Single"),  "UK", None, None, None),
            ("I",  "9",  None, None, Some("7\", Single"),   "UK", None, None, None),
            ("J",  "10", None, None, Some("CD, Ltd, Dig"),  "UK", None, None, None),
            ("K",  "11", None, None, Some("Cass, Mixed"),   "UK", None, None, None),
            ("L",  "12", None, None, Some("Box, Ltd, Num"), "UK", None, None, None),
            // Flexi/file with no recognised prefix lands in other_physical.
            ("M",  "13", None, None, Some("Flexi, 7\""),    "UK", None, None, None),
            // NULL format drops out — no bucket.
            ("N",  "14", None, None, None,                  "UK", None, None, None),
        ]);
        let b = library_breakdown_from_conn(&conn).unwrap();
        let f: Vec<_> = b.format.iter().map(|r| (r.value.as_str(), r.count)).collect();
        // count DESC, alpha tiebreak: lossy=3 leads; then the two count-2
        // buckets (lossless and vinyl_12 — 12" + LP both land in vinyl_12)
        // alpha-sorted; then the six 1-count buckets alpha-sorted.
        assert_eq!(
            f,
            vec![
                ("lossy", 3),
                ("lossless", 2),
                ("vinyl_12", 2),
                ("box", 1),
                ("cassette", 1),
                ("cd", 1),
                ("other_physical", 1),
                ("vinyl_10", 1),
                ("vinyl_7", 1),
            ]
        );
    }

    #[test]
    fn bucket_format_classifies_real_strings() {
        // Lossless: FLAC / AIFF / ALAC / AIF — even inside composite strings.
        assert_eq!(bucket_format("FLAC 16/44.1"), "lossless");
        assert_eq!(bucket_format("FLAC 24/96"), "lossless");
        assert_eq!(bucket_format("AIFF 16/44.1"), "lossless");
        assert_eq!(bucket_format("AIF 16/44.1"), "lossless");
        assert_eq!(bucket_format("8xFile, FLAC, Album, Comp"), "lossless");
        assert_eq!(bucket_format("4xFile, ALAC"), "lossless");
        // Lossy: MP3 / OGG / AAC / WMA — any bitrate, any descriptor.
        assert_eq!(bucket_format("MP3 320"), "lossy");
        assert_eq!(bucket_format("MP3 128"), "lossy");
        assert_eq!(bucket_format("MP3 24/48"), "lossy");
        // Vinyl 12" — also LP / 2xLP / 3xLP / 4xLP / 2x12" / 3x12".
        assert_eq!(bucket_format("12\""), "vinyl_12");
        assert_eq!(bucket_format("12\", EP, Ltd"), "vinyl_12");
        assert_eq!(bucket_format("LP, Album"), "vinyl_12");
        assert_eq!(bucket_format("2xLP, Album"), "vinyl_12");
        assert_eq!(bucket_format("3xLP, Comp"), "vinyl_12");
        assert_eq!(bucket_format("2x12\", Album"), "vinyl_12");
        // Vinyl 10" / 7"
        assert_eq!(bucket_format("10\""), "vinyl_10");
        assert_eq!(bucket_format("7\", Single, Ltd"), "vinyl_7");
        // Other physical sub-buckets
        assert_eq!(bucket_format("CD, Ltd, Dig"), "cd");
        assert_eq!(bucket_format("Cass, Mixed"), "cassette");
        assert_eq!(bucket_format("Box, Ltd, Num"), "box");
        // Residual: flexi prefix doesn't qualify as vinyl_7 even though the
        // string contains 7" — first-token match wins.
        assert_eq!(
            bucket_format("Flexi, 7\", S/Sided, Single, Whi"),
            "other_physical"
        );
    }

    #[test]
    fn breakdown_row_serialises_camel_case() {
        // Pin the IPC shape: { value, count } as plain camelCase.
        let row = BreakdownRow { value: "techno".into(), count: 42 };
        let json = serde_json::to_string(&row).unwrap();
        assert_eq!(json, r#"{"value":"techno","count":42}"#);
    }
}


#[cfg(test)]
mod reconcile_root {
    use super::*;
    use rusqlite::Connection;

    fn seed(paths: &[Option<&str>]) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE releases (file_path TEXT);")
            .unwrap();
        for p in paths {
            conn.execute("INSERT INTO releases (file_path) VALUES (?1)", params![p])
                .unwrap();
        }
        conn
    }

    #[test]
    fn common_prefix_of_a_shared_tree() {
        let conn = seed(&[
            Some("/data/music/Aphex Twin/SAW"),
            Some("/data/music/Autechre/Amber"),
            Some("/data/music/2562/Aerial"),
        ]);
        assert_eq!(
            derive_common_root(&conn).unwrap().as_deref(),
            Some("/data/music")
        );
    }

    #[test]
    fn ignores_null_and_empty_paths() {
        let conn = seed(&[
            None,
            Some(""),
            Some("/data/music/A/x"),
            Some("/data/music/B/y"),
        ]);
        assert_eq!(
            derive_common_root(&conn).unwrap().as_deref(),
            Some("/data/music")
        );
    }

    #[test]
    fn no_paths_yields_none() {
        let conn = seed(&[None, Some("")]);
        assert_eq!(derive_common_root(&conn).unwrap(), None);
    }

    #[test]
    fn single_path_returns_itself() {
        let conn = seed(&[Some("/data/music/Only/One")]);
        assert_eq!(
            derive_common_root(&conn).unwrap().as_deref(),
            Some("/data/music/Only/One")
        );
    }

    #[test]
    fn divergent_roots_collapse_to_filesystem_root() {
        // Two different absolute trees share only "/".
        let conn = seed(&[Some("/data/music/A/x"), Some("/mnt/media/B/y")]);
        assert_eq!(derive_common_root(&conn).unwrap().as_deref(), Some("/"));
    }
}
