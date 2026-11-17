# Backlog

Planned ndisc work that is agreed in outline but not started. Each entry says
why, what, and what is still open. Remove an entry when it ships (the
CHANGELOG takes over from there). Suite-level direction stays in
[`SUITE.md` § Direction / roadmap](../SUITE.md); known blind spots of the
existing checks are in [`open-issues-2026-09-22.md`](open-issues-2026-09-22.md).

## Local covers vs Blossom: report what it cannot compare (planned 2026-11-13)

**Why.** The check (0.6.20) compares a published release's cover file with the
image its event points at, by the SHA-256 in the Blossom URL. Two kinds of
published cover fall outside that and are currently skipped without a word.
The 600 px tidy of 2026-11-13 found one of each by hand, not through the app:

- *Glow Stars* (Heather Nova) was published from `i.nostr.build` at 1000×1000
  while the file on disk was already 600×600. Its URL has no Blossom hash, so
  the check skipped it.
- *The First Connect EP* (Konny Kon & Chuck Nubian) is published at 808×808
  and has no file in the library (a physical release), so there was nothing to
  compare.

ncover cannot find either. It only reads the library, and in both cases the
problem is on the published side. Only ndisc knows what is published.

**What.** Two more groups in the check's result, beside "differ" and "same as
published":

1. **Published from elsewhere**: the cover URL is not on the primary Blossom
   server. Show the host, the published size and the local file's size. The fix
   is the per-release upload, or the batch upload, of the local file. Where
   there is no local file, the fix is "Move covers to Blossom".
2. **Published with no local file**: no `cover_art_path`, or it no longer
   resolves. Show the published size (one ranged read, as the sizing pass
   does). Nothing to upload; flag it when it is over the size the library is
   kept to, or not square. Since 0.6.23 every release, physical included, is
   meant to have a folder ("Give every release a folder"), and "Reconcile
   published covers" fills it. So a release still without a local cover is a
   real gap: either its folder lacks an image, or it has no folder yet (16 on
   2026-11-13: 15 physical and one manual digital entry, before 0.6.23 ran).
3. **No cover at all**: no cover URL and no local file (1 on 2026-11-13).

With these, the check doubles as a sweep that every release has a local cover
on disk and a published cover on Blossom, and says which ones do not and why.

Both lists go into the export below.

**Open.** Whether the "size the library is kept to" (600 px today) becomes a
setting in ndisc, or is only shown for the operator to judge.

## Local covers vs Blossom: Export list (planned 2026-11-13)

**Why.** It is the first step of the cover review loop shared with ncover, set
out in [ncover's `docs/backlog.md`](https://github.com/xjmzx/ncover/blob/main/docs/backlog.md).
ndisc says which covers differ from what is published, and ncover reviews and
fixes the files.

**What.** An **Export list** button on the check's result. It writes a text
file with one release folder per line, with further tab-separated columns:
artist — title, disk size, published size, and the group or kind (shrunk,
published copy is larger, different picture, published from elsewhere,
published with no local file). ncover's planned `From a list…` scope reads it.
The key is the release **folder**, as in `published.json`, never a database id,
so ncover stays a reader of what ndisc exports and the file is usable by hand.
Releases with no folder (physical) still get a line, keyed by artist — title,
for the operator. ncover will skip them.

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

### Cover grid view

nview and glmps show the discography as a grid of covers; ndisc only has the
list. Wanted: the same grid as another way to look at Home, using the same
filters and search, with a click opening the release as the list does.

Looks feasible. nview's grid (`src/App.tsx`) already solves the hard part for
a catalogue this size: it renders 60 covers at a time and adds more when a
sentinel scrolls into view (IntersectionObserver), with `loading="lazy"` on
each image. ndisc's `coverImageSrc` already prefers the published URL and
falls back to the local file through the asset protocol. For the grid the
order should probably flip to **local file first** (no network, and the
library copies are kept at 600 px), published URL as the fallback. A grid is
also a quick way to *see* missing or wrong covers, which ties it to the covers
vs Blossom work above. Open: whether it's a toggle on Home or its own view
button; tile size; what a release with no cover shows.

### Current feed: revisit

The Current view (kind 31239 feed notes) works, but hasn't been looked at
since it was built in June. Checked 2026-11-17: all four notes in the
catalogue are live on relay.nfunc.xyz with the event ids ndisc stored, and no
deletion touches them; they were not lost with relay.fizx.uk. (They looked
unpublished in the **dev** build, which reads its own `-dev` database.) Their
images are on `i.nostr.build` and still real (checked by size and content,
since nostr.build answers 200 for any id).

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

**Images on Blossom: built 2026-11-17 (unreleased).** Hosting stays the
user's choice: the editor takes a pasted link from any image host, and an
**Upload to Blossom** button beside it uploads a local file and adds its
address. Existing images move with **Move N images to Blossom** in Current's
header (command `migrate_feed_images_to_blossom`, record in
`feed_image_migrations`); moved notes show as drafts until republished. Drafts
now show an image icon with a count. Background: Covers (2,016 on blossom.nfunc.xyz) and label images (290, moved from
nostr.build 2026-10-06, recorded in `label_image_migrations`) are already
there; the four feed images are the only artwork left on nostr.build. Move
them the way label images were moved (fetch, check, upload, keep the old
address), then republish the four notes, and have the note editor upload to
Blossom instead of taking a nostr.build link.

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
readers that don't know it ignore. Images should go to Blossom (see *Current
feed: revisit*).

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

## Feasibility and a suggested order (2026-11-17)

Reviewed together after 0.7.2. Each line says how big the work is and what it
leans on. The order front-loads small, self-contained work and leaves the one
structural change until last, so nothing built earlier has to be redone.

1. **Release what's on `main`** (footer identity, Discogs token step, Ignored
   folders guard) as 0.7.3.
2. ~~Current feed: confirm the cause.~~ Done 2026-11-17: the notes are live
   on relay.nfunc.xyz; the "unpublished" view was the dev build's own
   database. The user's answers on Current's direction are under
   *Current feed: revisit*. Moving its four images to Blossom is small and
   can go with the covers work (step 4); the note-format work is larger and
   comes after the grid.
3. **Cover grid view.** Medium, front end only, no schema or contract change;
   ports nview's paged grid. Do it before the covers checks, because it makes
   cover problems visible at a glance.
4. **Local covers vs Blossom: report, then Export list.** Medium; already
   planned. The Export list needs ncover's "From a list…" to be useful, so
   the two land together.
5. **Discogs collection through the API.** Medium; builds on 0.7.3's token
   step (the username is already in hand). Needs progress reporting and rate
   limiting at 60 requests a minute.
6. **Genre interests.** Small to medium, and optional. Easier after the grid,
   since it changes how filters present genres in both views.
7. **More than one discography.** Large and structural: database or column,
   config, keys (one keypair per discography), publishing, and every view.
   Write a design doc first. Anything stored per user before this (genre
   interests, view choices) should be kept where it can later become per
   discography.
8. **Bandcamp import.** No technical route today; stays research until
   Bandcamp offers an export, or another source (purchase emails, the hand-kept
   ledgers) turns out to be good enough.

Before tagging 0.7.3 it's still worth running the pending Windows test of a
fresh database with a Discogs CSV import, which has so far only run against a
stand-in backend.
