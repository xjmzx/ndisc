// Feed-note subscription for ndisc desktop. Subscribes once to the channel
// events (kind:31239 feed notes + the owner's 30000 registry / 4550 sign-offs /
// 5 deletions) authored by the signed-in identity, then runs the SHARED trust
// gate (lib/feed.ts resolveFeed) — the same pure function the glmps + ndisc.view
// viewers run. Transport (SimplePool) is desktop-side; the maths is shared.
//
// Phase 1 is owner-only: the author filter is the signed-in key, so every note
// resolves as provenance "owner". Contributors (a wider author filter gated by
// the registry) are a later increment — see schema/current-feed-2026-06-23.md.

import { useEffect, useMemo, useRef, useState } from "react";
import { SimplePool, nip19, type Event as NostrEvent } from "nostr-tools";
import {
  APPROVAL_KIND,
  FEED_KIND,
  REGISTRY_KIND,
  resolveFeed,
  type FeedNote,
} from "../lib/feed";

export interface FeedState {
  notes: FeedNote[];
  loading: boolean;
}

export function useFeed(npub: string | null, relays: string[]): FeedState {
  const myHex = useMemo(() => {
    if (!npub) return null;
    try {
      const decoded = nip19.decode(npub);
      return decoded.type === "npub" ? (decoded.data as string) : null;
    } catch {
      return null;
    }
  }, [npub]);

  const [notes, setNotes] = useState<FeedNote[]>([]);
  const [loading, setLoading] = useState(false);
  const poolRef = useRef<SimplePool | null>(null);

  useEffect(() => {
    if (!myHex || relays.length === 0) {
      setNotes([]);
      setLoading(false);
      return;
    }
    if (!poolRef.current) poolRef.current = new SimplePool();
    const pool = poolRef.current;

    // Address → raw event (latest created_at wins) for the addressable kinds,
    // plus a flat bucket for kind:5 deletions; resolveFeed reads the union.
    const byKey = new Map<string, NostrEvent>();
    setLoading(true);

    const recompute = () => {
      setNotes(resolveFeed([...byKey.values()], myHex));
    };

    const sub = pool.subscribeMany(
      relays,
      {
        kinds: [FEED_KIND, REGISTRY_KIND, APPROVAL_KIND, 5],
        authors: [myHex],
      },
      {
        onevent(ev) {
          // Key replaceable events by their address; keep regular events
          // (4550, 5) by id. Newer created_at supersedes for a given key.
          const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
          const key =
            ev.kind === FEED_KIND || ev.kind === REGISTRY_KIND
              ? `${ev.kind}:${ev.pubkey}:${dTag ?? ""}`
              : ev.id;
          const prev = byKey.get(key);
          if (!prev || ev.created_at > prev.created_at) {
            byKey.set(key, ev);
            recompute();
          }
        },
        oneose() {
          setLoading(false);
        },
      },
    );

    return () => {
      sub.close();
    };
  }, [myHex, relays]);

  useEffect(() => {
    return () => {
      poolRef.current?.close([]);
      poolRef.current = null;
    };
  }, []);

  return { notes, loading };
}
