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

Stacked horizontal bar showing share of a release set by primary genre.

- **Reads:** `release.genres[0]` (primary slot)
- **Aggregation:** count-by-primary — each release contributes exactly once
- **Palette:** `--c-g-<slug>`
- **Scaling note:** sub-linear by default so the dominant slug doesn't
  drown the tail. glmps uses `k = 0.5` (square root). ndisc may pick its own.
- **Implemented in:** glmps `GenreBar` (`src/components/GenreBar.tsx`)

### `genre-multi-slot-indicator`

Per-release chip showing up to three slot-ordered slugs.

- **Reads:** `release.genres[0..2]`
- **Aggregation:** none — raw slot order
- **Palette:** `--c-g-<slug>` per dot
- **Scaling note:** equal-sized dots; slot order = visual order.
- **Implemented in:** glmps `GenreDotChip` (used in `ReleaseCard`,
  `LabelCycler`, release-detail page)

### `genre-dominant-of-set`

Single colour (or top-N) summarising a labelled subset's primary slugs.

- **Reads:** `release.genres[0]` across a subset (e.g. all releases on a
  label, in a year, on a format)
- **Aggregation:** count-by-primary, then modal (or top-N ranked)
- **Palette:** `--c-g-<slug>`
- **Scaling note:** n/a (point label)
- **Implemented in:** glmps `LabelCycler` (top-3 dots beside label name)

---

## Format family — ndisc-side, to populate

### `format-distribution`

- **Reads:** `release.format` collapsed to a display bucket. The bucket
  map is project-specific (`formatGroup()` in glmps consolidates to 8
  buckets; ndisc may differ).
- **Aggregation:** count-by-bucket
- **Palette:** *(propose `--c-f-<bucket>` if a shared palette is wanted;
  document under README's "Shared palette" section before adding here)*
- **Implemented in:** ndisc *(to fill)*

---

## Medium family — ndisc-side, to populate

### `medium-distribution`

- **Reads:** `release.medium` (`physical` | `digital` | absent)
- **Aggregation:** count-by-medium
- **Palette:** *(both ends already render physical/digital in distinct
  colours; propose reusing those tokens rather than minting new ones)*
- **Implemented in:** ndisc *(to fill)*

---

## Shared conventions

- **Slug-keyed palette:** charts that colour by a v2 genre slug pull from
  `rgb(var(--c-g-<slug>))` — never inline hex. Palette amendments
  (e.g. v2.1.3 `electronic` → grey) propagate via the CSS var.
- **Aggregation defaults:** library stats use primary-only counts; filter
  predicates use any-slot match. Split per `v2-proposal-glmps-reply.md`
  (historical), applies across both ends.
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
