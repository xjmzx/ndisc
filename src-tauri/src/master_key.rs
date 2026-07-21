//! Canonical **master-release-key** — the content-derived hash that groups "the
//! same work" across users and media formats. Full rationale, the pinned
//! algorithm, the wire form, and the conformance test vectors live in
//! `schema/master-release-key-design-2026-07-19.md`; the vectors are also
//! machine-readable in `schema/master-key.vectors.json` for the JS consumers
//! (glmps / nview) to verify byte-identical output.
//!
//! NOT yet wired into publishing — emitting the tag on `kind:31237` is a separate
//! coordinated wave (like clip.v1). This module is the pure, tested function so
//! ndisc (Rust) and glmps/nview (JS) can be *proven* to compute identical keys
//! before anything commits to the wire.
//!
//! The algorithm is deliberately **regex-free and token-based** so Rust and JS
//! implement it identically with no word-boundary/regex-dialect divergence.
#![allow(dead_code)]

use sha2::{Digest, Sha256};
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Standalone tokens dropped as featured-artist noise.
const DROP_TOKENS: [&str; 3] = ["feat", "ft", "featuring"];

/// Normalise one field (artist or title). Steps — see the design doc:
/// 1. NFKD, drop combining marks (category M), lowercase.
/// 2. `&` / `+` → " and " (conjunction variants).
/// 3. keep Unicode letters + numbers; everything else → a space.
/// 4. split into tokens; drop `feat`/`ft`/`featuring`; drop a single leading
///    `the`; join with single spaces.
pub fn normalize_field(s: &str) -> String {
    // NFKD + strip category-M marks FIRST (deleting them), then lowercase the
    // whole string — order matters: if a combining mark survived to step 3 it
    // would become a SPACE, splitting "Perälä" into "pera la".
    let base: String = s.nfkd().filter(|&c| !is_combining_mark(c)).collect();
    let base = base.to_lowercase();

    let mut cleaned = String::with_capacity(base.len());
    for c in base.chars() {
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
        .filter(|t| !DROP_TOKENS.contains(t))
        .collect();
    if toks.first() == Some(&"the") {
        toks.remove(0);
    }
    toks.join(" ")
}

/// The raw content key `norm(artist)|norm(title)`. `None` when BOTH fields
/// normalise to empty — a release with no normalisable content cannot have a
/// meaningful content key and must not group with other empties. `"|"` is a safe
/// separator: step 3 guarantees it never appears inside a normalised field.
pub fn master_key(artist: &str, title: &str) -> Option<String> {
    let a = normalize_field(artist);
    let t = normalize_field(title);
    if a.is_empty() && t.is_empty() {
        None
    } else {
        Some(format!("{a}|{t}"))
    }
}

/// The wire tag value: `master:` + the first 32 lowercase-hex chars (128 bits)
/// of `SHA-256(utf8(key))`. `None` when there is no key.
pub fn master_tag(artist: &str, title: &str) -> Option<String> {
    master_key(artist, title).map(|k| {
        let digest = Sha256::digest(k.as_bytes());
        let mut hex = String::with_capacity(32);
        for b in digest.iter().take(16) {
            hex.push_str(&format!("{b:02x}"));
        }
        format!("master:{hex}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // THE CONTRACT. Any implementation (this one, and the JS in glmps/nview) is
    // conformant iff it reproduces these. Mirrors the design-doc table and
    // schema/master-key.vectors.json. Includes the regression guard (Vol 1/2)
    // and the tricky real cases found calibrating against the library.
    const VECTORS: &[(&str, &str, Option<&str>)] = &[
        ("Coldcut", "More Beats + Pieces", Some("coldcut|more beats and pieces")),
        ("Coldcut", "More Beats & Pieces", Some("coldcut|more beats and pieces")),
        ("Coldcut & Hexstatic", "Timber", Some("coldcut and hexstatic|timber")),
        ("The Orb", "Auntie Aubrey's Excursions", Some("orb|auntie aubrey s excursions")),
        ("Aleksi Perälä", "Sunshine 1", Some("aleksi perala|sunshine 1")),
        ("王磊", "馨", Some("王磊|馨")),
        ("µ-Ziq", "Urmur Bile Trax Volume 1", Some("μ ziq|urmur bile trax volume 1")),
        ("Aphex Twin", "Windowlicker", Some("aphex twin|windowlicker")),
        ("X", "Vol 1", Some("x|vol 1")),
        ("X", "Vol 2", Some("x|vol 2")),
        ("A feat. B", "T", Some("a b|t")),
        ("The The", "X", Some("the|x")),
        ("Mark Pritchard", "? / The Hologram - Single", Some("mark pritchard|hologram single")),
        ("{{{{", "{{{{", None),
        ("", "", None),
    ];

    #[test]
    fn vectors_are_the_contract() {
        for (a, t, want) in VECTORS {
            assert_eq!(
                master_key(a, t).as_deref(),
                *want,
                "artist={a:?} title={t:?}"
            );
        }
    }

    #[test]
    fn vol_1_and_2_never_collide() {
        // The regression guard: a throwaway heuristic once collapsed a whole
        // Vol-numbered series into one "duplicate". Digits must be preserved.
        assert_ne!(master_key("X", "Vol 1"), master_key("X", "Vol 2"));
        assert_ne!(master_key("A", "Level 10"), master_key("A", "Level 11"));
    }

    #[test]
    fn conjunction_variants_produce_one_hash() {
        let plus = master_tag("Coldcut", "More Beats + Pieces");
        let amp = master_tag("Coldcut", "More Beats & Pieces");
        let and = master_tag("Coldcut", "More Beats and Pieces");
        assert_eq!(plus, amp);
        assert_eq!(amp, and);
        assert!(plus.unwrap().starts_with("master:"));
    }

    #[test]
    fn fixture_json_matches_implementation() {
        // The shared fixture the JS consumers vendor IS the contract — assert
        // Rust reproduces every key AND tag in it, so the two never drift.
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../schema/master-key.vectors.json"
        );
        let raw = std::fs::read_to_string(path).expect("read master-key fixture");
        let doc: serde_json::Value = serde_json::from_str(&raw).expect("parse fixture");
        for v in doc["vectors"].as_array().expect("vectors array") {
            let a = v["artist"].as_str().unwrap();
            let t = v["title"].as_str().unwrap();
            assert_eq!(
                master_key(a, t).as_deref(),
                v["key"].as_str(),
                "key mismatch: artist={a:?} title={t:?}"
            );
            assert_eq!(
                master_tag(a, t).as_deref(),
                v["tag"].as_str(),
                "tag mismatch: artist={a:?} title={t:?}"
            );
        }
    }

    #[test]
    fn tag_is_master_prefix_plus_32_hex() {
        let tag = master_tag("Aphex Twin", "Windowlicker").unwrap();
        let hex = tag.strip_prefix("master:").unwrap();
        assert_eq!(hex.len(), 32);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }
}
