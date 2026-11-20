import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  checkLabelArt,
  type ImportProgress,
  type LabelArtCheck,
  type LocalCoverCheck,
  type LocalCoverUploads,
  type SavePublishedCovers,
} from "./tauri";

// The Review overlay's state (docs/backlog.md, "Review overlay"). The checks'
// RESULTS live here, above the views, so closing the overlay or leaving a
// view loses nothing, and the overlay (rendered by App) can show them.
//
// The cover check and its upload / save still RUN in ReleaseList: they share
// its one-operation-at-a-time guard and its progress line with Reconcile,
// Mirror and the rest. ReleaseList registers them here as `coverActions`
// while it is mounted (Home), and stores each result here.
//
// The label check runs here: it only needs the labels and the servers, reads
// the network and writes nothing, so nothing else has to wait for it.

export type ReviewTab = "covers" | "labels";

export interface CoverReview {
  data: LocalCoverCheck;
  uploads: LocalCoverUploads | null;
  saves: SavePublishedCovers | null;
  // Bumped by a fresh check (not by an upload or save), so the results
  // component starts its ticks and filters over for a new check only.
  run: number;
}

export interface CoverActions {
  check: () => void;
  upload: (ids: number[]) => void;
  save: (ids: number[]) => void;
  // ReleaseList is running something; nothing else may start.
  busy: boolean;
}

interface Review {
  open: boolean;
  tab: ReviewTab;
  show: (tab?: ReviewTab) => void;
  close: () => void;
  setTab: (tab: ReviewTab) => void;

  cover: CoverReview | null;
  setCover: (c: CoverReview | null) => void;
  coverActions: CoverActions | null;
  setCoverActions: (a: CoverActions | null) => void;

  label: LabelArtCheck | null;
  labelRunning: boolean;
  labelProgress: ImportProgress | null;
  labelError: string | null;
  runLabelCheck: (opts?: { thenShow?: boolean }) => Promise<void>;
  clearLabel: () => void;
}

const ReviewContext = createContext<Review | null>(null);

export function ReviewProvider({
  labels,
  blossomServers,
  children,
}: {
  labels: { name: string; imageUrl: string }[];
  blossomServers: string[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ReviewTab>("covers");
  const [cover, setCover] = useState<CoverReview | null>(null);
  const [coverActions, setCoverActions] = useState<CoverActions | null>(null);
  const [label, setLabel] = useState<LabelArtCheck | null>(null);
  const [labelRunning, setLabelRunning] = useState(false);
  const [labelProgress, setLabelProgress] = useState<ImportProgress | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  const show = useCallback((t?: ReviewTab) => {
    if (t) setTab(t);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const runLabelCheck = useCallback(
    async (opts?: { thenShow?: boolean }) => {
      if (labelRunning) return;
      setLabelRunning(true);
      setLabelError(null);
      setLabelProgress(null);
      let un: UnlistenFn | null = null;
      try {
        un = await listen<ImportProgress>("label-art:progress", (e) => setLabelProgress(e.payload));
        setLabel(await checkLabelArt(labels, blossomServers));
        if (opts?.thenShow !== false) {
          setTab("labels");
          setOpen(true);
        }
      } catch (e) {
        setLabelError(String(e));
      } finally {
        un?.();
        setLabelRunning(false);
        setLabelProgress(null);
      }
    },
    [labels, blossomServers, labelRunning],
  );

  const value = useMemo<Review>(
    () => ({
      open,
      tab,
      show,
      close,
      setTab,
      cover,
      setCover,
      coverActions,
      setCoverActions,
      label,
      labelRunning,
      labelProgress,
      labelError,
      runLabelCheck,
      clearLabel: () => {
        setLabel(null);
        setLabelError(null);
      },
    }),
    [open, tab, show, close, cover, coverActions, label, labelRunning, labelProgress, labelError, runLabelCheck],
  );
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview(): Review {
  const r = useContext(ReviewContext);
  if (!r) throw new Error("useReview outside ReviewProvider");
  return r;
}
