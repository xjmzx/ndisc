import { useEffect, useState } from "react";
import { RotateCw, FolderOpen, FilePlus } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { ReleaseList, type FilterContext } from "./components/ReleaseList";
import { ReleaseDetail } from "./components/ReleaseDetail";
import { AddReleaseForm } from "./components/AddReleaseForm";
import { LibraryPanel } from "./components/LibraryPanel";
import { NostrPanel } from "./components/NostrPanel";
import {
  initDb,
  setDbPath as setDbPathCmd,
  type Release,
} from "./lib/tauri";

const DB_FILTERS = [{ name: "SQLite", extensions: ["db", "sqlite"] }];

const DEFAULT_RELAYS = [
  "wss://relay.fizx.uk",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

const RELAYS_STORAGE_KEY = "ndisc.relays";
const LEGACY_RELAYS_STORAGE_KEY = "disco-vault.relays";

// One-shot relay migration: damus rate-limits batch publish. Swap it for the
// self-hosted fizx.uk relay if the user has damus stored and hasn't already
// added fizx themselves. Idempotent: after the swap neither condition matches.
function migrateDamusToFizx(relays: string[]): string[] {
  const damus = "wss://relay.damus.io";
  const fizx = "wss://relay.fizx.uk";
  if (!relays.includes(damus) || relays.includes(fizx)) return relays;
  return relays.map((r) => (r === damus ? fizx : r));
}

export default function App() {
  const [selected, setSelected] = useState<Release | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [relays, setRelays] = useState<string[]>(() => {
    // Read current key first, fall back to the legacy key, then to defaults.
    for (const key of [RELAYS_STORAGE_KEY, LEGACY_RELAYS_STORAGE_KEY]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every((s) => typeof s === "string")
        ) {
          // Migrate the legacy key to the new one and drop it.
          if (key === LEGACY_RELAYS_STORAGE_KEY) {
            try {
              localStorage.setItem(RELAYS_STORAGE_KEY, raw);
              localStorage.removeItem(LEGACY_RELAYS_STORAGE_KEY);
            } catch {
              /* ignore */
            }
          }
          return migrateDamusToFizx(parsed);
        }
      } catch {
        /* try next key */
      }
    }
    return DEFAULT_RELAYS;
  });

  const [filterContext, setFilterContext] = useState<FilterContext>({
    query: "",
    medium: null,
    needsCoverOnly: false,
    publishedFilter: null,
    labelFilter: null,
    count: 0,
  });

  useEffect(() => {
    initDb()
      .then(setDbPath)
      .catch((e) => setDbError(String(e)));
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(RELAYS_STORAGE_KEY, JSON.stringify(relays));
    } catch {
      /* ignore */
    }
  }, [relays]);

  function reload() {
    setReloadKey((k) => k + 1);
    setSelected(null);
  }

  function handleReleaseChanged(updated: Release) {
    setSelected(updated);
    setReloadKey((k) => k + 1);
  }

  async function switchDbTo(newPath: string) {
    setDbError(null);
    try {
      const updated = await setDbPathCmd(newPath);
      setDbPath(updated);
      reload();
    } catch (e) {
      setDbError(String(e));
    }
  }

  async function onOpenDb() {
    const picked = await openDialog({
      multiple: false,
      filters: DB_FILTERS,
      title: "Open database",
    });
    if (typeof picked === "string") await switchDbTo(picked);
  }

  async function onNewDb() {
    const picked = await saveDialog({
      filters: DB_FILTERS,
      title: "Create new database",
      defaultPath: "discography.db",
    });
    if (typeof picked === "string") await switchDbTo(picked);
  }

  return (
    <div className="min-h-screen p-6 max-w-[1500px] mx-auto">
      <header className="mb-4 px-4 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-2xl font-bold text-accent tracking-tight shrink-0">
            n<span className="text-fg">disc</span>
          </h1>
          {appVersion && (
            <span
              className="hidden md:inline-flex items-center px-1.5 py-0.5
                         rounded-md bg-surface text-mauve font-mono text-xs
                         shrink-0"
            >
              v{appVersion}
            </span>
          )}
          <p className="hidden md:block text-sm text-muted truncate">
            physical | digital discography
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {dbError ? (
            <span className="text-alert font-mono text-xs break-all max-w-xs truncate">
              {dbError}
            </span>
          ) : dbPath ? (
            <>
              <div
                className="hidden sm:flex items-center gap-2 text-[10px]
                           uppercase tracking-wide text-muted min-w-0"
              >
                <span className="shrink-0">db</span>
                <span
                  className="font-mono normal-case text-xs text-fg/70 truncate
                             max-w-[24rem]"
                  title={dbPath}
                >
                  {dbPath}
                </span>
              </div>
              <DbIconButton title="Refresh" onClick={reload}>
                <RotateCw size={14} />
              </DbIconButton>
              <DbIconButton
                title="Open existing database…"
                onClick={onOpenDb}
              >
                <FolderOpen size={14} />
              </DbIconButton>
              <DbIconButton title="Create new database…" onClick={onNewDb}>
                <FilePlus size={14} />
              </DbIconButton>
            </>
          ) : (
            <span className="text-xs text-muted">initialising…</span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
        <div className="grid grid-cols-1 gap-2 content-start">
          <LibraryPanel reloadKey={reloadKey} onImported={reload} />
          <ReleaseList
            reloadKey={reloadKey}
            selected={selected}
            onSelect={setSelected}
            onFilterChange={setFilterContext}
            relays={relays}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 content-start">
          {selected ? (
            <ReleaseDetail
              release={selected}
              relays={relays}
              onDeleted={reload}
              onChanged={handleReleaseChanged}
            />
          ) : (
            <AddReleaseForm onAdded={reload} />
          )}
          <NostrPanel
            relays={relays}
            setRelays={setRelays}
            filterContext={filterContext}
          />
        </div>
      </div>

      <footer className="mt-8 text-xs text-muted">
        <span>scaffold · stack: Tauri 2 + React + TypeScript + Tailwind + SQLite</span>
      </footer>
    </div>
  );
}

function DbIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-2 rounded-md bg-mauve/15 text-mauve
                 hover:bg-mauve hover:text-bg transition-colors"
    >
      {children}
    </button>
  );
}
