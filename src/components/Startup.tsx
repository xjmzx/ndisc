import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  checkDiscogsToken,
  getDiscogsTokenStatus,
  getLibraryRoot,
  getNpub,
  importDiscogsCsv,
  importAppleXml,
  importKeypair,
  initDb,
  reconcileLibrary,
  setDbPath,
  setDiscogsToken,
  setLastSeenVersion,
  setLibraryRoot,
  startupStatus,
  type StartupStatus,
} from "../lib/tauri";
import {
  PUBLIC_RELAY,
  anyRelayReachable,
  anyServerReachable,
  normaliseRelayUrl,
  normaliseServerUrl,
  relayChoice,
  saveBlossom,
  saveRelays,
  savedBlossom,
  savedRelays,
  serverReachable,
  setRelayChoice,
  takeForceSetup,
  testRelay,
} from "../lib/startupChecks";
import { cn } from "../lib/cn";

// The startup screen. Shown before App mounts, because App's first effects
// open (and so create) the database. It decides between:
//
// - the **Startup check** (a database with releases): six local checks; a
//   clean pass opens the app by itself, anything else waits on Fix/Continue;
// - **Setup** (no database, an empty one, or "Setup…" from the ⋮ menu).
//
// Relay and Blossom reachability is tested only in Setup, on the first launch
// after an upgrade, and from Fix — never on an ordinary launch.
// Design: docs/onboarding-design-2026-11-16.md.

const THEME_KEY = "ndisc.theme";
const DB_FILTERS = [{ name: "SQLite", extensions: ["db", "sqlite"] }];

function applyTheme() {
  let t = "mono";
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "upleb" || v === "fizx") t = v;
  } catch {
    /* default */
  }
  const root = document.documentElement.classList;
  root.toggle("theme-upleb", t === "upleb");
  root.toggle("theme-mono", t === "mono");
}

type Mode = "loading" | "check" | "setup";

