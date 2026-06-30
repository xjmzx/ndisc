import { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";

interface SectionProps {
  title?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  // Extra classes for the body wrapper. Opt-in `min-h-0` here lets an inner
  // overflow region scroll inside a height-bounded section (RELEASES). It is
  // NOT applied by default because it would let flex children collapse —
  // which breaks panels that vertically centre content with `my-auto` (LABEL).
  bodyClassName?: string;
  // Compact header + tighter vertical rhythm — smaller, lighter title and
  // reduced padding/gap. Used by the dense stats grid to reclaim screen height
  // (so the lower Country/Label cards sit on-screen). Off by default so the
  // primary panel chrome keeps its weight.
  dense?: boolean;
  // Collapse affordance — mirrors ndisc.smpl / ndisc.tree's Section. When
  // `onTitleClick` is set the header reads as interactive (cursor + hover) and
  // grows a leading chevron; `collapsed` then omits the body, leaving just the
  // header strip as a one-line summary. The shared suite collapse gesture.
  onTitleClick?: () => void;
  collapsed?: boolean;
}

export function Section({
  title,
  icon,
  right,
  children,
  className,
  bodyClassName,
  dense = false,
  onTitleClick,
  collapsed = false,
}: SectionProps) {
  const showBody = children != null && children !== false && !collapsed;
  return (
    <section
      className={cn(
        "rounded-xl bg-panel border border-surface/60 shadow-md",
        "px-4 flex flex-col",
        // Header-only sections (no body) use minimal vertical padding and
        // center their header vertically — useful when min-h is overridden
        // upstream to force a taller section. Sections WITH body keep the
        // default gap between header and content (tightened when `dense`).
        showBody ? (dense ? "py-3 gap-2" : "py-4 gap-3") : "py-1 justify-center",
        className,
      )}
    >
      {/* Header is omitted entirely when there's nothing to show — a title-less,
          icon-less, figure-less section (e.g. the dense stats charts) is just
          its body, with no empty header eating vertical space. */}
      {(icon || title || right || onTitleClick) && (
        <header
          onClick={onTitleClick}
          title={
            onTitleClick ? "Click the header to expand or collapse" : undefined
          }
          className={cn(
            "flex items-center gap-2 text-accent",
            dense ? "font-medium" : "font-semibold",
            onTitleClick &&
              "-mx-2 px-2 py-1 rounded-md cursor-pointer select-none " +
                "bg-fg/5 shadow-inner transition-colors hover:bg-fg/10",
          )}
        >
          {onTitleClick && (
            <span className="text-muted shrink-0" aria-hidden="true">
              {collapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </span>
          )}
          {icon}
          {/* Title is optional — pass an empty title for an icon-only header.
              flex-1 lets a non-text title (e.g. a search field) fill the slot;
              min-w-0 lets it shrink on narrow panels. */}
          {title && (
            <h2
              className={cn(
                "tracking-wide uppercase flex-1 min-w-0",
                dense ? "text-xs" : "text-sm",
              )}
            >
              {title}
            </h2>
          )}
          {right && <div className="ml-auto text-fg/80">{right}</div>}
        </header>
      )}
      {showBody && (
        <div
          className={cn(
            "text-sm text-fg/90 flex-1 flex flex-col",
            bodyClassName,
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
