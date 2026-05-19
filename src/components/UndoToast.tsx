import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";

export interface UndoToastState {
  key: number;
  message: string;
  undo: () => void | Promise<void>;
}

interface Props {
  toast: UndoToastState | null;
  onDismiss: () => void;
  // How long the toast lingers before auto-dismissing (ms).
  durationMs?: number;
}

export function UndoToast({ toast, onDismiss, durationMs = 10_000 }: Props) {
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    setUndoing(false);
    if (!toast) return;
    const t = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss, durationMs]);

  if (!toast) return null;

  async function onUndo() {
    if (!toast || undoing) return;
    setUndoing(true);
    try {
      await toast.undo();
    } finally {
      onDismiss();
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-3 py-2
                 rounded-md bg-panel border border-surface shadow-lg text-xs
                 max-w-md"
    >
      <span className="text-fg/90 truncate">{toast.message}</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={undoing}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-mauve/15
                   text-mauve hover:bg-mauve hover:text-bg transition-colors
                   disabled:opacity-50"
      >
        <Undo2 size={12} /> {undoing ? "restoring…" : "Undo"}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className="text-muted hover:text-fg transition-colors p-1 rounded-md
                   hover:bg-surface"
      >
        <X size={12} />
      </button>
    </div>
  );
}
