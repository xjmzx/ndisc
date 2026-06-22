# Audio-visual media type — incubation note

> **Status: INCUBATION / design note — NOT canonical, NOT scheduled.**
> This sketches the direction for adding video-bearing ("audio-visual")
> releases and files across the ndisc app suite. Nothing here is frozen,
> vendored, or implemented. No `release.v3.json` exists. The authoritative
> spec remains `release.v2.json` + `README.md` in this directory — if
> anything here conflicts with those, they win. Do not cite as spec.

Date: 2026-06-19 · Owner intent: "do this properly," not as a thin tag.

---

## DECISIONS LOCKED (2026-06-22)

Owner resolved the pivotal forks; appetite shifted from the 2026-06-19
"do it properly / stream-based" stance toward a **simple, non-breaking,
ndisc-first** path. The Layer-2 "properly" work is NOT cancelled — just
explicitly deferred behind the cheap wire change.

1. **Mechanism — additive `video` flag tag, NOT a `type` enum value.**
   `type` values are mutually exclusive, so `type=video` would strip a
   music-video's "music" identity. The real use case is "filter
   /data/music releases that *contain* video," i.e. a music release with
   a video file. So video presence is modelled **orthogonally** to `type`,
   as a new OPTIONAL tag. This falls squarely under changePolicy additive
   exception (2) — **no `type` enum change, no changePolicy amendment, no
   v3 bump.** Standalone `type=video` releases are NOT pursued now (can be
   added later if a true A/V-works collection appears).

2. **Detection — extension-based.** Recognize known video extensions in
   the release folder (candidate set: `.mp4 .mkv .mov .webm .m4v .avi
   .wmv .flv .mpg .mpeg .ogv`). Simple, local, mirrors the `track_count`
   scan. ACCEPTED CAVEAT: an audio-only `.mp4`/`.mkv` will false-positive;
   stream-based probing (ffprobe) is deferred to the Layer-2 work.

3. **Scope — ndisc-side wire first.** Land detection + flag + filter in
   ndisc (emitter), publish the tag, re-vendor `release.v2.json` + re-pin
   SHA across glmps×2 + ndisc.view. Defer the cross-suite file-awareness
   layer (smpl/tree, terrain-roots video root, stream probing) to later.

### `video` tag spec (additive, release.v2.json)

- Wire: `["video", "<count>"]` — integer (count of recognized video files
  in the release folder) rendered as a string, like `tracks`/`discs`.
  **Emitted only when ≥ 1**; omitted otherwise. Consumers treat *presence*
  as "this release carries audio-visual content"; the value is an optional
  richer hint (how many video files).
- Local storage: a new `video_count` column on `releases` (INTEGER, NULL =
  unscanned/unknown), populated by a folder-walk pass like `recount_tracks`.
  Local-derived, per-device — but UNLIKE `track_count`, its >0 truth IS
  published (a release property: "this release has video"), so it bumps
  publish-staleness via `mark_unpublished` when it changes.
- Schema: add `video` to `release.v2.json` tags with a `tracks`/`discs`-
  style ADDITIVE note; does NOT bump the schema version. Re-vendor + re-pin
  SHA into glmps×2 + ndisc.view (the usual ritual; `prebuild` freeze-check
  guards it). Consumers already lenient (ndisc.view doesn't read `type`,
  parser requires only `d`), so absent-tag = no A/V data, never an error.
- UI (ndisc): a "has video" filter (sibling to publishedFilter/genreFilter)
  + a small row indicator. Reuse suite glyph language; exact treatment TBD.

Open/deferred unchanged: Layer-2 file-awareness, smpl/tree video handling,
standalone `type=video`, sub-kinds (`avkind`), companion-vs-standalone for
true A/V works. Revisit alongside terrain-roots.

---

## Why this exists

