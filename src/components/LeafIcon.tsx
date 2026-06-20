import type { SVGProps } from "react";
import { cn } from "../lib/cn";

/**
 * The suite's "leaf" glyph — a simple almond blade + midrib in the lucide
 * idiom. Kept for affordance / brand use; quantity is shown with LeafDots.
 */
export function LeafIcon({
  size = 24,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 21C6 16 6 9 12 4C18 9 18 16 12 21Z" />
      <path d="M12 20V5" />
    </svg>
  );
}

// Optimal column count for `n` dots within `maxCols`: a single row up to the
// smaller of 5 / maxCols, then the fewest rows that fit within maxCols, with
// the columns balanced across those rows (6→2×3, 8→2×4, 7→4+3, …). A low
// maxCols favours taller/narrower (use where there's vertical room); a high
// maxCols favours shorter/wider (use where there's horizontal room).
function dotCols(n: number, maxCols: number): number {
  if (n <= Math.min(5, maxCols)) return n;
  const rows = Math.ceil(n / maxCols);
  return Math.ceil(n / rows);
}

/**
 * Leaf-dots — the suite's diagrammatic quantity glyph. A leaf is a track; each
 * present track is one solid leaf-green dot, layered over faint (25%) dots for
 * the release's expected total — so the cluster itself shows how complete the
 * release is. Packs into an optimal grid (see dotCols); the count itself is the
 * picture, exact figures on hover. Nothing renders for 0. Capped at `max`.
 */
export function LeafDots({
  n,
  total,
  max = 99,
  unit = "track",
  maxCols = 5,
  maxRows,
  className,
}: {
  /** Present count (solid green dots). */
  n: number | null | undefined;
  /** Expected total. When given, the extra (missing) slots render at 25% —
   *  present vs total visualises how many tracks are missing locally. */
  total?: number | null;
  max?: number;
  unit?: string;
  /** Max dots per row — lower = taller/narrower, higher = shorter/wider. */
  maxCols?: number;
  /** When set, the dot grid is capped at this many rows; any count that would
   *  exceed it collapses to a single solid leaf-green tile with the total in an
   *  "8-ball" (white circle, black number). Opt-in — the shared tree/smpl
   *  copies pass no maxRows and keep the uncapped grid. */
  maxRows?: number;
  className?: string;
}) {
  const present = Math.min(Math.max(n ?? 0, 0), max);
  const expected = total != null ? Math.min(Math.max(total, 0), max) : present;
  const shown = Math.max(present, expected);
  if (shown <= 0) return null;
  const missing = Math.max(expected - present, 0);
  const cols = dotCols(shown, maxCols);
  const title =
    total != null
      ? `${present} of ${total} ${unit}${total === 1 ? "" : "s"}${
          missing > 0 ? ` · ${missing} missing` : " · complete"
        }`
      : `${present}${present >= max ? "+" : ""} ${unit}${present === 1 ? "" : "s"}`;

  // Past the row cap, a full dot grid would tower over the row — collapse it to
  // one solid leaf-green tile carrying the total, centred.
  if (maxRows != null && Math.ceil(shown / cols) > maxRows) {
    return (
      <CountBadge
        value={shown}
        atMax={shown >= max}
        title={title}
        className={className}
        // Tracks: solid green rounded tile, dark number on top.
        shapeClassName="rounded-[3px]"
        colorClassName="bg-ok/70 text-bg"
      />
    );
  }

  return (
    <span
      className={cn("inline-grid gap-[2px] w-max", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      title={title}
      aria-label={title}
    >
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className={cn(
            "w-1 h-1 rounded-full",
            // solid green = present track; faint (25%) = a missing slot.
            i < present ? "bg-ok/70" : "bg-ok/25",
          )}
        />
      ))}
    </span>
  );
}

/**
 * A count rendered as a number centred on a single solid fixed-size shape —
 * keeps a large or overflowing quantity to one compact mark. Flavour is set by
 * className props: tracks use a leaf-green rounded tile, discs a mauve circle.
 */
export function CountBadge({
  value,
  atMax = false,
  title,
  shapeClassName = "rounded-full",
  colorClassName,
  size = 21,
  className,
}: {
  value: number;
  atMax?: boolean;
  title: string;
  /** Border-radius flavour — `rounded-[3px]` (tile) or `rounded-full` (ball). */
  shapeClassName?: string;
  /** Solid `bg-*` + readable `text-*`. */
  colorClassName?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-grid place-items-center font-bold leading-none tabular-nums",
        shapeClassName,
        colorClassName,
        className,
      )}
      style={{ width: size, height: size, fontSize: value >= 100 ? 8 : 10 }}
      title={title}
      aria-label={title}
    >
      {value}
      {atMax ? "+" : ""}
    </span>
  );
}
