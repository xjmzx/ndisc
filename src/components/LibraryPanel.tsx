import { useEffect, useState } from "react";
import {
  Disc,
  FileDown,
  FolderInput,
  Library,
  Play,
  RotateCcw,
} from "lucide-react";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Section } from "./Section";
import { DB_BUTTON_CLS } from "../lib/buttonStyles";
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

interface Props {
  reloadKey: number;
  onImported: () => void;
}

type Phase = "idle" | "scanning" | "ready" | "importing" | "done";

type ScanResult =
  | { kind: "folder"; report: ScanReport }
  | { kind: "discogs"; report: ScanDiscogsReport };

export function LibraryPanel({ reloadKey, onImported }: Props) {
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
  const [mediumFilter, setMediumFilter] = useState<
    "both" | "physical" | "digital"
  >("both");

  // --- Export ---------------------------------------------------------------
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  async function onExportMarkdown() {
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

  function reset() {
    setPhase("idle");
    setPickedPath(null);
    setScan(null);
    setProgress(null);
    setLast(null);
    setError(null);
    setMediumFilter("both");
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

  // --- Render ---------------------------------------------------------------
  // How many rows the Import button will actually take in, given the
  // Discogs medium filter.
  const discogsImportCount =
    scan?.kind === "discogs"
      ? mediumFilter === "physical"
        ? scan.report.physical
        : mediumFilter === "digital"
          ? scan.report.digital
          : scan.report.totalRows
      : 0;

  const inlineStats = stats ? (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm items-center">
      <StatBadge label="Total" value={String(stats.total)} />
      <StatBadge label="Physical" value={String(stats.physical)} />
      <StatBadge label="Digital" value={String(stats.digital)} />
      <StatBadge label="Artists" value={String(stats.uniqueArtists)} />
    </div>
  ) : (
    <span className="text-sm text-muted">no data yet</span>
  );

  return (
    <Section
      title="Library"
      icon={<Library size={16} />}
      right={inlineStats}
    >
      {phase === "idle" && (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={pickFolder} className={DB_BUTTON_CLS}>
              <FolderInput size={14} /> Import Local
            </button>
            <button onClick={pickDiscogsCsv} className={DB_BUTTON_CLS}>
              <Disc size={14} /> Import Discogs
            </button>
            <button
              onClick={onExportMarkdown}
              disabled={exporting}
              className={DB_BUTTON_CLS}
            >
              <FileDown size={14} />{" "}
              {exporting ? "exporting…" : "Export Markdown"}
            </button>
          </div>
          {exportMsg && (
            <div
              className={
                "mt-1 text-xs text-right " +
                (exportMsg.startsWith("error") ? "text-alert" : "text-ok")
              }
            >
              {exportMsg}
            </div>
          )}
          {error && (
            <div className="mt-1 text-alert text-xs text-right">{error}</div>
          )}
        </>
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
                      onClick={() => setMediumFilter(m)}
                      className={
                        "px-2.5 py-1 text-xs capitalize transition-colors " +
                        (mediumFilter === m
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
              onClick={runImport}
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
              onClick={reset}
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
            onClick={reset}
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

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted">{label} </span>
      <span className="text-accent font-mono">{value}</span>
    </span>
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
