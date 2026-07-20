# Cross-platform verification hand-off (2026-07-20)

> **Transient.** This is a testing checklist for the Windows / macOS sessions
> after the shared-suite-dir wave, not a spec. The durable contract lives in
> [`SUITE.md`](../SUITE.md) § *Shared architecture conventions*. **Delete this
> file once both platforms are confirmed.**

## First: you are probably on the wrong branch

None of this work is merged to `main`. Each repo has it on a feature branch:

| Repo | Branch |
|---|---|
| `xjmzx/ndisc` | `pairing-and-duplicate-resolution` |
| `xjmzx/nplay` | `label-filter` |
| `xjmzx/ntree` | `clip-coverage-bars` |
| `xjmzx/nsmpl` | `clip-coverage-bars` |

```sh
git fetch origin && git checkout <branch>
```

Developed and installed-tested on **Linux only**. Windows and macOS are unverified.

## What changed that is platform-sensitive

1. **The shared suite directory is now resolved per platform** (was Linux-only:
   `$HOME` + `.local/share`, which simply fails on Windows where `HOME` is
   normally unset). See the table in SUITE.md. Windows →
   `%LOCALAPPDATA%\ndisc-suite`; macOS → same path as Linux, deliberately.
   Implemented as `suite_shared_dir()` / `suite_config_dir()` in all four apps.
2. **ndisc gained the `trash` crate** — Recycle Bin on Windows, Trash on macOS —
   used by duplicate removal and delete-with-files.
3. **ffmpeg / ffprobe must be on PATH** for ntree (scan + the new hi-res check)
   and nsmpl (clip-coverage probing). Absent, those degrade quietly rather than
   erroring.

## Windows — what to check (ndisc + nplay)

- **ndisc:** run the export-manifest action. `published.json` **and**
  `catalogue.json` should appear under `%LOCALAPPDATA%\ndisc-suite\`.
  Previously this failed outright with `HOME: environment variable not found`.
- **nplay:** relaunch. The **label dropdown** should appear in the Collection
  toolbar — its presence proves the catalogue join found ndisc's export. Its
  *absence* is the failure mode to watch for, because it fails **silently**.
- **nplay:** BPM should still resolve (`bpm.json`, same directory).
- **ndisc:** try duplicate "remove a copy" or delete-with-files on an
  **unpublished** release. The folder should land in the **Recycle Bin**.
  - ⚠ **Most likely Windows-specific failure:** `guard_library_dir()` uses
    `canonicalize()` + `starts_with()`. On Windows `canonicalize()` returns
    verbatim `\\?\C:\…` paths. Both the target and the library root are
    canonicalized, so the prefix check *should* hold — but if trashing is
    **refused** with *"outside the library root"*, that is the cause. It fails
    safe (refuses rather than deletes wrongly), and the fix is one line.
- **ntree:** hi-res `HR` / `UP` badges require ffmpeg on PATH.

## macOS — what to check

Nothing on macOS uses the shared directory today: the Mac builds `nview` (iOS)
and the `glmps` readers, and a grep across `adjmx` / `macos-node` / `nview`
found **zero** references. The macOS branch of `suite_shared_dir()` is therefore
**forward-looking only** — it matters if and when a macOS desktop build of
ndisc / ntree / nsmpl / nplay happens.

So macOS verification is essentially: **does it still build**, and does nview /
glmps behave unchanged (they should — nothing they touch was modified).

## Linux-only — does NOT carry over

`make install`, `.desktop` entries and `~/.local/bin` are the Linux install
flow; use the `tauri build` outputs instead. `pkexec` (ntree's mirror tree) is
Linux-only.

## Not part of this test

- **master-release-key normalization** — mechanism decided (content-derived
  hash, see `schema/master-release-key-design-2026-07-19.md`), normalization
  still open.
- **`clip.v1` build** — specified (`schema/clip.v1.json`) and unbuilt; a
  coordinated ntree + nsmpl + ndisc wave.
