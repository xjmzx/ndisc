import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, Tag, X } from "lucide-react";
import { Section } from "./Section";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
import type { Release } from "../lib/tauri";

export interface LabelEntry {
  name: string;
  imageUrl: string;
}

type BrandVariant = "themeA" | "themeB" | "ink";

type Slide =
  | { kind: "label"; entry: LabelEntry }
  | { kind: "brand"; variant: BrandVariant };

const BRAND_VARIANTS: BrandVariant[] = ["themeA", "themeB", "ink"];

// Fixed brand colours — the cards always render theme A / theme B regardless
// of the app's active theme, so the idle carousel previews both palettes.
// The "ink" card is transparent with black text: a near-blank breather slide.
const BRAND_STYLES: Record<
  BrandVariant,
  { wrap: string; n: string; disc: string }
> = {
  themeA: { wrap: "bg-black", n: "text-[#34d399]", disc: "text-[#f0f6fc]" },
  themeB: { wrap: "bg-black", n: "text-[#ff7849]", disc: "text-[#c9d1d9]" },
  ink: { wrap: "bg-transparent", n: "text-black", disc: "text-black" },
};

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

// How long each carousel slide is shown.
const CYCLE_MS = 21_000;

// After a release is selected the panel pins to its label this long, then
// falls back to the looping carousel on its own.
const RESELECT_MS = 10_000;

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

  // Flips true once a freshly selected release has been pinned long enough
  // (RESELECT_MS) that the panel should resume the looping carousel.
  const [releaseExpired, setReleaseExpired] = useState(false);

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

  // Pin the panel to a newly selected release, then after RESELECT_MS let
  // it expire so the panel falls back to the looping carousel.
  useEffect(() => {
    setReleaseExpired(false);
    if (!selected) return;
    const t = window.setTimeout(() => setReleaseExpired(true), RESELECT_MS);
    return () => window.clearTimeout(t);
  }, [selected]);

  // Idle = nothing pinned: no release (or its pin expired) and no form open.
  const idle = (!selected || releaseExpired) && !formOpen;

  // Carousel slides: label art interleaved with three ndisc brand cards.
  // The brand cards break up the run of label images and give a fresh
  // install (no labels seeded yet) something branded to show.
  const slides: Slide[] = useMemo(() => {
    const brands: Slide[] = BRAND_VARIANTS.map((variant) => ({
      kind: "brand",
      variant,
    }));
    if (labels.length === 0) return brands;
    const out: Slide[] = [brands[0]];
    const rest = brands.slice(1);
    const gap = Math.max(1, Math.ceil(labels.length / (rest.length + 1)));
    let b = 0;
    labels.forEach((entry, i) => {
      out.push({ kind: "label", entry });
      if ((i + 1) % gap === 0 && b < rest.length) out.push(rest[b++]);
    });
    while (b < rest.length) out.push(rest[b++]);
    return out;
  }, [labels]);

  // Cycle the carousel only while idle and there are 2+ slides.
  useEffect(() => {
    if (!idle || slides.length < 2) return;
    const t = window.setInterval(() => {
      setCycleIndex((i) => (i + 1) % slides.length);
    }, CYCLE_MS);
    return () => window.clearInterval(t);
  }, [idle, slides.length]);

  // Clamp cycleIndex if the slide count shrinks.
  useEffect(() => {
    if (cycleRef.current >= slides.length && slides.length > 0) {
      setCycleIndex(0);
    }
  }, [slides.length]);

  // If the selected release has a label but we have no entry for it,
  // synthesize a placeholder so the panel shows "no art for THIS label"
  // instead of cycling through other label images.
  const releaseLabelPlaceholder: LabelEntry | null = useMemo(() => {
    const name = selected?.label?.trim() ?? "";
    if (!name || match) return null;
    return { name, imageUrl: "" };
  }, [selected, match]);

  // While pinned, show release-specific content and never borrow another
  // label's art. While idle, show the carousel slide.
  const slide: Slide | null = idle ? slides[cycleIndex] ?? null : null;

  const display: LabelEntry | null =
    (idle ? null : match) ??
    editingEntry ??
    (idle ? null : releaseLabelPlaceholder) ??
    (slide?.kind === "label" ? slide.entry : null);

  const brandVariant: BrandVariant | null =
    display == null && slide?.kind === "brand" ? slide.variant : null;

  const isSynthetic = display != null && display === releaseLabelPlaceholder;
  // "Not On Label" is Discogs shorthand for a self-released record — there's
  // no label art to chase, so present it muted rather than as missing art.
  const isSelfReleased =
    !idle &&
    (selected?.label?.trim().toLowerCase() ?? "") === "not on label";
  const awaitingArt =
    display != null && !display.imageUrl && !isSelfReleased;
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
          {display && display !== match && !isSynthetic && (
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
              title="Re-seed missing labels from the built-in list"
              aria-label="Re-seed missing labels from the built-in list"
              className="text-muted hover:text-mauve transition-colors p-1
                         rounded-md hover:bg-surface"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setFormOpen(!formOpen)}
            title={awaitingArt ? "Add an image for this label" : "Add label image"}
            aria-label="Add label image"
            className={
              "transition-colors p-1 rounded-md hover:bg-surface " +
              (awaitingArt && !formOpen
                ? "text-mauve ring-1 ring-mauve/50 bg-mauve/10"
                : "text-muted hover:text-mauve")
            }
          >
            <Plus size={14} />
          </button>
        </div>
      }
    >
      <div
        className={
          "h-[186px] flex items-center justify-center transition-opacity " +
          "duration-300 " +
          (idle ? "opacity-60 hover:opacity-100" : "opacity-100")
        }
      >
        {brandVariant ? (
          <BrandCard variant={brandVariant} />
        ) : display && display.imageUrl ? (
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
              "aspect-square h-full max-w-full rounded-md border-2 flex " +
              "flex-col items-center justify-center gap-1 text-center px-2 " +
              (editing
                ? "border-accent/70 border-solid bg-bg/40"
                : awaitingArt
                  ? "border-dashed border-mauve/50 bg-mauve/5"
                  : "border-dashed border-surface bg-bg/30")
            }
          >
            {display ? (
              isSelfReleased ? (
                <span className="text-xs text-muted">Self-released</span>
              ) : (
                <>
                  <span className="text-[10px] uppercase tracking-wide text-mauve/80">
                    [no data]
                  </span>
                  <span
                    className="text-xs text-fg/80 truncate max-w-full"
                    title={display.name}
                  >
                    {display.name}
                  </span>
                </>
              )
            ) : (
              <span className="text-muted text-xs">
                {selected ? "no label" : "no label images"}
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

// A square ndisc-branded carousel slide. Brand colours are fixed (not the
// app's active theme) so the carousel can preview both palettes. The "n" and
// "disc" weights match the app title header.
function BrandCard({ variant }: { variant: BrandVariant }) {
  const s = BRAND_STYLES[variant];
  return (
    <div
      className={
        "aspect-square h-full max-w-full rounded-md flex items-center " +
        "justify-center select-none " +
        s.wrap
      }
    >
      <span
        className={"text-2xl font-bold tracking-tight leading-none " + s.n}
      >
        n<span className={s.disc}>disc</span>
      </span>
    </div>
  );
}
