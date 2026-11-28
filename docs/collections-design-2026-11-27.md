# Collections — several discographies in one database (design, 2026-11-27)

**Status:** agreed with the user in conversation on 2026-11-27. **Nothing is
built.** This supersedes the backlog's *More than one discography* sketch
(`docs/backlog.md`, § Ideas, not agreed), which assumed a database or a column
per discography — § 2 shows why neither works once the key question is
settled.

**Amended 2026-11-28**, after reading the code and a second conversation.
Three changes, each marked where it lands: a collection is a **scope**, not a
filter (§ 3); a collection can be **publishing-locked**, and that lock never
decides what *kind* its releases publish as (§ 5a); and the **Apple Music
import is already built** (§ 7, § 10), which the first draft had wrong. Still
nothing built of collections themselves.

A **collection** is a named set of releases the user curates, several of which
can exist side by side in one catalogue, with a release free to belong to more
than one. Two kinds of user are in mind:

- a **listener** keeping their sources apart — what they bought on Bandcamp
  against what sits in an Apple Music library;
- an **artist, label or store** managing projects, aliases, sublabel series or
  an artist roster. Management is the idea, and the direction of travel is
  towards music *creation* more than collecting.

The near test case is this Mac: 162 digital releases that are Bandcamp-shaped
for our purposes, plus an Apple Music library on an external drive in Apple's
own encodings. Both are real, both are local, and they are different enough to
exercise the design.

**It is not essential.** Publishing is partly a demonstration — that a
discography can be read back from a website and from an app, and that a label
could show *portions* of one catalogue in different ways. That framing is why
§ 5 matters and why the rest can be built without it.

## 1. Decisions taken (2026-11-27, amended 2026-11-28)

| Question | Decision | What follows |
|---|---|---|
| Is a second collection published? | Yes — but readers are a demonstration, not a requirement | § 5 is wanted, not urgent |
| How many keypairs? | **One per machine.** One identity, one Blossom server, one relay | No per-collection key, no keyring change |
| Separate databases? | **No** | Forced by the two rows above — see § 2 |
| Can a release be in two collections? | **Yes.** Duplicate purchases are real, and physical/digital pairs more so | Junction table, not a column (§ 3) |
| Non-FLAC audio? | **Read-only.** If the file is not FLAC, ndisc does not write tags to it | § 7 |
| Deleting a collection | Retire first, then delete; never cascade to releases | § 3 |
| Subscription libraries | **No.** Streaming subscriptions are not what ndisc is about | § 7 |
| Removable media | Supported if the user insists, never designed for | § 8 |
| How a collection is reached | **Opened, not filtered** — a scope, like the database path (2026-11-28) | § 3 |
| Publishing a collection | **Locked by default**; the lock blocks, never retracts (2026-11-28) | § 5a |
| Samples, mixes, other non-releases | Filed locally yes; published as kind 31237 **no** (2026-11-28) | § 5a |

## 2. Why one database is forced, not merely preferred

The published address of a release is

```
31237:<pubkey>:disco-vault:<release_id>
```

and `release_id` is the **SQLite rowid**. `d` is the only structurally
guaranteed tag in `release.v2`, and the `disco-vault:` prefix is frozen.

With one keypair and two databases, both hold a release with rowid 1, both
publish to `31237:<pk>:disco-vault:1`, and the second silently replaces the
first. The labels manifest is worse: it is a single `disco-vault:labels`
per key, so two catalogues would overwrite each other's label library on every
publish.

So "one keypair" and "separate databases" cannot both hold. Since the keypair
decision is the firm one, the database question answers itself: **one database,
collections inside it**, where every rowid is unique by construction and the
manifest stays coherent.

This also keeps backup simple — one file to copy, one file on Proton.

## 3. The model

A release can be in several collections, so the link is a junction table, not
a column:

```sql
CREATE TABLE collections (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    note      TEXT,
    retired   INTEGER NOT NULL DEFAULT 0,
    position  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE release_collections (
    release_id    INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (release_id, collection_id)
);
```

Notes on the shape:

- **`ON DELETE CASCADE` is on the membership rows only.** Deleting a
  collection removes memberships, never releases. A release that ends up in no
  collection is **unfiled**, which is a real and permanently valid state — the
  162 releases here start that way.
