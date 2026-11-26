# ndisc — notes for Claude

Discography catalogue and the suite's **publisher**. Tauri 2 · React · SQLite.

## Read SUITE.md first

[`SUITE.md`](SUITE.md) lives in this repo and is the **canonical hub** for the
whole n-suite: the Nostr wire contract, contract governance, the shared data
directory, the design language and the top-bar grammar. Every other app points
back here.

Read it **before making a platform-sensitive choice** — audio, media, storage,
webview APIs. It records constraints that are invisible on the machine you
happen to be working on. A recent example from `nchat`: tones were written with
Web Audio, worked perfectly on macOS, and were silent on Linux. SUITE.md had
said Web Audio output is broken on WebKit2GTK the whole time.

## Build and verify

```
make dev      # hot reload
make check    # npm run build (tsc + vite) + cargo check
make build    # release
```

The release path is `tauri build`, which runs Vite. **Never `cargo build
--release`** — it skips the frontend and you ship a stale `dist/`.

## Traps specific to this repo

- **This repo is the contract authority.** `schema/` holds the frozen,
  SHA-pinned contracts (`release.v2`, `feed.v1`). Changing one is a coordinated
  wave — publisher bumps the SHA, every consumer re-vendors in the same release
  — not a local edit. `glmps` and `nview` read what you change here.
- **Windows local builds need `--bundles nsis`.** WiX/MSI rejects a
  non-numeric version like `0.2.0-beta.6` and wants extra tooling. Do not set
  `targets` globally in `tauri.conf.json`. CI already passes the flag.
- **On Windows under a sandboxed agent, `%APPDATA%` writes get redirected.**
  The live catalogue is `Documents\ndisc\discography.db` — point the app's
  "Open existing database" at it rather than trusting the default path.
- **Use a distinct keypair per discography/pseudonym** when publishing, or
  `disco-vault:<id>` coordinates collide between them.
- **A label's art file is identified by its STEM, not its full name.** The
  rule is `<Label name>.<ext>`, and ncover's Convert rewrites `X.png` as
  `X.jpg` in the library and removes the PNG — so anything keyed on the
  whole file name goes stale the first time the loop runs. Two places were,
  and both are fixed in 0.9.1: `match_label_files` (a hand pick whose file is
  gone falls back to a file whose name IS the label's, reported as
  `fallback` with the lost pick in `lost`; a *close* match deliberately does
  not stand in, because a pick is not something to re-guess) and
  `plan_label_fill`'s `claim` (a label counts as filled when any image for
  its stem is there, and the plan names the file that IS there). Keep that
  rule in mind for stage 3d and anything else that reads `art_file`:
  **the extension is not part of the identity.**
- **One key for label names and label-art files: `label_words`.** Case,
  separators (`. - _` and space), a trailing `label`, accents, `μ`/`mu` and
  apostrophes don't count. Anything that compares a label to a file must use
  it — `label_words(&label_file_stem(file))` against `label_words(name)` — or
  a renamed file stops counting and Fill writes a duplicate (fixed after
  0.9.2). `label_file_name` is the *suggested* form (`stuff-records-label`),
  never a requirement.

## Not here

Machine-local paths, server addresses, credentials and per-box ops belong in a
machine-local `CLAUDE.md`, never in this file. **This repo is public.**
