# Backlog

Planned ndisc work that is agreed in outline but not started. Each entry says
why, what, and what is still open. Remove an entry when it ships (the
CHANGELOG takes over from there). Suite-level direction stays in
[`SUITE.md` § Direction / roadmap](../SUITE.md); known blind spots of the
existing checks are in [`open-issues-2026-09-22.md`](open-issues-2026-09-22.md).

## Filter: recently added (idea, 2026-11-25)

**Why.** After adding a few releases (3 on 2026-11-24) there is no way to
list just those to check or finish them. Search and the existing filters
don't know when a release came in.

**Data: already there.** `releases.added_at` (Unix seconds, set on insert)
holds a real date for every row. On the live catalogue: 2,020 rows over 48
distinct days. Most are bulk imports (1,404 on 2026-05-10, 234 on
2026-07-08, 45 on 2026-11-05), then a few a day since. So "recent" needs a
window, not "the last import": e.g. the last 7 days, or since a date.
`added_at` is local only, never published. Not yet checked: what a merge
or a re-import does to it.

**Where it goes (the user's idea, not settled).** The filter row is full
(Disc3 medium, Tag label, Music genre, Film A/V, Image link, Link source…).
Proposal: fold the **A/V filter** (has video / audio-only / any) into the
**medium filter** as a third value, so it cycles *physical / digital /
has audio+video / any*, and use the freed slot for **Recent**.

**The freed slot is uncontested (2026-11-28).** Collections were briefly the
other claim on it; they are now a **scope** (opened, like the database path),
not a filter, so they take no slot in this row. See
[`collections-design-2026-11-27.md`](collections-design-2026-11-27.md) § 3.
Recent is the only candidate.

To settle:
- The merge loses a state. Today A/V can select *audio-only* (digital with
  no video); in the merged cycle, *digital* would mean either all digital
  (overlapping with *has A/V*) or digital without video. Decide which, and
  whether anyone filters for audio-only.
- Recent as the same three-state cycle (`FilterButton`): filled = added in
  the last N days, outlined = older? Or a plain toggle. Fixed N (7?) or a
  setting; a "since" date picker is likely overkill.
- Icon (lucide): `CalendarPlus`, `Clock`, `History` or `Sparkles`. It must
  read differently from the refresh icon beside it.
- Optionally also a sort by date added (newest first), which may serve as
  well as a filter.

## Review overlay: docs (R5)

The overlay itself shipped in 0.8.0 (R1–R4: `src/lib/review.tsx`,
`ReviewOverlay.tsx`). Left: **R5, docs**: the README doesn't mention Review,
the covers check or the label art checks yet.

As built, the cover check, upload and save still run in `ReleaseList` (they
share its guard and progress line) and register as `coverActions` while Home
is open; off Home, the Covers tab is read-only. The other maintenance results
(Reconcile, Mirror errors, Relay audit, Tidy names) stay where they are; any
can move into the overlay later.

## Local covers vs Blossom: the size the library is kept to (open)

The full sweep, quality survey and Export list shipped in 0.7.6. One question
is still open: whether the 600 px the library is kept to (and the 400 px
low-res and 2% off-square thresholds) become a setting in ndisc, or stay fixed
numbers shown in the result for the operator to judge.

## Label art: upload a label's local file (stage 3d)

Stages 1–3c and 3e shipped in 0.8.0–0.9.1 (labels in the database, the label
art folder and its matching, local-file checks, Export list, `_labels`). See
the CHANGELOG.

**What.** In Review → Labels, an upload action for a label's local file
(read from `_labels`), the way covers have *Keep disk · upload*: upload to the
primary Blossom server, set the label's image address, republish the 31238
manifest. The export already writes `ndisc:upload` for such labels (43 masters
never published on 2026-11-20), but ndisc has no action that does it; today
the only label upload is the bulk image in the Labels panel.

**Before the first `_labels` fill.** metalheadz and Razors Edge publish one
image, so the plan gives both `metalheadz.jpg`; Razors Edge's published image
is likely wrong. Check it by hand.

## Discogs collection through the API (idea, 2026-11-17)

Setup's Discogs token step (built 2026-11-17, see the onboarding design) checks
the token with `GET /oauth/identity`, which also returns the username. With it,
Setup could import the collection through the API
(`/users/{username}/collection/folders/0/releases`) so a user with a token
needs no CSV export. It covers the same releases without a trip to discogs.com,
but is slow under the 60-requests-a-minute limit for a large collection and
needs a progress line. Open: where the username is kept, if anywhere (config,
not the keyring).

## Ideas, not agreed (recorded 2026-11-17)

Loose thoughts for later, kept here so they aren't lost. None is planned and
none should shape current work.

### Genre interests

Ask the user which genres they care about, at Setup or later, and let that
shape how genres are presented: which come first in the genre picker and
filters, which are grouped or folded away. Not essential to the catalogue, so
it stays optional at most.

### More than one discography

**Superseded 2026-11-27 — see `docs/collections-design-2026-11-27.md`.**
The user settled the key questions that evening (one keypair per machine;
a release may belong to several discographies), and those two answers rule
out a database or a column per discography: with one key, two databases
collide on `disco-vault:<rowid>` and on the single labels manifest. The
design is **collections inside one database**, plus a split of platform
from seller in `source_label`. **Amended 2026-11-28:** a collection is a
*scope* the user opens, not a filter; it can be **publishing-locked** (locked
by default), and a lock never decides what event *kind* its releases publish
as — samples and mixes belong to nsmpl's clip kinds, not 31237. Also corrected
there: the **Apple Music import is already built**. The sketch below is kept
as the record of how the question was first framed.

Keep several discographies side by side instead of one per database. Two kinds
of user in mind:

- a **listener** who wants separate discographies per source (e.g. what they
  own physically vs a streaming library);
- a **music-industry professional or enthusiast** managing an artist, a label
  and its sub-labels.

Sketch: on each import, ask whether the releases go into the current
discography or a new or different one; switch between discographies with a
selector, dropdown or tabs. Undeveloped. Things to settle before it becomes a
plan: whether a discography is a separate database file (works today through
Open / Create database) or a column within one; how it maps to publishing,
given the rule of **one keypair per discography or pseudonym** (otherwise the
`disco-vault:<id>` addresses collide); and whether a release can belong to two.

### Current feed: revisit

The Current view (kind 31239 feed notes) works, but hasn't been looked at
since it was built in June. Checked 2026-11-17: all four notes in the
catalogue are live on relay.nfunc.xyz with the event ids ndisc stored, and no
deletion touches them; they were not lost with relay.fizx.uk. (They looked
unpublished in the **dev** build, which reads its own `-dev` database.)

**What Current is for (the user, 2026-11-17).** It was a first build of
letting an ndisc user publish a Nostr note with a release from the
discography attached; the four live notes are tests of that. The direction is
to build it out into a proper note-publishing format, as either **regular
notes** or **long-form notes**. (Today's notes are kind 31239 under the frozen
`feed.v1` contract; moving to standard note kinds — kind 1 and NIP-23 kind
30023 — would be a contract decision, and glmps and nview read 31239.)

**Drafts.** Drafts stay drafts and don't need to show their image, but a draft
that has an image link should say so, e.g. a small image icon or count on
the card.

**Images on Blossom:** shipped in 0.7.4 (see CHANGELOG). The only
nostr.build files left are ntree/nsmpl's 11 audio clips (the clip.v1 work).

### Current: image gallery and formatted text (recorded 2026-11-17)

**Gallery.** A note can already carry several images: each line of the
editor's *Image URLs* becomes an `image` tag, and `feed.v1` already reads them
as lead + gallery. But no reader shows anything past the first: ndisc's Live
on relays card shows a thumbnail of `images[0]`, glmps's Current page shows
`images[0]` full width. Wanted: show the rest as a gallery, for promotional
images and the different views of a physical release (cover, back, inlays,
disc). Displaying them needs no contract change; it's a glmps change
(`src/pages/Current.tsx`, in both site forks) and optionally ndisc's card.
*Labelling* each view (back, inlay, disc…) would be a contract addition,
e.g. an optional second value on the tag, `["image", url, "back"]`, which
readers that don't know it ignore. Images go to Blossom (0.7.4).

**Formatted text.** Nostr has no formatting of its own: an event's content is
just a string, and what it means is up to the event kind. Regular notes
(kind 1) are plain text by convention; long-form notes (kind 30023, NIP-23)
are Markdown. For kind 31239, `feed.v1` currently says the content is
**plain text**, so headings, bold, lists and links would mean:

1. a contract decision: the content becomes Markdown (wording change and SHA
   bump in `schema/feed.v1.json`, so a coordinated wave with glmps and nview);
2. client-side rendering in every reader (ndisc, glmps, nview) with a Markdown
   renderer and HTML sanitising, and line breaks kept as they are today, so
   the four existing plain-text notes still render the same;
3. general clients would show the raw Markdown characters in their fallback,
   which only shows the title today anyway.

Feasible, and the existing notes survive it. Choose together with the gallery
labels, so `feed.v1` moves once.

**Decided 2026-11-17: `feed.v1` stays as it is.** Gallery and formatting are
directions to explore, not planned work. A later nice-to-have: let the user
choose between publishing as a standard note (kind 1) or a long-form note
(kind 30023). Not now; Current is fine for today's purposes while the
existing features are tested.

### Bandcamp import: no solution yet

Bandcamp is the one store with no standard structured export of a fan's
collection, so there is nothing to import it from the way Discogs (CSV) and
Apple Music (library XML) are imported. ndisc's existing Bandcamp handling only
records provenance (a receipt id and a store URL; see
[`file-data-handling-2026-09-22.md`](file-data-handling-2026-09-22.md)), not
metadata. Today Bandcamp releases come in through the library scan of the
downloaded files. Open: whether any route is worth it (e.g. purchase emails or
the per-account ledgers kept by hand) or this stays scan-only.

## Feasibility and a suggested order (2026-11-17, updated 2026-11-25)

Each line says how big the work is and what it leans on. The order
front-loads small, self-contained work and leaves the one structural change
until last, so nothing built earlier has to be redone.

1.–4b. Done: 0.7.3, the Current feed check and its images on Blossom (0.7.4),
   the cover grid (0.7.5), the covers report, quality survey and Export list
   (0.7.6), and label art stages 1–3e (0.8.0–0.9.1). See the CHANGELOG.
4c. **Label art 3d (upload a label's local file)** and **Review R5 (docs)**.
   Small; finish what 4b started.
4d. **Recently added filter.** Small once the filter-row layout is decided;
   the data (`added_at`) is already there.
5. **Discogs collection through the API.** Medium; builds on 0.7.3's token
   step (the username is already in hand). Needs progress reporting and rate
   limiting at 60 requests a minute.
6. **Genre interests.** Small to medium, and optional. Easier after the grid,
   since it changes how filters present genres in both views.
7. **More than one discography.** Designed 2026-11-27 as *collections in one
   database* — `docs/collections-design-2026-11-27.md`, which replaces the
   framing below and lists its own stages. Originally: large and structural,
   database or column,
   config, keys (one keypair per discography), publishing, and every view.
   Write a design doc first. Anything stored per user before this (genre
   interests, view choices such as the grid layout, kept today under the one
   `ndisc.homeLayout` localStorage key) should be kept where it can later
   become per discography.
8. **Bandcamp import.** No technical route today; stays research until
   Bandcamp offers an export, or another source (purchase emails, the hand-kept
   ledgers) turns out to be good enough.

## Still to test: Discogs CSV import on Windows

A fresh database with a Discogs CSV import has only run against a stand-in
backend, never the real one on Windows. It was meant to happen before 0.7.3;
0.7.3–0.9.2 shipped without it. Run it on the Windows machine with a new
database and a real collection export.
