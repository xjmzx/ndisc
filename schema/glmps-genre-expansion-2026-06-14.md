> **Status: non-authoritative conversation artifact.** This is a heads-up
> note for the glmps session describing the v2.1.4 amendment. The
> authoritative spec is `release.v2.json` + `README.md` in this directory.
> If anything here conflicts with those, they win.

# v2.1.4 — genre slug expansion (18 → 22)

**Date:** 2026-06-14 · **Type:** additive slug addition (no v3 bump) ·
**ndisc side:** done, pinned by `mod schema_v2`.

## What changed

Four new genre slugs. The mains/subs split is still a palette grouping
only — all 22 slugs remain pure peers (no hierarchy, no parent/sub gate).

| slug | group | rgb | hue rationale |
|---|---|---|---|
| `ambient` | main | `176 199 209` | pale ice steel-blue — airier than soundtrack `100 137 184`; cool family |
| `hip-hop` | main | `158 104 66` | warm clay-brown — sits below jazz copper in the earth ramp, no red clash with rock |
| `bass` | electronic sub | `120 40 108` | deepest/darkest purple-magenta — heavier than dnb-jungle `160 39 135` |
| `house` | electronic sub | `190 80 188` | violet-magenta (R≈B lean) — fills the purple gap in the magenta family |

`bass` is deliberately a **broad dub-derived / bass-music umbrella**
(dubstep · grime · garage · 2-step), not a narrow scene tag — it sits
beside the existing `dub` and `dnb-jungle`. `house` is four-on-the-floor
house in all its variants.

Full slug set is now:

```
mains:           ambient, classical-folk, downtempo, electronic, experimental,
                 funk, hip-hop, jazz, pop, reggae, rock, soundtrack
electronic subs: acid, bass, breaks, dnb-jungle, drone-noise, dub, electro,
                 footwork-trap, house, techno
```

## What glmps needs to do

1. **Re-vendor `release.v2.json`** and re-pin its SHA-256. The only JSON
   change is the two `genreSlugs` arrays (`mains`, `electronicSubs`) plus
   the `compoundDisplayRule` text (see point 3).
2. **Mirror the four new palette triplets** as `--c-g-ambient`,
   `--c-g-hip-hop`, `--c-g-bass`, `--c-g-house` in both theme roots
   (fizx + upleb — the genre layer is theme-neutral, identical values).
3. **⚠️ Fix the compound-slug display helper — this is the one gotcha.**
   `hip-hop` is a single genre name that contains a hyphen. A blind
   `slug.replace(/-/g, "/")` mangles it into `hip/hop`. Switch to a
   set-based helper that slashes **only the known pair slugs**:

   ```js
   const SLASH_DISPLAY = new Set([
     "classical-folk", "dnb-jungle", "drone-noise", "footwork-trap",
   ]);
   const display = (s) => SLASH_DISPLAY.has(s) ? s.replace(/-/g, "/") : s;
   ```

   ndisc's copy is `src/lib/genre.ts` (`SLASH_DISPLAY_SLUGS`). Anywhere
   glmps currently does an inline `.replace(/-/g, "/")` on a slug needs
   this change — otherwise `hip-hop` renders wrong wherever it appears.

## What glmps does NOT need to do

- **No migration.** Existing releases are untouched; the new slugs simply
  become available. Nothing needs re-publishing for this amendment (unlike
  the v2.1.2 rename).
- **No aggregation change.** Any-slot counting for stats + filters is
  unchanged.
