# release.v2 — proposal (RFC)

**Status:** draft / awaiting glmps-side review
**Author:** ndisc (xjmzx)
**Scope:** additive — one new optional tag on kind:31237

> This is a proposal, not yet canonical. `release.v1.json` remains the frozen
> contract. A `release.v2.json` is **not** minted until both ndisc and the
> glmps viewers are ready to ship the change together — see the change policy
> in `README.md`.

## What changes

One new optional tag is added to the kind:31237 release event:

| tag | required | type | format |
|---|---|---|---|
| `genre` | false | string | one of the slugs below; omitted entirely when no genre is set |

No other tags change. No tags are removed. No tag semantics shift. The kind
(31237), the `d`-tag format (`disco-vault:<id>`), the `naddr` coordinate, and
the kind:5 deletion shape all remain identical.

## Why additive — v1 readers stay compatible

v1 readers iterate the tag set and lookup known names; unknown tags are
ignored (this is how every NIP-defined event handles forward-compat). So a
v2-emitting ndisc can publish freely to v1 consumers without breaking them —
the genre data simply isn't surfaced until the reader is upgraded.

That gives a soft rollout path:
1. Mint `release.v2.json` and update the canonical contract test in ndisc.
2. ndisc starts emitting `genre`.
3. glmps viewers are upgraded to read it on their own schedule.

No flag-day required.

## Valid `genre` values

ndisc captures genre at the release level (single canonical genre per release;
labels' dominant genres are derived client-side by aggregation, not emitted).

**10 main genres:**

```
classical, downtempo, electronic, experimental, funk,
jazz,      pop,       reggae,     rock,         soundtrack
```

**8 electronic sub-genres:**

```
acid,       breaks,        dnb-jungle, drone-noise,
dub-techno, electro,       footwork-trap, techno
```

**Total:** 18 valid slugs. Sub-genres are only defined for `electronic` —
all other mains are flat.

### Compound slugs

Four sub-genres are compound (`dnb-jungle`, `drone-noise`, `dub-techno`,
`footwork-trap`). The wire format **always uses the hyphenated form** — it's
the canonical slug.

Renderers SHOULD display the slash form for human-facing UI:

```
dnb-jungle    → display "dnb/jungle"
drone-noise   → display "drone/noise"
dub-techno    → display "dub/techno"
footwork-trap → display "footwork/trap"
```

One-liner: `slug.replace(/-/g, "/")`.

## Palette — same on both ends

Each slug maps to a single hue, shared between ndisc and glmps so visuals stay
consistent. Define these as CSS variables at the theme root and reference by
name (`rgb(var(--c-g-<slug>))`).

**Mains:**

```
--c-g-classical:     232 220 195
--c-g-downtempo:     122  74 140
--c-g-electronic:    255  95 186
--c-g-experimental:  106 168 168
--c-g-funk:          232 178  55
--c-g-jazz:          199 127  78
--c-g-pop:           255 165 201
--c-g-reggae:         90 138  79
--c-g-rock:          176  57  46
--c-g-soundtrack:    100 137 184
```

**Electronic sub-genres** (same magenta hue family, lightness/saturation only):

```
--c-g-acid:          255  66 200
--c-g-breaks:        230  77 168
--c-g-dnb-jungle:    160  39 135
--c-g-drone-noise:   159 110 145
--c-g-dub-techno:    199  93 163
--c-g-electro:       255 111 184
--c-g-footwork-trap: 255 133 200
--c-g-techno:        214  58 153
```

**Design rationale:**
- Mid-saturation, mid-lightness — sits alongside the existing system tokens
  (mint/peach accents, digital cyan, ok green, warn amber, alert red, mauve,
  auburn) without competing with them.
- Family logic: pink (electronic ↔ pop), earth (funk → jazz → rock), cool
  (experimental → soundtrack → classical). Downtempo (plum) and reggae (moss)
  are standalone — picked to sidestep system-token collisions.
- Sub-genres share the electronic magenta hue and vary only in L/S, so the
  parent identity stays readable at a glance.

## Validation

Renderers SHOULD validate that an incoming `genre` tag value is one of the
18 known slugs. Unknown values SHOULD be either:

- Treated as absent (no colour, no chip rendered), or
- Rendered with a neutral fallback (e.g. muted grey).

DO NOT throw or fail the parse — strict-but-recoverable. This keeps the door
open for future additive slug additions inside a v2-compatible scheme (any
slug expansion that keeps existing slugs stable could ship without forcing a
v3 bump, by emitter-and-reader convention; a renaming or removal still would).

## What's NOT changing

- `category` (the enum: album, ep, single, …) stays exactly as in v1.
  `genre` is a separate axis — a "release type" question vs a "musical
  style" question.
- `type` (the enum: music, sample, stem, …) stays unchanged.
- Labels manifest (`labels.v1.json`, kind:31238) is untouched — genre is
  per-release; label-level "dominant genre" is derived client-side.
- Deletion shape (kind:5, NIP-09) is unchanged.

## Coordination checklist (for when both sides are ready to ship)

- [ ] glmps viewers signal they're ready to consume the new tag
- [ ] Mint `schema/release.v2.json` (do not edit v1)
- [ ] Add `mod schema_v2` contract test in ndisc — pins the v2 wire output
- [ ] Add `genre` push_tag emission in `release_event()` (ndisc)
- [ ] Add fixtures: `release-31237-v2.full.json`, `release-31237-v2.minimal.json`
- [ ] glmps vendors `release.v2.json`, adds its own freeze check + parser test
- [ ] glmps adds the palette CSS vars to its theme(s)
- [ ] glmps renders genre dot / chip / bar at the visual surface(s) of its choice

## Open questions for glmps

- Visual surface: where does glmps want to surface genre — release card,
  label aggregation, year-strip histogram? (ndisc's first surface is a
  per-row genre-tinted dot on the LABELS list; glmps has more room.)
- Multi-genre future: ndisc is single-canonical-per-release for now. If
  glmps needs primary/secondary later, that would be a separate axis (e.g.
  a second optional tag `genre_secondary`) — flag it now if relevant.
