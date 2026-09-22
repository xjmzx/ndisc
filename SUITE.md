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

## Who this document governs (2026-09-18)

The name says which rules apply. Two kinds of app read this document:

- **`n*` apps are the suite** (ndisc, nplay, ntree, nsmpl, nview, nping,
  nchat…). *Shared design language* below applies to them **strictly**: the
  palette, the top-bar and library grammars, squared corners and the other
  form rules. A departure is a change to this document first, not a local
  exception.
- **An app that starts from an n-suite app's design and takes another letter**
  (gtrack `g`, psync `p`, uchar `u`) is a **co-developed tool**, and uses that
  design as a **starting reference**. It may derive its own, and departing
  from a design rule is a decision that app's own `CLAUDE.md` records, not a
  fault. gtrack's margin bars, cut at 45° where a group starts and ends, are
  the first such departure.

**Tools are achromatic (2026-09-19).** What sets a co-developed tool apart
from a project at a glance is its chrome: **neutral grey, with colour spent
only on syntax** — a colour that means something in that app (a state, a
warning, a banner), never on decoration. Ground, surfaces, text, the
wordmark, chips that say nothing and the primary button are grey or white.
The `n*` apps keep the suite palette; a tool does not.

- **Keep the token names**, change the values. The `--c-*` triples stay, so
  Tailwind's `/opacity` modifiers and code shared with the suite keep working;
  only the neutrals (`bg`, `panel`, `surface`, `surface-hover`, `fg`, `muted`)
  become greys. The semantic tones (`ok`, `warn`, `alert`, `mauve`, `digital`)
  keep their hues, used only where they carry meaning.
- **Match the luma of the navy scheme** for the ground (gtrack: 12 / 17 / 28 /
  43), but set `muted` **brighter** than its navy original (gtrack: 140 against
  ~120). A grey has no hue to part it from the ground, so it needs contrast
  instead. Faint text that read on navy (30–50% alpha) is too faint on grey.
- **Wordmark in grey** — two tones of grey where it had two colours. A
  wordmark in a state colour makes that colour mean two things.
- **A new colour in a tool's chrome is a regression.** A new state takes one
  of the existing tones.

| tool | status |
|---|---|
| gtrack | achromatic since v0.1.15 (`src/index.css` has the reasoning) |
| uchar | achromatic from the start — pure greys, `alert` its only hue |
| psync | **not yet** — still the navy fizx scheme, with `accent` / `mauve` / `digital` used decoratively in `App.tsx` and `FolderRow.tsx` |

**What binds everyone, whatever the letter:** the platform facts and the
icon pipeline. The constraints under *Shared architecture conventions*
(WebKit2GTK, Keychain code identity, line endings, `make version`…) describe
how the platforms behave rather than how things should look, so a derived app
hits them just as hard. *Brand marks* (the grid, the per-platform framing,
`make icons`) covers every app with a Figma master, whatever its letter. And
the Nostr wire contract binds any app that speaks it.

**Where notes live, and how they reach each box.** This file travels by git
and is the one each app's `CLAUDE.md` points to, so it is what every box and
every client actually reads — suite-wide rules belong here. The icon masters'
own `ICONS.md` travels by Proton Drive, which the Linux box only has as a
manual copy, so a rule that exists only there can silently miss a box. An
assistant's memory stays on the machine and session that wrote it; treat it
as a convenience, never the record.

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
| **nchat** | Private direct messages | Tauri 2 · React | NIP-17 gift-wrapped DMs; whitelist-only |

`ndisc` is the authoritative publisher; everything else reads from and/or reacts
to the data it emits. `nchat` is in the suite because it is where the suite's
own alerts land — the cert and domain expiry bots DM their operator — not
because it touches a release.

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

`nchat` does not participate. It shares no library view and keeps no database
at all; its `nchat.json` — public keys, petnames, relays, never a secret —
lives in its own app config dir.

**Where the library lives is recorded two different ways, and only one of them
can be re-pointed.** `nplay` keeps an explicit **`musicRoot`** in its own app
config — one editable value. `ndisc` keeps **no root setting at all**: every
release row stores an absolute `file_path`, with `cover_art_path` and
`merged_paths` alongside it, all pinned to wherever the library stood when the
release was catalogued. Both apps therefore agree on the library today by
coincidence of history rather than by a shared setting, and there is nothing
that would tell you if they stopped agreeing.

