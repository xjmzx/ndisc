# Clip ↔ release mapping — design note (2026-07-17)

**Status: proposal — design decisions locked (2026-07-17), ready to pin
`clip.v1`.** No wire change and no code yet. This settles the open
questions behind two near-term roadmap items (SUITE.md § Direction):
*"surface published-to-Nostr status across the apps"* and *"have `ntree` /
`nsmpl` clips & samples reference the releases they derive from (provenance
links)."*

## Goal

Make a published clip/sample (`kind:1063`) reliably map back to the `ndisc`
release (`kind:31237`) **and the track** it derives from — across sessions and
machines — so that:

- the Library's "published" dot (`bg-nostr`) is **truthful**, not just a local
  cache that only reflects publishes made from one install;
- a **`published` filter facet** becomes meaningful;
- `ndisc` can show clip/sample **coverage** per release;
- `glmps` can offer **"listen to a clip"** on a release page.

`ndisc` is the truth (releases). `ntree` (clips) and `nsmpl` (samples) publish
the `1063`s that point back at it.

## Why it's broken today

1. **The `1063` carries no link to its release.** Both producers emit only
   `url`, `m`, `x`, `size`, `title`, `alt`, `t` — no `a`-tag
   (ntree `src-tauri/src/lib.rs:2264-2272`; nsmpl `src/lib/nostr.ts:283-296`).
   So SUITE.md's *"referencing a release"* line is aspirational, not true.
2. **Local identity is path-based.** ntree keys the dot on
   `sourceSignature(path, root)` — a relative path, not portable across
   machines/roots (`ntree/src/lib/paths.ts:38-53`).
3. **No manifest materialises a release's Nostr coordinate.** `published.json`
   is `{id, artist, title, dir}` (`ndisc/src-tauri/src/lib.rs:2489-2506`). The
   coordinate `31237:<pubkey>:disco-vault:<id>` is *reconstructable* (the `id`
   equals the `disco-vault:<id>` d-tag) but is never stored, and no consumer
   rebuilds it. So a relay event can't be joined back to a folder.
4. **`published.json` is track-blind** — release↔folder only, no tracklist.
5. **Publish state isn't durable.** ntree records it in `localStorage` only
   (verified empty on this machine: `afqc-tauri.published = []`); nsmpl records
   **nothing** (transient UI status). Neither survives a machine change.
6. **The `31237` event has no tracklist on the wire.** `release.v2`'s `tracks`
   tag is a *count* (`schema/release.v2.json`), not a list. Per-track data lives
   only in `ndisc`'s local SQLite index — so track detail must ride on the clip
   + the manifest, never on the release event (which stays frozen).

## The model

`ndisc` = truth. A clip's `1063` carries a **back-reference** (release
coordinate + semantic track locator + optional source hash). Reconciliation:
fetch your own `1063`s from the relays → read the back-reference → resolve to a
local source track via the manifest (+ `roots.json`). **The relay is the source
of truth for "what I published"; the local store becomes a cache** rebuilt each
session.

## 1. Wire — `clip.v1` (the `1063` tag set)

Shared by `ntree` (clips) and `nsmpl` (samples); `t` (`"sample"|"full"`)
distinguishes them. **Additive** to the existing `1063` — old consumers ignore
the new tags.

Existing (unchanged): `url`, `m`, `x` (sha256 of the **clip** file), `size`,
`title`, `alt`, `t`.

New:

- `["a", "31237:<ndisc_pubkey>:disco-vault:<release_id>"]` — the release
  coordinate (NIP-33 addressable ref; the **same form `feed.v1` already uses**
  for `release_ref`, `ndisc/.../lib.rs:3442-3443`). Present only when the source
  is inside a released folder; **omitted for unreleased sources** (orphan clip).
- **Semantic track locator** (durable, human-legible — decision (a)):
  - `["title", "<track title>"]` — already emitted; doubles as the track title.
  - `["track", "<n>"]` — track number.
  - `["disc", "<n>"]` — disc number (omit or `"1"` for single-disc).
- **Optional strengthener** (decision (b)):
  - `["source-hash", "<hex>", "audio-md5"]` — an **ffmpeg audio-stream MD5** of
    the *source* track: `ffmpeg -i <src> -map 0:a -f md5 -`. Tag-independent
    (hashes decoded PCM, so it survives re-tagging), codec-agnostic (the library
    is mixed-format), and **no new dependency** (ntree already shells `ffmpeg`).
    The **3rd element is the algorithm marker** (`audio-md5`) so the method is
    self-describing and swappable — a later "survives re-encode" tier just
    changes it to `chromaprint` with no other ambiguity. Distinct from `x`
    (which hashes the *clip*). Optional; disambiguates re-tagged/duplicate
    tracks.

