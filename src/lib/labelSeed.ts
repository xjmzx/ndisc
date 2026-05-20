import type { LabelEntry } from "../components/LabelPanel";

// Seed pool: well-known label → nostr.build image URL.
// Labels are hosted on nostr.build so the binary stays small and images
// resolve identically on every install. Update by uploading a logo to
// nostr.build and adding the {name, imageUrl} pair below.
const SEED_LABELS: LabelEntry[] = [
  { name: "3024", imageUrl: "https://i.nostr.build/cjmdgxaPSJ76bE53.jpg" },
  { name: "30D Records", imageUrl: "https://i.nostr.build/7YOljLpiDFROF0ZL.jpg" },
  { name: "30mil Recordings", imageUrl: "https://i.nostr.build/Hp4YgpDbGswzl6GU.jpg" },
  { name: "Ahead Of Our Time", imageUrl: "https://i.nostr.build/EIrHgXnUy8OQU1TG.jpg" },
  { name: "Blue Room Released", imageUrl: "https://i.nostr.build/SIV7CtV9y3MUeekz.jpg" },
  { name: "Breakin Records", imageUrl: "https://i.nostr.build/1QaEpjxGY2t1U0bR.jpg" },
  { name: "Clear", imageUrl: "https://i.nostr.build/DMo8Z1lBBN7N2MSP.jpg" },
  { name: "Clone", imageUrl: "https://i.nostr.build/HfYWRo1EQ4AjjBd5.jpg" },
  { name: "Clone Aqualung Series", imageUrl: "https://i.nostr.build/HfYWRo1EQ4AjjBd5.jpg" },
  { name: "Clone Basement Series", imageUrl: "https://i.nostr.build/HfYWRo1EQ4AjjBd5.jpg" },
  { name: "Clone West Coast Series", imageUrl: "https://i.nostr.build/HfYWRo1EQ4AjjBd5.jpg" },
  { name: "Dub Communication", imageUrl: "https://i.nostr.build/wieKBGyIgJx2GZP4.jpg" },
  { name: "Echocord", imageUrl: "https://i.nostr.build/hHXpU4jFLlFZl24t.jpg" },
  { name: "Echocord Colour", imageUrl: "https://i.nostr.build/hHXpU4jFLlFZl24t.jpg" },
  { name: "Echospace", imageUrl: "https://i.nostr.build/zLILLBHaJTKsCamQ.jpg" },
  { name: "Echospace [detroit]", imageUrl: "https://i.nostr.build/zLILLBHaJTKsCamQ.jpg" },
  { name: "Exalt Records", imageUrl: "https://i.nostr.build/LFnk2rjHVRyeEQns.jpg" },
  { name: "FireScope", imageUrl: "https://i.nostr.build/lXUKiXkDkG62NAK5.jpg" },
  { name: "Fonolith", imageUrl: "https://i.nostr.build/GHobQN7bOK9s2a8k.jpg" },
  { name: "fsoldigital", imageUrl: "https://i.nostr.build/YEtKft04if1QtFnk.jpg" },
  { name: "Hyperdub", imageUrl: "https://i.nostr.build/GK20nrdIIy4QtuKI.jpg" },
  { name: "Leaf", imageUrl: "https://i.nostr.build/R4l3lIC8jWoc1hKf.jpg" },
  { name: "Leisure System", imageUrl: "https://i.nostr.build/Rfj6fEAcauSv4wwb.jpg" },
  { name: "Lo Recordings", imageUrl: "https://i.nostr.build/dDH77oaNV1xaJKcg.jpg" },
  { name: "Mo Wax", imageUrl: "https://i.nostr.build/AdxRu54151OfT0zd.jpg" },
  { name: "Ninjatune", imageUrl: "https://i.nostr.build/TCQi1b4gZnXusv9J.jpg" },
  { name: "No Comment", imageUrl: "https://i.nostr.build/5mY1qIEEge0g2UJL.jpg" },
  { name: "On-U Sound", imageUrl: "https://i.nostr.build/mk3fyhpr7wFRUcNM.jpg" },
  { name: "On-U-Sound", imageUrl: "https://i.nostr.build/mk3fyhpr7wFRUcNM.jpg" },
  { name: "Planet Mu", imageUrl: "https://i.nostr.build/DMUy1ati4CMgRThw.jpg" },
  { name: "Planet Mµ", imageUrl: "https://i.nostr.build/DMUy1ati4CMgRThw.jpg" },
  { name: "Rising High", imageUrl: "https://i.nostr.build/uGvCwfrrZDNohz0U.jpg" },
  { name: "Scsi-AV", imageUrl: "https://i.nostr.build/cs8h57nbipb6dMi4.jpg" },
  { name: "Semantica Records", imageUrl: "https://i.nostr.build/IBlCgruOr3ocDOIo.jpg" },
  { name: "Skam", imageUrl: "https://i.nostr.build/Hp4YgpDbGswzl6GU.jpg" },
  { name: "Skull Disco Records", imageUrl: "https://i.nostr.build/Y8wDRGMwelgsi4gb.jpg" },
  { name: "Slut Smalls", imageUrl: "https://i.nostr.build/TJTA327CJNAZ1mji.jpg" },
  { name: "Solar One Music", imageUrl: "https://i.nostr.build/fIWwJYLvYU0VbG03.jpg" },
  { name: "Spezialmaterial", imageUrl: "https://i.nostr.build/5ca4pawhbXGqGpkm.jpg" },
  { name: "Spezialmaterial Records", imageUrl: "https://i.nostr.build/5ca4pawhbXGqGpkm.jpg" },
  { name: "spezialmaterial.ch", imageUrl: "https://i.nostr.build/5ca4pawhbXGqGpkm.jpg" },
  { name: "Thrill Jockey", imageUrl: "https://i.nostr.build/vyvknhbuTMxJibia.jpg" },
  { name: "When in Doubt", imageUrl: "https://i.nostr.build/i94ds79cEJzjaZzk.jpg" },
];

export function bundledSeedLabels(): LabelEntry[] {
  return SEED_LABELS.slice();
}

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

// Merge: keep all existing entries, add seed entries whose name doesn't
// already exist (case-insensitive trim match). Returns a new array if
// changes were made, or the original reference if nothing was added.
export function mergeSeed(
  existing: LabelEntry[],
  seed: LabelEntry[],
): LabelEntry[] {
  const have = new Set(existing.map((l) => l.name.trim().toLowerCase()));
  const additions = seed.filter(
    (s) => !have.has(s.name.trim().toLowerCase()),
  );
  if (additions.length === 0) return existing;
  return [...existing, ...additions];
}
