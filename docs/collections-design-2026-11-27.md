# Collections — several discographies in one database (design, 2026-11-27)

**Status:** agreed with the user in conversation on 2026-11-27. **Nothing is
built.** This supersedes the backlog's *More than one discography* sketch
(`docs/backlog.md`, § Ideas, not agreed), which assumed a database or a column
per discography — § 2 shows why neither works once the key question is
settled.

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

## 1. Decisions taken (2026-11-27)

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

### Views across collections

A view across all of them is wanted, so collection is a **filter**, not a mode:
the default view is the whole catalogue, and a collection narrows it, exactly
as the genre and source filters do today. Nothing should be reachable *only*
by choosing a collection first.

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
| Apple Music | `Library.xml` plus a music root. Not built |
| A folder of files | Built — the local library import |

**Apple formats need no conversion.** `AUDIO_EXTS` already accepts `m4a`,
`alac` and `aac` alongside `flac`, so that library imports as it stands.

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
2. **Collections, local only.** The two tables, a picker, bulk file-from-
   filter, retire and delete, and collection as a filter across the catalogue.
   Nothing published changes.
3. **The wire tag.** Amend `release.v2` additively, emit the tag, publish.
   Readers continue to work untouched.
4. **Readers.** glmps and nview read the tag and offer a portion view. A
   separate wave, at the suite's pace.
5. **Apple Music import.** `Library.xml` plus a root, read-only for tags, with
   the offline handling of § 8.

The order is deliberate: stage 1 pays for itself whatever happens to the rest,
and stage 4 is the only one that needs other repositories.
