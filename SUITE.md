<img src="docs/n-suite-mark.svg" alt="n" width="72">

# The n-suite

A family of small, single-purpose apps for cataloguing, playing, sampling, and
publishing a personal music library — with **Nostr** as the shared publishing
and social layer. Built by **xjmzx** (`github.com/xjmzx/*`).

This is the **canonical hub document**. It holds the material shared across all
apps: the roster, the architecture conventions, the Nostr wire contract, the
design language, and the roadmap. Each app also ships its own
`<app>-introduction.md` covering its specifics and linking back here.

---

## The apps at a glance

| App | Role | Stack | Nostr role |
|-----|------|-------|-----------|
| **ndisc** | Discography catalogue + **publisher (the hub)** | Tauri 2 · React · SQLite | Publishes releases, labels, feed notes, reactions |
| **nplay** | Music + video player | Tauri 2 · React · SQLite · rodio | Reads the feed channel (Current view) |
| **ntree** | FLAC quality scanner + sampler + library mirror | Tauri 2 · React | Publishes NIP-94 clips + reactions; reads feed |
| **nsmpl** | Sample tool (two-track) + publisher | Tauri 2 · React | Publishes NIP-94 samples + reactions; reads feed |
| **nview** | Mobile viewer (read + react) | Capacitor · React | Reads releases/labels/feed; reacts via NIP-46 |
| **nping** | Nostr relay connectivity tester | Tauri 2 · React | No keys — tests relays |

`ndisc` is the authoritative publisher; everything else reads from and/or reacts
to the data it emits.

---

## Web consumption & sites

The publishing loop closes on the **web**, in a set of Nostr-based sites
developed on a separate **macOS device** and mirrored to the **`adjmx`** and
**`macos-node`** GitHub users. These are outside the `n` (Tauri/Capacitor) apps
but are first-class **consumers** of the same Nostr data — and they'll grow
alongside the project as its public face.

- **fizx.uk / upleb.uk** — the two Nostr-based personal sites. They *are* the two
  themes the whole suite's palette mirrors: **fizx** (default) and **upleb**
  (orange). Expected to expand with the projects.
- **glmps.fizx.uk / glmps.upleb.uk** — `glmps`, the **web-consumption
  demonstration reader**, served under each theme's domain. It renders the
  releases `ndisc` publishes against the shared contract — the canonical proof
  that a published release reads back correctly — and holds the **reader-side
  spec** `ndisc` publishes against.

---

## Shared architecture conventions

**The shared suite directory (per platform).** `published.json`,
`catalogue.json` and `bpm.json` live in one directory that every app resolves
**identically** — deliberately OUTSIDE each app's private data dir, because the
whole point is that the others can read it. `roots.json` is its config
counterpart.

| Platform | shared data | config (`roots.json`) |
|---|---|---|
| Linux | `$HOME/.local/share/ndisc-suite` | `$HOME/.config/ndisc-suite` |
| macOS | *same as Linux* | *same as Linux* |
| Windows | `%LOCALAPPDATA%\ndisc-suite` | *same dir* (no XDG split) |

macOS shares the Linux location because **nothing on macOS uses it yet** (the
Mac builds `nview` iOS and the `glmps` readers, neither of which touches it) —
so there is no migration, and consistency beats platform idiom until a macOS
desktop app actually exists. Windows uses **`LOCALAPPDATA`, not `APPDATA`**:
everything here is *machine-specific* (`roots.json` names local library paths),
so it must never roam between machines. Every app implements this as
`suite_shared_dir()` / `suite_config_dir()`; changing it is a coordinated wave,
not a local edit.

- **Desktop = Tauri 2** (React + Vite + TypeScript front end, Rust backend over
  IPC). **Mobile = Capacitor** (`nview` only).
- **SQLite** (`rusqlite`, bundled) where a local library index is needed
  (`ndisc`, `nplay`). Sampling/scanning apps (`ntree`, `nsmpl`) work against the
  filesystem live and don't keep a DB.
- **Native audio via `rodio`** in `nplay` — WebKit2GTK on the target Linux stack
  can't play media from any app URL scheme, so playback lives in Rust, not the
  webview. (Web Audio is also muted on this stack; short clips elsewhere use an
  `HTMLMediaElement`.)
- **Signing key** in the OS keyring for local-signer apps (`ndisc`, `ntree`,
  `nsmpl`); **NIP-46 remote bunker** for `nview`; none for `nplay`/`nping`.
