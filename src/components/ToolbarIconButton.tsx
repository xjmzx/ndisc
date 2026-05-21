import type { ReactNode } from "react";

type Tone = "mauve" | "auburn";

// `tone` tints the header-toolbar groups: mauve for the library + nostr
// groups, auburn for the db group so they read as distinct clusters.
const TONE_CLS: Record<Tone, string> = {
  mauve: "bg-mauve/15 text-mauve hover:bg-mauve hover:text-bg",
  auburn: "bg-auburn/15 text-auburn hover:bg-auburn hover:text-bg",
};

interface Props {
  title: string;
  onClick: () => void;
  children: ReactNode;
  tone?: Tone;
  disabled?: boolean;
}

// Shared icon-only button for the header toolbar (library / db / nostr).
export function ToolbarIconButton({
  title,
  onClick,
  children,
  tone = "mauve",
  disabled = false,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={
        "p-2 rounded-md transition-colors disabled:opacity-40 " +
        "disabled:cursor-not-allowed " +
        TONE_CLS[tone]
      }
    >
      {children}
    </button>
  );
}
