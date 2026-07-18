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

// --- Acquisition-source metadata --------------------------------------------
// A release's `sourceLabel` is a user-curated category (Bandcamp, a record
// store, …). The vocabulary itself lives in the DB (distinct source_label
// values); this frontend map holds how each named source is *presented* and
// whether it grants a digital copy — keyed by the lowercased name, so a user
// can recolour, flag, or add a store with no schema change. The recognised
// SOURCE_PLATFORMS seed sensible defaults (Bandcamp blue + digital, out of the
// box); a user entry overrides the seed.

const SOURCE_META_KEY = "ndisc.sources"; // { [lowercased name]: SourceMeta }

export interface SourceMeta {
  // Swatch/tint colour (full CSS colour, e.g. a hex). Undefined → no colour.
  color?: string;
  // Whether acquiring from this source gives you a digital copy you own (a
  // download store like Bandcamp), i.e. it can be the "digital half" of a
  // pairing. Independent of `physical` — Bandcamp vinyl grants both.
  digital?: boolean;
  // Whether acquiring from this source gives you a physical copy (a record
  // shop, a Discogs marketplace order), i.e. it can be the "physical half" of a
  // pairing. Independent of `digital`.
  physical?: boolean;
}

// Platforms whose acquisition is a download you own (a digital half), as
// opposed to a streaming link. Seeds the `digital` default for these names.
const DIGITAL_SEED_KEYS = new Set(["bandcamp", "wavlake"]);

// Seed metadata, derived from the recognised platforms so colour is defined in
// exactly one place (SOURCE_PLATFORMS above) and digital-ness from the set above.
const SEED_META: Record<string, SourceMeta> = Object.fromEntries(
  SOURCE_PLATFORMS.map((p) => [
    p.key,
    { color: p.color, digital: DIGITAL_SEED_KEYS.has(p.key) },
  ]),
);

// Read the user-edited map, tolerating the legacy shape `{ name: colorString }`
// (this key previously stored a bare colour) by lifting a string into { color }.
function userSourceMeta(): Record<string, SourceMeta> {
  try {
    const raw = localStorage.getItem(SOURCE_META_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, SourceMeta> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = { color: v };
      else if (v && typeof v === "object") out[k] = v as SourceMeta;
    }
    return out;
  } catch {
    return {};
  }
}

// Merged metadata for a source name (user over seed), or null when unknown.
function sourceMeta(name: string | null | undefined): SourceMeta | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  const user = userSourceMeta()[key];
  const seed = SEED_META[key];
  if (!user && !seed) return null;
  return { ...seed, ...user };
}

// Write-through a partial metadata edit for a source name. Persists to
// localStorage; callers re-render to reflect the change (no cross-tab signal).
export function setSourceMeta(
  name: string | null | undefined,
  patch: Partial<SourceMeta>,
): void {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return;
  const map = userSourceMeta();
  map[key] = { ...map[key], ...patch };
  try {
    localStorage.setItem(SOURCE_META_KEY, JSON.stringify(map));
  } catch {
    /* storage full / unavailable — colour just won't persist */
  }
}

// The colour assigned to an acquisition-source name (case-insensitive), or null
// when unknown. User overrides win over the seed defaults.
export function sourceColor(name: string | null | undefined): string | null {
  return sourceMeta(name)?.color ?? null;
}

// Whether a source name grants a physical copy (a record shop, a Discogs
// marketplace order). Drives the reverse pairing (see hasPhysicalCounterpart).
export function sourceIsPhysical(name: string | null | undefined): boolean {
  return !!sourceMeta(name)?.physical;
}

// Whether a source name grants a digital copy (a download you own). Drives the
// physical+digital pairing (see hasDigitalCounterpart).
export function sourceIsDigital(name: string | null | undefined): boolean {
  return !!sourceMeta(name)?.digital;
}

// The single source of truth for a release's source colour, used by the
// grouping ring and the medium-glyph tint. Prefers the user-assigned
// `sourceLabel`; falls back to the platform inferred from the URL/receipt; null
// when neither applies (callers then use the neutral default, e.g. --c-ok).
export function releaseSourceColor(r: Release): string | null {
  const assigned = sourceColor(r.sourceLabel);
  if (assigned) return assigned;
  const p = sourcePlatform(r);
  return p ? p.color : null;
}

// Display name for a release's acquisition source: the assigned label, else the
// inferred platform's label, else null. Pairs with releaseSourceColor for
// tooltips/aria.
export function releaseSourceName(r: Release): string | null {
  const assigned = (r.sourceLabel ?? "").trim();
  if (assigned) return assigned;
  return sourcePlatform(r)?.label ?? null;
}

// The "digital half" of a physical+digital pairing. A physical release counts
// as paired — and so shows the grouping ring — when there's evidence it also
// exists digitally, by ANY route (the point of "pairing in many ways"):
//   • local files on disk (filePath), or
//   • an acquisition source flagged as digital (a download you own) — either the
//     assigned sourceLabel, or the platform inferred from its URL/receipt.
// Digital-ness is driven entirely by per-source metadata (sourceIsDigital), so
// there is no hard-coded platform here: flag any new download store and its
// releases pair automatically. A physical-only shop is not a digital half.
export function hasDigitalCounterpart(r: Release): boolean {
  if ((r.filePath ?? "").trim()) return true;
  if (sourceIsDigital(r.sourceLabel)) return true;
  const p = sourcePlatform(r);
  return p ? sourceIsDigital(p.label) : false;
}

// The mirror: the "physical half" of a pairing, for a digital release. True
// when there's evidence it also exists physically:
//   • a Discogs catalogue link (discogsId) — a physical release entry, or
//   • an acquisition source flagged as physical (a record shop, Discogs
//     marketplace) — either the assigned sourceLabel or the inferred platform.
// Symmetric with hasDigitalCounterpart; driven by per-source metadata, so
// flagging any store "physical" makes its digital releases pair automatically.
export function hasPhysicalCounterpart(r: Release): boolean {
  if (r.discogsId != null) return true;
  if (sourceIsPhysical(r.sourceLabel)) return true;
  const p = sourcePlatform(r);
  return p ? sourceIsPhysical(p.label) : false;
}

// A release is "paired" — shows the tinted state-cluster fill — when it exists
// in BOTH physical and digital form: a physical row with a digital half, or a
// digital row with a physical half. The fill colour is releaseSourceColor (the
// same in both directions), green when the source is unknown.
export function isPaired(r: Release): boolean {
  if (r.medium === "physical") return hasDigitalCounterpart(r);
  if (r.medium === "digital") return hasPhysicalCounterpart(r);
  return false;
}

// Apply an alpha to a source colour so the paired-cluster fill can be
// translucent. Handles the two shapes we emit: a `#rrggbb` source colour, and
// the channel-var default `rgb(var(--c-ok))` (→ `rgb(var(--c-ok) / a)`, valid
// because --c-ok is a raw channel triple). Anything else is returned as-is.
export function colorWithAlpha(color: string, a: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  if (color.startsWith("rgb(var(")) return color.replace(/\)\s*$/, ` / ${a})`);
  return color;
}

export function isHttpUrl(s: string | null | undefined): boolean {
  return !!s && (s.startsWith("http://") || s.startsWith("https://"));
}
