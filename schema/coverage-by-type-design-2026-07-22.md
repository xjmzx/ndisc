# Coverage-by-type + playback source-select — design note (2026-07-22)

> **Status: SPEC — not built.** The ntree-side counterpart to nsmpl's three-root
> switcher. No wire change; a per-app library-view feature over the three suite
> trees (`music` / `music_clips` / `music_clips_comp`). Design conversation only.

## Why this exists (and why the nsmpl switcher can't just be ported)

nsmpl's Library is a **file browser** — you navigate real directories, so a
relative-position root switcher (Source · Clips · Web, landing on the mirrored
sub-path) fits it directly (shipped 2026-07-22).

ntree's Library is **not** a browser: it is a **scan tree of the source library**
(`ScanRow[]` from the scan report, grouped artist → album → track) with
clip-coverage overlays. It never browses `music_clips`/`music_clips_comp` — it
*derives* coverage from them (`sampledSignatures` = a scan of the clips dest for
`.10s.flac`; `compressedSignatures` = a scan of the compress dest for `.10s.opus`).

So "wire the switcher into ntree" doesn't map. What ports is the *concept* — the
three trees — surfaced the way ntree already works: **per-type coverage on each
row**, plus **playback source-select**. ntree is already positioned for it: it has
the source scan (durations included), the FLAC-clip signatures, and the Opus
signatures. This note specs surfacing all three.

## The model

For each track row, three parallel facets (ntree already knows all three):

| Facet | Source of truth (already in ntree) | Reads as |
|---|---|---|
| **Source** | the `ScanRow` itself (always present; has duration) | the row exists · full length |
| **FLAC clip** | `sampledSignatures` (scan of `music_clips`) | the existing 10 s clip-coverage bar |
| **Opus web** | `compressedSignatures` (scan of `music_clips_comp`) | present / absent (+ its own bar) |

Rollups (album / artist) aggregate the three the same way the current
duration-weighted coverage rollup already does.

**Presentation (open — see decisions):** either three stacked thin bars per row
(source = full-width reference, FLAC + Opus as fractions), or one segmented
indicator (a small triple: ● source / ● flac / ● opus, each present/absent in
`--c-medium`, missing faint). Keep the mono dot model — grey in mono, colour
only for a real state; verdicts (`HI-RES`/`LOSSLESS`) stay green regardless.

## Playback source-select

ntree's per-track play button currently auditions one file. Extend it to pick
**which** of the three to play — Source / FLAC clip / Opus web — so you can A/B
the master, the working clip, and the web copy. Resolution reuses ntree's three
configured roots (Source · Destination · Compress) + the track's relpath (same
mirroring the Compress step and nsmpl's switcher already do). A facet with no
file on disk is simply not offered.

## Open decisions (before building)

1. **Bar vs segmented indicator** — three stacked bars (richer, taller rows) vs a
   compact triple dot/segment (denser, less quantitative). Row height budget in
   the tree is tight; lean compact.
2. **Where the roots come from** — ntree already has Source/Dest/Compress as
   per-app config; keep that, or move to the shared roots manifest (the deferred
   option-1 that nsmpl already reads via `clips_root`/`resolve_source`). The
   manifest is the long-term convergence point for both apps.
3. **nsmpl parity** — does nsmpl's browser rows grow the same three-facet
   indicator? It already shows one coverage bar (clip ÷ source); Opus would be a
   third. Probably yes, for consistency.
4. **Playback file resolution** — trivial string-mirror across roots (like the
   switcher) vs going through `resolve_source`/the manifest.

## Visual-consistency baseline (harmonized 2026-07-22, so the three read as one)

Recorded here because coverage-by-type will add glyphs to both library views, and
they must stay consistent with ndisc:

- **Dot colour model** — all decorative indicators on `--c-medium` (grey in mono,
  green in colour); `--c-ok` verdicts never greyed. (ntree + nsmpl done.)
- **Count glyphs** — ndisc's rule: **dots** = a per-item quantity (tracks,
  present-vs-expected); a **numbered circle** (`CountBadge`, `rounded-full`,
  `bg-medium`) = a rolled-up child count (discs; ntree's releases-per-artist;
  nsmpl's audio-files-per-folder, switched dots→circle 2026-07-22).
- **Font weight** — row names at ndisc's lighter weight; ntree's artist rows
  dropped `font-semibold` → `font-medium` to match (2026-07-22).

## Related

- `clip-mapping-design-2026-07-17.md` — `clip.v1` provenance + the reconcile that
  makes "which types exist" truthful off the relays.
- `terrain-roots-design-2026-06-16.md` — the roots/editions model this reads from.
- nsmpl three-root switcher (Source/Clips/Web, relative-position) — the browser
  counterpart shipped in `nsmpl` 2026-07-22.
- ntree Compress step (`music_clips` FLAC → `music_clips_comp` Opus) — produces
  the third facet.
