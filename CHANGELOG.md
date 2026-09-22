# Changelog

**Contract:** `release.v2` @ `91e16cf1da861ad3116d7d15ad13d7ae32fbdf26c367e2701236cb10cfc38962`
(2026-06b genre round — 38 active slugs + additive `discs` tag)

**Feed contract:** `feed.v1` @ `077fe7a6f70831ccf7c9640185c29e0b9c289ea22a1e4283064a1803ed1ea50c`
(kind:31239 feed-note channel — frozen 2026-06-23, pinned by `mod schema_feed_v1`)

**Clip contract:** `clip.v1` @ `9650699f8d133c2e32250dc436eb7f6deb03dddc5e2204b5402e5a76d3a2469e`
(kind:1063 clip/sample provenance — **provisionally pinned, not yet frozen**;
guarded by `mod schema_clip_v1`. Flips frozen when ntree + nsmpl emit the tag set.)

ndisc now sits on two frozen contracts — `release.v2` (the discography wire) and
`feed.v1` (the feed-note channel) — each on its own SHA, each moved as its own
coordinated wave. A third, `clip.v1` (the clip/sample provenance wire), is
**provisionally SHA-pinned** at the authority but not yet frozen — ndisc guards
the canonical file though `ntree` / `nsmpl` are its emitters.

ndisc uses two version axes — this app's semver (below) and the shared
`release.vN` contract (above). A contract change moves the whole suite in one
wave; an app-only change bumps ndisc alone. See
[`schema/README.md`](schema/README.md) → "Versioning & release cycle".

## 0.3.0 — 2026-09-22

**Versioning changed with this release.** ndisc leaves the `-beta.N` train and
joins `ntree` and `gtrack` on plain semver: **feature → minor, fix → patch**,
with `-beta.N` reserved for genuinely staging a release candidate. `0.x` already
means unstable, so a second instability axis was not earning its keep — and a
counter that only ever increments says nothing about whether a version brought
a feature or a bug fix. `0.2.0` was never tagged past `beta.7`, so nothing in
the tag history needed rewriting.

This entry consolidates the 2026-09-22 session, previously spread across
`0.2.0-beta.8` … `0.2.0-beta.15`. Those entries remain below as the working
record.

### Added

- **Content audit** (*Maintenance → Audit published content*) — compares every
  published release's live event, tag by tag, against what the catalogue would
  emit. The only check that reads the served event's *content*; derives its
  expectation from `release_wire_form`, the same function `release_event`
  signs, so it cannot drift from the emitter.
- **Drift review** — a library scan reports disagreements with the file tags
  instead of applying them. Per-field *yours* vs *on disk*, with **use file**
  or **keep mine**; dismissal is keyed on the file's current value so a later
  genuine retag resurfaces.
- **Queue for republish** from the audit — the route from *found* to *fixed*.
- **Repair pressing strings** — targeted Discogs re-enrich for physical
  releases carrying a codec, without a `force` pass over the whole library.
- **Progress feedback** for the audit and the repair. The audit reports over
  two phases in one scale — a relay fetch pages through a whole library, so it
  gets its own step and label rather than leaving the bar frozen. The repair
  listens to the `enrich:*` events, which were already emitted and had nobody
  listening.

### Fixed

- A library scan overwrote curated `title` / `artist` / `year` from file tags,
  and exempted itself from the staleness invariant — so published releases
  diverged from their live events undetectably. Found via the relays.
- A **video-only release was never refreshed** since import, freezing an
  emitted tag.
- A codec overwrote a **pressing** on physical releases (109 of 126 affected);
  71 recovered from the signed events, 38 re-enriched from Discogs.
- **Enrich left a publish half-state** — markers cleared, `publish_state` not.
- Format drift flooded the scan report (10 → 318) by reporting a permanent,
  intended difference.

### Docs

`schema/title-styling-2026-09-22.md` (naming conventions, with the decidable
collision rule), `schema/identity-normalisation-design-2026-09-22.md`,
`docs/file-data-handling-2026-09-22.md` (who writes tags across the suite;
cross-platform unknowns), `docs/open-issues-2026-09-22.md` (what each check is
blind to). README and introduction corrected where they described the old
behaviour.

## 0.2.0-beta.15 — 2026-09-22

### Added — queue audit findings for republish

The content audit was read-only, and a finding with no route to a fix is half a
feature. **Drift review → queue all N for republish** marks the drifted
releases unpublished so the next Publish pass re-emits them. Nothing is signed
or sent by the button itself; it applies `mark_unpublished` semantics (all
three markers) and re-checks each id against the DB rather than trusting the
dialog.

This closes the loop the first real audit exposed. Of 80 drifted releases,
**76 had a current event that simply predated an additive contract tag** —
`discs` was added in the 2026-06 round, and `disc_total` had come from a
Discogs enrich long before. Nothing local ever changed, so nothing ever marked
them stale, and no amount of publishing the stale queue would reach them: they
would have stayed divergent indefinitely. The remaining groups were 29 formats
in the same position and 21 releases no relay is serving.

Republishing the stale queue is therefore *not* sufficient on its own — an
additive contract change leaves every already-published release behind, and
only the audit can see it.

## 0.2.0-beta.14 — 2026-09-22

### Fixed — enrich left releases in a publish half-state

`apply_enrichment` cleared `last_published_at` and `last_published_naddr` when
an emitted field changed, but **not `publish_state`**. `mark_unpublished` sets
all three, and the app reads both markers: `BatchEditView` keys off
`lastPublishedNaddr`, while `MergeConfirm` and the content audit key off
`publish_state`. A release could therefore read `published` with no naddr and
be treated as published or unpublished depending on which screen you were on.

Surfaced by the pressing repair: all 38 repaired releases landed in exactly
that state — `format` changed, markers cleared, `publish_state` still
`published`. Enrich now moves `publish_state` to `stale` with the markers.

The 38 already in the half-state were corrected in place; a catalogue-wide
check now shows 0 rows published-with-no-naddr.

