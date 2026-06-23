// `current` — the third top-level view. The feed-note channel (kind:31239):
// author + publish notes that point at releases, and see them live on relays
// matched against the local discography.
//
// The read + trust gate are the SHARED template (lib/feed.ts + hooks/useFeed.tsx)
// that ndisc.view and glmps reuse; authoring/publish is ndisc-only (Rust signer).
// See schema/current-feed-2026-06-23.md / schema/feed.v1.json.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Radio,
  ExternalLink,
  Disc3,
  AlertTriangle,
  ImageOff,
  Plus,
  Pencil,
  Trash2,
  Send,
  Undo2,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import {
  listReleases,
  listFeedDrafts,
  saveFeedDraft,
  deleteFeedDraft,
  publishFeedNote,
  unpublishFeedNote,
  type Release,
  type FeedDraft,
} from "../lib/tauri";
import { releaseIdFromRef, releaseRef, type FeedNote } from "../lib/feed";
import { useFeed } from "../hooks/useFeed";
import { Section } from "./Section";
import { DB_BUTTON_CLS, SUBTLE_BUTTON_CLS } from "../lib/buttonStyles";

interface Props {
  npub: string | null;
  relays: string[];
  reloadKey: number;
}

const BLANK: FeedDraft = {
  images: [],
  links: [],
  topics: [],
};

