# `current` view + feed-note update channel (design note)

> **Status: PROPOSAL / basic spec — NOT canonical, NOT built.** This sketches a
> third top-level view in ndisc — **`current`** — and the publish/poll channel
> it surfaces: owner-authored **feed notes** that point at releases, plus the
> contributor **registry** and per-post **sign-off** that gate a small curated
> feed. It is a **published-contract addition** (new event flow on relays),
> unlike the local-only `sources` note. Origin: the Windows/handoff prototype in
> `~/Downloads/Claude/` (SPEC + `*.mjs` reference scripts). Do not cite as spec
> until the kind-collision decision (§1) is made.

Date: 2026-06-23

---

## What the user asked for

> "We have two views now in the app — main (discogs) and stats. We might expand
> this into three button views: **main, stats, and current** — `current` matches
> to the user-polled JSON update. The update should be in the pipes as a basic
> spec."

So: a third nav button, `current`, sitting beside the existing stats (📈) and
table (▦) toolbar toggles. (Internally the app already carries three view
states — `library | stats | table`; `current` is a **fourth**, or it supersedes
`table` in the user's mental model. See §6.)

`current` is the **publisher-side surface** of a feed channel that the glmps /
ndisc.view viewers **poll** (subscribe to). The "user-polled JSON update" is a
small JSON draft the owner authors (`{id, release, images, links, topics,
body}`); ndisc signs + publishes it as a Nostr event; viewers poll the relays
and render it. ndisc is the publisher (writes), the viewers are pollers (reads).

---

## The channel (from the handoff prototype)

Four event kinds, **all authority rooted in one owner key**
(`npub1j9kztnc…0vxesa`, hex `916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d`):

| Kind  | NIP   | Role                          | Signed by         | `d` namespace        |
|-------|-------|-------------------------------|-------------------|----------------------|
| 31237 | 33    | release (already shipped)     | owner             | `disco-vault:<id>`   |
| **31238 → see §1** | 33 | **feed note** (commentary → release) | owner + contributors | `glmps:<id>` |
| 30000 | 51    | contributor registry (people set) | owner         | `glmps:contributors` |
| 4550  | 72    | per-note sign-off (approval)  | owner             | —                    |
| 5     | 09    | unpublish / revoke            | author/owner      | —                    |

**Feed note** = "a few words + photos pointing at a release." It carries no
copied metadata: a `["a","31237:<ownerhex>:<release-d>"]` tag references the
release, and the viewer hydrates artist/title/year/cover from that 31237. The
draft JSON shape (the polled update):

```json
{
  "id": "0001",
  "release": "31237:916c25cf…:disco-vault:314",
  "title": "Slowdive reissue lands on a grey Tuesday",
  "published_at": null,
  "images": ["https://image.nostr.build/…jpg"],
  "links": ["https://label.example/…"],
  "topics": ["shoegaze", "reissue"],
  "body": "Picked the test pressing up this morning. Sleeve photography mine…"
}
```

Mapped to event tags (per `publish-feed.mjs`): `d=glmps:<id>`, `title`,
`a=<release>`, `published_at`, `image*`, `r*` (links), `t*` (topics, lowercased),
`alt` (NIP-31 fallback); `content = body`.

**Trust gate** the viewers run (`feed-resolve.mjs`): owner notes always show;
contributor notes show only if the author is on the latest owner-signed registry
(30000) **and** — when curated — a matching owner sign-off (4550) exists; dedupe
by `d`, keep latest `created_at`, honour kind:5 deletes.

---

## 1. ⚠ Kind collision — the one decision that gates everything

**ndisc already publishes `kind:31238` as the `labels.v1` manifest**
(`KIND_LABELS`, `src-tauri/src/lib.rs:29`; `schema/labels.v1.json`). The handoff
proposal also assigns `kind:31238` to feed notes. Both are NIP-33 addressable
and deduped by `d`-tag, so at the protocol level they coexist only because their
`d` namespaces differ:

- labels.v1 → `d` = the verbatim label-name string
- feed note → `d` = `glmps:<id>`

But a consumer subscribing `{ kinds:[31238], authors:[OWNER] }` receives **both**
streams interleaved. The prototype's `resolveFeed` / `subscribeFeed` filter on
`{kind, author}` **only** — so they would ingest label manifests as malformed
feed notes (no `glmps:` `d`, no `a` reference, wrong content shape). The
`labels.v1` schema's `changePolicy` would also need to admit a co-tenant.

**Options (pick one before writing the spec into the contract):**

- **(A) Give feed notes a distinct kind** — e.g. `31239`. Cleanest: no `d`
  discrimination needed, subscriptions stay simple, `labels.v1` untouched.
  Costs one new kind constant + viewer subscription line. **Recommended.**
- **(B) Keep 31238, discriminate by `d`-prefix everywhere.** Every reader must
  filter `d.startsWith("glmps:")` for feed notes vs treat the rest as labels.
  Cheaper on paper, but bakes a fragile string convention into three apps and
  the prototype scripts already don't do it. Higher long-term risk.

This is a contract-level call (touches what glmps + ndisc.view subscribe to), so
it belongs to the suite-versioning two-axis process — a new published flow, not
an additive tag. See [[suite-versioning]].

---

## 2. What `current` shows (reconciliation = "matches to")

The view is **the live feed, matched against the local discography** — the same
"coherence with reference to sources" posture as the [[ndisc-sources-model]]
note, applied to the feed:

- **Feed column (live):** poll `{ kinds:[<feed>,30000,4550,5], authors:[OWNER] }`
  on the app's relay set, run the trust gate, render notes newest-first (lead
  image, title, body, topics, links).
