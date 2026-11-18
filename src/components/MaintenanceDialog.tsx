import type { ReactNode } from "react";
import {
  Copy,
  Disc3,
  FileImage,
  FileWarning,
  FolderPlus,
  FolderSearch,
  FolderSync,
  HardDrive,
  ImageDown,
  Images,
  ImageUp,
  Loader2,
  Play,
  Radar,
  SatelliteDish,
  ScanLine,
  Share2,
  StickyNote,
  Wand2,
  X,
  Cloud,
  Database,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "../lib/cn";

// Library maintenance, grouped. The ⋮ menu lists the groups; picking one opens
// this dialog, which lists that group's jobs with room to say what each does.
// The dialog only launches: a job's results still land in the summary panel
// under the toolbar, so Run closes the dialog to keep that panel in view.
//
// Groups are by what a job works on — the folder on disk, local cover files,
// Blossom, the relays, the catalogue's own data — not by verb, because
// "reconcile", "audit" and "rescan" each turn up in more than one place.

export type MaintJobId =
  | "reconcileDisk"
  | "scan"
  | "folders"
  | "extract"
  | "rescan"
  | "artworkNames"
  | "coverGap"
  | "coverMigrate"
  | "localCovers"
  | "coverMirror"
  | "contentAudit"
  | "audit"
  | "reconcile"
  | "manifest"
  | "repressing"
  | "notes";

export type MaintGroupId = "disk" | "covers" | "blossom" | "relays" | "data";

// What a job does before it changes anything. Only stated where the code
// guarantees it: "check" jobs list what they would do and wait for a
// confirmation in the summary panel; "read-only" jobs never write.
type Mode = "check" | "read-only";

interface MaintJob {
  id: MaintJobId;
  icon: ReactNode;
  label: string;
  description: string;
  mode?: Mode;
}

export interface MaintGroup {
  id: MaintGroupId;
  icon: ReactNode;
  title: string;
  blurb: string;
  jobs: MaintJob[];
}

export const MAINT_GROUPS: MaintGroup[] = [
  {
    id: "disk",
    icon: <HardDrive size={14} />,
    title: "Library folder",
    blurb: "The music folder on disk, and how releases map onto it.",
    jobs: [
      {
        id: "reconcileDisk",
        icon: <FolderSync size={14} />,
        label: "Find new folders",
        description:
          "Walks the library folder. New folders are imported as releases, " +
          "and folders already in the catalogue are refreshed. Ignored " +
          "folders are skipped.",
      },
      {
        id: "scan",
        icon: <ScanLine size={14} />,
        label: "Re-read tags & art",
        description:
          "Re-reads tags and cover art from the files of releases already " +
          "in the catalogue. Releases whose files no longer match the " +
          "catalogue are listed for review.",
      },
      {
        id: "folders",
        icon: <FolderPlus size={14} />,
        label: "Give every release a folder",
        description:
          "Lists the releases with no folder on disk and the " +
          "<Artist>/<Title> folder each would get. Nothing is created until " +
          "you confirm the list. Nothing is published.",
        mode: "check",
      },
    ],
  },
  {
    id: "covers",
    icon: <ImageIcon size={14} />,
    title: "Covers on disk",
    blurb: "Cover image files in the release folders.",
    jobs: [
      {
        id: "extract",
        icon: <Wand2 size={14} />,
        label: "Extract embedded artwork",
        description:
          "Pulls the cover art embedded in the audio files of digital releases.",
      },
      {
        id: "rescan",
        icon: <FolderSearch size={14} />,
        label: "Match local covers",
        description:
          "Looks in each release's folder for an image file and matches it " +
          "to the release as its cover.",
      },
      {
        id: "artworkNames",
        icon: <FileImage size={14} />,
        label: "Tidy artwork names",
        description:
          "Lists the folders whose only image is not yet called cover.* and " +
          "renames them once you confirm. Every rename is logged; nothing is " +
          "published.",
        mode: "check",
      },
      {
        id: "coverGap",
        icon: <ImageDown size={14} />,
        label: "Reconcile published covers",
        description:
          "Finds published releases whose cover has no file on disk, then " +
          "offers to download each published image into its folder.",
        mode: "check",
      },
    ],
  },
  {
    id: "blossom",
    icon: <Cloud size={14} />,
    title: "Blossom",
    blurb: "Covers and label art on the Blossom servers and their mirrors.",
    jobs: [
      {
        id: "coverMigrate",
        icon: <ImageUp size={14} />,
        label: "Move covers to Blossom",
        description:
          "Counts the covers already on the primary server and lists the " +
          "rest, then offers to upload them and point each release at its " +
          "new address. Moved releases are left to republish as usual.",
        mode: "check",
      },
      {
        id: "localCovers",
        icon: <Images size={14} />,
        label: "Local covers vs Blossom",
        description:
          "Compares each published release's cover file with the copy on " +
          "Blossom and lists the ones changed on disk since publishing, and " +
          "the ones it can't compare: published from elsewhere, no file on " +
          "disk, no cover. You choose which to upload.",
        mode: "check",
      },
      {
        id: "coverMirror",
        icon: <Copy size={14} />,
        label: "Mirror covers",
        description:
          "Counts the copies the mirror servers still lack, then offers to " +
          "copy covers and label art across. Changes nothing a release " +
          "publishes.",
        mode: "check",
      },
    ],
  },
  {
    id: "relays",
    icon: <SatelliteDish size={14} />,
    title: "Relays & published",
    blurb: "What the relays are serving, compared with the catalogue.",
    jobs: [
      {
        id: "contentAudit",
        icon: <FileWarning size={14} />,
        label: "Audit published content",
        description:
          "Reads what the relays serve for each release and compares it with " +
          "the catalogue tag by tag. Catches a release that changed without " +
          "being marked for republishing.",
        mode: "read-only",
      },
      {
        id: "audit",
        icon: <Radar size={14} />,
        label: "Reconcile relays",
        description:
          "Shows what each relay serves against the library, including events " +
          "the catalogue knows nothing about. Removing or republishing is a " +
          "separate step in the results.",
        mode: "read-only",
      },
      {
        id: "reconcile",
        icon: <SatelliteDish size={14} />,
        label: "Reconcile published state",
        description:
          "Backfills the catalogue's publish markers from what the relays " +
          "already hold.",
      },
      {
        id: "manifest",
        icon: <Share2 size={14} />,
        label: "Export published manifest",
        description:
          "Writes the list of published releases for the other suite apps, " +
          "so they can tell what is released without reading this catalogue.",
      },
    ],
  },
  {
    id: "data",
    icon: <Database size={14} />,
    title: "Catalogue data",
    blurb: "Fields stored on the releases themselves.",
    jobs: [
      {
        id: "repressing",
        icon: <Disc3 size={14} />,
        label: "Repair pressing strings",
        description:
          "Re-fetches the format from Discogs for releases where an old scan " +
          "overwrote it with a codec. Discogs-linked releases only.",
      },
      {
        id: "notes",
        icon: <StickyNote size={14} />,
        label: "Review notes",
        description:
          "Lists every distinct note across the catalogue so the unwanted can " +
          "be cleared in bulk. Notes are published with their release.",
      },
    ],
  },
];

export function groupOfJob(id: string | null): MaintGroupId | null {
  if (!id) return null;
  return MAINT_GROUPS.find((g) => g.jobs.some((j) => j.id === id))?.id ?? null;
}

const MODE_LABEL: Record<Mode, string> = {
  check: "checks first",
  "read-only": "read-only",
};

export function MaintenanceDialog({
  group,
  activeOp,
  onRun,
  onClose,
  footer,
}: {
  group: MaintGroupId;
  activeOp: string | null;
  onRun: (id: MaintJobId) => void;
  onClose: () => void;
  // Settings that belong with this group (the Library folder dialog carries
  // the library root and the ignored-folders list), shown under the jobs.
  footer?: ReactNode;
}) {
  const g = MAINT_GROUPS.find((x) => x.id === group)!;
  const busy = activeOp !== null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center p-4
                 bg-bg/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={g.title}
        className="w-full max-w-lg mt-4 mb-4 max-h-[calc(100%-2rem)] flex flex-col
                   rounded-lg border border-surface/70 bg-panel shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-fg inline-flex items-center gap-1.5">
            {g.icon} {g.title}
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-fg"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[11px] text-muted mb-3">{g.blurb}</p>

        {busy && groupOfJob(activeOp) !== group && (
          <p className="text-[11px] text-muted mb-2 inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Another job is
            running — one at a time.
          </p>
        )}

        <div className="overflow-y-auto -mx-1 px-1 space-y-1.5">
          {g.jobs.map((j) => {
            const running = activeOp === j.id;
            return (
              <div
                key={j.id}
                className="flex items-start gap-3 rounded-md bg-surface/40 px-3 py-2.5"
              >
                <span
                  className={cn(
                    "shrink-0 mt-0.5",
                    running ? "text-accent animate-pulse" : "text-muted",
                  )}
                >
                  {j.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs text-fg">{j.label}</span>
                    {j.mode && (
                      <span className="text-[10px] text-muted border border-muted/30 rounded px-1">
                        {MODE_LABEL[j.mode]}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted mt-0.5 leading-snug">
                    {j.description}
                  </p>
                </div>
                <button
                  onClick={() => onRun(j.id)}
                  disabled={busy}
                  className="shrink-0 self-center inline-flex items-center gap-1
                             px-2 py-1 rounded-md text-[11px] bg-surface
                             hover:bg-surfaceHover text-fg
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  title={running ? "Running" : `Run: ${j.label}`}
                >
                  {running ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Play size={12} />
                  )}
                  {running ? "Running" : j.id === "notes" ? "Open" : "Run"}
                </button>
              </div>
            );
          })}
        </div>

        {footer && (
          <div className="mt-3 pt-3 border-t border-muted/30">{footer}</div>
        )}
      </div>
    </div>
  );
}
