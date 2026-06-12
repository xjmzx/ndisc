# glmps → ndisc · proposal: electronic palette → grey (v2.1.3)

**Date:** 2026-06-12
**From:** glmps (jabbanawanga)
**To:** ndisc (xjmzx)
**Scope:** single-palette triplet update — no wire-contract change

## What

Change the `electronic` main slug's palette triplet from the current magenta
to a neutral grey:

```
--c-g-electronic: 255  95 186   →   --c-g-electronic: 140 140 140
```

Slug name stays `electronic` on the wire. The 18-slug set, ordering, and
invariants are all unchanged.

## Why

After a few sessions watching the glmps GenreBar with real library data, the
strong-magenta `electronic` chip dominates the visual field — partly because
it's the catalogue's largest band, partly because the saturated pink reads
louder than every other hue in the palette. The library is electronic-heavy
by nature; the dampening curve in the GenreBar (`k = 0.5`) only does so much.
A neutral grey lets the dominant slug recede so the tail genres' colours can
breathe — and it accurately reflects the "default" or "umbrella" nature of
`electronic` as the catch-all main.

## Why this isn't a wire-contract change

The palette is described in `schema/README.md` under "Shared palette (CSS
vars)" but isn't part of `release.v2.json`. The JSON lists the 18 valid
slugs; the CSS triplets are a "soft" contract — documented for visual
consistency, implemented identically on both ends. So:

- No JSON edit
- No SHA-256 re-pin
- No fixture refresh
- README update only on ndisc; mirror CSS var on glmps and ndisc.view

Treating as a v2.1.3 amendment in the same lineage as v2.1.1 (`dub-techno`
→ `dub`) and v2.1.2 (`classical` → `classical-folk`) — single-point edit,
no chained addenda.

## Open question for ndisc — family coherence

Current rationale in `schema/README.md` under "Design rationale":

> Sub-genres share the electronic magenta hue and vary only in L/S, so the
> parent identity stays readable at a glance.

If `electronic` shifts to grey, the eight electronic subs (`acid`, `breaks`,
`dnb-jungle`, `drone-noise`, `dub`, `electro`, `footwork-trap`, `techno`) no
longer share a hue with their nominal parent. Three ways to handle:

1. **Leave the subs as magenta.** The "family" reading goes away, but the
   subs still form a cohesive visual cluster among themselves, and the
   `mains` vs `electronicSubs` split in `genreSlugs` is already noted as a
   palette grouping rather than a semantic one (v2.1 flatten). **glmps lean.**
2. **Shift subs to a grey-family palette.** Preserves the parent-shared-hue
   rationale, but means redoing eight palette entries for what's a single
   slug recolour. Higher cost; lower visual contrast among the subs.
3. **Drop the "shared family" rationale from README.** Acknowledge that
   palette assignments are independent per slug. Cheapest doc change; most
   honest description of where we end up.

My lean is **1 + 3**: keep the subs' magenta, update the rationale text in
README to reflect that the parent/sub hue link isn't load-bearing now that
the model has flattened semantically.

## Action items

- [ ] **ndisc**: update `schema/README.md` palette block — replace the
      `electronic` entry; mint v2.1.3 heading; bump the rationale text per
      the open-question resolution.
- [ ] **ndisc**: update `src/index.css` / theme tokens to flip
      `--c-g-electronic` to `140 140 140`.
- [ ] **glmps**: mirror `--c-g-electronic` in `src/index.css` across both
      reader sites. Tailwind `colors.genre.electronic` key unchanged.
- [ ] **ndisc.view**: mirror palette CSS var change (if maintained separately).

No glmps code changes beyond the single CSS var. The GenreBar segment, the
LabelCycler dot, the ReleaseCard chip dots, and the release-detail genre
row all read from `rgb(var(--c-g-electronic))` and pick up the new colour
automatically.

## Authoritative reference

Per `schema/README.md`'s "End-state summary" pattern, the README heading
moves to "v2.1.3, 2026-06-12" once this lands. The catch-up trio
(`v2-proposal*.md`, `glmps-catchup-2026-06-10.md`, this note) stays as
historical artefacts; cite the README + JSON going forward.
