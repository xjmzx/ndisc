# Genre round 2026-11b — working notes (SETTLED 2026-11-07: 74 active, built into release.v2)

Recorded 2026-11-06 so the discussion can be picked up later. Parked the same
day: the current set causes no problem, so there's no hurry. One principle
was agreed: **no cross-genre (compound) slugs** — a merge keeps one existing
single genre and retires the other.

## Outcome (built 2026-11-08, ndisc commit `1e12f2e`)

The round shipped as `release.v2` @ `1c3169bb`: **74 active genres** (41 + 33)
in three groups, `electronicDance` / `otherGenres` / `combining`, with a
`slugNotes` block for the ambiguous slugs. The result is in the CHANGELOG and
[`README.md`](README.md); everything below is the discussion that led to it.

- **Nothing was retired.** jungle, trap, boom-bap and conscious all stay
  active; the folds discussed below did not happen, so no release changed.
- **folk / world / country:** all three are kept (`country` was added).
- **electronic first:** done. On 2026-11-16 no release carries `electronic`
  anywhere but first (1,734 have it first).
- **Consumers:** nview (v0.1.0-beta.10) and the glmps forks re-vendored
  `1c3169bb` on 2026-11-08. glmps.nfunc.xyz and glmps.upleb.uk were serving the
  new genres on 2026-11-16.

The sections below are the working notes as they stood before the build, kept
for the reasoning. Their "outstanding" and "open" items are settled above.

## Goal

Keep the active genre set at about **42**. There are **41 active** slugs today
(after the 2026-11 round added minimal, abstract and world), plus six
deprecated slugs kept for reading legacy events.

## Agreed 2026-11-06: electronic first, groups renamed

- **Ordering rule:** when `electronic` is present it is the first genre; every
  other order is the user's choice. `electronic` stands for the
  electronic/dance family, so other slugs read as their own genre or secondary
  to it. The earlier "tertiary last" idea is dropped. **Built in ndisc 0.6.5**
  (editor + save path), as an emitter convention; release.v2 still allows any
  order.
- **Outstanding:** 64 releases carry `electronic` but not first (first genres
  today: downtempo 20, experimental 8, techno 5, dub 4, others ≤3). Reorder and
  republish them after 0.6.5 ships.
- **Group renames (genre round, contract change):** `electronic` group →
  **electronic/dance**; `acoustic` group → **other genres** (it holds hip-hop,
  pop, disco… — never meant "acoustic"). Group names aren't on the wire, but
  glmps and nview read the groups for colour families, so it's a SHA bump and
  re-vendor.
- Per-release tagging, the user's call: e.g. DJ Shadow *Endtroducing*, Kid
  Koala — add `electronic` if wanted; it lands first automatically.

## Update 2026-11-07: the 42 cap was about space, and space is gone

Since 0.6.5 the Genre card has the Music page to itself (two-column list), so
there's no layout reason to hold at 42. The contract has no limit on the
number of active slugs either; only a release's five slots are capped. So the
round can add without folding: **41 + 5 = 46**. The folds (jungle→dnb,
trap→footwork, boom-bap/conscious→hip-hop) become optional, decided on
meaning alone.

## Candidates to add

| Slug | Notes |
|---|---|
| `choral` | Pairs with classical / spoken. |
| `musique-concrete` | Overlaps experimental, abstract, noise; a distinct historical form. |
| `punk` | Beside rock (66 releases with rock as primary). |
| `psychedelic` | Cuts across rock and folk; could sit with the tertiary (cross-cutting) slugs. Spelling: `psychedelic`. |
| `country` | Fifth, and probably one too many. Overlaps folk and world (see below). |

## Candidates to retire (to make room)

- **`boom-bap`** and **`conscious`** — both are naturally hip-hop. Re-tag the
  releases that use them, then retire the slugs to `deprecated` (still valid
  for reading). Note: `conscious` was itself a rename of `spiritual` in the
  2026-06b round, which also covered spiritual jazz, not only hip-hop. Check
  that before retiring it.
- **`footwork` + `trap` → one slug?** Raised 2026-11-06. History: the v2
  set began with a compound `footwork-trap`, which the 2026-06 restructure
  retired to `deprecated` and collapsed to `footwork`; `trap` came back as a
  tertiary slug. Merging again would reverse that split. Today footwork has 9
  releases (4 primary), trap 0. Options: keep `footwork` and retire `trap`
  (simplest, nothing to re-tag); or a new merged slug, which can't reuse
  `footwork-trap` because that deprecated slug displays with a slash and is
  only kept for reading legacy events. Pick a name, decide, then re-tag.
- **`dnb` + `jungle` → one slug?** Raised 2026-11-06. Same history as
  footwork/trap: the v2 set began with a compound `dnb-jungle`, split into
  `dnb` + `jungle` in 2026-06 and kept as deprecated. Overlap is near total:
  dnb 72, jungle 39, **37 of the 39 jungle releases already carry dnb** (2 are
  jungle-only, 1 with jungle as primary). Simplest: keep `dnb`, retire
  `jungle`, add dnb to the 2 jungle-only releases, drop jungle from the rest
  and republish them (39 events).
