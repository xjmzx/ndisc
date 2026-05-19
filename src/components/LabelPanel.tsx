import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, Tag, X } from "lucide-react";
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
  onReseed?: () => void;
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
  formName: string;
  setFormName: (name: string) => void;
  formUrl: string;
  setFormUrl: (url: string) => void;
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

export function LabelPanel({
  labels,
  setLabels,
  selected,
  onReseed,
  formOpen,
  setFormOpen,
  formName,
  setFormName,
  formUrl,
  setFormUrl,
}: Props) {
  const [cycleIndex, setCycleIndex] = useState(0);
  const cycleRef = useRef(cycleIndex);
  cycleRef.current = cycleIndex;

  const match = useMemo(() => findMatch(labels, selected), [labels, selected]);

  // When the form is open, freeze on the entry whose name matches what's
  // being edited so the user sees what they're updating.
  const editingEntry = useMemo(() => {
    if (!formOpen) return null;
    const needle = formName.trim().toLowerCase();
    if (!needle) return null;
    return (
      labels.find((l) => l.name.trim().toLowerCase() === needle) ?? null
    );
  }, [formOpen, formName, labels]);

  // Cycle only when no release is selected, no form open, and we have 2+.
  useEffect(() => {
    if (selected || formOpen || labels.length < 2) return;
    const t = window.setInterval(() => {
      setCycleIndex((i) => (i + 1) % labels.length);
    }, CYCLE_MS);
    return () => window.clearInterval(t);
  }, [selected, formOpen, labels.length]);

  // Clamp cycleIndex if labels shrink.
  useEffect(() => {
    if (cycleRef.current >= labels.length && labels.length > 0) {
      setCycleIndex(0);
    }
  }, [labels.length]);

  const display = match ?? editingEntry ?? labels[cycleIndex] ?? null;
  const editing = formOpen;

  function addLabel() {
    const name = formName.trim();
    if (!name) return;
    const url = formUrl.trim();
    // Replace existing entry with the same (normalised) name; otherwise append.
    const key = name.toLowerCase();
    const existingIdx = labels.findIndex(
      (l) => l.name.trim().toLowerCase() === key,
    );
    const next =
      existingIdx >= 0
        ? labels.map((l, i) =>
            i === existingIdx ? { name, imageUrl: url } : l,
          )
        : [...labels, { name, imageUrl: url }];
    setLabels(next);
    setFormName("");
    setFormUrl("");
    setFormOpen(false);
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
          {onReseed && (
            <button
              type="button"
              onClick={onReseed}
              title="Re-import bundled label images"
              aria-label="Re-import bundled label images"
              className="text-muted hover:text-mauve transition-colors p-1
                         rounded-md hover:bg-surface"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setFormOpen(!formOpen)}
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
        {display && display.imageUrl ? (
          <img
            src={display.imageUrl}
            alt={display.name}
            title={display.name}
            className={
              "aspect-square h-full max-w-full rounded-md object-cover " +
              (editing ? "ring-2 ring-accent/70" : "")
            }
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className={
              "aspect-square h-full max-w-full rounded-md border flex " +
              "flex-col items-center justify-center gap-1 text-center px-2 " +
              (editing
                ? "border-accent/70 border-solid bg-bg/40"
                : "border-dashed border-surface bg-bg/30")
            }
          >
            {display ? (
              <>
                <span className="text-[10px] uppercase tracking-wide text-muted">
                  [no data]
                </span>
                <span
                  className="text-xs text-fg/80 truncate max-w-full"
                  title={display.name}
                >
                  {display.name}
                </span>
              </>
            ) : (
              <span className="text-muted text-xs">
                {labels.length === 0
                  ? "no label images"
                  : "no match for this release"}
              </span>
            )}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="label name (matches release.label)"
            className="px-2 py-1 rounded-md bg-surface text-fg text-xs
                       outline-none border border-transparent
                       focus:border-accent/50 placeholder:text-muted"
            spellCheck={false}
          />
          <input
            type="text"
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            placeholder="https://i.nostr.build/…"
            className="px-2 py-1 rounded-md bg-surface text-fg text-xs
                       font-mono outline-none border border-transparent
                       focus:border-accent/50 placeholder:text-muted"
            spellCheck={false}
          />
          <p className="text-[10px] text-muted leading-snug">
            Tip: upload the image to{" "}
            <span className="font-mono text-mauve">nostr.build</span> first,
            then paste the URL here so the label syncs across devices.
          </p>
          <button
            type="button"
            onClick={addLabel}
            disabled={!formName.trim()}
            className={`${DB_BUTTON_CLS} justify-center disabled:opacity-50`}
          >
            <Plus size={12} /> Save
          </button>
        </div>
      )}
    </Section>
  );
}
