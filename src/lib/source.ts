import type { Release } from "./tauri";

// Source platforms recognised from a release's `source` URL (and, for
// Bandcamp, a `bandcamp order …` receipt in notes — so custom Bandcamp stores
// like shop.cpurecords.net light up too). Used to colour the source indicator
// in the batch-edit table and to tint the medium glyph in the release list, so
// a release's origin is discoverable at a glance. Colours are brand-ish and
// deliberately distinct on the dark panel; this list is the single place to add
// a platform or recolour one.
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

// The platform a release came from, or null. Source-URL domain wins; the
// Bandcamp receipt-in-notes is a fallback for custom stores with no
// bandcamp.com URL.
export function sourcePlatform(r: Release): SourcePlatform | null {
  const src = (r.source ?? "").toLowerCase();
  for (const p of SOURCE_PLATFORMS) {
    if (src.includes(p.domain)) return p;
  }
  if ((r.notes ?? "").toLowerCase().includes("bandcamp")) {
    return SOURCE_PLATFORMS[0];
  }
  return null;
}

// True when the release also carries a Bandcamp purchase receipt — used only
// to enrich the source-dot tooltip (a confirmed purchase vs a bare link).
export function hasBandcampReceipt(r: Release): boolean {
  return (r.notes ?? "").toLowerCase().includes("bandcamp");
}

export function isHttpUrl(s: string | null | undefined): boolean {
  return !!s && (s.startsWith("http://") || s.startsWith("https://"));
}
