# String identity & normalisation — the two-tier key (design note)

> **Status: PROPOSED (2026-09-22) — not decided, no code, no wire change.**
> **Governing principle: ndisc never rewrites the user's data to suit itself.**
> It does not write tags to files as part of normalisation, and it does not
> silently replace a curated value. Normalisation here builds a *derived key*
> for ndisc's own grouping, search and dedupe. Where a stored value could
> change, it is **offered and applied by the user**, never applied by a
> background pass. This is a **local** concern: no wire change, no tag, no
> coordinated wave. The pinned `master_key::normalize_field` is **not**
> modified; it gains a milder sibling. Do not cite as spec.

Date: 2026-09-22

---

## The problem

Two artist strings that render identically on screen are different bytes, so
every equality test in the suite treats them as different artists:

```
the 11 hand-tagged µ-Ziq albums   µ-Ziq    U+00B5 MICRO SIGN   + U+002D HYPHEN-MINUS
the 1 Discogs-tagged album        μ‐Ziq    U+03BC GREEK MU     + U+2010 HYPHEN
```

Observed 2026-09-22: *Royal Astronomy* appeared under a **second `µ-Ziq` row**
in nplay's artist tree, stranded below `Žagar` because U+03BC sorts past the
Latin block. ndisc has the same split — its flat list merely hides it, the only
tell being *Royal Astronomy* sorting below 2024's *Grush*.

This is not a tagging accident waiting to be cleaned up once. It is structural:

- **macOS `Option+M` emits U+00B5** (micro sign), **not** U+03BC (Greek mu).
  Hand-typed names and Discogs-sourced names therefore disagree *by default*,
  on the platform half the suite is developed on.
- Every import source has its own canonical spelling. Discogs prefers U+03BC
  and U+2010; taggers, filesystems and humans prefer ASCII.
- A rescan does not fix it — the bytes are in the file tags, so a rescan
  faithfully reconstructs the split. (Verified: rescanning both apps changed
  nothing.)

For a personal library this is a curiosity. For ndisc as a **distributable**
app — importing arbitrary discographies in arbitrary languages — it is a
correctness floor.

## The principle this must obey

Three rules, in priority order. Everything below is an application of them.

1. **The files are the user's.** Normalisation never writes tags. ndisc has
   exactly one path that mutates audio files (`write_release_tags`), it is an
   explicit release-scoped action the user invokes, and nothing in this note
   may call it. A library the user imported from elsewhere must come out
   byte-identical unless they asked otherwise.
2. **The curated value is the user's.** A background pass may *detect* that a
   stored value disagrees with something; it may not *replace* it. This is
   already shipped behaviour — see "Precedent" below.
3. **Normalisation is for matching, not for storage.** The derived key decides
   whether two strings mean the same thing. It is not what gets displayed, and
   with one narrow exception (next paragraph) it is not what gets stored.

**The one exception, and why it is not really one.** Tier 0 stores NFC. NFC is
*canonical equivalence*: the composed and decomposed forms of `é` are the same
character by Unicode's own definition, differing only in encoding. Rewriting to
NFC changes no text. Tier 1's folds (NFKC, casefold, dash folding) are
*compatibility* mappings — `µ`→`μ` is a different character, and `Thicc! EP`
casefolded is not the title — so Tier 1 output is **derived only** and must
never be written to a DB column or a file.

If a future change makes normalisation want to edit a stored display string,
that is a feature needing a user-facing decision, not a normalisation detail.

## Precedent: this is already how ndisc behaves

Shipped in 0.2.0-beta.8, after a live incident on 2026-09-22 — a library scan
silently overwrote ten curated titles with the retail strings from the file
tags, and because the refresh path exempted itself from `mark_unpublished`, the
DB diverged from the published `kind:31237` events with nothing in the UI to
show for it (all ten verified against `relay.fizx.uk`, `nos.lol` and
`relay.primal.net`).

The fix is the shape this note assumes throughout:

