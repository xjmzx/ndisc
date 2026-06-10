import { FormEvent, useState } from "react";
import { ChevronDown, ChevronUp, Disc, Plus, Save } from "lucide-react";
import { Section } from "./Section";
import { addRelease, type Release } from "../lib/tauri";

interface Props {
  onAdded: () => void;
}

type Medium = "physical" | "digital";

const EMPTY: Release = {
  artist: "",
  title: "",
  year: new Date().getFullYear(),
  medium: "physical",
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

export function AddReleaseForm({ onAdded }: Props) {
  const [release, setRelease] = useState<Release>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Release>(key: K, value: Release[K]) {
    setRelease((r) => ({ ...r, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!release.artist.trim() || !release.title.trim()) {
      setError("artist and title are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addRelease({
        ...release,
        artist: release.artist.trim(),
        title: release.title.trim(),
      });
      setRelease(EMPTY);
      onAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Add release" icon={<Plus size={16} />}>
      <form onSubmit={onSubmit} className="text-xs space-y-1.5">
        <MediumToggle
          value={(release.medium ?? "physical") as Medium}
          onChange={(m) => set("medium", m)}
        />
        <div className={ROW}>
          <span className="text-muted text-right">type</span>
          <div className="flex items-center gap-2 flex-wrap">
            <TypeSelect
              value={release.releaseType ?? ""}
              onChange={(v) => set("releaseType", v)}
            />
            <CategorySelect
              value={release.category ?? ""}
              onChange={(v) => set("category", v)}
            />
          </div>
        </div>
        <Field
          label="artist"
          value={release.artist}
          onChange={(v) => set("artist", v)}
        />
        <Field
          label="title"
          value={release.title}
          onChange={(v) => set("title", v)}
        />

        <div className={ROW}>
          <span className="text-muted text-right">year</span>
          <div className="flex items-center gap-2 flex-wrap">
            <YearControl
              value={release.year ?? null}
              onChange={(v) => set("year", v)}
            />
            <FormatSelect
              value={release.format ?? ""}
              onChange={(v) => set("format", v)}
            />
            <input
              type="text"
              value={release.country ?? ""}
              onChange={(e) => set("country", e.target.value)}
              placeholder="country"
              aria-label="country"
              spellCheck={false}
              className={`${INPUT_CLS} w-24`}
            />
            <Disc
              size={12}
              className="text-muted shrink-0"
              aria-label="physical-only"
            />
            <ConditionSelect
              value={release.condition ?? ""}
              onChange={(v) => set("condition", v)}
            />
          </div>
        </div>

        <div className="h-2" aria-hidden />
        <Field
          label="label"
          value={release.label ?? ""}
          onChange={(v) => set("label", v)}
        />
        <Field
          label="catalog"
          value={release.catalogNumber ?? ""}
          onChange={(v) => set("catalogNumber", v)}
        />
        <Field
          label="source url"
          value={release.source ?? ""}
          onChange={(v) => set("source", v)}
          placeholder="https://www.discogs.com/master/… or https://user.bandcamp.com/album/…"
        />
        <Field
          label="cover url"
          value={release.coverArtUrl ?? ""}
          onChange={(v) => set("coverArtUrl", v)}
          placeholder="https://i.nostr.build/…"
        />
        {/* Notes + Save share a single row — notes are rarely useful in
            curation, the Save button taking the spare width on the right
            keeps the form one row shorter (more space for NOSTR/LABELS/
            LABEL below). */}
        <label className={ROW}>
          <span className="text-muted text-right">notes</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={release.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="keep it short"
              className={`${INPUT_CLS} flex-1`}
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={saving}
              className="shrink-0 px-4 py-1.5 rounded-md bg-accent text-bg
                         font-semibold hover:opacity-90 disabled:opacity-50
                         flex items-center gap-1.5"
            >
              <Save size={14} /> {saving ? "saving…" : "Save"}
            </button>
          </div>
        </label>

        {error && <div className="text-alert text-xs pl-[6rem]">{error}</div>}
      </form>
    </Section>
  );
}

const ROW = "grid grid-cols-[5.5rem_1fr] gap-x-3 items-center";
const INPUT_CLS =
  "px-2 py-1 rounded-md bg-surface text-fg outline-none " +
  "border border-transparent focus:border-accent/50 placeholder:text-muted";

function MediumToggle({
  value,
  onChange,
}: {
  value: Medium;
  onChange: (v: Medium) => void;
}) {
  return (
    <div className={ROW}>
      <span aria-hidden />
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

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className={ROW}>
      <span className="text-muted text-right">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT_CLS}
        spellCheck={false}
      />
    </label>
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
        className="appearance-none pl-2.5 pr-7 py-1 rounded-md bg-surface
                   text-fg outline-none border border-transparent
                   focus:border-accent/50 cursor-pointer text-xs"
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
        className="appearance-none pl-2.5 pr-7 py-1 rounded-md bg-surface
                   text-fg outline-none border border-transparent
                   focus:border-accent/50 cursor-pointer text-xs"
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

