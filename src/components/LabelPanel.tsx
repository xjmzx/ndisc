import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import { Section } from "./Section";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
import type { Release } from "../lib/tauri";

export interface LabelEntry {
  name: string;
  imageUrl: string;
}

interface Props {
  labels: LabelEntry[];
  setLabels: (next: LabelEntry[]) => void;
  selected: Release | null;
}

const CYCLE_MS = 21_000;

export function findMatch(
  labels: LabelEntry[],
  release: Release | null,
): LabelEntry | null {
  if (!release?.label) return null;
  const needle = release.label.trim().toLowerCase();
  if (!needle) return null;
  return (
    labels.find((l) => l.name.trim().toLowerCase() === needle) ?? null
  );
}

export function LabelPanel({ labels, setLabels, selected }: Props) {
  const [cycleIndex, setCycleIndex] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const cycleRef = useRef(cycleIndex);
  cycleRef.current = cycleIndex;

  const match = useMemo(() => findMatch(labels, selected), [labels, selected]);

  // Cycle only when no release is selected and we have 2+ labels.
  useEffect(() => {
    if (selected || labels.length < 2) return;
    const t = window.setInterval(() => {
      setCycleIndex((i) => (i + 1) % labels.length);
    }, CYCLE_MS);
    return () => window.clearInterval(t);
  }, [selected, labels.length]);

  // Clamp cycleIndex if labels shrink.
  useEffect(() => {
    if (cycleRef.current >= labels.length && labels.length > 0) {
      setCycleIndex(0);
    }
  }, [labels.length]);

  const display = match ?? labels[cycleIndex] ?? null;

  function addLabel() {
    const url = newUrl.trim();
    if (!url) return;
    const name = newName.trim() || new URL(url).hostname;
    setLabels([...labels, { name, imageUrl: url }]);
    setNewName("");
    setNewUrl("");
    setAddOpen(false);
  }

  function removeCurrent() {
    if (!display) return;
    setLabels(labels.filter((l) => l !== display));
  }

  return (
    <Section
      title="Label"
      icon={<Tag size={16} />}
      right={
        <div className="flex items-center gap-1">
          {display && !match && (
            <button
              type="button"
              onClick={removeCurrent}
              title={`Remove "${display.name}"`}
              aria-label={`Remove ${display.name}`}
              className="text-muted hover:text-alert transition-colors p-1
                         rounded-md hover:bg-surface"
            >
              <X size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            title="Add label image"
            aria-label="Add label image"
            className="text-muted hover:text-mauve transition-colors p-1
                       rounded-md hover:bg-surface"
          >
            <Plus size={14} />
          </button>
        </div>
      }
    >
      <div className="h-[186px] flex items-center justify-center">
        {display ? (
          <img
            src={display.imageUrl}
            alt={display.name}
            title={display.name}
            className="aspect-square h-full max-w-full rounded-md object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className="aspect-square h-full max-w-full rounded-md border
                       border-dashed border-surface flex items-center
                       justify-center text-muted text-xs text-center px-2"
          >
            {labels.length === 0
              ? "no label images"
              : "no match for this release"}
          </div>
        )}
      </div>

      {addOpen && (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="label name (e.g. Clone West Coast Series)"
            className="px-2 py-1 rounded-md bg-surface text-fg text-xs
                       outline-none border border-transparent
                       focus:border-accent/50 placeholder:text-muted"
            spellCheck={false}
          />
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://i.nostr.build/…"
            className="px-2 py-1 rounded-md bg-surface text-fg text-xs
                       font-mono outline-none border border-transparent
                       focus:border-accent/50 placeholder:text-muted"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={addLabel}
            disabled={!newUrl.trim()}
            className={`${DB_BUTTON_CLS} justify-center disabled:opacity-50`}
          >
            <Plus size={12} /> Add
          </button>
        </div>
      )}
    </Section>
  );
}