- **Dev/install isolation** via `cfg(debug_assertions)` — debug builds use
  `*-dev` DB/config filenames and a distinct keyring service, so `make dev`
  never touches installed state.
- **Build**: `make dev` / `make install` for the Tauri apps (release path is
  `tauri build`, which runs Vite — never `cargo build --release`, which skips
  it). `nview` uses the Capacitor/Gradle toolchain. App icons derive from Figma
  masters.

---

## The Nostr wire contract (canonical)

The shared data spine. `ndisc` publishes it; the others read and/or react.

| Kind | Name | What it is | Publisher(s) | Reader(s) |
|------|------|-----------|--------------|-----------|
| **31237** | `release.v2` | A release (parameterized-replaceable; `d`-tag identity; genre / `tracks` / `discs` / `video` tags) | ndisc | nview, glmps, feed refs |
| **31238** | `labels.v1` | Record-label registry / metadata | ndisc | nview, glmps |
| **31239** | `feed.v1` | Feed-note channel (frozen contract; optional release `a`-ref) | owner (ndisc) | nplay (Current), nview, ntree, nsmpl |
| **30000** | NIP-51 list | Contributor registry (`d=glmps:contributors`) | ndisc | all |
| **4550** | NIP-72 | Per-note sign-off / approval | ndisc | — |
| **7** | NIP-25 | Reactions / ratings (shared `lib/rating.ts`, uniform aggregation) | ndisc, ntree, nsmpl, nview | all |
| **1063** | `clip.v1` | NIP-94 file metadata for a clip/sample, with an `a`-ref to its release + a `track`/`disc` locator (schema/clip.v1.json) | ntree (clips), nsmpl (samples) | *(planned:* ntree/nsmpl, ndisc, glmps*)* |

**Contract governance.** Two frozen, SHA-pinned contracts — `release.v2` and
`feed.v1` — live in [`schema/`](schema/). A contract change is a **coordinated
wave**: the publisher bumps the SHA and every consumer re-vendors it in the same
release. Two version axes apply everywhere — each app's own semver *and* the
shared `contract.vN` SHA (see `schema/README.md`). `labels.v1` and `clip.v1` are
**unfrozen** (no SHA pin yet) — each is promoted to frozen once its publisher
emits it. `clip.v1` is the clip↔release provenance link; design +
reconcile/manifest spec in
[`schema/clip-mapping-design-2026-07-17.md`](schema/clip-mapping-design-2026-07-17.md).
The contract is **internal** — the only consumers are the suite's own readers
(`glmps`, `nview`) — so a change stays a coordinated wave, not a public
deprecation exercise.

**Truth model (framing, 2026-07-19).** Two authorities that never conflict:
**relays are the network truth** (what exists, is discoverable, and reconciles —
no app is authoritative over network state), while **`ndisc` is the contract
authority** — it owns the schema *shape* in [`schema/`](schema/), nothing about
network state. "ndisc is truth" only ever means *schema authority for the vendor
apps that consume it*.

**Relay notes.** `ndisc`'s relay set must be a **superset** of the website's
read set. Primal doesn't enforce `kind:5` deletions, so deletes are filtered
client-side. **Discovery = shared hub (decided 2026-07-19):** `relay.fizx.uk`
stays in every app's read set as the union point, so cross-user discovery works
without per-user relay lists. NIP-65 / outbox (each user advertising their own
relays — the real "a relay each" model) is the eventual vision but **deferred**;
relays stay manually configured for now.

**Signing paths.** Local `nsec` in the OS keyring → `ndisc`, `ntree`, `nsmpl`.
Remote NIP-46 bunker → `nview`. No keys (read-only / connectivity only) →
`nplay`, `nping`. **One key per person (decided 2026-07-19):** the desktop tools
sign with the **same** `nsec` (one person = one `npub`) so "my clips/samples"
reconciles under a single author pubkey. Pasting in / switching between multiple
accounts is a noted future *want*, not planned.

---

## Shared design language

### Brand marks (2026-07-14)

Masters live in `~/ProtonDrive/Figma-Icons`. Three tiers, and they are not
interchangeable:

| asset | what it is | where it may be used |
|---|---|---|
| `n.circle` | the **suite mark** — bold `n` in a ring, monochrome | docs, READMEs, org avatar. No theme risk. |
| `n.disc` · `n.play` · `n.smpl` · `n.tree` | per-app **horizontal lockups** (mark + wordmark, dot motif in each mark) | **docs only, for now.** Vendored per repo as `docs/<app>-lockup.svg`. |
| `<app>.svg` / `<app>-sq.svg` | **launcher icons** — the app-icon masters | `icon.svg` in each repo → scalable launcher + Tauri raster set |