- the batch scan no longer writes `title` / `artist` / `year`;
- disagreements are collected as `RefreshResult::drift` and reported as a count;
- a review dialog shows *yours* vs *on disk*, and the user picks **use file** or
  **keep mine**;
- "keep mine" is remembered against the *file's current value*, so a later
  genuine retag surfaces again rather than being permanently suppressed;
- the explicit per-release Refresh still trusts the file, because the user
  asked for it (`trust_files = true`).

**Detect → report → the user applies.** Any normalisation feature below adopts
that flow unchanged.

## What the suite does today

Four normalisers, four different answers to the same question. Behaviour on the
observed pair:

| normaliser | site | algorithm | `µ-Ziq` vs `μ‐Ziq` |
|---|---|---|---|
| `normalize_field` | `src-tauri/src/master_key.rs:30` | NFKD, drop marks, lowercase, alnum-only, drop `feat`/leading `the` | **MATCH** |
| `dup_norm` | `src-tauri/src/lib.rs:4320` | lowercase, alnum-only | SPLIT |
| `normaliseName` | `src/components/LabelviewPanel.tsx:28` | trim, lowercase | SPLIT |
| raw `!==` | `nplay/src/components/LibraryTree.tsx:103` | none — strict equality on a raw-sorted list | SPLIT |

Two consequences worth stating plainly:

1. **The wire layer is already correct.** `normalize_field` does NFKD first,
   and NFKD folds U+00B5 → U+03BC; both hyphens are non-alphanumeric and
   become spaces. Both spellings yield `μ ziq`. The pinned conformance vector
   at `master_key.rs:100` uses the micro-sign form and asserts the Greek-mu
   output, so this exact case is *already in the contract*. Were the master tag
   wired, the two entries would publish under one key.
2. **The duplicate finder is not.** `dup_norm` keeps alphanumerics and
   lowercases, but skips Unicode normalisation. U+00B5 is category `Ll`, so it
   survives as itself: `µziq` ≠ `μziq`. ndisc's own "suspected duplicates"
   review would **not** surface this pair.

So the suite already owns the right primitive and simply doesn't use it
consistently — and can't, because the pinned one is too lossy for the job (see
below).

## Goal

One stated rule for "when are two strings the same name", applied at every site
that groups, dedupes, searches or sorts — without flattening names that are
genuinely distinct, and without disturbing the pinned master key.

## The model: two tiers over a normalised ingest

### Tier 0 — ingest normalisation (boundary)

**Text** entering the DB from a tag — title, artist, album, label — is
normalised to **NFC** at the point it is read. **Paths are not.**

That asymmetry is the whole of Tier 0, and getting it backwards breaks things:

- **Text → NFC, stored.** Safe under rule 3 because NFC is *canonical
  equivalence*: it does not change the text, only its encoding. `Perälä` stays
  `Perälä`. Nothing is folded, nothing is lost.
- **Paths → verbatim, never normalised.** A filename on Linux is a byte string
  with **no canonical equivalence at the filesystem layer**. The composed and
  decomposed spellings of a name are two different files as far as `open(2)`
  is concerned. Normalising a stored path yields a path that does not exist.

An earlier draft of this note said "tag values **and** filesystem paths",
which would have broken a real file in the maintainer's library:
`/data/music/Mr. 76ix/3 (Minority of 1)/02 Wöden's Phallus.flac` is stored and
present on disk in NFD, and ndisc opens it correctly today. Rewriting it to
NFC on ingest would have made it unopenable. Measurement caught that; the
principle alone did not.

**Measured state of the library (2026-09-22):**

```
/data/music names                 27,144   of which non-NFC:  1  (that file)
ndisc stored paths                 2,023   failing to resolve: 0
nplay stored paths                19,152   failing to resolve: 0
ndisc text values (artist/title/label)     non-NFC:            0
nplay track titles                         non-NFC:            8
```

So the **path** half of Tier 0 is *latent*, not live: on one platform both
sides hold identical bytes and everything resolves. It becomes real when the
same library is read by ndisc on macOS (APFS hands back decomposed names) or a
DB moves between machines. Worth doing; not urgent.