## 0.2.0-beta.13 — 2026-09-22

### Fixed — the pressing repair silently did nothing

beta.12's *Repair pressing strings* reported `checked 38 · repaired 38` and
changed **not one row**. Enrich only replaces a stored `format` when it is
empty or is a recognisable abbreviation of the Discogs string; anything else is
treated as "hand-curated, structurally different — leave it be". A codec is
structurally different from a pressing, so the guard that protects curated
formats was protecting the damage.

A codec on a **physical** release is now recognised as replaceable: it is the
rip's codec written over the pressing by a pre-beta.11 scan, not a curated
value. Digital releases are untouched by the clause.

### Fixed — format drift flooded the scan report

beta.11 reported a kept pressing string as `format` drift. A physical release's
folder always holds a rip, so its codec always differs from the pressing —
**forever**. That pushed a library scan's drift count from 10 to **318**, and a
count that can never reach zero stops carrying information, which is the whole
reason title drift has dismissals. The pressing is now kept silently.

### Corrected — an overstated warning about bulk enrich

beta.12's notes said a `force` enrich would revert local label styling to
Discogs' spelling. **It would not.** `category`, `label`, `catalog_number` and
`country` are fill-empty-only: `fill()` never clobbers a value already present.
Only `format` has a replacing rule, and only under the conditions above.
`title`, `artist` and `year` are never touched. Corrected in
`docs/file-data-handling-2026-09-22.md`.

## 0.2.0-beta.12 — 2026-09-22

### Added — targeted re-enrich

*Maintenance → Repair pressing strings.* Finds the physical, Discogs-linked
releases whose `format` holds a codec rather than a pressing — the casualties
of the pre-beta.11 clobber — and re-fetches only those.

`enrich_discogs_library` gains an optional `ids` list, so a specific set can be
repaired without a `force` pass over every linked release. That matters:
enrich rewrites `format`, `category`, **`label`**, `catalog_number`, `country`
and the track/disc counts, so a blanket force would revert local label styling
to Discogs' spelling (`Planet μ` back to `Planet Mu`). It does not touch
`title`, `artist` or `year`.

38 releases qualify here — those whose pressing was lost locally *and* on the
wire, so the relay could not supply it.

### Docs

- `README.md` — **Refresh from disk** rewritten: it described the old
  behaviour, where a batch scan wrote tag values into the DB. It now states
  the two modes, what a batch scan refuses to overwrite, and which writes mark
  a published release stale. Adds **Content audit** and **Naming conventions**.
- `ndisc-introduction.md` — corrects the Bandcamp claim. Bandcamp contributes
  **purchase provenance, not metadata**: `bandcamp_id` is a receipt and the CSV
  import records a store URL. Discogs is the only enrichment source.
- `docs/file-data-handling-2026-09-22.md` — new survey: which suite apps read
  and write tags (two write, not one — **nplay's per-track editor is a second
  mutation path and is governed by no styling rule, and no check sees a track
  title**), per-app normalisation, enrichment coverage, and an explicit list of
  cross-platform behaviours that are *unverified* with a test for each.

## 0.2.0-beta.11 — 2026-09-22

### Fixed — a codec could overwrite a pressing

Found by the content audit on its first run, which is the point of it.

`format` holds two different kinds of fact. For a **digital** release it is the
codec of the files, and tracking disk is right — replacing an MP3 rip with a
FLAC one should update it. For a **physical** release it is the *pressing*
(`12", Ltd, Whi`, `2xLP, Album, Gat`, `7", Single, W/Lbl`), which is catalogue
data about the object, usually Discogs-enriched. A codec describes the rip in
the folder, not the record on the shelf.

beta.9 guarded `title`/`artist`/`year` and classified `format` as disk-derived,
disk-always-wins. That was wrong for the physical half of the catalogue. The
audit found **109 of 126 physical releases** carrying a codec where a pressing
string used to be — the same silent clobber as beta.8, one field over, and
invisible to every check that existed before the audit.

- A codec no longer overwrites a format that is not a codec. Narrow rule, no
  new state, and digital releases still track their files.
- On a batch scan the disagreement is reported as `format` drift instead of
  being applied, like `title`/`artist`/`year`.
- `looks_like_codec` is pinned by tests over the real pressing strings the
  audit recovered, including `Cass, Mixed` and `VHS, PAL`, and rejects a codec
  name embedded in a longer word (`Flacon`). 125 tests.

**71 pressing strings were recovered** from the signed relay events. The other
38 were clobbered before their last publish, so the pressing is gone locally
*and* on the wire; those need re-enriching from Discogs.

### Changed — years reconciled to original release

Eleven releases disagreed with their published event on `year`, in both
directions — a reissue date overwriting an original (`Head Hunters` local 1999,
relay 1973) and the reverse (`Twoism` local 1996, relay 2013). Resolved to the
earlier of the two as a proxy for the original release: 7 took the relay value,
4 kept local. The proxy is not the same as the true original year, and two
(`Stop The Panic`, `Ischemic Folks`) are flagged in case the earlier value is
simply a bad tag.

## 0.2.0-beta.10 — 2026-09-22

### Added — published content audit

**Maintenance → Audit published content.** Fetches every published release
from the configured relays and compares the served event, tag by tag, against
what the catalogue would emit today. Read-only: nothing signed, sent, or
written.

This closes the gap that let beta.8's bug hide for six days. `publish_state` is
a *flag*, set by whoever last touched the row. The relay audit checks existence
and timestamps (`stale` is literally `event.created_at >= last_published_at`).
**Neither reads the served event's content.** So a code path that changed an
emitted field without calling `mark_unpublished` left a release reading
`published`, with an event newer than its last publish, and content silently
wrong — and every existing check passed, correctly, the whole time. They were
answering "is it there, and recent enough?", never "does it still say the same
thing?".

- The audit derives the expected wire form from **`release_wire_form`**, split
  out of `release_event` so the emitter and the audit share one definition. An
  audit that built its own idea of the tags could drift from the emitter and
  report phantom differences, or miss real ones.
