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

## End-state summary (as of v2.1.3, 2026-06-12)

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
- **Each value** is one of 18 valid slugs:

```
mains:           classical-folk, downtempo, electronic, experimental, funk,
                 jazz, pop, reggae, rock, soundtrack
electronic subs: acid, breaks, dnb-jungle, drone-noise, dub, electro,
                 footwork-trap, techno
```

- **All 18 slugs are pure peers.** The mains/subs split is a palette
  grouping only; there's no semantic gate. A release MAY be tagged
  `electronic` + `techno` + `dub` if that's how the meaning composes.

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
mains
  --c-g-classical-folk:232 220 195   --c-g-jazz:        199 127  78
  --c-g-downtempo:     122  74 140   --c-g-pop:         255 165 201
  --c-g-electronic:    140 140 140   --c-g-reggae:       90 138  79
  --c-g-experimental:  106 168 168   --c-g-rock:        176  57  46
  --c-g-funk:          232 178  55   --c-g-soundtrack:  100 137 184

electronic subs (magenta hue family — cohesive among themselves; no parent hue link)
  --c-g-acid:          255  66 200   --c-g-electro:       255 111 184
  --c-g-breaks:        230  77 168   --c-g-footwork-trap: 255 133 200
  --c-g-dnb-jungle:    160  39 135   --c-g-techno:        214  58 153
  --c-g-drone-noise:   159 110 145
  --c-g-dub:           199  93 163
```

### Compound slug display

Five slugs are compound (`classical-folk` in mains; `dnb-jungle`,
`drone-noise`, `footwork-trap` in subs). Stored hyphenated on the wire;
rendered in human-facing UI with the slash form via
`slug.replace(/-/g, "/")`. The helper is idempotent for non-compound slugs.

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
  appended; existing slugs unchanged.
- **Single-slug renames** within the v2.1.x series (e.g. v2.1.1
  `dub-techno` → `dub`; v2.1.2 `classical` → `classical-folk`). Ndisc-side
  migration is a one-shot `UPDATE` in `backfill_genre_slug_renames`;
  glmps re-vendors. Affected releases need re-publishing for the wire data
  to refresh.
- **Constraint relaxations** (e.g. v2.1 dropping `noParentWithOwnSub`) —
  strictly more permissive, all v2.0 emitters remain valid.
- **Palette triplet updates** (e.g. v2.1.3 `electronic` magenta → grey).
  Visual-only; the palette is documented in this README but not in
  `release.v2.json`, so no JSON edit, no SHA re-pin, no fixture refresh.
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
- **Compound-slug display** — `slug.replace(/-/g, "/")` is the
  one-liner used everywhere (`classical/folk`, `dnb/jungle`, etc.).

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

The current state captured above supersedes all of them. If they conflict
with this README or with `release.v2.json`, this README + the JSON win.
