import type { SVGProps } from "react";
import { cn } from "../lib/cn";

/**
 * The suite's "leaf" glyph — a simple almond blade + midrib in the lucide
 * idiom (24×24, currentColor stroke, round caps/joins, stroke-width 2), so it
 * drops in anywhere a lucide icon does: `<LeafIcon size={14} />`.
 *
 * Shared with ndisc.tree and ndisc.smpl. In the suite a leaf is an audio track
 * / clip; here it marks a release's track count (its "leaves on the branch").
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
      {/* blade — pointed almond (tip top, stem base bottom) */}
      <path d="M12 21C6 16 6 9 12 4C18 9 18 16 12 21Z" />
      {/* midrib */}
      <path d="M12 20V5" />
    </svg>
  );
}

// Foliage meter — fixed three-slot magnitude gauge, identical to the one in
// ndisc.tree / ndisc.smpl. The first `litCount(n)` leaves are lit, the rest
// dimmed; the exact figure lives in the hover title. A release is a branch and
// these are its leaves (tracks). `null` count = unknown (no folder) → all dim.
function litCount(n: number): number {
  if (n <= 0) return 0;
  return n >= 50 ? 3 : n >= 10 ? 2 : 1;
}

export function LeafMeter({
  n,
  size = 12,
  className,
}: {
  n: number | null | undefined;
  size?: number;
  className?: string;
}) {
  const count = n ?? 0;
  const lit = litCount(count);
  const title =
    n == null
      ? "track count unknown"
      : `${count}${count >= 99 ? "+" : ""} track${count === 1 ? "" : "s"}`;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      title={title}
      aria-label={title}
    >
      {[0, 1, 2].map((i) => (
        <LeafIcon
          key={i}
          size={size}
          // shares the suite's ~10°-past-12:00 lean.
          className={cn("rotate-[10deg]", i < lit ? "text-fg/70" : "text-muted/25")}
        />
      ))}
    </span>
  );
}