**The lockups are not yet cleared for in-app use, and there is a specific reason.**
They are hardcoded mauve (`#AA43FF`), and **the upleb theme repaints `--c-mauve`
orange** — the exact collision that forced ndisc's publish state onto a dedicated
theme-neutral `--c-nostr`. A mauve lockup in a header would clash the moment the
theme is switched. Adopting them in-app means giving them a theme-neutral
treatment first.

**Design pointer (not built):** the lockups are the intended direction for each
app's **header title**, which today is plain text. Resolve the theme question
before acting on it.

### Parked for the lab

Three open design questions, all deliberately not guessed at:

1. **Theme-neutral lockups.** The per-app lockups are hardcoded mauve
   (`#AA43FF`); the upleb theme repaints `--c-mauve` orange. Needed before they
   can head an app's header. *What do they look like in orange?*
2. **The stack strip.** See below. If wanted, it must be a component built from
   real vector logos, with each app declaring its own stack — not one baked
   image.
3. **nview's Android adaptive icon.** Its three `@capacitor/assets` sources are
   the same flat artwork, so the *foreground* is full-bleed square art — and
   Android masks the foreground to ~66%, clipping the wordmark at both ends and
   cropping the dark base away entirely. Long-standing, not introduced by the
   2026-07-14 refresh. The fix is to split the layers (background = the flat
   base; foreground = the mark inside the safe zone), which is a decision about
   *how the mark reads when it cannot span the full width* — a design call, not
   a regeneration.

**Rejected: `n.stack`.** A strip of tech-stack logos intended for the footer
(which currently reads `stack: Tauri 2 + React + TS + Tailwind + SQLite` as
text). Sent back: it is a *fake* SVG — six base64 rasters, zero vector paths,
1.75 MB — and a single baked strip would **misstate two apps**, since nsmpl and
ntree have no SQLite and their footers correctly say so. If the strip is wanted,
it should be a shared component built from real vector logos (~1 KB each), with
each app declaring its own stack.


