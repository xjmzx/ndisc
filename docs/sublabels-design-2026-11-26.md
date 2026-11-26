# Sublabels — parent/child labels (design, 2026-11-26)

**Status:** built on branch `sublabels`. The user chose **option A** (§ 5)
on 2026-11-26: the labels.v1 amendment and ndisc's `publish_labels` are done
(steps 1–2). Not yet published (step 3, the user's), and glmps / nview do
not read `parent` yet (step 4, a later wave).

A label can name another label as its **parent**. Viewing a label in the label
panel shows its sublabels; viewing a sublabel shows its parent; each is one
click from the other. Examples from the catalogue:

| parent | sublabels |
|---|---|
| `fsoldigital.com` | `fsoldigital.environments` |
| `Clone` | `Clone Aqualung Series`, `Clone Basement Series`, `Clone West Coast Series` |
| `Warp Records` | `Warp Artificial Intelligence Series` |

More appear as the discography grows, so the link is **user data**, set and
cleared in the panel — never a hard-coded list, never guessed from the names
(`Clone Records` is not a series of `Clone`; `Warp Records` → `Warp …` is).

## 1. Where the link lives

One nullable column on the existing `labels` table:

```sql
ALTER TABLE labels ADD COLUMN parent TEXT;   -- via ensure_column, like art_file
```

`parent` holds the **parent's label name**, compared the way every other label
lookup in ndisc is (trimmed, case-insensitive — `findMatch`).

Why a name and not a row id:

- `labels` has no stable id. `save_labels` replaces the whole table on every
  edit (positions and rowids churn), and names are not even unique there (the
  rows are what localStorage held).
- Everything else that links to a label already does it by name:
  `releases.label`, the labels.v1 manifest's keys, the art file's stem.
- A parent need not have art, or a `labels` row at all, to be a parent — the
  name only has to be a label the catalogue knows (a `labels` row or a
  release's `label`).

The child carries the link (not the parent a list of children), so a child has
at most one parent by construction and adding a sublabel never rewrites the
parent's row.

A sublabel that has no `labels` row yet gets one when its parent is set — an
entry with an empty image, which is what "Add label" already makes for a label
without art. Empty-image rows are not published (§ 5).

## 2. Shape: one level, no cycles

**One level.** A label is a parent, a sublabel, or neither — never both. Every
real case so far is one level (an imprint or series under a label). Deeper
trees would need a tree UI and a recursive walk in every reader; not worth it
until a real case shows up.

With one level a cycle cannot exist: `A → B → A` would make B both a parent and
a sublabel.

Enforced twice:

- **In the panel:** the parent picker never offers the label itself, a label
  that already has a parent, or anything for a label that has sublabels (it
  shows "has sublabels — a parent label stays top-level" instead).
- **On save (`write_labels`):** the rule is applied to whatever list arrives,
  so a list from anywhere (an older build, a hand-edited import, a rename that
  joins two families) is stored one level deep:
  1. a parent equal to the label's own name is dropped;
  2. **a parent stays top-level:** a label that some other label names as its
     parent has its own parent dropped. (Children win: dropping one link keeps
     a whole family together, where the other order would scatter it.)
  3. a blank parent is stored as NULL.

The rule is a pure function (`normalise_label_parents`) with tests.

## 3. Rename, merge, remove

| action | what happens to the links |
|---|---|
| **rename** a parent `A` → `A'` | every label with `parent = A` gets `parent = A'`. |
| **rename** a sublabel | its own `parent` travels with its row; nothing else changes. |
| **merge** `A` into `B` | `A`'s sublabels become `B`'s (as rename). `B` keeps its own parent; if it had none it takes `A`'s. If that leaves `B` with both a parent and sublabels, the one-level rule drops `B`'s parent. Merging a sublabel into its own parent leaves no self-link. |
| **remove** a parent's `labels` row | the links stay. They name a label, not a row; while releases still carry the name it is still a label. If nothing does, the panel shows the parent as *not found* and offers to clear it. |
| a parent renamed **outside** ndisc (retag) | same as above: a dangling name, shown as *not found*. |

The rename/merge rule in one line: **wherever a label name is rewritten,
rewrite `labels.parent` too.** It is built into the rename/merge action
(0.10.0's `rename_label`): `rename_in_label_list` rewrites every parent that
names `from` to `to`, carries `parent` through a merge as above, and applies
`normalise_label_parents` — all inside `rename_label_conn`'s transaction, so
the list it returns is the list stored. Any future path that rewrites a label
name must do the same.

## 4. In ndisc

- `LabelRow` / `LabelEntry` gain `parent?: string`.
- `src/lib/labelFamily.ts` — pure helpers: `parentOf`, `childrenOf`,
  `canHaveParent`, `parentCandidates`, `setParent`.
- **LabelPanel** (the editor/viewer): under the website line, the label on
  screen shows
  - its parent as `↑ Clone` — a button that opens Clone; or
  - its sublabels as `↓ Clone Aqualung Series · Clone Basement Series …` —
    each a button.

  While the label form is open, a **Parent label** field sets or clears the
  parent (a filtered pick list of eligible labels, `—` for none).
- **LabelviewPanel** (the list): a sublabel row shows a small `↳` before its
  name and its parent in the tooltip; a parent's row tooltip lists its
  sublabels. The list stays flat and keeps its sort — grouping it into a tree
  would fight the A–Z strip and the count filter.
- The publish-dirty fingerprint includes `parent` where one is set (an entry
  without a parent fingerprints exactly as before, so a catalogue with no
  sublabels does not light the publish dot after the upgrade).

## 5. Reaching glmps and nview — the wire question (decided: A)

Labels publish as **one** kind **31238** event (`d = disco-vault:labels`) whose
content is

```json
{ "schemaVersion": "labels.v1",
  "labels": { "Clone": { "image": "https://…" }, … } }
```

`labels.v1` is **unfrozen** — no SHA pin in `schema/`, so a change to it is not
a SHA wave. It is still a coordinated change for the readers to *use*.

### Proposed shape

An optional `parent` string in a label's value object, naming another key of
the same map (or a label that only appears on releases):

```json
"labels": {
  "Clone":                 { "image": "https://…/clone.jpg" },
  "Clone Aqualung Series": { "image": "https://…/aqualung.jpg", "parent": "Clone" },
  "Clone Basement Series": { "parent": "Clone" }
}
```

Plus one relaxation: **`image` becomes optional when `parent` is present**, so a
sublabel without art can still be placed in its family. Readers derive
children by inverting the map; nothing lists children explicitly (one source
of truth, no way for the two directions to disagree).

### Is it back-compatible?

Yes, against the readers as they are today. Checked in the code (2026-11-26):

- `labels.v1.json` already says consumers **MUST tolerate extra fields**
  inside each value object — `parent` is exactly that.
- glmps (`src/lib/nostr.ts` `parseLabelLibrary`, identical in the fizx, upleb
  and nfunc forks) and nview (`src/lib/nostr.ts`, the same function) keep only
  entries whose `image` is a string and copy only `image` out. So an
  extra `parent` is ignored, and an image-less `{ "parent": … }` entry is
  **silently skipped** — no parse failure, no change to what they show.
- `schemaVersion` stays `labels.v1`; a reader that checks it keeps working.

So publishing the new shape breaks no deployed reader; the readers simply
don't show families until they're taught to.

### Options for the user

- **A. Additive amendment to labels.v1 (recommended).** Amend
  `schema/labels.v1.json` (optional `parent`; `image` optional when `parent` is
  set), teach `publish_labels` to send `parent` and to include image-less
  entries that have one, and add `parent` to the publish fingerprint. Then, as
  its own wave, glmps (three forks, lockstep) and nview read it. ndisc can ship
  first; the readers follow when convenient.
- **B. A only for labels with art.** Send `parent` only on entries that
  already have an image; no relaxation of `image`. Smaller change, but an
  art-less sublabel is invisible to readers' families.
- **C. Wait.** Keep sublabels local to ndisc for now.

Not proposed: a separate event or a new kind (the families belong with the
label registry), or a top-level `families` object beside `labels` (readers
ignore it today too, but it splits one fact across two places in one event).

### Steps (A chosen 2026-11-26)

1. ✅ Amend `schema/labels.v1.json` + a line in `schema/README.md` and SUITE.md
   § wire contract.
2. ✅ ndisc: `publish_labels` takes `parent` (`labels_manifest_content`, with
   tests); publishable = has image **or** has parent; fingerprint includes
   parent; the label-art move still only looks at entries with art.
3. Publish the manifest (the user's call, from the panel as now).
4. glmps ×3 + nview: `parseLabelLibrary` keeps `parent`, accepts image-less
   entries that have one, and the release page shows "part of Clone" / the
   label's sublabels. nview mirrors it.
