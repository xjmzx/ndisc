# Multi-source coherence — release provenance model (design note)

> **Status: PROPOSAL / design note — NOT canonical.** This sketches a
> release-provenance model for ndisc: a release as an identity attested by a
> **set of sources** rather than a row with one origin. Nothing here is frozen
> or implemented. It is **local-only** (no change to the published
> `release.v2` contract). It stacks on top of, and subsumes the deferred
> "editions-link" idea from, `terrain-roots-design-2026-06-16.md`. Do not cite
> as spec.

Date: 2026-06-21

---

## Why this exists

Today a release row conflates three different concerns into single columns:

- `discogs_id` / `source` — *where the metadata came from*
- `file_path` — *where my copy lives* (and only **one** copy)
- `medium` — *physical or digital*, as a mutually-exclusive enum

That conflation causes concrete problems:

1. **One copy only.** `file_path` is singular, so a release you own as a
   **FLAC rip** *and* a **Bandcamp MP3 download** can only record one of them.
2. **The physical/digital split.** ndisc models a physical edition and a
   digital edition as **two separate rows** (`medium='physical'` carries no
   `file_path`). That breaks the file→release climb bridge documented in the
   terrain note — e.g. Coldcut & Hexstatic "Timber" (id 2559, physical,
   published, no path): the 14 files on disk match no ndisc `file_path` and get
   mislabelled "not in discography" despite being catalogued and published.
3. **No coherence map.** There's nowhere to say "I have this losslessly, I
   bought it on Bandcamp, it's catalogued on Discogs, and I published it
   here" — the user's stated goal of *library coherence with reference to
   sources*.

The fix is to separate the **abstract release** (artist + title + year — the
thing) from a **set of sources** that each attest to or instantiate it.
Coverage stops being "is this one field filled?" and becomes a function over
the set.

---

## Decisions made (user, 2026-06-21)

Captured via an interactive options flow. These are the customised choices, not
defaults:

1. **Source kinds:** `discogs · local · bandcamp · url · nostr`.
   - **No MusicBrainz** (explicitly declined).
   - **No standalone "physical object" kind.** Discogs *is* the physical-form
     reference (and the "or other" catch-all); a separate object kind is
     redundant.
   - **Nostr folds in as an existing source** — `last_published_naddr` already
     records "where I published it."
   - **URL** is a generic/label-link catch-all (label site, shop page, etc.).

2. **Ownership is implied, never tagged.** *"It's my discography. I own it all.
   That's the point."* There is **no `owned` flag** and no "own+physical"
   framing. Everything catalogued is owned by definition. What remains useful is
   **form** (physical vs digital), because that determines whether there are
   files to count.

3. **`medium` becomes a derived set, not a stored enum.** A collapsed release is
   `physical`, `digital`, or `both`, read off its sources:
   - a physical-format Discogs ref → has a physical aspect;
   - local files (or a Bandcamp / Discogs "File" source) → has a digital aspect.
   A "digital-only on Discogs" release simply resolves to `digital`. Nothing to
   hand-maintain.

4. **Editions collapse into one release.** Physical edition + digital files =
   one identity carrying both as sources. Fixes the Timber bridge bug and lets
   glmps / ndisc.view show a single release instead of two kind:31237 editions.

5. **Local copies — multiple, quality-tagged.** N `local` sources per release,
   each tagged `flac | mp3 | 320`. **Completeness = have-at-all**, with a
   **lossless lens** toggle that re-reads the leaf-dots against lossless-only on
   demand. Deleting one copy degrades gracefully (have-it-but-lossy), never to
   zero.

6. **Field precedence (reconciliation):** fixed order
   **hand-edit > Discogs > Bandcamp > URL/inferred.** The same
   fill-empty-don't-clobber posture the enrichment path already uses, generalised
   to N sources.

7. **Coverage chip-strip** on each release — list **and** detail — beside the
   existing completeness leaf-dots: `discogs↗ · flac✓ · bandcamp↗ · nostr◆`.

8. **Local-only.** Sources are a private coherence map. The published
   `release.v2` event stays lean and unchanged — **no contract change, no glmps
   coordination.** Publishing still selects an authoritative subset, as today.

---

## The model

A `sources` child table, one-to-many from `releases`:

```
source(
  id           INTEGER PRIMARY KEY,
  release_id   INTEGER  -> releases.id,
  kind         TEXT     -- discogs | local | bandcamp | url | nostr
  ref          TEXT     -- discogs id · (root,relpath) · URL · naddr
  quality      TEXT     -- flac | mp3 | 320   (local only; NULL otherwise)
  attrs_json   TEXT     -- kind-specific extras (purchase_date, note, …)
  added_at     INTEGER
)
```

**Migration is lossless and additive** — the existing columns lift in as the
first rows:

| Existing column        | Becomes a source of kind | ref                      |
|------------------------|--------------------------|--------------------------|
| `discogs_id` / `source`| `discogs`                | the release id / URL     |
| `file_path`            | `local`                  | `(root, relpath)`        |
| `last_published_naddr` | `nostr`                  | the naddr                |

The legacy columns can stay as a denormalised cache of the "primary" source for
back-compat during transition, or be dropped once readers move to the table.

**Derived reads (views over the set, never clobbering):**

- **`medium`** = `{physical?, digital?}` from the source kinds/formats present.
- **present-count** = tracks found across `local` sources (union for
  have-at-all; filtered to lossless for the lens).
- **total** = the `catalog` source's tracklist (Discogs), as today.
- **object-only** (all-solid dots, "can't be missing") = a release with a
  physical-form source but **no** `local` source.
- **field value** = first non-empty by the precedence order above.

### Relationship to terrain-roots

Two stacked layers, not rivals:

- **terrain-roots** = *file-identity* layer: `(root, relpath)` instead of
  absolute paths, plus the intra-audio derivation graph. A `local` source's
  `ref` is literally a `(root, relpath)`, so this model **consumes**
  terrain-roots and inherits its portability fix.
- **sources** = *release-provenance* layer on top: what external references and
  possessions a release identity has.

This model is the **proper form of the "editions-link"** the terrain note
deferred (its §"escalation" path): one release carrying both a physical and a
digital aspect, rather than a fuzzy name-match between two rows. If/when the
physical/digital bridge is tackled seriously, this is the same work.

---

## UX sketch

- The **"attach folder"** control already shipped in the release detail
  generalises to **"add source"** with a kind picker (local folder · Discogs id
  · Bandcamp URL · link). The current `discogs_id` + `file_path` editors become
  special-cased instances of it.
- **Coverage chip-strip** per release: small typed chips for at-a-glance
  coverage, e.g. `discogs↗ · flac✓ · bandcamp↗ · nostr◆`. Uses the suite leaf /
  state grammar (green = present/have, mauve reserved for Nostr state per the
  design-language rules).
- **Completeness tooltip** gains the provenance sentence: *"10/12 present (FLAC
  rip); catalogued by Discogs; also: Bandcamp MP3; published naddr1…"* — this is
  the "coherence with reference to sources" made literal.
- A **lossless-lens** toggle re-reads the leaf-dots against lossless-only.

---

## Scope / build shape (NOT committed)

This is a meaty change, deliberately parked:

1. `sources` table + additive migration (lift the existing columns in).
2. Reconciliation read layer (derived `medium`, present-count, field
   precedence) — read-only views first, leaving writes on the legacy columns
   until the readers move.
3. The editions **collapse** (merge a physical row and its digital sibling into
   one identity + source set) — the riskiest step; do it behind an explicit
   "these are the same release" action before any automatic merge.
4. UI: add-source control, chip-strip, lossless lens.

Strictly local; the published contract is untouched throughout. Nothing is built
or migrated until explicitly requested.

---

## Worked example / test case — Boards of Canada "Hi Scores"

The canonical both-forms release to build/verify against (surfaced 2026-06-23):

- DB row **id 314**, `Boards of Canada — Hi Scores`, `medium=digital`,
  `discogs_id=1249369`, with a local digital copy. The user *also* owns the
  **CD** and has added it to their Discogs collection CSV.
- **Target after sources model:** ONE identity carrying a `discogs` source (the
  CD → physical aspect) + a `local` source (the files → digital aspect) ⇒
  derived `medium = both`. No second row, no hand-set enum.
- **Today's failure modes it exercises:** re-importing the CSV either *skips*
  (CD edition id == 1249369 → dedupe-on-discogs_id no-op, stays `digital`) or
  *inserts a duplicate physical row* (CD is a different edition id) — neither
  yields "both." This is a concrete instance of the duplication noted in
  [[ndisc-bandcamp-enrich]].
- **Casing gotcha for the collapse heuristic:** the digital rows are spelled
  `Boards of Canada` while Discogs-CSV physical rows are `Boards Of Canada`
  (capital O). Naive name-match would miss the pair → reinforces the
  "explicit same-release link, never auto-merge" decision (§Open questions).

## Open questions

- **Collapse trigger:** fully automatic (name/format heuristic) vs. an explicit
  per-pair "same release" link. Leaning explicit-first (lower risk; mirrors the
  terrain note's "treat name-match as suspect, never authoritative" posture).
- **Quality detection:** infer `flac|mp3|320` from the files on attach, or have
  the user tag it. Probably infer-then-confirm.
- **Chip-strip density** in the scroll list — needs to coexist with the
  leaf-dots + disc badge + state chip without crowding the row.
- **Legacy column retirement:** keep `file_path`/`discogs_id` as a primary-source
  cache indefinitely, or migrate readers fully and drop them.