The library is overwhelmingly audio, but a handful of artists and releases
have **music videos / accompanying audio-visual works** worth collecting
and organizing together rather than leaving as loose files. Video does
**not** fit inside the existing narrow audio band — it is a genuinely new
media type, not an attribute squeezed onto an audio release. The stated
direction is therefore: **a new `audio-visual` media type**, modelled with
the same care as the rest of the contract.

Crucially, the owner has pushed back on "keep it minimal/additive." The
goal is for **every app — ndisc (emitter), both schema consumers
(`ndisc.view`, `glmps`×2), AND the schema non-consumers (`ndisc.smpl`,
`ndisc.tree`) — to be aware of which files are audio-only and which
carry a video stream.** That awareness is a lower layer than the release
wire and is the harder, more interesting half of this work.

## Two layers (don't conflate them)

This effort splits cleanly, and the two halves can move at different speeds:

1. **Release-wire layer** — how an audio-visual *release* is expressed in
   the kind:31237 event. Touches only the four schema participants
   (ndisc + the three consumers). This is the smaller, more tractable half.
2. **File-format-awareness layer** — how *every* app, including the two
   non-consumers, knows a given file on disk carries video vs audio-only.
   This is cross-suite, sits on the terrain/roots storage model, and is
   the part the owner wants done properly. See
   [terrain-roots-design-2026-06-16.md](terrain-roots-design-2026-06-16.md).

---

## Layer 1 — the release media type (wire)

### Shape

A new value on the existing `type` field
(`music | sample | stem | field-recording | message | other`), e.g.
`audio-visual` (or `av`). A release of this type is one whose primary
artifact carries a video stream — a music video, a live/concert capture, a
visualizer, a short film tied to a record, etc.

### Flat peers vs sub-kinds — OPEN

The owner floated two options, explicitly leaning on consistency with the
existing model:

- **(a) Flat peers** — `audio-visual` is one `type` value, and any finer
  distinction is just convention. Simplest; matches the "all 35 active genre
  slugs are pure peers" philosophy.
- **(b) A small set of A/V sub-kinds** — candidate vocabulary to debate:
  `music-video`, `live` / `concert`, `visualizer`, `short-film`,
  `documentary`. If we want grouping, the genre precedent is the right
  template: a **palette/UI grouping only**, with all sub-kinds remaining
  semantic peers (cf. the `acoustic` / `electronic` / `bridge` / `tertiary`
  genre groups, which are hue + semantic grouping, not hierarchy — see
  `genreSlugs._comment`).

Recommendation to pressure-test: start with one `audio-visual` `type`
value, and if sub-kinds are wanted, model them as a **separate optional
tag** (e.g. `avkind`) rather than overloading `type` — keeps the top-level
`type` enum small and lets the sub-vocabulary expand additively like
genre slugs do.

### Music-video-AS-companion vs music-video-AS-release — OPEN

The owner said "music videos, or any **accompanying** video." "Accompanying"
hints that some A/V is a *companion to an existing music release*, not a
standalone work. Two models, not mutually exclusive:

- **Standalone** — an A/V release is its own kind:31237 event with
  `type=audio-visual`. Clean; collectible on its own.
- **Companion** — an existing music release gains an optional pointer to a
  video artifact (additive optional tag, e.g. `video` carrying a URL/blob
  ref). Old consumers ignore it; A/V-aware ones surface it inline.

These can coexist: standalone for "this artist's video works," companion
for "this album's single has a video." Worth deciding which the library's
actual content wants before committing.

### Additive or v3? — DECISION REQUIRED

This is the one policy snag. The `changePolicy` currently blesses exactly
two additive-without-v3 exceptions: (1) new optional `genreSlugs`, (2) new
optional ignorable tags. **Adding a value to the `type` enum is neither.**
A strict conformant validator could reject an out-of-enum `type` value, so
it is *semantically* additive but not *guaranteed* backward-safe under the
current rules. Three ways forward:

- **(A) Amend the changePolicy** to bless additive `type` enum values the
  same way it blesses `genreSlugs` (require consumers to treat unknown
  `type` as `other`-equivalent, never reject). Keeps A/V in the cheap lane.
  Cleanest if we make consumers lenient *first*, then add the value.
