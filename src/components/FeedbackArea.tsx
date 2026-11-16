import type { ReactNode } from "react";

// The feedback area at the foot of the Home card (Release detail or Add
// release). Everything the card and the publishing strip report reads here,
// beside one dot that is always shown: muted with nothing to report, so the
// spot itself says "no output, no warning"; otherwise the colour of the most
// serious line (failure, then warning, then the purple of success).

export type FeedbackTone = "idle" | "nostr" | "warn" | "alert";

const DOT_CLS: Record<FeedbackTone, string> = {
  idle: "bg-muted/40",
  nostr: "bg-nostr",
  warn: "bg-warn",
  alert: "bg-alert",
};

const TONE_RANK: FeedbackTone[] = ["idle", "nostr", "warn", "alert"];

export function worstTone(tones: FeedbackTone[]): FeedbackTone {
  return tones.reduce(
    (a, b) => (TONE_RANK.indexOf(b) > TONE_RANK.indexOf(a) ? b : a),
    "idle",
  );
}

// `filterNote` and `stripError` come from the publishing strip (via App);
// `tone` and `children` are the card's own output.
export function FeedbackArea({
  tone,
  filterNote,
  stripError,
  children,
}: {
  tone: FeedbackTone;
  filterNote?: string | null;
  stripError?: string | null;
  children?: ReactNode;
}) {
  const dot = worstTone([
    tone,
    stripError ? "alert" : "idle",
    filterNote ? "nostr" : "idle",
  ]);
  return (
    <div className="mt-3 text-xs flex items-start gap-2 min-h-[1rem]">
      <span
        aria-hidden="true"
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLS[dot]}`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        {children}
        {stripError && <div className="text-alert">{stripError}</div>}
        {filterNote && <div className="text-nostr">filter: {filterNote}</div>}
      </div>
    </div>
  );
}
