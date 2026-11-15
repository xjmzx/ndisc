# Startup check and first-run setup (design, 2026-11-16)

Planned for **0.7.0**. Nothing here is built yet. This document records the
agreed shape of the work and the facts in the current code that it depends on.
It is ndisc's part of the suite-wide "Desktop onboarding flow" item in
[`SUITE.md` § Direction / roadmap](../SUITE.md); the other apps need different
subsets and aren't covered here. Once it ships, the CHANGELOG takes over.

## Why

At launch, ndisc shows its window and spins the refresh wheel for one to three
seconds while it opens the database and reads the keyring. Nothing in that
time tells you whether the app is set up correctly. A new install gets no
guidance at all: `init_db` silently creates an empty database, and the user is
dropped into an empty catalogue with nothing to suggest a next step.

## What: two screens, one startup

Both screens use the same full-window frame: a plain background (theme tokens,
monochrome by default), the ndisc icon top left, and a centred card. Which card
appears depends on what ndisc finds at startup.

```
startup
  ├─ database file exists and has releases ─→ Startup check
  └─ no database file, or zero releases ────→ Setup
```

### Startup check (existing install)

A checklist that fills in as each check finishes. **If every check passes, the
app opens on its own, with no click.** It stops only when a check fails, then
shows what failed with **Fix** (opens the relevant setup step or dialog) and
**Continue anyway**.

| # | Check | Pass | Fail or warn |
|---|---|---|---|
| 1 | Database opens | the file exists, opens and the schema applies | **fail**: offer Open another database / Create new |
| 2 | Library folder | the configured root exists and can be read | **warn**: e.g. an external drive isn't mounted |
| 3 | Signing key | an nsec is in the keyring and its npub can be derived | **warn**: the catalogue works without one; publishing doesn't |
| 4 | Publishing relay | at least one relay is configured | **warn** |
| 5 | Blossom server | at least one server is configured | **warn** |
| 6 | Catalogue loaded | the release count is read | **fail** only if the read errors |

Only checks 1 and 6 can block the app. Checks 2–5 are warnings: they make the
check pause on its card, but **Continue** is always available.

**The check runs on every launch and stays local.** It reads files, the config
and the keyring and touches no network, so it adds well under a second to the
few seconds the database load already takes (the agreed ceiling is about 15
seconds more, which leaves plenty of room). The one step that can be slow is
the keyring read, if the OS asks to unlock the keyring first.

**Reachability is checked only in Setup, after an upgrade and from Fix.** At a
normal launch, checks 4 and 5 ask only whether something is configured. The
first launch after an upgrade (the app version differs from the last one
seen, stored in `config.json`) also tests each relay and Blossom server, as
does **Fix** on either row. Those tests need a timeout of a few seconds and
must show "unreachable", not hang. An offline launch has to open your
catalogue.

### Setup (new install)

The steps are in this order so that the catalogue comes first and publishing
comes second. Someone who only wants a catalogue can stop after step 3. Every
step after step 1 can be skipped, and Setup can be reopened later from
**Setup…** in the ⋮ menu's settings section.

1. **Database**: **Create new** (at the default path) or **Open existing**
   (e.g. one copied from another machine). *Open existing* switches to the
   Startup check.
2. **Library folder**: pick the root folder of your music. Skippable for a
   catalogue of physical releases only.
3. **Fill the catalogue**: pick any of
   - **Scan the library folder**: the existing *Find new folders* job
     (`reconcileLibrary`). The main route for most people.
   - **Discogs collection CSV**: the existing `importDiscogsCsv`.
   - **Apple Music library XML**: *new importer, see Scope*.
   - **Start empty**.
4. *Publishing (optional)*. A heading with one sentence explaining that the
   next three steps are only needed to publish releases to Nostr.
   1. **Signing key**: paste an nsec. It's stored in the OS keyring and the
      matching npub is shown so you can check it's the right key. One line of
      advice: use a separate keypair for each discography or pseudonym, or their
      release addresses collide. *Create a new keypair* comes later.
   2. **Relay**: **I have a relay** (enter the URL, then test it) /
      **Use nos.lol** / **Later**. See *Relay checks* below. Under **Later**,
      one plain sentence: *You can set up your own relay on a VPS to host a
      web discography.*
   3. **Blossom server**: **I have a server** (enter the URL, then check it) /
      **Not now**. Explain that without one, releases still publish, but there
      is nowhere to host their covers, and that you can run your own Blossom
      server on a VPS.

