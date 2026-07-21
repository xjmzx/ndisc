# Shared "work" identity — master-release key (design note)

> **Status: MECHANISM DECIDED (2026-07-20) — still not canonical.** The
> cross-user "same work" problem is parked here. The **key mechanism is
> decided: a content-derived hash** (option 1 below). The normalization that
> feeds it is *not* settled, and there is no wire change and no code yet. It is
> **additive** to the frozen `release.v2` contract when adopted (a coordinated
> wave), and is the cross-user counterpart to the *local* merge/pairing already
> shipped in ndisc. Do not cite as spec.

Date: 2026-07-19 · mechanism decided 2026-07-20

---

## The problem

A release today is a **personal shelf entry**. Each user publishes their own
`kind:31237` under their own key with a local d-tag
(`disco-vault:<local id>`). So two collectors cataloguing the same album emit
**two different release coordinates**, and a clip's `#a` provenance ref
(`clip.v1`) points at exactly *one* person's entry.

Consequence: `#a` discovery finds "clips of **my** entry of this album," never
"clips of **the work**." There is no identity that means "the same album"
across users — or across media formats (the physical LP entry and the digital
entry are already one *work* to a human, and ndisc merges them **locally**, but
the network can't see that).

## Goal

A shared **master-release key** that any user can attach to their own entry so
the network can group "the same work" across users and media formats —
enabling:

- aggregated discovery ("every entry of this album, whoever catalogued it");
- "clips/samples of **the work**" (not just of one person's entry);
- a home for the physical↔digital "one work, many format facets" idea at the
  wire level, mirroring the local merge.

## The model (invariant)

The key is a **grouping tag you add to each personal entry** — *not* a shared
event, and it changes **nothing** about who signs or where truth lives. Each
user still publishes their own `31237`; every entry additionally carries the
shared key. Aggregation and "clips of the work" become a filter on that key.

This keeps the truth model intact: relays stay the network truth, per-user keys
stay per-user, `release.v2` stays each person's own catalogue.

## Decision (2026-07-20): the content-derived hash

**Option 1.** Every user computes the key independently from the release's own
metadata — no lookup, no network, no third-party coverage gaps, and it works for
the self-released and obscure material that makes up much of the library (which
is exactly where an external database is weakest). It also keeps the suite's
offline-first posture: a grouping key you can always compute is worth more than
a more precise one you often can't.

**The accepted weakness** is fuzziness: variant spellings, punctuation and
edition differences split what should be one key. Mitigation is aggressive
normalization (below) — and, crucially, an MBID can be layered on **later as an
additive strengthener** without invalidating anything, because it would be its
own tag rather than a redefinition of the key. Deciding the hash now does not
foreclose option 2; it just refuses to depend on it.

## Candidate keys (as considered)

1. **Content-derived hash** — deterministic from a normalized
   `(artist, title, year)` tuple (exact canonical field set TBD). No
   dependency; any user computes it independently. Weakness: fuzzy — spelling
   / punctuation / edition variants either collide or split.
2. **MusicBrainz release-group MBID** — authoritative, models editions well,
   already a "work/release-group" concept. Weakness: requires a lookup and has
   coverage gaps (obscure / self-released material).
3. **Hybrid** — MBID when known, content-hash fallback; carry both so a later
   MBID backfill can reconcile hash-keyed entries.

## Normalization (pinned 2026-07-21, calibrated on the ~2,500-release library)

**Field set: `artist` + `title` only. `year` is excluded** — a reissue shares
the work but not the year, so including it would split editions that should
group. Calibration found no same-artist/same-title *distinct* works, so
excluding year introduced no false merges.

**Algorithm** (per field, independently). Deliberately **regex-free and
token-based** so Rust and JS implement it identically — no word-boundary /
regex-dialect divergence. Reference: `src-tauri/src/master_key.rs`; the vectors
below are machine-readable in `schema/master-key.vectors.json`.

1. **NFKD** normalise, then **delete** combining marks (Unicode category `M*`;
   JS `\p{M}`, Rust `unicode_normalization::char::is_combining_mark`). *Delete*,
   not space: `Perälä → perala`, not `pera la`. Also folds `µ → μ` (MICRO SIGN →
   Greek mu). CJK/Cyrillic untouched.
2. **lowercase** (Unicode).
3. `&` and `+` → `" and "` — conjunction variants (`Beats + Pieces` ≡
   `Beats & Pieces` ≡ `Beats and Pieces`). MUST precede step 4, or `&` would be
   dropped as punctuation and never become "and".
4. replace every character that is **not** a Unicode letter (`L*`) or number
   (`N*`) with a space. (ASCII-only `[a-z0-9]` was WRONG — it erased CJK/Cyrillic
   titles to empty and collided them; the category test preserves all scripts.)
5. split on whitespace into tokens.
6. drop any token equal to `feat` / `ft` / `featuring`.
7. if the first remaining token is `the`, drop it.
8. join tokens with a single space.

(This token form was calibrated to match a regex reference on the whole library
bar one oddity — an A/B single `? / The Hologram` — where the token form strips
the leading article after clearing the `? /`. Both are defensible; the token
form is canonical because it is what every implementation runs, so they agree
with each other. Its behaviour is locked by the vectors.)

**Key** = `norm(artist) + "|" + norm(title)`. `"|"` is a safe separator: step 6
guarantees it never appears inside a field. If both fields normalise to empty
(e.g. an all-punctuation title), emit **no key** — a release with no
normalisable content cannot have a meaningful content key and must not group.

**Wire value:** `master:` + lowercase hex of `SHA-256(utf8(key))`, truncated to
**32 hex chars** (128 bits — collision-safe far past any realistic scale). The
hash is not for privacy (the title is already public) — it is a fixed-length,
opaque match token. Emitting the raw `key` instead is a viable alternative
(human-debuggable, one fewer thing to agree on) if that's later preferred.

**Cross-implementation hazard — this is why the test vectors are the contract.**
Normalisation must be byte-identical across ndisc (Rust), glmps/nview (JS), and
any future consumer, or keys silently fail to match. NFKD, the `M*`/`L*`/`N*`
category tests, and SHA-256 all agree across Rust / JS / Python. The one real
divergence risk is **Unicode lowercasing** of exotic cases (Turkish dotted-I,
German ß, Greek final sigma) — vanishingly rare in music metadata, but any impl
must pass the vectors below, not merely "look right".

### Test vectors (input → key) — an implementation is conformant iff it reproduces these

| artist | title | key |
|---|---|---|
| `Coldcut` | `More Beats + Pieces` | `coldcut\|more beats and pieces` |
| `Coldcut` | `More Beats & Pieces` | `coldcut\|more beats and pieces` |
| `Coldcut & Hexstatic` | `Timber` | `coldcut and hexstatic\|timber` |
| `The Orb` | `Auntie Aubrey's Excursions` | `orb\|auntie aubrey s excursions` |
| `Aleksi Perälä` | `Sunshine 1` | `aleksi perala\|sunshine 1` |
| `王磊` | `馨` | `王磊\|馨` |
| `µ-Ziq` | `Urmur Bile Trax Volume 1` | `μ ziq\|urmur bile trax volume 1` |
| `Aphex Twin` | `Windowlicker` | `aphex twin\|windowlicker` |
| `A feat. B` | `T` | `a b\|t` |
| `The The` | `X` | `the\|x` (only the *leading* article drops) |
| `Mark Pritchard` | `? / The Hologram - Single` | `mark pritchard\|hologram single` |
| `X` | `Vol 1` | `x\|vol 1` |
| `X` | `Vol 2` | `x\|vol 2` |  ← MUST differ from `Vol 1` (regression guard)
| `{{{{` | `{{{{` | *(no key — both fields empty)* |

The full set is in `schema/master-key.vectors.json` (with wire `tag`s);
`src-tauri/src/master_key.rs`'s test suite asserts the implementation reproduces
every row, so fixture and code cannot drift.

**Deliberately NOT normalised** (accepted splits — conservative by design, since
a false merge is worse than a missed group, and an MBID strengthener can bridge
these later): word-vs-numeral (`One` ≠ `1`), `Vol.`≠`Volume`, `Pt.`≠`Part`, and
edition qualifiers (`Deluxe`, `Remastered`, `(2019)`) — these split, on purpose.

## Status (2026-07-21)

- ~~Which key~~ → content-derived hash. ~~Field set~~ → artist+title, no year.
  ~~Normalisation~~ → pinned + calibrated on the library. ~~Canonical function +
  shared fixture~~ → **built**: `src-tauri/src/master_key.rs` (pure, tested) and
  `schema/master-key.vectors.json`. Wire form: `master:` + 32-hex SHA-256 (the
  raw-key alternative is noted above but the hash is chosen).
- ~~Cross-implementation coordination test~~ → **DONE (2026-07-21).** The JS port
  landed on all three consumers — `nview`, `glmps.fizx.uk`, `glmps.upleb.uk` each
  carry `src/lib/masterKey.ts` + `masterKey.test.ts` (commit *"feat(master-key):
  JS port of the normalize()/masterKey/masterTag reference"*), each vendoring the
  **byte-identical** `master-key.vectors.json` (`c86fabc7…`) and pinning it. The
  Rust reference and all three JS ports assert against that one shared fixture, so
  no implementation can silently drift. The authority (ndisc) now **also** pins
  the fixture — `schema/master-key.vectors.json.sha256` + the
  `fixture_matches_the_committed_pin` drift-guard test — closing the gap where
  ndisc could have drifted from what the consumers vendored.
- **NOT built — the coordinated wave:** emitting the `master` tag on the
  `kind:31237` release event and having consumers filter on it. That is the
  SHA-pinned-contract change across ndisc + glmps + nview together, done as one
  wave like clip.v1 — deliberately separate from the pure function above. The
  normalization function + its cross-language conformance are settled (above); the
  wave is now purely the wire-emission + filter step, gated on the tag-shape
  decision below.
- **Still open for the wave:** decide the tag name/shape on `31237`.
- Tag form: an `i`-tag (`master:<key>` / NIP-73 external-id style) vs a
  dedicated tag. Additive to SHA-pinned `release.v2` → coordinated wave.
- Does `clip.v1` *also* carry the master key, or do consumers resolve it
  transitively via the referenced `31237`? (Direct = one-hop discovery;
  transitive = no clip.v1 change.)
- Edition granularity: is the key the *work/release-group* (all editions) or
  the *specific edition*? Affects whether physical + digital collapse under one
  key or two.
- Reconciliation across users on a shared key (dedup, conflicting metadata) —
  who wins for display? Likely "each user sees their own; aggregation is a
  union," but state it.

## Scope / non-goals

- **Not** a shared or co-owned event; **not** a change to signing or the
  truth model.
- **Not** urgent — direction while solo; lands when cross-user aggregation is
  actually wanted.

## Related

- `clip-mapping-design-2026-07-17.md` — `clip.v1` provenance (`#a` → release),
  the layer that would consume this key for "clips of the work."
- `sources-design-2026-06-21.md` — release-as-set-of-sources (local
  provenance); this note is its cross-user sibling.
- `terrain-roots-design-2026-06-16.md` — the earlier editions-link idea this
  subsumes at the network level.
- SUITE.md § Direction/roadmap — "Shared 'work' identity across users."
- The shipped **local** analogue: ndisc's physical/digital merge + pairing
  (acquisition-source work).
