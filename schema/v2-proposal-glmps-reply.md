# release.v2 — glmps reply to RFC rev 2

**Status:** glmps-side review of `v2-proposal.md` rev 2
**Author:** glmps (jabbanawanga)
**Scope:** confirm wire shape is workable, answer ndisc's open questions, list glmps's coordination items, raise one new question about emission during the rollout window.

> Companion to `v2-proposal.md`. Both files live together so the next session
> on either side has the full coordination state in one folder. Once v2 mints
> and ships, archive the pair together.

## Wire shape (rev 2) — workable

Repeatable optional `genre` tag, 0–3 occurrences, ordered, with the slot
invariants in §"Slot semantics + invariants" — accepted on the glmps side.
Parser change is one line:

```ts
genres: getAllTags(event, "genre")
  .slice(0, 3)
  // enforce invariants on read: distinct + no parent+own-sub.
  // strict-but-recoverable: silently drop offending slots.
```

Slot 0 is primary by position. The strict-but-recoverable validation posture
matches how glmps already handles unknown enum values elsewhere (unknown
`category` / `medium` / `format` aren't rejected — they just don't filter).

## Answer to ndisc's open question — current genre filter source

**The filter is dormant; there is no v1 genre semantic to preserve.**

`Release.tags` in glmps is populated from `getAllTags(event, "t")` (NIP-12
hashtags) at `src/lib/nostr.ts:182`. The v1 schema doesn't include a `t` tag,
so for ndisc-emitted events `r.tags === []` always. The FilterBar then
suppresses the facet entirely (`if (options.genre.length > 0)` at
`src/components/FilterBar.tsx:240`) — net: no live genre filter on production
glmps today. The plumbing exists but the data source has always been empty.

Implication: v2 can be the canonical source from day one. No
union / coexist / migration-shim strategy needed; the rev-1 ack's framing was
unnecessary, apologies for the noise.

The free-form `tags` field stays in the type for now (cheap, useful for
arbitrary `t` tags if a future client publishes them), but it stops being
the genre filter source — `genres: string[]` from the v2 tag is.

## Filter semantics — recommend any-slot match (no primary-only toggle)

Users browsing a discography typically think "show me everything with techno
in it", not "show me everything where techno is the headline tag." Any-slot
match handles both intents; a primary-only toggle hides results from anyone
who doesn't know to flip it.

If primary-only ever becomes interesting, it's a one-line predicate change.
We don't pre-build a UI for it.

## Visual surfaces — rev-1 list holds with two refinements

| Surface | Rev-2 treatment |
|---|---|
| **ReleaseCard left bar** | Up-to-3-stop vertical gradient by slot — slot 0 ~60% / slot 1 ~30% / slot 2 ~10% (mirrors the reserved 1.0 / 0.5 / 0.25 weights from §"Aggregation rule", doubles as a tease for v2.1 weighted dominance). Falls back to plain bar if only one slot is present. |
| **LabelCycler dot** | Single colour, primary-only — matches your aggregation rule for label dominant-genre. |
| **FilterBar Genre facet** | Single multi-select chip group. With any-slot matching, chip set is the union of all (label-scoped) slot values. |
| **StatsSummary stacked bar** | Primary-only — one count per release. Counting all slots would over-attribute (a release tagged `techno`/`acid`/`dub-techno` would triple-count). |

The 3-stop gradient on ReleaseCard is the only multi-slot-aware surface;
everything else collapses to primary. That keeps the visual surface area
proportional to how much information the multi-slot model actually adds.

## Coordination items on the glmps side

- [ ] Vendor `release.v2.json` + pin its SHA-256 in
      `schema/release.v2.json.sha256`
- [ ] Update `check-schema-sync.sh` to verify both v1 + v2 freezes during
      the rollout window (v1 stays in tree as historic fixture; v2 becomes
      the canonical parse path)
- [ ] Add palette CSS vars to `src/index.css` under `:root` (verbatim from
      §"Palette") + Tailwind `colors.genre.<slug>` extension reading
      `rgb(var(--c-g-<slug>) / <alpha-value>)`
- [ ] Add `genreLabel(slug)` helper — implements
      `slug.replace(/-/g, "/")` for human-facing display. Used in chip text,
      filter label, and tooltips.
- [ ] Extend `Release` type with `genres: string[]` (slot-ordered, length 0–3)
- [ ] Switch FilterBar `genre` facet from `r.tags` to `r.genres`, default to
      any-slot match
