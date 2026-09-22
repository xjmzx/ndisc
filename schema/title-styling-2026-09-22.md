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

7. **A needed marker is parenthesised.** When rule 5 or 6 means a format or
   version marker has to stay, it goes in **parentheses**: `Moog Acid (EP)`,
   `Democracy (single)`, `What Time Is Love? (Live At Trancentral)`. A marker
   attached with ` - ` is the Apple Music import shape and is always
   **questioned** — either it should be dropped under rule 3, or kept under
   rule 5 and re-formed as parentheses. `Skeng - Single (Autechre Dub)` became
   `Skeng (Autechre Dub)`; `Split - EP 2` became `Split 2`.

8. **`EP`, not `E.P.`** — one form chosen, no dots. Decided on the catalogue's
   own evidence: 74 titles already used bare `EP` against 6 using `E.P.`. The
   six were normalised on 2026-09-22.

9. **Two names are joined with a spaced solidus, ` / `.** Splits and A/B
   pairings put both names in the field they belong to — both artists in
   `artist`, both sides in `title`: `Kyuss / Wool — Split`,
   `Yunx / Datathief — Split`, `Lunar Passport / Forest Communication`.
   Established by 83 uses against 7 unspaced. An unspaced slash survives only
   where it is a compact **identifier** rather than a separator —
   `dc07/dc08/dc09`, `(Federspiel/Stuebi)` — and that distinction is a
   judgement call, not a rule.

10. **Disk is the reference for casing.** Where the local catalogue and a
   published event differ only in capitalisation or punctuation, the local
   value wins and the event is republished. The local value is what the file
   tags carry, and the files are the personal database of record.

## Year: original release, with a Discogs margin

The catalogue dates a release by its **original release**, not the pressing or
reissue in hand. Two sources disagree in practice — the file tag (often a
reissue's `DATE`, or simply imprecise) and Discogs.

The rule has two halves, and the split is what makes it work:

- **Gap ≤ 2 years → Discogs wins.** A one-year disagreement is not an
  original-versus-reissue distinction; it is an imprecise tag, and Discogs is
  the better source for the same release.
- **Gap > 2 years → the earlier value wins.** That gap means two different
  editions, and the earlier is the original.

Applied on 2026-09-22 to eleven disagreements it produced: `Head Hunters`
1999→1973 and `We Are Reasonable People` 2008→1998 (reissue dates dropped),
`Twoism` kept at 1996 against Discogs' 2013 pressing, and three one-year
disagreements resolved to Discogs (`Stop The Panic` →2000, `Ischemic Folks`
→2000, `Bittersweet Synthphony` →1999) — which were precisely the three a
plain earliest-wins rule had got wrong.

**Caveat on "Discogs".** The comparison above used the value in the *published
event* as a proxy for Discogs, because that is what was to hand: those events
were Discogs-enriched at some point, but the relay is not Discogs and the
proxy could be stale. Every affected row carries a `discogs_id`, so a real
implementation of this rule re-enriches from the Discogs API rather than
trusting the wire. Worth doing before the rule is automated.

## On dashes — there are none

Worth stating plainly, because it is easy to misread: **the catalogue contains
no em dashes and essentially no en dashes.** A survey of every `artist` and
`title` on 2026-09-22 found:

```
128  -  U+002D  HYPHEN-MINUS     (inside names: μ-Ziq, Hi-Fi, D Funk)
 90  /  U+002F  SOLIDUS          (joining two names)
  1  –  U+2013  EN DASH          (Philip Glass – Valentina Lisitsa)
  0  —  U+2014  EM DASH
```

The ` — ` that appears in reports and tooling output is a **display separator
between artist and title**, generated for reading. It is not in the data and
must never be typed into a field.

So the working rule is simpler than the em/en question suggests: **U+002D
inside a name, ` / ` between two names, and nothing else.** The lone en dash is
an inherited artist name, left alone under rule 10.

## Open

- The one unspaced-slash judgement call: is `dc07/dc08/dc09` an identifier
  (leave) or three joined names (space it)? Same question for
  `(Federspiel/Stuebi)`. Left as identifiers for now.

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