- **Retire before delete.** `retired` hides a collection from pickers and
  filters while leaving its memberships intact, the same shape `gtrack` uses
  for archived/retired repositories. Deleting is then a second, deliberate act.
- **No default collection is created on migration.** Inventing "Bandcamp" for
  162 rows would be a guess; `source_label` already says where they came from
  (§ 4), and the user can file them in bulk from that.
- SQLite has no difficulty here. At 162 releases and 216 KB this is not a
  performance question at any plausible size.

### A collection is a scope — opened, not filtered (amended 2026-11-28)

The first draft called a collection a **filter**. That was wrong, and the
correction matters more than it sounds. There are three distinct kinds of
thing in ndisc, and the draft collapsed two of them:

- a **view** — Home, Stats, Table, Labels, Current: a *way of looking* at the
  catalogue, chosen in the view-switch group;
- a **filter** — lives inside the release list, resets, and answers "which of
  these rows" (medium, label, genre, A/V, cover link, source, source link);
- a **scope** — *which catalogue am I in*. There is exactly one today, and it
  is the database path.

A collection is the third. This is also why separate databases felt right at
first: the user was reaching for a scope, and the database path was the only
scope ndisc had. What § 2 rules out is the *storage*, not the feel.

The user's own test of it (2026-11-28): "Where's my apple music collection,
I'll open it (not filter it), where are my mixes, samples?" The goal is that
collections *feel* independent even though the user knows they are not.

Three things follow, and all three are improvements:

- **It takes no filter slot.** The filter row is full; the backlog's
  *recently added* idea frees exactly one slot by folding A/V into the medium
  cycle, and wanted it for *Recent*. With a collection as a scope the two stop
  competing: **Recent takes the freed slot** (`docs/backlog.md`).
- **The top-bar grammar already has a home for it.** `SUITE.md` § Top-bar
  grammar allows the left/identity group to hang **one app-scoped
  affordance** — the cited example is nplay's music-folder path. ndisc has
  nothing there. A collection chip beside the version chip is exactly that
  kind of control: it states what you are looking at.
- **A scope persists across view switches; a filter cannot.** Open *Mixes* and
  Stats, Table, Labels and Current all stay inside it. That persistence *is*
  the independence, and it falls out of the architecture rather than being
  faked. The centre focal module is ndisc's library-stats readout, so it
  narrows too and the headline counts become that collection's — free, and the
  strongest signal of the lot.

**A view across all of them is still the default**, so the draft's rule
survives intact: nothing is reachable *only* by choosing a collection first.
"All releases" is simply one state of the scope selector, and the state it
starts in.

**Cost, since the user raised storage and overhead.** `list_releases` already
takes all ten filters as optional SQL parameters and filters in the database,
so a scope is one more parameter and the query returns only that collection's
rows. You only ever fetch the open collection, so the *number* of collections
costs nothing at display time. Four call sites thread it through —
`ReleaseList`, `BatchEditView`, `CurrentView`, `ReleaseDetail` — which is also
exactly the list of things that ought to narrow.

**Sellers become collections by one deliberate act.** A user wanting their CPU
Records or Móatún 7 purchases as a thing they open filters by seller once
(§ 4), bulk-files the result, and from then on opens it. Sources describe;
a collection is the decision to present one.

## 4. Source, seller, reference — three facts in two fields

This is independent of collections, smaller, and should be settled first,
because it is what makes the counts honest. Today's catalogue:

| `source_label` | host in `source` | n |
|---|---|---|
| Bandcamp | discogs.com | 62 |
| Bandcamp | bandcamp.com | 47 |
| CPU Records | discogs.com | 29 |
| CPU Records | other | 4 |
| (none) | — | 19 |
| Record Store | discogs.com | 1 |

Two problems are visible in that table:

1. **`source` is not an acquisition link.** 62 of the 109 Bandcamp releases
   point at discogs.com. That field is mostly *where the metadata came from* —
   a reference. It is also the one that reaches the wire (`source` tag,
   emitted only when http(s)).
2. **`source_label` carries two facts.** Bandcamp is a **platform**; CPU
   Records is a **seller** — and CPU Records is itself a Bandcamp shop. So
   those 33 releases are missing from the 109 rather than forming a separate
   channel, and no field records which shop a Bandcamp purchase came from.

