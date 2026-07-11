// Feed-note channel — the SHARED template across the suite (ndisc / ndisc.view
// / glmps). Keep this file byte-identical everywhere it lives, exactly like
// lib/rating.ts and lib/source.ts: the parse + trust-gate maths must agree
// across publisher and viewers or the curated feed diverges.
//
// Ported from the prototype scripts in the handoff (~/Downloads/Claude/):
// parseFeedNote ← glmps-feed-subscribe.js, resolveFeed ← feed-resolve.mjs.
// Transport (the relay subscription) is per-app and lives OUTSIDE this file;
// these are pure functions over raw nostr-tools events.
//
// Contract: schema/feed.v1.json. Kind decided 2026-06-23 — feed notes are
// kind:31239 (their OWN kind, deliberately NOT 31238, which is labels.v1).

import type { Event as NostrEvent } from "nostr-tools";

export const RELEASE_KIND = 31237; // ndisc release — what a feed note points at
export const FEED_KIND = 31239; // feed note (parallel to ndisc's 31237 release)
export const REGISTRY_KIND = 30000; // NIP-51 people set: who may contribute
export const REGISTRY_D = "glmps:contributors";
export const APPROVAL_KIND = 4550; // NIP-72 post approval: per-note sign-off

// Root of all authority in this channel — the one owner key (see feed.v1.json).
// Viewers pass this to resolveFeed; ndisc passes the signed-in identity, which
// IS this key (the owner is the sole ndisc-authoring authority).
export const OWNER_NPUB =
  "npub1j9kztnc85ednd7ncqhe37ag0evnltn8z6wd84jfqx4ts4gn89gks0vxesa";
export const OWNER_PUBKEY =
  "916c25cf07a65b36fa7805f31f750fcb27f5cce2d39a7ac92035570aa2672a2d";

export type FeedProvenance =
  | "owner"
  | "contributor · signed off"
  | "contributor · trusted";

export interface FeedNote {
  address: string; // 31239:<pubkey>:glmps:<id>
  d: string; // glmps:<id>
  pubkey: string;
  provenance: FeedProvenance;
  title: string;
  release: string | null; // referenced release coordinate (the `a` tag), or null
  publishedAt: number;
  images: string[]; // first = lead, rest = gallery
  links: string[];
  topics: string[];
  body: string;
  createdAt: number;
}

const tag = (ev: NostrEvent, k: string): string | undefined =>
  ev.tags.find((t) => t[0] === k)?.[1];
const all = (ev: NostrEvent, k: string): string[] =>
  ev.tags.filter((t) => t[0] === k).map((t) => t[1]);

/** Turn a raw kind:31239 event into something the UI can render directly. */
export function parseFeedNote(ev: NostrEvent): FeedNote {
  return {
    address: `${FEED_KIND}:${ev.pubkey}:${tag(ev, "d") ?? ""}`,
    d: tag(ev, "d") ?? "",
    pubkey: ev.pubkey,
    provenance: "owner",
    title: tag(ev, "title") ?? "",
    release: tag(ev, "a") ?? null,
    publishedAt: Number(tag(ev, "published_at") ?? ev.created_at),
    images: all(ev, "image"),
    links: all(ev, "r"),
    topics: all(ev, "t"),
    body: ev.content,
    createdAt: ev.created_at,
  };
}

/**
 * The trust gate viewers run over the raw event stream. Owner notes always
 * show. Contributor notes show only if the author is on the latest owner-signed
 * registry (NIP-51 kind:30000) AND — when requireApproval — an owner-signed
 * approval (kind:4550) exists for the note address. All authority keys on the
 * owner pubkey. Dedupe by address keeping latest created_at; honour kind:5.
 */
export function resolveFeed(
  events: NostrEvent[],
  ownerPubkey: string,
  { requireApproval = true }: { requireApproval?: boolean } = {},
): FeedNote[] {
  // Latest owner-signed registry → allowed contributor pubkeys.
  const registry = events
    .filter(
      (e) =>
        e.kind === REGISTRY_KIND &&
        e.pubkey === ownerPubkey &&
        tag(e, "d") === REGISTRY_D,
    )
    .sort((a, b) => b.created_at - a.created_at)[0];
  const allowed = new Set<string>(registry ? all(registry, "p") : []);

  // Owner-signed approvals → set of approved note addresses.
  const approved = new Set<string>(
    events
      .filter((e) => e.kind === APPROVAL_KIND && e.pubkey === ownerPubkey)
      .map((e) => tag(e, "a"))
      .filter((a): a is string => Boolean(a)),
  );

  // kind:5 deletions referencing a feed-note address (NIP-09 `a` tags). Keyed
  // by address -> newest deletion timestamp, NOT a bare set: the address is
  // reused whenever a note is republished, so a deletion may only kill events
  // created at or before it. Treating it as a permanent tombstone means a
  // note that is ever deleted can never be published again.
  const deletedAt = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 5) continue;
    for (const t of e.tags) {
      if (t[0] === "a" && t[1]?.startsWith(`${FEED_KIND}:`)) {
        const prev = deletedAt.get(t[1]);
        if (prev === undefined || e.created_at > prev) {
          deletedAt.set(t[1], e.created_at);
        }
      }
    }
  }

  const byAddr = new Map<string, FeedNote>();
  for (const ev of events) {
    if (ev.kind !== FEED_KIND) continue;
    const address = `${FEED_KIND}:${ev.pubkey}:${tag(ev, "d") ?? ""}`;
    const killedAt = deletedAt.get(address);
    if (killedAt !== undefined && ev.created_at <= killedAt) continue;
    const isOwner = ev.pubkey === ownerPubkey;

    let provenance: FeedProvenance;
    if (isOwner) provenance = "owner";
    else if (!allowed.has(ev.pubkey)) continue; // not registered
    else if (requireApproval && !approved.has(address)) continue; // registered, not signed off
    else provenance = requireApproval ? "contributor · signed off" : "contributor · trusted";

    const note = { ...parseFeedNote(ev), provenance };
    const prev = byAddr.get(address);
    if (!prev || ev.created_at > prev.createdAt) byAddr.set(address, note);
  }
  return [...byAddr.values()].sort((a, b) => b.publishedAt - a.publishedAt);
}

/** Build the `a` coordinate a feed note uses to reference a release. */
export function releaseRef(ownerHex: string, releaseId: number): string {
  return `${RELEASE_KIND}:${ownerHex}:disco-vault:${releaseId}`;
}

/** release id from a feed note's `a` reference, e.g. "31237:<hex>:disco-vault:314" → 314. */
export function releaseIdFromRef(ref: string | null): number | null {
  if (!ref) return null;
  const d = ref.split(":").slice(2).join(":"); // disco-vault:<id>
  const idStr = d.startsWith("disco-vault:") ? d.slice("disco-vault:".length) : null;
  if (idStr == null) return null;
  const n = parseInt(idStr, 10);
  return Number.isFinite(n) ? n : null;
}