- **(B) `release.v3.json`** — a coordinated bump with migration. Heavier;
  only justified if A/V drags in other breaking changes at the same time.
- **(C) Companion-only via an optional `video` tag** — pure additive under
  rule (2), no `type` change at all. Cheapest, but gives up standalone A/V
  releases.

Leaning (A): make consumers lenient about unknown `type` (a good hardening
regardless), then add `audio-visual` additively. Revisit if A/V turns out
to need breaking structure.

---

## Layer 2 — cross-app file-format awareness (the "properly" part)

Every app indexes files; today none of them record **whether a file
carries a video stream.** Doing this properly means:

- **Stream-based, not extension-based.** `.mp4`/`.m4a` can be audio-only;
  `.mkv`/`.mov` can be audio-only; a "video" file is one whose container
  actually has a video stream. Detection must probe streams (ffprobe-style:
  enumerate streams, flag presence of a video stream), not guess from the
  extension. Store a per-file fact — e.g. `hasVideo: bool` and/or a
  `streams` summary — at index time.
- **Lives on the terrain/roots model.** This is exactly the layer the
  terrain/roots note introduces (typed roots, `(root, relpath)` identity).
  A/V likely wants its own root category (e.g. `music_clips` / `video`)
  alongside `music`, and the per-file `hasVideo` fact rides the same
  indexing pass. This is why Layer 2 is shared by the non-consumer apps:
  they index files too, they just don't read kind:31237.
- **What the two sister apps need is unresolved.** `ndisc.tree` (quality
  analysis / playback) and `ndisc.smpl` (samples) *may or may not* gain
  the ability to analyze or play video. The owner has not resolved this.
  Minimum bar regardless: they must be **format-aware enough not to
  mishandle** a video-bearing file — e.g. not run audio-only analysis on a
  container's audio track unknowingly, not choke on an unexpected stream
  layout, surface "has video" in the UI even if they can't act on it.
  Open question: do they decode the audio track out of an A/V container,
  ignore A/V files entirely, or grow real video capability later?

---

## Open questions (to resolve before any implementation)

1. `type` value name: `audio-visual` vs `av` vs `video`?
2. Flat peer vs sub-kinds — and if sub-kinds, a `type` overload or a
   separate additive `avkind` tag?
3. Standalone A/V release, companion-video tag, or both?
4. Policy path: amend changePolicy for additive `type` (option A) vs v3
   (B) vs companion-tag-only (C)?
5. File-fact shape: `hasVideo: bool` minimal, or a richer `streams`
   descriptor (codec, resolution, has-audio, has-video)?
6. New root category for video — name and whether it's `source` or
   `output` in terrain terms?
7. Do `ndisc.smpl` / `ndisc.tree` gain video capability, stay
   audio-only-but-aware, or skip A/V files? (explicitly unresolved)

## Suggested sequencing (when this leaves incubation)

1. Land the **file-format-awareness layer first** (stream probing +
   `hasVideo` fact + a video root) — it's the shared foundation and is
   useful even before any wire change. Couple it to the terrain/roots work.
2. Harden all schema consumers to treat **unknown `type` as `other`**
   (lenient read) — prerequisite for option A.
3. Add the `audio-visual` `type` value (+ optional `avkind`/`video` tag as
   decided), amend the `changePolicy` note, re-vendor + re-pin SHA across
   `ndisc.view` + `glmps`×2 (the usual ritual; the `prebuild` freeze-check
   guards it).
4. Decide per-app whether `ndisc.smpl` / `ndisc.tree` analyze, ignore,
   or merely flag video.

---

*Companion reading in this dir: [v2-proposal.md](v2-proposal.md) (how v2
itself was scoped), [terrain-roots-design-2026-06-16.md](terrain-roots-design-2026-06-16.md)
(the storage layer Layer 2 sits on), `README.md` + `release.v2.json` (the
live contract).*