**No links in 0.7.0.** Guidance is a sentence of plain text. Links to
`docs.nfunc.xyz` come once its DNS and pages are published.
5. **Ready**: the database is created, the chosen jobs run, and the catalogue
   opens.

## Facts in the current code this depends on

- **There is no "no database" state today.** `init_db` (`src-tauri/src/lib.rs`)
  calls `open()`, which creates the file if it's missing. Setup needs a new
  command that reports whether the file at `db_path()` exists (and, if it does,
  how many releases it holds) **before** anything opens it. A database with zero
  releases also counts as new.
- **The database path** comes from `dbPath` in `config.json`, falling back to
  `discography.db` in the app data folder. Debug builds use
  `config.dev.json` and `discography-dev.db`, so trying Setup in `make dev`
  needs a moved or deleted dev database; it never touches the installed one.
- **Relays and Blossom servers live in the webview's localStorage**
  (`ndisc.relays`, the Blossom key), not in `config.json`. Their checks and
  the Setup steps that write them run in the frontend. The Rust side can't see
  them.
- **The relay check would always pass as things stand.** On startup,
  `ensureMinRelays` tops an empty list up to `DEFAULT_RELAYS`
  (`wss://relay.nfunc.xyz`). That relay is whitelist-only, so **a new user
  can't publish to it.** For 0.7.0, the top-up must not count as "configured"
  for a new install. `DEFAULT_RELAYS` itself stays as it is (see *Relay
  checks*).
- **The keyring calls already exist**: `importKeypair(nsec)` stores a key and
  returns the npub, `getNpub()` reads it back, `keyringBackend()` names the
  store in use.
- **The library root calls already exist**: `getLibraryRoot` / `setLibraryRoot`.

## Relay checks

"Reachable" isn't enough: a relay can accept a connection and still refuse your
events. The **I have a relay** test should:

1. Connect over WebSocket (short timeout).
2. Fetch the relay's NIP-11 information document and read
   `limitation.auth_required`, `limitation.restricted_writes` and
   `limitation.payment_required`. If any is true, say that the relay may refuse
   writes from this key.

nping already connects to relays and reads NIP-11, so reuse its approach rather
than writing a new one. An actual test write is out of scope: it would publish
an event.

**The public option is nos.lol, for now.** It doesn't keep old events: on
2026-10-02, nos.lol and relay.primal.net held nothing older than two days for
this key (see the comment on `MIN_RELAYS` in `App.tsx`). The **Use nos.lol**
option has to say so: fine for trying ndisc out, not a home for a whole
catalogue. A relay on a separate domain, meant for permanent public testing, is
planned to replace it; once live, it can also hold a backup copy of our own
discography.

**`DEFAULT_RELAYS` stays `relay.nfunc.xyz`** for existing installs. For a new
install, Setup writes the relay the user picks, and an untouched top-up must
not count as configured in the startup check.

## Scope

**0.7.0:** the Startup check, the Setup flow with the importers that already
exist (library scan, Discogs CSV), the "is there a database" command, the relay
NIP-11 test, and **Setup…** in the ⋮ menu.

**0.7.1:** the Apple Music XML importer. It's a new parser (the library XML is a
plist). Its Setup option shows "coming soon" in 0.7.0. The Music app exports the
file only on macOS and Windows; on Linux the user copies it over.

**Later:** create a keypair in-app; guides for hosting a relay or a Blossom
server; MusicBrainz as a way to fill in release details (open API, no token).

**Not in onboarding:** Spotify and MusicBrainz as link-only sources. A release
keeps **one** Source link (settled 2026-11-09), so these only need ndisc's link
parser to recognise their URLs. That's a separate small change.

## Decisions (2026-11-16)

1. **Help links:** none in 0.7.0. Keep it simple, with one sentence of plain
   text per topic, and no URL until `docs.nfunc.xyz` has DNS and pages.
2. **Public relay:** offer nos.lol for now, with the warning above. A relay on a
   separate domain for permanent public testing comes later and will also back
   up our own discography.
3. **Startup check:** runs on every launch, as long as it stays light (it is
   local only, see above).
4. **Reachability checks:** only in Setup, on the first launch after an
   upgrade, and from **Fix**; never on an ordinary launch.
