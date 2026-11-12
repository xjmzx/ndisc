import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";

// The 200 × 200 cover square shared by Release detail and Add release, so
// both cards put the cover in the same place at the same size. 200 is half
// the 400 × 400 cover art: pixel-exact on a 2× screen. With no image (or one
// that fails to load) it shows a dashed placeholder.
interface CoverArtProps {
  src: string | null;
  alt: string;
}

export function CoverArt({ src, alt }: CoverArtProps) {
  // Track load failures so a broken URL/path falls back to the placeholder
  // instead of leaving a blank box. Reset when the release changes.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = src != null && !failed;

  return (
    <div
      className={
        "shrink-0 w-[200px] h-[200px] rounded-md overflow-hidden flex " +
        "items-center justify-center " +
        (showImage
          ? "bg-surface"
          : "border-2 border-dashed border-mauve/50 bg-mauve/5")
      }
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="text-mauve/70 flex flex-col items-center gap-1.5
                     text-[10px] text-center px-2"
        >
          <ImageIcon size={28} strokeWidth={1.5} />
          <span className="uppercase tracking-wide">
            {failed ? "cover failed to load" : "no cover"}
          </span>
        </div>
      )}
    </div>
  );
}
