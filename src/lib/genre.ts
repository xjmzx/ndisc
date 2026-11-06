/**
 * release.v2 genre slug constants + the wire-to-display helper.
 *
 * Source of truth: schema/release.v2.json — keep this in sync with the grouped
 * `genreSlugs` (acoustic / electronic / bridge / tertiary). The grouping is
 * semantic + palette ONLY — not a hierarchy; all 41 active slugs are pure
 * peers and may be freely combined. The canonical emittable-slug list also
 * lives Rust-side (src-tauri/src/lib.rs) for publish validation; these two
 * must agree.
 *
 * The four original compound slash-pairs were retired in the 2026-06
 * restructure (split/collapsed into atomic slugs). They live on in
 * GENRE_DEPRECATED: never emitted on new events, but still VALID for reading
 * legacy events and cross-relay copies, where they render with a slash.
 */

// Primary / acoustic family — muted, earthy.
export const GENRE_ACOUSTIC = [
  "ambient",
  "blues",
  "classical",
  "disco",
  "experimental",
  "folk",
  "funk",
  "hip-hop",
  "jazz",
  "latin",
  "metal",
  "pop",
  "reggae",
  "rnb",
  "rock",
  "soul",
  "soundtrack",
  "spoken",
] as const;

// Secondary / electronic family — vivid, spread across the hue wheel.
export const GENRE_ELECTRONIC = [
  "acid",
  "bass",
  "breaks",
  "dnb",
  "downtempo",
  "electro",
  "electronic",
  "footwork",
  "garage",
  "house",
  "jungle",
  "minimal",
  "techno",
] as const;

// Bridge — sit between the acoustic and electronic families, own hues.
export const GENRE_BRIDGE = ["dub", "noise"] as const;

// Tertiary / optional — cross-cutting styles.
export const GENRE_TERTIARY = [
  "abstract",
  "boom-bap",
  "conscious",
  "lo-fi",
  "trance",
  "trap",
  "turntablism",
  "world",
] as const;

// Genre slots per release — release.v2 `genreInvariants.slotCap` (3 → 5 in
// the 2026-11 round). Must match GENRE_SLOT_CAP in src-tauri/src/lib.rs.
export const GENRE_SLOT_CAP = 5;

// The house ordering rule (mirrors electronic_first in the backend): when
// `electronic` is present it is the first genre, and the rest keep their
// order. Takes dense slots, returns dense slots of the same length; nothing is
// added or dropped.
export function electronicFirst(slots: (string | null)[]): (string | null)[] {
  const present = slots.filter((s): s is string => !!s);
  const ordered = [
    ...present.filter((g) => g === "electronic"),
    ...present.filter((g) => g !== "electronic"),
  ];
  return slots.map((_, i) => ordered[i] ?? null);
}

// Retired slugs — never emitted; valid for legacy reads only. The four compound
// slash-pairs (display with a slash) plus the 2026-06b 1:1 renames poetry and
// spiritual (display verbatim; remapped to spoken / conscious).
export const GENRE_DEPRECATED = [
  "classical-folk",
  "dnb-jungle",
  "drone-noise",
  "footwork-trap",
  "poetry",
  "spiritual",
] as const;

// Picker / display order: acoustic → electronic → bridge → tertiary.
export const GENRE_ORDER = [
  ...GENRE_ACOUSTIC,
  ...GENRE_ELECTRONIC,
  ...GENRE_BRIDGE,
  ...GENRE_TERTIARY,
] as const;

export type GenreSlug =
  | (typeof GENRE_ORDER)[number]
  | (typeof GENRE_DEPRECATED)[number];

// Readable set = active (emittable) + deprecated (legacy-only) so legacy
// events keep their genres on read.
const KNOWN: ReadonlySet<string> = new Set<string>([
  ...GENRE_ORDER,
  ...GENRE_DEPRECATED,
]);

export function isGenreSlug(s: string): s is GenreSlug {
  return KNOWN.has(s);
}

// Wire-to-display. Per-slug overrides keep the canonical wire slug and only
// change the label: `rnb` → "R&B" (ndisc does NOT remap soundtrack → "film";
// that's a glmps-side cosmetic). The retired compound pairs render with a
// slash when met in legacy events; the set is scoped to exactly those four so
// atomic hyphen slugs (`hip-hop`, `lo-fi`, `boom-bap`) render verbatim.
const DISPLAY_OVERRIDES: Record<string, string> = {
  rnb: "R&B",
};

const SLASH_DISPLAY_SLUGS = new Set<string>([
  "classical-folk",
  "dnb-jungle",
  "drone-noise",
  "footwork-trap",
]);

export function genreDisplay(slug: string): string {
  const override = DISPLAY_OVERRIDES[slug];
  if (override) return override;
  return SLASH_DISPLAY_SLUGS.has(slug) ? slug.replace(/-/g, "/") : slug;
}
