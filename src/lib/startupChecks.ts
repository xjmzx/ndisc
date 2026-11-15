// Network and storage helpers for the startup screen (Startup check + Setup).
// Design: docs/onboarding-design-2026-11-16.md.
//
// Relays and Blossom servers live in the webview's localStorage (App.tsx owns
// the keys), so the startup screen reads and writes the same keys before App
// mounts; App then picks them up as its initial state.

export const RELAYS_KEY = "ndisc.relays";
export const BLOSSOM_KEY = "ndisc.blossomServers";
// What the user chose at Setup's relay step. "later" means no relay was
// picked: App still tops an empty list up to its default, and that top-up
// must not read as "configured" in the startup check.
export const RELAY_CHOICE_KEY = "ndisc.setup.relay";
// Set by the ⋮ menu's "Setup…" before it reloads the window into Setup.
export const FORCE_SETUP_KEY = "ndisc.forceSetup";

export const PUBLIC_RELAY = "wss://nos.lol";

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable: App falls back to its defaults */
  }
}

export function savedRelays(): string[] {
  return readList(RELAYS_KEY);
}
export function saveRelays(list: string[]) {
  writeList(RELAYS_KEY, list);
}
export function savedBlossom(): string[] {
  return readList(BLOSSOM_KEY);
}
export function saveBlossom(list: string[]) {
  writeList(BLOSSOM_KEY, list);
}

export function relayChoice(): string | null {
  try {
    return localStorage.getItem(RELAY_CHOICE_KEY);
  } catch {
    return null;
  }
}
export function setRelayChoice(v: "own" | "public" | "later" | "kept") {
  try {
    localStorage.setItem(RELAY_CHOICE_KEY, v);
  } catch {
    /* ignore */
  }
}

export function takeForceSetup(): boolean {
  try {
    const v = sessionStorage.getItem(FORCE_SETUP_KEY) === "1";
    sessionStorage.removeItem(FORCE_SETUP_KEY);
    return v;
  } catch {
    return false;
  }
}

export function requestSetup() {
  try {
    sessionStorage.setItem(FORCE_SETUP_KEY, "1");
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function normaliseRelayUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const withScheme = /^wss?:\/\//i.test(t) ? t : `wss://${t}`;
  try {
    const u = new URL(withScheme);
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normaliseServerUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export interface RelayTest {
  reachable: boolean;
  /** Set when the relay's NIP-11 document says it may refuse this key. */
  restricted: string | null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function wsOpens(url: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    try {
      ws = new WebSocket(url);
    } catch {
      resolve(false);
      return;
    }
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    setTimeout(() => finish(false), ms);
  });
}

// Reachable is not writable: a relay can accept the connection and still
// refuse this key's events. NIP-11's `limitation` block says so up front. No
// test write: that would publish an event.
export async function testRelay(url: string): Promise<RelayTest> {
  const reachable = await wsOpens(url, 4000);
  if (!reachable) return { reachable, restricted: null };
  let restricted: string | null = null;
  try {
    const httpUrl = url.replace(/^ws/i, "http");
    const res = await withTimeout(
      fetch(httpUrl, { headers: { Accept: "application/nostr+json" } }),
      4000,
    );
    const info = await res.json();
    const lim = info?.limitation ?? {};
    const reasons = [
      lim.auth_required && "needs authentication",
      lim.restricted_writes && "only accepts writes from approved keys",
      lim.payment_required && "needs payment",
    ].filter(Boolean);
    if (reasons.length) restricted = `This relay ${reasons.join(", ")}, so it may refuse your releases.`;
  } catch {
    /* no NIP-11 document: nothing to warn about */
  }
  return { reachable, restricted };
}

export async function anyRelayReachable(urls: string[]): Promise<boolean> {
  const results = await Promise.all(urls.map((u) => wsOpens(u, 4000)));
  return results.some(Boolean);
}

// Any HTTP answer counts as reachable. `no-cors` so a server without CORS
// headers still resolves instead of reading as down.
export async function serverReachable(url: string): Promise<boolean> {
  try {
    await withTimeout(fetch(url, { method: "GET", mode: "no-cors" }), 5000);
    return true;
  } catch {
    return false;
  }
}

export async function anyServerReachable(urls: string[]): Promise<boolean> {
  const results = await Promise.all(urls.map(serverReachable));
  return results.some(Boolean);
}
