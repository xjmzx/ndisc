> ⚠ **HISTORICAL ARTIFACT — not authoritative.** Preserved for context only.
> The contract is now `schema/release.v2.json`; the current end-state is
> summarised in `schema/README.md`. Two amendments landed after this RFC
> was written (v2.1 flatten, v2.1.1 `dub-techno` → `dub`); cite the
> README + JSON, not this file.

# release.v2 — proposal (RFC, rev 2)

**Status:** draft / awaiting glmps-side review
**Author:** ndisc (xjmzx)
**Scope:** additive — one new repeatable optional tag on kind:31237
**Rev history:**
- rev 1 — single optional `genre` tag
- rev 2 — repeatable `genre` tag, up to 3 slots, ordered (primary / secondary / tertiary)

> This is a proposal, not yet canonical. `release.v1.json` remains the frozen
> contract. A `release.v2.json` is **not** minted until both ndisc and the
> glmps viewers are ready to ship the change together — see the change policy
> in `README.md`.

## What changes

One new optional, **repeatable** tag is added to the kind:31237 release event:

| tag | required | type | repeatable | format |
|---|---|---|---|---|
| `genre` | false | string | 0–3 occurrences | one of the slugs below; omitted entirely when no genre is set |

**Order = priority.** First `genre` tag is primary, second is secondary, third
is tertiary. ndisc emits at most 3 occurrences per event.

No other tags change. No tags are removed. No tag semantics shift. The kind
(31237), the `d`-tag format (`disco-vault:<id>`), the `naddr` coordinate, and
the kind:5 deletion shape all remain identical.

### Why repeatable instead of `genre_primary` / `genre_secondary` / `…`

- Consumers iterate the tag array anyway; positional repeats are easier to
  parse than three differently-named tags.
- Future expansion (slot 4+, or a stem-tag wrapper) needs no new tag name.
- Matches the v1 NIP-73 `i`-tag repeatable pattern already in the contract,
  so consumers already have the shape in their parser.

## Why additive — v1 readers stay compatible

v1 readers iterate the tag set and lookup known names; unknown tags are
ignored (this is how every NIP-defined event handles forward-compat). So a
v2-emitting ndisc can publish freely to v1 consumers without breaking them —
the genre data simply isn't surfaced until the reader is upgraded.

That gives a soft rollout path:
1. Mint `release.v2.json` and update the canonical contract test in ndisc.
2. ndisc starts emitting `genre` tags (0–3 per release).
3. glmps viewers are upgraded to read them on their own schedule.

No flag-day required.

## Valid `genre` values

ndisc captures up to three genres per release (each slot optional). Each slot
must be one of the 18 valid slugs below. Labels' dominant genres are derived
client-side by aggregation, not emitted.

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

## Slot semantics + invariants

1. **Slots are ordered.** Order of `genre` tags in the emitted event IS the
   priority order — first = primary. Reorderers MUST preserve order.
2. **Slots are distinct.** No duplicate slug across the slots of a single
   event. ndisc enforces this at capture time.
3. **No parent + own-sub combos.** A release MUST NOT carry both `electronic`
   and any of its sub-genres (`acid`, `breaks`, `dnb-jungle`, `drone-noise`,
   `dub-techno`, `electro`, `footwork-trap`, `techno`) — pick one; the sub
   already implies the parent. Other sub/parent pairs from different families
   are fine (e.g. `techno` + `jazz` is valid).
4. **Empty slots are valid at any position; canonical form is dense.**
   ndisc-emitted events always compact present slugs to the lowest slots
   (no leading or interior nulls on the wire). Consumers receiving a sparse
   sequence (e.g. via a non-canonical re-emitter) SHOULD compact before
   indexing.
5. **Slot cap is 3.** Consumers MAY ignore any 4th `genre` tag — it's not
   part of the contract.

## Aggregation rule

Label "dominant genre" (used for the LABELS dot in ndisc, and any aggregate
surface in glmps) is computed by **primary slot only**. Weighting secondary /
tertiary into the rollup changes which colour the dot ends up in edge cases
but introduces a lot more SQL surface for marginal value; primary-only also
matches "this label is most known for X" intuition.

Reserved for v2.1+ if it ever becomes interesting: weighted dominance
(primary 1.0 / secondary 0.5 / tertiary 0.25).

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
18 known slugs, AND that invariants (distinct, no parent+own-sub) hold.
Strict-but-recoverable handling:

