// Duplicate groups the user has acknowledged as "not actually duplicates".
// Stored locally, keyed by the group's normalized key (artist|title), so the
// review stops surfacing them. Frontend-only state, like ndisc.sources.

const KEY = "ndisc.dupDismissed";

export function getDismissedDupKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

export function dismissDupKey(key: string): void {
  const s = getDismissedDupKeys();
  s.add(key);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable — dismissal just won't persist */
  }
}