- Reports per release which tags differ, with the served value beside the one
  we would emit. Repeatable tags keep their order (`genre` slot order is
  emission priority, so a reordering is a real difference). The `d` tag is
  excluded — it is the coordinate, equal by construction.
- Also reports releases the DB believes are published that no relay serves.
- `mod content_audit` pins the comparison, including the homoglyph case
  (U+00B5 vs U+03BC render identically and must still be reported). 122 tests.

Found on first run against the live catalogue: **275 published releases whose
titles no longer matched**, restored from the signed events.

### Changed — title styling applied catalogue-wide

Recorded in `schema/title-styling-2026-09-22.md` and applied: format and
edition suffixes dropped (22 titles), `E.P.` normalised to `EP` (6), needed
markers re-formed as parentheses (`Moog Acid (EP)`, `Skeng (Autechre Dub)`,
`Split 2`), the last Discogs disambiguator dropped (`Fah (2)`), split releases
joined with a spaced solidus (`Kyuss / Wool — Split`), and one genuine data
error corrected (`The Worlds Is A Ghetto` → `The World Is a Ghetto`). Titles
and file tags were moved together every time, so a rescan cannot revert them.

The collision rule — a suffix stays exactly when the stripped title already
exists for that artist — is derived from the catalogue rather than an
allowlist. Run blind over 2,040 releases it rediscovered both known cases.

## 0.2.0-beta.9 — 2026-09-22

### Fixed — a video-only release was never refreshed

`refresh_release_inner` gave up on any folder with no audio, returning
**before** the video count, the cover lookup and every other disk-derived
field. A video-only release — a legitimate shape here: a VHS rip, a mix video
— was therefore skipped by every library scan since import, and its
`video_count` stayed frozen at whatever the initial import set.

That matters because `video` is an **emitted tag**. A published video release
could drift from its live `kind:31237` event with nothing able to detect it —
the same silent-divergence shape as the title bug in beta.8, reached by a
different route. Found while identifying the two releases a scan reports as
`no audio`: *Various Artists — (Motion)* (Warp, *Artificial Intelligence:
Motion*, one 200 MB `.mp4`) is video-only and had been inert since import.

- A refresh now bails only when the folder holds **neither audio nor video**.
  With video present it proceeds; reading tags from an empty file list yields
  an all-`None` `DirInfo`, and absent tags are not drift.
- `track_total` is no longer derived from disk when there is **no audio**.
  There is no `TRACKTOTAL` tag to read, and the fallback to the present count
  would write `0` over a real catalogue total. (Both affected releases here
  are Discogs-linked, so the existing Discogs guard already covered them —
  this closes the unlinked case.)
- Both guards are pure functions (`refresh_has_nothing`, `resolve_track_total`)
  pinned by tests and mutation-verified, as in beta.8. Suite: 115.

The other `no audio` release, *VLR — CPU Mix*, is a cassette whose folder holds
only artwork. Correctly reported; nothing to fix.

## 0.2.0-beta.8 — 2026-09-22

### Fixed — a library scan could silently overwrite curated metadata

A **library scan / reconcile took the file tags as truth for `title`, `artist`
and `year`**, with none of the guards the other curated fields already had
(`notes`, `source` and `label` are all fill-empty-only on a batch pass, and
`track_total` defers to Discogs). A curated title therefore reverted to the
retail string from the file on the next scan.

Worse, it reverted **silently**. `mark_unpublished` is documented as being
called by "every setter that mutates data carried in the kind:31237 event", but
the refresh path exempted itself and fired only on a `video` change. So a
published release could have its title rewritten, keep reading `published`,
and diverge from the live event with nothing in the UI to show for it.

Observed on the maintainer's library: ten titles reverted, all ten confirmed
diverged from the events served by `relay.fizx.uk`, `nos.lol` and
`relay.primal.net`. Restored from the pre-scan values, which the signed relay
events independently corroborated — no republish was needed.

- A **batch scan no longer writes `title` / `artist` / `year`**. It compares,
  keeps your value, and reports the disagreement as **drift**.
- A **per-release Refresh still trusts the file** — that is an explicit,
  user-initiated action. The internal flag is renamed `overwrite_label` →
  `trust_files` to say what it actually governs.
- A year the DB simply lacks is still backfilled from the tag; that is a gap
  fill, not an overwrite.
- **Publish staleness now honours its own invariant**: the refresh path marks a
  published release stale when it changes *any* emitted tag (`artist`, `title`,
  `year`, `format`, `label`, `tracks`), not just `video`.

- The guard is **pinned by tests**. The compare-and-decide step is extracted
  into pure functions (`resolve_curated_str`, `resolve_curated_year`,
  `refresh_marks_stale`) so it can be tested without an `AppHandle`, and
  `mod refresh_guard` covers both halves: a scan keeps the curated value and
  reports the disagreement, and every emitted tag marks a published release
  stale. Verified by mutation — reintroducing either bug fails the suite.

### Added — drift review

- The scan / reconcile banner gains a **`drift N`** chip when files disagree
  with your curated fields. Nothing was changed; the chip is a prompt, not a
  report of work done.
- Clicking it opens **Drift review**: per release, each field side by side as
  *yours (kept)* vs *on disk*, with two outcomes —
  - **use file** — runs the ordinary per-release Refresh, so it is a
    whole-release "trust the file" action (other disk-derived fields move too,
    and a published release drops to stale);
  - **keep mine** — remembered against *that file value*, so a later genuine
    retag surfaces again instead of being permanently suppressed.
- **Rescan library folder** now shows its `no audio` count. It always had the
  number — the underlying scan reports it and the reconcile summary carries it
  — but the banner dropped it, so two releases with unreadable folders were
  visible under **Scan library for changes** and invisible under **Rescan
  library folder**. Same omission as the drift chip, same fix.
- The `drift N` chip counts what is **still unreviewed**, not the raw
  disk-vs-DB total. Dismissals are frontend-only (as `ndisc.dupDismissed` is),
  so the backend count cannot know about them; the chip and the dialog now
  read the same filtered list. Without this the chip could never reach zero
  and would stop carrying information.
