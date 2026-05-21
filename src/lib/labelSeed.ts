import type { LabelEntry } from "../components/LabelPanel";

// One-shot migration: earlier builds bundled label images and stored their
// resolved URLs in localStorage — `/assets/...` from the prod build and
// `/src/assets/...` from the Vite dev server. Both 404 once the bundle is
// removed. Treat anything that isn't a proper absolute http(s) URL as stale
// and blank it — the entry stays so the user can see which labels need a
// fresh nostr.build upload.
function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export function clearStaleBundleUrls(entries: LabelEntry[]): LabelEntry[] {
  let changed = false;
  const next = entries.map((l) => {
    if (l.imageUrl !== "" && !isAbsoluteHttpUrl(l.imageUrl)) {
      changed = true;
      return { ...l, imageUrl: "" };
    }
    return l;
  });
  return changed ? next : entries;
}
