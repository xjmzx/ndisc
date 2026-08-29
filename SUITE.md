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
- **The alias is the account name alone** — `xjmzx`, `adjmx`, `macos-node` — not
  `github-<account>`. The `Host` block already sets `HostName github.com`, so a
  `github-` prefix only restates what the block says, and the bare name is what
  the remotes on every box actually carry. Each block also needs **`User git`**:
  GitHub accepts no other SSH user, and a block naming the account instead works
  only while the URL happens to spell out `git@` — write the alias bare and it
  fails to authenticate.
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
  fell through to the unpinned fallback block. **Windows and macOS have not been
  re-checked against the bare form** and may still carry `github-<account>`
  aliases; both spellings pin correctly, so that is a naming convention to
  converge, not an exposure.

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

Masters live in `~/ProtonDrive/Figma-Icons`. Three tiers, and they are not
interchangeable:

| asset | what it is | where it may be used |
|---|---|---|
| `n.circle` | the **suite mark** — bold `n` in a ring, monochrome | docs, READMEs, org avatar. No theme risk. |
| `n.disc` · `n.play` · `n.smpl` · `n.tree` | per-app **horizontal lockups** (mark + wordmark, dot motif in each mark) — now **monochrome** (black/white) | docs / READMEs. Vendored per repo as `docs/<app>-lockup.svg`. |
| `<app>.svg` / `<app>-sq.svg` | **launcher icons** — the app-icon masters | `icon.svg` in each repo → scalable launcher + Tauri raster set |

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
2. **nview's platform launcher icons + Android adaptive icon.** nview is the one
   Capacitor app, so its launcher icons don't come from `icon.svg` + `make
   icons` like the Tauri apps — they're generated by `@capacitor/assets` from
   **PNG** sources in `assets/`, and that needs the `cap` CLI (absent in the
   headless dev env). As of 2026-07-25 only `public/icon.svg` (the **PWA / web**
   icon) is refreshed; the **Android `res/mipmap-*` set and the iOS `AppIcon`
   still show the old icon**. To finish, on a machine with `cap`:
   - **Re-export the PNG sources** — `assets/icon-only.png`,
     `assets/icon-foreground.png`, `assets/icon-background.png` — from the new
     master. These are rasters (the source is a Figma export), not copies of
     `public/icon.svg`.
   - **Regenerate + sync:** `npx capacitor-assets generate` → rebuilds
     `android/.../res/mipmap-*` and `ios/.../AppIcon`, then `npx cap sync`.
   - **Split the adaptive layers first.** Today the three sources are the same
     flat artwork, so the *foreground* is full-bleed square art and Android
     masks it to ~66% — clipping the wordmark at both ends and cropping the dark
     base entirely. Fix: background = the flat base; foreground = the mark inside
     the safe zone. That's a design call (*how the mark reads when it can't span
     the full width*), not a regeneration — do it before running the generate
     step, or the clipped result just re-bakes.
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
