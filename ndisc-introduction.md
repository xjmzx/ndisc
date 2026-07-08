# ndisc — discography catalogue & Nostr publisher

> Part of the **n-suite**. Shared conventions, the full Nostr wire contract, the
> design language, and the roadmap live in the hub doc: **[SUITE.md](./SUITE.md)**.
> This file covers **ndisc** specifically.

`ndisc` is the **hub** of the suite: the app where a music library is catalogued,
enriched, and **published to Nostr**. Everything the other apps read or react to
originates here.

## What it does
- Catalogues releases (artist / title / year / medium / format / label /
  country / genre) backed by a local SQLite index of `/data/music`.
- **Reconciles the index with disk** — "Rescan library folder" discovers new
  album folders and refreshes existing ones in one pass; a header readout shows
  tracks / videos / incomplete / orphaned counts and the last-scanned time.
- Enriches from **Discogs** (CSV + per-release lookup) and folds in **Bandcamp**
  collection purchases (Windows handoff → canonical Linux DB).
- Batch-edit table view (sortable, inline label/comment editing) alongside the
  main list; per-release detail with cover art, completeness leaf-dots, and
  source-platform indicators.
- **Publishes** releases, labels, and feed notes to Nostr, and tracks
  per-release publish state (including staleness after edits).

## Tech stack & build
Tauri 2 · React + Vite + TypeScript · Rust backend · SQLite (`rusqlite`,
bundled) · OS keyring for the signing key. `make dev` / `make install`.
Dev/install state is isolated via `cfg(debug_assertions)` (`discography-dev.db`).

## Suite integration
- **Produces** the entire shared contract (see the hub): `release.v2` (31237),
  `labels.v1` (31238), `feed.v1` (31239), the contributor registry (30000),
  sign-offs (4550), and reactions (7).
- **Consumed by** `nview` + `glmps` (render releases/labels), `nplay` (reads the
  feed in its Current view), and `ntree` / `nsmpl` (whose clips/samples reference
  ndisc releases — provenance, growing).
- Owns the `schema/` contracts the whole suite vendors.

## Nostr surface
Full publisher. Emits kinds **31237 / 31238 / 31239 / 30000 / 4550 / 7**. Signs
with a local `nsec` held in the OS keyring. Its relay set must be a superset of
the website read set; `kind:5` deletes are filtered client-side (Primal).

## Styling notes
Reference implementation for the shared design language — the fizx palette
(with the upleb.uk orange theme swap on the title button), completeness
leaf-dots, source dots (`lib/source.ts`), the 38-slug genre palette, and the
collapse-flanks layout all originate or are canonical here.

## Backlog & direction
- ReleaseDetail + AddReleaseForm reorg onto one aligned-grid language.
- Labels view: bulk image-manifest editing (multi-select, drag-reorder, batch
  upload).
- `current` view maturation (feed-note authoring/curation).
- Multi-source coherence model (a release as an identity attested by a set of
  sources: discogs · local · bandcamp · url · nostr).
- See **[SUITE.md → Direction](./SUITE.md#direction--roadmap)** for the
  suite-wide roadmap (tree-dots into nplay, published-status surfacing,
  clip/sample provenance, media edits, collaboration).