The consequence is asymmetric and only surfaces on the day the library moves,
or a machine is rebuilt, or a drive letter changes: **`nplay` needs one config
edit; `ndisc` needs every stored path rewritten** — on the Windows box that is
214 rows across two columns for 118 releases. Nothing in either app rewrites
them, and nothing warns that a path has gone stale; a moved library simply
reads as missing files.

Worth knowing before either app grows a "change library location" feature: for
`nplay` that is a settings field, for `ndisc` it is a migration.

- **Desktop = Tauri 2** (React + Vite + TypeScript front end, Rust backend over
  IPC). **Mobile = Capacitor** (`nview` only).
- **SQLite** (`rusqlite`, bundled) where a local library index is needed
  (`ndisc`, `nplay`). Sampling/scanning apps (`ntree`, `nsmpl`) work against the
  filesystem live and don't keep a DB. `nchat` keeps no local store either — a
  sent message survives a restart only because every send is wrapped twice, the
  second copy addressed back to the sender.
- **Native audio via `rodio`** in `nplay` — WebKit2GTK on the target Linux stack
  can't play media from any app URL scheme, so playback lives in Rust, not the
  webview. (Web Audio is also muted on this stack; short clips elsewhere use an
  `HTMLMediaElement`.)
- **Signing key** in the OS keyring for local-signer apps (`ndisc`, `ntree`,
  `nsmpl`, `nchat`); **NIP-46 remote bunker** for `nview`; none for
  `nplay`/`nping`.
- **Dev/install isolation** via `cfg(debug_assertions)` — debug builds use
  `*-dev` DB/config filenames and a distinct keyring service, so `make dev`
  never touches installed state. In `nchat` this is load-bearing rather than
  tidy: removing an identity deletes the only copy of its key, no IPC command
  can export one, and there is no local message store — so a dev run reaching
  release state would take the key *and* every conversation it could decrypt.
- **Build**: `make dev` / `make install` for the Tauri apps (release path is
  `tauri build`, which runs Vite — never `cargo build --release`, which skips
  it). `nview` uses the Capacitor/Gradle toolchain. On **macOS** `nchat`
  installs via `./install.sh`, not `make install`: it must be a real `.app`,
  because the Keychain keys access on the caller's code identity and a
  bundle-less binary is a *different app* to the OS. App icons derive from Figma
  masters.
- **Line endings: `* text=auto eol=lf`**, from a `.gitattributes` in every repo
  (plus explicit `binary` for `*.png`, `*.ico`, `*.icns`). LF in the repository
  *and* in every working tree, on all three platforms. Git for Windows defaults
  to `core.autocrlf=true`, so without the file the answer is **per-clone**: a
  Windows tree reports unchanged files as modified, and a CRLF blob can land in
  a file the Linux and macOS boxes hold as LF. `eol=lf` rather than a bare
  `text=auto`, because normalising only the repository still leaves Windows
  checkouts CRLF — which is where the phantom-modified files come from. Not
  hypothetical: a CRLF-only `Cargo.toml` blocked a fast-forward pull that had
  nothing to merge, and the same file had to be dropped by hand twice during
  the Windows port of `gtrack`. Adding it is a **no-op** wherever every blob is
  already LF — verify with `git add --renormalize .`, which should stage
  nothing but the new file. A working tree checked out *before* the file
  existed keeps its old endings until each file is next written — harmless,
  because the clean filter makes git see them as unchanged; in a clean tree,
  `git rm --cached -r . && git reset --hard` forces the conversion if you want
  it uniform. Landed in `ndisc`, `nplay`, `nsmpl`, `ntree` and `gtrack`
  (2026-08-26); `nview`, `nping` and `nchat` still need it.