> We deliberately do **not** reuse NIP-94 `ox` (original-file sha256): a
> full-file hash of the source is fragile to re-tagging — the exact thing the
> audio-stream MD5 is chosen to survive.

## 2. Manifest additions

**`published.json`** (ndisc, `export_published_manifest`):
- top-level **`ndiscPubkey`** (once) — so consumers build the coordinate without
  hard-coding the author key.
- per-release explicit **`naddr`** — ndisc already stores `last_published_naddr`
  per release in SQLite, so it exports the real, authoritative coordinate rather
  than have every consumer re-hardcode the frozen `disco-vault:` d-tag scheme.
  Materialises the coordinate so relay→folder is a real bridge.
- per-release **`tracks[]`**: `{ relpath, title, track, disc }` — the
  track-level join data (`published.json` is track-blind today).
- **Auto-export on publish/unpublish.** It's a manual button now, so the join
  goes stale between exports (a clip of a newly-published release won't resolve
  until the next manual export).

**`roots.json`** (the clip↔source resolver, `mirrorOf`; `~/.config/ndisc-suite/`):
- Currently **hand-authored per machine with no writer**, so the whole reconcile
  silently fails if it's missing/stale. **First cut: validate-on-load** — check
  it exists and is well-formed, and show a clear *"roots.json missing/invalid —
  reconcile disabled"* error instead of failing silently. A **generator** (a
  Tauri command that writes it from the source + clips roots) comes later, once
  the flow is proven. Load-bearing either way.

Other manifests (`bpm.json`, `labels.v1`, contributor registry) are unaffected.

## 3. Reconcile / republish flow

On load (or on demand) in `ntree` + `nsmpl`:
1. Fetch your own `kind:1063` by author pubkey from the relay set.
2. For each: read `a` (release) + track locator (+ optional `source-audio-md5`).
3. Resolve to a local source: `a` → `published.json` release → its `tracks[]`
   (or the folder `dir`) → match by track/disc/title (+ hash if present) →
   source relpath; bridge clip-root ↔ source-root via `roots.json`.
4. Seed the published set (ntree: replaces the `localStorage` cache; nsmpl: its
   **first** ledger — derived, not stored).

**Republish / re-link** (legacy or orphan clips): `1063` is a *regular*
(non-addressable) event, so you can't replace it in place. To fix a legacy clip:
publish a new `1063` with the full `clip.v1` tags, then `kind:5`-delete the old
event id. Offer this as an explicit "re-link" action. The few discoverable test
clips are the reconcile/republish **test case** (this machine's ntree ledger is
empty, so any test clips are relay-only — a clean exercise of the relay-derived
path).

## 4. UI

- `ntree` / `nsmpl`: the mauve dot becomes truthful; add a **`published` filter
  facet** (`FilterState.published: "all" | "published" | "unpublished"`).
- `ndisc`: optional **coverage** view (which released tracks have clips/samples).
- `glmps`: optional **"listen to a clip"** on a release page.

## 5. Rollout — coordinated wave

- Pin **`schema/clip.v1.json` + `.sha256`** alongside `release.v2` / `feed.v1` /
  `labels.v1`. **One `clip.v1`** covers both `ntree` clips and `nsmpl` samples;
  `t` (`"sample"|"full"`) distinguishes them — no separate `sample.v1`.
- Producers (`ntree`, `nsmpl`) adopt the `clip.v1` tag set + the reconcile flow.
- `ndisc` extends `published.json` (pubkey + naddr + `tracks[]`; auto-export) and
  adds the `roots.json` writer.
- Readers (`glmps`, `nview`) optionally consume; re-vendor `clip.v1` + re-pin its
  SHA where they read it.
- **Multi-platform:** macOS builds `nview` + the `glmps.*` readers; Windows tests
  an `ndisc` build. The contract + schema are re-vendored to those targets in the
  same wave (as already done for `release.v2` / `feed.v1`).

## Resolved decisions (2026-07-17)

1. **Track-locator tags** — bare `track` / `disc` (plus the existing `title`).
2. **Source-hash tag** — `["source-hash", "<hex>", "audio-md5"]`, the 3rd
   element an algorithm marker (swappable to `chromaprint` later). Optional.
3. **One `clip.v1`** — shared by clips and samples; `t` distinguishes. No
   separate `sample.v1`.
4. **`roots.json`** — validate-on-load first (loud error, no silent failure);
   generator later.
5. **`published.json` coordinate** — store the explicit per-release `naddr`
   (ndisc already holds `last_published_naddr`); no consumer-side reconstruction.

All design calls are made; `clip.v1` can be pinned from this note.

## Ties to existing roadmap

Implements SUITE.md § Direction (near-term): *"published-to-Nostr status across
the apps"* and *"clips & samples reference the releases they derive from
(provenance links)."* Serves the ultimate aim (samples as first-class
collaboration objects) by giving every clip a durable, machine-independent link
to its release and track.
