# Changelog

**Contract:** `release.v2` @ `99a9b2696395e2593d6fae6f8176481b2aa774bad4eb2cb57fb3f76740f5a7bd`
(2026-06 genre restructure)

ndisc uses two version axes — this app's semver (below) and the shared
`release.vN` contract (above). A contract change moves the whole suite in one
wave; an app-only change bumps ndisc alone. See
[`schema/README.md`](schema/README.md) → "Versioning & release cycle".

## 0.1.4-beta.1 — unreleased

### Contract (release.v2 — coordinated with ndisc.view + glmps×2)
- Genre vocabulary **restructured to 35 active slugs** in four groups
  (acoustic / electronic / bridge / tertiary); the four compound slash-pairs
  (`classical-folk`, `dnb-jungle`, `drone-noise`, `footwork-trap`) retired to
  a `deprecated` list — never emitted, still valid for legacy reads. Additive,
  no v3 bump; SHA re-pinned `bd76512c…` → `99a9b269…`. Emitter + `schema_v2`
  tests updated.
- `backfill_genre_restructure_2026_06` remaps local rows off the retired pairs
  (per the README mapping) and marks them unpublished, so the now-stale
  kind:31237 events can be re-emitted via Publish Library → unpublished.

### App
- **Discogs enrichment** — physical (Discogs-imported) releases now get
  track + disc counts from the Discogs API (the CSV export carries neither),
  fetched by the stored `discogs_id`. New keychain-backed Discogs token, a
  Sparkles toolbar action + transient panel (throttled batch with progress),
  and a new local `disc_total` column. `track_total` flows through the
  existing `tracks` tag — so enriched physical releases publish counts and
  render leaf-dots like digital; physical meters read all-solid (you own the
  item, so present = total). `disc_total` is **DB-local** for now (a published
  `discs` tag would be an additive contract wave — deferred). Re-enriching an
  already-published release whose total changes clears its publish state so
  the new `tracks` tag re-emits.
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