- **File modes: a tree-wide `100644 → 100755` is the Linux twin of the CRLF
  trap above.** A checkout copied through a filesystem that carries no POSIX
  permissions — FAT/exFAT/NTFS, a Windows-side copy, a cloud-sync folder —
  comes back with the executable bit set on *every* file. With
  `core.fileMode=true` (the default off Windows) git then reports the whole
  tree as modified, permanently, while `git diff --stat` reads `0 insertions(+),
  0 deletions(-)` and `git diff --raw` shows the **same blob hash on both
  sides**. Same shape as the line-ending case, and the same lesson: **`git
  status` alone cannot tell you whether a tree holds work.** Separate the noise
  from the content before believing any dirty count — `git diff --numstat | awk
  '$1=="0"&&$2=="0"'` lists the mode-only entries, and the complementary test
  lists the real ones. Two traps in that check: **binary files report `-`, not
  `0`**, in `numstat`, so they read as changed and will inflate the "real" list
  — compare against the committed blob (`git show HEAD:<path> | md5sum`) to
  settle one; and **`.gitattributes` does not cover this**, because a mode is
  not content, so the fix above does nothing here. Where a tree is otherwise
  clean, `git config core.fileMode false` is the per-repo answer; never
  blanket-`checkout` a tree that also holds real edits. Found 2026-08-26 on the
  Linux box across the orphaned clones under `~/sites` and `~/code`, and in
  `macos-node/run-lnd-on-macos`, where it inflated a dirty count of 128 files
  that held nothing whatsoever.
- **`keyring` needs a backend feature named per platform, or it silently uses a
  mock store.** The local-signer apps (`ndisc`, `ntree`, `nsmpl`, `nchat`) take
  `keyring` with `default-features = false`, so the backend comes only from the
  features asked for. Ask for none on a given platform and the crate **does not
  fail to build and does not error at runtime** — `keyring/src/lib.rs` reads
  `#[cfg(all(target_os = "windows", not(feature = "windows-native")))] pub use
  mock as default;`, and the same shape guards macOS. The mock store is
  in-memory and per-process: it accepts a key, returns it for the rest of that
  run, and loses it on restart, reporting success at every step. **A signing key
  that vanishes, with no error anywhere** — the worst of the traps recorded here,
  because the other two only make a clean tree look dirty.
  Each platform needs its own: `windows-native`, `apple-native`,
  `sync-secret-service` + `crypto-rust`. `radio-scan` had all three; `ndisc`,
  `nsmpl` and `ntree` carried the Linux features unconditionally and so were on
  the mock store on Windows — fixed 2026-09-01 by adding a
  `cfg(target_os = "windows")` block to each. `ndisc` and `nsmpl` were
  compile-verified on Windows; **`ntree` could not be, because it does not build
  on Windows at all** — `mirror_library` uses `std::os::unix::fs::MetadataExt`
  unconditionally (`uid`/`gid`/`mode`, src/lib.rs:1269), which is a separate
  portability question from this one. Its guard is committed anyway so the three
  carry the same shape. **macOS is still unguarded in all
  three**: no `apple-native` anywhere, so a Mac running any of them gets the mock
  store too. Not yet observed, plausibly because the Mac builds `nview` and the
  `glmps` readers rather than these — but it is the same defect and wants the
  same three lines.
- **Remotes must pin the account they authenticate as — an SSH *host alias*,
  not bare `git@github.com:`.** Three GitHub identities are in play (`xjmzx`,
  `adjmx`, `macos-node`) and the property that matters is not the protocol. An
  `https://` remote resolves through whatever the credential helper hands over;
  a bare `git@github.com:` resolves through whichever key `ssh-agent` offers
  first. **Both can push as the wrong identity, and neither says so until the
  commit is on the wrong profile.** A host alias (`git@<account>:owner/repo.git`)
  names an `IdentityFile` and can only ever be one account — with
  `IdentitiesOnly yes` in `~/.ssh/config`, so ssh cannot fall through to another
  loaded key.
- **The alias *name* is per-machine, deliberately.** `github-xjmzx` on one box
  is `xjmzx` on another; both pin equally well, because what pins is the
  `IdentityFile` in the `Host` block, never the spelling of the name. Do not
  standardise it across boxes and do not let any tool match on a specific alias
  — classification checks the *shape* of the URL (does it name an identity?),
  which is why gtrack works unchanged on all three. Each block does need
  **`User git`**, and that part *is* machine-independent: GitHub accepts no
  other SSH user, and a block naming the account instead works only while the
  URL happens to spell out `git@` — write the alias bare and it fails to
  authenticate.
- **The trap is that converting `https://` to `git@github.com:` looks like the
  fix and is not**: it clears the old `https remote` warning while leaving the
  same exposure. `git remote get-url` is no help either — it *applies*
  `url.*.insteadOf` rewrites, so it will show an alias for a remote still stored
  as HTTPS; audit `git config --get remote.origin.url`. gtrack ≥0.1.8 flags this
  correctly as **`unpinned`** rather than by protocol; a repo with no remote
  counts as pinned, being an archive.