Three facts, two fields. The refinement is to name them separately:

- **platform** — Bandcamp, Discogs, Apple Music, a record store, direct;
- **seller** — CPU Records, Móatún 7, the shop's own name on that platform;
- **reference** — the existing `source` URL, renamed in meaning if not in
  column, and left as the thing that reaches readers.

**Most of this already exists in the frontend (read 2026-11-28).**
`src/lib/source.ts` holds `SOURCE_PLATFORMS` — a curated roster with domain,
colour and digital/physical seeds — and per-name overrides live in the
`ndisc.sources` setting. CPU Records is *already* an entry there, annotated
"CPU's own shop (Bandcamp-backed)". So stage 1 is not inventing a concept: it
is giving the platform a column of its own and backfilling it, then letting
`source_label` mean the seller alone. One sign of the conflation is in the
Apple importer, which writes `source_label` as `Apple Music` **or**
`Apple Music (partial)` — a completeness flag riding inside a platform name.

This matters beyond tidiness: a full-label purchase on Bandcamp can be
hundreds of releases from one seller on one platform, and that is a shape the
current single field cannot describe.

### The line between a source and a collection

Worth stating, so this does not collapse into "sources with extra steps":

- A **source** is a *fact* about a release — where it came from. One per
  release, inherent, not chosen.
- A **collection** is a *decision* by the user — curation, and the unit a
  portion of the catalogue is published as. Many per release.

Sources describe; collections present. The label, artist and sublabel-series
cases are all the second kind, which is why sources alone do not reach them.

## 5. The wire: letting a reader see a portion

Today nothing on the wire says which collection a release is in, and
glmps / nview show everything published by the owner key. For the "display
aspects or portions" case, a tag has to carry it.

`release.v2.json` is **frozen, additive-only**, and the precedent is well
worn: `tracks` and `discs` were added as optional tags without bumping the
version, and `labels.v1` took `parent` additively on 2026-11-26. So this is a
normal amendment, not a coordinated wave — older readers ignore an unknown
tag and keep working.

Proposed, to settle when it is built:

- a **repeatable optional tag**, one per collection a release belongs to
  (repeatable because a release can be in two);
- the tag's **name** — `collection` reads plainly; a `t` tag would be
  conventional Nostr but collides with topic/hashtag use;
- the **value** — the collection's name, matched the way label names are
  (trimmed, case-insensitive), rather than a rowid, which `labels` already
  taught us churns;
- **unfiled releases carry nothing**, so the common case adds no bytes;
- whether a reader **groups** by it or merely filters is each reader's choice,
  not the publisher's.

Deliberately out of scope: any change to `d`, which stays
`disco-vault:<release_id>` and frozen.

## 5a. Publishing locks, and what a collection may not decide (2026-11-28)

Collections are not only about commercial releases — the user's framing is
curation, collaboration, sharing media and creating (nsmpl). Two of the
planned test collections, long mixes / radio recordings and audio samples,
are not releases in any ordinary sense. So a collection needs to be able to
say "this is not for publishing", and the user may genuinely want to share a
sample library on the suite's own relay.

Those are two different wants, and keeping them apart is the point of this
section.

### The lock

A `locked` column on `collections`, enforced in **Rust** at the two choke
points — `publish_release` and `publish_ids` — not in the UI, because it is a
safety property and the UI is not where safety lives.

- **Locked by default on creation.** Unfiled releases are unaffected, so the
  162 here behave exactly as they do today; anything deliberately filed is
  also deliberately unlocked. The irreversible failure is an accidental bulk
  publish — retracting events afterwards is the expensive direction — so the
  default goes the safe way.
- **Any locked membership blocks.** A release in two collections, one locked,
  does not publish. Safe composition.
- **A lock never retracts.** It blocks new publishes; it never unpublishes.
  The same principle as § 8's "nothing destructive on absence".
- **It reports rather than hides.** Otherwise a locked collection's
  edited-since-published members sit permanently `stale` with no explanation.
  The publish panel should say "4 stale · publishing locked by Samples".

### What the lock is not

**A collection decides whether its releases publish. It never decides what
*kind* they publish as.**

