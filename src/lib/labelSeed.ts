import type { LabelEntry } from "../components/LabelPanel";

// Vite enumerates bundled assets at build time. Keys are repo paths relative
// to this file, values are resolved URLs the webview can load.
const bundled = import.meta.glob("../assets/labels/*.{jpg,jpeg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

// Filenames can't always carry the canonical label string verbatim (colons
// and apostrophes are problematic on disk and in build tooling). Map the
// mechanically-derived name to the real Discogs label string.
const NAME_ALIASES: Record<string, string> = {
  "de tuned": "De:tuned",
  "mo wax": "Mo' Wax",
  touchinbass: "Touchin Bass",
};

function deriveName(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const derived = base
    .replace(/\.(jpe?g|png|webp|gif|bmp)$/i, "")
    .replace(/\.label$/i, "")
    .replace(/\./g, " ")
    .trim();
  return NAME_ALIASES[derived.toLowerCase()] ?? derived;
}

export function bundledSeedLabels(): LabelEntry[] {
  return Object.entries(bundled)
    .map(([path, url]) => ({ name: deriveName(path), imageUrl: url }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
