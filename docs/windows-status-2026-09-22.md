# Windows: what is confirmed, and what only looks tested

*2026-09-22. Written on the Windows box after `ndisc` v0.3.1 was built there and
the catalogue published. Pick-up note — the open items are the point of this
file. Machine-specific paths and per-box state are deliberately absent; they
live in that box's own `CLAUDE.md`.*

## State: ndisc v0.3.1 builds, runs and publishes on Windows

| | |
|---|---|
| Build | `npm run tauri build -- --no-bundle`, release, ~1m |
| Keychain | Windows Credential Manager, verified end to end |
| Publish | 118 of 118 releases live on both configured relays |

There is no `make` on that box, so the `Makefile` targets were run as their
underlying commands. `--no-bundle` sidesteps the WiX/MSI constraint entirely and
is the right choice when you only need the binary; `--bundles nsis` remains the
rule when you want an installer.

## The keychain is real, by four independent checks

Worth recording the checks rather than the conclusion, because the macOS failure
of 2026-09-22 was a build that *reported success while storing nothing*:

1. `cargo tree` on the Windows target shows keyring 3 with
   `Win32_Security_Credentials` enabled — the real backend, not the mock.
2. The shipped `.exe` imports `CredWriteW`, `CredReadW`, `CredDeleteW` and
   `CredFree` from advapi32. This is the artifact, not the dependency graph.
3. A standalone probe mirroring `keyring_entry()` (a fresh `Entry` per call)
   wrote in one process and read back in another — the exact boundary the
   in-memory mock fails at — and the credential was visible in Credential
   Manager as a Generic entry.
4. The app itself: import an nsec, kill the process, relaunch, and `get_npub()`
   derives the right npub from a cold start.

Note for anyone grepping the binary: only the `Windows Credential Manager`
literal survives in it. `keyring_backend()` selects on `cfg!`, which is
compile-time, so the other three branches are eliminated. Their absence is
correct, not a missing backend.

## The first publish run failed, and the error named the wrong relay

**Read this before debugging a publish.** The first library publish reported
12 published / 106 failed, with `last error: wss://nos.lol — timeout`. Both
obvious readings of that were wrong.

- **nos.lol was not rate limiting.** The second run used the identical 50 ms
  inter-event spacing and pushed 118/118 with zero failures.
- **The real cause was the other relay.** `relay.fizx.uk` runs
  `restricted_writes`, and the pubkey being published from was new and not on
  its allowlist. Every event was rejected there. `send_event` waits on all
  configured relays, so a relay that never acknowledges times the send out — and
  the surfaced error names whichever relay is mentioned last, not the one at
  fault.

**This was already written down.** SUITE.md, under the wire contract, states
that `relay.fizx.uk` runs `restricted_writes` (nostr-rs-relay whitelists by
author pubkey). The constraint sat in the canonical hub the whole time and was
not consulted. `CLAUDE.md` opens by saying to read SUITE.md first because it
"records constraints that are invisible on the machine you happen to be working
on" — this is precisely that case, and the cost was a failed run plus a wrong
diagnosis that nearly became a code change to the publish throttle.

**Consequence in the data:** a timeout is recorded as a failure even though the
event may have been accepted. One release went live on nos.lol while the local
DB still marked it unpublished. A timeout means *unknown*, not *failed*;
treating the two as the same is what desynced the DB from the relay.

## TEST THESE — the maintenance commands passed only on their trivial branch

Three ran green. None exercised a branch that can fail:

| Command | Result | What was actually exercised |
|---|---|---|
| Rescan library folder | new 0, refreshed 0, unchanged 110 | the nothing-to-do path |
| Audit published content | 118 checked, 118 match | the zero-drift path |
| Repair pressing strings | no candidates | the empty-set guard |

`Repair pressing strings` **cannot be tested on this catalogue at all**: its
candidate query requires `medium = 'physical'` and every release is `digital`.
It needs a library with physical, Discogs-linked rows.

Still untested: **discovery**, **orphan flagging**, **refresh/update**, and
**drift detection**.

Two ways to exercise them without collateral damage:

- **Drift.** The realistic failure mode is content changing without anything
  marking it stale — which a direct SQL write produces, since the UI clears
  publish markers on edit but a DB write does not. Change one published row's
  `year` in SQL, re-run the audit, expect exactly one drifted release on the
  `year` tag, revert. Read-only on the relay side; nothing is signed or sent.
- **Discovery / orphans.** Use a throwaway folder with a couple of audio files,
  not an existing release. Re-importing a published release mints a **new row
  id**, therefore a new `disco-vault:<id>` coordinate, leaving the event at the
  old coordinate live with no local row behind it.

Never run on Windows: **Reconcile relays**, **Reconcile published state**,
**Export published manifest**, and the four cover/artwork commands.

## Traps met on the way

- **`npm install` on Windows strips `libc` fields from `package-lock.json`.**
  54 deletions in this case. Revert rather than commit — the other boxes need
  them.
- **`publish_ids` sends exactly the ids on screen.** The backend deliberately
  never re-derives the filter, so an active list filter silently turns "publish
  all" into "publish some". Check the count in the list header first; the
  confirm button also reads *filtered* rather than *all* when one is active.
- **`merged_paths` guards resolved duplicates by absolute path.** Relocating the
  library silently unsuppresses them on the next rescan unless that table is
  rewritten with everything else — or the folder it names is left where it is.
- **`sqlite3` output is CRLF on Windows.** Paths read from it fail `stat` with a
  trailing `\r`, which looks exactly like a library full of orphans. Verify the
  tooling before believing a scary result.
