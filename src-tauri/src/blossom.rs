//! Blossom client — the HTTP side of hosting a cover image by its SHA-256.
//!
//! A Blossom server stores opaque blobs addressed by hash and nothing else: no
//! events, no filenames, no metadata. ndisc uses it for the image a release's
//! kind:31237 `image` tag points at. This module is only the protocol — sign an
//! authorization, ask whether a server holds a hash, upload bytes. Which covers
//! move, and what the database records about it, is decided by the commands in
//! `lib.rs`.
//!
//! Authorization is a signed kind:24242 event sent in the `Authorization` header
//! (BUD-11). It is scoped to one verb and one hash and expires in minutes; it is
//! never published to a relay.

use nostr_sdk::prelude::*;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Blossom authorization event. HTTP-only — never sent to a relay.
pub const KIND_BLOSSOM_AUTH: u16 = 24242;
/// The user's server list (BUD-03): where to look for their blobs by hash.
pub const KIND_BLOSSOM_SERVERS: u16 = 10063;

/// How long a signed authorization stays valid. Long enough for one slow
/// upload, short enough that a leaked header is worthless soon after.
const AUTH_TTL_SECS: u64 = 300;

/// What a server returns for a stored blob (BUD-02). Only the hash is relied
/// on — the URL is rebuilt from it, so the rest of the descriptor is ignored.
#[derive(Deserialize, Debug)]
pub struct BlobDescriptor {
    pub sha256: String,
}

/// Canonical form of a configured server: scheme + host (+ port/path), no
/// trailing slash. A bare hostname gets `https://`.
pub fn normalize_server(input: &str) -> Result<String, String> {
    let t = input.trim();
    if t.is_empty() {
        return Err("empty Blossom server".into());
    }
    let candidate = if t.contains("://") {
        t.to_string()
    } else {
        format!("https://{t}")
    };
    let parsed =
        Url::parse(&candidate).map_err(|e| format!("not a Blossom server URL: {input} ({e})"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("unsupported scheme in Blossom server: {input}"));
    }
    if parsed.host_str().map_or(true, str::is_empty) {
        return Err(format!("no host in Blossom server: {input}"));
    }
    Ok(candidate.trim_end_matches('/').to_string())
}

/// Normalise a configured list: canonical form, order kept, duplicates dropped.
/// The first entry is the primary — the one a release's `image` URL points at.
pub fn normalize_servers(servers: &[String]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for s in servers {
        if s.trim().is_empty() {
            continue;
        }
        let n = normalize_server(s)?;
        if !out.contains(&n) {
            out.push(n);
        }
    }
    if out.is_empty() {
        return Err("no Blossom server configured".into());
    }
    Ok(out)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Identify an image by its leading bytes: `(file extension, MIME type)`.
///
/// The bytes decide, not the URL or the `Content-Type` a host claimed — an HTML
/// error page served with `image/jpeg` must not be stored as a cover.
pub fn sniff_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("png", "image/png"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("gif", "image/gif"))
    } else {
        None
    }
}

/// The public URL of a blob. The extension is optional to a server but kept so
/// the URL reads as an image to clients that decide by suffix.
pub fn blob_url(server: &str, sha256: &str, ext: &str) -> String {
    format!("{server}/{sha256}.{ext}")
}

/// True when `url` already points at a blob on `server`.
pub fn is_on_server(url: &str, server: &str) -> bool {
    url.trim()
        .strip_prefix(server)
        .map(|rest| rest.starts_with('/'))
        .unwrap_or(false)
}

/// The SHA-256 a blob URL names: its last path segment, extension dropped.
/// None when that segment is not 64 hex digits — a URL on some other host.
pub fn sha256_in_url(url: &str) -> Option<String> {
    let path = Url::parse(url.trim()).ok()?.path().to_string();
    let last = path.rsplit('/').next()?;
    let stem = last.split('.').next()?;
    (stem.len() == 64 && stem.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| stem.to_ascii_lowercase())
}

