# ndisc event schema — canonical contract

ndisc publishes its discography to Nostr; the glmps web viewers
(`glmps.fizx.uk` / `glmps.upleb.uk`) consume it. This directory is the
**single canonical home** of the wire contract between them, plus the
shared visual / interaction language for sister ndisc-suite apps.

Living documents:

- **`release.v2.json`** — current canonical wire contract for release
  events (kind 31237) and deletions (kind 5). Frozen-with-amendments
  (additive-only).
- **`release.v1.json`** — historic, frozen verbatim; v2 readers do NOT
  need it.
- **`labels.v1.json`** — wire contract for the record-label image
  library event (kind 31238). Unfrozen until ndisc ships publishing.
- **`visualisations.md`** — sidecar to the JSON contracts. Documents
  the *semantic* layer of each chart (which field, which aggregation,
  which palette) shared between ndisc, glmps, and sister suite apps.
  Pixel dimensions are project-specific.

Everything else in this directory (`v2-proposal.md`,
`v2-proposal-glmps-reply.md`, `glmps-catchup-2026-06-10.md`,
`glmps-proposal-electronic-grey-2026-06-12.md`) is preserved
**conversation history** of how v2 took shape. Each carries a banner
flagging it as non-authoritative; do not cite them as spec.

## How it fits together

```
  ndisc — release_event() in src-tauri/src/lib.rs
     │   (the ONLY code that emits events)
     │ described by
     ▼
  schema/release.v2.json            ← CANONICAL · frozen (additive-only)
     │
     ├─ pinned in ndisc by ──►  mod schema_v2  (cargo test)
     │                          ndisc's build fails if emitted output drifts
     │
     └─ vendored verbatim by ─►  glmps, both sites
                                 assert-parse + freeze check on every build;
                                 SHA-256 pinned in repo, lockstep across sites

  schema/visualisations.md          ← living chart-semantics sidecar
     │
     ├─ ndisc implements ──►  StatsView (Genre, Medium, Format, Year,
     │                        Country, Label) + LabelviewPanel
     │
     ├─ glmps  implements ──►  GenreBar + GenreDotChip + LabelCycler
     │
     └─ sister apps may  ──►  vendor specific chart entries to keep
                              visual/interaction language consistent
```

## End-state summary (as of v2.1.4, 2026-06-14)

For glmps's catch-up: this section captures the current contract state in
plain language. The wire spec in `release.v2.json` is authoritative; this
is a friendly recap.

### Kind 31237 `release` — superset of v1

v2 keeps every v1 tag (`d`, `title`, `artist`, `type`, `category`,
`medium`, `format`, `year`, `label`, `catalog`, `country`, `condition`,
`source`, `i`, `image`) with identical semantics. The one structural
addition is a repeatable optional `genre` tag.

### `genre` tag (new in v2)

- **Repeatable**, 0–3 occurrences per event.
- **Ordered** — tag order IS the priority order (first = primary, second =
  secondary, third = tertiary).
- **Each value** is one of 35 active slugs (restructured 2026-06):

```
acoustic:    ambient, blues, classical, experimental, folk, funk, hip-hop,
             jazz, latin, metal, pop, poetry, reggae, rnb, rock, soul, soundtrack
electronic:  acid, bass, breaks, dnb, downtempo, electro, electronic, footwork,
             house, jungle, techno
bridge:      dub, noise
tertiary:    boom-bap, lo-fi, spiritual, trance, trap
```

- **All 35 active slugs are pure peers.** The acoustic / electronic / bridge /
  tertiary grouping is palette + semantic grouping only; there's no hierarchy
  or gate. A release MAY be tagged `electronic` + `techno` + `dub` if that's
  how the meaning composes.
- **Deprecated** — four compound slash-pairs (`classical-folk`, `dnb-jungle`,
  `drone-noise`, `footwork-trap`) were retired in the 2026-06 restructure
  (split/collapsed into atomic slugs). They are **never emitted** on new
  events but remain **valid for reading** legacy / cross-relay events, where
  they still display with a slash. Mapping: `classical-folk`→`classical`+`folk`,
  `dnb-jungle`→`dnb`+`jungle`, `drone-noise`→`noise`, `footwork-trap`→`footwork`.

### Invariants (enforced at capture, validated on read)

1. **Distinct** — no duplicate slug across the slots of a single event.
2. **Slot cap = 3** — consumers ignore any 4th `genre` tag.
3. **Dense ordering** — present slugs occupy the lowest indices; sparse
   sequences should be compacted on receipt.

Validation policy is **strict-but-recoverable**: unknown slugs and
invariant violations silently drop the offending slot, keep the rest. No
parse failures, no exceptions.

### Shared palette (CSS vars)

