> ⚠ **HISTORICAL ARTIFACT — not authoritative.** Preserved for context only.
> The contract is now `schema/release.v2.json`; the current end-state is
> summarised in `schema/README.md`. The amendments described in this
> note (v2.1 flatten + v2.1.1 `dub-techno` → `dub`) are already in the
> README + JSON; future catch-ups should be one-off updates against
> the README, not standalone notes.

# glmps catch-up — release.v2 amendments since the initial v2 deploy

**Date:** 2026-06-10
**From:** ndisc (xjmzx)
**To:** glmps (both reader sites)
**Status:** action required — two amendments to land before next mirror

Two amendments have shipped on the ndisc side since you deployed v2 yesterday.
Both are documented in `schema/v2-proposal-glmps-reply.md` (addenda 2 + 3) but
this note distils the full glmps-side catch-up scope into one checklist.

The 18-slug count and overall structure (10 mains + 8 electronic subs)
are unchanged. **One slug renamed**, **one cross-slot invariant dropped** —
that's it. No v3 bump.

---

## Amendment 1 — v2.1 flatten (ndisc 0.1.2-beta.6)

**What changed in the contract:** the `genreInvariants.noParentWithOwnSub`
rule was dropped from `schema/release.v2.json`. All 18 slugs are now pure
peers — `electronic` + `techno` + `dub` in the same event is valid; meaning
composes by stacking slugs.

The `mains` vs `electronicSubs` split in `genreSlugs` stays, but it's now
explicitly a palette grouping only, with no semantic meaning on the wire.

**glmps-side work:**
- [ ] **Re-vendor `release.v2.json`** from `xjmzx/ndisc@main`. New SHA-256
      replaces the prior vendored hash; update `release.v2.json.sha256`.
- [ ] **`lib/genre.ts` `normaliseGenres`** — remove the rule that drops
      `electronic` when an electronic-sub is also present. The other
      normalisations (drop duplicates, drop unknown slugs, drop slot 4+)
      stay exactly as they are.
- [ ] **No other code change needed.** FilterBar's any-slot match,
      ReleaseCard's 3-stop gradient, LabelCycler's primary dot, and
      StatsSummary's primary-only stacked bar all continue to work
      identically — the model is just slightly more permissive about
      which combinations a release can carry.

## Amendment 2 — slug rename `dub-techno` → `dub` (ndisc 0.1.2-beta.8)

**What changed in the contract:** the electronic sub-genre slug
`dub-techno` is renamed to plain `dub`. The compound form was redundant
under the v2.1 flat model — a release that's both dub-y and techno-y can
be tagged `dub` + `techno` together.

Technically a slug rename is v3 territory per the original change policy,
but treated as an in-place v2.1.1 amendment because the rollout was less
than a day old, only one DB row was affected on the ndisc side, and both
ends are coordinated.

**glmps-side work:**
- [ ] **Re-vendor `release.v2.json`** again — the SHA changes once more,
      superseding the amendment-1 vendor. Pin the new hash.
- [ ] **CSS var** `src/index.css`: rename `--c-g-dub-techno` →
      `--c-g-dub`. Triplet value unchanged (`199 93 163`).
- [ ] **Tailwind config**: rename `colors.genre.dub-techno` →
      `colors.genre.dub`.
- [ ] **`lib/genre.ts` slug constants**: swap `dub-techno` for `dub` in
      `GENRE_ELECTRONIC_SUBS` (or wherever the canonical list lives).
- [ ] **`genreLabel`'s slash-display logic stays untouched.** `dub` is
      not compound, and `slug.replace(/-/g, "/")` is idempotent for it.
- [ ] **Transient compat consideration:** any kind:31237 event on a relay
      published prior to ndisc's rename migration may still carry the old
      `dub-techno` slug. Strict-but-recoverable validation (per the v2
      contract) means glmps should treat it as an unknown slug — no chip,
      no colour — until ndisc re-publishes the affected release(s). On
      the ndisc side that's a single release (Africa Hitech "Blen EP")
      that gets manually re-published by the end user; we expect this
      transient state to clear within a day.

---

## Combined ordering

Both amendments touch `release.v2.json`. You can fold them into one
re-vendor + one PR — the latest ndisc main has both applied. Suggested
commit/PR sequence on each glmps repo:

1. Re-vendor `release.v2.json` + update pinned SHA + `check-schema-sync.sh`
   passes against the new canonical
2. CSS var + Tailwind config rename
3. `lib/genre.ts` — slug constant swap + `normaliseGenres` rule removal
4. Verify all four visual surfaces still render (existing tests should
   continue to pass; the cross-family combos that were previously dropped
   by `normaliseGenres` now survive)
5. Mirror across `glmps.fizx.uk` + `glmps.upleb.uk` in lockstep

## Sanity check after deploy

A spot-check on the live preview against a sample event carrying
`["genre", "electronic"]` + `["genre", "techno"]` should now show **both**
chips on the FilterBar facet for that release, instead of `normaliseGenres`
collapsing them to just `techno`. ReleaseCard left-bar should render a
2-stop gradient using `electronic` (slot 0) and `techno` (slot 1) colours.

---

## Open questions back at ndisc

None. Both amendments are unilateral simplifications the end user asked
for; no glmps-side decisions are pending. Reply with any spec clarification
questions if anything in the contract feels ambiguous after re-vendoring.