- **State of the three boxes.** All 16 checkouts on the Windows box were
  converted 2026-08-26; the Linux box's 23 were moved the same day. The **Linux
  box was audited 2026-08-29 and is clean**: 52 of 53 remotes on the bare alias
  form, one archive with no remote, no HTTPS and no bare-SSH survivors, all
  three aliases carrying `IdentitiesOnly yes` and authenticating as the right
  account. That audit found two faults *inside the config meant to prevent this*,
  both fixed the same day — the blocks set `User <account>` where GitHub requires
  `User git`, and `adjmx.github.io` was misspelt `adjmz.github.io`, so that host
  fell through to the unpinned fallback block. Windows and macOS were converted
  and checked in the same 2026-08-26 run; their alias names differ from this
  box's by design and need no reconciling. The **macOS box was audited
  2026-08-30 and is clean**: all 59 checkouts in gtrack's roots on the alias
  form, all three aliases carrying `User git` and `IdentitiesOnly yes` and
  authenticating as the right account, and no `insteadOf` rewrite anywhere —
  neither Linux fault was present here.
- **A clean gtrack report is only as wide as its roots, and that is where the
  macOS audit actually found something.** Five owned repos sat on `https://`
  remotes while the tool called the machine clean: three under `~/code`, which
  is no root at all, and two under `~/code_vibe/macos/`, which is a root but one
  level deeper than the scan goes. All five were converted 2026-08-30. The
  lesson generalises to every box — **`unpinned` counts what was scanned, so an
  audit has to sweep the filesystem, not the tool's own view of it**, and the
  raw `git config --get remote.origin.url` sweep above is what does that. It
  also turned up an orphan the old HTTPS remote had been hiding in plain sight:
  `adjmx/sveltekit-gh-pages` no longer exists, which only became legible once
  the remote named an account and the error stopped being a generic 404.

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

**Messaging (outside the spine).** `nchat` speaks kinds **1059 / 13 / 14**
(NIP-17 gift wrap) and reads legacy **4** (NIP-04, never written). These are
not part of the catalogue contract — nothing publishes them for another app to
consume, and a `release.v2` / `feed.v1` wave never touches them. They are
recorded here so the suite's Nostr surface is documented in one place. The one
rule the wrap imposes on any reader: **sort by the inner rumor's `created_at`**,
because the wrap's own timestamp is randomised *backwards* by up to two days by
design. A relay or explorer will therefore report a message as up to 48h older
than it is, and there is no relay-authoritative time to fall back on.

The second wrap property is operational: every 1059 is signed by a **fresh
throwaway key**, so wraps cannot be filtered by sender and cannot pass a
pubkey allowlist. `relay.fizx.uk` runs `restricted_writes` (nostr-rs-relay
whitelists by author pubkey), and therefore **can never carry nchat traffic** —
not a misconfiguration but a structural incompatibility, worth knowing before
anyone points the suite's own hub at the messenger.

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

**`CLAUDE.md` lives in three tiers, and only one of them is publishable.**
Every repo here is public or may become public, so the split is a safety
property rather than a filing preference.

| Tier | Where | Holds | Travels by |
|---|---|---|---|
| Per-repo | `<repo>/CLAUDE.md` | build commands, contracts, traps specific to that code | git — same on every machine |
| Machine-local | `~/code_gh/CLAUDE.md` | server addresses, SSH, per-box ops, what lives where on *this* box | nothing; each machine keeps its own |
| Personal | `~/.claude/` | memory index, settings, allow-rules | nothing |

**Never in a repo, on any machine:** host addresses and ports, SSH users, key
paths, `nsec` values or their file locations, webroot and `/etc` paths,
relay whitelists, anything under `~/.claude/`. A per-repo `CLAUDE.md` that
needs to refer to one of those names it — "the deploy host", "the relay owner
key" — and stops. `~/code_gh` is deliberately **not a git repo** so the
machine-local file has nowhere to be committed to; keep it that way.

Every per-repo `CLAUDE.md` ends with a `## Not here` section stating the rule
and naming the repo as public. That footer is the mechanism: it is what makes
the next session put a server address in the right file instead of the
convenient one. A repo whose `CLAUDE.md` lacks it has not adopted the pattern.

