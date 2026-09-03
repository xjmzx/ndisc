# macOS: what landed, and what still needs testing

*2026-09-03. Written on the macOS device (`macos-node`) after the suite gained
macOS builds. Pick-up note — the open items are the point of this file.*

## State: all 8 Tauri apps build, install and launch on macOS arm64

| App | Bundle in `/Applications` | Version |
|---|---|---|
| gtrack | `gtrack.app` | 0.1.9 |
| nchat | `nchat.app` | 0.1.0-beta.2 |
| ntune | `ntune.app` | 0.2.0-beta.2 |
| ndisc | `ndisc.app` | 0.2.0-beta.7 |
| nplay | `nplay.app` | 0.2.0-beta.4 |
| nping | `nping.app` | 0.1.0-beta.2 |
| nsmpl | **`smpl-tool.app`** | 0.4.0-beta.3 |
| ntree | **`ndisc-tree.app`** | 0.3.2 |

Two bundles are **not** named after their repo (`smpl-tool`, `ndisc-tree`) — they
take the Tauri `productName`. Spotlight will not find them under "nsmpl"/"ntree".

Install locally with `./install.sh` in any repo (or `npm run install:app`). A
locally built `.app` carries **no quarantine attribute**, so Gatekeeper does not
prompt — that only applies to a downloaded `.dmg`.

**Launch is confirmed for all 8. Nothing below it is.**

## TEST THESE — none of it has been exercised

### 0. External tools — all present as of 2026-09-03
`aubio` **0.4.9_4 installed** (`brew install aubio`, done 2026-09-03), alongside
ffmpeg/ffprobe. All three are in `/opt/homebrew/bin`, which **is** in the macOS
`EXTRA_DIRS` list in `tools.rs`, so the resolver should find them.

That is a static path check, not a run: BPM detection has still never actually
been invoked. If it reports a tool missing, the resolver is the bug, not the
install.

### 1. External tools resolve from a Finder launch (nplay, nsmpl, ntree)
The whole point of `src-tauri/src/tools.rs`. An app launched from Finder inherits
launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), **not** a shell's, so
`/opt/homebrew/bin` is invisible to it and a bare `Command::new("ffmpeg")` fails
with "not found on PATH" while ffmpeg is plainly installed.

Resolution was proven against a PATH stripped to exactly the launchd default, but
**never through a running app**. Launch each from **Finder, not a terminal** — a
terminal launch inherits your shell PATH and silently passes regardless, which is
exactly how this hid for so long.

- `nsmpl` — an edit/bounce (ffmpeg), a duration probe (ffprobe)
- `ntree` — a library scan (ffprobe + ffmpeg)
- `nplay` — play a **video** file (ffmpeg extracts the audio track)
- override if a tool lives somewhere odd: `NDISC_TOOL_FFMPEG=/full/path/to/ffmpeg`

### 2. ntree's two formerly Linux-only paths
Both compiled on macOS and failed when called until 2026-09-03 (`603d689`).
- **Open containing folder** (double-click action) — was `xdg-open`, now goes
  through `tauri-plugin-opener`.
- **Mirror tree with sudo** — was `pkexec`, now AppleScript
  `do shell script … with administrator privileges`. **The auth panel itself is
  untested** — it needs an interactive password. The *quoting* is tested (unit
  tests + a real `osascript` round-trip with apostrophes, quotes and backslashes),
  so if this breaks, look at the privilege prompt or the resulting chown/chmod,
  not the path escaping. **Test with an album folder containing an apostrophe.**

### 3. nplay playback — the biggest unknown
Its native audio thread (`rodio`) and video loopback HTTP server were designed
around **WebKit2GTK's** inability to play local media. **WKWebView is different**
and has never been tried. Audio playback, video playback, seeking.

### 4. ntree batch preflight
A missing tool should now fail immediately with a message naming the fix, instead
of scanning the whole library and marking every file Failed. Temporarily rename
ffmpeg to check the message appears.

### 5. Keychain (ndisc, nsmpl, ntree, nchat)
Each rebuild gets a fresh ad-hoc signature, so macOS re-asks for authorisation —
expected in development; "Always Allow" holds until the next rebuild.

## Open, not started

- **`gtrack` shells out to `git`** with a bare `Command::new("git")` and has no
  `tools.rs`. It resolves from a Finder launch only because macOS keeps a shim at
  `/usr/bin/git` — the **Xcode CLT git**, not a Homebrew one. Fine today; would
  bite if it ever needs a newer git.
- **`Needs-verify: windows`** on `radio-scan` `6e78f00` — ntune's `install.ps1`
  first-run deps guard. Not syntax-checked (no PowerShell here). Safe failure mode:
  a wrong shim name just re-runs `npm install`.
- **ndisc's `has` function** is dead code (pre-existing `cargo check` warning).

## Traps worth not re-learning

- **Disk.** Cold Tauri release builds are ~2–3 GB of `target/` each and the tree
  persists after the build. Building several in a row filled a 460 GB disk and
  **truncated a file inside `node_modules`** mid-write (`plugin-dialog`'s
  `index.d.ts`, ending mid-comment → `TS1010`), which looks like a code error and
  is not. `rm -rf node_modules && npm install` fixes it. Check `df` first; delete
  `src-tauri/target` after installing — the `.app` does not reference it.
- **`workflow_dispatch` used to build the branch, not the tag** it was publishing
  to. Fixed in all 9 release workflows. A repo's version string matching a tag
  name does **not** mean HEAD is that tag — check
  `git rev-list --count <tag>..origin/main`.
- **`softprops/action-gh-release` overwrites a same-named asset silently**, so a
  re-run can destroy an original irrecoverably.