- Scan buckets now partition: `refreshed + drifted + no_changes + orphaned +
  no_audio + no_path == scanned`. A drifted release is no longer also counted
  as unchanged.

### Design notes

- `schema/identity-normalisation-design-2026-09-22.md` — **proposed, not
  implemented.** A two-tier string-identity model (NFC at ingest; a mild NFKC +
  dash-fold + casefold match key for grouping, dedupe and search) sitting below
  the pinned master key. Written after a lookalike artist name — `µ-Ziq`
  (U+00B5 micro sign) vs `μ‐Ziq` (U+03BC Greek mu) — split one artist into two
  in both ndisc and nplay, and ndisc's own duplicate finder missed the pair.
  The note's governing rule is the one this release implements: ndisc does not
  write tags to the user's files, and does not silently replace a curated
  value. Nothing in it ships here.

## 0.2.0-beta.7 — 2026-09-02

### macOS builds

- The release workflow now builds a **macOS arm64 `.dmg`** alongside the Linux
  `.deb`/`.AppImage` and the Windows NSIS installer. The macOS job runs after the Linux one and only
  appends its asset, so the Linux job stays the single owner of the release
  name and notes.
- Unsigned and un-notarised, like the rest of the suite. Gatekeeper blocks the
  first launch until the app is opened from the context menu, or cleared with
  `xattr -dr com.apple.quarantine /Applications/ndisc.app`.
- **This dmg is untested.** It is known to build; it is not known to run. No
  macOS build of this app has been launched.

### Fixed

- `workflow_dispatch` checked out the default branch while publishing to the
  tag it was handed, so a manual run uploaded main-built artifacts to an older
  tag's release. Checkout now pins `ref` to the tag being released. Tag pushes
  were never affected.

## 0.2.0-beta.6 — 2026-07-27

### In-app file-tag editor — first on-disk tag write
- A new **edit tags** action on the release detail panel writes metadata back to
  the release's audio files (Album / Artist / Year / Label / Disc # / Disc total)
  via lofty — already the read dependency, so no new crate. Two-phase: a dry-run
  **preview** lists the exact per-file deltas, then the write applies them. Only
  the targeted tag keys are touched, so a rip's other tags (e.g. its `DISCOGS_*`
  block) are preserved. This is ndisc's first path that mutates audio files on
  disk. Commands `preview_release_tags` / `write_release_tags`; UI
  `WriteTagsDialog`. The tags are the portable, cross-app truth every player reads.

### Multi-disc folder collapse — one release across its disc subfolders
- A release whose folder is a multi-disc parent (`…/Album/CD1`, `…/Album/CD2`) is
  now treated as **one release** spanning both discs. Import groups disc-sibling
  folders under the parent; refresh, track/video recount, tag-write and cover
  lookup all span the disc subfolders; `DISCNUMBER` on tag-write is derived
  per-disc-folder (CD1 → 1, CD2 → 2); import fills a folder-derived `disc_total`
  for non-Discogs multi-disc rips. Flat single-folder releases are unaffected.
- New helpers `is_disc_dir_name` (vendored, kept in step with nsmpl/nplay/ntree),
  `disc_subdirs`, `release_dir`, `gather_release_audio`, `find_cover_deep`.
- **No wire change** — the publisher is untouched: a release's `d`-tag stays
  `disco-vault:{id}` and the `tracks` / `discs` tags read the (now-correct)
  columns; `release.v2` SHA unchanged. Guarded by a new `mod disc_collapse` test.
- Migration: an existing multi-disc row is collapsed by re-pointing its folder to
  the **parent** and refreshing (it recounts across discs); duplicate per-disc
  rows are removed/merged and future scans dedup on the parent path.

### Suite top-bar grammar + version chip
- Adopted the shared top-bar grammar (reference impl) and refined it: the header
  grid moves from `1fr_auto_1fr` to `auto_minmax(0,1fr)_auto` so the
  content-heavy controls zone always shows in full and the centre stats module is
  the track that yields (clipping its least-important trailing stats) instead of
  overflowing. The **version chip** now shows only `major.minor.patch`, with any
  `-beta.N` / `+build` suffix in the tooltip (`shortVersion`), keeping a fixed
  chip width across releases.

### Also
- Figma icon refresh (2026-07-25, two passes); monochrome brand lockup; the video
  marker muted to the suite muted-mauve convention; Library grammar + the nview
  platform-icon pipeline recorded in `SUITE.md`.

## 0.2.0-beta.5 — 2026-07-21

### Pin `clip.v1` at the authority + a drift-guard conformance test
- `clip.v1` (the kind:1063 clip/sample provenance wire, emitted by `ntree` +
  `nsmpl`) is now **SHA-pinned** in `schema/clip.v1.json.sha256` and guarded by a
  new `mod schema_clip_v1` test — a parse check plus a freeze check that fails the
  build if the schema bytes drift from the pin. ndisc is the schema **authority**
  for `clip.v1` though it doesn't emit it, so this is the honest analogue of the
  emission tests that pin `release.v2` / `feed.v1`.
- Kept **`frozen: false`** deliberately (mirroring `labels.v1`): a *provisional*
  pin that gives `ntree` / `nsmpl` a stable target to build against, not a freeze.
  It flips `frozen: true` once both producers emit the tag set and add their own
  emission tests — a clean forward promotion. Until then a schema edit is allowed
  but must re-cut the pin in the same commit.

### Monochrome dots in the mono theme, colour reserved for a source
- The suite's green dots were "green everywhere". Now the neutral source /
  pairing / track / disc dots share one token (`--c-medium`) that is **grey in
  the mono theme** (the default) and green in the colour themes — so mono is
  monochrome by default and colour is reserved for a **named acquisition
  source**, whose hex shows through in every theme. `--c-ok` stays green
  throughout: it means lossless/ok, which is information, not decoration.