**Direction of travel when in doubt: down, not up.** A fact that is true of the
code goes in the repo. A fact that is true of a machine goes in that machine's
file. A fact that is true of the code but *reveals* a machine — a deploy
command with a real host in it — is machine-local, because the sensitive half
decides.

**Signing paths.** Local `nsec` in the OS keyring → `ndisc`, `ntree`, `nsmpl`,
`nchat`.
Remote NIP-46 bunker → `nview`. No keys (read-only / connectivity only) →
`nplay`, `nping`. **One key per person (decided 2026-07-19):** the desktop tools
sign with the **same** `nsec` (one person = one `npub`) so "my clips/samples"
reconciles under a single author pubkey. Pasting in / switching between multiple
accounts is a noted future *want*, not planned. **`nchat` is the deliberate
exception**, not a lapse: it holds several identities at once because a
correspondent list mixes people with bots, and keeping the key that signs an
alert separate from the one that signs a personal message is the point of the
app. The rule is about reconciling *authored catalogue data* under one pubkey —
which `nchat` publishes none of.

---

## Shared design language

### Brand marks (2026-07-14)

Masters live in the **`Figma/` folder on Proton Drive**, organised since
2026-09-18 into `svg/<app>.svg` (the 1024 master, **the source**), `png/<app>.png`
(1024) and `png-x2/<app>-x2.png` (2048, what the raster pipelines take; named
`-2.png` before that round), with `<app>-sq.*` beside each. Its `ICONS.md` holds
the per-box log and where the folder sits on each machine — synced on macOS and
Windows, a manual copy on Linux, which has no Proton Drive client. Three tiers,
and they are not interchangeable:

| asset | what it is | where it may be used |
|---|---|---|
| `n.circle` | the **suite mark** — bold `n` in a ring, monochrome | docs, READMEs, org avatar. No theme risk. |
| `n.disc` · `n.play` · `n.smpl` · `n.tree` | per-app **horizontal lockups** (mark + wordmark, dot motif in each mark) — now **monochrome** (black/white) | docs / READMEs. Vendored per repo as `docs/<app>-lockup.svg`. |
| `<app>` / `<app>-sq` (.svg 1024 + .png 2048) | **launcher icons** — the app-icon masters, both on Apple's grid since 2026-09-12 | see *Which launcher variant goes where* below |

**Which launcher variant goes where (rewritten 2026-09-12).** The 2026-09-12
export redrew the artwork and moved **every variant onto Apple's icon grid**:
art in an 824 square centred in a 1024 canvas — a 100px transparent margin on
every side — with a corner radius of ~185 on that square (~22%). Measured, not
assumed: the shipped exports carry a 9.7% margin, art at 81% of the canvas, and
transparent canvas corners.

- **One master per app, every platform.** `<app>.svg` (1024) is the source;
  rasterise it at 2048 and feed that to `tauri icon`. It covers the macOS
  `.icns`, the Windows `.ico`, the Linux hicolor set, `icon.svg` and
  `public/icon.svg` alike, plus the pong, ncover, utc-clock and bpm-tapper
  icons. A separate `<app>-mac-x2` was exported first and then dropped: once the
  base moved to the same geometry, two masters that agree are one master plus a
  way to get them out of sync.
- **Each platform frames the art differently (2026-09-18).** One master, three
  framings, all rendered by `make icons` with no re-export. Measured on the
  committed outputs (share of the tile the art spans at the largest size):

  | platform | output | framing | art fill | why |
  |---|---|---|---|---|
  | macOS | `icon.icns` | Apple's grid, full 1024 canvas | **80.5%** | the grid *is* the native macOS size; full-bleed read boxy in the Dock |
  | Linux | `32x32` · `64x64` · `128x128` · `128x128@2x` · `icon.png`, and hicolor `scalable/apps/<app>.svg` | cropped viewBox `49 49 926 926` (`LINUX_VIEWBOX`) | **89%** | every Yaru icon fills 89% (~210 apps measured on the Ubuntu box) |
  | Windows | `icon.ico` (256/64/48/32/24/16) | same crop as Linux | **89%** | native median fill is ~100%, three quarters above 95% (157 programs measured on the Windows box) |
  | iOS / Android | `ios/` · `android/` | as `tauri icon` writes them | unchanged | see the full-bleed square note below |
  | in-app / web | `icon.svg` · `public/icon.svg` | the master, uncropped | 80.5% | the source of truth; never cropped in the repo |

  **Only the `.icns` and the mobile sets keep the grid margin.** A change to one
  platform's framing must not move another's: the Linux crop and the Windows
  `.ico` are written *after* `tauri icon` in the same target, from a separate
  `app-icon-linux.png`, so the `.icns` and mobile sets stay exactly as
  `tauri icon` wrote them from the uncropped render.