Same triplet values on both ends:

```
acoustic (primary, muted/earthy)
  --c-g-ambient:       176 199 209   --c-g-poetry:        158 148 180
  --c-g-blues:          56  92 150   --c-g-reggae:         90 138  79
  --c-g-classical:     226 216 192   --c-g-rnb:           150  80 112
  --c-g-experimental:  106 168 168   --c-g-rock:          176  57  46
  --c-g-folk:          196 164 116   --c-g-soul:          198 100  84
  --c-g-funk:          232 178  55   --c-g-soundtrack:    100 137 184
  --c-g-hip-hop:       158 104  66   --c-g-latin:         232 132  52
  --c-g-jazz:          199 127  78   --c-g-metal:          92 100 110
  --c-g-pop:           255 165 201

electronic (secondary, vivid)
  --c-g-acid:          196 232  52   --c-g-electronic:    140 140 140
  --c-g-bass:          104  72 214   --c-g-footwork:      160  74 226
  --c-g-breaks:        232  64 110   --c-g-house:         196  74 206
  --c-g-dnb:            40 194 200   --c-g-jungle:         52 198 110
  --c-g-downtempo:     122  74 140   --c-g-techno:         58 124 244
  --c-g-electro:       240  62 176

bridge                               tertiary (optional)
  --c-g-dub:            22 138 104     --c-g-boom-bap:    176 132  92
  --c-g-noise:         234  80  46     --c-g-lo-fi:       158 130 128
                                       --c-g-spiritual:   178 118  56
                                       --c-g-trance:      120 100 245
                                       --c-g-trap:        128  84  96

deprecated (legacy reads only, render with slash)
  --c-g-classical-folk:232 220 195   --c-g-drone-noise:   159 110 145
  --c-g-dnb-jungle:    160  39 135   --c-g-footwork-trap: 255 133 200
```

### Slug display

Three active slugs — `hip-hop`, `boom-bap`, `lo-fi` — are **single** genre
names that happen to contain a hyphen. They are NOT pairs and render
**verbatim**.

The four **deprecated** compound pairs (`classical-folk`, `dnb-jungle`,
`drone-noise`, `footwork-trap`) are no longer emitted, but when met in legacy
/ cross-relay events they render with the slash form (`dnb/jungle`).

So a blind `slug.replace(/-/g, "/")` is wrong: it would mangle `hip-hop`
into `hip/hop`. The display helper slashes only the four retired pair slugs:

```js
const SLASH_DISPLAY = new Set([
  "classical-folk", "dnb-jungle", "drone-noise", "footwork-trap",
]);
const display = (s) => SLASH_DISPLAY.has(s) ? s.replace(/-/g, "/") : s;
```

A separate per-slug label override maps `rnb` → "R&B" (and, glmps-side only,
`soundtrack` → "film"). ndisc's copy lives in `src/lib/genre.ts`; glmps and
ndisc.view mirror the same sets.

### Kind 5 deletion (unchanged)

NIP-09 deletion shape from v1 is reused verbatim. See `release.v2.json`
for the exact fields.

### Filtering & aggregation

For any consumer code that reads emitted events:

- **Genre filter predicates** ("show all releases tagged X") match on
  **any slot** — primary, secondary, or tertiary all qualify.
- **Library-stat aggregations** ("share of the catalogue by genre")
  also use **any-slot counting** — a release with N distinct slugs
  contributes N tallies. Consistent with v2.1's pure-peer model: slot
  order on the wire is emission priority, but isn't privileged in
  aggregation or filtering.
- **Deletions** must be applied client-side regardless of relay
  behaviour — some relays (e.g. Primal) don't enforce kind:5 server-side.

Full chart-level detail (which field each chart reads, which palette,
scaling defaults) lives in `visualisations.md`.

## Source of truth & the contract tests

ndisc's code — `src-tauri/src/lib.rs`, `release_event()` — is what actually
emits the events. `release.v2.json` *describes* it; two contract tests pin
ndisc's output:

```
cargo test --manifest-path src-tauri/Cargo.toml schema_v1
cargo test --manifest-path src-tauri/Cargo.toml schema_v2
```

If either fails, ndisc's emitted format has drifted from the contract.
`mod schema_v1` is retained as historic regression coverage (v2 emission
must remain compatible with v1 readers — the "additive" guarantee).

## Change policy

`release.v2.json` is **frozen, additive-only**. Permitted in-place
amendments without forcing a v3 bump:

- **Additive slug additions** inside `genreSlugs` — new optional slug
  appended; existing slugs unchanged (e.g. v2.1.4 added `ambient` +
  `hip-hop` to mains and `bass` + `house` to electronic subs, 18 → 22
  slugs). No migration needed — existing releases are unaffected; the new
  slugs simply become selectable. glmps re-vendors and mirrors the new
  palette triplets.
