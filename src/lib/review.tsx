import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  checkLabelArt,
  labelArtDefault,
  matchLabelArt,
  type LabelArtMatch,
  type LabelArtMatches,
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

  // The label art folder and which file in it is each label's, kept current
  // as labels change. The folder is the override picked by hand (per
  // machine), else `<library root>/_labels` once it exists; null without
  // either. `setArtFolder(null)` drops the override, back to `_labels`.
  artFolder: string | null;
  setArtFolder: (folder: string | null) => void;
  // `<library root>/_labels`, and whether it exists yet.
  artDefault: { path: string; exists: boolean } | null;
  refreshArtDefault: () => void;
  artMatches: LabelArtMatches | null;
  artMatchFor: (name: string) => LabelArtMatch | null;
  artError: string | null;
}

// Per machine: the folder is a path on this computer, while the database
// (which holds any hand-picked file names) may travel.
const ART_FOLDER_KEY = "ndisc.labelArtFolder";

const ReviewContext = createContext<Review | null>(null);

export function ReviewProvider({
  labels,
  blossomServers,
  children,
}: {
  labels: { name: string; imageUrl: string; artFile?: string }[];
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

  const [artDefault, setArtDefault] = useState<{ path: string; exists: boolean } | null>(null);
  const refreshArtDefault = useCallback(() => {
    labelArtDefault()
      .then(setArtDefault)
      .catch(() => setArtDefault(null));
  }, []);
  useEffect(() => refreshArtDefault(), [refreshArtDefault]);
  const [artOverride, setArtFolderState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ART_FOLDER_KEY);
    } catch {
      return null;
    }
  });
  const setArtFolder = useCallback((f: string | null) => {
    setArtFolderState(f);
    try {
      if (f) localStorage.setItem(ART_FOLDER_KEY, f);
      else localStorage.removeItem(ART_FOLDER_KEY);
    } catch {
      /* ignore */
    }
  }, []);
  const artFolder = artOverride ?? (artDefault?.exists ? artDefault.path : null);
  const [artMatches, setArtMatches] = useState<LabelArtMatches | null>(null);
  const [artError, setArtError] = useState<string | null>(null);
  // Re-match when the folder or the labels change, a moment after the last
  // change: a listing and a few hundred string compares, no image reads.
  useEffect(() => {
    if (!artFolder) {
      setArtMatches(null);
      setArtError(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      matchLabelArt(artFolder, labels)
        .then((m) => {
          if (!live) return;
          setArtMatches(m);
          setArtError(null);
        })
        .catch((e) => {
          if (!live) return;
          setArtMatches(null);
          setArtError(String(e));
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [artFolder, labels]);
  const artMatchFor = useCallback(
    (name: string) => {
      if (!artMatches) return null;
      const k = name.trim().toLowerCase();
      return artMatches.matches.find((m) => m.name.trim().toLowerCase() === k) ?? null;
    },
    [artMatches],
  );

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
        setLabel(await checkLabelArt(labels, blossomServers, artFolder));
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
    [labels, blossomServers, labelRunning, artFolder],
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
      artFolder,
      setArtFolder,
      artDefault,
      refreshArtDefault,
      artMatches,
      artMatchFor,
      artError,
    }),
    [
      open, tab, show, close, cover, coverActions, label, labelRunning, labelProgress, labelError,
      runLabelCheck, artFolder, setArtFolder, artDefault, refreshArtDefault, artMatches, artMatchFor, artError,
    ],
  );
  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview(): Review {
  const r = useContext(ReviewContext);
  if (!r) throw new Error("useReview outside ReviewProvider");
  return r;
}