The **text** half was live and is now fixed in nplay (0.2.x): eight track
titles were stored NFD, so searching for `Começo` as typed — NFC — matched
nothing, while `Come` matched. They also sorted and grouped apart from their
neighbours.

**Where cross-platform path comparison is genuinely needed** — "is this DB row
the same folder the scanner just found?" — compare a *derived* NFC key and
keep opening the file by the stored bytes. Never let the key become the path.

**Search is a third case.** Both sides of a comparison are normalised at
comparison time rather than trusting the stored form, because old rows keep
whatever was ingested and paths are deliberately left alone. nplay does this
in `src/lib/search.ts`.

### Tier 1 — the match key (new)

A **mild, lossless-of-tokens** key for local identity: grouping an artist tree,
finding duplicates, dedupe-on-import, and search.

Per field, in order — deliberately regex-free and token-based, so Rust and JS
implement it identically (same discipline as `normalize_field`):

1. **NFKC** normalise. Folds compatibility variants: U+00B5 → U+03BC, and
   full-width `ＡＢＣ` → `ABC`. (NFKC, not NFC — NFC would leave the micro sign
   and the width variants alone. Not NFKD — Tier 1 keeps composed forms so the
   key stays close to the display string.)
2. **Fold dash-likes to U+002D**: U+2010–U+2015, U+2212, U+00AD → `-`.
3. **Casefold** (not `to_lowercase`) — locale-independent, and handles `ß`→`ss`.
4. **Collapse whitespace** runs to one space; trim.

That is all. **No token dropping, no punctuation stripping.**

**Derived only.** Tier 1 output is a comparison key. It is never stored in a
display column, never shown to the user, and never written to a file. NFKC and
casefold are compatibility folds — `µ`→`μ` is a genuinely different character —
so treating their output as the value would be exactly the silent rewrite rule
2 forbids.

```
'µ-Ziq'  (U+00B5 U+002D)  ->  'μ-ziq'
'μ‐Ziq'  (U+03BC U+2010)  ->  'μ-ziq'      MATCH
```

### Tier 2 — the master key (exists, unchanged)

`master_key::normalize_field` + `master_tag`. Aggressive and deliberately
lossy: strips all punctuation, drops `feat`/`ft`/`featuring` and a leading
`the`. Right for cross-user "same work" identity, pinned by vectors in
`master-key.vectors.json`. **Out of scope here except as the tier above.**

## Why two tiers and not one

Tier 2 cannot be reused for Tier 1's job — it would merge names that are
genuinely different artists:

| input | Tier 2 key | Tier 1 key | verdict |
|---|---|---|---|
| `The The` | `the` | `the the` | Tier 2 collides with any artist named "The …" |
| `A feat. B` | `a b` | `a feat. b` | Tier 2 merges a featuring credit into a duo |
| `Vol.1` / `Vol 1` | `vol 1` / `vol 1` | `vol.1` / `vol 1` | Tier 2 **correctly** merges; Tier 1 splits |

The last row is the honest cost: Tier 1 is milder, so it will miss
punctuation-only variants that Tier 2 catches. That is the intended division —
Tier 1 answers "is this the same *name*", Tier 2 answers "is this the same
*work*". A site that wants the looser answer (duplicate review) may consult
both: group by Tier 1, then offer Tier 2 matches as weaker candidates.

## Proposed vectors (Tier 1)

Pin these the way `master-key.vectors.json` is pinned, mirrored in Rust and JS.
All 14 verified against a reference implementation (see Calibration below):