- **Palette** — the *fizx* dark scheme, driven by CSS variables (`--c-*` in each
  app's `index.css`) and exposed as Tailwind tokens in `tailwind.config.ts`. Two
  themes: **fizx.uk** (default) and **upleb.uk** (orange swap). **Reference the
  tokens, never hardcode hexes.** Semantic roles: `bg` / `panel` / `surface` /
  `surfaceHover`, `fg` / `muted`, `accent`, `digital`, `mauve`, `ok` / `warn` /
  `alert` / `auburn`, and `medium` (the **neutral-dot** token — grey in mono,
  green in the colour themes; see the dot colour model below).
- **Typography** — Helvetica for UI; **monospace** for numbers, paths, IDs and
  hashes.
- **Form** — squared 90° corners; filled boxes over outlines.
- **Collapse-flanks layout** — a `Section` header click collapses a column to a
  2.5 rem `CollapsedStrip` sliver and hands its width to the neighbours via a
  grid template. Shared across `ndisc` / `ntree` / `nsmpl` / `nplay`.
- **Leaf / foliage vocabulary** — *leaf-dots* show present-vs-expected
  completeness (present = **full opacity**, missing = faint ~30%); *count
  badges* show track / disc counts (full-opacity fill).
- **Dot colour model (mono-first, reference impl = `ndisc` 2026-07-21).** Dots
  are monochrome by default; **colour is reserved for a named acquisition
  source**. The model, for other apps to follow:
  - **Neutral dots** — tracks, disc badges, and the pairing ring of an
    unknown/generic source — use **`--c-medium`**: *grey in the mono theme,
    green in the colour themes*. (`--c-medium` was the "leaf-green medium mark";
    it is now the general neutral-dot token.)
  - A neutral release's **inner medium dot is white (`--c-fg`)** — a notch
    brighter than its **`--c-medium` ring**. "Inner bright / ring a shade
    darker" is the template.
  - A **named source colours its inner dot with a theme-independent hex**
    (`lib/source.ts` seed or a user-assigned colour), and its **ring is that hex
    at 0.5 alpha** — darker by association. The hex shows in every theme, mono
    included.
  - **`--c-ok` (green) is never greyed in mono** — it means lossless/ok, which
    is information, not decoration.
  - Generic bucket names (`Record Store`, `Unknown`) are forced neutral in
    `releaseSourceColor` via `NEUTRAL_SOURCE_NAMES`, so they read as the default
    dot, not a branded source — `Record Store` is the physical default, `Unknown`
    the digital / unavailable-source default.
- **Source-platform indicators** — `lib/source.ts` seeds a small curated roster
  (~10 max, not one hue per label; shape already carries physical-vs-digital, so
  colour identifies the *store*). Digital stores: bandcamp `#1da0c3` / boomkat
  `#e0913a` / bleep `#e05a9c` / warp `#8b6be8` / planet-mu `#a8c94a`. Physical
  marketplace: discogs `#5e5c64` (near-neutral, manual-only — no domain
  inference). Plus user-assigned sources. Kept byte-identical in
  `ndisc` / `nview` / `glmps`.
- **Genre palette** — 38 active slugs with fixed hue assignments, shared between
  `ndisc` and `glmps` (the `g.*` Tailwind tokens; all slugs are pure peers).

---

## Direction / roadmap

**Near-term — tighten suite integration**
- Bring `ndisc`'s tree-dots + track/disc-count styling into `nplay`.
  **Count-badge styling done (2026-07-21)** — `nplay` now shares `--c-medium`
  and the neutral quantity badge (soft in the Collection tree). Leaf-dots /
  disc-counts are N/A there (no expected-vs-present data, single-disc tree), so
  this line is effectively complete.
- Surface **"published to Nostr" status** for a release across the apps
  (starting from `ndisc`, which already tracks it) — the clip side is the
  truthful, relay-reconciled dot in `clip-mapping-design-2026-07-17.md`.
- Have `ntree` / `nsmpl` clips & samples **reference the releases** they derive
  from (provenance links) — specified as **`clip.v1`** (`schema/clip.v1.json`,
  design `schema/clip-mapping-design-2026-07-17.md`): an `a`-ref + track locator,
  reconciled off the relays.

**Mid / long-term**
- Media edits — destructive *and* non-destructive.
- **BPM on the wire (decided 2026-07-19):** carry BPM as an **additive optional
  tag on `clip.v1`** — it's unfrozen, and BPM belongs to the derivative/track,
  not the SHA-pinned release-level `release.v2`. The local suite `bpm.json` stays
  the per-track truth for the whole library; only shared clips/samples put BPM on
  the wire. Serves source-track / sample identification.
- **Shared "work" identity across users (direction, 2026-07-19).** Today a
  release is a **personal shelf entry** — two collectors cataloguing the same
  album publish two different `31237` coordinates, and clip `#a` discovery finds
  only clips of *one* person's entry. Goal: a shared **master-release key** so the
  network can group "the same work" across users and media formats — the
  cross-user version of `ndisc`'s local physical+digital **merge/pairing** (one
  work, many format facets). Mechanism (sketch, undecided): each user still
  publishes their own personal `31237`, but every entry also carries a shared key
  as an additive tag. **Mechanism decided 2026-07-20: a content-derived hash** —
  computed independently by every user, so it needs no lookup and has no coverage
  gaps on self-released material (an MBID can be layered on later as an additive
  strengthener). The normalization feeding it is the open question.
  Aggregation and "clips of the work" discovery then filter on that key. Additive
  to SHA-pinned `release.v2` → a coordinated wave when ready. Stub +
  candidate keys: [`schema/master-release-key-design-2026-07-19.md`](schema/master-release-key-design-2026-07-19.md).
- **Reconcile test rig (to-do).** "Relays are truth" needs multi-relay /
  partial-availability testing — a local relay (strfry / nostr-rs-relay) plus a
  throwaway test key — so reconcile and best-effort `kind:5` retraction are
  exercised without publishing test data to `relay.fizx.uk`.

**Ultimate aim**
- Samples as first-class objects for **collaboration** → track construction →
  release construction → publish / share / comment, all over Nostr.

**Homes & devices.** Schema + contracts live in `ndisc/schema`; the reader spec
lives in `glmps`. The `n` apps are developed here (Linux) under
`github.com/xjmzx/*`; the web sites (`fizx.uk` / `upleb.uk` and the `glmps.*`
readers) are developed on a **macOS device** and mirrored to the **`adjmx`** and
**`macos-node`** GitHub users. `nview` (mobile) builds on its own device. The
suite is being formalised as coordinated repos across all three.

---

*Per-app detail: see each repo's `<app>-introduction.md`.*
