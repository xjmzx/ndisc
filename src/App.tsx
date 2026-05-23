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
import { clearStaleBundleUrls } from "./lib/labelSeed";
import {
  useLibrary,
  LibraryStats,
  LibraryToolbar,
  LibraryFlowPanel,
} from "./components/LibraryPanel";
import { ToolbarIconButton } from "./components/ToolbarIconButton";
import { NostrPanel, type ProfileMeta } from "./components/NostrPanel";
import { ReactionsProvider } from "./hooks/useReactions";
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
        typeof e.imageUrl === "string" &&
        (e.siteUrl === undefined || typeof e.siteUrl === "string"),
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

  // On load, persist any one-shot URL migration clearStaleBundleUrls applied
  // in loadLabels. No first-run seeding: a fresh install starts with no
  // labels and the Label panel shows its branded carousel cards until the
  // user adds their own.
  useEffect(() => {
    if (labels.length > 0) setLabels(labels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wipe every stored label after a confirm. The branded carousel cards
  // aren't stored labels, so the panel still has something to show.
  async function clearAllLabels() {
    const n = labels.length;
    if (n === 0) return;
    const yes = await ask(
      `Remove all ${n} label${n === 1 ? "" : "s"}? This can't be undone.`,
      {
        title: "Clear labels",
        kind: "warning",
        okLabel: "Remove all",
        cancelLabel: "Cancel",
      },
    );
    if (yes) setLabels([]);
  }

  // Lifted Label-form state so Labelview can prefill it from a different panel.
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [labelFormName, setLabelFormName] = useState("");
  const [labelFormUrl, setLabelFormUrl] = useState("");
  const [labelFormSite, setLabelFormSite] = useState("");

  function promptAddLabel(
    name: string,
    existingUrl: string,
    existingSite: string,
  ) {
    setLabelFormName(name);
    setLabelFormUrl(existingUrl);
    setLabelFormSite(existingSite);
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

  // Library stats + import/export controller. Its toolbar + stat chips live
  // in the header; the import flow renders transiently in the left column.
  const lib = useLibrary(reloadKey, reload);

  function handleReleaseChanged(updated: Release) {
    setSelected(updated);
    setReloadKey((k) => k + 1);
  }

  // Selecting a release ends any label-editing session, so the LABEL panel
  // follows the release instead of staying on the picked label.
  function selectRelease(release: Release) {
    setSelected(release);
    setLabelFormOpen(false);
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
    <ReactionsProvider npub={npub}>
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

        {/* Library stats — centred between the title and the toolbar. */}
        <div className="hidden lg:flex flex-1 items-center justify-center
                        min-w-0 px-4">
          <LibraryStats stats={lib.stats} />
        </div>

        {/* Toolbar: library | db | nostr — three divider-separated groups. */}
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {/* library group — import local / discogs, export markdown */}
          <LibraryToolbar lib={lib} />

          {/* db group — auburn, set apart from the mauve library/nostr groups */}
          <span className="w-px h-6 bg-surface shrink-0" aria-hidden="true" />
          {dbError ? (
            <span className="text-alert font-mono text-xs break-all max-w-xs truncate">
              {dbError}
            </span>
          ) : dbPath ? (
            <div className="inline-flex items-center gap-1">
              <ToolbarIconButton tone="auburn" title="Refresh" onClick={reload}>
                <RotateCw size={14} />
              </ToolbarIconButton>
              <ToolbarIconButton
                tone="auburn"
                title="Open existing database…"
                onClick={onOpenDb}
              >
                <FolderOpen size={14} />
              </ToolbarIconButton>
              <ToolbarIconButton
                tone="auburn"
                title="Create new database…"
                onClick={onNewDb}
              >
                <FilePlus size={14} />
              </ToolbarIconButton>
            </div>
          ) : (
            <span className="text-xs text-muted">initialising…</span>
          )}

          {/* nostr group — NIP-05 chip + forget identity, side by side */}
          {npub && (
            <>
              <span
                className="w-px h-6 bg-surface shrink-0"
                aria-hidden="true"
              />
              <div className="inline-flex items-center gap-2">
                {profile?.nip05 && (
                  <span
                    className="hidden sm:inline-flex items-center px-2.5 py-2
                               rounded-md bg-mauve/15 text-mauve font-mono
                               text-xs max-w-[16rem] truncate"
                    title={`NIP-05: ${profile.nip05}`}
                  >
                    {profile.nip05}
                  </span>
                )}
                <ToolbarIconButton
                  title="Forget identity"
                  onClick={onForgetIdentity}
                >
                  <LogOut size={14} />
                </ToolbarIconButton>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
        <div className="grid grid-cols-1 gap-2 content-start">
          {lib.active && <LibraryFlowPanel lib={lib} />}
          <ReleaseList
            reloadKey={reloadKey}
            selected={selected}
            onSelect={selectRelease}
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
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,5fr)] gap-2 items-start">
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
              onClearAll={clearAllLabels}
              formOpen={labelFormOpen}
              setFormOpen={setLabelFormOpen}
              formName={labelFormName}
              setFormName={setLabelFormName}
              formUrl={labelFormUrl}
              setFormUrl={setLabelFormUrl}
              formSite={labelFormSite}
              setFormSite={setLabelFormSite}
            />
          </div>
        </div>
      </div>

      {/* Three columns: stack info left, identity centred, db path right —
          justify-between buffers each from the next. */}
      <footer className="mt-8 flex flex-wrap items-center justify-between
                          gap-x-8 gap-y-1 text-xs text-muted">
        <span>scaffold · stack: Tauri 2 + React + TypeScript + Tailwind + SQLite</span>
        {npub && (
          <span className="inline-flex items-center gap-2 min-w-0">
            {(profile?.display_name || profile?.name) && (
              <span className="text-fg/70 truncate">
                {profile?.display_name || profile?.name}
              </span>
            )}
            <span className="font-mono text-mauve" title={npub}>
              {npub.slice(0, 12)}…{npub.slice(-6)}
            </span>
            <span
              className="inline-flex items-center gap-1"
              title={`secret key stored in OS keychain (${KEYRING_BACKEND})`}
            >
              <Lock size={11} />
              <span>nsec stored in keychain</span>
            </span>
          </span>
        )}
        {dbPath && (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className="shrink-0">db</span>
            <span
              className="font-mono text-mauve truncate max-w-[40rem]"
              title={dbPath}
            >
              {dbPath}
            </span>
          </span>
        )}
      </footer>

      <UndoToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
    </ReactionsProvider>
  );
}