- Applied across the list (leaf-dots, disc circles, pairing fill) and the detail
  panel (disc tile). Present dots + disc badges render at **full opacity** (only
  missing-track slots stay faint) for contrast against the near-black bg.
- **Inner-dot / ring model:** a neutral release's inner medium dot is white
  (`--c-fg`) over a `--c-medium` ring ("bright inner, darker ring"); a named
  source colours its inner dot with a theme-independent hex and its ring with
  that hex at 0.5 alpha. The model is documented in SUITE.md as the suite
  reference.

### Source-colour palette curated
- Replaced the ad-hoc platform list with a small curated roster. Because the dot
  **shape** already encodes physical-vs-digital (Disc3 vs Circle), colour is
  free to identify the **store**, not the bucket. Digital stores: Bandcamp
  `#1da0c3`, Boomkat `#e0913a`, Bleep `#e05a9c`, Warp `#8b6be8`, Planet Mu
  `#a8c94a`. Physical marketplace: Discogs `#5e5c64` — near-neutral, manual-only
  (a `discogs.com` link is a pairing signal via `discogsId`, not a source to
  auto-tint).
- Two forced-neutral defaults via `NEUTRAL_SOURCE_NAMES`: **Record Store** (the
  physical default) and **Unknown** (the digital / unavailable default), so a
  stale assigned colour can never override the default dot. Seed metadata keys by
  lowercased label so multi-word names ("Planet Mu") resolve, and `domain` is
  now optional (a source can be colour-only, no URL inference).
- Reset the stale per-name colour overrides in localStorage — a green Boomkat
  override was beating its amber seed — so the curated seeds plus neutral-forcing
  now govern every source name in the library. Kept byte-identical for the JS
  consumers (nview / glmps).

### Label art scales to the column
- The label viewer sat at a fixed 140px square that floated in a 200–285px
  column with lots of horizontal air, and stayed 140px even when collapsing Add
  Release freed vertical room. It is now **width-driven** with a cap that
  responds to the column — 200px compact, 248px when the detail card is collapsed
  and the column has spare height — so it fills the room without pushing the
  3-panel row taller than its neighbours. Image, brand carousel card, and the
  placeholder share the one responsive box, so they scale together and stay
  square; `object-cover` and the accent-lighten overlay are unchanged.

### Fix a stale orphan count in the header
- `orphaned` is the one header stat that is a cached snapshot (`lastOrphaned` in
  config), not a live `COUNT(*)` — because recomputing it means stat-ing every
  release folder, a per-render filesystem cost we deliberately avoid. But the
  per-orphan fix actions (`Locate…` / `delete` in the orphan list) only
  decremented the transient scan strip, never the snapshot — so resolving an
  orphan that way left the header count stuck until a full rescan.
- Those actions now call `decrement_orphaned` (a clamped-at-0 single-int config
  write, no disk walk), so the header tracks reality immediately. A full
  reconcile still rewrites the authoritative value.

### Header stats reclaim their horizontal space
- The eight header stats were eight separate pills, each paying a doubled
  padding boundary plus a gap — that is where the width was going, crowding the
  title on one side and the import button on the other. They are now **one
  segmented bar** with 2px grooves between segments, and **icons instead of
  word-labels** (full name on hover), which is the bulk of the reclaim.
- Each value reserves a fixed `ch` width, right-aligned with `tabular-nums`, so a
  count growing (9 → 9,999, or climbing during a scan) never reflows the bar.
- **Orphaned** goes red (not just amber) once it hits double digits — a single
  comparison, no percentage tier (a ratio is more than a stable personal library
  warrants).

### Pairing is now a per-release choice
- **Per-release `pairedOverride`** (new nullable column): null = auto (the old
  source/Discogs inference), true = forced paired, false = forced solo. A
  `+physical` / `+digital` checkbox on the detail panel sets it. Local-only —
  never published, never clears publish state.
- **Dropped the source-wide `physical` flag from pairing inference.** It was too
  coarse for a dual-nature store: flagging *Bandcamp* physical (for the handful
  bought on vinyl) silently painted **every** Bandcamp release as physically
  paired, because inference also consulted the platform guessed from the URL /
  receipt. A physical counterpart is now evidence-based (`discogsId`) or a
  deliberate per-release override. The stale localStorage flag becomes inert.
- **Source metadata edits now refresh the list live.** `setSourceMeta` writes
  localStorage, which React can't observe, so a colour / digital edit updated
  only the panel that made it while the release-list rings lagged until some
  unrelated render — which read as the view being unstable. A small external
  store (`subscribeSourceMeta` + `useSourceMetaVersion`) re-renders every derived
  view together.

### Duplicate resolution — remove the losing copy
- **"remove a copy"** in duplicate review, beside merge: compares both folders
  (path, file count, total size, format summary) and trashes the one you pick.
  Warns when **tracks exist only in the copy being removed** (loosely
  name-matched, so differing filename styles still line up), and retracts a live
  `kind:31237` first — aborting if no relay accepts, rather than stranding an
  `naddr`. Files go to the desktop Trash; ndisc cannot undo it.
- Guards are refusals, not warnings: inside the library root, an existing
  directory, never the survivor's own folder, `trash::delete` only.
- **`merged_paths` — merges and removals now survive a rescan.** Previously the
  loser's row was deleted while its folder stayed on disk unowned, so the next
  library scan re-imported it and the duplicate came back. Both `merge_releases`
  (files untouched) and the new removal record the path; import skips it.
- **Advisory notes when linking a folder** — outside the library root, no audio
  inside, already claimed, or the home directory. Warn-only: nothing is refused,
  because unusual layouts are legitimate. Prompted by a row that had ended up
  pointing at `$HOME`, which would have had "sync cover to disk" write a
  `cover.jpg` there.

### Delete offers a choice about the files
- Delete now opens a dialog with **two options** rather than a yes/no that could
  only mean one of them: **"Remove from library"** (drops the row, files
  untouched — still undoable, and it now *says* that a rescan will re-import the
  folder) and **"Remove and move files to Trash"** (drops the row and trashes
  the folder).
