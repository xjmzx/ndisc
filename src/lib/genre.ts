/**
 * release.v2 genre slug constants + the wire-to-display helper.
 *
 * Source of truth: schema/release.v2.json — keep this in sync with the grouped
 * `genreSlugs` (electronicDance / otherGenres / combining). The grouping is
 * semantic + palette ONLY — not a hierarchy; all 74 active slugs are pure
 * peers and may be freely combined. The canonical emittable-slug list also
 * lives Rust-side (src-tauri/src/lib.rs) for publish validation; these two
 * must agree.
 *
 * The four original compound slash-pairs were retired in the 2026-06
 * restructure (split/collapsed into atomic slugs). They live on in
 * GENRE_DEPRECATED: never emitted on new events, but still VALID for reading
 * legacy events and cross-relay copies, where they render with a slash.
 */

// Electronic/dance genres — vivid hues.
export const GENRE_ELECTRONIC_DANCE = [
  "ambient",
  "bass",
  "bleep",
  "breaks",
  "dnb",
  "downtempo",
  "electro",
  "electronic",
  "footwork",
  "garage",
  "glitch",
  "grime",
  "house",
  "jungle",
  "techno",
  "trance",
  "trap",
  "trip-hop",
] as const;

// Every other genre — muted, earthy hues.
export const GENRE_OTHER = [
  "alternative",
  "blues",
  "bossa-nova",
  "celtic",
  "choral",
  "classical",
  "country",
  "dancehall",
  "disco",
  "drone",
  "easy-listening",
  "experimental",
  "folk",
  "funk",
  "gospel",
  "gothic",
  "grunge",
  "hip-hop",
  "industrial",
  "jazz",
  "krautrock",
  "latin",
  "library",
  "metal",
  "noise",
  "pop",
  "punk",
  "reggae",
  "rnb",
  "rock",
  "ska",
  "soul",
  "soundtrack",
  "spoken",
  "swing",
] as const;

// Combining forms — modifiers that mean the same on any genre and compose by
// stacking (`dub` + `techno` = dub techno, `post` + `punk` = post-punk).
export const GENRE_COMBINING = [
  "abstract",
  "acid",
  "acoustic",
  "afro",
  "boom-bap",
  "conscious",
  "contemporary",
  "dub",
  "hardcore",
  "indian",
  "instrumental",
  "italo",
  "lo-fi",
  "minimal",
  "post",
  "proto",
  "psychedelic",
  "roots",
  "synth",
  "turntablism",
  "world",
] as const;

// Genre slots per release — release.v2 `genreInvariants.slotCap` (3 → 5 in
// the 2026-11 round). Must match GENRE_SLOT_CAP in src-tauri/src/lib.rs.
export const GENRE_SLOT_CAP = 5;

// The house ordering rule (mirrors house_genre_order in the backend), in three
// bands: `electronic` first, then the genres, then the combining forms (dub,
// acid, post, minimal…), each band keeping its order — `dub, reggae` is saved
// as `reggae, dub`. Takes dense slots, returns dense slots of the same length;
// nothing is added or dropped.
export function houseGenreOrder(slots: (string | null)[]): (string | null)[] {
  const combining = new Set<string>(GENRE_COMBINING);
  const band = (g: string) => (g === "electronic" ? 0 : combining.has(g) ? 2 : 1);
  const present = slots.filter((s): s is string => !!s);
  const ordered = [0, 1, 2].flatMap((b) => present.filter((g) => band(g) === b));
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

// Picker / display order: electronic/dance → other genres → combining forms.
export const GENRE_ORDER = [
  ...GENRE_ELECTRONIC_DANCE,
  ...GENRE_OTHER,
  ...GENRE_COMBINING,
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
