// Drift the user has judged and does not want to see again: "yes, my DB value
// and the file tag disagree, and I meant it". Frontend-only state, like
// `ndisc.dupDismissed` / `ndisc.sources`.
//
// The key deliberately includes the ON-DISK value, not just the release and
// field. Dismissing says "I reject THIS file value", not "never tell me about
// this field again" — so if the file is genuinely retagged later, the new
// value is a new key and the drift resurfaces for review. No permanent blind
// spot, at the cost of one stored string per judgement.

import type { FieldDrift, ReleaseDrift } from "./tauri";

const KEY = "ndisc.driftDismissed";

/** Stable id for one (release, field, file-value) judgement. */
export function driftKey(releaseId: number, d: FieldDrift): string {
  return `${releaseId}|${d.field}|${d.onDisk}`;
}

export function getDismissedDriftKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

export function dismissDriftKeys(keys: string[]): void {
  const s = getDismissedDriftKeys();
  for (const k of keys) s.add(k);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable — dismissal just won't persist */
  }
}

/** Drop fields already judged; drop releases left with nothing to review. */
export function withoutDismissed(drifts: ReleaseDrift[]): ReleaseDrift[] {
  const dismissed = getDismissedDriftKeys();
  return drifts
    .map((r) => ({
      ...r,
      fields: r.fields.filter((f) => !dismissed.has(driftKey(r.id, f))),
    }))
    .filter((r) => r.fields.length > 0);
}