- **Slug restructure** (2026-06): the `genreSlugs` set was regrouped into
  acoustic / electronic / bridge / tertiary and grown to **35 active** slugs,
  and the four compound slash-pairs were **retired** to a `deprecated` list
  (still valid for legacy reads). Additive-by-design — consumers gate only on
  the `d` tag, deprecated slugs still parse — so it re-pins the SHA without a
  v3 bump. Ndisc-side migration is `backfill_genre_restructure_2026_06`
  (remaps any local rows off the retired pairs, per the mapping above, and
  marks them unpublished so the stale kind:31237 events get re-emitted). The
  earlier v2.1.2 `classical → classical-folk` rename was removed from
  `backfill_genre_slug_renames` as part of this (it would otherwise re-split
  plain `classical` every launch).
- **Constraint relaxations** (e.g. v2.1 dropping `noParentWithOwnSub`) —
  strictly more permissive, all v2.0 emitters remain valid.
- **Palette triplet updates** (e.g. v2.1.3 `electronic` magenta → grey; the
  2026-06 recolour of the electronic family). Visual-only; the palette is
  documented in this README but not in `release.v2.json`, so no JSON edit,
  no SHA re-pin, no fixture refresh.
  Both ends mirror the new CSS-var value.

Anything else — adding/removing/renaming a non-slug tag, changing tag
semantics, reordering rules, breaking ordering — is a **coordinated v3
bump**: add `release.v3.json` (do not edit v2), migrate consumers.

Consumers vendor a copy of `release.v2.json`; this repo's copy is
canonical and wins on any discrepancy. SHA-256 should be pinned on the
consumer side so any drift is caught at build time.

## Sister-suite consumers

Other ndisc-suite apps (`ndisc.smpl`, `ndisc.blobtree`, `ndisc.view`,
…) may incorporate the design language documented here without
inheriting the whole stack. What's worth pulling:

- **Palette tokens** — the `--c-g-<slug>` CSS-var family for genres,
  plus the system tokens (`accent`, `mauve`, `auburn`, `digital`, `ok`,
  `warn`, `alert`, `muted`) are the foundation of the shared visual
  language across the suite. Both fizx and upleb themes resolve them.
- **Chart semantics** — `visualisations.md` is the contract for
  *which field drives a chart, which aggregation, which palette*.
  Pixel sizes and scaling constants are tuned per project (see the
  Tuning autonomy clause in that doc).
- **Slot semantics** — the any-slot filtering + aggregation rule
  (above) applies to any suite app that surfaces genre.
- **Compound-slug display** — slash only the known compound *pair*
  slugs (`classical/folk`, `dnb/jungle`, …); render single hyphenated
  names like `hip-hop` verbatim. See "Compound slug display" above for
  the set-based helper.

What NOT to vendor: the `release.v2.json` wire spec — only ndisc and
glmps need that. Sister apps that read user-facing displays from a
single source (the desktop app's SQLite, an export, or the published
relays) can lift palette + chart semantics without pinning the JSON
itself.

## Files

- `release.v2.json` — frozen-with-amendments canonical wire spec
- `release.v1.json` — frozen historic; v2 readers don't need it
- `labels.v1.json` — record-label image library wire spec (unfrozen
  until ndisc ships publishing)
- `visualisations.md` — chart semantics sidecar
- `fixtures/` — reference events:
  - `release-31237.full.json` — v1 maximal
  - `release-31237.minimal.json` — v1 minimal
  - `release-31237-v2.full.json` — v2 with all 3 genre slots
  - `release-31237-v2.partial.json` — v2 with primary slot only
  - `release-31237-v2.minimal.json` — v2 with no genre slots (byte-identical
    to v1 minimal — the additive-rule guarantee)
  - `deletion-5.json` — NIP-09 deletion

## Historical conversation artifacts

These files captured the negotiation between ndisc and glmps as v2 took
shape. They remain on disk for reference but are not authoritative:

- `v2-proposal.md` — original RFC (rev 2)
- `v2-proposal-glmps-reply.md` — glmps's ack + addenda 2 (flatten) and 3
  (rename)
- `glmps-catchup-2026-06-10.md` — distilled action list at the v2.1.1
  cutover
- `glmps-proposal-electronic-grey-2026-06-12.md` — proposal that became
  v2.1.3 (electronic magenta → grey)
- `glmps-genre-expansion-2026-06-14.md` — v2.1.4 heads-up: +4 slugs
  (`ambient`, `hip-hop`, `bass`, `house`) and the `hip-hop` display fix

The current state captured above supersedes all of them. If they conflict
with this README or with `release.v2.json`, this README + the JSON win.
