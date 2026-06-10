import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface SectionProps {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Section({
  title,
  icon,
  right,
  children,
  className,
}: SectionProps) {
  return (
    <section
      className={cn(
        "rounded-xl bg-panel border border-surface/60 shadow-md",
        "px-4 flex flex-col",
        // Header-only sections (no body) use minimal vertical padding and
        // center their header vertically — useful when min-h is overridden
        // upstream to force a taller section. Sections WITH body keep the
        // default gap-3 between header and content.
        children != null && children !== false
          ? "py-4 gap-3"
          : "py-1 justify-center",
        className,
      )}
    >
      <header className="flex items-center gap-2 text-accent font-semibold">
        {icon}
        <h2 className="text-sm tracking-wide uppercase">{title}</h2>
        {right && <div className="ml-auto text-fg/80">{right}</div>}
      </header>
      {children != null && children !== false && (
        <div className="text-sm text-fg/90 flex-1 flex flex-col">
          {children}
        </div>
      )}
    </section>
  );
}
