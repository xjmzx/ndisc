import type { Release } from "./tauri";

// Source platforms recognised from a release's `source` URL. Used to colour the
// source indicator in the batch-edit table and to tint the medium glyph in the
// release list, so a release's origin is discoverable at a glance. Colours are
// brand-ish and deliberately distinct on the dark panel; this list is the
// single place to add a platform or recolour one.
export interface SourcePlatform {
  key: string;
  label: string;
  domain: string; // matched as a substring of the lowercased source URL
  color: string;
}

export const SOURCE_PLATFORMS: SourcePlatform[] = [
  { key: "bandcamp", label: "Bandcamp", domain: "bandcamp.com", color: "#1da0c3" },
  { key: "soundcloud", label: "SoundCloud", domain: "soundcloud.com", color: "#ff5500" },
  { key: "mixcloud", label: "Mixcloud", domain: "mixcloud.com", color: "#5000ff" },
  { key: "wavlake", label: "Wavlake", domain: "wavlake.com", color: "#00c853" },
  { key: "tidal", label: "Tidal", domain: "tidal.com", color: "#e8eaed" },
];

// Custom Bandcamp storefronts on their own domain (label stores that don't use
// a *.bandcamp.com URL). These have no receipt of their own to key off, so they
// need explicit recognition. Add a domain here when a label's own shop is
// Bandcamp-backed.
const BANDCAMP_CUSTOM_DOMAINS = ["shop.cpurecords.net"];

// The platform a release came from, or null. A source-URL domain match wins.
// Failing that, a release is Bandcamp if it sits on a known custom Bandcamp
// storefront OR carries a Bandcamp purchase receipt (`bandcampId`) — both mark
// a Bandcamp origin without a *.bandcamp.com URL.
export function sourcePlatform(r: Release): SourcePlatform | null {
  const src = (r.source ?? "").toLowerCase();
  for (const p of SOURCE_PLATFORMS) {
    if (src.includes(p.domain)) return p;
  }
  const hasReceipt = !!(r.bandcampId ?? "").trim();
  if (hasReceipt || BANDCAMP_CUSTOM_DOMAINS.some((d) => src.includes(d))) {
    return SOURCE_PLATFORMS[0]; // Bandcamp
  }
  return null;
}

// True when the release carries a Bandcamp purchase receipt — used only to
// enrich the source-dot tooltip (a confirmed purchase vs a bare link).
export function hasBandcampReceipt(r: Release): boolean {
  return !!(r.bandcampId ?? "").trim();
}

export function isHttpUrl(s: string | null | undefined): boolean {
  return !!s && (s.startsWith("http://") || s.startsWith("https://"));
}