- The trash option is **gated, with the reason shown**: a **published** release
  must be Unpublished first (a refusal, not an automatic retraction — silently
  un-publishing as a side effect of a delete is too surprising for an
  irreversible action), and a release with no folder has nothing to trash.
- **No undo on the trash path**, deliberately: restoring the row would leave it
  pointing at files now sitting in the Trash, and a half-working Undo is worse
  than none. A warn line reports what moved instead.
- The trash guards are now factored into `guard_library_dir()` and shared with
  duplicate resolution — inside the library root, a real directory,
  `trash::delete` only. Security-critical checks should exist once.

### Suite catalogue export
- **`catalogue.json`**, written beside `published.json` by the same export
  action: the whole catalogue keyed by release folder, with `label` + `catalog`.
  A deliberate sibling — `published.json` means "what ndisc has published" and
  ntree scopes its released filter to it, so it must never gain unpublished
  rows. Consumed by nplay for its label filter.

## 0.2.0-beta.4 — 2026-07-15

Closes a small layout pass (with beta.2–beta.3): trimming rarely-used editable
fields from the add-release form and the release-detail card so the sections
beneath them — NOSTR / LABELS / LABEL, the publish toolbar — get a better view.
None of it touches the schema; every trimmed field stays editable in the
bulk-edit view.

- **Release detail genre editor caps at TWO slots.** The third genre slot is no
  longer surfaced here. The schema is **unchanged (0–3 ordered)** and the third
  genre stays in the data and editable in the bulk-edit view; `slots` still
  carries all three so option-filtering excludes an existing tertiary, and the
  cascade only clears a third genre when it becomes genuinely invalid — no silent
  data loss.

## 0.2.0-beta.3 — 2026-07-15

- **`condition` removed from the release detail card** — same treatment as
  `notes` in beta.2: gone as an editable field there, **unchanged in the schema
  and still editable in the bulk-edit view**. The genre/type/country row and the
  sections below reflow up.
- **Add-release form: Save tucked up beside `cover url`** as an icon-only disk
  button (no label, slightly smaller). The form loses its dedicated Save row, so
  NOSTR / LABELS / LABEL move up.

## 0.2.0-beta.2 — 2026-07-15

- **`notes` removed from the release detail card and the add-release form.** It
  was rarely useful there and cost a row on each; the sections below (publish
  toolbar, NOSTR / LABELS / LABEL) move up into the freed space. `notes` is
  **unchanged in the schema and still fully editable in the bulk-edit table**
  (the "comment" column) — this is a UI trim, not a data change, so existing
  notes are untouched and new releases just start empty.
- **App icon refreshed** from the 2026-07-15 Figma export (the suite's mauve
  vinyl-ring look).

## 0.2.0-beta.1 — 2026-07-14

### Monochrome theme — and it is now the default

- **New `mono` theme**, and the title now cycles **fizx → upleb → mono**.
- **Chrome goes greyscale; MEANING keeps its colour.** Each `.theme-mono` block
  declares *only* the greyscale tokens — anything it does not redeclare keeps its
  `:root` value, so `ok` / `warn` / `alert` / `nostr` / `medium` (and ndisc's
  genre + year palettes) stay coloured with no work. **The block is a list of
  what does not mean anything.** That is the whole design.
- The brand tokens (`accent` / `mauve` / `digital` / `auburn`) were each doing two
  jobs. Hue was never their only carrier — hierarchy also lives in indent, fill,
  icons and labels — so it moves onto **luminance**: `mauve` (upper tier) sits
  brighter than `digital` (lower tier), the order the hues implied.
- **Monochrome is the DEFAULT.** No stored choice, an unrecognised one, or no
  localStorage at all → `mono`. An existing choice is respected; only a fresh
  install lands there.
- **Fixes a theme flash on every launch.** The theme class was applied in a
  `useEffect`, which runs *after* the first paint — so each launch showed the
  old default before the real theme landed, and on a fresh install that flash
  *was* the user's first impression. It is now set pre-render by an inline script
  in `index.html`, with a `catch` that falls back to mono if storage throws.

## 0.1.4-beta.8 — unreleased

### Suite-shared published-release manifest
- **New maintenance action: "Export published manifest".** Writes
  `~/.local/share/ndisc-suite/published.json` — the releases ndisc has published
  to Nostr (kind:31237), keyed by their folder on disk.
- **Why an exported document rather than a shared database.** ntree needs to know
  what has been released so it can scope a mass sample to the published
  discography, but it has no business reading ndisc's SQLite — that would couple
  a filesystem-only app to this schema and this file location. ndisc exports what
  it knows; the consumer reads it. Derived and disposable: if it is absent or
  stale, the consumer simply cannot offer the filter, and nothing else breaks.
- Keyed by **release folder**, because that is what a filesystem-only consumer
  can actually match against. The summary reports both how many releases were
  exported and how many are published but have **no folder on disk** — those
  cannot be scoped by path, so they are counted rather than silently dropped.
- First consumer: ntree's `released` filter (1,609 releases here), which scoped
  the 12,407-track sample of the published discography.

## 0.1.4-beta.7 — unreleased

Three fixes to "Reconcile relays", all found by the audit disagreeing with
reality on a live library. No contract change.

### Fixed
- **A healthy relay could be reported as serving nothing.** The per-relay fetch
  used `client.connect()`, which returns immediately and brings the socket up in
  the background — so the first REQ could fire before the relay was reachable and
  come back empty. An empty page is indistinguishable from "this relay is empty":
  nos.lol, holding 1,732 events, was reported as `serving 0` with every release
  `absent`. Now uses `try_connect_relay` with a timeout, so **an unreachable relay
  is an error, never an empty result** — which for an audit is the whole point.
- **Phantom staleness from clock comparison.** "Current" was decided by comparing
  the relay event's `created_at` against `last_published_at` with a 5s tolerance.
  But the event is signed, `send_event` then waits on the relays, and only
  afterwards is the DB stamped — so a slow relay opens a multi-second gap and the
  release reads as stale. Any fixed tolerance is a guess about relay latency.
  Now matched on **identity**: if the relay serves the exact
  `last_published_event_id` we last published, it is current. Timestamps are only
  a fallback (300s window) for rows predating that column.