- **Why Linux and Windows crop.** Apple's margin is an Apple convention. Against
  Yaru's 89% and Chrome/Signal/Mullvad circles at 100%, a grid master at 80.5%
  read small in the Ubuntu dock; on Windows it read small on the taskbar beside
  Explorer, Notepad and Signal. 89% is taken for Windows too, rather than
  Windows' ~100%, so both platforms share one crop and one `LINUX_VIEWBOX`, and
  because a rounded tile at full bleed reads heavier than the native glyphs,
  which are unplated shapes. `LINUX_VIEWBOX` is used twice per Makefile: the
  `install` step that writes the hicolor svg, and the `icons:` step for the PNGs
  and the `.ico`. pong's hand-built `packaging/windows/icon.ico` (from
  `icon-dash`) takes the same 89%. ncover and uchar are Linux-only, so their
  whole raster set is cropped.
- **Why the grid, for the record.** The previous masters were full-bleed — art
  edge to edge, radius ~8% of the canvas — which rendered visibly larger and
  boxier than every native icon beside them in the Dock and in Finder. Windows
  and Linux were expected to want the full-bleed form, then briefly thought to
  read correctly with the 10% margin; neither did — see the crop above.
- **iOS / Android still need a genuine full-bleed square, and it does not
  currently exist.** The `-sq` variants moved onto the grid too, so every one of
  them is now inset with rounded, fully transparent corners. iOS rejects an
  AppIcon with an alpha channel and Android's adaptive `_foreground` /
  `_background` layers are full-bleed by design, so **nview's native sets were
  deliberately left on the old artwork** (`nview` commit `af19dd2`); its web and
  PWA icons took the new export. They stay behind until a square master is
  exported that is opaque to all four edges.
- **Rasterise from 2048**, never from the 1024 SVG directly: every repo's
  `make icons` target rendered at 1024 until 2026-09-12 and handed `tauri icon`
  half the detail it could have had. The SVGs have outlined lettering, so
  rsvg-convert is faithful; the ImageMagick fallback does not render Figma masks
  reliably. The ledger apps' rounded and square variants use different colours
  (pink vs mint).

**The lockups are now monochrome (2026-07-25).** They used to be hardcoded mauve
(`#AA43FF`), which **the upleb theme repaints orange** — the exact collision that
forced ndisc's publish state onto the theme-neutral `--c-nostr`, and the reason
they were kept out of headers. The masters were re-exported black/white, so the
vendored `docs/<app>-lockup.svg` are now **theme-neutral** and hold under both
fizx and upleb. `n.circle` (the suite mark) was already monochrome.

**Design pointer (still not built):** the lockups remain the intended direction
for each app's **header title**, which today is plain text. The theme blocker is
resolved now that they're monochrome; adopting them in-app is a separate step,
not yet taken.

### Top-bar grammar (2026-07-25)

Every app's top bar is the **same three-zone frame** so the suite reads as one
family — only the *contents* of each zone are app-specific. Reference impl:
`ndisc`. Applies to `ndisc` / `nplay` / `ntree` / `nsmpl`.