| artist in | Tier 1 key | note |
|---|---|---|
| `µ-Ziq` | `μ-ziq` | micro sign folds via NFKC |
| `μ‐Ziq` | `μ-ziq` | U+2010 folds to `-` |
| `μ-Ziq` | `μ-ziq` | already canonical |
| `Suns Of Arqa` | `suns of arqa` | case-only |
| `Suns of Arqa` | `suns of arqa` | — |
| `Slag Boom Van Loon` | `slag boom van loon` | case-only |
| `Slag Boom van Loon` | `slag boom van loon` | — |
| `The The` | `the the` | leading `the` **kept** |
| `A feat. B` | `a feat. b` | `feat` **kept** |
| `Philip Glass – Valentina Lisitsa` | `philip glass - valentina lisitsa` | en dash folds |
| `Aleksi Perälä` | `aleksi perälä` | diacritic **kept** (NFKC composes, does not strip) |
| `王磊` | `王磊` | no case, no decomposition — passes through |
| `ススム ヨコタ` | `ススム ヨコタ` | see "the hard limit" |
| `ＡＰＨＥＸ` | `aphex` | full-width folds |

Note `Perälä` deliberately keeps its diacritic — Tier 1 is not mark-stripping.
`perälä` and `perala` stay distinct here and are merged only at Tier 2.

## Calibration (run 2026-09-22 against the live library)

All 14 vectors above verified against a reference implementation. Then applied
to every artist string in both databases — the check that matters is not "does
it merge µ-Ziq" but **"does it merge anything it shouldn't"**:

```
nplay   1033 raw artists      -> 1031 keys    2 merge groups
          'μ-ziq'             <- ['µ-Ziq', 'μ‐Ziq']
          'suns of arqa'      <- ['Suns Of Arqa', 'Suns of Arqa']
        2539 raw artist+title -> 2539 keys    0 merge groups

ndisc    814 raw artists      ->  812 keys    2 merge groups
          'μ-ziq'             <- ['µ-Ziq', 'μ‐Ziq']
          'slag boom van loon'<- ['Slag Boom Van Loon', 'Slag Boom van Loon']
        2040 raw artist+title -> 2040 keys    0 merge groups
```

**Zero false merges.** Every collapse is one an operator would want, and the
artist+title space is untouched — so no two distinct releases become one.

The two case-only pairs are incidental finds, real splits in their own right:
`Suns Of Arqa` splits nplay's tree today, and `Slag Boom van Loon` splits ndisc
*only* — nplay reads `Van` from the file tags on both, so ndisc's *So Soon* row
carries a hand-edited value that has drifted from the file. Tier 1 fixes the
display symptom; the drifted row is a separate data question.

Worth noting what calibration could **not** find: latent splits where only one
spelling exists so far. A sweep for mixed-script names and non-ASCII hyphens
turned up only `Philip Glass – Valentina Lisitsa` (en dash, intentional),
`Thıerrч Gottı` (stylised, intentional) and the Japanese entries. The library
is clean today; the exposure is entirely on **future imports**.

## Where Tier 1 applies

| site | today | change |
|---|---|---|
| `nplay/src/components/LibraryTree.tsx:103` | `last.artist !== a.artist` on a raw-sorted list | compare Tier 1 keys; keep the first-seen raw string for display |
| backend album/release ordering | `ORDER BY artist` (raw) | sort by Tier 1 key so runs are contiguous — **required**, since the grouping loop assumes sorted input |
| `ndisc/src-tauri/src/lib.rs:4320` `dup_norm` | lowercase + alnum | replace with Tier 1 (fixes the missed µ-Ziq pair) |
| `ndisc/src/components/LabelviewPanel.tsx:28` | trim + lowercase | Tier 1 |
| search boxes (ndisc + nplay) | substring on raw | normalise **query and haystack**, so `mu-ziq` / `µ-Ziq` / `μ-Ziq` all hit |
| import / scan dedupe | raw path + tag compare | Tier 0 for paths, Tier 1 for names |

**Storage:** keep the raw string as the display value; compute the key on read,
or persist it in a generated column alongside. Never overwrite the raw string
with its key — display fidelity is the whole point of the tier split.

## Import: offer, never apply

Import is where a distributable app meets someone else's library, and where
the temptation to "tidy up" is strongest. The rule holds: **ndisc proposes, the
user disposes.**