- **One lagging relay flagged the whole library.** A release was counted as
  needing re-publish if *any* relay held an outdated copy. But readers union their
  relays and keep the newest event per coordinate (NIP-01 replaceable), so a stale
  copy on one relay is harmless while another serves the current one. With an
  intentionally sparse relay in the set (primal holds 34 of 1,732) this offered to
  re-publish almost everything — a redundancy choice, not a repair. The re-publish
  set now means **no relay holds the current event**. Per-relay `stale` / `absent`
  remain as honest per-relay reporting.

Net effect on a real library: a reported 25 releases "unserved" resolved to 1
genuinely stale release. Relays and DB now agree exactly (1,732 each).

## 0.1.4-beta.6 — unreleased

Legibility pass over the publish indicators and the header/footer, plus two
read-only backend commands that let the panels say something useful when the
detail card is collapsed. No contract change.

### Fixed
- **Published and Stale were the same colour on the upleb theme.** The publish
  dot rode on `--c-mauve`, which is the theme's *brand* tint — and upleb repaints
  it orange (`255 179 71`), landing on top of `--c-warn` amber (`251 191 36`). No
  relabelling could separate them. Publish state now has its own **`--c-nostr`**
  token (purple, deliberately identical across both themes, like `--c-medium`),
  used by the state dot, the state filter, the batch-edit dot, the feed-note
  published badge, and the relay-audit `ok` count. `mauve` goes back to being
  only the brand tint. Four states now read cleanly on both themes: never grey ·
  published nostr-purple · stale amber · retracted red.
- **Header text clipped when maximised.** The version chip and the library stats
  competed for one squeezed row against a toolbar that never yields, so
  `v0.1.4-beta.…` clipped mid-string and `scanned N ago` truncated. Version and
  scan age both move to the footer — neither is something you act on.

### Changed
- Header stats are one family: the tracks/video/incomplete counts move onto the
  same `StatChip` as Total/Physical/Digital/Artists. `orphaned` keeps an amber
  value (new `tone` prop) — it means something is wrong and shouldn't read as a
  neutral count.
- Footer follows one colour rule instead of four competing tones: prose and
  labels `muted`, every machine value (version, npub, db path, scan age)
  `font-mono text-mauve`.
- Nostr panel: the publish controls are now a titled region closed off by rules
  top and bottom. The rows above edit local config; these buttons broadcast to
  the network and are not fully reversible — a boundary that load-bearing should
  be stated, not implied by whitespace. Publish/Unpublish take the same
  `font-semibold` weight as Add Release's Save. Unpublish drops its red outline
  for a heavier mauve fill (`bg-mauve/35`) with black type that shifts to mauve
  on hover — the fill is static, so the destructive action doesn't flash a solid
  block under the cursor. Red is now reserved for where it means something:
  retracted state, unreachable relays, and the purge.

### Added — "roomy" mode
When the detail card is collapsed the right-hand column has spare height. It is
now spent on information rather than stretched whitespace. Strictly additive in
that mode: with the detail card open, nothing shifts by a pixel.
- **Relay liveness.** New `check_relays` probes every relay concurrently and each
  row grows a dot (stacked above its ✕) plus a `connected · 142ms` readout, with
  an `n/n connected` rollup beside the Relays heading. The probe issues a real
  REQ, not a bare socket open — a relay can accept the websocket and never
  answer, and the dot is asserting that it will serve us. Re-probes every 60s,
  and only while the dots are on screen.
- **Label at-a-glance.** New `get_label_overview` backs a read-only strip under
  the label image: releases · published · tracks · year span, following whatever
  is on screen (including the idle carousel). Derived entirely from existing
  rows — it adds no publishing surface and cannot touch the labels.v1 manifest.
  Hidden while the add/edit form is open.

## 0.1.4-beta.5 — unreleased

Publish state grows from a single timestamp into a real lifecycle, and gains the
tooling to see — and repair — what the relays are *actually* serving. No contract
change: `release.v2` is untouched, and every new column is local-only.

### Publish lifecycle (four states)
- **`publish_state`: `never` | `published` | `stale` | `retracted`.** A new
  column, maintained at every transition, replacing the overloaded
  "`last_published_at IS NULL`" test — which could not tell never-published from
  retracted from edited-since-publishing. Filter control in the toolbar (state
  dropdown) and a four-colour dot per row. Rows predating the column backfill to
  `published` when they carry a publish marker; retraction history cannot be
  reconstructed retroactively.
- **Bulk unpublish**, mirroring bulk publish. State-aware: `never` and already
  `retracted` rows have nothing live to retract, so they are skipped and
  reported rather than spraying pointless kind:5 events.
- **Bulk ops are driven by an explicit id set, not a filter.** `publish_library`
  / `unpublish_library` are gone; `publish_ids` / `unpublish_ids` take exactly
  the ids the release list is showing. The count, the confirm-dialog
  description, and the operation are now the same set by construction. The old
  design re-derived the filter server-side from an object that knew about five
  of the seven active filters, so a view narrowed by an unknown filter looked
  "unfiltered" to the backend and the op silently addressed the whole library.
- **Web-image-link filter** — has / hasn't a published `cover_art_url`, distinct
  from having a local `cover.jpg`.

### Relay reconciliation
- **`e`-tag deletions.** A release retraction now carries both the `a`
  coordinate and an `e` tag naming the live event id (new
  `last_published_event_id` column, populated on publish and backfilled by
  "Reconcile published state"). `a`-only deletions are a **no-op on
  nostr-rs-relay** (which relay.fizx.uk runs) — it honours NIP-09 by event id
  only. Every unpublish ever sent to fizx was stored and never applied; it had
  accumulated 2,528 inert kind:5 events while still serving 770 retracted
  releases.