- Unknown slug → treat as absent (no colour, no chip rendered), or render
  with a neutral fallback (e.g. muted grey). Do NOT throw or fail the parse.
- Invariant violation (duplicate slug, illegal parent+sub combo, > 3 slots)
  → silently drop the offending slot(s); keep the remaining valid ones.

That posture keeps the door open for future additive slug additions inside
a v2-compatible scheme (any slug expansion that keeps existing slugs stable
could ship without forcing a v3 bump, by emitter-and-reader convention; a
renaming or removal still would).

## What's NOT changing

- `category` (the enum: album, ep, single, …) stays exactly as in v1.
  `genre` is a separate axis — a "release type" question vs a "musical
  style" question.
- `type` (the enum: music, sample, stem, …) stays unchanged.
- Labels manifest (`labels.v1.json`, kind:31238) is untouched — genre is
  per-release; label-level "dominant genre" is derived client-side.
- Deletion shape (kind:5, NIP-09) is unchanged.

## Replies to glmps RFC ack (rev 1)

> glmps already has a genre filter that reads from a free-form tags array.
> How should ndisc and glmps reconcile?

**ndisc has never emitted a free-form `t`-style genre tag** in kind:31237. v1
emits only the structured tags enumerated in `release.v1.json`. Whichever
field your filter is reading must be from another source — possibly a
heuristic, possibly events from another client, possibly external metadata.

Could you point at the exact event field your filter reads from? There may
be a misunderstanding to clear before any union/coexist strategy lands. In
v2 ndisc emits only the structured `genre` tag(s); no parallel free-form
list is added.

> Should ndisc lead the multi-genre wire format, or let glmps enrich
> viewer-side?

ndisc leads. Confirmed in rev 2 of this RFC — the wire format is now
3 ordered repeatable optional `genre` tags. No need for glmps to invent its
own multi-genre representation.

## Smart-capture intelligence (informative, not contract)

These are renderer-side suggestions for ndisc's capture UX; they do NOT
constrain the wire format and any consumer can implement or skip them
independently.

- **Slot N+1 hides parent / sub of slot N.** Drop-down for slot 2 hides
  any slug whose parent (or sub) is currently in slot 1, mirroring the
  no-parent+own-sub invariant at capture time.
- **Label-backfill prefill.** When the release's label is set and at least
  one other release on that label has genres, offer the most-common trio
  as a one-click prefill on the genre slots.
- Reserved for later: artist-cohort prefill, year-cohort prefill,
  by-format prefill.

## Coordination checklist (for when both sides are ready to ship)

- [ ] glmps confirms the rev-2 wire shape (repeatable `genre`, up to 3,
      ordered) is workable
- [ ] glmps clarifies the source of its current free-form genre filter so
      the union/coexist question can resolve
- [ ] Mint `schema/release.v2.json` (do not edit v1)
- [ ] Add `mod schema_v2` contract test in ndisc — pins the v2 wire output,
      including ordering + slot cap + invariant enforcement
- [ ] Replace the current single-column local genre plumbing in ndisc with
      3 ordered columns + 3 capture selects
- [ ] Add `genre` push_tag emission loop (1–3 tags) in `release_event()`
- [ ] Add fixtures: `release-31237-v2.full.json` (all 3 slots),
      `release-31237-v2.partial.json` (1 slot), `release-31237-v2.minimal.json`
      (no slots — same as v1 minimal)
- [ ] glmps vendors `release.v2.json`, adds its own freeze check + parser
      test (must handle 0/1/2/3 `genre` tags, validate ordering, enforce
      invariants on read)
- [ ] glmps adds the palette CSS vars to its theme(s)
- [ ] glmps renders genre visuals at the surface(s) of its choice

## Open questions for glmps

- What exact event field does the current genre filter read from? (Above.)
- Visual surfaces in glmps: the rev-1 ack suggested ReleaseCard left-bar +
  Genre facet + StatsSummary stacked bar + LabelCycler dot. With the rev-2
  multi-slot model, does any of that change? (e.g. ReleaseCard bar could
  be a 3-stop gradient by slot, or stay primary-only for simplicity.)
- Filter semantics — does the multi-match filter match against primary-
  only, or any slot? Recommend: any-slot match by default, with a primary-
  only toggle as a power-user option.
