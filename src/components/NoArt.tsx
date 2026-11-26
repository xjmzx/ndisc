import type { ReactNode } from "react";
import noArtBlankUrl from "../assets/no-art-blank.svg";

// The suite's "no art" square: shown wherever a release has no cover or a
// label has no image, instead of an empty dashed box. The master lives with
// the other ndisc artwork (`No release, no label Art/ndisc-no_cover_blank-sq.svg`);
// `src/assets/no-art-blank.svg` is a copy. An optional caption sits along the
// bottom edge ("no cover", the label's name, "image unavailable").
// Always the transparent outline version (`ndisc-no_cover_blank-sq.svg`):
// an empty frame, never the filled tile, at half opacity so it stays quiet.
export function NoArt({
  caption,
  sub,
  icon,
  className = "",
}: {
  caption?: string;
  sub?: string;
  // A small glyph along the bottom edge in place of (or above) the caption.
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={"relative w-full h-full " + className}>
      <img
        src={noArtBlankUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover select-none opacity-50"
      />
      {(caption || sub || icon) && (
        <div
          className="absolute inset-x-0 bottom-0 px-2 pb-1.5 flex flex-col
                     items-center gap-0.5 text-center pointer-events-none"
        >
          {icon && <span className="text-muted">{icon}</span>}
          {caption && (
            <span className="text-[10px] uppercase tracking-wide text-muted">
              {caption}
            </span>
          )}
          {sub && (
            <span className="text-xs text-fg/80 truncate max-w-full" title={sub}>
              {sub}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
