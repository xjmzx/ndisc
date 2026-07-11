// Owner-side curation derivations — ndisc-ONLY (the viewers consume only the
// gated resolveFeed output; moderation is the publisher's job). These read the
// raw event stream to surface what resolveFeed deliberately hides from
// consumers: contributor notes pending sign-off, and the approval/registry
// state the owner edits. Authority keys on the owner pubkey throughout.
//
// Pure functions over nostr-tools events — kept beside lib/feed.ts but NOT part
// of the byte-identical shared template.

import type { Event as NostrEvent } from "nostr-tools";
import {
  APPROVAL_KIND,
  FEED_KIND,
  REGISTRY_KIND,
  REGISTRY_D,
  parseFeedNote,
  type FeedNote,
} from "./feed";

const tag = (ev: NostrEvent, k: string): string | undefined =>
  ev.tags.find((t) => t[0] === k)?.[1];
const allTags = (ev: NostrEvent, k: string): string[] =>
  ev.tags.filter((t) => t[0] === k).map((t) => t[1]);

/** Allowed contributor pubkeys from the latest owner-signed kind:30000. */
export function currentContributors(
  events: NostrEvent[],
  ownerPubkey: string,
): string[] {
  const registry = events
    .filter(
      (e) =>
        e.kind === REGISTRY_KIND &&
        e.pubkey === ownerPubkey &&
        tag(e, "d") === REGISTRY_D,
    )
    .sort((a, b) => b.created_at - a.created_at)[0];
  return registry ? allTags(registry, "p") : [];
}

export interface ContributorNote extends FeedNote {
  approved: boolean;
  /** kind:4550 event id backing the approval — needed to revoke. */
  approvalEventId: string | null;
  /** the contributor note's own event id — needed to sign off. */
  eventId: string;
}

/**
 * Every feed note authored by a *registered contributor* (not the owner), with
 * its current approval state. This is the moderation queue: notes here that are
 * `approved:false` are exactly the ones resolveFeed hides from consumers while
 * requireApproval is on. Deletions (kind:5) are honoured.
 */
export function contributorNotes(
  events: NostrEvent[],
  ownerPubkey: string,
): ContributorNote[] {
  const allowed = new Set(currentContributors(events, ownerPubkey));

  // address → approval event id (owner-signed 4550s).
  const approvals = new Map<string, string>();
  for (const e of events) {
    if (e.kind === APPROVAL_KIND && e.pubkey === ownerPubkey) {
      const a = tag(e, "a");
      if (a) approvals.set(a, e.id);
    }
  }

  // kind:5 deletions referencing a feed-note address. Keyed by address -> newest
  // deletion timestamp, NOT a bare set: the address is reused whenever a note is
  // republished, so a deletion may only kill events created at or before it.
  // See lib/feed.ts.
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

  const byAddr = new Map<string, ContributorNote>();
  for (const ev of events) {
    if (ev.kind !== FEED_KIND) continue;
    if (ev.pubkey === ownerPubkey) continue; // owner notes need no approval
    if (!allowed.has(ev.pubkey)) continue; // unregistered authors are not shown for moderation
    const address = `${FEED_KIND}:${ev.pubkey}:${tag(ev, "d") ?? ""}`;
    const killedAt = deletedAt.get(address);
    if (killedAt !== undefined && ev.created_at <= killedAt) continue;
    const prev = byAddr.get(address);
    if (prev && ev.created_at <= prev.createdAt) continue;
    byAddr.set(address, {
      ...parseFeedNote(ev),
      eventId: ev.id,
      approved: approvals.has(address),
      approvalEventId: approvals.get(address) ?? null,
    });
  }
  return [...byAddr.values()].sort((a, b) => b.publishedAt - a.publishedAt);
}