- **Match column (local):** each note's `a` reference resolves to a local
  release row (by `d` = `disco-vault:<id>`). Show the matched release inline
  (cover, artist/title/year) — or flag **"references a release not in this DB"**
  / **"references an unpublished release"** (the 31237 it points at isn't live).
- **Drafts (unpublished):** local JSON drafts not yet on relays, listed with a
  **Publish** action (the in-app equivalent of `publish-feed.mjs`, signing with
  the keychain owner key — never an env nsec).
- **Curation strip:** the contributor registry (30000) as an editable people
  set, and a per-contributor-note **Approve / Revoke** (4550 / kind:5) — the
  in-app form of `registry.mjs` + `approve.mjs`.

"Current" therefore means *what is live right now on the public side, and how my
local library lines up with it* — staleness here is "a note points at a release
I edited/unpublished" or "a draft I haven't pushed yet."

---

## 3. Authoring (the "user-polled JSON update")

The polled update is authored in-app, not hand-edited as files (the `.mjs`
scripts are the prototype; ndisc internalises them):

- **New note** from a selected release → prefills `release` with that release's
  address; owner writes `title` + `body`, attaches `images` (upload to
  nostr.build, same path as cover art), `links`, `topics`.
- Drafts persist locally (a `feed_note` table, or reuse the schema-dir
  `feed/drafts/*.json` layout the prototype expects). `published_at` / naddr
  recorded on publish, mirroring the release publish-state model — an edited
  published note drops to "needs republish" (the `mark_unpublished` pattern,
  [[ndisc-batch-edit-view]]).
- **Signing:** keychain owner key, the same signer that publishes 31237. The
  prototype's `GLMPS_NSEC` env path is explicitly the throwaway; production =
  keychain or NIP-46 bunker (matches [[ndisc-mobile]]'s signer story).

---

## 4. Genre `t` on 31237 (carried decision from the handoff SPEC)

The handoff SPEC's main ask of "the ndisc dev" is to **publish Discogs
genre/style as `t` tags on 31237** so first-run genre filtering is relay-side and
free. ndisc already emits a `genre` tag set (release.v2, 0–3 slugs); confirming
whether those double as `#t` filter tags (or adding lowercased `t` mirrors) is a
**release.v2 additive-tag question**, independent of the feed channel but bundled
in the same handoff. Track it with [[feedback-genre-palette]] /
[[reference-glmps-ndisc-spec]]. Not part of `current` itself.

---

## 5. Decisions for the owner (open items)

1. **§1 kind collision** — 31239 (recommended) vs `d`-namespaced 31238.
2. **Curation default** — `requireApproval` on (curated; contributor notes need
   4550) vs off (registry membership alone suffices). Prototype defaults **on**.
3. **`current` vs `table`** — fourth button, or does `current` replace the
   batch-edit table in the top nav (table demoted to a within-view mode)? See §6.
4. **Contributors at all** in v1, or owner-only feed first (registry/sign-off
   deferred, 30000/4550 stubbed)? Owner-only is a smaller first cut.
5. **Drafts storage** — SQLite `feed_note` table vs `feed/drafts/*.json` files.
6. **Genre `t` on 31237** (§4) — fold in now or track separately.

---

## 6. Nav shape

Current toolbar: stats (📈, `LineChart`) + table (▦, `Table2`) toggles, each
flipping `view` between its state and `library`. Adding `current` is a third
`digital`-tone `ToolbarIconButton` toggling a new `"current"` view state
(`App.tsx:249`, `:516`). A feed/megaphone-style glyph (e.g. `Rss` / `Radio` /
`Megaphone` from lucide) fits the "broadcast" semantics and stays inside the
existing cyan stats cluster. The `library | stats | table | current` switch then
renders a `<CurrentView>` in the same full-bleed slot as `StatsView` /
`BatchEditView`.

---

## 7. Build shape (NOT committed)

Strictly a sketch; nothing built until requested, and §1 decided first:

1. Resolve the kind collision (§1) → pin a feed kind + schema (`feed.v1.json`).
2. Read path: in-app `subscribeFeed` + `resolveFeed` (port the two `.mjs`),
   render the feed column.
3. Reconciliation: resolve each `a` → local release; surface match/stale states.
4. Authoring + publish (keychain signer), drafts persistence, publish-state.
5. Curation: registry editor (30000) + approve/revoke (4550) — deferrable per §5.4.

Reference implementation lives at `~/Downloads/Claude/` (`SPEC.md`,
`feed-resolve.mjs`, `publish-feed.mjs`, `registry.mjs`, `approve.mjs`,
`glmps-feed-subscribe.js`, `config.mjs`, `owner-key.mjs`, `template.json`,
`0001-example.json`). Related: [[ndisc-app]], [[ndisc-sources-model]],
[[suite-versioning]], [[ndisc-nostr-relays]], [[ndisc-mobile]].
