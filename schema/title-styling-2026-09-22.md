# Release title & artist styling (house rules)

> **Status: RECORDED 2026-09-22 — the operator's convention, not a wire
> contract.** These rules govern what goes in the `artist` and `title` columns
> of the local catalogue, and therefore in the `artist` / `title` tags of the
> `kind:31237` events emitted from them. They are **not** part of
> `release.v2` and no consumer validates against them. They exist so the
> catalogue reads consistently and so drift is *detectable* — a value that
> breaks a rule is, by definition, wrong.

Date: 2026-09-22

---

## Why these exist

Much of the catalogue was seeded from Apple Music purchases, which style
releases as `Title - EP` and `Title - Single`. Many of those files were later
replaced with Bandcamp or other-platform copies that style differently, or
with Discogs-enriched metadata that carries its own conventions
(`Artist (2)` disambiguators, Title Case everywhere). The result was three
spellings of the same idea living side by side.

These rules pick one. They are also the reason an automated check is possible
at all: see "Enforcement" below.

## The rules

1. **Greek mu, everywhere it appears.** `μ` U+03BC GREEK SMALL LETTER MU — in
   artist names, album titles, and inside track titles and remix credits
   (`Spc-Ch-Pn (μ-Ziq Remix)`). **Never** `µ` U+00B5 MICRO SIGN, which is what
   macOS `Option+M` produces and what Discogs-sourced tags often carry. Pair it
   with an ASCII hyphen-minus U+002D, never U+2010 — a Unicode hyphen is not
   typeable and NFC does not fold it, so it would not be findable by search.

2. **Drop Discogs disambiguators.** `Mikron (3)` → `Mikron`,
   `Jensen Interceptor (2)` → `Jensen Interceptor`. The trailing `(N)` is
   Discogs' internal uniqueness device, not part of the name.

3. **Drop format and edition suffixes.** `- EP`, `- Single`, `- 7"`, `- 10"`,
   `- 12"`, `- Vinyl`, `- LP`, `(Deluxe Edition)`, `(Remastered)`,
   `(2015 Remaster)`. A remaster year is release *metadata*, not part of the
   title.

4. **Unless the format word is part of the actual title.** `Phases EP`,
   `Klangbilder EP`, `Chomp Samba EP` — no separator, the word belongs to the
   name. Rule 3 targets the ` - Suffix` and ` (Suffix)` *appendix* forms only.

5. **Unless dropping it would collide.** Where an artist has both an album and
   a single/EP of the same name, the marker stays because it is the only thing
   telling them apart. This rule is **decidable, not a judgement call**: a
   suffix must stay exactly when the stripped title already exists for that
   artist. Two cases in the catalogue as of 2026-09-22:
   - `Jean-Jacques Perrey & Luke Vibert — Moog Acid - EP` (bare `Moog Acid` exists)
   - `Killing Joke — Democracy (single)` (bare `Democracy` exists)

6. **Keep genuine version markers.** A live, dub, remix, session or alternate
   version is a different recording, and the marker is part of what the release
   *is*: `What Time Is Love? (Live At Trancentral)`, `Peel Session`. Contrast
   with rule 3 — `(Remastered)` is the same recording, differently mastered.

7. **Disk is the reference for casing.** Where the local catalogue and a
   published event differ only in capitalisation or punctuation, the local
   value wins and the event is republished. The local value is what the file
   tags carry, and the files are the personal database of record.

## Open

- **`EP` vs `E.P.`** — no consensus. Evidence as of 2026-09-22: the catalogue
  has **74** titles using bare `EP` and **6** using `E.P.`, two of which
  (`Thicc! E.P.`, `Anti E.P.`) were deliberately set in the 2026-09-16 pass.
  Consistency argues for `EP`; the deliberate edits argue the other way for
  those six. Unresolved.

## Enforcement

Rules 1–5 are mechanically checkable, and rule 5 is why the check is safe to
automate: the collision test derives the exceptions from the catalogue itself
rather than needing a hand-maintained allowlist. Run against the catalogue on
2026-09-22 it found 22 rule-3 violations, 1 rule-2 violation, 0 rule-1
violations, and independently rediscovered both rule-5 exceptions.

Rules 6 and 7 are not checkable and need a person.

**A styling violation in the local catalogue is one problem; a styled local
value that disagrees with the published event is another.** The second is what
went undetected for six days in September 2026 — see the beta.8/beta.9 entries
in `CHANGELOG.md` and the proposed content audit. Both checks are worth having,
and they are different checks.
