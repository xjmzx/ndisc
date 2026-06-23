// Feed-note subscription for ndisc desktop. Subscribes to the channel events
// (kind:31239 feed notes + the owner's 30000 registry / 4550 sign-offs / 5
// deletions), then runs the SHARED trust gate (lib/feed.ts resolveFeed) — the
// same pure function the glmps + ndisc.view viewers run. Transport (SimplePool)
// is desktop-side; the maths is shared.
//
// Two subscriptions: the owner's own events (always), plus — once the owner's
// kind:30000 registry names contributors — those contributors' feed notes +
// deletes, so the owner can moderate them (Phase 5). resolveFeed gates the
// public view; raw `events` are exposed for the owner-only curation queue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SimplePool, nip19, type Event as NostrEvent } from "nostr-tools";
import {
  APPROVAL_KIND,
  FEED_KIND,
  REGISTRY_KIND,
  resolveFeed,
  type FeedNote,
} from "../lib/feed";
import { currentContributors } from "../lib/curation";

export interface FeedState {
  notes: FeedNote[];
  events: NostrEvent[];
  contributors: string[];
  loading: boolean;
}

export function useFeed(npub: string | null, relays: string[]): FeedState {
  const myHex = useMemo(() => {
    if (!npub) return null;
    try {
      const d = nip19.decode(npub);
      return d.type === "npub" ? (d.data as string) : null;
    } catch {
      return null;
    }
  }, [npub]);

  const [notes, setNotes] = useState<FeedNote[]>([]);
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [contribKey, setContribKey] = useState(""); // sorted hexes joined — stable dep
  const [loading, setLoading] = useState(false);

  // Address/id → raw event (latest created_at wins), shared by both subs.
  const byKeyRef = useRef<Map<string, NostrEvent>>(new Map());
  const poolRef = useRef<SimplePool | null>(null);

  const keyOf = (ev: NostrEvent): string => {
    const dTag = ev.tags.find((t) => t[0] === "d")?.[1];
    return ev.kind === FEED_KIND || ev.kind === REGISTRY_KIND
      ? `${ev.kind}:${ev.pubkey}:${dTag ?? ""}`
      : ev.id;
  };

  const ingest = useCallback(
    (ev: NostrEvent): boolean => {
      const key = keyOf(ev);
      const prev = byKeyRef.current.get(key);
      if (prev && ev.created_at <= prev.created_at) return false;
      byKeyRef.current.set(key, ev);
      return true;
    },
    [],
  );

  const recompute = useCallback(() => {
    if (!myHex) return;
    const arr = [...byKeyRef.current.values()];
    setEvents(arr);
    setNotes(resolveFeed(arr, myHex));
    setContribKey([...currentContributors(arr, myHex)].sort().join(","));
  }, [myHex]);

  // Reset on identity/relay change.
  useEffect(() => {
    byKeyRef.current = new Map();
    setNotes([]);
    setEvents([]);
    setContribKey("");
  }, [myHex, relays]);

  // Owner subscription — feed notes + registry + sign-offs + deletes.
  useEffect(() => {
    if (!myHex || relays.length === 0) {
      setLoading(false);
      return;
    }
    if (!poolRef.current) poolRef.current = new SimplePool();
    const pool = poolRef.current;
    setLoading(true);

    const sub = pool.subscribeMany(
      relays,
      {
        kinds: [FEED_KIND, REGISTRY_KIND, APPROVAL_KIND, 5],
        authors: [myHex],
      },
      {
        onevent(ev) {
          if (ingest(ev)) recompute();
        },
        oneose() {
          setLoading(false);
        },
      },
    );
    return () => {
      sub.close();
    };
  }, [myHex, relays, ingest, recompute]);

  // Contributor subscription — their feed notes + deletes. Re-created whenever
  // the registry's contributor set changes (contribKey). Owner-only launches
  // have an empty set, so this is a no-op until contributors are added.
  useEffect(() => {
    if (!myHex || relays.length === 0 || contribKey === "") return;
    const authors = contribKey.split(",").filter(Boolean);
    if (authors.length === 0) return;
    if (!poolRef.current) poolRef.current = new SimplePool();
    const pool = poolRef.current;

    const sub = pool.subscribeMany(
      relays,
      { kinds: [FEED_KIND, 5], authors },
      {
        onevent(ev) {
          if (ingest(ev)) recompute();
        },
      },
    );
    return () => {
      sub.close();
    };
  }, [myHex, relays, contribKey, ingest, recompute]);

  useEffect(() => {
    return () => {
      poolRef.current?.close([]);
      poolRef.current = null;
    };
  }, []);

  const contributors = useMemo(
    () => (contribKey ? contribKey.split(",").filter(Boolean) : []),
    [contribKey],
  );

  return { notes, events, contributors, loading };
}
