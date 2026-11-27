# Backlog

Planned ndisc work that is agreed in outline but not started. Each entry says
why, what, and what is still open. Remove an entry when it ships (the
CHANGELOG takes over from there). Suite-level direction stays in
[`SUITE.md` § Direction / roadmap](../SUITE.md); known blind spots of the
existing checks are in [`open-issues-2026-09-22.md`](open-issues-2026-09-22.md).

## Review overlay for the cover and label checks (agreed 2026-11-20)

**Why.** *Local covers vs Blossom* grew from a summary line into groups,
filters, before/after thumbnails, ticks and Export list, all inside the
release list's column (about 40% of the window), while the right column sat
on an empty Add release form. The label check copied the same spot. Nobody
chose that; it accreted.

**What (agreed).** An **overlay**, the same kind as *Relays & servers* and the
maintenance dialogs (drawn inside ndisc's window over a blurred app; Esc, ×
or a click outside closes it), but nearly window-sized. Not a separate view,
and not an OS window (ndisc opens none).

- **The progress line keeps its place** in the release list while a check
  runs. When it finishes, the summary line ("differ 10 · same as published
  1999 · quality 370 · no cover 1") stays there **and the overlay opens at
  once** with the results.
- Closing the overlay loses nothing: results, ticks and filters stay, and
  the summary line reopens it where it was. Only running the check again
  replaces them.
- Tabs **Covers** and **Labels**, each with its own Run; Export list in the
  overlay's header.
- "Open release" / "Edit label" close it and go to that release or label;
  the summary line brings you back.

**Stages.**

R1–R4 built 2026-11-20 (R3–R4: the inspector column in `ReviewOverlay.tsx`;
cover rows are `CoverInspect`, built where each group's row is drawn).
R1 and R2 built 2026-11-20 (`src/lib/review.tsx`, `ReviewOverlay.tsx`).
As built, R1 lifts the **results** and the label check into the store, but
the cover check, upload and save still run in `ReleaseList` (they share its
guard and progress line) and register themselves as `coverActions` while
Home is open; off Home, the Covers tab shows its results read-only.

1. **R1 — lift the state, no visible change.** The cover check, upload and
   save-to-disk move out of `ReleaseList` into a hook `App` owns, with the
   label check. The one-operation-at-a-time guard covers both sides.
2. **R2 — the overlay.** Opens on completion; the current results component
   (`LocalCoverDetails`) moves into it unchanged; the big block leaves the
   release list; the Labels page keeps only its summary line.
3. **R3 — an inspector.** List on the left, the selected item large on the
   right: disk and published image side by side for a cover, with sizes,
   path and flags, and per-item keep-disk / keep-Blossom / Open release.
4. **R4 — the Labels tab's inspector:** the image, every label using it,
   Edit label.
5. **R5 — docs.**

The other maintenance results (Reconcile, Mirror errors, Relay audit, Tidy
names) stay where they are; any can move into the overlay later.

## Local covers vs Blossom: report what it cannot compare (planned 2026-11-13)

**Built 2026-11-18, unreleased.** The check now sweeps every published
release: besides "differ" and "same" it lists *published from elsewhere*
(tickable upload of the local file), *published with no local file* (sized,
flagged over 600 px or more than 2% off square), and *no cover* (upload when
a file is on disk). The 600 px stays a fixed value shown in the result, not a
setting. On the real catalogue that day: 2,016 of 2,017 compared, 0
elsewhere, 0 without a local file, 1 with no cover (a file on disk never
published).

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

**Built 2026-11-18, unreleased.** **Export list** on the check's result
writes `ndisc-covers-<date>.txt`: no header, one line per release (a release
flagged twice is still one line), tab-separated:

`folder` · `cover file` · `artist — title` · disk `WxH` · published `WxH` ·
format · kinds · actions

`-` marks an empty field. A release with no folder has `artist — title` as its
first column. **cover file** is the exact image the flags are about, so ncover
touches it and not the rest of the folder (inlays, backs). **Kinds**
(comma-separated): `shrunk`, `published-larger`, `different-picture`,
`elsewhere:<host>`, `no-local-file`, `never-published`, `no-cover`, and from
the quality survey `low-res<400`, `over-600`, `png`, `off-square-N%`,
`unreadable`. **Actions** (comma-separated, a fixed vocabulary in run order,
`COVER_ACTIONS` in `src/lib/tauri.ts`): `resource`, `review`, `ncover:square`,
`ncover:cap`, `ncover:convert`, `ndisc:reconcile`, `ndisc:upload`. A cover
marked `resource` gets no ncover action, since re-sourcing replaces it.
ncover's `From a list…` is still to build (ncover's backlog).

**Quality survey, built 2026-11-18, unreleased.** The same check reads every
published release's local cover header and lists those under 400 px long
side, over 600 px, PNG, or more than 2% off square (fixed numbers; a range
setting is later). Real catalogue that day: 382 covers — 112 low-res, 2 over
600, 29 PNG, 254 not square. As actions: 247 `ncover:square`, 112
`resource`, 23 `ncover:convert`, 2 `ncover:cap`. Nothing is changed; fixes are
ncover's.

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

## Label art: the same checks as covers (idea, 2026-11-18)

**Why.** Label art has no local reference. Each label is `{name, imageUrl,
siteUrl}` in the webview's localStorage (`ndisc.labels`), not the database,
and is published whole as the kind 31238 manifest. The covers check, quality
survey and Export list start from a release's local cover file, so they never
see labels. The existing label tools are *Move label art to Blossom* and the
copy in *Mirror covers*.

**Facts, 2026-11-18 (read-only).** 290 labels, all with an image, all on
blossom.nfunc.xyz (277 jpg, 13 png). The label masters
folder (machine-local, 363 files:
349 jpg, 8 png, 4 avif, 1 gif, 1 webp, dotted names like
`Ultra.Records.label.jpg`) matches 244 labels by normalised name; 46 have no
match, some only by spelling (`Red.Rhino.rcords`). **None of the 244 is
byte-identical to its published copy** (re-encoded on the way out), so a
hash comparison would flag them all: for labels compare size and shape, not
hash. The `art_name` recorded in the old `labels.json` export has drifted
(96 still exist).

**Stages.**

1. ~~Survey the published label images~~ — **built 2026-11-20**
   (`check_label_art`, the scan icon in the Labels list). One read per
   distinct image, flagged as covers are, shown in the Labels view rather
   than the release list's cover check. First run, 2026-11-20: 583 labels,
   292 images (280 labels share one 1024 px PNG placeholder); 12 low-res,
   19 over 600 px, 10 PNG, 4 not square, all on blossom.nfunc.xyz, none
   unreadable.
2. ~~Move labels into the database~~ — **built 2026-11-20.** A `labels`
   table (position, name, image_url, site_url; names not unique, as they
   were not in localStorage) and `label_store`, a once-per-database marker.
   `load_labels` takes the localStorage list in on a database's first load
   if the table is empty, and never again; `save_labels` replaces the whole
   list per change, as the app wrote localStorage. localStorage is left as
   a backup and no longer written. The 31238 manifest is unchanged. Labels
   now follow the open database. Checked: the real 583 round-trip
   identical.
3. **A label art folder** (medium). **3a built 2026-11-20:** the folder
   setting (localStorage `ndisc.labelArtFolder`, per machine), name matching
   in three tiers (`match_label_art`; exact words, then without
   Records/Recordings/Music and the folder's misspellings, then without
   spaces), and a hand pick per label (`labels.art_file`, a file name).
   Real folder: 315 of 583 match, 28 of them close, 51 files unused.
   **3b built 2026-11-20:** `check_label_art` takes the folder and returns
   `locals` (one per label with a file: header-read size, format, flags,
   beside its published dims and how many labels share that published
   image) and `noLocal`. Real run: 15 low-res, 14 over 600, 6 PNG, 7 not
   square, 1 other format; 43 masters never published (`publishedNotOwn`: the
   label publishes someone else's image; two names for one label sharing
   their own image don't count); 4 where the published copy is larger
   (43 in 0.8.0, which compared masters with the placeholder). **3c built 2026-11-20** (after 0.8.0):
   `labelListText`, Export list in Review's Local files; flagged labels
   with a file only (a fileless line would ask ncover for the whole
   folder). Real export 76 lines; ncover reads it (with its fix that named
   files ignore the name filter). Still to build: **3d** upload a label's
   local file, and **3e** filling `_labels` (below).

   **`_labels`: one clean label art folder under the library root (agreed
   2026-11-20; built the same day, unreleased:** `label_art_default`,
   `plan_labels_fill`, `run_labels_fill`, the WalkDir skip
   `not_label_art_dir`, and Review → Labels' fill bar. Real plan: 305 copies
   for 315 labels, 17 downloads for 19, nothing for 249. Note for the run:
   metalheadz and Razors Edge publish one image, so both get
   `metalheadz.jpg` — likely a wrong image on Razors Edge.**) Supersedes the 3e first written the same day.

   *Why.* The masters folder in use (`~/Documents/Discogs/…/tjmzx-labels`)
   is a working directory: misspellings (`rcords`, `Reocrds`), variants
   (`label2`, `-out`, `alt`), two names on one file. It stays as it is, as
   a backup. A folder ndisc writes itself can be looked at systematically,
   local against Blossom, from a fresh start.

   *What.*
   - **Location:** `<library root>/_labels` by default — the library root
     is already set per machine and per OS (`libraryRoot` in config), so
     the folder follows on Linux, macOS and Windows with no new setting.
     The 3a folder picker stays as an override. Underscore, not a dot:
     Finder and Explorer hide dot-folders, and these files are meant to be
     seen. `_labels` is a reserved name in the suite.
   - **Scans ignore it explicitly.** ndisc imports only folders with audio,
     so an images-only folder is already not a release, but every library
     walk gets a named skip for `_labels` so that is guaranteed, not
     incidental. nplay and ntree also key on audio; note it for them.
   - **One naming rule:** `<Label name>.<ext>`, Windows-illegal characters
     replaced ("Planet μ / Matador" → "Planet μ - Matador"). ndisc records
     the file name on the label (`art_file`) when it writes one, so every
     match is exact.
   - **Filling it**, reported first, then a confirmed run; never overwrite,
     log every file (label, source, file written):
     1. from the old folder: COPY each label's matched master (name,
        close or hand pick, as 3a finds them), renamed to the rule;
     2. from Blossom: each label that publishes its own image (not the
        placeholder; `publishedNotOwn` false) and has no master yet gets
        it downloaded, checked against the SHA-256 in its address; a
        second name whose sibling has the file is skipped (EMI America →
        EMI). Real count 2026-11-20: 24 such labels;
     3. the rest (placeholder, no master anywhere) listed for a person.
   - **Then** Local files, Not its own image and the Export list all work
     from `_labels`; ncover needs nothing new (its write-back would keep
     originals under `originals/_labels/<file>`). 3d (upload a label's
     local file) reads from `_labels`.
   - **Backup comes free:** microbolt2's rsync mirror of `/data/music`
     carries `_labels`. Original note: A setting, matched by normalised name,
   with a per-label file pick for the misses. Then labels join the quality
   survey and Export list (the `cover file` column lets ncover work on
   single files in a shared folder: several lines in one folder since GTK
   ncover's fix of 2026-11-20; the macOS app has it as Phase F7) and gain an *upload local file* fix.

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
from seller in `source_label`. The sketch below is kept as the record of
how the question was first framed.

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

## Feasibility and a suggested order (2026-11-17)

Reviewed together after 0.7.2. Each line says how big the work is and what it
leans on. The order front-loads small, self-contained work and leaves the one
structural change until last, so nothing built earlier has to be redone.

1.–3. Done: 0.7.3 released; Current feed checked and its images moved to
   Blossom (0.7.4); cover grid view (0.7.5). See the CHANGELOG.
4. **Local covers vs Blossom: report, then Export list.** Medium; already
   planned. The Export list needs ncover's "From a list…" to be useful, so
   the two land together. The grid's Cover wall already shows missing covers
   at a glance.
4b. **Label art: the same checks as covers.** Stage 1 (survey the published
   images) built 2026-11-20; stages 2–3 move labels into the database and
   add a label art folder.
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
0.7.3–0.7.5 shipped without it. Run it on the Windows machine with a new
database and a real collection export.
