import { useEffect, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ExternalLink, Pencil, Play, X } from "lucide-react";
import { cn } from "../lib/cn";
import { useReview, type ReviewTab } from "../lib/review";
import { ask, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  labelArtKinds,
  labelListText,
  labelLocalKinds,
  planLabelsFill,
  runLabelsFill,
  writeCoverList,
  type ImportProgress,
  type LabelFillPlan,
  type LabelFillRun,
  type LabelArtCheck,
  type LabelArtItem,
  type LabelLocalItem,
} from "../lib/tauri";
import { LocalCoverDetails, type CoverInspect } from "./ReleaseList";
import type { LabelEntry } from "./LabelPanel";

// The Review overlay (docs/backlog.md, "Review overlay"): the results of
// Local covers vs Blossom and of Check label art, in an overlay over the app
// like Relays & servers, but nearly window-sized. It opens itself when a
// check finishes; the summary line a check leaves behind opens it again.
//
// It stays MOUNTED while closed (hidden), so ticks and filters survive
// closing it. A fresh cover check remounts the cover results (`key`).

// The label results' filter chips: every flagged image, or one flag.
export type ArtFilter = "flagged" | "low" | "over" | "png" | "shape" | "other" | "elsewhere" | "unreadable";

export function artPasses(f: ArtFilter, r: LabelArtItem, check: LabelArtCheck): boolean {
  switch (f) {
    case "low":
      return r.lowRes;
    case "over":
      return r.overSize;
    case "png":
      return r.png;
    case "shape":
      return r.notSquare;
    case "other":
      return r.otherFormat;
    case "elsewhere":
      return !!check.primary && !r.onPrimary;
    case "unreadable":
      return !!r.unreadable;
    default:
      return labelArtKinds(r, check).length > 0;
  }
}

function normaliseName(s: string): string {
  return s.trim().toLowerCase();
}