What ndisc may do on import:

- **Match against what is already there.** When an incoming artist's Tier 1 key
  equals an existing artist's, say so: *"`μ‐Ziq` matches your existing `µ-Ziq`
  — use the existing name for this import?"* with **use existing / keep as
  imported / always keep as imported** as the answers. Grouping works either
  way, because grouping is on the key; the question is only which display
  string the user wants to see.
- **Report the shape of what it found** — how many names differ from an
  existing one only by case, dash or compatibility fold. A count with a
  reviewable list, exactly like the drift chip.
- **Offer a one-off normalise pass** the user can run, decline, or undo,
  over the ndisc DB only.

What it may not do:

- Silently rewrite an imported name to match an existing one.
- Touch the imported files, in any way, for any reason.
- Treat a previous "always keep as imported" as revocable by a later automated
  pass.

A user importing a 20,000-release library from another tool should be able to
say "no" once and get their names back verbatim.

## The hard limit: normalisation is not aliasing

No amount of Unicode folding connects `ススム ヨコタ` to `Susumu Yokota`, or a
Cyrillic transliteration to its Latin form. Script variants are an **alias**
problem, and the only durable fix is identity, not string surgery:

- Discogs already models exactly this — a canonical artist plus per-release
  **ANV** (artist name variations). If ndisc imports from Discogs it should
  store the **artist ID**, not only the name string.
- Key on ID where present; fall back to the Tier 1 key where absent.

That ordering subsumes the µ-Ziq case entirely and is the right shape for a
shipped app. It is listed here as direction, not as part of this proposal.

Also explicitly **not** solved by normalisation: `Ъ`-style stylised names
(`Thıerrч Gottı` is in the library and is intentional), and romanisation
choices (`Tchaikovsky` / `Čajkovskij`).

## Rollout

Local-only, so no coordinated wave and no SHA re-pin. Suggested order:

1. **Tier 0, text half** — NFC for tag text at ingest, plus normalising both
   sides of every search comparison. **Done in nplay (2026-09-22)**; ndisc has
   no non-NFC text today but should adopt the same helper so it does not drift
   in from an import.
2. **Tier 0, path half** — a derived NFC key for cross-platform folder
   comparison, with stored paths left byte-exact. Latent; do it before ndisc
   is first run on macOS against a shared library.
3. **Tier 1 in ndisc** — `dup_norm` → Tier 1, label panel, search, backend sort.
   Add vectors + a Rust test mirroring the `master_key` pattern.
4. **Tier 1 in nplay** — grouping and search. Vendor the same vectors.
5. Revisit artist IDs on import as a separate design note.

Nothing here requires a data migration: the keys are derived, so a rebuild of
the grouping is a rescan (or not even that, if the key is computed on read).

## Non-goals

- **Writing tags to the user's files.** Nothing in this note may call
  `write_release_tags`. Not on import, not on scan, not as a "cleanup".
- **Rewriting a stored display string automatically.** Standardising the
  personal library's µ-Ziq on the **Greek mu** is a decision the operator made
  for their own catalogue; it is a manual data-hygiene pass, independent of
  this note, and does not substitute for it.
- Changing `release.v2`, any tag, or the master-key algorithm.
- Cross-user identity — that is Tier 2's job and is already designed.
- Deciding that two names in different scripts are the same artist — see
  "the hard limit".

## Open questions

1. Tier 1 keeps diacritics; should search use a third, mark-stripped variant so
   typing `perala` finds `Perälä`? (Probably yes, search-only.)
2. Should the Tier 1 key be persisted (generated column, indexable) or computed
   on read? Persisting helps `ORDER BY`; computing avoids a migration.
3. Sort order: sort on the Tier 1 key, or on a locale collation of the display
   string? Keys sort deterministically across platforms; locale collation reads
   better to humans. They disagree for non-Latin names.
4. Does nplay vendor Tier 1 from ndisc, or does it live in a small shared crate?
   Today the suite duplicates such helpers by hand.