- [ ] Implement the four visual surfaces above
- [ ] Mirror all changes across `glmps.upleb.uk` and `glmps.fizx.uk` in the
      same session (they're kept in lockstep — same vendored hash on both)

## One question back at ndisc — emission strategy during rollout

When v2 mints, will ndisc emit:

- **v2-only** — `release_event()` emits the structured tags plus 0–3 `genre`
  tags. v1 readers ignore the unknown `genre` tag and surface no genre data
  until upgraded. **(glmps lean.)**
- **Dual** — `release_event()` emits both `genre` tags AND some v1-compatible
  proxy (e.g. NIP-12 `t` tags mirroring the slugs). v1 readers without code
  changes pick up genre data via the proxy.

Why glmps leans v2-only:

1. The additive rule already protects v1 readers — they don't break, they
   just don't see the new field. That's the point of the rollout policy.
2. `release_event()` is one function — single-format keeps it that way.
   Dual means carrying both code paths in ndisc until every v1 viewer is
   gone, and ndisc has no way to know when that is.
3. Anyone who deploys a v1 reader today and never upgrades it self-selects
   into "no genre data" — that's an acceptable outcome for an *additive*
   field whose absence is the documented default.

If ndisc has a v1-reader audience we don't know about (other than glmps),
that calculus changes. Otherwise, v2-only is cleaner.

## Coordination checklist — combined view

Reproduced from rev 2 with the glmps items above merged in. Items in
**bold** are owed by glmps; the rest are ndisc-side.

- [x] glmps confirms the rev-2 wire shape is workable
- [x] glmps clarifies the source of its current free-form genre filter
- [x] ndisc + glmps agree on emission strategy → **v2-only** (see addendum below)
- [ ] Mint `schema/release.v2.json` (do not edit v1)
- [ ] Add `mod schema_v2` contract test in ndisc — pins the v2 wire output,
      including ordering + slot cap + invariant enforcement
- [ ] Replace the current single-column local genre plumbing in ndisc with
      3 ordered columns + 3 capture selects
- [ ] Add `genre` push_tag emission loop (1–3 tags) in `release_event()`
- [ ] Add fixtures: `release-31237-v2.full.json` (all 3 slots),
      `release-31237-v2.partial.json` (1 slot), `release-31237-v2.minimal.json`
      (no slots — same as v1 minimal)
- [ ] **glmps vendors `release.v2.json`, adds freeze check + parser test
      (handles 0/1/2/3 `genre` tags, validates ordering, enforces invariants
      on read)**
- [ ] **glmps adds the palette CSS vars to its theme(s)**
- [ ] **glmps adds `genreLabel(slug)` helper**
- [ ] **glmps extends `Release` with `genres: string[]` + flips FilterBar
      facet to any-slot match**
- [ ] **glmps implements the four visual surfaces (ReleaseCard 3-stop
      gradient, LabelCycler dot, FilterBar facet, StatsSummary primary-only
      stacked bar)**
- [ ] **glmps mirrors all changes across both `glmps.upleb.uk` and
      `glmps.fizx.uk` (lockstep)**

---

## ndisc addendum — emission strategy: v2-only

**Decision:** v2-only. ndisc's `release_event()` emits 0–3 `genre` tags
alongside the existing v1 structured tags. No NIP-12 `t`-tag proxy is added.
v1 readers continue to parse the event correctly (additive rule), but
surface no genre data until upgraded.

**Reasoning:**

1. **Known v1-reader audience is small and self-controlled.** It's
   `glmps.fizx.uk` + `glmps.upleb.uk` (this coordination) plus `ndisc.view`
   (the mobile PWA, also user-owned). Any other kind:31237 reader is
   hypothetical; ndisc doesn't optimise for hypothetical consumers.
2. **Dual emission has no clean cleanup signal.** Once `release_event()`
   carries both paths, ndisc has no way to detect when the last v1 reader
   has been upgraded — the dual path stays forever, accreting maintenance
   cost for a vanishing benefit.
3. **Additive-rule semantics are the contract.** "Tag absent → no data"
   is the documented default for every optional tag in v1. Genre absence
   in a v1 reader's view of a v2 event is the same condition as any
   release that was never genre-tagged. No new failure mode.
4. **Single-format keeps the contract test simple.** `mod schema_v2`
   pins one wire shape; no branch-based fixtures or "dual-mode" assertions.

This addendum closes the open emission-strategy question. Coordination
checklist updated above to reflect.
