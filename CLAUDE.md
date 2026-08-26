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

## Not here

Machine-local paths, server addresses, credentials and per-box ops belong in a
machine-local `CLAUDE.md`, never in this file. **This repo is public.**
