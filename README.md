<img src="docs/ndisc-lockup.svg" alt="ndisc" width="300">

Local music discography library — track and evaluate a collection of
**physical and digital** music releases, with Nostr-backed sharing.

**Stack:** Tauri 2 desktop binary + React 19 + TypeScript + Tailwind v3
+ SQLite (via `rusqlite`, bundled), with `lofty` for audio tag reading
and embedded-artwork extraction, `nostr-sdk` for relay publishing,
`keyring` for OS-keychain storage of the secret key, and `reqwest` for
HTTP cover-image fetches.

Catalog data lives at `~/.local/share/uk.upleb.ndisc/discography.db`
(Linux) by default. The DB path is configurable per install via the
multi-database switcher in the header.

## Features

### Library import

- **Folder import** for digital releases. Walks a music root; treats
  each directory containing audio files as one release. Reads
  artist / album / year / format / track count from tags via `lofty`
  with `ParsingMode::Relaxed` so malformed timestamps don't bail the
  whole scan. Picks up `cover.jpg` / `folder.jpg` / `front.jpg` and
  several broader patterns as the local cover image. All inserts run
  in a single SQLite transaction; emits progress events. Idempotent on
  re-import (skip by `file_path`).
- **Discogs CSV import** for physical releases. Maps the standard
  Discogs collection export onto the schema (artist / title / format /
  label / catalog / country / condition / released year / release id);
  auto-detects digital (`*File*` formats) vs physical; auto-infers
  `category` from the Format string (`Album` → `album`, `EP` → `ep`,
  …); synthesises `source` as `https://www.discogs.com/release/<id>`.
  Idempotent on `discogs_id` so re-exporting and re-importing is safe.
- **Multi-DB switching** in the app header: refresh / open existing /
  create new. The chosen path persists at `<app_data>/config.json`.

### Cover art handling

- **Display** prefers `cover_art_url` (any HTTPS host — typically
  nostr.build or a Blossom server), falls back to a local file at
  `cover_art_path` served via Tauri's asset protocol.
- **Inline URL editor** on each release detail panel (pencil icon over
  the thumbnail). When the no-cover filter is on, rows expand into a
  single-tap paste-and-save workflow with focus auto-advance — useful
  for working through a backlog without leaving the list view.
- **Embedded artwork extraction** (wand icon): reads embedded pictures
  from audio files via `lofty`, writes them as
  `cover-extracted.{jpg,png,webp,…}` into the album directory and
  points `cover_art_path` at them. Single click runs across every
  no-cover release with progress events.
- **Broader filename rescan** (folder-search icon): walks album
  directories looking for cover-like filenames (`cover.*`,
  `folder.*`, `front.*`, `albumart.*`, `art.*`, `<dir-name>.*`, etc.)
  with scored ranking; vetoes alternates like `back`, `tray`, `inlay`,
  `disc art`, `booklet`, `spine`.
- **Sync cover to disk** (per-release action): downloads
  `cover_art_url` via `reqwest`, writes `<dir>/cover.<ext>` (extension
  derived from HTTP `Content-Type`), updates `cover_art_path`. Aligns
  the on-disk cover with the published Nostr image for music apps that
  read the album folder directly.

### Labels

- **Label panel** shows a 21-second auto-rotating carousel of label
  artwork from your saved entries when the app is idle, and locks onto
  the currently-selected release's label when there's a match. Click +
  to add or edit an entry — name plus image URL (uploads to
  `nostr.build` are encouraged so images sync across devices).
- **Labelview list** beside it: a scrollable, searchable index of every
  distinct label string in the library, drawn straight from
  `releases.label`. A mauve ✓ chip indicates an image is on file;
  clicking a row pre-fills the LabelPanel form so you can add or
  replace the image inline. Caps at 40 visible rows with a "+N more"
  footer; the search input filters across all distinct labels.
