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
since it was built in June. Its notes all show as not live. Probable cause,
not yet confirmed: the four notes in the catalogue were published between
2026-06-23 and 2026-07-01, when the publishing relay was relay.fizx.uk. That
box was shut down on 2026-11-05, so the notes went with it, while the local
database still records them as published. A republish to relay.nfunc.xyz
would test that. Beyond that, what Current is for now is an open question
(see `schema/current-feed-2026-06-23.md`).

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
2. **Current feed: confirm the cause.** Small. A republish to relay.nfunc.xyz
   either brings the notes back or shows a real fault. Do it early so the
   later feed work starts from a known state.
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
