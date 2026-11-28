// Apple Music library XML → releases.
//
// The Music app's File → Library → Export Library writes a plist of TRACKS
// (no album records), so this module groups tracks into albums. It is pure —
// no DB, no Tauri — so the grouping rules are unit-tested here; the commands
// in lib.rs do the matching against the catalogue and the inserts.
//
// What the export holds per track: artist, album artist, album, year, genre,
// kind, bit rate, track/disc number and count, and the file's own location on
// disk. What it does NOT hold: label, catalogue number, country, or any Apple
// album id — so an imported release has no store link in Source.
//
// The location is why this import can fill `file_path` in one pass
// (2026-11-28). The export already says where every track is, so the files do
// not have to be found again by a folder scan afterwards — which matters
// because the folder import de-duplicates on `file_path` alone, so an Apple
// import that left it empty and a later scan of the same tree would each
// create their own copy of every album. See `album_dir`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

use plist::{Dictionary, Value};
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// The duplicate key `norm(artist)|norm(title)`. Same normalisation as
/// master_key::normalize_field (test-only there): accents folded, lowercase,
/// `&`/`+` → "and", letters and digits only, feat/ft/featuring and a leading
/// "the" dropped. The title is loosened first: bracketed qualifiers
/// ("(Deluxe Edition)", "[2015 Remaster]") and a trailing "EP" / "Single"
/// are ignored, so "Collapse - EP" finds "Collapse EP". Checked against the
/// 2026-11 Apple ledger: this finds 95% of its hand-checked pairs, and a
/// false match only skips an album, never duplicates or changes one.
pub fn match_key(artist: &str, title: &str) -> String {
    let (stem, _) = split_title_suffix(title.trim());
    let mut t = norm(&strip_brackets(&stem));
    for tail in [" ep", " single"] {
        if let Some(rest) = t.strip_suffix(tail) {
            if !rest.is_empty() {
                t = rest.to_string();
            }
        }
    }
    format!("{}|{}", norm(artist), t)
}

fn strip_brackets(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    // A title that is all brackets keeps its text rather than going empty.
    if out.trim().is_empty() { s.to_string() } else { out }
}

fn norm(s: &str) -> String {
    let base: String = s.nfkd().filter(|&c| !is_combining_mark(c)).collect();
    let mut cleaned = String::with_capacity(base.len());
    for c in base.to_lowercase().chars() {
        if c == '&' || c == '+' {
            cleaned.push_str(" and ");
        } else if c.is_alphanumeric() {
            cleaned.push(c);
        } else {
            cleaned.push(' ');
        }
    }
    let mut toks: Vec<&str> = cleaned
        .split_whitespace()
        .filter(|t| !matches!(*t, "feat" | "ft" | "featuring"))
        .collect();
    if toks.first() == Some(&"the") {
        toks.remove(0);
    }
    toks.join(" ")
}

#[derive(Debug, Clone, PartialEq)]
pub struct AppleAlbum {
    pub artist: String,
    pub title: String,
    /// "single" / "ep" from Apple's title suffix, "compilation" from the
    /// compilation flag, else "album".
    pub category: &'static str,
    pub year: Option<i32>,
    /// "AAC 256" (modal bit rate) or "ALAC".
    pub format: String,
    /// Purchased tracks held (distinct disc/track positions).
    pub held: i64,
    /// Sum of each disc's track count. None when the export carries no counts.
    pub track_total: Option<i64>,
    pub disc_total: Option<i64>,
    /// Every track of every disc is present.
    pub full: bool,
    /// Apple's genre for the album (first track's), unmapped.
    pub genre: Option<String>,
    /// The one folder the album's files sit in, from the tracks' own
    /// locations — `None` when the export gives no location or the tracks do
    /// not agree on a folder. See `album_dir`.
    pub dir: Option<String>,
    /// Tracks in the album that carry a location at all. Lower than `held`
    /// for an album Music knows about but holds no file for.
    pub located: i64,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct AppleLibrary {
    pub tracks: usize,
    /// Music videos and tracks with no album name, left out.
    pub skipped_tracks: usize,
    pub albums: Vec<AppleAlbum>,
}

pub fn read_library(path: &Path) -> Result<AppleLibrary, String> {
    let value = Value::from_file(path).map_err(|e| format!("not an Apple Music library XML: {e}"))?;
    let root = value
        .as_dictionary()
        .ok_or("not an Apple Music library XML: the top level is not a dictionary")?;
    let tracks = root
        .get("Tracks")
        .and_then(Value::as_dictionary)
        .ok_or("not an Apple Music library XML: no Tracks section")?;
    Ok(group_tracks(tracks.values().filter_map(Value::as_dictionary)))
}

fn s<'a>(d: &'a Dictionary, k: &str) -> Option<&'a str> {
    d.get(k)
        .and_then(Value::as_string)
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn n(d: &Dictionary, k: &str) -> Option<i64> {
    d.get(k)
        .and_then(|v| v.as_signed_integer().or_else(|| v.as_unsigned_integer().map(|u| u as i64)))
}

