# `current` view + feed-note update channel (design note)

> **Status: PROPOSAL / basic spec — NOT canonical, NOT built.** This sketches a
> third top-level view in ndisc — **`current`** — and the publish/poll channel
> it surfaces: owner-authored **feed notes** that point at releases, plus the
> contributor **registry** and per-post **sign-off** that gate a small curated
> feed. It is a **published-contract addition** (new event flow on relays),
> unlike the local-only `sources` note. Origin: the Windows/handoff prototype in
> `~/Downloads/Claude/` (SPEC + `*.mjs` reference scripts).

Date: 2026-06-23 · **kind decision LOCKED 2026-06-23: feed note = `31239`** (§1)

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
| **31239** | 33 | **feed note** (commentary → release) | owner + contributors | `glmps:<id>` |
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

## 1. Kind: feed note = `31239` — DECIDED 2026-06-23

**Decision (owner, sole ndisc authoring authority): feed notes take their own
kind, `31239`.** This was the one gating choice; it is now settled, and the rest
of this note reads against it.

Why it was a choice at all: **ndisc already publishes `kind:31238` as the
`labels.v1` manifest** (`KIND_LABELS`, `src-tauri/src/lib.rs:29`;
`schema/labels.v1.json`), and the handoff prototype reused 31238 for feed notes.
Both are NIP-33 addressable and deduped by `d`-tag, so they would have coexisted
only by `d`-namespace (`<label-name>` vs `glmps:<id>`) — and the prototype's
`resolveFeed` / `subscribeFeed` filter on `{kind, author}` **only**, so a
`{ kinds:[31238], authors:[OWNER] }` subscription would have ingested label
manifests as malformed feed notes. A distinct kind removes that hazard entirely:
no `d`-prefix discrimination, simple per-kind subscriptions, `labels.v1` left
exactly as-is.

**The suite's owner-authored kind map is now:**

| Kind  | Purpose            | Schema            |
|-------|--------------------|-------------------|
| 31237 | release            | `release.v2.json` |
| 31238 | labels.v1 manifest | `labels.v1.json`  |
| 31239 | **feed note**      | `feed.v1.json` (drafted, unfrozen) |

**Consequences to carry through (the prototype scripts hard-code 31238):**
- `config.mjs` / `feed-resolve.mjs` / `publish-feed.mjs` / `glmps-feed-subscribe.js`
  all set `FEED_KIND = 31238` → must become `31239` when ported in-app.
- The viewers (glmps ×2, ndisc.view) add `31239` to their subscription kinds;
  their existing 31238 label handling is untouched.

This is still a contract-level addition (a new published flow the viewers must
learn), so it rides the suite-versioning two-axis process — a coordinated wave,
not an additive-tag bump. See [[suite-versioning]].

---

## 2. What `current` shows (reconciliation = "matches to")

The view is **the live feed, matched against the local discography** — the same
"coherence with reference to sources" posture as the [[ndisc-sources-model]]
note, applied to the feed:

- **Feed column (live):** poll `{ kinds:[31239,30000,4550,5], authors:[OWNER] }`
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

1. ~~**§1 kind**~~ — **DECIDED: feed note = `31239`** (own kind, not 31238). See §1.
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

## 7. Build shape

§1 (kind) decided — `31239`. **Phase 1 SHIPPED in ndisc 2026-06-23** (read +
nav, the shared template); Phases 4–5 still parked.

1. ✓ Kind decided (`31239`, §1). ✓ Schema drafted — `feed.v1.json` (the four
   kinds, tag shapes, trust gate, subscription filters). It stays **unfrozen**
   (mirroring `labels.v1.json`); freeze + SHA-pin only when ndisc ships the
   emitter (Phase 4) and a contract test pins its output to the file.
2. ✓ **Read path (Phase 1, shipped):** `src/lib/feed.ts` (the SHARED template —
   `FEED_KIND=31239`, `parseFeedNote`, `resolveFeed` trust gate; byte-identical
   target for ndisc.view + glmps, like `lib/rating.ts`/`lib/source.ts`) +
   `src/hooks/useFeed.tsx` (nostr-tools `SimplePool` subscription, owner-only
   author filter for now) + `src/components/CurrentView.tsx`.
3. ✓ **Reconciliation (Phase 1, shipped):** each note's `a` → local release via
   `releaseIdFromRef`; surfaces matched / "not in this DB" / "release not
   published". Nav: `current` is a peer 4th toolbar toggle (`Radio` glyph,
   `digital` tone) beside stats + table; `view` union gained `"current"`.
4. ✓ **Authoring + publish (Phase 4, shipped 2026-06-23):** Rust `KIND_FEED=31239`,
   `feed_event` emitter, `feed_notes` table, commands `list/save/delete_feed_draft`
   + `publish_feed_note` / `unpublish_feed_note` (keychain signer, kind:5 delete);
   `save` clears publish-state (edit → needs-republish). Frontend: `tauri.ts`
   `FeedDraft` bindings, `lib/feed.ts` `releaseRef`, `CurrentView` composer +
   drafts list + publish/unpublish actions. `schema_feed_v1` test (7) pins the
   emitter to `feed.v1.json`; 70 Rust tests pass, tsc clean. **⏳ STILL TO DO:
   freeze (`frozen:true`) + create `feed.v1.json.sha256` after a real publish
   round-trip confirms the wire bytes.**
5. ⏳ Curation: registry editor (30000) + approve/revoke (4550) — deferrable
   per §5.4. Phase 1's author filter is owner-only; contributors widen it.
6. ⏳ Propagate the template: copy `lib/feed.ts` byte-identical into ndisc.view
   + glmps×2, wire their existing nostr-tools subs (read-only viewers). Lands on
   the build device per [[reference-glmps-ndisc-spec]] (this machine's clones are
   stale; upleb has no push from here).

Reference implementation lives at `~/Downloads/Claude/` (`SPEC.md`,
`feed-resolve.mjs`, `publish-feed.mjs`, `registry.mjs`, `approve.mjs`,
`glmps-feed-subscribe.js`, `config.mjs`, `owner-key.mjs`, `template.json`,
`0001-example.json`). Related: [[ndisc-app]], [[ndisc-sources-model]],
[[suite-versioning]], [[ndisc-nostr-relays]], [[ndisc-mobile]].
