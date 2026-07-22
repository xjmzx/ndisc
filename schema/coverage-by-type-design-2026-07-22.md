# Coverage-by-type + playback source-select — design note (2026-07-22)

> **Status: BUILT — Phases 1–3 (ntree, 2026-07-22).** The ntree-side counterpart
> to nsmpl's three-root switcher. No wire change; a per-app library-view feature
> over the three suite trees (`music` / `music_clips` / `music_clips_comp`). What
> shipped is in "Built" below; the sections beneath it are the original spec,
> kept for the reasoning (the shape settled differently — see Built).

## Built — Phases 1–3 (2026-07-22)

The per-row bar became a **full-track play/navigate timeline**, and the three
type-views shipped as **playback controls** whose presence doubles as the
coverage-by-type readout — rather than the "three stacked bars vs triple dot"
sketched below.

**Phase 1 — the bar is a full-track timeline.** Each track row's `TrackTimeline`
spans the full source duration; the 10 s sample is a marked region at its true
offset (~30 s), floored to ≥6% width so a short slice stays visible. Click to
play / seek the full **source** track (cheap seek while playing) via a reused
`HTMLAudioElement`; an accent playhead tracks position.

**Phase 2 — source · clip · Opus per row.** Three auditions: the bar (source),
the ▶ button (10 s FLAC clip, present when sampled), and a `[🌐 opus]` chip (the
Opus web copy, present when compressed). One shared audio element, so starting
any stops the others — A/B the FLAC vs its Opus. **Availability *is* the
coverage-by-type readout** (▶ ⇒ clip on disk · 🌐 ⇒ opus on disk · bar ⇒ source).
Opus resolves by string-mirror: `compressDest/<sig>.10s.opus`.

**Phase 3 — WaveSurfer source waveform.** Selecting a track shows a read-only
WaveSurfer waveform of the source in the Sample panel — scrub + play + the 10 s
region marked; mutually exclusive with the row playback. Parity with nsmpl
(separate code, same palette); nsmpl untouched. *Deferred: ranged/streamed decode
— full-FLAC decode is a beat for long tracks.*

**Colour identity.** A stable `--c-opus` blue (survives every theme, like a
verdict) gives Opus a distinct identity vs the neutral `--c-medium` clip. Every
coverage/duration bar in **both** apps adopted the shared
`[--c-medium sample | --c-opus/15 remainder]` scheme.

*Noted follow-up: revisit element appearance + row layout in ntree.*

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

## Decisions — how the open questions resolved

1. **Bar vs segmented indicator** → *neither as sketched.* The bar became a
   full-track timeline; the three types are playback controls whose presence is
   the coverage readout.
2. **Where the roots come from** → kept **per-app config** (ntree's
   Source/Dest/Compress; nsmpl's `lib/roots.ts`). The shared roots manifest stays
   the long-term convergence point — not adopted yet.
3. **nsmpl parity** → **yes.** The `--c-opus` blue + `[grey | blue]` bar scheme
   apply to nsmpl's coverage bars too.
4. **Playback file resolution** → **string-mirror** across roots (not
   `resolve_source`/the manifest).

**Still open / deferred:**
- **Ranged/streamed decode** for the waveform (long-FLAC decode latency).
- **Shared roots manifest** convergence (both apps still on per-app roots).
- **Appearance + layout revisit** in ntree — element styling / row layout, a
  noted next pass.

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
