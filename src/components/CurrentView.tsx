// `current` — the third top-level view. Surfaces the live feed-note channel
// (kind:31239) matched against the local discography. Read-only in Phase 1:
// it shows what the owner has broadcast and how each note lines up with a local
// release. Authoring / publish / curation are later increments.
//
// The feed read + trust gate are the SHARED template (lib/feed.ts +
// hooks/useFeed.tsx) that ndisc.view and glmps reuse; this component is the
// ndisc-side presentation. See schema/current-feed-2026-06-23.md.

import { useEffect, useMemo, useState } from "react";
import { Radio, ExternalLink, Disc3, AlertTriangle, ImageOff } from "lucide-react";
import { listReleases, type Release } from "../lib/tauri";
import { releaseIdFromRef } from "../lib/feed";
import { useFeed } from "../hooks/useFeed";
import { Section } from "./Section";

interface Props {
  npub: string | null;
  relays: string[];
  reloadKey: number;
}

export function CurrentView({ npub, relays, reloadKey }: Props) {
  const { notes, loading } = useFeed(npub, relays);

  // Local releases, indexed by id, for the match column.
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

  const body = useMemo(() => {
    if (!npub) {
      return (
        <Empty text="Sign in with your Nostr identity to load the feed." />
      );
    }
    if (relays.length === 0) {
      return <Empty text="No relays configured." />;
    }
    if (notes.length === 0) {
      return (
        <Empty
          text={
            loading
              ? "Listening for feed notes…"
              : "No feed notes yet. Notes you publish to the channel appear here."
          }
        />
      );
    }
    return (
      <ul className="flex flex-col gap-3">
        {notes.map((n) => (
          <FeedCard key={n.address} note={n} byId={byId} />
        ))}
      </ul>
    );
  }, [npub, relays, notes, loading, byId]);

  return (
    <Section
      icon={<Radio size={16} />}
      title="Current"
      right={
        notes.length > 0 ? (
          <span className="text-xs text-muted font-mono">
            {notes.length} note{notes.length === 1 ? "" : "s"}
          </span>
        ) : undefined
      }
      className="h-full"
      bodyClassName="min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
    >
      {body}
    </Section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center py-16 text-sm text-muted">
      {text}
    </div>
  );
}

function FeedCard({
  note,
  byId,
}: {
  note: import("../lib/feed").FeedNote;
  byId: Map<number, Release>;
}) {
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
    return <Tag muted text="standalone note — no release referenced" />;
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
    <div className="flex items-center gap-1.5 text-xs">
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