export function Startup({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [version, setVersion] = useState("");
  const [forced, setForced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once only: StrictMode runs effects twice in dev, and the second run
    // would find the one-shot Setup flag already taken.
    if (started.current) return;
    started.current = true;
    applyTheme();
    const force = takeForceSetup();
    setForced(force);
    Promise.all([startupStatus(), getVersion().catch(() => "")])
      .then(([s, v]) => {
        setStatus(s);
        setVersion(v);
        // An empty database is "new" only until Setup has been finished or
        // closed once (both record lastSeenVersion); after that an empty
        // catalogue is a choice, and gets the Startup check.
        const isNew =
          !s.dbExists || (s.releases === 0 && !s.dbError && !s.lastSeenVersion);
        setMode(force || isNew ? "setup" : "check");
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Same frame as the app: the header's wordmark + version chip top left, the
  // stack line and database path in the footer, the card in between.
  return (
    <div className="min-h-screen flex flex-col pt-6 px-6 pb-2 max-w-[1500px] mx-auto bg-bg text-fg">
      <header className="mb-4 shrink-0 rounded-lg bg-panel shadow-md px-4 py-3 flex items-center gap-3">
        <span className="text-2xl font-bold tracking-tight leading-none">
          <span className="text-accent">n</span>
          <span className="text-mauve">disc</span>
        </span>
        {version && (
          <span
            className="inline-flex items-center px-2.5 py-2 rounded-md bg-surface text-mauve font-mono text-xs"
            title={`v${version}`}
          >
            v{version.split(/[-+]/)[0]}
          </span>
        )}
      </header>
      <main className="flex-1 flex items-start justify-center px-4 pt-8 pb-12">
        <div className="w-full max-w-lg rounded-lg bg-panel border border-surface/70 shadow-xl p-5">
          {error && <p className="text-xs text-alert">{error}</p>}
          {!error && mode === "loading" && (
            <p className="text-xs text-muted inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Starting…
            </p>
          )}
          {mode === "check" && status && (
            <StartupCheck
              status={status}
              version={version}
              onDone={onDone}
              onSetup={() => setMode("setup")}
            />
          )}
          {mode === "setup" && status && (
            <Setup
              status={status}
              version={version}
              forced={forced}
              onDone={onDone}
              onExisting={(s) => {
                setStatus(s);
                setMode("check");
              }}
            />
          )}
        </div>
      </main>
      <footer className="mt-4 shrink-0 flex flex-wrap items-center justify-between gap-x-8 gap-y-1 text-xs text-muted">
        <span className="truncate">stack: Tauri 2 · React · TypeScript · Tailwind · SQLite</span>
        {status && (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className="shrink-0">db</span>
            <span className="font-mono text-mauve truncate max-w-[40rem]" title={status.dbPath}>
              {status.dbPath}
            </span>
          </span>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Startup check

type RowState = "pending" | "ok" | "warn" | "fail";
type RowId = "db" | "library" | "key" | "relay" | "blossom" | "catalogue";

interface Row {
  id: RowId;
  label: string;
  state: RowState;
  detail: string;
}

const ROW_LABELS: Record<RowId, string> = {
  db: "Database opens",
  library: "Library folder",
  key: "Signing key",
  relay: "Publishing relay",
  blossom: "Blossom server",
  catalogue: "Catalogue loaded",
};

const ORDER: RowId[] = ["db", "library", "key", "relay", "blossom", "catalogue"];

// Pacing. The checks themselves finish in a few milliseconds, which reads as a
// flicker rather than a checklist. Each row gets a short beat, and a clean pass
// stays on screen briefly before the app opens: about 3 seconds in all, well
// inside the agreed budget (the slow part of a launch is the app loading a
// large catalogue afterwards, not this).
const ROW_MS = 300;
const HOLD_MS = 1200;
const pace = () => new Promise((r) => setTimeout(r, ROW_MS));

function StartupCheck({
  status: initialStatus,
  version,
  onDone,
  onSetup,
}: {
  status: StartupStatus;
  version: string;
  onDone: () => void;
  onSetup: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    ORDER.map((id) => ({ id, label: ROW_LABELS[id], state: "pending", detail: "" })),
  );
  const [running, setRunning] = useState(true);
  const [fixing, setFixing] = useState<RowId | null>(null);
  const firstRun = useRef(true);

  function set(id: RowId, state: RowState, detail: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state, detail } : r)));
  }

  async function finish() {
    if (version) await setLastSeenVersion(version).catch(() => {});
    onDone();
  }

  // `network`: test relay/Blossom reachability too (first launch after an
  // upgrade, or after a Fix).
  async function run(network: boolean) {
    setRunning(true);
    setRows((rs) => rs.map((r) => ({ ...r, state: "pending", detail: "" })));
    const s = await startupStatus().catch(() => initialStatus);
    const results: Record<RowId, RowState> = {} as Record<RowId, RowState>;
    const put = (id: RowId, st: RowState, d: string) => {
      results[id] = st;
      set(id, st, d);
    };

    // 1. Database
    let dbOk = false;
    if (!s.dbExists) {
      put("db", "fail", `No database at ${s.dbPath}`);
    } else if (s.dbError) {
      put("db", "fail", s.dbError);
    } else {
      try {
        await initDb();
        dbOk = true;
        put("db", "ok", s.dbPath);
      } catch (e) {
        put("db", "fail", String(e));
      }
    }

    await pace();

    // 2. Library folder
    if (s.libraryRoot && s.libraryRootExists) put("library", "ok", s.libraryRoot);
    else if (s.libraryRoot) put("library", "warn", `Not found: ${s.libraryRoot} (a drive not mounted?)`);
    else put("library", "warn", "Not set");

    await pace();

    // 3. Signing key
    try {
      const npub = await getNpub();
      if (npub) put("key", "ok", `${npub.slice(0, 12)}…${npub.slice(-6)}`);
      else put("key", "warn", "No key in the keyring. The catalogue works; publishing doesn't.");
    } catch (e) {
      put("key", "warn", `Keyring: ${String(e)}`);
    }

    await pace();

    // 4. Relay
    const relays = savedRelays();
    // "Later" at Setup leaves the list empty; App then tops it up to its
    // default relay, which only accepts approved keys. That top-up alone is
    // not a choice. Anything added since (Relays & servers) is.
    const onlyTopUp = relays.length === 1 && relays[0] === "wss://relay.nfunc.xyz";
    if ((relayChoice() === "later" && onlyTopUp) || relays.length === 0) {
      put("relay", "warn", "No relay chosen yet");
    } else if (network) {
      set("relay", "pending", "testing…");
      const up = await anyRelayReachable(relays);
      put("relay", up ? "ok" : "warn", up ? relays.join(", ") : `Unreachable: ${relays.join(", ")}`);
    } else {
      put("relay", "ok", relays.join(", "));
    }

    await pace();

    // 5. Blossom
    const servers = savedBlossom();
    if (servers.length === 0) {
      put("blossom", "warn", "None set. Releases publish without hosted covers.");
    } else if (network) {
      set("blossom", "pending", "checking…");
      const up = await anyServerReachable(servers);
      put("blossom", up ? "ok" : "warn", up ? servers.join(", ") : `Unreachable: ${servers.join(", ")}`);
    } else {
      put("blossom", "ok", servers.join(", "));
    }

    await pace();

    // 6. Catalogue
    if (dbOk) {
      const now = await startupStatus().catch(() => s);
      const n = now.releases ?? 0;
      const l = now.labels;
      put(
        "catalogue",
        "ok",
        `${n.toLocaleString()} release${n === 1 ? "" : "s"}` +
          (l == null ? "" : ` / ${l.toLocaleString()} label${l === 1 ? "" : "s"}`),
      );
    } else {
      put("catalogue", "fail", "The database didn't open");
    }

    await pace();
    setRunning(false);
    if (ORDER.every((id) => results[id] === "ok")) {
      setTimeout(finish, HOLD_MS);
    }
  }

  useEffect(() => {
    if (!firstRun.current) return;
    firstRun.current = false;
    const upgraded = !!version && initialStatus.lastSeenVersion !== version;
    run(upgraded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = rows.some((r) => r.state === "fail");
  const allOk = rows.every((r) => r.state === "ok");

  return (
    <div>
      <h1 className="text-sm font-medium mb-3">Starting ndisc</h1>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="flex items-start gap-2.5 rounded-md px-2 py-1.5">
              <StateIcon state={r.state} />
              <div className="min-w-0 flex-1">
                <div className="text-xs">{r.label}</div>
                {r.detail && (
                  <div className="text-[11px] text-muted truncate" title={r.detail}>
                    {r.detail}
                  </div>
                )}
              </div>
              {!running && (r.state === "warn" || r.state === "fail") && r.id !== "catalogue" && (
                <button
                  onClick={() => setFixing(fixing === r.id ? null : r.id)}
                  className="shrink-0 px-2 py-0.5 rounded-md text-[11px] bg-surface hover:bg-surfaceHover"
                >
                  Fix
                </button>
              )}
            </div>
            {fixing === r.id && (
              <div className="ml-7 mt-1 mb-2 rounded-md bg-surface/40 p-3">
                <FixPanel
                  id={r.id}
                  onFixed={() => {
                    setFixing(null);
                    run(true);
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      {!running && !allOk && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <button onClick={onSetup} className="text-[11px] text-muted hover:text-fg">
            Run Setup instead
          </button>
          <button
            onClick={finish}
            disabled={blocked}
            className="px-3 py-1.5 rounded-md text-xs bg-surface hover:bg-surfaceHover
                       disabled:opacity-50 disabled:cursor-not-allowed"
            title={blocked ? "The database has to open first" : undefined}
          >
            Continue anyway
          </button>
        </div>
      )}
    </div>
  );
}

function StateIcon({ state }: { state: RowState }) {
  const cls = "shrink-0 mt-0.5";
  if (state === "pending") return <Loader2 size={14} className={cn(cls, "animate-spin text-muted")} />;
  if (state === "ok") return <CheckCircle2 size={14} className={cn(cls, "text-ok")} />;
  if (state === "warn") return <AlertTriangle size={14} className={cn(cls, "text-warn")} />;
  return <XCircle size={14} className={cn(cls, "text-alert")} />;
}

function FixPanel({ id, onFixed }: { id: RowId; onFixed: () => void }) {
  if (id === "db") return <DatabaseFix onDone={onFixed} />;
  if (id === "library") return <LibraryStep onNext={onFixed} nextLabel="Done" />;
  if (id === "key") return <KeyStep onNext={onFixed} nextLabel="Done" />;
  if (id === "relay") return <RelayStep onNext={onFixed} nextLabel="Save" />;
  if (id === "blossom") return <BlossomStep onNext={onFixed} nextLabel="Save" />;
  return null;
}

function DatabaseFix({ onDone }: { onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">Open another database, or create a new one at the default place.</p>
      <div className="flex gap-2">
        <Btn
          onClick={async () => {
            const p = await openDialog({ multiple: false, filters: DB_FILTERS, title: "Open database" });
            if (typeof p !== "string") return;
            try {
              await setDbPath(p);
              onDone();
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          Open existing…
        </Btn>
        <Btn
          onClick={async () => {
            try {
              await initDb();
              onDone();
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          Create new
        </Btn>
      </div>
      {err && <p className="text-[11px] text-alert">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup

type StepId =
  | "database"
  | "library"
  | "catalogue"
  | "discogs"
  | "key"
  | "relay"
  | "blossom"
  | "ready";
const STEPS: { id: StepId; title: string }[] = [
  { id: "database", title: "Database" },
  { id: "library", title: "Library folder" },
  { id: "catalogue", title: "Fill the catalogue" },
  { id: "discogs", title: "Discogs token" },
  { id: "key", title: "Signing key" },
  { id: "relay", title: "Relay" },
  { id: "blossom", title: "Blossom server" },
  { id: "ready", title: "Ready" },
];

interface ImportPlan {
  scan: boolean;
  discogsCsv: string | null;
  appleXml: string | null;
}

function Setup({
  status,
  version,
  forced,
  onDone,
  onExisting,
}: {
  status: StartupStatus;
  version: string;
  forced: boolean;
  onDone: () => void;
  onExisting: (s: StartupStatus) => void;
}) {
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<ImportPlan>({
    scan: false,
    discogsCsv: null,
    appleXml: null,
  });
  const next = () => setStep((i) => Math.min(i + 1, STEPS.length - 1));
  const id = STEPS[step].id;

  // Setup can be closed once there is a database to open: from step 2 on (the
  // Database step creates or opens one), or from the start when one already
  // exists. Each step saves as it goes, so closing keeps the folder, key,
  // relay and server chosen so far; only the imports (run at Ready) are lost.
  // Closing records lastSeenVersion, so an empty catalogue doesn't bring
  // Setup back on every launch.
  const canClose = id !== "ready" && (step > 0 || status.dbExists);
  async function close() {
    // Closed before the relay step: no relay was chosen. Record that, or the
    // app's default top-up would read as configured at the next check.
    if (relayChoice() === null && savedRelays().length === 0) setRelayChoice("later");
    try {
      await initDb();
    } catch {
      /* the app shows its own database error */
    }
    if (version) await setLastSeenVersion(version).catch(() => {});
    onDone();
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-sm font-medium">{forced ? "Setup" : "Welcome to ndisc"}</h1>
        <span className="inline-flex items-center gap-3 text-[11px] text-muted">
          {step + 1} / {STEPS.length}
          {canClose && (
            <button
              onClick={close}
              className="text-muted hover:text-fg"
              title="Close Setup and open ndisc. What you've chosen so far is kept; the imports don't run."
              aria-label="Close Setup"
            >
              <X size={16} />
            </button>
          )}
        </span>
      </div>
      <ol className="flex gap-1 mb-4" aria-hidden>
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-accent" : "bg-surface")}
          />
        ))}
      </ol>
      {id === "key" && (
        <p className="text-[11px] text-muted mb-3 border-l-2 border-surface pl-2">
          <span className="text-fg">Publishing (optional).</span> The next three steps are only
          needed to publish your releases to Nostr. Skip them for a catalogue on this computer.
        </p>
      )}
      <h2 className="text-xs font-medium mb-2">{STEPS[step].title}</h2>

      {id === "database" && (
        <DatabaseStep status={status} forced={forced} onNext={next} onExisting={onExisting} />
      )}
      {id === "library" && <LibraryStep onNext={next} />}
      {id === "catalogue" && <CatalogueStep plan={plan} setPlan={setPlan} onNext={next} />}
      {id === "discogs" && <DiscogsStep usingCsv={!!plan.discogsCsv} onNext={next} />}
      {id === "key" && <KeyStep onNext={next} />}
      {id === "relay" && <RelayStep onNext={next} />}
      {id === "blossom" && <BlossomStep onNext={next} />}
      {id === "ready" && <ReadyStep plan={plan} version={version} onDone={onDone} />}

      {step > 0 && id !== "ready" && (
        <button
          onClick={() => setStep((i) => i - 1)}
          className="mt-4 text-[11px] text-muted hover:text-fg"
        >
          ← Back
        </button>
      )}
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-3 py-1.5 rounded-md text-xs disabled:opacity-50 disabled:cursor-not-allowed",
        primary ? "bg-accent text-bg font-medium hover:opacity-90" : "bg-surface hover:bg-surfaceHover",
      )}
    >
      {children}
    </button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-muted leading-snug">{children}</p>;
}

function DatabaseStep({
  status,
  forced,
  onNext,
  onExisting,
}: {
  status: StartupStatus;
  forced: boolean;
  onNext: () => void;
  onExisting: (s: StartupStatus) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const hasReleases = (status.releases ?? 0) > 0;

  async function openExisting() {
    const p = await openDialog({ multiple: false, filters: DB_FILTERS, title: "Open database" });
    if (typeof p !== "string") return;
    try {
      await setDbPath(p);
      const s = await startupStatus();
      // A database with releases in it is an existing catalogue: check it
      // rather than set it up (unless Setup was asked for from the menu).
      if ((s.releases ?? 0) > 0 && !forced) onExisting(s);
      else onNext();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function useDefault() {
    try {
      await initDb();
      onNext();
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="space-y-3">
      {!status.dbExists ? (
        <Note>
          ndisc keeps your catalogue in one database file. Create a new one, or open one you already
          have, for example a copy from another computer.
        </Note>
      ) : hasReleases ? (
        <Note>
          Using <span className="font-mono text-fg">{status.dbPath}</span> (
          {(status.releases ?? 0).toLocaleString()} releases).
        </Note>
      ) : (
        <Note>
          There is an empty database at <span className="font-mono text-fg">{status.dbPath}</span>.
        </Note>
      )}
      <div className="flex gap-2">
        <Btn primary onClick={useDefault}>
          {!status.dbExists ? "Create new" : hasReleases ? "Keep it" : "Use it"}
        </Btn>
        <Btn onClick={openExisting}>{hasReleases ? "Open another…" : "Open existing…"}</Btn>
      </div>
      {!status.dbExists && (
        <Note>
          New database: <span className="font-mono">{status.dbPath}</span>
        </Note>
      )}
      {err && <p className="text-[11px] text-alert">{err}</p>}
    </div>
  );
}

function LibraryStep({ onNext, nextLabel = "Next" }: { onNext: () => void; nextLabel?: string }) {
  const [root, setRoot] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getLibraryRoot()
      .then((r) => setRoot(r ?? null))
      .catch(() => setRoot(null));
  }, []);

  async function choose() {
    const p = await openDialog({
      directory: true,
      multiple: false,
      title: "Your music library folder",
      defaultPath: root ?? undefined,
    });
    if (typeof p !== "string") return;
    try {
      await setLibraryRoot(p);
      setRoot(p);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="space-y-3">
      <Note>
        The folder that holds your music, one folder per release. ndisc reads tags and covers from
        it and never moves anything. Skip this for a catalogue of physical releases only.
      </Note>
      <div className="flex items-center gap-2 rounded-md bg-surface/40 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={root ?? undefined}>
          {root ?? "not set"}
        </span>
        <Btn onClick={choose}>Choose folder…</Btn>
      </div>
      {err && <p className="text-[11px] text-alert">{err}</p>}
      <div className="flex gap-2">
        <Btn primary onClick={onNext}>
          {root ? nextLabel : nextLabel === "Next" ? "Skip" : nextLabel}
        </Btn>
      </div>
    </div>
  );
}

function CatalogueStep({
  plan,
  setPlan,
  onNext,
}: {
  plan: ImportPlan;
  setPlan: (p: ImportPlan) => void;
  onNext: () => void;
}) {
  const [hasRoot, setHasRoot] = useState(false);
  useEffect(() => {
    getLibraryRoot()
      .then((r) => {
        setHasRoot(!!r);
        if (r && !plan.scan && !plan.discogsCsv && !plan.appleXml)
          setPlan({ ...plan, scan: true });
      })
      .catch(() => setHasRoot(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickCsv() {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "Discogs collection CSV", extensions: ["csv"] }],
      title: "Discogs collection export",
    });
    if (typeof p === "string") setPlan({ ...plan, discogsCsv: p });
  }

  async function pickXml() {
    const p = await openDialog({
      multiple: false,
      filters: [{ name: "Apple Music library XML", extensions: ["xml"] }],
      title: "Apple Music library export",
    });
    if (typeof p === "string") setPlan({ ...plan, appleXml: p });
  }

  const nothing = !plan.scan && !plan.discogsCsv && !plan.appleXml;

  return (
    <div className="space-y-2">
      <Note>Pick any. They run when you finish Setup.</Note>
      <Option
        on={plan.scan}
        disabled={!hasRoot}
        onToggle={() => setPlan({ ...plan, scan: !plan.scan })}
        title="Scan the library folder"
        detail={
          hasRoot
            ? "Imports each folder of audio as a release, with its tags and cover."
            : "Choose a library folder first."
        }
      />
      <Option
        on={!!plan.discogsCsv}
        onToggle={() => (plan.discogsCsv ? setPlan({ ...plan, discogsCsv: null }) : pickCsv())}
        title="Discogs collection CSV"
        detail={
          plan.discogsCsv ??
          "On discogs.com: Collection → Export. Imports each release in the collection."
        }
      />
      <Option
        on={!!plan.appleXml}
        onToggle={() => (plan.appleXml ? setPlan({ ...plan, appleXml: null }) : pickXml())}
        title="Apple Music library XML"
        detail={
          plan.appleXml ??
          "In the Music app (macOS or Windows): File → Library → Export Library. Imports each album you bought, skipping any already in the catalogue."
        }
      />
      <div className="pt-1">
        <Btn primary onClick={onNext}>
          {nothing ? "Start empty" : "Next"}
        </Btn>
      </div>
    </div>
  );
}

function Option({
  on,
  disabled,
  onToggle,
  title,
  detail,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "w-full flex items-start gap-2.5 rounded-md px-3 py-2 text-left",
        on ? "bg-surface" : "bg-surface/40 hover:bg-surface/70",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <span className="shrink-0 mt-0.5">
        {on ? <Check size={14} className="text-accent" /> : <Circle size={14} className="text-muted" />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs">{title}</span>
        <span className="block text-[11px] text-muted truncate">{detail}</span>
      </span>
    </button>
  );
}

// Optional. The token is what Enrich uses to fill in label, catalogue number,
// format and track counts from Discogs; until now only the Enrich panel asked
// for it. A pasted token is checked against Discogs (it answers with the
// account's username) and saved only if that passes.
function DiscogsStep({
  usingCsv,
  onNext,
  nextLabel = "Next",
}: {
  usingCsv: boolean;
  onNext: () => void;
  nextLabel?: string;
}) {
  const [stored, setStored] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDiscogsTokenStatus()
      .then(setStored)
      .catch(() => setStored(false));
  }, []);

  // With `t`, check the pasted token and save it if Discogs accepts it;
  // without, check the one already in the keyring.
  async function check(t?: string) {
    setBusy(true);
    setErr(null);
    setAccount(null);
    try {
      const user = await checkDiscogsToken(t);
      if (t) {
        await setDiscogsToken(t);
        setStored(true);
        setSaved(true);
        setToken("");
      }
      setAccount(user);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Note>
        {usingCsv
          ? "Your Discogs CSV links each release to Discogs. A personal access token lets ndisc fill in their label, catalogue number, format and track counts (Enrich)."
          : "A Discogs personal access token lets ndisc fill in label, catalogue number, format and track counts from Discogs for releases linked to it (Enrich)."}{" "}
        Get one on discogs.com under Settings → Developers. It is kept in this computer's keyring,
        never in a file.
      </Note>
      {stored && (
        <div className="flex items-center gap-2 rounded-md bg-surface/40 px-3 py-2 text-[11px]">
          <span className="flex-1 text-muted">
            {account ? (
              <>
                {saved ? "Saved. " : ""}Discogs account{" "}
                <span className="font-mono text-fg">{account}</span>
              </>
            ) : (
              "A token is in the keyring."
            )}
          </span>
          {!account && (
            <Btn onClick={() => check()} disabled={busy}>
              {busy && !token ? "Checking…" : "Check"}
            </Btn>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={stored ? "Paste a token to replace it" : "Paste your token"}
          className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-xs font-mono outline-none
                     focus:ring-1 focus:ring-accent"
          autoComplete="off"
          spellCheck={false}
        />
        <Btn onClick={() => check(token.trim())} disabled={!token.trim() || busy}>
          {busy && token ? "Checking…" : "Check and save"}
        </Btn>
      </div>
      {err && <p className="text-[11px] text-alert">{err}</p>}
      {!stored && (
        <Note>Without a token, the catalogue works as usual; you can add one later from Enrich.</Note>
      )}
      <Btn primary onClick={onNext}>
        {stored ? nextLabel : nextLabel === "Next" ? "Not now" : nextLabel}
      </Btn>
    </div>
  );
}

function KeyStep({ onNext, nextLabel = "Next" }: { onNext: () => void; nextLabel?: string }) {
  const [current, setCurrent] = useState<string | null>(null);
  const [nsec, setNsec] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    getNpub()
      .then((n) => setCurrent(n ?? null))
      .catch(() => setCurrent(null));
  }, []);

  async function save() {
    setErr(null);
    try {
      const npub = await importKeypair(nsec.trim());
      setSaved(npub);
      setNsec("");
    } catch (e) {
      setErr(String(e));
    }
  }

  const npub = saved ?? current;

  return (
    <div className="space-y-3">
      <Note>
        Releases are signed with your Nostr key. Paste its private part (nsec). It is kept in this
        computer's keyring, never in a file. Use a separate key for each discography or pseudonym,
        or their release addresses collide.
      </Note>
      {npub && (
        <div className="rounded-md bg-surface/40 px-3 py-2 text-[11px]">
          <span className="text-muted">{saved ? "Saved. Public key " : "Key in the keyring: "}</span>
          <span className="font-mono break-all">{npub}</span>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          value={nsec}
          onChange={(e) => setNsec(e.target.value)}
          placeholder={npub ? "nsec1… (replace the key)" : "nsec1…"}
          className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-xs font-mono outline-none
                     focus:ring-1 focus:ring-accent"
          autoComplete="off"
          spellCheck={false}
        />
        <Btn onClick={save} disabled={!nsec.trim().startsWith("nsec1")}>
          Save key
        </Btn>
      </div>
      {err && <p className="text-[11px] text-alert">{err}</p>}
      <Btn primary onClick={onNext}>
        {npub ? nextLabel : nextLabel === "Next" ? "Skip" : nextLabel}
      </Btn>
    </div>
  );
}

type RelayOpt = "kept" | "own" | "public" | "later";

function RelayStep({ onNext, nextLabel = "Next" }: { onNext: () => void; nextLabel?: string }) {
  const existing = savedRelays();
  const hadChoice = relayChoice() !== "later" && existing.length > 0;
  const [opt, setOpt] = useState<RelayOpt>(hadChoice ? "kept" : "own");
  const [url, setUrl] = useState("");
  const [test, setTest] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    const u = normaliseRelayUrl(url);
    if (!u) {
      setTest("That isn't a relay address (wss://…).");
      return;
    }
    setTesting(true);
    setTest(null);
    const r = await testRelay(u);
    setTesting(false);
    setTest(
      !r.reachable
        ? `Couldn't connect to ${u}.`
        : r.restricted ?? `Connected to ${u}.`,
    );
  }

  function save() {
    if (opt === "own") {
      const u = normaliseRelayUrl(url);
      if (!u) {
        setTest("That isn't a relay address (wss://…).");
        return;
      }
      saveRelays([u]);
      setRelayChoice("own");
    } else if (opt === "public") {
      saveRelays([PUBLIC_RELAY]);
      setRelayChoice("public");
    } else if (opt === "later") {
      setRelayChoice("later");
    } else {
      setRelayChoice("kept");
    }
    onNext();
  }

  return (
    <div className="space-y-2">
      <Note>A relay is the server your releases are published to.</Note>
      {hadChoice && (
        <Choice on={opt === "kept"} onPick={() => setOpt("kept")} title="Keep my relays">
          {existing.join(", ")}
        </Choice>
      )}
      <Choice on={opt === "own"} onPick={() => setOpt("own")} title="I have a relay">
        {opt === "own" && (
          <div className="mt-2 space-y-1.5">
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="wss://relay.example.com"
                className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-xs font-mono outline-none
                           focus:ring-1 focus:ring-accent"
                spellCheck={false}
              />
              <Btn onClick={runTest} disabled={!url.trim() || testing}>
                {testing ? "Testing…" : "Test"}
              </Btn>
            </div>
            {test && <p className="text-[11px] text-muted">{test}</p>}
          </div>
        )}
      </Choice>
      <Choice on={opt === "public"} onPick={() => setOpt("public")} title="Use nos.lol">
        A public relay, fine for trying ndisc out. It doesn't keep old events, so it isn't a home
        for a whole catalogue.
      </Choice>
      <Choice on={opt === "later"} onPick={() => setOpt("later")} title="Later">
        You can set up your own relay on a VPS to host a web discography.
      </Choice>
      <div className="pt-1">
        <Btn primary onClick={save} disabled={opt === "own" && !url.trim()}>
          {nextLabel}
        </Btn>
      </div>
    </div>
  );
}

function Choice({
  on,
  onPick,
  title,
  children,
}: {
  on: boolean;
  onPick: () => void;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      onClick={onPick}
      className={cn(
        "rounded-md px-3 py-2 cursor-pointer",
        on ? "bg-surface" : "bg-surface/40 hover:bg-surface/70",
      )}
    >
      <div className="flex items-center gap-2.5">
        {on ? <Check size={14} className="text-accent shrink-0" /> : <Circle size={14} className="text-muted shrink-0" />}
        <span className="text-xs">{title}</span>
      </div>
      {children && <div className="ml-6 text-[11px] text-muted leading-snug">{children}</div>}
    </div>
  );
}

function BlossomStep({ onNext, nextLabel = "Next" }: { onNext: () => void; nextLabel?: string }) {
  const existing = savedBlossom();
  const [opt, setOpt] = useState<"kept" | "own" | "none">(existing.length ? "kept" : "own");
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function runCheck() {
    const u = normaliseServerUrl(url);
    if (!u) {
      setCheck("That isn't a server address (https://…).");
      return;
    }
    setChecking(true);
    setCheck(null);
    const ok = await serverReachable(u);
    setChecking(false);
    setCheck(ok ? `Reached ${u}.` : `Couldn't reach ${u}.`);
  }

  function save() {
    if (opt === "own") {
      const u = normaliseServerUrl(url);
      if (!u) {
        setCheck("That isn't a server address (https://…).");
        return;
      }
      saveBlossom([u]);
    }
    onNext();
  }

  return (
    <div className="space-y-2">
      <Note>
        A Blossom server hosts your cover images. Without one, releases still publish, but there is
        nowhere to host their covers.
      </Note>
      {existing.length > 0 && (
        <Choice on={opt === "kept"} onPick={() => setOpt("kept")} title="Keep my servers">
          {existing.join(", ")}
        </Choice>
      )}
      <Choice on={opt === "own"} onPick={() => setOpt("own")} title="I have a server">
        {opt === "own" && (
          <div className="mt-2 space-y-1.5">
            <div className="flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://blossom.example.com"
                className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-xs font-mono outline-none
                           focus:ring-1 focus:ring-accent"
                spellCheck={false}
              />
              <Btn onClick={runCheck} disabled={!url.trim() || checking}>
                {checking ? "Checking…" : "Check"}
              </Btn>
            </div>
            {check && <p className="text-[11px] text-muted">{check}</p>}
          </div>
        )}
      </Choice>
      <Choice on={opt === "none"} onPick={() => setOpt("none")} title="Not now">
        You can run your own Blossom server on a VPS.
      </Choice>
      <div className="pt-1">
        <Btn primary onClick={save} disabled={opt === "own" && !url.trim()}>
          {nextLabel}
        </Btn>
      </div>
    </div>
  );
}

function ReadyStep({
  plan,
  version,
  onDone,
}: {
  plan: ImportPlan;
  version: string;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const add = (l: string) => setLines((ls) => [...ls, l]);
      try {
        await initDb();
        add("Database ready.");
      } catch (e) {
        add(`Database: ${String(e)}`);
      }
      if (plan.discogsCsv) {
        add("Importing the Discogs collection…");
        try {
          const r = await importDiscogsCsv(plan.discogsCsv);
          add(`Discogs: ${r.imported} imported, ${r.skipped} skipped.`);
        } catch (e) {
          add(`Discogs: ${String(e)}`);
        }
      }
      if (plan.scan) {
        add("Scanning the library folder. A large library takes a while…");
        try {
          const r = await reconcileLibrary();
          add(`Library: ${r.imported} imported.`);
        } catch (e) {
          add(`Library: ${String(e)}`);
        }
      }
      // After the folder scan, so albums the scan found are skipped here
      // rather than imported twice.
      if (plan.appleXml) {
        add("Importing the Apple Music library…");
        try {
          const r = await importAppleXml(plan.appleXml);
          add(`Apple Music: ${r.imported} imported, ${r.skipped} already in the catalogue.`);
        } catch (e) {
          add(`Apple Music: ${String(e)}`);
        }
      }
      if (version) await setLastSeenVersion(version).catch(() => {});
      setBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-[11px]">
        {lines.map((l, i) => (
          <li key={i} className="text-muted">
            {l}
          </li>
        ))}
      </ul>
      {busy ? (
        <p className="text-xs text-muted inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Setting up…
        </p>
      ) : (
        <>
          <Note>
            Setup is done. You can run it again from the ⋮ menu on Home.
          </Note>
          <Btn primary onClick={onDone}>
            Open ndisc
          </Btn>
        </>
      )}
    </div>
  );
}
