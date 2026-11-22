import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, ImageUp, Pause, Play, Plus, Tag, Trash2, Upload, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useReview } from "../lib/review";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
import {
  getLabelOverview,
  migrateLabelArtToBlossom,
  publishLabels,
  uploadFeedImage,
  type ImportProgress,
  type LabelOverview,
  type Release,
} from "../lib/tauri";

export interface LabelEntry {
  name: string;
  imageUrl: string;
  // Optional label website — shown as a clickable link under the image.
  siteUrl?: string;
  // A file in the label art folder picked by hand, when the name match is
  // wrong or finds nothing (a file name, not a path).
  artFile?: string;
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
  themeA: { wrap: "bg-black/5", n: "text-[#34d399]", disc: "text-[#f0f6fc]" },
  themeB: { wrap: "bg-black/5", n: "text-[#ff7849]", disc: "text-[#c9d1d9]" },
  ink: { wrap: "bg-transparent", n: "text-black", disc: "text-black" },
};

interface Props {
  labels: LabelEntry[];
  setLabels: (next: LabelEntry[]) => void;
  selected: Release | null;
  // Removes every stored label (the parent handles the confirm dialog).
  onClearAll?: () => void;
  // Relay set for the labels.v1 manifest publish (kind:31238). Wired
  // through from App.tsx so it stays in sync with the release-publish
  // relay set the user already configures.
  relays: string[];
  // Ordered Blossom servers (first = primary). Empty hides the label-art move.
  blossomServers: string[];
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
  formName: string;
  setFormName: (name: string) => void;
  formUrl: string;
  setFormUrl: (url: string) => void;
  formSite: string;
  setFormSite: (url: string) => void;
  // True when the detail card is collapsed and this column has spare height.
  // The panel then spends it on a read-only at-a-glance strip for the label on
  // screen. Additive ONLY in this mode, so nothing shifts when the detail card
  // is open. Mirrors NostrPanel's `roomy` / LabelviewPanel's `fill`.
  roomy?: boolean;
}

// localStorage key for the fingerprint of the last-published labels.v1
// manifest. Used to flip the publish-labels icon between "up to date"
// and "unpublished changes pending" without a relay round-trip.
const LABELS_PUBLISHED_KEY = "ndisc.labels.publishedFingerprint";

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