fn flag(d: &Dictionary, k: &str) -> bool {
    d.get(k).and_then(Value::as_boolean).unwrap_or(false)
}

fn is_video(d: &Dictionary) -> bool {
    flag(d, "Has Video")
        || flag(d, "Music Video")
        || s(d, "Kind").is_some_and(|k| k.to_lowercase().contains("video"))
}

/// Apple marks singles and EPs in the album name: "Title - Single", "Title - EP".
pub fn split_title_suffix(album: &str) -> (String, Option<&'static str>) {
    for (suffix, category) in [(" - Single", "single"), (" - EP", "ep")] {
        if let Some(stem) = album.strip_suffix(suffix) {
            if !stem.trim().is_empty() {
                return (stem.trim().to_string(), Some(category));
            }
        }
    }
    (album.to_string(), None)
}

#[derive(Default)]
struct Acc {
    tracks: Vec<Dictionary>,
}

pub fn group_tracks<'a>(tracks: impl Iterator<Item = &'a Dictionary>) -> AppleLibrary {
    let mut lib = AppleLibrary::default();
    // BTreeMap so the album order is stable (artist, then album).
    let mut groups: BTreeMap<(String, String), Acc> = BTreeMap::new();
    for t in tracks {
        lib.tracks += 1;
        let Some(album) = s(t, "Album") else {
            lib.skipped_tracks += 1;
            continue;
        };
        if is_video(t) {
            lib.skipped_tracks += 1;
            continue;
        }
        let artist = match s(t, "Album Artist") {
            Some(a) => a.to_string(),
            None if flag(t, "Compilation") => "Various Artists".to_string(),
            None => match s(t, "Artist") {
                Some(a) => a.to_string(),
                None => {
                    lib.skipped_tracks += 1;
                    continue;
                }
            },
        };
        groups
            .entry((artist, album.to_string()))
            .or_default()
            .tracks
            .push(t.clone());
    }
    lib.albums = groups
        .into_iter()
        .map(|((artist, album), acc)| build_album(artist, &album, &acc.tracks))
        .collect();
    lib
}

/// `file:///Volumes/AV/…/03%20Track.m4a` → `/Volumes/AV/…/03 Track.m4a`.
///
/// Decoded here rather than with a crate: nothing else in the tree needs a URL
/// parser, and the only shape Music writes is `file://` followed by an
/// absolute POSIX path — checked against a 4,694-track export, which holds no
/// `file://localhost/` form. Anything else returns `None`, including a URL
/// whose decoded bytes are not UTF-8, rather than guessing at a path.
fn decode_file_url(loc: &str) -> Option<PathBuf> {
    let rest = loc.strip_prefix("file://")?;
    // `file:///path` leaves the path's own leading slash. A host form such as
    // `file://localhost/path` would leave `localhost/path`, which this refuses.
    if !rest.starts_with('/') {
        return None;
    }
    let bytes = rest.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok().map(PathBuf::from)
}