- **Not** garage or minimal (and trap only if the footwork merge above goes
  ahead). They have 0 tagged releases today, but the
  library does hold music of those genres that just hasn't been tagged yet.
- **No other retirements.** Many low counts are low only because most releases
  use one or two of the five genre slots. They would grow with fuller tagging.

## Open question: folk / world / country

These three overlap heavily. Today `world` is used only alongside `folk` or
`latin` (4 releases), and `folk` is often a second genre on classical releases
from outside the Western canon (Indian classical, Khachaturian and others).
Possible directions, undecided: keep all three; add country and lean on folk
for the rest; or treat world as the umbrella tag.

## Tagging depth (context for the counts)

Of 2,012 published releases: **82 have no genre at all**, and **531 have only
a primary**. So the counts below understate most genres that usually appear
as a second or later choice.

## Current use, 2026-11-06

Total = releases carrying the slug in any of the five slots; primary = in
slot 1. All 2,012 releases are published.

| Slug | Group | Total | Primary |
|---|---|---:|---:|
| electronic | electronic | 1134 | 1070 |
| experimental | acoustic | 799 | 269 |
| downtempo | electronic | 439 | 84 |
| techno | electronic | 378 | 61 |
| breaks | electronic | 235 | 26 |
| electro | electronic | 225 | 81 |
| dub | bridge | 147 | 71 |
| jazz | acoustic | 100 | 23 |
| rock | acoustic | 100 | 66 |
| dnb | electronic | 72 | 22 |
| acid | electronic | 65 | 21 |
| reggae | acoustic | 61 | 9 |
| funk | acoustic | 60 | 6 |
| ambient | acoustic | 59 | 21 |
| pop | acoustic | 43 | 12 |
| classical | acoustic | 39 | 28 |
| jungle | electronic | 39 | 1 |
| house | electronic | 35 | 8 |
| folk | acoustic | 29 | 5 |
| bass | electronic | 25 | 10 |
| hip-hop | acoustic | 22 | 12 |
| noise | bridge | 22 | 0 |
| soundtrack | acoustic | 19 | 8 |
| blues | acoustic | 10 | 4 |
| footwork | electronic | 9 | 4 |
| trance | tertiary | 8 | 0 |
| abstract | tertiary | 6 | 0 |
| metal | acoustic | 6 | 1 |
| soul | acoustic | 6 | 2 |
| spoken | acoustic | 5 | 1 |
| turntablism | tertiary | 4 | 2 |
| world | tertiary | 4 | 0 |
| lo-fi | tertiary | 3 | 1 |
| boom-bap | tertiary | 2 | 0 |
| conscious | tertiary | 1 | 0 |
| disco | acoustic | 1 | 0 |
| latin | acoustic | 1 | 1 |
| rnb | acoustic | 1 | 0 |
| garage | electronic | 0 | 0 |
| minimal | electronic | 0 | 0 |
| trap | tertiary | 0 | 0 |

Releases behind the smallest counts:

- boom-bap: #676 Eric B. & Rakim — *Paid in Full* (hip-hop, boom-bap, conscious); #859 Herbert — *100 Lbs* (experimental, boom-bap)
- conscious: #676 (above)
- world: #3036 Ghymes — *Rege*; #3064 Greg Hunter & Pops Mohamed — *Lotus Blossom*; #3103 Jaubi — *Nafs at Peace*; #4514 Buena Vista Social Club (latin, world)
- disco: #2734 Linton Kwesi Johnson — *LKJ In Dub* · latin: #4514 · rnb: #2729 *1925 Songs* (Tompkins Square)

## Republishing (checked 2026-11-06)

Re-tagging and republishing is safe. 31237 is addressable, so a republish
replaces the earlier event on the same `d`-tag; relay.nfunc.xyz is the only
relay holding the catalogue. Points to watch:

- **Order matters.** Ship glmps and nview with the re-vendored contract
  *before*, or in the same wave as, the republish. A consumer still on the old
  contract treats a new slug as unknown: no chip, no colour. It doesn't break
  (per `genreInvariants`), but the genre disappears there until it updates.
- **Each new slug needs a hue** in the genre palette (ndisc, glmps, nview),
  otherwise it falls back to neutral.
- **Retired slugs stay readable.** Old copies of events elsewhere still
  display. Nothing breaks if a retired slug is missed in a re-tag; the rule is
  just not to emit it again.
- **Batch size.** A merge only republishes the releases it touches: jungle 39,
  boom-bap 2, conscious 1, trap 0. Retagging for the new genres (punk etc.) is
  the larger, gradual part.
- **Don't revive the old compound slugs** (`dnb-jungle`, `footwork-trap`).
  They're deprecated, display with a slash, and the contract says they're
  never emitted on new events.

## If this goes ahead

It's an additive amendment under `changePolicy`: add the new slugs, move the
retired ones to `deprecated`, re-pin `release.v2.json.sha256`, re-vendor into
glmps and nview in the same release, and update the genre palette. If the
active list grows past what fits, switch the Library Stats Genre card to
`denseRows`.