function LabelArtDetails({
  check,
  onInspect,
  inspected,
}: {
  check: LabelArtCheck;
  onInspect: (item: LabelArtItem) => void;
  inspected: string | null;
}) {
  const [filter, setFilter] = useState<ArtFilter>("flagged");
  const shown = check.items.filter((r) => artPasses(filter, r, check));
  return (
    <div className="text-xs">
      <p className="text-muted">
        Read from each image’s first bytes; nothing is changed. Low-res is a long side under{" "}
        {check.lowPx} px; over {check.libraryPx} px and PNG aren’t optimised for publishing; not
        square is more than {check.squareTolerancePct}% off. Click an image to see it large and
        edit the labels that use it.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
        {(
          [
            ["flagged", "Flagged"],
            ["low", "Low-res"],
            ["over", `Over ${check.libraryPx}`],
            ["png", "PNG"],
            ["shape", "Not square"],
            ["other", "Other format"],
            ["elsewhere", "Not on primary"],
            ["unreadable", "Unreadable"],
          ] as const
        )
          .map(([k, label]) => [k, label, check.items.filter((r) => artPasses(k, r, check)).length] as const)
          .filter(([k, , n]) => k === "flagged" || n > 0)
          .map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={cn(
                "px-2 py-0.5 rounded",
                filter === k ? "bg-accent/15 text-accent" : "bg-surface text-muted hover:text-fg",
              )}
            >
              {label} <span className="font-mono">{n}</span>
            </button>
          ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-1">
        {shown.map((r) => (
          <li
            key={r.url}
            onClick={() => onInspect(r)}
            className={cn(
              "flex items-center gap-3 px-2 py-1.5 rounded bg-bg/50 cursor-pointer hover:bg-bg/80",
              inspected === r.url && "ring-1 ring-accent/70",
            )}
          >
            <img
              src={r.url}
              loading="lazy"
              alt=""
              className="w-14 h-14 object-contain bg-surface rounded shrink-0"
              title={r.url}
            />
            <span className="min-w-0">
              <span className="block truncate">
                <span className="text-fg">{r.labels.slice(0, 6).join(", ")}</span>
                {r.labels.length > 6 && (
                  <span className="text-muted" title={r.labels.join(", ")}>
                    {" "}
                    and {r.labels.length - 6} more
                  </span>
                )}
              </span>
              <span className="block text-[10px] text-muted font-mono truncate" title={r.unreadable ?? r.url}>
                {r.dims ? `${r.dims[0]}×${r.dims[1]}` : "size ?"} · {r.format} · {r.host}
                {(() => {
                  // The format is printed already; don't repeat it as a flag.
                  const k = labelArtKinds(r, check).filter((x) => x !== r.format);
                  return k.length > 0 ? ` · ${k.join(" · ")}` : "";
                })()}
              </span>
            </span>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-2 py-1 text-muted">nothing here: every label image is in shape</li>
        )}
      </ul>
    </div>
  );
}

type LocalFilter = "all" | "low" | "over" | "png" | "shape" | "other" | "shared" | "larger" | "none";

function localPasses(f: LocalFilter, r: LabelLocalItem): boolean {
  switch (f) {
    case "low":
      return r.lowRes;
    case "over":
      return r.overSize;
    case "png":
      return r.png;
    case "shape":
      return r.notSquare;
    case "other":
      return r.otherFormat;
    case "shared":
      return r.publishedNotOwn;
    case "larger":
      return r.publishedLarger;
    default:
      return true;
  }
}

const joinPath = (folder: string, file: string) => `${folder.replace(/[\\/]+$/, "")}/${file}`;

function LabelLocalDetails({
  check,
  onInspect,
  inspected,
  onNoFile,
}: {
  check: LabelArtCheck;
  onInspect: (item: LabelLocalItem) => void;
  // The inspected row's label name (a local file or a "No file" name).
  inspected: string | null;
  onNoFile: (name: string) => void;
}) {
  const [filter, setFilter] = useState<LocalFilter>("all");
  const folder = check.folder ?? "";
  // The flagged labels as a list for ncover's From a list… (stage 3c).
  const listText = labelListText(check);
  const listCount = listText ? listText.split("\n").length - 1 : 0;
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  async function exportList() {
    setExportMsg(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const dest = await saveDialog({
        title: "Export label list",
        defaultPath: `ndisc-labels-${stamp}.txt`,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (typeof dest !== "string") return;
      await writeCoverList(dest, listText);
      setExportMsg(`${listCount.toLocaleString()} line${listCount === 1 ? "" : "s"} written to ${dest}`);
    } catch (e) {
      setExportMsg(`error: ${e}`);
    }
  }
  const shown = filter === "none" ? [] : check.locals.filter((r) => localPasses(filter, r));
  return (
    <div className="text-xs">
      {listCount > 0 && (
        <div className="mb-2 px-3 py-2 rounded-md bg-surface/40 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted">
            {exportMsg ??
              `Export every flagged label (${listCount.toLocaleString()}) as a list for ncover’s From a list… — one line per label file; Square and Cap pick the lines they are for.`}
          </span>
          <button
            type="button"
            onClick={exportList}
            className="ml-auto px-2 py-0.5 rounded bg-surface text-muted hover:text-fg"
            title="The cover list's format: the label art folder, the label's file, its name, local and published size, format, flags and actions, tab-separated. Labels with no file are left out."
          >
            Export list
          </button>
        </div>
      )}
      <p className="text-muted">
        Each label’s own file in <span className="font-mono">{folder}</span>, beside what is
        published for it. Not its own image: the label publishes an image that is not this file
        (usually the placeholder many labels show), so its own master has never been published.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
        {(
          [
            ["all", "With a file", check.locals.length],
            ["low", "Low-res", check.locals.filter((r) => r.lowRes).length],
            ["over", `Over ${check.libraryPx}`, check.locals.filter((r) => r.overSize).length],
            ["png", "PNG", check.locals.filter((r) => r.png).length],
            ["shape", "Not square", check.locals.filter((r) => r.notSquare).length],
            ["other", "Other format", check.locals.filter((r) => r.otherFormat).length],
            ["shared", "Not its own image", check.locals.filter((r) => r.publishedNotOwn).length],
            ["larger", "Published is larger", check.locals.filter((r) => r.publishedLarger).length],
            ["none", "No file", check.noLocal.length],
          ] as const
        )
          .filter(([k, , n]) => k === "all" || n > 0)
          .map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={cn(
                "px-2 py-0.5 rounded",
                filter === k ? "bg-accent/15 text-accent" : "bg-surface text-muted hover:text-fg",
              )}
            >
              {label} <span className="font-mono">{n}</span>
            </button>
          ))}
      </div>
      {filter === "none" ? (
        <>
          <p className="mt-2 text-muted">
            No file in the folder matches these names. Click one to see what it publishes; Edit
            label opens its form to pick its file.
          </p>
          <ul className="mt-1 grid grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-0.5">
            {check.noLocal.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => onNoFile(name)}
                  className={cn(
                    "w-full text-left px-2 py-0.5 rounded hover:bg-surface truncate",
                    inspected === name && "ring-1 ring-accent/70",
                  )}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-1">
          {shown.map((r) => (
            <li
              key={r.name}
              onClick={() => onInspect(r)}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded bg-bg/50 cursor-pointer hover:bg-bg/80",
                inspected === r.name && "ring-1 ring-accent/70",
              )}
            >
              <img
                src={convertFileSrc(joinPath(folder, r.file))}
                loading="lazy"
                alt=""
                className="w-12 h-12 object-contain bg-surface rounded shrink-0"
                title="Local file"
              />
              {r.publishedUrl ? (
                <img
                  src={r.publishedUrl}
                  loading="lazy"
                  alt=""
                  className="w-12 h-12 object-contain bg-surface rounded shrink-0"
                  title="Published"
                />
              ) : (
                <span className="w-12 h-12 bg-surface/50 rounded shrink-0" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-fg">{r.name}</span>
                <span className="block text-[10px] text-muted font-mono truncate" title={r.file}>
                  {r.dims ? `${r.dims[0]}×${r.dims[1]}` : "size ?"} · {r.format} ·{" "}
                  {(r.bytes / 1024).toFixed(0)} KB
                  {r.how === "close" ? " · close match" : ""}
                  {labelLocalKinds(r, check)
                    .filter((k) => k !== r.format)
                    .map((k) => ` · ${k}`)
                    .join("")}
                </span>
              </span>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1 text-muted">none</li>}
        </ul>
      )}
    </div>
  );
}

const dimsText = (d: [number, number] | null) => (d ? `${d[0]} × ${d[1]}` : "size unknown");

function Pane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted">{title}</span>
      {children}
    </div>
  );
}

// Square, at most 45% of the window high, so what sits under it (the
// labels using an image, a cover's actions) stays in view.
function BigImage({ src, alt }: { src: string | null; alt: string }) {
  const box = "w-full max-w-[45vh] mx-auto aspect-square rounded-md";
  return src ? (
    <img src={src} alt={alt} className={cn(box, "object-contain bg-surface")} />
  ) : (
    <div className={cn(box, "bg-surface/50 flex items-center justify-center text-[11px] text-muted")}>
      none
    </div>
  );
}

const actionCls =
  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";

function CoverInspector({
  item,
  canAct,
  onUpload,
  onSave,
  onOpenRelease,
}: {
  item: CoverInspect;
  canAct: boolean;
  onUpload: () => void;
  onSave: () => void;
  onOpenRelease: () => void;
}) {
  const kb = item.localBytes != null ? ` · ${(item.localBytes / 1024).toFixed(0)} KB` : "";
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <div className="text-sm text-fg">
          {item.artist} <span className="text-muted">·</span> {item.title}
        </div>
        <p className="mt-1 text-muted">{item.note}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Pane title="On disk">
          <BigImage src={item.localPath ? convertFileSrc(item.localPath) : null} alt="On disk" />
          <span className="font-mono text-[10px] text-muted">
            {item.localPath ? `${dimsText(item.localDims)}${kb}` : "no file"}
          </span>
          {item.localPath && (
            <span className="font-mono text-[10px] text-muted break-all">{item.localPath}</span>
          )}
        </Pane>
        <Pane title="Published">
          <BigImage src={item.publishedUrl} alt="Published" />
          <span className="font-mono text-[10px] text-muted">
            {item.publishedUrl ? dimsText(item.publishedDims) : "no cover published"}
          </span>
          {item.publishedUrl && (
            <span className="font-mono text-[10px] text-muted break-all">{item.publishedUrl}</span>
          )}
        </Pane>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {item.canSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={!canAct}
            className={cn(actionCls, "bg-accent/15 text-accent hover:bg-accent hover:text-bg")}
            title="Blossom is right: download the published image over the file on disk (the old file goes to the cover attic)"
          >
            Keep Blossom · save to disk
          </button>
        )}
        {item.canUpload && (
          <button
            type="button"
            onClick={onUpload}
            disabled={!canAct}
            className={cn(actionCls, "bg-nostr/15 text-nostr hover:bg-nostr hover:text-bg")}
            title="Disk is right: upload this cover and mark the release stale"
          >
            Keep disk · upload
          </button>
        )}
        <button
          type="button"
          onClick={onOpenRelease}
          className={cn(actionCls, "bg-surface text-muted hover:text-fg flex items-center gap-1")}
          title="Close Review and show this release on Home"
        >
          <ExternalLink size={12} />
          Open release
        </button>
      </div>
      {!canAct && (item.canSave || item.canUpload) && (
        <p className="text-[10px] text-muted">Uploading and saving run from Home.</p>
      )}
    </div>
  );
}

function LabelInspector({
  item,
  check,
  labels,
  onPick,
}: {
  item: LabelArtItem;
  check: LabelArtCheck;
  labels: LabelEntry[];
  onPick: (name: string, url: string, site: string) => void;
}) {
  const byName = new Map(labels.map((l) => [normaliseName(l.name), l]));
  const kinds = labelArtKinds(item, check);
  return (
    <div className="flex flex-col gap-3 text-xs">
      <BigImage src={item.url} alt="Label art" />
      <div className="font-mono text-[10px] text-muted">
        {dimsText(item.dims)} · {item.format} · {item.host}
        {kinds.length > 0 && <span className="text-warn"> · {kinds.join(" · ")}</span>}
      </div>
      <span className="font-mono text-[10px] text-muted break-all">{item.url}</span>
      {item.unreadable && <p className="text-warn">{item.unreadable}</p>}
      <div>
        <span className="text-[10px] uppercase tracking-wide text-muted">
          Used by {item.labels.length} label{item.labels.length === 1 ? "" : "s"}
        </span>
        <ul className="mt-1 max-h-72 overflow-auto space-y-0.5">
          {item.labels.map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => {
                  const e = byName.get(normaliseName(name));
                  onPick(name, e?.imageUrl ?? item.url, e?.siteUrl ?? "");
                }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-surface text-left text-fg"
                title="Edit this label"
              >
                <Pencil size={10} className="text-muted shrink-0" />
                <span className="truncate">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Filling `<library root>/_labels` (backlog 4b, 3e): plan (read-only), then
// a confirmed run that copies masters from the folder in use and downloads
// labels' own published images, then "Use _labels", which points every
// label at its new file and makes `_labels` the label art folder.
function LabelsFillBar({
  labels,
  setLabels,
}: {
  labels: LabelEntry[];
  setLabels: (next: LabelEntry[]) => void;
}) {
  const review = useReview();
  const def = review.artDefault;
  const onDefault = !!def && review.artFolder === def.path;
  const [plan, setPlan] = useState<LabelFillPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [run, setRun] = useState<LabelFillRun | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!def) return null;
  const count = (a: string) => plan?.items.filter((i) => i.action === a) ?? [];
  const labelsIn = (a: string) => count(a).reduce((n, i) => n + i.labels.length, 0);

  async function makePlan() {
    setErr(null);
    setRun(null);
    try {
      setPlan(await planLabelsFill(onDefault ? null : review.artFolder, labels));
    } catch (e) {
      setErr(String(e));
    }
  }

  async function fill() {
    if (!plan) return;
    const todo = plan.items.filter((i) => i.action !== "exists").length;
    const yes = await ask(
      `Fill ${plan.target}?\n\n` +
        `${count("copy").length} masters are copied from ${plan.source ?? "—"} (that folder is not changed), and ` +
        `${count("download").length} published images are downloaded and checked against their hash. ` +
        `${todo} new files in all; nothing is overwritten, and every file is logged.`,
      { title: "Fill _labels", kind: "info" },
    );
    if (!yes) return;
    setBusy(true);
    setErr(null);
    let un: UnlistenFn | null = null;
    try {
      un = await listen<ImportProgress>("label-fill:progress", (e) => setProgress(e.payload));
      setRun(await runLabelsFill(plan.items));
      review.refreshArtDefault();
    } catch (e) {
      setErr(String(e));
    } finally {
      un?.();
      setBusy(false);
      setProgress(null);
    }
  }

  function useLabelsFolder() {
    if (!run) return;
    const fileOf = new Map<string, string>();
    for (const r of run.results)
      if (r.status === "ok" || r.status === "exists")
        for (const n of r.labels) fileOf.set(n.trim().toLowerCase(), r.file);
    // Every label is pointed at its file in `_labels`; picks made for the
    // old folder go, since they named files there.
    setLabels(
      labels.map((l) => {
        const f = fileOf.get(l.name.trim().toLowerCase());
        const { artFile: _old, ...rest } = l;
        return f ? { ...rest, artFile: f } : rest;
      }),
    );
    setPlan(null);
    setRun(null);
    review.setArtFolder(null);
    review.refreshArtDefault();
    setTimeout(() => void review.runLabelCheck(), 400);
  }

  const failed = run?.results.filter((r) => r.status !== "ok" && r.status !== "exists") ?? [];
  return (
    <div className="mb-3 px-3 py-2 rounded-md bg-surface/40 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted flex-1 min-w-0">
          {onDefault ? (
            <>
              Label art: <span className="font-mono text-fg/80">{def.path}</span>
            </>
          ) : (
            <>
              <span className="font-mono text-fg/80">_labels</span> ({def.path}
              {def.exists ? "" : ", not created yet"}) is where label art belongs: one file per
              label, named after it.{" "}
              {review.artFolder
                ? "Fill it from the folder in use and Blossom."
                : "Set the old label folder first to copy from it, or fill from Blossom alone."}
            </>
          )}
        </span>
        {!run && (
          <button
            type="button"
            onClick={makePlan}
            disabled={busy}
            className="px-2 py-0.5 rounded bg-surface text-muted hover:text-fg disabled:opacity-40"
            title="Work out what filling _labels would copy and download. Nothing is written."
          >
            {onDefault ? "Fill from Blossom…" : "Plan fill…"}
          </button>
        )}
      </div>
      {err && <p className="mt-1 text-warn">{err}</p>}
      {plan && !run && (
        <div className="mt-2">
          <p className="text-fg/90">
            Copy {count("copy").length} masters ({labelsIn("copy")} labels) · download{" "}
            {count("download").length} own images ({labelsIn("download")} labels)
            {count("exists").length > 0 && ` · ${count("exists").length} already there`} · nothing for{" "}
            {plan.nothing.length} (placeholder or no image)
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-muted">Each file it would write</summary>
            <ul className="mt-1 max-h-48 overflow-auto font-mono text-[10px] text-muted space-y-0.5">
              {plan.items.map((i) => (
                <li key={i.file}>
                  {i.action} · {i.labels.join(" + ")} → {i.file}
                </li>
              ))}
            </ul>
          </details>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={fill}
              disabled={busy || plan.items.every((i) => i.action === "exists")}
              className="px-2.5 py-1 rounded-md bg-accent/15 text-accent hover:bg-accent/25 font-medium disabled:opacity-40"
            >
              {busy
                ? progress
                  ? `filling ${progress.current} / ${progress.total}…`
                  : "filling…"
                : "Fill _labels"}
            </button>
            <button type="button" onClick={() => setPlan(null)} className="text-muted hover:text-fg">
              Cancel
            </button>
          </div>
        </div>
      )}
      {run && (
        <div className="mt-2">
          <p className="text-fg/90">
            {run.written} file{run.written === 1 ? "" : "s"} written to {run.target}
            {failed.length > 0 && <span className="text-warn"> · {failed.length} not written</span>} · log:{" "}
            <span className="font-mono">{run.log}</span>
          </p>
          {failed.length > 0 && (
            <ul className="mt-1 max-h-32 overflow-auto text-[10px] text-warn space-y-0.5">
              {failed.map((f) => (
                <li key={f.file}>
                  {f.labels.join(" + ")} → {f.file}: {f.status}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={useLabelsFolder}
            className="mt-2 px-2.5 py-1 rounded-md bg-accent/15 text-accent hover:bg-accent/25 font-medium"
            title="Point every label at its file in _labels and read label art from there from now on; the old folder stays as it is."
          >
            Use _labels
          </button>
        </div>
      )}
    </div>
  );
}

function LocalLabelInspector({
  item,
  check,
  onEdit,
}: {
  item: LabelLocalItem;
  check: LabelArtCheck;
  onEdit: () => void;
}) {
  const kinds = labelLocalKinds(item, check);
  const folder = check.folder ?? "";
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <div className="text-sm text-fg">{item.name}</div>
        <p className="mt-1 text-muted">
          {item.how === "picked"
            ? "File picked by hand."
            : item.how === "close"
              ? "A close match by name: check it is this label's."
              : "Matched by name."}
          {item.publishedNotOwn
            ? ` It publishes an image that is not this file${
                item.publishedShared > 2 ? `, shared with ${item.publishedShared - 1} other labels (a placeholder)` : ""
              }, so this master has never been published.`
            : item.publishedShared > 1
              ? ` Its published image is shared with ${item.publishedShared - 1} other name${
                  item.publishedShared === 2 ? "" : "s"
                } for the same label.`
              : ""}
          {item.publishedLarger && " The published copy is larger than this file."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Pane title="Local file">
          <BigImage src={convertFileSrc(joinPath(folder, item.file))} alt="Local file" />
          <span className="font-mono text-[10px] text-muted">
            {dimsText(item.dims)} · {item.format} · {(item.bytes / 1024).toFixed(0)} KB
          </span>
          <span className="font-mono text-[10px] text-muted break-all">{item.file}</span>
        </Pane>
        <Pane title="Published">
          <BigImage src={item.publishedUrl} alt="Published" />
          <span className="font-mono text-[10px] text-muted">
            {item.publishedUrl ? dimsText(item.publishedDims) : "nothing published"}
          </span>
          {item.publishedUrl && (
            <span className="font-mono text-[10px] text-muted break-all">{item.publishedUrl}</span>
          )}
        </Pane>
      </div>
      {kinds.length > 0 && <div className="font-mono text-[10px] text-warn">{kinds.join(" · ")}</div>}
      <div>
        <button
          type="button"
          onClick={onEdit}
          className={cn(actionCls, "bg-surface text-muted hover:text-fg flex items-center gap-1")}
          title="Close Review and open this label's form"
        >
          <Pencil size={12} />
          Edit label
        </button>
      </div>
    </div>
  );
}

export function ReviewOverlay({
  labels,
  setLabels,
  onPickLabel,
  onOpenRelease,
}: {
  labels: LabelEntry[];
  setLabels: (next: LabelEntry[]) => void;
  // Close the overlay and open this label in the Labels page's form.
  onPickLabel: (name: string, url: string, site: string) => void;
  // Show this release on Home.
  onOpenRelease: (id: number) => void;
}) {
  const review = useReview();
  const { open, close, tab, setTab, cover, coverActions, label } = review;
  // What the inspector shows, per tab. A fresh check clears it.
  const [coverPick, setCoverPick] = useState<CoverInspect | null>(null);
  const [labelPick, setLabelPick] = useState<LabelArtItem | null>(null);
  const [localPick, setLocalPick] = useState<LabelLocalItem | null>(null);
  // A "No file" label being inspected, by name.
  const [noFilePick, setNoFilePick] = useState<string | null>(null);
  // The Labels tab shows the published images or the label art folder's files.
  const [labelSide, setLabelSide] = useState<"published" | "local">("published");
  useEffect(() => setCoverPick(null), [cover?.run]);
  useEffect(() => {
    setLabelPick(null);
    setLocalPick(null);
    setNoFilePick(null);
  }, [label]);
  const pickLabel = (n: string, u: string, site: string) => {
    close();
    onPickLabel(n, u, site);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const tabs: [ReviewTab, string, number | null][] = [
    ["covers", "Covers", cover ? cover.data.differing.length + cover.data.quality.length : null],
    [
      "labels",
      "Labels",
      label ? label.items.filter((r) => artPasses("flagged", r, label)).length : null,
    ],
  ];

  const runCovers = () => {
    if (!coverActions || coverActions.busy) return;
    // The check's progress line is the release list's, under the overlay.
    close();
    coverActions.check();
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 p-4 bg-bg/70 backdrop-blur-sm",
        open ? "flex" : "hidden",
      )}
      onClick={close}
    >
      <div
        role="dialog"
        aria-label="Review"
        className="w-full h-full flex flex-col rounded-lg border border-surface/70 bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-surface/60">
          <h3 className="text-sm font-medium text-fg">Review</h3>
          <div className="flex items-center gap-1">
            {tabs.map(([k, name, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={cn(
                  "px-3 py-1 rounded-md text-xs transition-colors",
                  tab === k ? "bg-fg text-bg" : "bg-surface text-muted hover:text-fg",
                )}
              >
                {name}
                {n !== null && <span className="ml-1.5 font-mono opacity-70">{n}</span>}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {tab === "covers" ? (
            <button
              type="button"
              onClick={runCovers}
              disabled={!coverActions || coverActions.busy}
              title={
                coverActions
                  ? "Run Local covers vs Blossom again. Its progress shows in the release list; this opens again when it finishes."
                  : "The cover check runs from Home: open Home first."
              }
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface text-xs text-muted
                         hover:text-fg disabled:opacity-40"
            >
              <Play size={12} />
              {cover ? "Run again" : "Run the check"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void review.runLabelCheck()}
              disabled={review.labelRunning || labels.length === 0}
              title="Check label art again: every published label image's size, format and shape."
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface text-xs text-muted
                         hover:text-fg disabled:opacity-40"
            >
              <Play size={12} />
              {label ? "Run again" : "Run the check"}
            </button>
          )}
          <button type="button" onClick={close} className="text-muted hover:text-fg" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-h-0 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
          <div className={tab === "covers" ? "" : "hidden"}>
            {cover ? (
              <>
                {!coverActions && (
                  <p className="mb-2 px-3 py-2 rounded-md bg-surface/40 text-xs text-warn">
                    Uploading and saving run from Home. Open Home and press Review on the
                    summary line to act on these.
                  </p>
                )}
                {cover.data.differing.length +
                  cover.data.elsewhere.length +
                  cover.data.noLocal.length +
                  cover.data.noCover.length +
                  cover.data.quality.length +
                  cover.data.warnings.length ===
                  0 && (
                  <p className="text-xs text-muted">
                    Nothing to review: {cover.data.published.toLocaleString()} published release
                    {cover.data.published === 1 ? "" : "s"} checked
                    {cover.data.published > 0 ? ", every cover in step with Blossom." : "."}
                  </p>
                )}
                <LocalCoverDetails
                  key={cover.run}
                  check={cover.data}
                  uploads={cover.uploads}
                  saves={cover.saves}
                  onUpload={(ids) => coverActions?.upload(ids)}
                  onSaveFromBlossom={(ids) => coverActions?.save(ids)}
                  onInspect={setCoverPick}
                  inspected={coverPick?.key ?? null}
                />
              </>
            ) : (
              <p className="text-xs text-muted">
                No cover check yet. Local covers vs Blossom compares every published release’s
                cover on disk with the image readers see.
              </p>
            )}
          </div>
          <div className={tab === "labels" ? "" : "hidden"}>
            {review.labelRunning && (
              <p className="mb-2 px-3 py-2 rounded-md bg-surface/40 text-xs text-muted">
                {review.labelProgress
                  ? `reading label images ${review.labelProgress.current} / ${review.labelProgress.total} · ${review.labelProgress.currentDir}`
                  : "reading label images…"}
              </p>
            )}
            {review.labelError && (
              <p className="mb-2 text-xs text-warn">{review.labelError}</p>
            )}
            {label ? (
              <>
                <LabelsFillBar labels={labels} setLabels={setLabels} />
                {label.folder && (
                  <div className="mb-3 flex items-center gap-1 text-[11px]">
                    {(
                      [
                        ["published", `Published images ${label.images}`],
                        ["local", `Local files ${label.locals.length}`],
                      ] as const
                    ).map(([k, name]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setLabelSide(k)}
                        aria-pressed={labelSide === k}
                        className={cn(
                          "px-2.5 py-0.5 rounded-md",
                          labelSide === k ? "bg-surface text-fg" : "text-muted hover:text-fg",
                        )}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                {label.folder && labelSide === "local" ? (
                  <LabelLocalDetails
                    check={label}
                    onInspect={(item) => {
                      setNoFilePick(null);
                      setLocalPick(item);
                    }}
                    inspected={noFilePick ?? localPick?.name ?? null}
                    onNoFile={(name) => {
                      setLocalPick(null);
                      setNoFilePick(name);
                    }}
                  />
                ) : (
                  <LabelArtDetails
                    check={label}
                    onInspect={setLabelPick}
                    inspected={labelPick?.url ?? null}
                  />
                )}
                {!label.folder && (
                  <p className="mt-3 text-[11px] text-muted">
                    Set a label art folder (the folder icon in the Labels list) to check each
                    label’s own file as well.
                  </p>
                )}
              </>
            ) : (
              !review.labelRunning && (
                <p className="text-xs text-muted">
                  No label check yet. Check label art reads every published label image’s size,
                  format and shape.
                </p>
              )
            )}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 py-3 border-l border-surface/60 [scrollbar-gutter:stable]">
          {tab === "covers" ? (
            coverPick ? (
              <CoverInspector
                item={coverPick}
                canAct={!!coverActions && !coverActions.busy}
                onUpload={() => coverActions?.upload([coverPick.id])}
                onSave={() => coverActions?.save([coverPick.id])}
                onOpenRelease={() => {
                  close();
                  onOpenRelease(coverPick.id);
                }}
              />
            ) : (
              <p className="text-xs text-muted">Select a cover to see it large.</p>
            )
          ) : label && label.folder && labelSide === "local" ? (
            noFilePick ? (
              (() => {
                const e = labels.find((l) => normaliseName(l.name) === normaliseName(noFilePick));
                return (
                  <div className="flex flex-col gap-3 text-xs">
                    <div>
                      <div className="text-sm text-fg">{noFilePick}</div>
                      <p className="mt-1 text-muted">
                        No file in the label art folder matches this name. Edit label opens its
                        form, where Pick… chooses its file by hand.
                      </p>
                    </div>
                    <Pane title="Published">
                      <BigImage src={e?.imageUrl || null} alt="Published" />
                      {e?.imageUrl && (
                        <span className="font-mono text-[10px] text-muted break-all">{e.imageUrl}</span>
                      )}
                    </Pane>
                    <div>
                      <button
                        type="button"
                        onClick={() => pickLabel(noFilePick, e?.imageUrl ?? "", e?.siteUrl ?? "")}
                        className={cn(actionCls, "bg-surface text-muted hover:text-fg flex items-center gap-1")}
                        title="Close Review and open this label's form"
                      >
                        <Pencil size={12} />
                        Edit label
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : localPick ? (
              <LocalLabelInspector
                item={localPick}
                check={label}
                onEdit={() => {
                  const e = labels.find((l) => normaliseName(l.name) === normaliseName(localPick.name));
                  pickLabel(localPick.name, e?.imageUrl ?? localPick.publishedUrl ?? "", e?.siteUrl ?? "");
                }}
              />
            ) : (
              <p className="text-xs text-muted">Select a label to see its file large.</p>
            )
          ) : labelPick && label ? (
            <LabelInspector item={labelPick} check={label} labels={labels} onPick={pickLabel} />
          ) : (
            <p className="text-xs text-muted">Select a label image to see it large.</p>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