- Built-in seed of ~41 popular electronic labels mapped to
  `nostr.build` URLs (see `src/lib/labelSeed.ts`), with a re-seed icon
  to merge in any seed entries missing from your set. Older builds
  bundled the label images as files; the current seed is URL-only so
  the binary stays small and images stay consistent across installs.
- One-shot migration on launch blanks any stale relative-path image
  URLs left over from those older builds, so the entry stays visible
  but you can see which labels still need a fresh upload.
- Labels can be **published to Nostr** as `kind:31238` events
  (`publish_labels`, `labels.v1`) so subscribers can resolve label
  artwork.

### Genres

- Three genre slots per release (`genre_primary / _secondary /
  _tertiary`) drawn from a fixed ~35-slug palette (`src/lib/genre.ts`),
  edited from the detail panel with completeness dots. Genres are emitted
  as `t` tags on the release event.

### Acquisition source & de-duplication

- **Acquisition-source dimension** — a user-extensible `source_label` per
  release (Bandcamp, a record store, a marketplace…), mirroring the label
  pattern: the vocabulary is the distinct set of assigned values and
  colours live in `localStorage`. Local provenance only — never published.
  Per-source metadata (colour, a `digital` flag) drives a source dot and
  colours the physical↔digital **pairing** indicator.
- **Merge** two rows that are really one release (a physical Discogs copy
  plus a digital Bandcamp purchase): pick a survivor, backfill its empty
  provenance / count fields from the loser, retract the loser's live
  `kind:31237` event first so no orphan `naddr` is left, then delete it.
  Entered from the detail panel via a search-pick + confirmation diagram
  (`MergeConfirm`, `DuplicatesDialog`).
- **Bulk edit** — a spreadsheet-style `BatchEditView` for tagging label /
  source / comment across many rows at once.

### Current (feed) view

- Author and publish short **feed notes** (`kind:31239`, `feed.v1`) — a
  running "now playing / just added" stream read by the companion reader.
  Backed by a local `feed_notes` table; `useFeed` / `CurrentView` render
  it.

### Nostr identity & publishing

- Generate a fresh keypair or paste an existing `nsec`. The secret key
  is stored in the OS keychain (libsecret on Linux via `keyring`);
  never written to a plain file. When logged in, the `npub` and the
  best-effort NIP-05 resolved from your `kind:0` metadata appear in
  the **app header** (alongside the version chip and DB switcher); a
  small icon there forgets the identity with confirmation.
- **Publish a release** as a `kind:31237` parameterized-replaceable
  event with the schema below. The release-detail action row shows
  the abbreviated `naddr1qq…` inline with adjacent copy + njump.me
  buttons; a one-line feedback strip below reports per-relay accepted
  / rejected.
- **Publish library** wraps the whole catalogue: confirmation step
  with an "irreversible" warning, then sends each release with a 50ms
  throttle and live progress events. Honours the same filters as the
  list (medium / search / no-cover / published-state).
- **Unpublish** issues a NIP-09 `kind:5` deletion request — relays
  that honour the spec remove the orphaned event. Useful for cleaning
  up wrong data on the network without leaving artefacts.
- **Publish-state persistence**: on accepted publish, ndisc records
  `last_published_at` and the resulting `naddr` against the release
  row, so copy / njump.me buttons stay active across app restarts.
  Unpublish clears these. A `published / unpublished` filter in the
  releases toolbar lets you sweep through the rest of the library and
  the right-hand count shows `N · X published · Y unpublished` of the
  current filter. Each row carries a small `[n]` chip — bright mauve
  when published, faded when not — so the publish state is visible
  without opening the detail panel.
- **Reconcile published state** (toolbar action): fetches the user's
  published `kind:31237` events from the configured relays and updates
  `last_published_at` / `last_published_naddr` on the matching rows.
  Restores state after switching machines or rebuilding the DB from
  scratch.

### Refresh from disk

- Per-release action that re-reads audio tags and re-resolves the
  cover from the local directory, writing any changes back into the
  DB. Useful after editing files in another music tool. Reports
  precisely which fields changed; no-ops when nothing differs.