- **"Reconcile relays"** (Library maintenance). Read-only audit: asks each relay
  what it serves under our key and diffs it against the DB, per relay — `ok`,
  **ghosts** (served but not published locally), **orphans** (served, no local
  release — a DB rebuild shifted the ids, so nothing local can ever drive their
  deletion), `absent`, `stale`. Then purges the strays, recovering each event id
  from the relay itself. Anything still `published` or `stale` is re-checked
  against the DB and skipped, whatever the UI passes in.

### Fixed
- **`reconcile_published` treated any-ever-deleted as permanently deleted.** It
  collected kind:5 `a` tags into a bare id set, ignoring timestamps — but the
  coordinate is reused on every republish. After one bulk unpublish/republish
  cycle every id carried a deletion, so the whole library looked dead and the
  reconcile would have skipped all of it. A deletion now only kills events
  created at or before it (strict NIP-09).
- **Relay pagination dropped events sharing a `created_at`.** Stepping back
  through history with `until = oldest - 1` skips every event in that second
  that didn't fit on the page — and a bulk publish stamps hundreds of events per
  second. It hid 2 ghosts and made 3 published releases look unserved by any
  relay. Now steps to `oldest` inclusive and dedupes by id.
- `cargo check --tests` had not been run since `publish_state` landed; two test
  fixtures no longer compiled.

## 0.1.4-beta.1 — unreleased

### Contract (feed.v1 — frozen, coordinated with ndisc.view + glmps×2)
- **`feed.v1` frozen.** The feed-note channel wire contract
  (`schema/feed.v1.json`) is flipped `frozen: true` and SHA-pinned
  `077fe7a6…`. It pins: kind:31239 feed notes (`d=glmps:<id>`, optional `a`
  release reference, repeatable `image` / `r` / `t`, `alt` fallback; body in
  content), the NIP-51 contributor registry (kind:30000, `d=glmps:contributors`),
  the NIP-72 per-note sign-off (kind:4550), and the client-side trust gate +
  NIP-09 kind:5 deletes. Authority roots on the single owner key.
- **Emitter** shipped in Phase 4 (`feed_event` / `publish_feed_note` /
  `unpublish_feed_note`); output pinned by the `mod schema_feed_v1` contract
  test. The macOS/Linux desktop client is pinned by that test — it does not
  vendor the JSON.
- **Consumers** (ndisc.view + glmps×2) vendor this SHA and add kind:31239 to
  their subscriptions in the same wave — see the consumer-wave checklist.

### Contract (release.v2 — coordinated with ndisc.view + glmps×2)
- Genre **2026-06b round — now 38 active slugs.** Two 1:1 renames done the
  additive way (new slug active, old retired to `deprecated`, backfill remaps
  local rows): **`poetry` → `spoken`** and **`spiritual` → `conscious`** (both
  widen their catch: spoken-word, conscious hip-hop and beyond). Three new
  slugs: **`disco`** + **`spoken`** (acoustic), **`garage`** (electronic),
  **`conscious`** + **`turntablism`** (tertiary). Additive, no v3 bump; SHA
  re-pinned `179fd563…` → `91e16cf1…`. `backfill_genre_renames_2026_06b` clears
  publish-state on affected rows so the new slug re-emits; emitter +
  `schema_v2` tests updated. Glmps-side hue/CSS-var assignment for the new
  slugs lands in the same wave (build device).
- Genre vocabulary **restructured to 35 active slugs** in four groups
  (acoustic / electronic / bridge / tertiary); the four compound slash-pairs
  (`classical-folk`, `dnb-jungle`, `drone-noise`, `footwork-trap`) retired to
  a `deprecated` list — never emitted, still valid for legacy reads. Additive,
  no v3 bump; SHA re-pinned `bd76512c…` → `99a9b269…`. Emitter + `schema_v2`
  tests updated.
- `backfill_genre_restructure_2026_06` remaps local rows off the retired pairs
  (per the README mapping) and marks them unpublished, so the now-stale
  kind:31237 events can be re-emitted via Publish Library → unpublished.
- Additive **`discs` tag** — total disc count (Discogs-enrichment-derived),
  integer-as-string, emitted only when `> 0`. Optional/backward-compatible, no
  v3 bump. SHA re-pinned `99a9b269…` → `179fd563…`. Emitter + `schema_v2`
  tests added; coordinated with ndisc.view + glmps×2 (consumer read side ready,
  vendoring this SHA).

### App
- **`current` view** — a third top-level view (Radio toolbar toggle) for the
  feed-note channel: compose / publish / unpublish notes that point at a release
  (drafts persist locally), an owner curation panel (contributor registry +
  per-note Approve / Revoke), and a live-on-relays section reading the channel
  back through the shared trust gate. _Fix:_ the topics field and the image/link
  line-lists swallowed the separator while typing (a trailing comma/newline was
  stripped before the next entry) — they now hold the raw text and parse on
  change, so multi-value entry works.
- **Discogs enrichment** — physical (Discogs-imported) releases now get
  track + disc counts from the Discogs API (the CSV export carries neither),
  fetched by the stored `discogs_id`. New keychain-backed Discogs token, a
  Sparkles toolbar action + transient panel (throttled batch with progress),
  and a new local `disc_total` column. `track_total` flows through the
  existing `tracks` tag — so enriched physical releases publish counts and
  render leaf-dots like digital; physical meters read all-solid (you own the
  item, so present = total). `disc_total` now publishes via the additive
  `discs` tag (see Contract above). Re-enriching an already-published release
  whose total changes clears its publish state so the new tags re-emit.
- RELEASES list: alphabetical **index rail** — ruler ticks (longer at each
  letter change) + jump-to-letter chevrons, a dark-digital pill highlighting
  the first artist of each letter, and a merged mauve **state chip** (publish
  dot + medium disc icon, solid = physical / outline = digital).
- Genre picker: **flat alphabetical** dropdown (no family optgroups).

### Docs
- Audio-visual media-type **incubation note**
  (`schema/video-incubation-2026-06.md`).

## 0.1.3 and earlier

See git history / GitHub releases.
