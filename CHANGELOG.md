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
