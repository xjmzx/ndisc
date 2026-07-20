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

## Open questions

- ~~Which key~~ — **decided: content-derived hash.** Still open: the exact
  canonical field set (artist + title, and does `year` belong in it at all — a
  reissue shares the work but not the year), the normalization algorithm
  (case, punctuation, diacritics, articles, feat./&/and, "The"), and which hash
  + truncation. Normalization is the whole ballgame: too loose and *Vol 1* and
  *Vol 2* collapse (a mistake already made once by a throwaway heuristic during
  design); too strict and nothing groups.
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
