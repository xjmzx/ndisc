import { useEffect, useState } from "react";
import {
  Disc,
  FileDown,
  FolderInput,
  Library,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Section } from "./Section";
import { ToolbarIconButton } from "./ToolbarIconButton";
import {
  exportMarkdown,
  getStats,
  importDirectory,
  importDiscogsCsv,
  scanDirectory,
  scanDiscogsCsv,
  type ImportProgress,
  type ImportSummary,
  type ScanDiscogsReport,
  type ScanReport,
  type Stats,
} from "../lib/tauri";

type Phase = "idle" | "scanning" | "ready" | "importing" | "done";
type MediumFilter = "both" | "physical" | "digital";

type ScanResult =
  | { kind: "folder"; report: ScanReport }
  | { kind: "discogs"; report: ScanDiscogsReport };

// The library import/export state, lifted out of the old LIBRARY panel so its
// stats and action buttons can live in the header toolbar. The multi-step
// import flow renders in a transient panel (LibraryFlowPanel) that only
// appears while `active` is true.
export interface LibraryController {
  stats: Stats | null;
  phase: Phase;
  active: boolean;
  pickedPath: string | null;
  scan: ScanResult | null;
  progress: ImportProgress | null;
  last: ImportSummary | null;
  error: string | null;
  exportMsg: string | null;
  exporting: boolean;
  mediumFilter: MediumFilter;
  setMediumFilter: (m: MediumFilter) => void;
  pickFolder: () => Promise<void>;
  pickDiscogsCsv: () => Promise<void>;
  runImport: () => Promise<void>;
  exportMarkdownFile: () => Promise<void>;
  reset: () => void;
}