/// Width and height from the start of a PNG or JPEG, without decoding it.
///
/// Enough for the first few tens of KB of a file, so a remote cover's size can
/// be read from a ranged request. JPEG: walks the markers to the first frame
/// header (SOF0–SOF15, not DHT/JPG/DAC). Anything else, or a header past the
/// bytes given, is None.
pub fn image_dims(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 {
        let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        return Some((w, h));
    }
    if !bytes.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut i = 2usize;
    while i + 9 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        if marker == 0xFF {
            i += 1; // fill byte
            continue;
        }
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
            let h = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
            let w = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
            return Some((w, h));
        }
        i += 2 + len;
    }
    None
}

/// True when `published` looks like a larger copy of `local`: the same shape
/// (aspect within 1%) and a longer long side. Half of the "shrunk since
/// publishing" rule; alone it also matches a low-resolution file on disk
/// beside a better published copy, which is why the caller also asks whether
/// the file changed after publishing.
pub fn is_larger_same_shape(local: (u32, u32), published: (u32, u32)) -> bool {
    let (lw, lh) = (local.0 as f64, local.1 as f64);
    let (pw, ph) = (published.0 as f64, published.1 as f64);
    if lw == 0.0 || lh == 0.0 || pw == 0.0 || ph == 0.0 {
        return false;
    }
    let same_shape = ((lw / lh) - (pw / ph)).abs() / (pw / ph) < 0.01;
    same_shape && pw.max(ph) > lw.max(lh)
}

/// Build the `Authorization` header value for one verb on one blob.
pub fn auth_header(keys: &Keys, verb: &str, sha256: &str, note: &str) -> Result<String, String> {
    use base64::Engine;
    let expires = Timestamp::from(Timestamp::now().as_u64() + AUTH_TTL_SECS);
    let tags = vec![
        Tag::parse(["t", verb]).map_err(|e| e.to_string())?,
        Tag::parse(["x", sha256]).map_err(|e| e.to_string())?,
        Tag::expiration(expires),
    ];
    let event = EventBuilder::new(Kind::Custom(KIND_BLOSSOM_AUTH), note)
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(event.as_json());
    Ok(format!("Nostr {encoded}"))
}

/// A server's own explanation for a refusal (`X-Reason`), else the status line.
fn refusal(response: &reqwest::Response) -> String {
    response
        .headers()
        .get("x-reason")
        .and_then(|v| v.to_str().ok())
        .map(|s| format!("{} — {}", response.status(), s))
        .unwrap_or_else(|| response.status().to_string())
}