export function CurrentView({ npub, relays, reloadKey }: Props) {
  const { notes, loading } = useFeed(npub, relays);

  const myHex = useMemo(() => {
    if (!npub) return null;
    try {
      const d = nip19.decode(npub);
      return d.type === "npub" ? (d.data as string) : null;
    } catch {
      return null;
    }
  }, [npub]);

  // Local releases, indexed by id — for the release picker + match column.
  const [byId, setById] = useState<Map<number, Release>>(new Map());
  useEffect(() => {
    let alive = true;
    listReleases()
      .then((rs) => {
        if (!alive) return;
        const m = new Map<number, Release>();
        for (const r of rs) if (r.id != null) m.set(r.id, r);
        setById(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const releaseOptions = useMemo(
    () =>
      [...byId.values()].sort((a, b) =>
        `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`),
      ),
    [byId],
  );

  // Drafts (local authoring) + the compose form (editing != null shows it).
  const [drafts, setDrafts] = useState<FeedDraft[]>([]);
  const [editing, setEditing] = useState<FeedDraft | null>(null);
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reloadDrafts = useCallback(() => {
    listFeedDrafts()
      .then(setDrafts)
      .catch((e) => setStatus(String(e)));
  }, []);
  useEffect(() => {
    reloadDrafts();
  }, [reloadDrafts]);

  const onSave = async () => {
    if (!editing) return;
    setBusy(editing.id ?? "new");
    setStatus(null);
    try {
      await saveFeedDraft(editing);
      setEditing(null);
      reloadDrafts();
    } catch (e) {
      setStatus(`save failed — ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onPublish = async (d: FeedDraft) => {
    if (d.id == null) return;
    if (relays.length === 0) return setStatus("no relays configured");
    setBusy(d.id);
    setStatus(null);
    try {
      const r = await publishFeedNote(d.id, relays);
      setStatus(`published — accepted by ${r.acceptedBy.length} relay(s)`);
      reloadDrafts();
    } catch (e) {
      setStatus(`publish failed — ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onUnpublish = async (d: FeedDraft) => {
    if (d.id == null) return;
    setBusy(d.id);
    setStatus(null);
    try {
      await unpublishFeedNote(d.id, relays);
      setStatus("unpublished (kind:5 sent)");
      reloadDrafts();
    } catch (e) {
      setStatus(`unpublish failed — ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (d: FeedDraft) => {
    if (d.id == null) return;
    setBusy(d.id);
    try {
      await deleteFeedDraft(d.id);
      if (editing?.id === d.id) setEditing(null);
      reloadDrafts();
    } catch (e) {
      setStatus(`delete failed — ${e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      icon={<Radio size={16} />}
      title="Current"
      right={
        <button
          className={DB_BUTTON_CLS}
          onClick={() => {
            setEditing({ ...BLANK });
            setStatus(null);
          }}
          disabled={!myHex}
          title={myHex ? "Compose a feed note" : "Sign in to author notes"}
        >
          <Plus size={12} /> New note
        </button>
      }
      className="h-full"
      bodyClassName="min-h-0 overflow-y-auto [scrollbar-gutter:stable] gap-4"
    >
      {status && (
        <p className="text-xs font-mono text-mauve bg-mauve/10 rounded px-2 py-1">
          {status}
        </p>
      )}

      {editing && (
        <Composer
          draft={editing}
          setDraft={setEditing}
          releaseOptions={releaseOptions}
          myHex={myHex}
          busy={busy === (editing.id ?? "new")}
          onSave={onSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Drafts — local authoring side */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs uppercase tracking-wide text-muted">
          Drafts {drafts.length > 0 && `· ${drafts.length}`}
        </h3>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted py-2">
            No drafts. “New note” starts one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                byId={byId}
                busy={busy === d.id}
                onEdit={() => setEditing(d)}
                onPublish={() => onPublish(d)}
                onUnpublish={() => onUnpublish(d)}
                onDelete={() => onDelete(d)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Live on relays — the round-trip truth (shared resolveFeed) */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs uppercase tracking-wide text-muted">
          Live on relays {notes.length > 0 && `· ${notes.length}`}
        </h3>
        {notes.length === 0 ? (
          <p className="text-sm text-muted py-2">
            {loading
              ? "Listening for feed notes…"
              : "Nothing live yet. Publish a draft to see it here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((n) => (
              <FeedCard key={n.address} note={n} byId={byId} />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────

function Composer({
  draft,
  setDraft,
  releaseOptions,
  myHex,
  busy,
  onSave,
  onCancel,
}: {
  draft: FeedDraft;
  setDraft: (d: FeedDraft) => void;
  releaseOptions: Release[];
  myHex: string | null;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<FeedDraft>) => setDraft({ ...draft, ...patch });
  const pickedId = releaseIdFromRef(draft.releaseRef ?? null);

  return (
    <div className="rounded-lg border border-mauve/30 bg-panel p-3 flex flex-col gap-2">
      <input
        className="bg-surface rounded px-2 py-1.5 text-sm text-fg placeholder:text-muted"
        placeholder="Title (optional)"
        value={draft.title ?? ""}
        onChange={(e) => set({ title: e.target.value })}
      />
      <textarea
        className="bg-surface rounded px-2 py-1.5 text-sm text-fg placeholder:text-muted min-h-[4rem]"
        placeholder="Your words…"
        value={draft.body ?? ""}
        onChange={(e) => set({ body: e.target.value })}
      />

      <label className="text-xs text-muted">References release</label>
      <select
        className="bg-surface rounded px-2 py-1.5 text-sm text-fg appearance-none"
        value={pickedId ?? ""}
        disabled={!myHex}
        onChange={(e) => {
          const id = e.target.value ? parseInt(e.target.value, 10) : null;
          set({
            releaseRef: id != null && myHex ? releaseRef(myHex, id) : null,
          });
        }}
      >
        <option value="">— none (standalone note) —</option>
        {releaseOptions.map((r) => (
          <option key={r.id} value={r.id ?? ""}>
            {r.artist} — {r.title}
            {r.year ? ` (${r.year})` : ""}
          </option>
        ))}
      </select>

      <LineList
        label="Image URLs (one per line)"
        value={draft.images}
        onChange={(images) => set({ images })}
      />
      <LineList
        label="Links (one per line)"
        value={draft.links}
        onChange={(links) => set({ links })}
      />
      <input
        className="bg-surface rounded px-2 py-1.5 text-sm text-fg placeholder:text-muted"
        placeholder="Topics, comma-separated (e.g. shoegaze, reissue)"
        value={draft.topics.join(", ")}
        onChange={(e) =>
          set({
            topics: e.target.value
              .split(",")
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean),
          })
        }
      />

      <div className="flex items-center gap-2 pt-1">
        <button
          className="px-3 py-1.5 rounded-md bg-accent text-bg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          onClick={onSave}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save draft"}
        </button>
        <button className={SUBTLE_BUTTON_CLS} onClick={onCancel}>
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-muted font-mono">
          {draft.id ? `editing #${draft.id}` : "new note"}
        </span>
      </div>
    </div>
  );
}

function LineList({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted">{label}</label>
      <textarea
        className="bg-surface rounded px-2 py-1.5 text-xs font-mono text-fg placeholder:text-muted min-h-[2.5rem]"
        value={value.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </div>
  );
}

// ── Draft row ─────────────────────────────────────────────────────────────

function DraftRow({
  draft,
  byId,
  busy,
  onEdit,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  draft: FeedDraft;
  byId: Map<number, Release>;
  busy: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}) {
  const published = draft.lastPublishedAt != null;
  return (
    <li className="rounded-lg bg-panel border border-surface/60 p-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-fg truncate">
          {draft.title || draft.body?.slice(0, 40) || "(untitled note)"}
        </span>
        <span
          className={
            "ml-auto text-[10px] uppercase tracking-wide font-mono shrink-0 " +
            (published ? "text-mauve" : "text-muted")
          }
        >
          {published ? "published" : "draft"}
        </span>
      </div>
      {draft.body && (
        <p className="text-xs text-fg/70 line-clamp-2">{draft.body}</p>
      )}
      <ReleaseMatch ref_={draft.releaseRef ?? null} byId={byId} />
      <div className="flex items-center gap-1.5 pt-0.5">
        <button className={SUBTLE_BUTTON_CLS} onClick={onEdit} disabled={busy}>
          <Pencil size={11} /> Edit
        </button>
        <button className={DB_BUTTON_CLS} onClick={onPublish} disabled={busy}>
          <Send size={11} /> {published ? "Republish" : "Publish"}
        </button>
        {published && (
          <button
            className={SUBTLE_BUTTON_CLS}
            onClick={onUnpublish}
            disabled={busy}
          >
            <Undo2 size={11} /> Unpublish
          </button>
        )}
        <button
          className={SUBTLE_BUTTON_CLS + " ml-auto"}
          onClick={onDelete}
          disabled={busy}
          title="Delete draft (local)"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </li>
  );
}

// ── Live feed card (shared shape) ───────────────────────────────────────────

function FeedCard({ note, byId }: { note: FeedNote; byId: Map<number, Release> }) {
  const lead = note.images[0];
  return (
    <li className="rounded-lg bg-panel border border-surface/60 p-3 flex gap-3">
      {lead ? (
        <img
          src={lead}
          alt=""
          className="w-20 h-20 rounded object-cover shrink-0 bg-surface"
          loading="lazy"
        />
      ) : (
        <div className="w-20 h-20 rounded shrink-0 bg-surface grid place-items-center text-muted">
          <ImageOff size={18} />
        </div>
      )}

      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          {note.title && (
            <h3 className="text-sm font-semibold text-fg truncate">
              {note.title}
            </h3>
          )}
          <span className="ml-auto text-[10px] uppercase tracking-wide text-mauve font-mono shrink-0">
            {note.provenance}
          </span>
        </div>

        {note.body && (
          <p className="text-sm text-fg/80 whitespace-pre-wrap line-clamp-4">
            {note.body}
          </p>
        )}

        <ReleaseMatch ref_={note.release} byId={byId} />

        {(note.topics.length > 0 || note.links.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {note.topics.map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-accent font-mono"
              >
                {t}
              </span>
            ))}
            {note.links.map((l) => (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-digital font-mono inline-flex items-center gap-1 hover:underline max-w-[14rem] truncate"
                title={l}
              >
                <ExternalLink size={10} /> {hostOf(l)}
              </a>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// The "matches to" reconciliation: resolve the note's `a` reference against the
// local DB and surface the alignment (matched / not-in-DB / unpublished).
function ReleaseMatch({
  ref_,
  byId,
}: {
  ref_: string | null;
  byId: Map<number, Release>;
}) {
  if (!ref_) {
    return <Tag muted text="standalone — no release referenced" />;
  }
  const id = releaseIdFromRef(ref_);
  const rel = id != null ? byId.get(id) : undefined;
  if (!rel) {
    return (
      <Tag
        warn
        icon={<AlertTriangle size={11} />}
        text={`references a release not in this DB (#${id ?? "?"})`}
      />
    );
  }
  const published = rel.lastPublishedAt != null;
  return (
    <div className="flex items-center gap-1.5 text-xs min-w-0">
      <Disc3 size={12} className={published ? "text-digital" : "text-auburn"} />
      <span className="text-fg/70 truncate">
        {rel.artist} — {rel.title}
        {rel.year ? ` (${rel.year})` : ""}
      </span>
      {!published && <Tag warn text="release not published" />}
    </div>
  );
}

function Tag({
  text,
  icon,
  warn,
  muted,
}: {
  text: string;
  icon?: React.ReactNode;
  warn?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={
        "text-[10px] inline-flex items-center gap-1 font-mono " +
        (warn ? "text-auburn" : muted ? "text-muted" : "text-fg/60")
      }
    >
      {icon}
      {text}
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