Kind 31237 means "a release in a discography". `glmps` and `nview` read
everything the owner key publishes at that kind and render it as an album with
artist, title, year, label and catalogue number. Publishing a sample library
there would grow nurture's 1,899-release catalogue with sample packs that
readers draw as albums — a change to what the published catalogue *means*, and
not something a collection flag should be able to cause as a side effect.

The suite already has the right shape. ntree and nsmpl publish audio clips
(the `clip.v1` work), and nurture's event list carries **kind 1063 ×11** —
file metadata. A shared sample library on relay.nfunc.xyz is that: a set of
files with duration, BPM, key and licence, none of which `release.v2` has room
for and none of which it should grow. So "share my samples" is a real and good
goal that belongs to **nsmpl and its own kind**, as a suite conversation on its
own merits — not something that rides in on stage 2.

**Agreed with the user 2026-11-28**, who put it as "your clarity on locking,
and event kinds distinguished IS the way to go."

**If that is ever overruled** and samples go out as 31237, note the knock-on:
the § 5 `collection` tag becomes load-bearing immediately, because readers
would *need* it to keep sample packs out of the release list. Stage 3 would
stop being optional and become a prerequisite.

## 6. Settings scope

Twelve `ndisc.*` keys exist today in one flat namespace. Drawing the line now
costs nothing and avoids migrating them later; two of these arrived this month.

| Scope | Keys |
|---|---|
| Per machine / identity | `relays`, `blossomServers`, `theme`, `forceSetup` |
| Per catalogue | `sources`, `labels`, `labelArtFolder`, `labelSort`, `homeLayout`, `statsPage`, `driftDismissed`, `dupDismissed` |

With one database the per-catalogue set needs no namespacing yet. The rule to
hold is that **nothing new should be keyed per collection** unless it is
genuinely a property of the collection, in which case it belongs in the
`collections` table rather than in localStorage.

## 7. Importing, and the libraries we actually have

Four onboarding shapes, each different:

| Source | State |
|---|---|
| Discogs CSV | Built. Still untested on Windows against a real export (backlog) |
| Bandcamp | Manual today. No export route exists; purchase emails and the ledgers were the noted dead end |
| Apple Music | **Built** — `src-tauri/src/apple_import.rs`; see below (corrected 2026-11-28) |
| A folder of files | Built — the local library import |

**Apple formats need no conversion.** `AUDIO_EXTS` already accepts `m4a`,
`alac` and `aac` alongside `flac`, so that library imports as it stands.

**The Apple Music import is already built — the first draft had this wrong
(read 2026-11-28).** `src-tauri/src/apple_import.rs` is 426 lines: it groups
purchased tracks into albums, derives the format (`AAC 256` / `ALAC`), marks
full against partial, maps Apple genres to `release.v2` slugs where the
meaning matches, and carries a duplicate match key checked against the 2026-11
Apple ledger at 95%. `scan_apple_xml` (a dry run) and `import_apple_xml` are
wired into **both** `LibraryPanel.tsx` and `Startup.tsx`, so it is in
onboarding as well as the running app.

Two consequences, both of which shorten the path:

- It writes **no `file_path` and no `source` URL** — metadata only. So § 8's
  removable drive does **not** stand between this Mac and a second
  collection. The drive only returns if local files or covers are wanted from
  it.
- It stamps `source_label` as `Apple Music` / `Apple Music (partial)`, which
  the existing source filter finds exactly. So filing an Apple library into
  its own collection needs **no importer change at all**: file the existing
  catalogue in bulk from a filter, run the import, then bulk-file the new rows
  from the `Apple Music` filter.

Nothing has imported it here yet: the catalogue is 162 rows with no
`Apple Music` source label, so it is a clean first test.

**Subscription downloads are out, firmly (2026-11-27).** ndisc is about files
the user has, not files they have access to. A streaming subscription's
downloads are not a discography, and no amount of tagging makes them one. If
some future thing wants to report that *n* files, releases or artists form
part of a rented library, it is not this one. The practical rule is narrower
and easier: **do not let subscription detail interfere with files.** An import
that meets such files should pass over them rather than try to describe them.

