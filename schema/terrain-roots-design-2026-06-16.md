# Terrain & roots — suite storage/identity model (design note)

> **Status: PROPOSAL / design note — NOT canonical.** This sketches a
> storage-and-identity model shared across the three publishing apps
> (ndisc, ndisc.blobtree, ndisc.smpl). Nothing here is frozen or
> implemented yet. It is the foundation a future `audio.v1` provenance
> contract would sit on top of; see the closing section. Do not cite as
> spec.

Date: 2026-06-16

---

## Why this exists

Two problems share one root cause.

1. **Paths don't survive a machine change.** ndisc stores
   `releases.file_path` (and `cover_art_path`) as **absolute** strings.
   A library indexed on Linux at `/data/music/…` is meaningless when the
   same physical files are mounted on Windows at `D:\music\…`. Every
   disk-touching operation (rescan, cover-from-disk, sample extraction)
   breaks on the other OS. The data is fine; the *paths* are the problem.

2. **Audio artifacts are islands.** Samples (blobtree) and future
   mix-downs (smpl) are published / stored with no record of what they
   were derived from. There is no shared notion of *where audio lives* or
   *what it came from*, so the three apps can't reason about the same
   terrain.

Both fall out of the same gap: **there is no root abstraction.** Today a
path is just an absolute string. This note introduces named, typed roots
and makes every stored location *relative to a root* — which fixes (1)
outright and gives (2) somewhere to stand.

## The model

### A root

A **root** is three things:

- a **name / category** — `music`, `music_clips`, `music_samples`,
  `stems`, `mixes`, … (the set is open; see taxonomy below);
- a **type** — `source` (read-only, indexed, never written) or
  `output` (the app writes artifacts here);
- a **machine-local path** — `music = /data/music` on this box,
  `music = D:\music` on another. **Per-machine, never stored in shared
  data.**

Roots are a **set**, and a category MAY have more than one path (a
`music` library spanning `/data/music` *and* `/mnt/archive/music`). A
location is then identified by `(root, relpath)` — e.g.
`("music", "Artist/Album/01.flac")` — never by an absolute string.

### The terrain is the taxonomy

Where a file lives implies what it is. The default mapping:

| Root            | Type   | Default role | Owned/written by |
| --------------- | ------ | ------------ | ---------------- |
| `music`         | source | `track`      | (indexed only — ndisc) |
| `music_clips`   | output | `sample`     | ndisc.blobtree (raw extractions) |
| `music_samples` | output | `sample`     | ndisc.blobtree / curated |
| `stems`         | output | `stem`       | ndisc.smpl |
| `mixes`         | output | `mix`        | ndisc.smpl |

`music` is the discography: **known, referenced, categorized, and
otherwise untouched** — ndisc only indexes it (it is the `source` root
behind the SQL rows). The rest are where derived audio accumulates.

**Role stays explicit in the data, not inferred from the root alone.** The
root is an artifact's *home and default role*; storing `role` as a field
lets an artifact be reclassified (a mix-down promoted toward a track)
without physically moving the file. Recall the earlier point: role is
*relative* — a mix-down is a stem the moment it feeds a larger
composition — so role is a label on a node in a derivation graph, not a
fixed tier.

## Two identity layers (complementary, not either/or)

| Layer | Identity | Scope | Used for |
| --- | --- | --- | --- |
| **Local** | `(root, relpath)` | one machine / the suite's terrain | organizing the disk; portable across the user's own machines |
| **Global** | content hash (`x`, sha256) | the world; Nostr | the published passport; provenance edges |

- `(root, relpath)` is the **terrain map** — human-meaningful, fixes the
  portability bug, lets the three apps navigate the same disk.
- The **content hash** is what survives leaving the machine. NIP-94
  already carries `x`. Provenance edges (`sample ⟵ track`,
  `mix ⟵ samples`) reference sources **by hash**, so the lineage graph is
  valid across machines and even for artifacts never published.

An artifact row knows both: it lives at `(music_clips, …)` *and* hashes to
`x=…`. Roots are how the **user** navigates; hashes are how the **suite
and Nostr** navigate. They layer; neither replaces the other.

