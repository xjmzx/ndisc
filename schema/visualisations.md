# Visualisations — shared semantics

**Status:** living end-state spec. Update in place when a chart is added,
renamed, or its aggregation changes. Sidecar to `release.v2.json` and
`README.md`.

Scope: the *semantic* layer of each visualisation — which release field
it reads, how it aggregates, which palette it pulls from, and which
project ships it. **Dimensions and tuning constants (heights, gaps,
padding, scaling curves) are project-specific and not enumerated here.**
Both ends are free to choose the pixel sizes that suit their viewport.

## Entry format

- **Reads** — which field on `Release` (or derived aggregate) drives it.
- **Aggregation** — how multiple releases collapse into chart data.
- **Palette** — which CSS-var family colours the slices.
- **Scaling note** — default + room for each project to tune.
- **Implemented in** — concrete components per side.

---

## Genre family

### `genre-distribution`

Stacked horizontal bar showing share of a release set by genre.

- **Reads:** `release.genres[0..2]` (all populated slots)
- **Aggregation:** count-by-any-slot — a release with N distinct slugs
  contributes N tallies (one per slug). Consistent with v2.1's pure-peer
  model: secondary and tertiary genres are equally part of a release's
  sound, so they contribute equally to library composition counts.
  Slot order is preserved on the wire as emission priority, but isn't
  privileged for stats rollups.
- **Palette:** `--c-g-<slug>`
- **Scaling note:** sub-linear by default so the dominant slug doesn't
  drown the tail. glmps uses `k = 0.5` (square root). ndisc uses
  `k = 0.7`. Each project picks its own.
- **Implemented in:** glmps `GenreBar` (`src/components/GenreBar.tsx`);
  ndisc `StatsView` Genre card (`src/components/StatsView.tsx`)

### `genre-multi-slot-indicator`

Per-release chip showing up to three slot-ordered slugs.

- **Reads:** `release.genres[0..2]`
- **Aggregation:** none — raw slot order
- **Palette:** `--c-g-<slug>` per dot
- **Scaling note:** equal-sized dots; slot order = visual order.
- **Implemented in:** glmps `GenreDotChip` (used in `ReleaseCard`,
  `LabelCycler`, release-detail page)

### `genre-dominant-of-set`

Single colour (or top-N) summarising a labelled subset's genre slugs.

- **Reads:** `release.genres[0..2]` across a subset (e.g. all releases
  on a label, in a year, on a format)
- **Aggregation:** count-by-any-slot, then modal (or top-N ranked).
  Same justification as `genre-distribution` above — pure-peer slot
  model, no slot privileging.
- **Palette:** `--c-g-<slug>`
- **Scaling note:** n/a (point label)
- **Implemented in:** glmps `LabelCycler` (top-3 dots beside label name);
  ndisc `LabelviewPanel` (top-3 dots per row, via the
  `list_distinct_labels` CTE)

---

## Format family

### `format-distribution`

- **Reads:** `release.format` collapsed to a display bucket. The bucket
  map is project-specific — `formatGroup()` in glmps consolidates to 8
  buckets; ndisc's `bucket_format()` (in `src-tauri/src/lib.rs`) maps
  to 9: `lossless`, `lossy`, `vinyl_12`, `vinyl_10`, `vinyl_7`, `cd`,
  `cassette`, `box`, `other_physical`. Bucket sets diverging is fine —
  no shared contract.
- **Aggregation:** count-by-bucket
- **Palette:** project-specific. ndisc reuses system tokens (`ok` for
  lossless, `warn` for lossy, a `mauve`-shaded ramp for vinyl tiers,
  an `auburn`-shaded ramp for the other-physical sub-tiers). No
  shared `--c-f-<bucket>` palette family yet — defer until both ends
  have ship-ready visuals and want lockstep colours.
- **Implemented in:** ndisc `StatsView` Format card
  (`src/components/StatsView.tsx`)

---

## Medium family

### `medium-distribution`

- **Reads:** `release.medium` (`physical` | `digital` | absent)
- **Aggregation:** count-by-medium
- **Palette:** physical → `--c-mauve`, digital → `--c-digital`. Both
  ends are free to reuse those tokens; no need to mint new ones.
- **Implemented in:** ndisc `StatsView` Medium card
  (`src/components/StatsView.tsx`)

---

## Shared conventions

- **Slug-keyed palette:** charts that colour by a v2 genre slug pull from
  `rgb(var(--c-g-<slug>))` — never inline hex. Palette amendments
  (e.g. v2.1.3 `electronic` → grey) propagate via the CSS var.
- **Aggregation defaults:** library stats and filter predicates BOTH use
  any-slot counts. v2.1's pure-peer model removed the semantic gap
  between primary and the other slots; designating a primary for stats
  rollups would just smuggle that gap back in. Slot order on the wire
  is still emission priority — but it isn't privileged in aggregation.
- **Tuning autonomy:** scaling curves, heights, gaps, paddings, and the
  width of bars are project-specific. Don't try to match pixels — match
  semantics.
- **Where the constants live:** for each chart, the project that ships it
  owns the tuning constant in source. This doc points to the chart, not
  the constant.

## Adding an entry

1. Pick a stable `<family>-<verb>` name.
2. State which field on `Release` (or derived aggregate) it reads.
3. State the aggregation rule in one sentence.
4. State the palette source. If a new palette family is needed, document
   the CSS-var naming in `README.md`'s "Shared palette" section first.
5. Add the project(s) that implement it.

Don't enumerate pixel sizes here — both ends tune those independently.
The point of this file is to make sure both ends agree on *what each
chart means*, not *how it looks*.
