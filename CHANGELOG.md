# Changelog

**Contract:** `release.v2` @ `91e16cf1da861ad3116d7d15ad13d7ae32fbdf26c367e2701236cb10cfc38962`
(2026-06b genre round — 38 active slugs + additive `discs` tag)

**Feed contract:** `feed.v1` @ `077fe7a6f70831ccf7c9640185c29e0b9c289ea22a1e4283064a1803ed1ea50c`
(kind:31239 feed-note channel — frozen 2026-06-23, pinned by `mod schema_feed_v1`)

ndisc now sits on two frozen contracts — `release.v2` (the discography wire) and
`feed.v1` (the feed-note channel) — each on its own SHA, each moved as its own
coordinated wave.

ndisc uses two version axes — this app's semver (below) and the shared
`release.vN` contract (above). A contract change moves the whole suite in one
wave; an app-only change bumps ndisc alone. See
[`schema/README.md`](schema/README.md) → "Versioning & release cycle".

## 0.2.0-beta.5 — unreleased

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
