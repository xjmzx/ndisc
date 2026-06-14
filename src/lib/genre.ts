// Genre slug → human display string.
//
// Most slugs render verbatim. The exception is the compound *genre-pair*
// slugs — two distinct genres joined on the wire with a hyphen — which read
// better with a slash in UI (`dnb-jungle` → `dnb/jungle`). Single genre
// names that happen to contain a hyphen (e.g. `hip-hop`) are NOT pairs and
// must render verbatim, so we slash only the known pair slugs rather than
// blindly replacing every hyphen.
//
// Mirror this set in glmps. Canonical convention: schema/release.v2.json
// `compoundDisplayRule` + schema/README.md "Compound slug display".
const SLASH_DISPLAY_SLUGS = new Set([
  "classical-folk",
  "dnb-jungle",
  "drone-noise",
  "footwork-trap",
]);

export function genreDisplay(slug: string): string {
  return SLASH_DISPLAY_SLUGS.has(slug) ? slug.replace(/-/g, "/") : slug;
}
