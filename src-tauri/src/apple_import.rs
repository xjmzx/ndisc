// Apple Music library XML → releases.
//
// The Music app's File → Library → Export Library writes a plist of TRACKS
// (no album records), so this module groups tracks into albums. It is pure —
// no DB, no Tauri — so the grouping rules are unit-tested here; the commands
// in lib.rs do the matching against the catalogue and the inserts.
//
// What the export holds per track: artist, album artist, album, year, genre,
// kind, bit rate, track/disc number and count. What it does NOT hold: label,
// catalogue number, country, or any Apple album id — so an imported release
// has no store link in Source.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

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
}