**Lossless against lossy is a suite question, not an ndisc one.** ntree
already scans both, and the useful goal — telling file types apart and
categorising them — spans the suite rather than this app: how ntree hands
files to nsmpl is worth probing before anything here depends on it, and nplay
straddling libraries in different directories with mixed file types is a high
bar, though a rewarding one if it can be reached. Nothing in this design waits
on it; the read-only rule below holds whatever the answer.

**But it is read-only for tags.** `apply_edits_to_file` is FLAC-only, so
nothing ndisc writes reaches an m4a file. The agreed rule is the simple one:
**if the file is not FLAC, it is read-only.** (Strictly, `m4a` is a container
that may hold AAC *or* ALAC, and ALAC is lossless — but the rule is drawn on
what ndisc can write, not on what the container holds, which keeps it true
whatever is inside.) The UI should say so where edits are offered, rather than
accepting an edit that silently never lands.

## 8. The removable drive

The Apple Music library lives on an external drive. Large libraries on
machines with little internal storage make that a common shape, so it is worth
handling — but **it is something to handle, not something to design for**
(the user, 2026-11-27). Removable media is a tall order and should not shape
the rest of this work.

The obligation is deliberately small: if the user wants it, allow it, and
guarantee one thing only — **nothing destructive on absence** — as gracefully
as can be managed. Onboarding is the better place to meet it, by asking
whether the library sits on removable media and saying plainly that it is not
a good idea.

When the drive is unmounted, every `file_path` for that library stops
resolving at once. Today that would read as damage: the drift check compares
database values against file tags and cannot read the file; the cover checks
would report `no_local` for the lot.

What needs deciding when this is built:

- a collection (or a path root) can be **offline** rather than broken, and
  checks skip it with a plain "not mounted" line instead of hundreds of
  findings;
- offline is **detected**, not declared — if the root is absent, say so;
- nothing destructive ever triggers on absence: no clearing of paths, no
  unpublishing, no bulk edits.

If that proves unworkable the fallback is to move the library to internal
storage, which costs only disk.

## 9. Open questions

0. *Settled 2026-11-28:* how a collection is reached (§ 3, a scope), and
   publishing locks against event kinds (§ 5a).
1. The tag name and value in § 5, and whether readers group or filter.
2. Whether **platform** and **seller** are two columns, or one column plus a
   vocabulary table — and what happens to the 19 releases with neither.
3. Whether a collection can be published as a whole (a manifest of its own,
   like `labels`), or only implied by the tags on its releases.
4. Whether `source` should be renamed on the wire now that its meaning is
   "reference", or left alone because it is frozen and readers rely on it.

## 10. Suggested stages

Each stage is useful on its own and none forces the next.

1. **Source split.** Separate platform from seller; keep `source` as the
   reference URL. Backfill from the existing data (`Bandcamp` → platform
   Bandcamp; `CPU Records` → platform Bandcamp, seller CPU Records). Small,
   local, no contract change, and it makes every count honest.
2. **Collections, local only.** The two tables plus the `locked` column
   (§ 5a), the scope selector in the left group (§ 3), `collection_id`
   threaded through `list_releases` and its four call sites, bulk
   file-from-filter, retire and delete, and the Rust publish guard. Nothing
   published changes.
3. **The wire tag.** Amend `release.v2` additively, emit the tag, publish.
   Readers continue to work untouched.
4. **Readers.** glmps and nview read the tag and offer a portion view. A
   separate wave, at the suite's pace.
5. **Apple Music import.** Already built (§ 7) — so what is left is *running*
   it into its own collection, which stage 2 is enough for. Only local files
   or covers from the drive would need § 8's offline handling.

The order is deliberate: stage 1 pays for itself whatever happens to the rest,
and stage 4 is the only one that needs other repositories.

**Where to start (2026-11-28).** For the near goal — two collections on this
Mac, and developing against Linux's larger library — **stage 2 is the stage
that delivers**, and stage 1 is not a prerequisite for it: the Apple import
already stamps a distinct source label that the existing filter finds. Stage 1
still earns its keep, but on Linux, where sellers (CPU Records, Móatún 7)
outnumber platforms — not on these 162. The test matrix the user has in mind:
this Mac, the current 162 plus Apple Music; Linux, the 1,899 plus long mixes /
radio recordings plus samples; Windows unchanged as the Bandcamp backup.
