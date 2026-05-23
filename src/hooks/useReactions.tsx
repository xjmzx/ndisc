// Reaction provider for ndisc desktop. Subscribes once to kind:7 events
// targeting the signed-in user's pubkey (via #p filter), aggregates by
// release address. Mirrors ndisc.view's useReactions hook but reads the
// owner pubkey from the active local identity instead of a static config
// constant, and routes writes through Rust commands so the nsec never
// leaves the OS keychain.
//
// The desktop only owns *its own* releases (loaded from the local SQLite
// DB), so all reactions we care about target the signed-in user's pubkey.
// Out-of-suite reactions on those releases (from ndisc.view, web clients,
// other suite installs) flow through here uniformly.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SimplePool, nip19, type Event as NostrEvent } from "nostr-tools";
import { classifyReaction, REACTION_UP } from "../lib/rating";
import { deleteReaction, publishReaction } from "../lib/tauri";

export type ReactionAgg = { up: number; down: number; mine: string | null };
const EMPTY: ReactionAgg = { up: 0, down: 0, mine: null };

const REACTION_RELAYS = ["wss://relay.fizx.uk", "wss://nos.lol"];
const KIND_RELEASE = 31237;
const D_TAG_PREFIX = "disco-vault";

type Ctx = {
  forRelease: (releaseId: number) => ReactionAgg;
  react: (releaseId: number, content?: string) => Promise<void>;
  unreact: (releaseId: number) => Promise<void>;
  canReact: boolean;
  busy: number | null;
};
const C = createContext<Ctx | null>(null);

function addressFor(myHex: string, releaseId: number): string {
  return `${KIND_RELEASE}:${myHex}:${D_TAG_PREFIX}:${releaseId}`;
}

function releaseIdFromAddress(addr: string, prefix: string): number | null {
  if (!addr.startsWith(prefix)) return null;
  const tail = addr.slice(prefix.length);
  const n = parseInt(tail, 10);
  return Number.isFinite(n) ? n : null;
}

interface ProviderProps {
  npub: string | null;
  children: ReactNode;
}

export function ReactionsProvider({ npub, children }: ProviderProps) {
  const myHex = useMemo(() => {
    if (!npub) return null;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== "npub") return null;
      return decoded.data as string;
    } catch {
      return null;
    }
  }, [npub]);

  // releaseId → reactor_hex → latest kind:7
  const latestRef = useRef<Map<number, Map<string, NostrEvent>>>(new Map());
  const [aggs, setAggs] = useState<Map<number, ReactionAgg>>(new Map());
  const [busy, setBusy] = useState<number | null>(null);
  const poolRef = useRef<SimplePool | null>(null);

  const myHexRef = useRef<string | null>(myHex);
  myHexRef.current = myHex;

  const aggOf = useCallback((rid: number): ReactionAgg => {
    const inner = latestRef.current.get(rid);
    if (!inner) return EMPTY;
    let up = 0;
    let down = 0;
    let mine: string | null = null;
    for (const ev of inner.values()) {
      const k = classifyReaction(ev.content);
      if (k === "up") up++;
      else if (k === "down") down++;
      if (myHexRef.current && ev.pubkey === myHexRef.current) {
        mine = ev.id;
      }
    }
    return { up, down, mine };
  }, []);

  const refresh = useCallback(
    (rid: number) => {
      setAggs((m) => new Map(m).set(rid, aggOf(rid)));
    },
    [aggOf],
  );

  useEffect(() => {
    if (!myHex) {
      latestRef.current = new Map();
      setAggs(new Map());
      return;
    }
    if (!poolRef.current) poolRef.current = new SimplePool();
    const pool = poolRef.current;
    const addrPrefix = `${KIND_RELEASE}:${myHex}:${D_TAG_PREFIX}:`;

    const sub = pool.subscribeMany(
      REACTION_RELAYS,
      { kinds: [7], "#p": [myHex] },
      {
        onevent(ev) {
          const addr = ev.tags
            .filter((t) => t[0] === "a" && t[1]?.startsWith(addrPrefix))
            .map((t) => t[1])[0];
          if (!addr) return;
          const rid = releaseIdFromAddress(addr, addrPrefix);
          if (rid == null) return;
          let inner = latestRef.current.get(rid);
          if (!inner) {
            inner = new Map();
            latestRef.current.set(rid, inner);
          }
          const prev = inner.get(ev.pubkey);
          if (
            prev &&
            !(
              ev.created_at > prev.created_at ||
              (ev.created_at === prev.created_at && ev.id < prev.id)
            )
          ) {
            return;
          }
          inner.set(ev.pubkey, ev);
          refresh(rid);
        },
      },
    );

    return () => {
      sub.close();
    };
  }, [myHex, refresh]);

  useEffect(() => {
    return () => {
      poolRef.current?.close(REACTION_RELAYS);
      poolRef.current = null;
    };
  }, []);

  const react = useCallback(
    async (releaseId: number, content: string = REACTION_UP) => {
      if (!myHexRef.current) throw new Error("not signed in");
      setBusy(releaseId);
      try {
        const result = await publishReaction(releaseId, content);
        let inner = latestRef.current.get(releaseId);
        if (!inner) {
          inner = new Map();
          latestRef.current.set(releaseId, inner);
        }
        inner.set(myHexRef.current, {
          id: result.eventId,
          kind: 7,
          pubkey: myHexRef.current,
          created_at: Math.floor(Date.now() / 1000),
          content,
          tags: [["a", addressFor(myHexRef.current, releaseId)]],
          sig: "",
        } as NostrEvent);
        refresh(releaseId);
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const unreact = useCallback(
    async (releaseId: number) => {
      const me = myHexRef.current;
      if (!me) throw new Error("not signed in");
      const inner = latestRef.current.get(releaseId);
      const mine = inner?.get(me);
      if (!inner || !mine) return;
      setBusy(releaseId);
      try {
        await deleteReaction(mine.id);
        inner.delete(me);
        refresh(releaseId);
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const value = useMemo<Ctx>(
    () => ({
      forRelease: (rid) => aggs.get(rid) ?? EMPTY,
      react,
      unreact,
      canReact: myHex != null,
      busy,
    }),
    [aggs, react, unreact, myHex, busy],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useReactions(): Ctx {
  const v = useContext(C);
  if (!v) {
    throw new Error("useReactions must be used inside <ReactionsProvider>");
  }
  return v;
}
