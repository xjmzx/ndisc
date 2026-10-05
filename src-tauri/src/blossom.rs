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