**Container.** A rounded panel card: `rounded-lg bg-panel shadow-md px-4 py-3`,
laid out as a **three-column grid** `items-center gap-4`. `1fr_auto_1fr` centres
the module by splitting slack **evenly** between the flanks — fine when the two
zones are balanced. But when one zone is content-heavy (ndisc's controls: app-
work + db + nostr + view-switch), the even split starves it: it gets half the
slack, needs more, and overflows **leftward** (it's `justify-self-end`) over the
centre. So the columns are `grid-cols-[auto_minmax(0,1fr)_auto]`: the identity
and controls zones are **content-sized** (always shown in full), and the centre
focal module is the flexible track that yields — give it `min-w-0
overflow-hidden justify-start` so it clips its least-important trailing content
(e.g. ndisc's Video/Incomplete/Orphaned stats) instead of forcing an overlap.

**LEFT — identity.** The theme-cycling **wordmark** (`n` in `--c-accent`, the
app suffix in `--c-mauve` — the suffix repaints orange under upleb, which is
correct for the wordmark) then a **version/status chip** (`bg-surface
text-mauve font-mono text-xs`, `hidden md:inline-flex`). An app may fold live
status into that chip (`ntree`), and may hang one app-scoped affordance off the
left group (`nplay`'s music-folder path). Version lives **here**, not the
footer; the footer carries stack + machine values only.

**Version format (2026-07-26).** The chip displays **only `major.minor.patch`**
(`v0.1.2`) — any pre-release/build suffix (`-beta.2`, `+build`) is dropped to
the chip's `title` tooltip. This keeps the chip a fixed, predictable width as
releases move from `0.2.0-beta.2` toward `1.3.1`, so the header layout stays
consistent across the suite. Each app vendors a `shortVersion(v)` helper
(`v.split(/[-+]/)[0]`) and renders `v{shortVersion(appVersion)}` with
`title={`v${appVersion}`}`.

**CENTRE — the one focal module.** Exactly one, and it is the app's primary
live thing: **master transport** for players (`nplay`, `nsmpl`), the **primary
readout** for catalogue/scanner apps (`ndisc` library stats, `ntree` scan
verdict bar). It degrades gracefully (`hidden lg:flex`) at narrow widths.

**RIGHT — controls, in this fixed left→right order**, each group divider-
separated by `<span class="w-px h-6 bg-surface shrink-0" aria-hidden>`:
1. **app-work** — the app's own actions (import/enrich/export, Scan, density /
   decks / edits `Segmented`s);
2. **Nostr identity** — optional NIP-05 chip + the **forget-identity** button,
   rendered only when signed in;
3. **view-switch** — **always last.** `ToolbarIconButton tone="digital"`, icon
   size 14, **Home first**, active view always lit (it is the single way back).
   Single-view apps (`nsmpl`) omit this group entirely.

**Shared primitives.** `ToolbarIconButton` (vendored per repo) is the one
icon-button vocabulary: `tone="digital"` for view-switch, `tone="mauve"` for
the forget-identity button, `tone="auburn"` for the db group. Don't hand-roll a
one-off button where one of these fits.

### Library grammar (2026-07-25)

The scrollable library/collection list — `ndisc` Collection, `nplay` /
`ntree` LibraryTree, `nsmpl` FileBrowser — shares a row vocabulary so the
four read as one family. Reference impl: `ntree` (the row + density work is
most complete there).

**Filled-block rows.** A row is built from **filled blocks over a transparent
row**, not tinted whole rows: an **accent name/title block** (`bg-accent/10`,
`group-hover:bg-accent/25`) and a **medium/opus trailing status block**
(coverage bar · leaf/status dots · count). Hover brightens the fills via the
row's `group/*`. See also the leaf/foliage vocabulary and the dot-colour model
above — dots inside these blocks follow those rules.

**One striped, selectable body.** Audio and video rows are one list: **zebra
striping is continuous** across the audio→video boundary (the video map's index
continues past `tracks.length`, it does not reset), and **any row is selectable**
— the selected row is `bg-accent/15` (`hover:bg-accent/20`) and loads into the
detail/sample panel. A video's audio is legitimate content, so video rows
select like audio rows; `text-fg/70` is the only "not analysed" signal on their
own cells.

**Video-file marker.** The uniform mark for "this row/scope holds video" is a
**muted-mauve `Film` glyph at `text-mauve/60`** (with an optional count), and it
**lives inside a filled block** (the trailing status strip or the title block) —
never floating bare in a gap, never full-strength mauve. *One exception:*
`nplay` tints the per-track marker **`text-digital`** when the video is actually
picture-playable (mp4/m4v) — a meaningful "this one plays with picture" signal,
not decoration.

**Density (`super-slim` / `slim` / `wide`).** A shared three-tier control
(`Segmented`, mirrored as `ntree` "rows" and `nsmpl` "wave") scales the row's
vertical rhythm. It scales the **height of the colour blocks themselves**, so
the filled background **extends vertically rather than opening a gap** around a
fixed-height pill. Track rows carry the fill on the whole row (padding grows the
bg directly); artist/album rows put the density padding on their inner blocks
(name pill · chevron box · trailing status block · opus title block) with
`items-stretch`, so those fills grow with the row. A truncating name gets an
inner `truncate` span so it still ellipsizes *and* stays vertically centred at
any height.

### Parked for the lab

Two open design questions, all deliberately not guessed at:

1. **The stack strip.** See below. If wanted, it must be a component built from
   real vector logos, with each app declaring its own stack — not one baked
   image.
2. **nview's Android adaptive icon.** nview is the one Capacitor app. Its
   platform icons were brought onto the current design on 2026-09-11: the web
   and PWA icons use rounded `nview-x2`, and the iOS `AppIcon`, Android
   `res/mipmap-*`, `assets/icon-*.png` and maskable PWA icon use square
   `nview-sq-x2`. They were rasterised directly from the PNG, with no `cap` CLI
   needed. **What is still open is the adaptive split:**
   - Today the adaptive foreground and background are the same flat square
     artwork. Android masks the visible area, so a circle mask clips the ends
     of the `nview` wordmark. The fix is background = the flat base and
     foreground = the mark inside the safe zone. That is a design call (*how
     the mark reads when it can't span the full width*), not a regeneration,
     and it needs a new Figma export.
   - Once that exists, either rasterise the layers the same way or put them in
     `assets/` and run `npx capacitor-assets generate`, then `npx cap sync`.
   - Do **not** let Android Studio's suggested AGP/Gradle upgrades ride along in
     the same change — they're incidental to opening the project; take them
     deliberately as their own commit if wanted.

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

**Proposed next (2026-09-22)** — two directions, both independent of the
catalogue work and of each other.

- **ntune: multi-station logging.** The live logger currently follows one
  station (Acid Jazz). Investigate switching stations and logging several.
  The blocker is not code: **most stations do not publish what is currently
  playing**, so the first step is a survey of which stations expose usable
  now-playing metadata (ICY `StreamTitle`, or a station API) and what the
  useful subset actually is. Logging a station that reports nothing produces
  an empty log, so this is a data-availability question before it is a feature.
  Detail in `radio-scan/docs/`.

- **Desktop onboarding flow.** `nview` has one for mobile; the desktop apps
  drop a new user straight into an empty window. Three things need setting up
  and all three are currently found by reading source or docs:
  **relays**, **data locations** (library root, logs, DB), and **nsec
  management in the OS keychain**. Goal is simplicity, not a wizard.
  Per-app to start — ndisc, ntree, nsmpl and ntune each need a different
  subset — with a shared shape only if one emerges. Worth noting the keychain
  step is the one with real consequences: in `nchat` removing an identity
  destroys the only copy of its key.

- **Suite-wide verification tooling.** Every real defect found during the
  2026-09-22 Windows pass came from checking an app's claim against an
  independent source, never from the app's own summary: the UI reported 12
  releases published while the relays held 14, and blamed a timeout on the
  healthy relay while the failing one was rejecting every event. A script that
  drives the UI would have caught none of it. What is wanted is an **oracle**
  outside the apps — keychain backend actually linked, `publish_state` against
  what each relay serves, served-event tags against what the catalogue would
  emit, local paths resolving, and each relay's NIP-11 (`restricted_writes` is
  visible *before* a publish, not after). Suite-level rather than per-app:
  ndisc, ntree and nsmpl share the keyring pattern and the wire contract.
  Two design rules, both learned the hard way. **Discover, never store** —
  DB path, relay list and library root come from the app's config, and the
  pubkey decodes out of any stored `naddr`, so no machine-specific value ever
  enters the repo and there is nothing to redact. **Assert invariants, not
  values** — "published count equals each relay's live count for this pubkey"
  survives; "118 releases" rots within the week.


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

- **macOS: all 8 Tauri apps now build, install and launch** (2026-09-03) — but
  only *launch* is confirmed. External-tool resolution, `nplay` playback on
  WKWebView, and `ntree`'s new privilege prompt are all untested. Open items and
  the traps hit on the way:
  [`docs/macos-status-2026-09-03.md`](docs/macos-status-2026-09-03.md).

- **Windows: ndisc v0.3.1 builds, keychains and publishes** (2026-09-22) — the
  Credential Manager path is verified end to end and the whole catalogue is
  live on both relays, but the library-maintenance commands passed only on
  their trivial branch: nothing to discover, nothing drifted, no candidates.
  Nothing has yet been shown to *detect* anything. That, the publish failure
  whose error named the wrong relay, and the traps met on the way:
  [`docs/windows-status-2026-09-22.md`](docs/windows-status-2026-09-22.md).

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
