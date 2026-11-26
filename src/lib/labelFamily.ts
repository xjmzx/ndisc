// Label families: a label may name another as its parent (an imprint or a
// series under a label). One level only — a label is a parent, a sublabel, or
// neither. Links are by name, compared trimmed and case-insensitive, like
// every other label lookup. The backend applies the same rule on save
// (normalise_label_parents). See docs/sublabels-design-2026-11-26.md.
import type { LabelEntry } from "../components/LabelPanel";

export const labelKey = (s: string) => s.trim().toLowerCase();

function entryOf(labels: LabelEntry[], name: string): LabelEntry | undefined {
  const k = labelKey(name);
  return labels.find((l) => labelKey(l.name) === k);
}

// The parent's name as stored on the label, or null.
export function parentOf(labels: LabelEntry[], name: string): string | null {
  const p = entryOf(labels, name)?.parent?.trim();
  return p ? p : null;
}

// Names of the label's sublabels, A–Z, without duplicates.
export function childrenOf(labels: LabelEntry[], name: string): string[] {
  const k = labelKey(name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    if (!l.parent || labelKey(l.parent) !== k || labelKey(l.name) === k) continue;
    if (seen.has(labelKey(l.name))) continue;
    seen.add(labelKey(l.name));
    out.push(l.name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// A label that heads a family stays top-level.
export function canHaveParent(labels: LabelEntry[], name: string): boolean {
  return childrenOf(labels, name).length === 0;
}

// Labels `name` may take as its parent: any known label (a stored entry or a
// release's label) other than itself and other than a sublabel.
export function parentCandidates(
  labels: LabelEntry[],
  known: string[],
  name: string,
): string[] {
  const self = labelKey(name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [...labels.map((l) => l.name), ...known]) {
    const k = labelKey(n);
    if (!k || k === self || seen.has(k)) continue;
    seen.add(k);
    if (parentOf(labels, n)) continue;
    out.push(n.trim());
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// Set (or with null, clear) `name`'s parent. A label with no stored entry
// gets one, with no art, as "Add label" makes it. Every row of a duplicated
// name follows, since the link is by name.
export function setParent(
  labels: LabelEntry[],
  name: string,
  parent: string | null,
): LabelEntry[] {
  const k = labelKey(name);
  const p = parent?.trim() || undefined;
  if (p && labelKey(p) === k) return labels;
  if (!labels.some((l) => labelKey(l.name) === k)) {
    return p ? [...labels, { name: name.trim(), imageUrl: "", parent: p }] : labels;
  }
  return labels.map((l) => {
    if (labelKey(l.name) !== k) return l;
    const { parent: _old, ...rest } = l;
    return p ? { ...rest, parent: p } : rest;
  });
}
