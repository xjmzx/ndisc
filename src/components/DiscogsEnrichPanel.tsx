import { useCallback, useState } from "react";
import { Disc3, KeyRound, Sparkles, X } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Section } from "./Section";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { DB_BUTTON_CLS, SUBTLE_BUTTON_CLS } from "../lib/buttonStyles";
import {
  clearDiscogsToken,
  enrichDiscogsLibrary,
  getDiscogsTokenStatus,
  setDiscogsToken,
  type EnrichProgress,
  type EnrichSummary,
} from "../lib/tauri";

type Phase = "idle" | "running" | "done";

// Fills track/disc counts for Discogs-imported (physical) releases, which the
// CSV export omits, by fetching each release from the Discogs API. Self-
// contained: its own keychain-backed token, batch run, and progress — mirrors
// the Library import flow but stands alone (a maintenance pass, not an import).
export interface EnrichController {
  active: boolean;
  open: () => void;
  close: () => void;
  tokenSet: boolean | null;
  phase: Phase;
  progress: EnrichProgress | null;
  summary: EnrichSummary | null;
  error: string | null;
  saveToken: (token: string) => Promise<void>;
  forgetToken: () => Promise<void>;
  run: (force: boolean) => Promise<void>;
}

export function useDiscogsEnrich(onDone: () => void): EnrichController {
  const [active, setActive] = useState(false);
  const [tokenSet, setTokenSet] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<EnrichProgress | null>(null);
  const [summary, setSummary] = useState<EnrichSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshToken = useCallback(() => {
    getDiscogsTokenStatus()
      .then(setTokenSet)
      .catch(() => setTokenSet(false));
  }, []);

  const open = useCallback(() => {
    setActive(true);
    setError(null);
    refreshToken();
  }, [refreshToken]);

  const close = useCallback(() => {
    if (phase === "running") return; // don't abandon a live run
    setActive(false);
    setPhase("idle");
    setProgress(null);
    setSummary(null);
    setError(null);
  }, [phase]);

  const saveToken = useCallback(
    async (token: string) => {
      await setDiscogsToken(token);
      refreshToken();
    },
    [refreshToken],
  );

  const forgetToken = useCallback(async () => {
    await clearDiscogsToken();
    refreshToken();
  }, [refreshToken]);

  const run = useCallback(
    async (force: boolean) => {
      setPhase("running");
      setError(null);
      setSummary(null);
      setProgress(null);
      const unlisteners: UnlistenFn[] = [];
      try {
        unlisteners.push(
          await listen<number>("enrich:started", (e) =>
            setProgress({ current: 0, total: e.payload, label: "" }),
          ),
        );
        unlisteners.push(
          await listen<EnrichProgress>("enrich:progress", (e) =>
            setProgress(e.payload),
          ),
        );
        const result = await enrichDiscogsLibrary(force);
        setSummary(result);
        setPhase("done");
        onDone();
      } catch (e) {
        setError(String(e));
        setPhase("idle");
      } finally {
        unlisteners.forEach((f) => f());
      }
    },
    [onDone],
  );

  return {
    active,
    open,
    close,
    tokenSet,
    phase,
    progress,
    summary,
    error,
    saveToken,
    forgetToken,
    run,
  };
}

// Header-toolbar entry point (sits in the mauve library group, beside the
// Discogs CSV import). Pressed while the panel is open.
export function EnrichToolbarButton({ enrich }: { enrich: EnrichController }) {
  return (
    <ToolbarIconButton
      title="Enrich physical releases from Discogs (track + disc counts)"
      onClick={() => (enrich.active ? enrich.close() : enrich.open())}
      pressed={enrich.active}
    >
      <Sparkles size={14} />
    </ToolbarIconButton>
  );
}

// Transient left-column panel, shown only while `active`.
export function DiscogsEnrichPanel({ enrich }: { enrich: EnrichController }) {
  const { phase, progress, summary, error, tokenSet } = enrich;
  const [tokenInput, setTokenInput] = useState("");

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <Section
      title="Discogs enrich"
      icon={<Disc3 size={16} />}
      right={
        phase !== "running" ? (
          <button
            type="button"
            onClick={enrich.close}
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
      <p className="text-xs text-muted">
        Discogs CSV exports carry no track or disc counts. This fills them from
        the Discogs API so physical releases match the rest of the library.
      </p>

      {/* Token row — Discogs requires a personal access token for reliable
          rate limits. Stored in the OS keychain; never displayed back. */}
      <div className="mt-3">
        {tokenSet ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-ok">
              <KeyRound size={12} /> token saved
            </span>
            <button
              type="button"
              onClick={() => enrich.forgetToken()}
              className={SUBTLE_BUTTON_CLS}
            >
              forget token
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Discogs personal access token"
              className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-surface
                         text-xs font-mono placeholder:text-muted
                         focus:outline-none focus:ring-1 focus:ring-mauve/50"
            />
            <button
              type="button"
              disabled={!tokenInput.trim()}
              onClick={async () => {
                await enrich.saveToken(tokenInput.trim());
                setTokenInput("");
              }}
              className={DB_BUTTON_CLS + " disabled:opacity-40"}
            >
              save
            </button>
          </div>
        )}
        {tokenSet === false && (
          <p className="mt-1 text-[10px] text-muted">
            Create one at discogs.com → Settings → Developers. Without a token
            the API is more aggressively rate-limited.
          </p>
        )}
      </div>

      {/* Run controls */}
      {phase !== "running" && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => enrich.run(false)}
            className={DB_BUTTON_CLS}
          >
            <Sparkles size={12} /> enrich missing
          </button>
          <button
            type="button"
            onClick={() => enrich.run(true)}
            className={SUBTLE_BUTTON_CLS}
            title="Re-fetch every Discogs release, overwriting existing counts"
          >
            re-enrich all
          </button>
        </div>
      )}

      {phase === "running" && progress && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="truncate font-mono text-fg/80">
              {progress.label || "starting…"}
            </span>
            <span className="tabular-nums shrink-0 ml-2">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface overflow-hidden">
            <div
              className="h-full bg-mauve transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted">
            throttled to respect Discogs’ rate limit — large libraries take a
            while.
          </p>
        </div>
      )}

      {phase === "done" && summary && (
        <div className="mt-3 text-xs">
          <div className="text-ok">
            enriched {summary.enriched} of {summary.scanned}
            {summary.skipped > 0 && ` · ${summary.skipped} skipped`}
          </div>
          {summary.errors.length > 0 && (
            <details className="mt-1">
              <summary className="text-alert cursor-pointer">
                {summary.errors.length} error
                {summary.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted
                             max-h-32 overflow-y-auto">
                {summary.errors.map((err, i) => (
                  <li key={i} className="break-all">
                    {err}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-alert">{error}</div>}
    </Section>
  );
}