## Provenance, grounded in the terrain

The derivation graph (release → track → stem → sample, and the compose
direction samples → mix → track → release) maps onto the roots:

- ndisc indexes the **roots of the graph** (`music`, read-only).
- blobtree mints **leaves** into `music_clips` / `music_samples`,
  capturing — at extraction time, when it already knows them — the source
  track and the offset/duration it cut from.
- smpl writes **internal nodes** into `stems` / `mixes`, capturing — at
  bounce time, when it already knows them — the input artifacts it mixed.

Edges are recorded by **hash** (durable, machine-independent). The single
exception is the edge that pins a `track` to its **release**
(kind:31237), which needs the addressable `a`-tag and inherits the
`disco-vault:<sqlite-id>` identity fragility flagged elsewhere. Confining
the fragile reference to that one edge keeps the rest of the graph
content-addressed and durable.

## Grain hierarchy & resolution (added 2026-06-16)

The three apps operate at **different grains of the same tree**, and this is
not a conflict — it is a four-level hierarchy already latent in the file
paths. Each level derives from the one above (decompose) / composes toward
it (compose):

```
Release (folder)     ← ndisc grain · canonical · music root
  └─ Track (file)     ← blobtree's native grain; smpl must RESOLVE this layer
       └─ Clip/Sample  ← blobtree produces → music_clips; smpl loads
            └─ Mix/Stem  ← smpl produces → mixes / stems
```

| App | Operates at | Must resolve up to |
| --- | --- | --- |
| ndisc | Release (album **folder** = `file_path`) | — (top of the tree) |
| ndisc.blobtree | Track (file) + produces Clips | Release |
| ndisc.smpl | Clip / Mix | **Track → Release** |

**ndisc needs none of this granularity** — it stays release-grain, untouched,
canonical, owning only the *folder identity* (`file_path`). The relationship
is one-directional: the downstream apps roll their finer artifacts **up** to
ndisc's release units; ndisc never reaches down.

**Track grain is the shared spine** — blobtree's primary unit, smpl's pivot
unit, and the child of ndisc's release. Both downstream apps must locate it.

### Resolution rules

All derive-on-demand from what's already on disk — **no app stores a track
table**; the layer is resolved per loaded/scanned file.

- **Track → Release (climb-to-folder).** Build the set of ndisc `file_path`s;
  for a file, **climb its parent directories until one is in the set** —
  deepest hit wins. Segment-safe (`/`-boundary) and longest-match by
  construction. Covers normal album folders, multi-disc (`…/Album/CD1/…`
  climbs past `CD1`), and single-file releases (ndisc stores `file_path` as
  file *or* folder, so the match can land at depth 0). No match → "not in
  discography."
- **Clip → Track (suffix-strip).** A clip `…/music_clips/Artist/Album/
  track.<dur>s.flac` strips its `.<dur>s.flac` suffix to the **source
  signature** `Artist/Album/track` (blobtree already computes this), which
  identifies the source track file under `music`.
- **Mix/Stem → sources.** Follow the recorded `derived-from` content hashes
  (future `audio.v1`) to the source clips/tracks, then up.

### Per-app resolution path depends on the root

The root a file lives in selects the resolution path — which is why the
shared manifest matters beyond portability: an app must know a file's root
*identity* to resolve its lineage.

- loaded from `music` → it *is* a track → climb to release.
- loaded from `music_clips` → suffix-strip to track → climb to release.
- loaded from `mixes` / `stems` → follow `derived-from` → tracks → releases.

So smpl's SAMPLE panel can render the full chain — `clip → track → release`
plus a published badge — by combining suffix-strip with the climb rule. The
`(root, relpath)` source line already shipped is the first rung of this.

### Consumer example — LIBRARY publish indicators (blobtree)

The first concrete payoff: blobtree's LIBRARY, grouped into release rows via
the climb rule, can badge each release from a local read of ndisc's
`(file_path, last_published_at)` — no Nostr required:

- **Published** — matched ndisc row, `last_published_at` set.
- **Exists · unpublished** — matched row, `last_published_at` null.
- **Not in discography** — no matching row (removed, or uncatalogued).