// Strip the protocol and any trailing slash for a compact link label.
function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function LabelPanel({
  labels,
  setLabels,
  selected,
  onClearAll,
  relays,
  blossomServers,
  formOpen,
  setFormOpen,
  formName,
  setFormName,
  formUrl,
  setFormUrl,
  formSite,
  setFormSite,
  roomy = false,
}: Props) {
  const [cycleIndex, setCycleIndex] = useState(0);
  const cycleRef = useRef(cycleIndex);
  cycleRef.current = cycleIndex;

  // At-a-glance stats for whichever label is currently on screen. Read-only,
  // fetched only while `roomy` — the strip is the sole consumer.
  const [overview, setOverview] = useState<LabelOverview | null>(null);

  // Labels.v1 manifest publish state. Counts only entries with a real
  // imageUrl since those are the only ones that benefit the consumer.
  const [publishingLabels, setPublishingLabels] = useState(false);
  const publishable = useMemo(
    () => labels.filter((l) => l.imageUrl && l.imageUrl.startsWith("http")),
    [labels],
  );

  // Dirty-state tracking for the publish-labels icon. After each
  // successful publish we persist a fingerprint of the publishable map;
  // any subsequent local edit that changes the fingerprint flips the
  // icon to its "needs publish" state. Lives in localStorage so the
  // indication survives app restarts (a fresh install / cleared
  // localStorage reads as dirty, which is correct — nothing's been
  // pushed under this client yet).
  const currentFingerprint = useMemo(
    () =>
      publishable
        .map((l) => `${l.name}\u0000${l.imageUrl}`)
        .sort()
        .join("\n"),
    [publishable],
  );
  const [publishedFingerprint, setPublishedFingerprint] = useState<string>(
    () => localStorage.getItem(LABELS_PUBLISHED_KEY) ?? "",
  );
  const hasPendingChanges =
    publishable.length > 0 && currentFingerprint !== publishedFingerprint;

  async function onPublishLabels() {
    if (publishingLabels || publishable.length === 0 || relays.length === 0) return;
    const verb = publishedFingerprint ? "Republish" : "Publish";
    const ok = await ask(
      `${verb} ${publishable.length} record-label image${
        publishable.length === 1 ? "" : "s"
      } as a labels.v1 manifest (kind:31238) to ${relays.length} relay${
        relays.length === 1 ? "" : "s"
      }?\n\n` +
        `Glmps web viewers will render these on matching release pages. Republishing replaces the previous manifest.`,
      { title: `${verb} labels manifest`, kind: "info" },
    );
    if (!ok) return;
    setPublishingLabels(true);
    try {
      const result = await publishLabels(
        publishable.map((l) => ({ name: l.name, imageUrl: l.imageUrl })),
        relays,
      );
      const accepted = result.acceptedBy.length;
      const rejected = result.rejected.length;
      // Mark the just-pushed state as the new baseline so the dirty
      // indicator clears. Only stamp if at least one relay accepted —
      // a total failure shouldn't claim the publish happened.
      if (accepted > 0) {
        localStorage.setItem(LABELS_PUBLISHED_KEY, currentFingerprint);
        setPublishedFingerprint(currentFingerprint);
      }
      await ask(
        `Published labels manifest (event ${result.eventId.slice(0, 8)}…).\n\n` +
          `Accepted by ${accepted} relay${accepted === 1 ? "" : "s"}` +
          (rejected ? `, rejected by ${rejected}.` : "."),
        { title: "Labels manifest published", kind: "info" },
      );
    } catch (e) {
      await ask(`Publish failed:\n\n${e}`, {
        title: "Labels manifest — error",
        kind: "error",
      });
    } finally {
      setPublishingLabels(false);
    }
  }

  // Label art still hosted somewhere other than the primary Blossom server.
  const primaryBlossom = blossomServers[0] ?? null;
  const artElsewhere = useMemo(
    () =>
      primaryBlossom
        ? publishable.filter(
            (l) => !l.imageUrl.startsWith(`${primaryBlossom}/`),
          )
        : [],
    [publishable, primaryBlossom],
  );
  // Labels can share one image (the bulk placeholder, an imprint and its
  // parent); the move fetches and uploads each address once.
  const artImages = useMemo(
    () => new Set(artElsewhere.map((l) => l.imageUrl.trim())).size,
    [artElsewhere],
  );
  const artSummary =
    `${artImages} image${artImages === 1 ? "" : "s"} for ` +
    `${artElsewhere.length} label${artElsewhere.length === 1 ? "" : "s"}`;
  // null = idle; otherwise the running move's progress.
  const [movingArt, setMovingArt] = useState<ImportProgress | null>(null);

  // Move label art onto Blossom, then store the new addresses. That changes
  // the publishable set, so the publish icon lights up on its own — sending
  // the new manifest stays a separate, deliberate step.
  async function onMoveArt() {
    if (movingArt || artElsewhere.length === 0 || !primaryBlossom) return;
    const n = artElsewhere.length;
    const ok = await ask(
      `Move ${artSummary} to ${primaryBlossom}?\n\n` +
        "Each image is downloaded from the address it has now, checked, and " +
        "uploaded under its SHA-256 — the same picture at a new address. " +
        "Nothing is deleted from the old host.\n\n" +
        "Nothing is published. Readers keep the old addresses until you " +
        "republish the labels manifest.",
      { title: "Move label art to Blossom", kind: "info" },
    );
    if (!ok) return;

    setMovingArt({ current: 0, total: n, currentDir: "" });
    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<ImportProgress>("label-art:progress", (e) => {
          setMovingArt(e.payload);
        }),
      );
      const result = await migrateLabelArtToBlossom(
        blossomServers,
        labels.map((l) => ({ name: l.name, imageUrl: l.imageUrl })),
      );
      // Keyed by old address: labels sharing one image all follow it.
      const moved = new Map(
        result.moves
          .filter((m) => m.status === "ok" && m.newUrl)
          .map((m) => [m.oldUrl, m.newUrl as string] as const),
      );
      if (moved.size > 0) {
        setLabels(
          labels.map((l) => {
            const next = moved.get(l.imageUrl.trim());
            return next ? { ...l, imageUrl: next } : l;
          }),
        );
      }
      const failed = result.errors.length;
      await ask(
        `Moved ${moved.size} image${moved.size === 1 ? "" : "s"} to Blossom, for ` +
          `${result.migrated} label${result.migrated === 1 ? "" : "s"}.` +
          (failed
            ? `\n\n${failed} could not be moved and keep their old address:\n` +
              result.errors.slice(0, 8).join("\n") +
              (failed > 8 ? `\n… and ${failed - 8} more` : "")
            : "") +
          (result.migrated > 0
            ? "\n\nRepublish the labels manifest to make the new addresses public."
            : ""),
        {
          title: "Label art",
          kind: failed ? "warning" : "info",
        },
      );
    } catch (e) {
      await ask(`Move failed:\n\n${e}`, {
        title: "Label art — error",
        kind: "error",
      });
    } finally {
      unlisteners.forEach((f) => f());
      setMovingArt(null);
    }
  }

  // Flips true once a freshly selected release has been pinned long enough
  // (RESELECT_MS) that the panel should resume the looping carousel.
  const [releaseExpired, setReleaseExpired] = useState(false);

  // True when the currently shown label image fails to load — the panel
  // then falls back to the placeholder. Reset (below) whenever the shown
  // image URL changes, so a corrected URL gets a fresh load attempt.
  const [imageFailed, setImageFailed] = useState(false);

  // Carousel pause toggle — session-only, applies while idle.
  const [paused, setPaused] = useState(false);

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

  // Cycle the carousel only while idle, not paused, and 2+ slides exist.
  useEffect(() => {
    if (!idle || paused || slides.length < 2) return;
    const t = window.setInterval(() => {
      setCycleIndex((i) => (i + 1) % slides.length);
    }, CYCLE_MS);
    return () => window.clearInterval(t);
  }, [idle, paused, slides.length]);

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

  // editingEntry wins: while the form is open the panel must show the label
  // being configured — not the selected release's matched label.
  const display: LabelEntry | null =
    editingEntry ??
    (idle ? null : match) ??
    (idle ? null : releaseLabelPlaceholder) ??
    (slide?.kind === "label" ? slide.entry : null);

  const brandVariant: BrandVariant | null =
    display == null && slide?.kind === "brand" ? slide.variant : null;

  // Website link shown under the image for whichever label is on screen.
  const siteUrl = display?.siteUrl?.trim() || null;

  // Stats follow whatever is on screen — including the idle carousel — so the
  // strip always describes the label you are actually looking at.
  const overviewName = display?.name?.trim() || null;
  useEffect(() => {
    if (!roomy || !overviewName) {
      setOverview(null);
      return;
    }
    let cancelled = false;
    getLabelOverview(overviewName)
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch(() => {
        if (!cancelled) setOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [roomy, overviewName]);

  const isSynthetic = display != null && display === releaseLabelPlaceholder;
  // "Not On Label" is Discogs shorthand for a self-released record — there's
  // no label art to chase, so present it muted rather than as missing art.
  const isSelfReleased =
    !idle &&
    (selected?.label?.trim().toLowerCase() ?? "") === "not on label";
  const awaitingArt =
    display != null && !display.imageUrl && !isSelfReleased;
  const editing = formOpen;

  // A broken or stale URL must not stick: clear the failed flag whenever the
  // shown image changes (carousel advance, release switch, or a URL edit).
  const shownImageUrl = display?.imageUrl ?? "";
  useEffect(() => {
    setImageFailed(false);
  }, [shownImageUrl]);

  const [formUploading, setFormUploading] = useState(false);
  const [formUploadErr, setFormUploadErr] = useState<string | null>(null);

  // The form's label in the label art folder: the matched or picked file.
  const review = useReview();
  const formKey = formName.trim().toLowerCase();
  const formEntry = labels.find((l) => l.name.trim().toLowerCase() === formKey) ?? null;
  const formMatch = formKey ? review.artMatchFor(formName) : null;
  const [pickErr, setPickErr] = useState<string | null>(null);
  const setArtFile = (file: string | undefined) => {
    if (!formEntry) return;
    setLabels(labels.map((l) => (l === formEntry ? { ...l, artFile: file } : l)));
  };
  async function pickArtFile() {
    setPickErr(null);
    const folder = review.artFolder;
    if (!folder || !formEntry) return;
    const p = await openDialog({
      multiple: false,
      defaultPath: folder,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif"] }],
      title: `Label art for ${formEntry.name}`,
    });
    if (typeof p !== "string") return;
    const cut = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    const dir = p.slice(0, cut).replace(/[\\/]+$/, "");
    if (dir !== folder.replace(/[\\/]+$/, "")) {
      setPickErr("Pick a file directly in the label art folder.");
      return;
    }
    setArtFile(p.slice(cut + 1));
  }

  // Pick a local image, upload it to the primary Blossom server, and put its
  // address in the form. Saving the label (and publishing the manifest) stays
  // a separate, explicit step.
  async function uploadFormImage() {
    setFormUploadErr(null);
    const p = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (typeof p !== "string") return;
    setFormUploading(true);
    try {
      setFormUrl(await uploadFeedImage(p, blossomServers));
    } catch (e) {
      setFormUploadErr(`upload failed: ${e}`);
    } finally {
      setFormUploading(false);
    }
  }

  function addLabel() {
    const name = formName.trim();
    if (!name) return;
    const url = formUrl.trim();
    const site = formSite.trim();
    const fresh: LabelEntry = { name, imageUrl: url };
    if (site) fresh.siteUrl = site;
    // Replace existing entry with the same (normalised) name; otherwise append.
    const key = name.toLowerCase();
    const existingIdx = labels.findIndex(
      (l) => l.name.trim().toLowerCase() === key,
    );
    const next =
      existingIdx >= 0
        ? labels.map((l, i) =>
            // Keep the existing entry's name casing; update image + website.
            i === existingIdx
              ? { ...l, imageUrl: url, siteUrl: site || undefined }
              : l,
          )
        : [...labels, fresh];
    setLabels(next);
    setFormName("");
    setFormUrl("");
    setFormSite("");
    setFormOpen(false);
  }

  function removeCurrent() {
    if (!display) return;
    setLabels(labels.filter((l) => l !== display));
  }

  return (
    <Section
      title=""
      icon={<Tag size={16} />}
      right={
        <div className="flex items-center gap-1">
          {idle && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              title={paused ? "Resume carousel" : "Pause carousel"}
              aria-label={paused ? "Resume carousel" : "Pause carousel"}
              className="text-muted hover:text-mauve transition-colors p-1
                         rounded-md hover:bg-surface"
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
          )}
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
          {(artElsewhere.length > 0 || movingArt) && (
            <button
              type="button"
              onClick={onMoveArt}
              disabled={movingArt !== null}
              title={
                movingArt
                  ? `Moving label art — ${movingArt.current}/${movingArt.total} ${movingArt.currentDir}`
                  : `Move label art to Blossom: ${artSummary}`
              }
              aria-label="Move label art to Blossom"
              className="relative text-muted hover:text-nostr transition-colors p-1
                         rounded-md hover:bg-surface disabled:opacity-70"
            >
              <ImageUp size={12} className={movingArt ? "animate-pulse" : ""} />
              {/* The publish button's dot: label art is waiting to move. */}
              {artElsewhere.length > 0 && !movingArt && (
                <span
                  aria-hidden="true"
                  className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-mauve"
                />
              )}
            </button>
          )}
          {publishable.length > 0 && relays.length > 0 && (
            <button
              type="button"
              onClick={onPublishLabels}
              disabled={publishingLabels}
              title={
                publishingLabels
                  ? "Publishing…"
                  : hasPendingChanges
                    ? publishedFingerprint
                      ? `Unpublished changes — republish ${publishable.length} label image${
                          publishable.length === 1 ? "" : "s"
                        } (kind:31238)`
                      : `Publish ${publishable.length} label image${
                          publishable.length === 1 ? "" : "s"
                        } as a labels.v1 manifest (kind:31238)`
                    : `Labels manifest is up to date (${publishable.length} entries published)`
              }
              aria-label="Publish labels manifest to Nostr"
              className={
                "relative transition-colors p-1 rounded-md hover:bg-surface " +
                "disabled:opacity-50 " +
                (hasPendingChanges
                  ? "text-mauve hover:opacity-80"
                  : "text-muted/50 hover:text-mauve")
              }
            >
              <Upload size={12} className={publishingLabels ? "animate-pulse" : ""} />
              {hasPendingChanges && !publishingLabels && (
                <span
                  aria-hidden="true"
                  className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-mauve"
                />
              )}
            </button>
          )}
          {onClearAll && labels.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              title={`Remove all ${labels.length} label${
                labels.length === 1 ? "" : "s"
              }`}
              aria-label="Remove all labels"
              className="text-muted hover:text-alert transition-colors p-1
                         rounded-md hover:bg-surface"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setFormOpen(!formOpen)}
            title={
              formOpen
                ? "Close the label form"
                : awaitingArt
                  ? "Add an image for this label"
                  : "Add label image"
            }
            aria-label={formOpen ? "Close the label form" : "Add label image"}
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
      {/* Top-aligned wrapper — the panel grid uses items-stretch, so the LABEL
          section is often taller than this image+URL block. Keep the image
          pinned to the top of the section (no my-auto centring) so it lines up
          with the tops of the adjacent Nostr/Label-list panels. */}
      <div>
      <div
        className={
          "flex justify-center transition-opacity duration-300 " +
          (idle && !paused
            ? "opacity-60 hover:opacity-100"
            : "opacity-100")
        }
      >
        {/* The art is width-driven — it scales to the column (capped) instead
            of sitting at a fixed 140px square adrift in the panel, so it fills
            the horizontal room. When the column is `roomy` (detail card
            collapsed) it takes a larger cap to spend the freed height. The cap
            keeps it near the neighbouring panels' height so the 3-panel row
            doesn't grow out from under the art. */}
        <div
          className={cn(
            "w-full mx-auto",
            roomy ? "max-w-[248px]" : "max-w-[200px]",
          )}
        >
        {brandVariant ? (
          <BrandCard variant={brandVariant} />
        ) : display && display.imageUrl && !imageFailed ? (
          // Image is wrapped so a translucent accent layer can sit on top
          // with mix-blend-mode: lighten — darks lift toward the theme
          // accent (clean bg wash on the typical black-bg label art),
          // while bright logo channels stay closer to their original
          // colour than screen would leave them. A gentle saturate(.9)
          // on the image tames hue contamination from punchy logos so
          // the overlay doesn't push them too far off-hue.
          <div
            className={cn(
              "relative aspect-square w-full rounded-md overflow-hidden",
              editing && "ring-2 ring-accent/70",
            )}
          >
            <img
              src={display.imageUrl}
              alt={display.name}
              title={display.name}
              className="absolute inset-0 w-full h-full object-cover
                         saturate-[.9]"
              onError={() => setImageFailed(true)}
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-accent/30 mix-blend-lighten
                         pointer-events-none"
            />
          </div>
        ) : (
          <div
            className={
              "aspect-square w-full rounded-md border-2 flex " +
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
                    {imageFailed ? "image unavailable" : "[no data]"}
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
      </div>

      {/* Fixed-height slot so the panel keeps its total height whether the
          current label has a website URL or not — avoids the panel
          shrinking by ~14px (and pulling the rest of the layout up) when
          you move between labels with/without siteUrl. */}
      <div className="mt-1.5 h-[14px]">
        {siteUrl && (
          <button
            type="button"
            onClick={() => openUrl(siteUrl)}
            title={siteUrl}
            className="block w-full truncate text-center text-[10px]
                       text-accent hover:underline"
          >
            {prettyUrl(siteUrl)}
          </button>
        )}
      </div>
      </div>{/* close top-aligned wrapper */}

      {/* At-a-glance strip — only when the detail card is collapsed and this
          column has height to spare, and only while the add/edit form is shut
          (the form is the thing you came for; stats shouldn't crowd it).
          Strictly read-only: it reports rows already in the DB and touches
          neither the labels.v1 manifest nor any publishing path. */}
      {roomy && !formOpen && overview && overview.releases > 0 && (
        <div className="mt-3 pt-2.5 border-t border-surface">
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-[10px]">
            <LabelStat label="releases" value={overview.releases.toLocaleString()} />
            <LabelStat
              label="published"
              value={overview.published.toLocaleString()}
              tone={overview.published > 0 ? "nostr" : "muted"}
            />
            <LabelStat
              label="tracks"
              value={overview.tracks.toLocaleString()}
            />
            <LabelStat
              label="years"
              value={
                overview.firstYear == null
                  ? "—"
                  : overview.firstYear === overview.lastYear
                    ? String(overview.firstYear)
                    : `${overview.firstYear}–${overview.lastYear}`
              }
            />
          </div>
        </div>
      )}

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
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="image URL"
              className="flex-1 min-w-0 px-2 py-1 rounded-md bg-surface text-fg text-xs
                         font-mono outline-none border border-transparent
                         focus:border-accent/50 placeholder:text-muted"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={uploadFormImage}
              disabled={formUploading || blossomServers.length === 0}
              title={
                blossomServers.length === 0
                  ? "Add a Blossom server in the Nostr panel first"
                  : "Upload a local image to the primary Blossom server and use its address"
              }
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-surface
                         text-muted hover:text-fg text-[10px] disabled:opacity-40"
            >
              <ImageUp size={11} />
              {formUploading ? "uploading…" : "Upload to Blossom"}
            </button>
          </div>
          {formUploadErr && (
            <p className="text-[10px] text-alert break-words">{formUploadErr}</p>
          )}
          <input
            type="text"
            value={formSite}
            onChange={(e) => setFormSite(e.target.value)}
            placeholder="label website (optional)"
            className="px-2 py-1 rounded-md bg-surface text-fg text-xs
                       font-mono outline-none border border-transparent
                       focus:border-accent/50 placeholder:text-muted"
            spellCheck={false}
          />
          {review.artFolder && formKey && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-surface/40 text-[10px]">
              {formMatch?.file ? (
                <img
                  src={convertFileSrc(`${review.artFolder}/${formMatch.file}`)}
                  alt=""
                  className="w-8 h-8 object-contain bg-surface rounded shrink-0"
                />
              ) : (
                <FolderOpen size={14} className="text-muted shrink-0 mx-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-fg/80 truncate" title={formMatch?.file ?? undefined}>
                  {formMatch?.file ?? "no file in the label art folder"}
                </span>
                <span
                  className={cn(
                    "block",
                    formMatch?.how === "close" || formMatch?.how === "missing" ||
                      formMatch?.how === "fallback"
                      ? "text-warn"
                      : "text-muted",
                  )}
                  title={formMatch && formMatch.others.length > 0 ? formMatch.others.join("\n") : undefined}
                >
                  {formMatch?.how === "picked"
                    ? "picked by hand"
                    : formMatch?.how === "name"
                      ? "matched by name"
                      : formMatch?.how === "close"
                        ? "a close match: check it is this label"
                        : formMatch?.how === "fallback"
                          ? `the picked file (${formMatch.lost}) is gone — this one matches the name`
                          : formMatch?.how === "missing"
                            ? `the picked file (${formMatch.lost}) is not in the folder`
                          : formEntry
                            ? "no file matches the name: pick one"
                            : "save the label first, then pick its file"}
                  {formMatch && formMatch.others.length > 0 && formMatch.how !== "missing" &&
                    ` · ${formMatch.others.length} more file${formMatch.others.length === 1 ? "" : "s"} match`}
                </span>
              </span>
              {formEntry && (
                <button
                  type="button"
                  onClick={pickArtFile}
                  className="shrink-0 px-2 py-0.5 rounded bg-surface text-muted hover:text-fg"
                  title="Choose this label's file in the label art folder by hand"
                >
                  Pick…
                </button>
              )}
              {formEntry?.artFile && (
                <button
                  type="button"
                  onClick={() => setArtFile(undefined)}
                  className="shrink-0 text-muted hover:text-fg"
                  title="Forget the hand pick and match by name again"
                  aria-label="Clear the picked file"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )}
          {pickErr && <p className="text-[10px] text-alert">{pickErr}</p>}
          <p className="text-[10px] text-muted leading-snug">
            Paste an image address from any host, or upload a local file to
            your Blossom server. Publish the labels manifest to send it.
          </p>
          <button
            type="button"
            onClick={addLabel}
            disabled={!formName.trim()}
            title={
              !formName.trim()
                ? "Enter a label name to save"
                : labels.some(
                      (l) =>
                        l.name.trim().toLowerCase() ===
                        formName.trim().toLowerCase(),
                    )
                  ? `Update "${formName.trim()}"`
                  : `Save "${formName.trim()}" as a new label`
            }
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
        "aspect-square w-full rounded-md flex items-center " +
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

// One cell of the at-a-glance strip. Same label/value grammar as the header
// StatChip (muted label, mono value) so the two read as one system.
function LabelStat({
  label,
  value,
  tone = "accent",
}: {
  label: string;
  value: string;
  tone?: "accent" | "nostr" | "muted";
}) {
  const toneCls =
    tone === "nostr"
      ? "text-nostr"
      : tone === "muted"
        ? "text-muted"
        : "text-accent";
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      <span className="text-muted shrink-0">{label}</span>
      <span className={`font-mono truncate ${toneCls}`}>{value}</span>
    </span>
  );
}