/// Upload a blob (`PUT /upload`) and confirm the server stored the same bytes.
///
/// Sent even when the server may already hold the blob. An upload is what makes
/// this key one of the blob's owners — the standing that lets it delete the blob
/// later, and what a server's per-key retention rules look at. Skipping it when
/// someone else got there first would leave the cover held on their account, not
/// ours. Re-sending identical bytes is harmless: same hash, same blob.
///
/// The returned descriptor's hash must equal ours. A server that re-encodes an
/// image on the way in hands back a different hash — the blob would then not be
/// reachable at the address we are about to publish, so that is an error.
pub async fn upload(
    http: &reqwest::Client,
    keys: &Keys,
    server: &str,
    bytes: &[u8],
    mime: &str,
    sha256: &str,
) -> Result<BlobDescriptor, String> {
    let auth = auth_header(keys, "upload", sha256, "Upload cover")?;
    let response = http
        .put(format!("{server}/upload"))
        .header(reqwest::header::AUTHORIZATION, auth)
        .header(reqwest::header::CONTENT_TYPE, mime)
        .body(bytes.to_vec())
        .send()
        .await
        .map_err(|e| format!("{server}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{server}: upload refused: {}", refusal(&response)));
    }
    let body = response
        .bytes()
        .await
        .map_err(|e| format!("{server}: read response: {e}"))?;
    let descriptor: BlobDescriptor = serde_json::from_slice(&body)
        .map_err(|e| format!("{server}: unreadable upload response: {e}"))?;
    if !descriptor.sha256.eq_ignore_ascii_case(sha256) {
        return Err(format!(
            "{server}: stored a different blob ({}) than was sent ({sha256})",
            descriptor.sha256
        ));
    }
    Ok(descriptor)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ask a server whether it holds a blob (`HEAD /<sha256>`).
    async fn has_blob(
        http: &reqwest::Client,
        server: &str,
        sha256: &str,
    ) -> Result<bool, String> {
        let response = http
            .head(format!("{server}/{sha256}"))
            .send()
            .await
            .map_err(|e| format!("{server}: {e}"))?;
        match response.status() {
            s if s.is_success() => Ok(true),
            reqwest::StatusCode::NOT_FOUND => Ok(false),
            _ => Err(format!("{server}: {}", refusal(&response))),
        }
    }

    #[test]
    fn server_normalisation() {
        assert_eq!(normalize_server("blossom.example.com").unwrap(), "https://blossom.example.com");
        assert_eq!(normalize_server(" https://blossom.example.com/ ").unwrap(), "https://blossom.example.com");
        assert_eq!(normalize_server("http://127.0.0.1:3000").unwrap(), "http://127.0.0.1:3000");
        assert!(normalize_server("").is_err());
        assert!(normalize_server("wss://relay.example.com").is_err());
        assert!(normalize_server("https://").is_err());
    }

    #[test]
    fn server_list_keeps_order_and_drops_duplicates() {
        let got = normalize_servers(&[
            "a.example".to_string(),
            "  ".to_string(),
            "https://b.example/".to_string(),
            "https://a.example".to_string(),
        ])
        .unwrap();
        assert_eq!(got, vec!["https://a.example", "https://b.example"]);
        assert!(normalize_servers(&[" ".to_string()]).is_err());
    }

    #[test]
    fn sniffing_goes_by_bytes() {
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(("jpg", "image/jpeg")));
        assert_eq!(sniff_image(b"\x89PNG\r\n\x1a\n...."), Some(("png", "image/png")));
        assert_eq!(sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some(("webp", "image/webp")));
        assert_eq!(sniff_image(b"GIF89a.."), Some(("gif", "image/gif")));
        assert_eq!(sniff_image(b"<!doctype html>"), None);
        assert_eq!(sniff_image(b"RIFF\x00\x00\x00\x00WAVEfmt "), None);
        assert_eq!(sniff_image(b""), None);
    }

    #[test]
    fn sha256_is_read_from_a_blob_url() {
        let h = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        assert_eq!(sha256_in_url(&format!("https://b.example/{h}.jpg")).as_deref(), Some(h));
        assert_eq!(sha256_in_url(&format!("https://b.example/{}", h.to_uppercase())).as_deref(), Some(h));
        assert_eq!(sha256_in_url("https://i.other.example/abc.jpg"), None);
        assert_eq!(sha256_in_url("not a url"), None);
    }

    #[test]
    fn dims_from_png_and_jpeg_headers() {
        let mut png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        png.extend_from_slice(&600u32.to_be_bytes());
        png.extend_from_slice(&512u32.to_be_bytes());
        assert_eq!(image_dims(&png), Some((600, 512)));
        // SOI, an APP0 segment to skip, a DHT to skip, then SOF2 (progressive).
        let mut jpg = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00];
        jpg.extend_from_slice(&[0xFF, 0xC4, 0x00, 0x04, 0x00, 0x00]);
        jpg.extend_from_slice(&[0xFF, 0xC2, 0x00, 0x11, 0x08, 0x04, 0xB0, 0x02, 0x58, 0x03]);
        assert_eq!(image_dims(&jpg), Some((600, 1200)));
        assert_eq!(image_dims(&jpg[..10]), None);
        assert_eq!(image_dims(b"GIF89a.."), None);
    }

    #[test]
    fn larger_same_shape() {
        assert!(is_larger_same_shape((600, 600), (1200, 1200)));
        assert!(is_larger_same_shape((600, 593), (1425, 1408)));
        assert!(!is_larger_same_shape((600, 600), (600, 600)));
        assert!(!is_larger_same_shape((600, 600), (500, 500)));
        assert!(!is_larger_same_shape((600, 600), (1200, 1000)));
        assert!(!is_larger_same_shape((0, 0), (10, 10)));
    }

    #[test]
    fn hash_and_url() {
        // SHA-256 of the empty string.
        let h = sha256_hex(b"");
        assert_eq!(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        let url = blob_url("https://b.example", &h, "jpg");
        assert_eq!(url, format!("https://b.example/{h}.jpg"));
        assert!(is_on_server(&url, "https://b.example"));
        // A host that merely starts with the server's name is a different host.
        assert!(!is_on_server("https://b.example.evil/x.jpg", "https://b.example"));
        assert!(!is_on_server("https://i.other.example/x.jpg", "https://b.example"));
    }

    #[test]
    fn auth_header_is_a_signed_scoped_event() {
        use base64::Engine;
        let keys = Keys::generate();
        let hash = sha256_hex(b"cover");
        let header = auth_header(&keys, "upload", &hash, "Upload cover").unwrap();
        let encoded = header.strip_prefix("Nostr ").expect("Nostr scheme");
        let json = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
        let event = Event::from_json(json).unwrap();

        event.verify().expect("valid signature");
        assert_eq!(event.pubkey, keys.public_key());
        assert_eq!(event.kind, Kind::Custom(KIND_BLOSSOM_AUTH));

        let tag = |name: &str| -> Option<String> {
            event
                .tags
                .iter()
                .map(|t| t.as_slice())
                .find(|t| t.first().map(|s| s.as_str()) == Some(name))
                .and_then(|t| t.get(1).cloned())
        };
        assert_eq!(tag("t").as_deref(), Some("upload"));
        assert_eq!(tag("x").as_deref(), Some(hash.as_str()));
        let expires: u64 = tag("expiration").unwrap().parse().unwrap();
        assert!(expires > Timestamp::now().as_u64());
        assert!(expires <= Timestamp::now().as_u64() + AUTH_TTL_SECS);
    }

    /// Round trip against a real server. Ignored by default: it needs a server
    /// that accepts uploads from the given key.
    ///
    /// NDISC_BLOSSOM_TEST_SERVER=https://… NDISC_BLOSSOM_TEST_SEC=<hex or nsec> \
    ///   cargo test blossom::tests::live_round_trip -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_round_trip() {
        let server = normalize_server(
            &std::env::var("NDISC_BLOSSOM_TEST_SERVER").expect("NDISC_BLOSSOM_TEST_SERVER"),
        )
        .unwrap();
        let keys = Keys::parse(&std::env::var("NDISC_BLOSSOM_TEST_SEC").expect("NDISC_BLOSSOM_TEST_SEC"))
            .unwrap();
        // A unique blob each run, wearing a PNG signature so it sniffs as one.
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(format!("ndisc live test {}", Timestamp::now().as_u64()).as_bytes());
        let (ext, mime) = sniff_image(&bytes).unwrap();
        let hash = sha256_hex(&bytes);

        tauri::async_runtime::block_on(async {
            let http = reqwest::Client::new();
            assert!(!has_blob(&http, &server, &hash).await.unwrap(), "fresh blob already present");
            upload(&http, &keys, &server, &bytes, mime, &hash).await.unwrap();
            assert!(has_blob(&http, &server, &hash).await.unwrap());
            // Sending the same bytes again is accepted and changes nothing.
            upload(&http, &keys, &server, &bytes, mime, &hash).await.unwrap();

            let url = blob_url(&server, &hash, ext);
            let got = http.get(&url).send().await.unwrap().bytes().await.unwrap();
            assert_eq!(sha256_hex(&got), hash, "server returned different bytes");

            // A key the server does not know is refused, with the server's reason.
            let stranger = Keys::generate();
            let refused = upload(&http, &stranger, &server, &bytes, mime, &hash).await;
            println!("stranger: {refused:?}");
            assert!(refused.is_err());

            // Leave the server as it was.
            let auth = auth_header(&keys, "delete", &hash, "Delete test blob").unwrap();
            let gone = http
                .delete(format!("{server}/{hash}"))
                .header(reqwest::header::AUTHORIZATION, auth)
                .send()
                .await
                .unwrap();
            println!("delete: {}", gone.status());
            assert!(gone.status().is_success());
            assert!(!has_blob(&http, &server, &hash).await.unwrap());
        });
    }
}
