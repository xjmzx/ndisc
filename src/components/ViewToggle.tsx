import type { ReactNode, CSSProperties } from "react";
import { cn } from "../lib/cn";

// Home's layout switch, lifted from glmps's ViewToggle (same four icons, same
// order, same primary→accent resting tint) so ndisc reads like the readers.
// The three grids are glmps's `grid` / `grid-sm` / `grid-xs`; `list` is
// ndisc's own list + editor, so there's no separate "back to editor" button.
export type ReleaseLayout = "grid" | "grid-sm" | "grid-xs" | "list";

export const LAYOUT_STORAGE_KEY = "ndisc.homeLayout";

export function readLayout(): ReleaseLayout {
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (v === "grid" || v === "grid-sm" || v === "grid-xs" || v === "list") return v;
  } catch {
    /* storage unavailable */
  }
  return "list";
}

// Resting colour per button: a step along accent → mauve, as glmps steps
// along its primary → accent, so the control reads as one tinted strip.
const restColor = (i: number): string =>
  `color-mix(in oklch, rgb(var(--c-accent)), rgb(var(--c-mauve)) ${(i / 3) * 100}%)`;

export function ViewToggle({
  value,
  onChange,
}: {
  value: ReleaseLayout;
  onChange: (v: ReleaseLayout) => void;
}) {
  return (
    <div className="inline-flex rounded border border-surface overflow-hidden shrink-0">
      <Btn i={0} active={value === "grid"} onClick={() => onChange("grid")} label="Grid">
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          <rect x="1" y="1" width="4" height="4" rx="0.5" />
          <rect x="7" y="1" width="4" height="4" rx="0.5" />
          <rect x="1" y="7" width="4" height="4" rx="0.5" />
          <rect x="7" y="7" width="4" height="4" rx="0.5" />
        </svg>
      </Btn>
      <Btn i={1} active={value === "grid-sm"} onClick={() => onChange("grid-sm")} label="Small grid">
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          {[0.5, 4.5, 8.5].flatMap((y) =>
            [0.5, 4.5, 8.5].map((x) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" rx="0.3" />
            )),
          )}
        </svg>
      </Btn>
      <Btn i={2} active={value === "grid-xs"} onClick={() => onChange("grid-xs")} label="Cover wall">
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          {[0.5, 3.5, 6.5, 9.5].flatMap((y) =>
            [0.5, 3.5, 6.5, 9.5].map((x) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2" rx="0.25" />
            )),
          )}
        </svg>
      </Btn>
      <Btn i={3} active={value === "list"} onClick={() => onChange("list")} label="List and editor">
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          <rect x="1" y="2" width="10" height="1.5" rx="0.5" />
          <rect x="1" y="5.25" width="10" height="1.5" rx="0.5" />
          <rect x="1" y="8.5" width="10" height="1.5" rx="0.5" />
        </svg>
      </Btn>
    </div>
  );
}

function Btn({
  i,
  active,
  onClick,
  label,
  children,
}: {
  i: number;
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{ ["--btn-rest" as string]: restColor(i) } as CSSProperties}
      className={cn(
        "px-2 py-1.5 transition-colors",
        active ? "bg-accent/15 text-accent" : "text-[color:var(--btn-rest)] hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