export function useLibrary(
  reloadKey: number,
  onImported: () => void,
): LibraryController {
  // --- Stats ----------------------------------------------------------------
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    getStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [reloadKey]);

  // --- Import ---------------------------------------------------------------
  const [phase, setPhase] = useState<Phase>("idle");
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [last, setLast] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Discogs-only: which media to import from the CSV.
  const [mediumFilter, setMediumFilter] = useState<MediumFilter>("both");

  // --- Export ---------------------------------------------------------------
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  // The export result is a one-liner — clear it (and let the transient panel
  // unmount) a few seconds after it lands.
  useEffect(() => {
    if (!exportMsg) return;
    const t = window.setTimeout(() => setExportMsg(null), 6000);
    return () => window.clearTimeout(t);
  }, [exportMsg]);

  function reset() {
    setPhase("idle");
    setPickedPath(null);
    setScan(null);
    setProgress(null);
    setLast(null);
    setError(null);
    setExportMsg(null);
    setMediumFilter("both");
  }

  async function exportMarkdownFile() {
    setExportMsg(null);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    let picked: string | null;
    try {
      const result = await saveDialog({
        title: "Export library as markdown",
        defaultPath: `ndisc-${stamp}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      picked = typeof result === "string" ? result : null;
    } catch (e) {
      setExportMsg(`error: ${e}`);
      return;
    }
    if (!picked) return;
    setExporting(true);
    try {
      const count = await exportMarkdown(picked);
      setExportMsg(`exported ${count} release${count === 1 ? "" : "s"}`);
    } catch (e) {
      setExportMsg(`error: ${e}`);
    } finally {
      setExporting(false);
    }
  }

  async function pickFolder() {
    setError(null);
    let picked: string | null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Select your music library folder",
      });
      picked = typeof result === "string" ? result : null;
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!picked) return;
    setPickedPath(picked);
    setLast(null);
    setProgress(null);
    setPhase("scanning");
    try {
      const report = await scanDirectory(picked);
      setScan({ kind: "folder", report });
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }

  async function pickDiscogsCsv() {
    setError(null);
    let picked: string | null;
    try {
      const result = await openDialog({
        multiple: false,
        title: "Select your Discogs collection CSV export",
        filters: [{ name: "Discogs CSV", extensions: ["csv"] }],
      });
      picked = typeof result === "string" ? result : null;
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!picked) return;
    setPickedPath(picked);
    setLast(null);
    setProgress(null);
    setPhase("scanning");
    try {
      const report = await scanDiscogsCsv(picked);
      setScan({ kind: "discogs", report });
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }

  async function runImport() {
    if (!pickedPath || !scan) return;
    setError(null);
    setLast(null);
    setPhase("importing");

    const totalGuess =
      scan.kind === "folder" ? scan.report.totalDirs : scan.report.totalRows;
    setProgress({ current: 0, total: totalGuess, currentDir: "" });

    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<number>("import:started", (e) => {
          setProgress((p) => ({
            current: p?.current ?? 0,
            total: e.payload,
            currentDir: p?.currentDir ?? "",
          }));
        }),
      );
      unlisteners.push(
        await listen<ImportProgress>("import:progress", (e) => {
          setProgress(e.payload);
        }),
      );

      const summary =
        scan.kind === "folder"
          ? await importDirectory(pickedPath)
          : await importDiscogsCsv(
              pickedPath,
              mediumFilter === "both" ? undefined : mediumFilter,
            );
      setLast(summary);
      setPhase("done");
      onImported();
    } catch (e) {
      setError(String(e));
      setPhase("ready");
    } finally {
      unlisteners.forEach((f) => f());
    }
  }

  const active = phase !== "idle" || exportMsg != null || error != null;

  return {
    stats,
    phase,
    active,
    pickedPath,
    scan,
    progress,
    last,
    error,
    exportMsg,
    exporting,
    mediumFilter,
    setMediumFilter,
    pickFolder,
    pickDiscogsCsv,
    runImport,
    exportMarkdownFile,
    reset,
  };
}

// --- Header pieces ----------------------------------------------------------

// The four headline counts, shown as chips in the header. Values keep the
// accent colour.
export function LibraryStats({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  return (
    <div className="flex items-center gap-1.5">
      <StatChip label="Total" value={stats.total} />
      <StatChip label="Physical" value={stats.physical} />
      <StatChip label="Digital" value={stats.digital} />
      <StatChip label="Artists" value={stats.uniqueArtists} />
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 px-2.5 py-2 rounded-md
                 bg-surface text-xs whitespace-nowrap"
    >
      <span className="text-muted">{label}</span>
      <span className="text-accent font-mono">{value.toLocaleString()}</span>
    </span>
  );
}

// The library action group for the header toolbar.
export function LibraryToolbar({ lib }: { lib: LibraryController }) {
  return (
    <div className="inline-flex items-center gap-1">
      <ToolbarIconButton
        title="Import a local music folder"
        onClick={lib.pickFolder}
      >
        <FolderInput size={14} />
      </ToolbarIconButton>
      <ToolbarIconButton
        title="Import a Discogs collection CSV"
        onClick={lib.pickDiscogsCsv}
      >
        <Disc size={14} />
      </ToolbarIconButton>
      <ToolbarIconButton
        title={lib.exporting ? "exporting…" : "Export library as markdown"}
        onClick={lib.exportMarkdownFile}
        disabled={lib.exporting}
      >
        <FileDown size={14} />
      </ToolbarIconButton>
    </div>
  );
}

// --- Transient flow panel ---------------------------------------------------

// Shown in the left column only while an import is mid-flight (or an export
// result / error is pending). Hosts the scan → confirm → progress → done flow.
export function LibraryFlowPanel({ lib }: { lib: LibraryController }) {
  const { phase, pickedPath, scan, progress, last, error, exportMsg } = lib;

  // How many rows the Import button will actually take in, given the Discogs
  // medium filter.
  const discogsImportCount =
    scan?.kind === "discogs"
      ? lib.mediumFilter === "physical"
        ? scan.report.physical
        : lib.mediumFilter === "digital"
          ? scan.report.digital
          : scan.report.totalRows
      : 0;

  return (
    <Section
      title="Library"
      icon={<Library size={16} />}
      right={
        phase !== "importing" ? (
          <button
            type="button"
            onClick={lib.reset}
            title="Dismiss"
            aria-label="Dismiss"
            className="text-muted hover:text-alert transition-colors p-1
                       rounded-md hover:bg-surface"
          >
            <X size={14} />
          </button>
        ) : undefined
      }
    >
      {phase === "idle" && (exportMsg || error) && (
        <div className="text-xs">
          {exportMsg && (
            <div
              className={
                exportMsg.startsWith("error") ? "text-alert" : "text-ok"
              }
            >
              {exportMsg}
            </div>
          )}
          {error && <div className="text-alert">{error}</div>}
        </div>
      )}

      {phase === "scanning" && (
        <div className="text-xs text-muted">
          scanning <span className="font-mono text-fg/80">{pickedPath}</span>…
        </div>
      )}

      {phase === "ready" && scan && (
        <>
          <div className="text-[10px] font-mono text-muted break-all">
            {pickedPath}
          </div>
          {scan.kind === "folder" ? (
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <ScanStat label="folders" value={scan.report.totalDirs.toLocaleString()} />
              <ScanStat label="files" value={scan.report.totalFiles.toLocaleString()} />
              <ScanStat label="size" value={formatBytes(scan.report.totalBytes)} />
            </div>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                <ScanStat label="rows" value={scan.report.totalRows.toLocaleString()} />
                <ScanStat label="physical" value={scan.report.physical.toLocaleString()} tone="ok" />
                <ScanStat label="digital" value={scan.report.digital.toLocaleString()} tone="ok" />
                <ScanStat label="w/ cond" value={scan.report.withCondition.toLocaleString()} tone="muted" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted">
                  import
                </span>
                <div className="flex rounded-md overflow-hidden border border-surface">
                  {(["both", "physical", "digital"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => lib.setMediumFilter(m)}
                      className={
                        "px-2.5 py-1 text-xs capitalize transition-colors " +
                        (lib.mediumFilter === m
                          ? "bg-accent text-bg font-semibold"
                          : "bg-surface text-fg hover:bg-surfaceHover")
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={lib.runImport}
              disabled={scan.kind === "discogs" && discogsImportCount === 0}
              className="px-4 py-2 rounded-md bg-accent text-bg font-semibold
                         hover:opacity-90 disabled:opacity-50
                         disabled:cursor-not-allowed flex items-center gap-2
                         text-xs"
            >
              <Play size={14} /> Import{" "}
              {(scan.kind === "folder"
                ? scan.report.totalDirs
                : discogsImportCount
              ).toLocaleString()}{" "}
              {scan.kind === "folder" ? "releases" : "rows"}
            </button>
            <button
              onClick={lib.reset}
              className="px-3 py-2 rounded-md bg-surface hover:bg-surfaceHover
                         text-fg flex items-center gap-1.5 text-xs"
            >
              <RotateCcw size={12} /> cancel
            </button>
          </div>
          {error && <div className="mt-2 text-alert text-xs">{error}</div>}
        </>
      )}

      {phase === "importing" && progress && (
        <>
          <div className="text-[10px] font-mono text-muted break-all">
            {pickedPath}
          </div>
          <ProgressBar current={progress.current} total={progress.total || 1} />
          <div className="mt-1 flex justify-between text-[10px] text-muted">
            <span className="font-mono">
              {progress.current.toLocaleString()} /{" "}
              {progress.total.toLocaleString()}
            </span>
            <span className="font-mono">
              {pct(progress.current, progress.total || 1)}%
            </span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-fg/70 truncate">
            {progress.currentDir}
          </div>
        </>
      )}

      {phase === "done" && last && (
        <>
          <div className="text-[10px] font-mono text-muted break-all">
            {pickedPath}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <ScanStat label="scanned" value={last.scanned.toLocaleString()} />
            <ScanStat label="imported" value={last.imported.toLocaleString()} tone="ok" />
            <ScanStat label="skipped" value={last.skipped.toLocaleString()} tone="muted" />
          </div>
          {last.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-warn cursor-pointer text-xs">
                {last.errors.length} warning
                {last.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 max-h-32 overflow-auto font-mono text-[10px]
                             text-alert/90 space-y-0.5">
                {last.errors.map((err, i) => (
                  <li key={i} className="break-all">
                    {err}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            onClick={lib.reset}
            className="mt-3 px-3 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                       text-fg flex items-center gap-1.5 text-xs"
          >
            <FolderInput size={12} /> import another source
          </button>
        </>
      )}
    </Section>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  return (
    <div className="mt-2 h-2 rounded-full bg-surface overflow-hidden">
      <div
        className="h-full bg-accent transition-[width] duration-150"
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function ScanStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "muted";
}) {
  const valueCls =
    tone === "ok" ? "text-ok" : tone === "muted" ? "text-muted" : "text-fg";
  return (
    <div className="rounded-md bg-surface/50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`font-mono text-sm ${valueCls}`}>{value}</div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function pct(current: number, total: number): string {
  if (total <= 0) return "0";
  return ((current / total) * 100).toFixed(current === total ? 0 : 1);
}
