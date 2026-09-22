# File data across the suite — who touches what, and what is untested

> **Status: SURVEY, 2026-09-22.** Written after a day spent tracing metadata
> that disagreed between file tags, the local catalogue and the relays.
> Everything under "Verified" was checked against this machine's code and
> library; everything under "Unverified" is explicitly *not* known and is
> listed so it can be tested rather than assumed.

---

## Who reads and writes audio tags

**Verified** by reading each app's source on 2026-09-22.

| app | reads tags | writes tags | via |
|---|---|---|---|
| **ndisc** | yes | **yes** — album-level | `lofty`; `write_release_tags` is the single write path |
| **nplay** | yes | **yes** — track-level | `lofty`; per-track edit of `title` / `trackNo` |
| **ntree** | no | no | `ffprobe` only — codec/bitrate facts, never tag text |
| **nsmpl** | no | no | `ffprobe` only |
| nview, ncover, nping, nchat | no | no | — |

Two apps can mutate the user's files, not one. That is worth stating plainly
because the styling rules were written for ndisc.

## Where the styling rules apply — and the gap

The rules in [`schema/title-styling-2026-09-22.md`](../schema/title-styling-2026-09-22.md)
govern **artist and release title**. They are enforced, in practice, at three
points: ndisc's catalogue, ndisc's tag writes, and the published event.

**The gap: nplay's per-track editor is ungoverned.** It writes `TITLE` and
`TRACKNUMBER` straight to the file with no styling check. Track titles carry
the same conventions — this library had four remix credits spelling the artist
with a micro sign (`Spc-Ch-Pn (µ-Ziq Remix)`), fixed on 2026-09-22 — so an edit
there can reintroduce exactly what was cleaned up.

It is also **invisible to the content audit**: track titles are not part of
`kind:31237`, so nothing compares them against anything. The drift chip does
not cover them either, because ndisc never reads track titles.

Nothing is broken today. But of the three checks that now exist — style lint,
tag/DB drift, published-content audit — **none sees a track title**.

## Normalisation, per app

| app | tag text | search | stored paths |
|---|---|---|---|
| ndisc | as written (styling rules applied by hand) | raw substring | verbatim |
| nplay | **NFC on ingest** (0.2.0-beta.6) | NFC both sides | verbatim |
| ntree | — | NFC both sides (0.3.3) | verbatim |
| nsmpl | — | NFC both sides (0.4.0-beta.4) | verbatim |

**Stored paths are never normalised anywhere, deliberately.** A filename on
Linux is a byte string with no canonical equivalence at the filesystem layer;
rewriting one to NFC yields a path that does not exist. This library contains
exactly one genuinely NFD filename, which proves the rule matters.

## Cross-platform — verified

- **Linux** is the primary machine and the **only publisher, by design**, to
  keep the wire simple while the build matures.
- **Windows** has a live ndisc database indexing an **independent library** —
  a different music collection. Paths therefore never cross a platform
  boundary, which is why the normalisation work stopped where it did.
- **macOS** has ndisc installed but **has never been run with a database**.

Measured on the Linux library, 2026-09-22:

```
/data/music names       27,144   non-NFC: 1
ndisc stored paths       2,023   unresolvable: 0
nplay stored paths      19,152   unresolvable: 0
```

## Cross-platform — unverified, and how to test

Listed because they are unknown, not because they are suspected.

1. **macOS decomposition.** HFS+ actively normalised filenames to a variant of
   NFD; APFS is normalisation-*insensitive* but *preserving*. A library copied
   to a Mac may therefore hand back decomposed names.
   **Test:** put a file with a diacritic on an APFS volume, scan with ndisc,
   check whether the stored path round-trips and whether the release resolves.
2. **NTFS case-insensitivity.** `…/Suns Of Arqa/` and `…/Suns of Arqa/` are one
   directory on Windows and two on Linux. A library whose folders differ only
   in case behaves differently per platform, and NFC does nothing for it.
   **Test:** create two case-variant folders on Linux, copy to Windows, scan.
3. **Tag writing on macOS / Windows.** `lofty` is cross-platform, but neither
   ndisc's `write_release_tags` nor nplay's track editor has been exercised
   off Linux. The ID3 Latin-1 limitation found on 2026-09-22 — a Greek mu
   cannot be written to a Latin-1 frame without widening it to UTF-16 — is a
   format property, not a platform one, so it should reproduce everywhere.
   **Test:** write a Greek mu to an ID3v2.4 file on each platform.
4. **Path portability.** Separators and drive letters differ before encoding is
   even reached. Untested because the databases are independent; it only
   becomes real if they are ever reconciled.
5. **Cover art and file discovery** off Linux — case-sensitive `cover.jpg` vs
   `Cover.JPG` matching behaves differently on a case-insensitive volume.

## Enrichment coverage (2026-09-22)

```
catalogue                 2,040 releases
  Discogs-linked            645  (31.6%)
  no external link        1,395  (68.4%)
  physical                  126  — 100% Discogs-linked
  digital                 1,914  —  27% Discogs-linked
  Bandcamp receipt ids        0
```

What being unlinked costs, measured as empty-field rate against linked rows:

| field | empty, linked | empty, unlinked |
|---|---|---|
| `catalog_number` | 9% | **34%** |
| `country` | 1% | **17%** |
| `label` | 0% | 12% |
| `genre_primary` | 8% | 12% |
| `cover_art_url` | 0% | 10% |
| `source` | 0% | **94%** |

**Bandcamp is not a metadata source.** `bandcamp_id` is a purchase receipt,
repurposed from the dead `musicbrainz_id` column, and the CSV import records
provenance — a receipt and a store URL — not metadata. Roughly 60 releases
carry a `*.bandcamp.com` source URL; none carries a receipt id, so that import
has never been run against this database. Discogs is the only enrichment
source ndisc has.

**Caution on bulk enrich.** `enrich_discogs_library(force: true)` rewrites
`format`, `category`, **`label`**, `catalog_number`, `country` and the track /
disc counts on every linked release. It does *not* touch `title`, `artist` or
`year`. Because it rewrites `label`, a force pass would revert local label
styling to Discogs' spelling — `Planet μ` back to `Planet Mu`. Prefer the
targeted path (*Maintenance → Repair pressing strings*, or
`enrich_discogs_library` with an explicit id list).
