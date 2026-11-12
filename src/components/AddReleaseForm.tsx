import { FormEvent, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Disc,
  Image as ImageIcon,
  Loader2,
  Save,
  StickyNote,
} from "lucide-react";
import { Section } from "./Section";
import { CoverArt } from "./CoverArt";
import { GenrePicker } from "./GenrePicker";
import {
  addRelease,
  setReleaseLink,
  setReleaseSource,
  type Release,
} from "../lib/tauri";
import {
  GENRE_SLOT_CAP,
  houseGenreOrder,
} from "../lib/genre";

interface Props {
  onAdded: () => void;
  // Extra classes for the card (Home makes it fill the column).
  className?: string;
}

type Medium = "physical" | "digital";

const EMPTY: Release = {
  artist: "",
  title: "",
  year: new Date().getFullYear(),
  // No default: Digital or Physical must be chosen before Save.
  medium: null,
  format: "",
  label: "",
  catalogNumber: "",
  country: "",
  condition: "",
  notes: "",
  source: "",
  coverArtUrl: "",
  releaseType: "music",
  category: "",
};

// Laid out as a mirror of Release detail: the cover square with the release's
// identity beside it (medium, artist, title, year · format · condition), then
// the same rows Release detail has under its cover — cover URL | notes; type ·
// category · label · source · catalog · country · link; electronic + genres —
// at the same widths, and Save where detail has its action bar. These are
// plain inputs, not detail's editors: those save each field to an existing
// release, and a new one has no id until Save.
export function AddReleaseForm({
  onAdded,
  className,
}: Props) {
  const [release, setRelease] = useState<Release>(EMPTY);
  // Fields that aren't columns add_release writes: the acquisition source and
  // the link box go through the same calls Release detail uses, after insert.
  const [sourceLabel, setSourceLabel] = useState("");
  const [link, setLink] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Release>(key: K, value: Release[K]) {
    setRelease((r) => ({ ...r, [key]: value }));
    setError(null);
  }

  function reset() {
    setRelease(EMPTY);
    setSourceLabel("");
    setLink("");
    setGenres([]);
  }

  // The essentials a release needs before it can be saved; everything else
  // can come later from the link and Enrich.
  const missing = [
    !release.medium && "digital or physical",
    !release.artist.trim() && "artist",
    !release.title.trim() && "title",
    release.year == null && "year",
    !(release.format ?? "").trim() && "format",
  ].filter((m): m is string => !!m);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (missing.length) {
      setError(`needs ${missing.join(", ")}`);
      return;
    }
    setSaving(true);
    setError(null);
    const slots = houseGenreOrder(genres.slice(0, GENRE_SLOT_CAP));
    let id: number;
    try {
      id = await addRelease({
        ...release,
        artist: release.artist.trim(),
        title: release.title.trim(),
        genrePrimary: slots[0] ?? null,
        genreSecondary: slots[1] ?? null,
        genreTertiary: slots[2] ?? null,
        genreQuaternary: slots[3] ?? null,
        genreQuinary: slots[4] ?? null,
      });
    } catch (e) {
      setError(String(e));
      setSaving(false);
      return;
    }
    // The release exists now; a refused link or source shouldn't lose it.
    const problems: string[] = [];
    if (link.trim()) {
      await setReleaseLink(id, link.trim()).catch((e) =>
        problems.push(`link not saved: ${String(e)}`),
      );
    }
    if (sourceLabel.trim()) {
      await setReleaseSource(id, sourceLabel.trim()).catch((e) =>
        problems.push(`source not saved: ${String(e)}`),
      );
    }
    reset();
    setSaving(false);
    if (problems.length) setError(`Release added, but ${problems.join("; ")}`);
    onAdded();
  }

  // Preview only a complete-looking web address, so a half-typed URL doesn't
  // flash "cover failed to load".
  const typedCover = (release.coverArtUrl ?? "").trim();
  const coverPreview = /^https?:\/\/[^/\s]+\/\S+/.test(typedCover)
    ? typedCover
    : null;
  const physical = release.medium === "physical";

  return (
    <Section title="Add release" className={className}>
      <form
        onSubmit={onSubmit}
        // Enter in a field never saves: only the Save button does, so a
        // half-filled release can't slip into the library.
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
          }
        }}
        className="text-xs flex flex-col"
      >
        <div className="flex gap-4 items-stretch">
          <CoverArt src={coverPreview} alt="cover preview" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <MediumToggle
              value={release.medium ?? null}
              onChange={(m) => set("medium", m)}
            />
            <input
              type="text"
              value={release.artist}
              onChange={(e) => set("artist", e.target.value)}
              placeholder="artist"
              aria-label="artist"
              spellCheck={false}
              className={`${INPUT_CLS} w-full`}
            />
            <input
              type="text"
              value={release.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="title"
              aria-label="title"
              spellCheck={false}
              className={`${INPUT_CLS} w-full`}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <YearControl
                value={release.year ?? null}
                onChange={(v) => set("year", v)}
              />
              <FormatSelect
                value={release.format ?? ""}
                onChange={(v) => set("format", v)}
              />
              {physical && (
                <>
                  <Disc
                    size={12}
                    className="text-muted shrink-0"
                    aria-label="physical-only"
                  />
                  <ConditionSelect
                    value={release.condition ?? ""}
                    onChange={(v) => set("condition", v)}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* cover url | notes — the same line as in Release detail */}
        <div className="mt-4 flex items-center gap-4">
          <div className="grid grid-cols-[max-content_1fr] gap-x-3 items-center flex-1 min-w-0 max-w-md">
            <span className="text-muted flex items-center" title="cover url">
              <ImageIcon size={14} aria-label="cover url" />
            </span>
            <input
              type="text"
              value={release.coverArtUrl ?? ""}
              onChange={(e) => set("coverArtUrl", e.target.value)}
              placeholder="https://…/cover.jpg"
              aria-label="cover url"
              spellCheck={false}
              className={`${SMALL_CLS} w-full min-w-0 font-mono`}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-muted flex items-center"
              title="notes — published with the release"
            >
              <StickyNote size={14} aria-label="notes" />
            </span>
            <input
              type="text"
              value={release.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="notes"
              aria-label="notes"
              className={`${SMALL_CLS} w-28`}
            />
          </div>
        </div>

        {/* type · category · label · source · catalog · country · link, then
            electronic + genres — Release detail's field grid, same widths. */}
        <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TypeSelect
            value={release.releaseType ?? ""}
            onChange={(v) => set("releaseType", v)}
          />
          <CategorySelect
            value={release.category ?? ""}
            onChange={(v) => set("category", v)}
          />
          <input
            type="text"
            value={release.label ?? ""}
            onChange={(e) => set("label", e.target.value)}
            placeholder="label"
            aria-label="label"
            spellCheck={false}
            className={`${CHIP_CLS} w-40`}
          />
          <input
            type="text"
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder="source"
            aria-label="source"
            title="Where you got it — Bandcamp, Record Store… (local only)"
            spellCheck={false}
            className={`${CHIP_CLS} w-40`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <input
            type="text"
            value={release.catalogNumber ?? ""}
            onChange={(e) => set("catalogNumber", e.target.value)}
            placeholder="catalog"
            aria-label="catalog"
            spellCheck={false}
            className={`${CHIP_CLS} w-28`}
          />
          <input
            type="text"
            value={release.country ?? ""}
            onChange={(e) => set("country", e.target.value)}
            placeholder="country"
            aria-label="country"
            spellCheck={false}
            className={`${CHIP_CLS} w-32`}
          />
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="discogs · mb · store"
            aria-label="release link"
            title="A Discogs or MusicBrainz release link, or a store link (Bandcamp, Apple Music, Spotify)"
            spellCheck={false}
            className={`${CHIP_CLS} w-28`}
          />
        </div>
        {/* Genres sit apart from the fields, as in Release detail. */}
        <div className="!mt-4 pt-3 border-t border-surface/60 flex flex-wrap items-center gap-x-3 gap-y-2">
          <GenrePicker value={genres} onChange={setGenres} />
        </div>
        </div>

        {/* Save sits where Release detail has its action bar. */}
        <div className="mt-4 pt-3 border-t border-surface/60 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || missing.length > 0}
            title={
              saving
                ? "saving…"
                : missing.length
                  ? `Fill in ${missing.join(", ")} first`
                  : "Save release"
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                       bg-accent text-bg font-semibold hover:opacity-90
                       disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save release
          </button>
          {missing.length > 0 && !error && (
            <span className="text-muted">needs {missing.join(", ")}</span>
          )}
          {error && <span className="text-alert">{error}</span>}
        </div>
      </form>
    </Section>
  );
}

// Release detail's resting field chip (EditableText/EditableEnum): 24px tall,
// faint fill, thin border that lights on hover/focus, italic placeholder.
const CHIP_CLS =
  "h-6 px-1.5 py-0 rounded bg-surface/40 hover:bg-surface/70 text-fg/90 " +
  "outline-none border border-surface/60 hover:border-accent/50 " +
  "focus:border-accent/50 transition-colors " +
  "placeholder:italic placeholder:text-muted/50";
// Release detail's cover-URL and notes fields: smaller text, same fill.
const SMALL_CLS =
  "px-2 py-1 rounded bg-surface/40 text-fg outline-none border " +
  "border-surface/60 focus:border-accent/50 text-[10px] placeholder:text-muted/60";
const INPUT_CLS =
  "px-2 py-1 rounded-md bg-surface text-fg outline-none " +
  "border border-transparent focus:border-accent/50 placeholder:text-muted";

function MediumToggle({
  value,
  onChange,
}: {
  value: Medium | null;
  onChange: (v: Medium) => void;
}) {
  return (
    <div>
      <div className="flex gap-1">
        <ToggleButton
          active={value === "digital"}
          onClick={() => onChange("digital")}
        >
          Digital
        </ToggleButton>
        <ToggleButton
          active={value === "physical"}
          onClick={() => onChange("physical")}
        >
          Physical
        </ToggleButton>
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-2 rounded-md text-xs font-semibold transition-colors
                  ${
                    active
                      ? "bg-accent text-bg"
                      : "bg-surface text-fg hover:bg-surfaceHover"
                  }`}
    >
      {children}
    </button>
  );
}

function YearControl({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  function step(delta: number) {
    const next = (value ?? new Date().getFullYear()) + delta;
    onChange(next);
  }
  return (
    <div className="inline-flex rounded-md overflow-hidden w-fit">
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
        aria-label="year"
        className="w-16 px-2 py-1 bg-surface text-fg outline-none
                   border border-transparent focus:border-accent/50
                   placeholder:text-muted
                   [&::-webkit-inner-spin-button]:appearance-none
                   [&::-webkit-outer-spin-button]:appearance-none
                   [appearance:textfield]"
      />
      <div className="flex flex-col">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(1)}
          aria-label="increment year"
          className="flex-1 px-1.5 bg-accent text-bg hover:opacity-90
                     flex items-center justify-center"
        >
          <ChevronUp size={10} strokeWidth={3.5} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(-1)}
          aria-label="decrement year"
          className="flex-1 px-1.5 bg-accent text-bg hover:opacity-90
                     flex items-center justify-center border-t border-bg/30"
        >
          <ChevronDown size={10} strokeWidth={3.5} />
        </button>
      </div>
    </div>
  );
}

const FORMAT_OPTIONS = [
  "LP",
  "12\"",
  "7\"",
  "CD",
  "Cassette",
  "Box",
  "FLAC",
  "MP3",
  "AAC",
  "ALAC",
  "WAV",
];

// Discogs's standard condition grades. Values match the exact strings Discogs
// puts in its collection CSV exports so imported entries map cleanly onto
// these options.
const CONDITION_OPTIONS = [
  "Mint (M)",
  "Near Mint (NM or M-)",
  "Very Good Plus (VG+)",
  "Very Good (VG)",
  "Good Plus (G+)",
  "Good (G)",
  "Fair (F)",
  "Poor (P)",
];

function FormatSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="format"
        className="appearance-none pl-2.5 pr-7 py-1 rounded-md bg-surface
                   text-fg outline-none border border-transparent
                   focus:border-accent/50 cursor-pointer text-xs"
      >
        <option value="">format</option>
        {FORMAT_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        strokeWidth={2.5}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted
                   pointer-events-none"
      />
    </div>
  );
}

const TYPE_OPTIONS = [
  "music",
  "sample",
  "stem",
  "field-recording",
  "message",
  "other",
];

const CATEGORY_OPTIONS = [
  "album",
  "ep",
  "single",
  "compilation",
  "mix",
  "live",
  "soundtrack",
  "bootleg",
  "miscellaneous",
];

function TypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative w-fit">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="type"
        className="w-32 h-6 appearance-none pl-1.5 pr-6 py-0 rounded
                   bg-surface/40 hover:bg-surface/70 text-fg/90 outline-none
                   border border-surface/60 hover:border-accent/50
                   focus:border-accent/50 transition-colors cursor-pointer text-xs"
      >
        <option value="">—</option>
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        strokeWidth={2.5}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted
                   pointer-events-none"
      />
    </div>
  );
}

function CategorySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative w-fit">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="category"
        className="w-32 h-6 appearance-none pl-1.5 pr-6 py-0 rounded
                   bg-surface/40 hover:bg-surface/70 text-fg/90 outline-none
                   border border-surface/60 hover:border-accent/50
                   focus:border-accent/50 transition-colors cursor-pointer text-xs"
      >
        <option value="">category</option>
        {CATEGORY_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        strokeWidth={2.5}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted
                   pointer-events-none"
      />
    </div>
  );
}

function ConditionSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative w-fit">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="condition"
        className="appearance-none pl-2.5 pr-7 py-1 rounded-md bg-surface
                   text-fg outline-none border border-transparent
                   focus:border-accent/50 cursor-pointer text-xs"
      >
        <option value="">condition</option>
        {CONDITION_OPTIONS.map((c) => {
          const m = c.match(/\(([^)]+)\)\s*$/);
          return (
            <option key={c} value={c}>
              {m ? m[1] : c}
            </option>
          );
        })}
      </select>
      <ChevronDown
        size={12}
        strokeWidth={2.5}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted
                   pointer-events-none"
      />
    </div>
  );
}