A 4th state, **published-per-ndisc but stale/absent on relay** (propagation
drift), needs the bounded author-scoped Nostr overlay (ndisc's
`reconcile_published` shape) and is an optional enrichment, not a gate.

**Drift caveat:** a renamed or sort-prefixed folder (e.g. a `_`-prefixed
artist, or `Album (Remastered)`) won't climb-match and will read as "not in
discography." Treat no-match as **suspect**, not authoritative — normalise
(trim sort-prefixes, case-fold) or flag rather than assert a removal.

## Sharing the terrain across three apps

Each app keeps remembering **its own DB** on launch (unchanged — this is
desired). What's new is that the three must agree on the **root set**, or
"the apps work together" is only true by coincidence of paths.

**Decision: a shared suite manifest.** The terrain is declared **once** in
one small file — e.g. `~/.config/ndisc-suite/roots.json`, or a marker like
`/data/.ndisc-roots` at the terrain head — that all three apps read. Each
app still owns its DB; only the *terrain* is declared centrally. This is
what makes blobtree a true **mirror** of ndisc (they read the same root
map) rather than a parallel guess, and it makes suite integration literal
at the config layer instead of a coincidence of paths.

The alternative — each app configuring its own overlapping roots that
happen to point at the same `/data/...` — is **rejected**: simplest, but
drift-prone (blobtree and ndisc could silently disagree on where `music`
is), and it never gives the suite a single source of truth for the
terrain. The remaining open questions below are about the manifest's
*location and lifecycle*, not whether to have one.

Manifest sketch:

```jsonc
// roots.json  (per-machine; never committed, never published)
{
  "version": 1,
  "roots": {
    "music":         { "type": "source", "paths": ["/data/music", "/mnt/archive/music"] },
    "music_clips":   { "type": "output", "paths": ["/data/music_clips"] },
    "music_samples": { "type": "output", "paths": ["/data/music_samples"] },
    "stems":         { "type": "output", "paths": ["/data/stems"] },
    "mixes":         { "type": "output", "paths": ["/data/mixes"] }
  }
}
```

A DB row then stores `root` + `relpath`; resolution to an absolute path
happens at runtime against the local manifest. Two machines with different
manifests share the same rows.

## What this changes (and doesn't)

- **DB storage** migrates from absolute `file_path` to `(root, relpath)`.
  A migration can derive `(root, relpath)` from existing absolute paths by
  longest-prefix match against the declared roots; unmatched rows flag for
  the user to either add a root or relocate.
- **ndisc's `dbPath` config** is unchanged — that's *where the DB lives*,
  orthogonal to *where the music lives*.
- **Nothing about published events changes yet.** This is the storage /
  identity floor. The Nostr-facing provenance tags are the next layer.

## Open questions

1. **Manifest location & ownership** — `~/.config/ndisc-suite/` vs a
   marker file at the terrain head. Who writes it first (ndisc on DB
   init?) and how do the others discover it?
2. **Multiple paths per root** — search order, and what happens when the
   same `relpath` exists under two paths of one root.
3. **Case sensitivity** — ext4 (case-sensitive) vs NTFS/APFS
   (case-insensitive) `relpath` matching across the user's machines.
4. **Migration UX** — how unmatched absolute paths are surfaced.
5. **Does smpl participate in the terrain at all today?** It is
   file-by-file, not library-indexed; it may only need `mixes`/`stems`
   roots for *output*, reading inputs by ad-hoc path until it gains a
   library view.

## Relationship to the rest of the schema dir

- This note is the **storage/identity floor**. It is suite-internal and
  per-machine; it is **not** a wire contract and is **not** vendored by
  glmps.
- A future **`audio.v1`** contract (kind:1063 + `role` + hash-based
  `derived-from` edges + the single `a`-tag release link) is the
  **wire layer** that sits on top — that one *would* follow the
  `release.v2.json` canonical/frozen/vendored discipline.
- `release.v2.json` stays the authority for releases; the only new
  coupling is the `track → release` provenance edge.
</content>