- **Reconcile library** (`reconcile_library`) does this across the whole
  music root in one pass: discovers newly-added folders *and* refreshes
  existing releases, tracking orphaned/last-scanned rows.

### UI niceties

- App header carries the ndisc logo, the running app version, the
  Nostr identity row, and the DB switcher — all in a single bar.
- Library panel header inlines stats (Total / Physical / Digital /
  Artists) and the import shortcuts on a single row.
- Releases list shows 36×36 cover thumbnails per row with `cover.jpg`-
  style local files served via the asset protocol; scrollbar styled to
  match the dark palette with `scrollbar-gutter: stable` so layout
  doesn't shift on hover. Filter stats above the list colour the total
  (accent blue), the published count (mauve), and the unpublished
  count (white).
- **Markdown export** of the library (or any filtered subset) — writes
  a single `.md` table with cover thumbnails inlined as `<img>` tags
  pointing at `cover_art_url`, useful for sharing or static-site
  embeds.
- **Undo toast** on release delete — appears for 10 s with an "Undo"
  button that restores the row (id preserved, so any previously
  published Nostr event still addresses the same release).
- Catppuccin Mocha palette across the app; mauve secondary buttons
  reserve the accent blue for primary content actions.

## Companion site

[`glmps.upleb.uk`](https://glmps.upleb.uk) — public read-only
discography viewer. Subscribes to relays for `kind:31237 + kind:5`
events authored by a configured pubkey, dedupes by d-tag (keeps latest
by `created_at`), renders covers from the `image` tag at 195×195.
Developed independently against the schema below.

## Schema

```sql
releases (
  id, artist, title, year, medium, format,
  label, catalog_number, country, condition, notes, source,
  file_path, cover_art_path, cover_art_url,
  discogs_id, bandcamp_id, source_label,
  release_type, category,
  genre, genre_primary, genre_secondary, genre_tertiary,
  track_count, track_total, disc_total, video_count,
  publish_state, last_published_at, last_published_naddr, last_published_event_id,
  added_at, updated_at
)
```

`medium` is `'physical' | 'digital'`. Indexes on `artist`, `title`,
`year`, `medium`. Columns beyond the original core (cover_art_url,
release_type, category, the three `genre_*` slots, the track/disc counts,
`source_label`, `bandcamp_id`, `publish_state`, `last_published_event_id`)
are added via `ensure_column` `ALTER TABLE` migrations so existing DBs
upgrade in place — including a one-shot rename of the dead `musicbrainz_id`
column to `bandcamp_id` (now a **local** Bandcamp receipt id, never
published). `source` is normalised to an http(s) URL on import (Discogs CSV
synthesises `https://www.discogs.com/release/<id>`); legacy keyword values
from older builds are converted on first open.

## Install dependencies (Debian / Ubuntu)

Tauri's [Linux prerequisites](https://tauri.app/start/prerequisites/#linux):

```sh
sudo apt update
sudo apt install \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  build-essential \
  curl wget file
```

Plus a Node toolchain and a Rust toolchain:

```sh
sudo apt install nodejs npm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

`rusqlite` is built with the `bundled` feature, so no system SQLite
package is required. `reqwest` uses `rustls-tls`, so no `openssl-dev`
beyond what Tauri itself needs.

## Quick start

```sh
git clone https://github.com/xjmzx/ndisc.git
cd ndisc

make deps      # npm install + cargo fetch
make dev       # opens the Tauri window with hot reload
```

On first launch the SQLite database is created at the platform's
app-data directory (Linux: `~/.local/share/uk.upleb.ndisc/`). A binary
upgraded from the previous `disco-vault` build will automatically
migrate the old `~/.local/share/uk.fizx.discovault/` directory and the
libsecret `nsec` entry into the new locations.

## Build / install / deploy

The repo ships a `Makefile` that builds a release binary and places it
under `PREFIX/bin`, the icon under
`PREFIX/share/icons/hicolor/scalable/apps`, and a `.desktop` entry
under `PREFIX/share/applications` so the app appears in GNOME / KDE /
XFCE app menus.

```sh
# user-level install (no sudo) — default PREFIX is $HOME/.local
make install

# system-wide
sudo make install PREFIX=/usr/local

# remove
make uninstall                     # or: sudo make uninstall PREFIX=/usr/local
```

Other targets:

```sh
make help     # list everything
make check    # tsc + vite build + cargo check (no full Tauri build)
make build    # release build only
make clean    # remove dist/ and src-tauri/target/
```

The desktop entry is generated from `ndisc.desktop.in` with the install
paths substituted in, so it works regardless of `PREFIX`. `make
install` also tidies up the legacy `disco-vault` install artefacts if
they're still on disk.

## Layout

```
ndisc/
├── src/                          # React + TS frontend
│   ├── App.tsx                   # top-level layout + header + DB controls
│   ├── components/               # LibraryPanel, ReleaseList, ReleaseDetail,
│   │                             # AddReleaseForm, BatchEditView, NostrPanel,
│   │                             # LabelPanel, LabelviewPanel, CurrentView,
│   │                             # DiscogsEnrichPanel, DuplicatesDialog,
│   │                             # MergeConfirm, StatsView, UndoToast, Section
│   ├── hooks/                    # useFeed, useReactions
│   ├── lib/source.ts             # acquisition-source colour + pairing logic
│   ├── lib/genre.ts              # genre-slug palette
│   ├── lib/feed.ts               # feed-note helpers
│   ├── lib/{curation,publishState,dupDismiss,rating,cover}.ts
│   ├── lib/labelSeed.ts          # nostr.build label-URL seed + migration
│   ├── lib/{buttonStyles,cn}.ts  # shared button class + clsx helper
│   └── lib/tauri.ts              # typed wrappers around invoke()
├── schema/                       # SHA-pinned wire contracts (release.v2, feed.v1, …)
├── src-tauri/                    # Rust crate (Tauri shell + SQLite layer)
│   ├── src/lib.rs                # schema, commands, import, publish, migrations
│   ├── Cargo.toml                # rusqlite, lofty, nostr-sdk, keyring, reqwest
│   └── tauri.conf.json
├── icon.svg                      # suite-style 128px tile
├── ndisc.desktop.in              # .desktop template (PREFIX-substituted)
└── Makefile                      # deps / dev / build / install / uninstall
```

## Nostr schema (experimental — `kind:31237`)

There is no standardised NIP for personal music collections, so ndisc
defines its own event schema. It uses **parameterized replaceable
events** (NIP-01 range `30000–39999`) so each release is addressable
and updatable in place. The d-tag prefix is `disco-vault:<id>`,
retained from the project's original name to keep already-published
events addressable across the rename.

- **Kind:** `31237` (experimental, not formally registered).
- **Identity:** ed25519 keypair, secret key stored in the OS keychain
  (libsecret on Linux). Public key advertised as bech32 `npub`;
  optional human-readable handle via NIP-05 picked up from the user's
  `kind:0` metadata when present.
- **Address form:** `kind:31237:<pubkey>:<d>` — share via NIP-19
  `naddr1…`.

### Tag schema

| Tag         | Required | Notes |
| ----------- | -------- | ----- |
| `d`         | yes      | Stable per-release identifier (`disco-vault:<id>`) |
| `title`     | yes      | Album / release title |
| `artist`    | yes      | Primary artist (album-level) |
| `type`      | no       | Broad audio classification: `music` (default for imports) / `sample` / `stem` / `field-recording` / `message` / `other` |
| `category`  | no       | Release type, mostly for `type=music`: `album` / `ep` / `single` / `compilation` / `mix` / `live` / `soundtrack` / `bootleg` / `miscellaneous` |
| `medium`    | yes      | `"physical"` or `"digital"` |
| `format`    | no       | `LP`, `CD`, `FLAC 24/96`, `MP3 320`, … |
| `year`      | no       | 4-digit `YYYY` |
| `label`     | no       | Record label |
| `catalog`   | no       | Catalog number |
| `country`   | no       | ISO 2-letter or free text |
| `condition` | no       | Physical-only: `M`, `NM`, `VG+`, … |
| `source`    | no       | http(s) URL pointing at the listing (Discogs, Bandcamp, label store, …). Only emitted when the value is a real URL — legacy non-URL values are silently dropped on the way out. |
| `i`         | repeat   | NIP-73 external IDs — currently `discogs:release:<id>` only |
| `t`         | repeat   | Hashtag / genre (one per populated `genre_*` slot) |
| `image`     | no       | Cover art URL — square image, served by nostr.build, Blossom, or any HTTPS host (relays do not store binaries) |
| `tracks`    | no       | Track count (audio leaves) |
| `video`     | no       | Video-file count, emitted only when non-zero |

`content` carries free-form notes (personal annotations, source).

### Companion event kinds

Beyond the `kind:31237` release, ndisc publishes a few related kinds:

- **`31238`** — label events (`labels.v1`): label name + artwork URL.
- **`31239`** — `feed.v1` notes authored in the Current view.
- **`30000`** — a NIP-51 people-set of release contributors.
- **`4550`** — NIP-72 per-note approvals.
- **`7`** — NIP-25 reactions on releases.

### NIPs in play

- **NIP-01**: base event protocol.
- **NIP-09**: `kind:5` deletion requests, used by the per-release
  Unpublish action.
- **NIP-19**: `naddr1…` shareable links produced after each successful
  publish.
- **NIP-73**: external IDs (Discogs) emitted as `i` tags.
- **NIP-25**: `kind:7` reactions on releases.
- **NIP-51**: `kind:30000` people-set of contributors.
- **NIP-72**: `kind:4550` approvals.
- **NIP-65** (not yet emitted by ndisc): user-advertised relay list.
  Subscribers currently configure relays manually in the companion
  site.

### Privacy note

Publishing is public, permanent, and indexable. Anyone listing your
owned music is making a personal disclosure. ndisc requires a
confirmation step for the library-wide publish action for this reason;
per-release publish is one-click since you're acting on a single
specific item you chose to share.

## Still to come

- Pull metadata from **MusicBrainz / Bandcamp** at import time to enrich
  what the local files don't carry. (Per-release and library-wide
  **Discogs API** enrichment via `DiscogsEnrichPanel` has already shipped.)
- Subscribe to other users' collections from within ndisc (discovery).
- Cross-reference with `audio-flac-quality-check` reports for digital
  files — surface tracks flagged `PROBABLY-LOSSY` on the release entry.
- Bulk **Sync-cover-to-disk**. (Library-wide refresh landed as **Reconcile
  library**; embedded-cover extract and filename rescan already run across
  every no-cover release in one go.)
- **De-duplicate releases** — a release owned on both a physical (Discogs)
  and a digital (Bandcamp) route should be one row, not two. The
  acquisition-source dimension, per-source colour / `digital` metadata,
  symmetric physical↔digital pairing, and the two-row **merge** action have
  all shipped. Still open: a **duplicate finder** (auto-surface likely dup
  pairs to feed merge, reusing the `bc_tokens` fuzzy matcher), **bulk
  merge**, and generalising the tri-state source toggle into a **"filter by
  source"** dropdown over the distinct set.
- Suite-wide work that touches ndisc lives in
  [`SUITE.md` § Direction / roadmap](SUITE.md) — e.g. surfacing
  "published to Nostr" status across the apps, and the `clip.v1` provenance
  links that `ntree` / `nsmpl` clips will point back at.

## Companion apps in the suite

- [`bpm-tapper`](https://github.com/xjmzx/bpm-tapper)
- [`audio-flac-quality-check`](https://github.com/xjmzx/audio-flac-quality-check)
- [`smpl-tool`](https://github.com/xjmzx/smpl-tool)
