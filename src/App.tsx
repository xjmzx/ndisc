import { useEffect, useState } from "react";
import { RotateCw, FolderOpen, FilePlus, Lock, LogOut } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import {
  ask,
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { SimplePool, nip19 } from "nostr-tools";
import { ReleaseList, type FilterContext } from "./components/ReleaseList";
import { ReleaseDetail } from "./components/ReleaseDetail";
import { AddReleaseForm } from "./components/AddReleaseForm";
import { LabelPanel, type LabelEntry } from "./components/LabelPanel";
import { LabelviewPanel } from "./components/LabelviewPanel";
import { UndoToast, type UndoToastState } from "./components/UndoToast";
import {
  bundledSeedLabels,
  clearStaleBundleUrls,
  mergeSeed,
} from "./lib/labelSeed";
import { LibraryPanel } from "./components/LibraryPanel";
import { NostrPanel, type ProfileMeta } from "./components/NostrPanel";
import {
  clearKeypair,
  getNpub,
  initDb,
  setDbPath as setDbPathCmd,
  type Release,
} from "./lib/tauri";

const KEYRING_BACKEND = "libsecret";

const LABELS_STORAGE_KEY = "ndisc.labels";

function loadLabels(): LabelEntry[] {
  try {
    const raw = localStorage.getItem(LABELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (e): e is LabelEntry =>
        e &&
        typeof e === "object" &&
        typeof e.name === "string" &&
        typeof e.imageUrl === "string",
    );
    return clearStaleBundleUrls(valid);
  } catch {
    return [];
  }
}

const THEME_STORAGE_KEY = "ndisc.theme";
type Theme = "fizx" | "upleb";

function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "upleb"
      ? "upleb"
      : "fizx";
  } catch {
    return "fizx";
  }
}

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
  const [npub, setNpub] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileMeta | null>(null);
  const [labels, setLabelsState] = useState<LabelEntry[]>(() => loadLabels());
  const [theme, setTheme] = useState<Theme>(loadTheme);

  // Apply + persist the colour theme: fizx.uk (default) or upleb.uk.
  useEffect(() => {
    document.documentElement.classList.toggle(
      "theme-upleb",
      theme === "upleb",
    );
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  function setLabels(next: LabelEntry[]) {
    setLabelsState(next);
    try {
      localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // First-run seed: if no labels yet, pre-populate from the nostr.build
  // hosted seed pool so the panel isn't empty. On returning runs, persist
  // any URL migrations clearStaleBundleUrls applied in loadLabels.
  useEffect(() => {
    if (labels.length === 0) {
      const seeded = mergeSeed([], bundledSeedLabels());
      if (seeded.length > 0) setLabels(seeded);
    } else {
      setLabels(labels);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reseedFromBundle() {
    setLabels(mergeSeed(labels, bundledSeedLabels()));
  }

  // Lifted Label-form state so Labelview can prefill it from a different panel.
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [labelFormName, setLabelFormName] = useState("");
  const [labelFormUrl, setLabelFormUrl] = useState("");

  function promptAddLabel(name: string, existingUrl: string) {
    setLabelFormName(name);
    setLabelFormUrl(existingUrl);
    setLabelFormOpen(true);
  }

  // Undo toast — generic, used by destructive actions like delete-release.
  const [toast, setToast] = useState<UndoToastState | null>(null);
  function showUndoToast(message: string, undo: () => void | Promise<void>) {
    setToast({ key: Date.now(), message, undo });
  }
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
    getNpub()
      .then((p) => setNpub(p ?? null))
      .catch(() => setNpub(null));
  }, []);

  useEffect(() => {
    if (!npub || relays.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const decoded = nip19.decode(npub);
        if (decoded.type !== "npub") return;
        const hex = decoded.data as string;
        const pool = new SimplePool();
        const event = await pool.get(relays, { kinds: [0], authors: [hex] });
        pool.close(relays);
        if (cancelled || !event) return;
        try {
          setProfile(JSON.parse(event.content) as ProfileMeta);
        } catch {
          /* malformed metadata, ignore */
        }
      } catch {
        /* best-effort fetch, ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [npub, relays]);

  function onIdentityChanged(next: string | null) {
    setNpub(next);
    if (!next) setProfile(null);
  }

  async function onForgetIdentity() {
    const ok = await ask(
      "Forget Nostr identity? The nsec will be deleted from the OS keychain.",
      { title: "Forget identity", kind: "warning" },
    );
    if (!ok) return;
    try {
      await clearKeypair();
      onIdentityChanged(null);
    } catch (e) {
      console.error("clearKeypair failed", e);
    }
  }

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
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === "fizx" ? "upleb" : "fizx"))}
            title={
              theme === "fizx"
                ? "Theme: fizx.uk — click to switch to upleb.uk"
                : "Theme: upleb.uk — click to switch to fizx.uk"
            }
            aria-label="Switch colour theme"
            className="text-2xl font-bold text-accent tracking-tight
                       leading-none shrink-0 cursor-pointer transition-opacity
                       hover:opacity-70"
          >
            n<span className="text-fg">disc</span>
          </button>
          {appVersion && (
            <span
              className="hidden md:inline-flex items-center px-2.5 py-2
                         rounded-md bg-surface text-mauve font-mono text-xs
                         shrink-0"
            >
              v{appVersion}
            </span>
          )}
        </div>

        <div className="hidden lg:flex flex-1 items-center justify-center min-w-0
                        gap-2 flex-wrap px-4">
          {npub && (
            <>
              <div
                className="inline-flex items-center gap-4 px-3.5 py-2
                           rounded-md bg-mauve/15 text-xs min-w-0"
              >
                <IdentityRow profile={profile} npub={npub} />
                <span
                  className="flex items-center gap-1.5 text-muted shrink-0"
                  title={`secret key stored in OS keychain (${KEYRING_BACKEND})`}
                >
                  <Lock size={12} />
                  <span>nsec stored in keychain</span>
                </span>
              </div>
              <DbIconButton title="Forget identity" onClick={onForgetIdentity}>
                <LogOut size={14} />
              </DbIconButton>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {dbError ? (
            <span className="text-alert font-mono text-xs break-all max-w-xs truncate">
              {dbError}
            </span>
          ) : dbPath ? (
            <>
              <div
                className="hidden sm:inline-flex items-center gap-2 px-2.5
                           py-2 rounded-md bg-mauve/15 text-xs text-muted
                           min-w-0"
              >
                <span className="shrink-0">db</span>
                <span
                  className="font-mono text-mauve truncate max-w-[24rem]"
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
              showUndoToast={showUndoToast}
            />
          ) : (
            <AddReleaseForm onAdded={reload} />
          )}
          <div className="grid grid-cols-[2fr_1fr_2fr] gap-2 items-start">
            <NostrPanel
              relays={relays}
              setRelays={setRelays}
              filterContext={filterContext}
              npub={npub}
              onIdentityChanged={onIdentityChanged}
            />
            <LabelviewPanel
              labels={labels}
              reloadKey={reloadKey}
              onPick={promptAddLabel}
            />
            <LabelPanel
              labels={labels}
              setLabels={setLabels}
              selected={selected}
              onReseed={reseedFromBundle}
              formOpen={labelFormOpen}
              setFormOpen={setLabelFormOpen}
              formName={labelFormName}
              setFormName={setLabelFormName}
              formUrl={labelFormUrl}
              setFormUrl={setLabelFormUrl}
            />
          </div>
        </div>
      </div>

      <footer className="mt-8 text-xs text-muted">
        <span>scaffold · stack: Tauri 2 + React + TypeScript + Tailwind + SQLite</span>
      </footer>

      <UndoToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function IdentityRow({
  profile,
  npub,
}: {
  profile: ProfileMeta | null;
  npub: string;
}) {
  const name = profile?.display_name || profile?.name;
  const nip05 = profile?.nip05;
  // Names that look like identifiers (e.g. "user@host") render as mono so
  // they sit visually consistent with the nip05 chip next to them.
  const nameCls = name && name.includes("@")
    ? "text-fg text-xs font-mono truncate"
    : "text-fg text-xs truncate";

  if (name && nip05) {
    return (
      <>
        <span className={nameCls}>{name}</span>
        <span className="text-mauve text-xs font-mono truncate">{nip05}</span>
      </>
    );
  }
  if (name) {
    return <span className={nameCls}>{name}</span>;
  }
  if (nip05) {
    return (
      <span className="text-mauve text-xs font-mono truncate">{nip05}</span>
    );
  }
  return (
    <span className="text-mauve text-xs font-mono">
      {npub.slice(0, 12)}…{npub.slice(-6)}
    </span>
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