/// The one folder an album's files sit in, or `None` when they do not agree.
///
/// One parent folder is that folder. Several are accepted only in the
/// multi-disc case — `…/Album/CD1`, `…/Album/CD2` — where every one of them is
/// a disc folder by the suite's own rule (`crate::is_disc_dir_name`), and the
/// answer is their shared parent. That is deliberately the *same* collapse the
/// folder import's `release_dir` performs, so both importers name the same path
/// for the same album and either can see that the other has taken it.
///
/// Everything else returns `None`: tracks scattered across the disk, or split
/// across sibling folders that are not discs. Deliberately NOT the common
/// ancestor, which would climb to `/Volumes`, or `/`, and state a wrong path
/// with confidence — and deliberately NOT broader than `release_dir`, because a
/// path only this importer would choose is one a later folder scan would not
/// recognise and would therefore duplicate.
fn album_dir(tracks: &[Dictionary]) -> Option<String> {
    let mut parents: BTreeSet<PathBuf> = BTreeSet::new();
    for t in tracks {
        if let Some(dir) = s(t, "Location")
            .and_then(decode_file_url)
            .and_then(|p| p.parent().map(Path::to_path_buf))
        {
            parents.insert(dir);
        }
    }
    let first = parents.iter().next()?.clone();
    if parents.len() == 1 {
        return Some(first.to_string_lossy().into_owned());
    }
    // Several folders: only discs of one release may be folded together.
    if !parents.iter().all(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .is_some_and(crate::is_disc_dir_name)
    }) {
        return None;
    }
    let shared = first.parent()?;
    // A shared parent with no name is the filesystem root: not siblings in any
    // sense worth writing to the database.
    if shared.file_name().is_none() {
        return None;
    }
    if parents.iter().all(|p| p.parent() == Some(shared)) {
        Some(shared.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn build_album(artist: String, album: &str, tracks: &[Dictionary]) -> AppleAlbum {
    let (title, suffix_category) = split_title_suffix(album);
    let compilation = tracks.iter().any(|t| flag(t, "Compilation"));
    let category = suffix_category.unwrap_or(if compilation { "compilation" } else { "album" });

    let year = tracks
        .iter()
        .filter_map(|t| n(t, "Year"))
        .filter(|&y| y > 0)
        .min()
        .map(|y| y as i32);

    let lossless = tracks.iter().all(|t| {
        s(t, "Kind").is_some_and(|k| k.to_lowercase().contains("lossless"))
    });
    let format = if lossless {
        "ALAC".to_string()
    } else {
        let mut rates: HashMap<i64, usize> = HashMap::new();
        for r in tracks.iter().filter_map(|t| n(t, "Bit Rate")) {
            *rates.entry(r).or_default() += 1;
        }
        match rates.into_iter().max_by_key(|&(r, c)| (c, r)) {
            Some((r, _)) => format!("AAC {r}"),
            None => "AAC".to_string(),
        }
    };

    // Distinct positions held; a track without a number still counts once.
    let mut positions: HashSet<(i64, i64)> = HashSet::new();
    let mut unnumbered = 0i64;
    for t in tracks {
        match n(t, "Track Number") {
            Some(no) => {
                positions.insert((n(t, "Disc Number").unwrap_or(1), no));
            }
            None => unnumbered += 1,
        }
    }
    let held = positions.len() as i64 + unnumbered;

    // Apple's Track Count is per disc: total = sum over the discs seen.
    let mut per_disc: BTreeMap<i64, i64> = BTreeMap::new();
    for t in tracks {
        if let Some(c) = n(t, "Track Count").filter(|&c| c > 0) {
            let disc = n(t, "Disc Number").unwrap_or(1);
            let e = per_disc.entry(disc).or_default();
            *e = (*e).max(c);
        }
    }
    let track_total = if per_disc.is_empty() {
        None
    } else {
        Some(per_disc.values().sum::<i64>())
    };
    let disc_total = tracks
        .iter()
        .filter_map(|t| n(t, "Disc Count"))
        .filter(|&c| c > 0)
        .max();
    // Full only when every disc is represented and every slot is held: a
    // two-disc album bought as disc 1 alone must not read as complete.
    let discs_seen = per_disc.len() as i64;
    let full = match track_total {
        Some(total) => held >= total && disc_total.map_or(true, |d| discs_seen >= d),
        None => false,
    };

    let genre = tracks.iter().find_map(|t| s(t, "Genre")).map(str::to_string);

    let dir = album_dir(tracks);
    let located = tracks
        .iter()
        .filter(|t| s(t, "Location").is_some())
        .count() as i64;

    AppleAlbum {
        artist,
        title,
        category,
        year,
        format,
        held,
        track_total,
        disc_total,
        full,
        genre,
        dir,
        located,
    }
}

/// Apple genre → a release.v2 slug, only where the meaning is the same.
/// Anything else is left unset; the caller still checks the slug is active.
pub fn genre_slug(apple: &str) -> Option<&'static str> {
    Some(match apple.trim().to_lowercase().as_str() {
        "electronic" | "electronica" | "dance" => "electronic",
        "techno" => "techno",
        "house" => "house",
        "trance" => "trance",
        "ambient" => "ambient",
        "jungle/drum'n'bass" | "drum & bass" | "drum and bass" => "dnb",
        "hip-hop/rap" | "hip-hop" | "hip hop" | "rap" => "hip-hop",
        "rock" | "hard rock" => "rock",
        "metal" => "metal",
        "reggae" => "reggae",
        "dub" => "dub",
        "pop" => "pop",
        "jazz" => "jazz",
        "soundtrack" => "soundtrack",
        "classical" => "classical",
        "folk" => "folk",
        "blues" => "blues",
        "soul" | "r&b/soul" => "soul",
        "funk" => "funk",
        "disco" => "disco",
        "latin" => "latin",
        "country" => "country",
        "world" | "worldwide" => "world",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(pairs: &[(&str, Value)]) -> Dictionary {
        let mut d = Dictionary::new();
        for (k, v) in pairs {
            d.insert((*k).to_string(), v.clone());
        }
        d
    }
    fn st(v: &str) -> Value {
        Value::String(v.to_string())
    }
    fn int(v: i64) -> Value {
        Value::Integer(v.into())
    }

    fn t(artist: &str, album: &str, disc: i64, no: i64, count: i64, discs: i64) -> Dictionary {
        track(&[
            ("Album Artist", st(artist)),
            ("Artist", st(artist)),
            ("Album", st(album)),
            ("Kind", st("Purchased AAC audio file")),
            ("Bit Rate", int(256)),
            ("Year", int(2010)),
            ("Genre", st("Electronic")),
            ("Disc Number", int(disc)),
            ("Disc Count", int(discs)),
            ("Track Number", int(no)),
            ("Track Count", int(count)),
        ])
    }

    #[test]
    fn suffixes_set_the_category() {
        assert_eq!(split_title_suffix("Blen - EP"), ("Blen".into(), Some("ep")));
        assert_eq!(split_title_suffix("Kong - Single"), ("Kong".into(), Some("single")));
        assert_eq!(split_title_suffix("Hitecherous"), ("Hitecherous".into(), None));
        assert_eq!(split_title_suffix(" - EP"), (" - EP".into(), None));
    }

    #[test]
    fn groups_full_partial_and_multi_disc() {
        let tracks = vec![
            t("A", "Full - EP", 1, 1, 2, 1),
            t("A", "Full - EP", 1, 2, 2, 1),
            t("A", "Part", 1, 3, 10, 1),
            // Two discs of 3 and 4 tracks; only disc 1 bought, complete.
            t("B", "Double", 1, 1, 3, 2),
            t("B", "Double", 1, 2, 3, 2),
            t("B", "Double", 1, 3, 3, 2),
        ];
        let lib = group_tracks(tracks.iter());
        assert_eq!(lib.tracks, 6);
        assert_eq!(lib.albums.len(), 3);
        let full = &lib.albums[0];
        assert_eq!((full.title.as_str(), full.category), ("Full", "ep"));
        assert_eq!((full.held, full.track_total, full.full), (2, Some(2), true));
        assert_eq!(full.format, "AAC 256");
        let part = &lib.albums[1];
        assert_eq!((part.held, part.track_total, part.full), (1, Some(10), false));
        let double = &lib.albums[2];
        assert_eq!((double.held, double.disc_total, double.full), (3, Some(2), false));
    }

    #[test]
    fn compilations_and_videos() {
        let mut comp = track(&[
            ("Artist", st("X")),
            ("Album", st("Mix")),
            ("Compilation", Value::Boolean(true)),
            ("Kind", st("Apple Lossless audio file")),
        ]);
        let comp2 = {
            let mut c = comp.clone();
            c.insert("Artist".into(), st("Y"));
            c
        };
        let video = track(&[
            ("Artist", st("Z")),
            ("Album", st("Clip")),
            ("Kind", st("Purchased MPEG-4 video file")),
        ]);
        let no_album = track(&[("Artist", st("Z"))]);
        comp.insert("Track Number".into(), int(1));
        let lib = group_tracks([comp, comp2, video, no_album].iter());
        assert_eq!(lib.skipped_tracks, 2);
        assert_eq!(lib.albums.len(), 1);
        let a = &lib.albums[0];
        assert_eq!((a.artist.as_str(), a.category, a.format.as_str()), ("Various Artists", "compilation", "ALAC"));
        assert_eq!(a.held, 2);
        assert!(!a.full);
    }

    #[test]
    fn match_key_folds_the_usual_differences() {
        assert_eq!(match_key("The Orb", "U.F.Orb"), match_key("Orb", "U F Orb"));
        assert_eq!(match_key("Perälä", "A & B"), match_key("perala", "a and b"));
        assert_ne!(match_key("A", "B"), match_key("A", "C"));
        assert_eq!(match_key("Aphex Twin", "Collapse - EP"), match_key("Aphex Twin", "Collapse EP"));
        assert_eq!(
            match_key("Banco de Gaia", "Last Train to Lhasa (Special Edition)"),
            match_key("Banco de Gaia", "Last Train to Lhasa"),
        );
        assert_eq!(match_key("X", "[Untitled]"), match_key("X", "Untitled"));
    }

    #[test]
    fn genres_map_only_when_clear() {
        assert_eq!(genre_slug("Electronica"), Some("electronic"));
        assert_eq!(genre_slug("Hip-Hop/Rap"), Some("hip-hop"));
        assert_eq!(genre_slug("Alternative"), None);
        assert_eq!(genre_slug("IDM/Experimental"), None);
    }

    /// A track at a given location, otherwise shaped like `t`.
    fn at(artist: &str, album: &str, no: i64, loc: &str) -> Dictionary {
        let mut d = t(artist, album, 1, no, 2, 1);
        d.insert("Location".to_string(), st(loc));
        d
    }

    #[test]
    fn decodes_apple_file_urls() {
        assert_eq!(
            decode_file_url("file:///Volumes/AV/Music/Vernon%20Elliott/Moog%20Acid/03%20Analog.m4a"),
            Some(PathBuf::from("/Volumes/AV/Music/Vernon Elliott/Moog Acid/03 Analog.m4a")),
        );
        // Multi-byte UTF-8 survives a round trip: Móatún encodes as %C3%B3/%C3%BA.
        assert_eq!(
            decode_file_url("file:///m/M%C3%B3at%C3%BAn%207/x.m4a"),
            Some(PathBuf::from("/m/Móatún 7/x.m4a")),
        );
        // %25 is a literal percent; a percent that is not an escape is left as
        // it stands rather than failing the whole path.
        assert_eq!(decode_file_url("file:///m/100%25/x.m4a"), Some(PathBuf::from("/m/100%/x.m4a")));
        assert_eq!(decode_file_url("file:///m/50%/x.m4a"), Some(PathBuf::from("/m/50%/x.m4a")));
        // Not a local file URL, and the host form Music never writes.
        assert_eq!(decode_file_url("https://example.com/x.m4a"), None);
        assert_eq!(decode_file_url("file://localhost/m/x.m4a"), None);
    }

    #[test]
    fn an_albums_folder_comes_from_its_own_tracks() {
        // One folder is that folder.
        let one = vec![
            at("A", "Rec", 1, "file:///Volumes/AV/Music/A/Rec/01%20a.m4a"),
            at("A", "Rec", 2, "file:///Volumes/AV/Music/A/Rec/02%20b.m4a"),
        ];
        assert_eq!(album_dir(&one).as_deref(), Some("/Volumes/AV/Music/A/Rec"));

        // Sibling disc folders collapse to the album folder — the same path
        // the folder import's release_dir would settle on.
        let multi = vec![
            at("A", "Rec", 1, "file:///m/A/Rec/CD1/01%20a.m4a"),
            at("A", "Rec", 2, "file:///m/A/Rec/CD2/01%20b.m4a"),
        ];
        assert_eq!(album_dir(&multi).as_deref(), Some("/m/A/Rec"));

        // Sibling folders that are not discs are refused: the folder import
        // would keep them apart, so a shared path here would be one only this
        // importer knows about.
        let siblings = vec![
            at("A", "Rec", 1, "file:///m/A/Rec/Bonus/01%20a.m4a"),
            at("A", "Rec", 2, "file:///m/A/Rec/Main/01%20b.m4a"),
        ];
        assert_eq!(album_dir(&siblings), None);

        // Scattered tracks are refused, not reduced to a common ancestor.
        let scattered = vec![
            at("A", "Rec", 1, "file:///m/A/Rec/01%20a.m4a"),
            at("A", "Rec", 2, "file:///other/place/02%20b.m4a"),
        ];
        assert_eq!(album_dir(&scattered), None);

        // Two folders directly under the root share only the root.
        let rooted = vec![
            at("A", "Rec", 1, "file:///one/a.m4a"),
            at("A", "Rec", 2, "file:///two/b.m4a"),
        ];
        assert_eq!(album_dir(&rooted), None);

        // No location at all: nothing to say about where it lives.
        assert_eq!(album_dir(&[t("A", "Rec", 1, 1, 2, 1)]), None);
    }

    /// A real export, named by `NDISC_APPLE_XML`. Ignored by default: no such
    /// file is in the repo and the numbers depend on whose library it is. It is
    /// the only way to exercise the grouping against a genuine 4,000-track
    /// plist without launching the app, so run it after touching these rules:
    ///
    /// ```text
    /// NDISC_APPLE_XML=/path/to/Library.xml \
    ///   cargo test surveys_a_real_export -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs a real Library.xml named by NDISC_APPLE_XML"]
    fn surveys_a_real_export() {
        let path = std::env::var("NDISC_APPLE_XML")
            .expect("set NDISC_APPLE_XML to an exported Library.xml");
        let lib = read_library(Path::new(&path)).expect("read_library");
        let full = lib.albums.iter().filter(|a| a.full).count();
        let with_dir = lib.albums.iter().filter(|a| a.dir.is_some()).count();
        let on_disk = lib
            .albums
            .iter()
            .filter_map(|a| a.dir.as_deref())
            .filter(|d| Path::new(d).is_dir())
            .count();
        println!(
            "tracks {} (skipped {}) · albums {} · full {} · partial {} · with a folder {} · folders on disk {}",
            lib.tracks,
            lib.skipped_tracks,
            lib.albums.len(),
            full,
            lib.albums.len() - full,
            with_dir,
            on_disk,
        );
        assert!(!lib.albums.is_empty(), "a real export holds albums");
        // True of any library, so worth asserting rather than eyeballing.
        for a in &lib.albums {
            if let Some(d) = &a.dir {
                assert!(d.starts_with('/'), "a folder must be absolute: {d}");
                assert!(!d.ends_with('/'), "no trailing slash: {d}");
                assert!(a.located > 0, "a folder implies at least one located track");
            }
        }
    }

    #[test]
    fn grouping_carries_the_folder_and_the_located_count() {
        let tracks = vec![
            at("B", "Partly Here", 1, "file:///m/B/Partly%20Here/01%20a.m4a"),
            t("B", "Partly Here", 1, 2, 2, 1), // same album, no file on disk
        ];
        let lib = group_tracks(tracks.iter());
        assert_eq!(lib.albums.len(), 1);
        let a = &lib.albums[0];
        assert_eq!(a.dir.as_deref(), Some("/m/B/Partly Here"));
        assert_eq!(a.located, 1, "one of the two tracks has a location");
        assert_eq!(a.held, 2, "both are still held");
    }
}
