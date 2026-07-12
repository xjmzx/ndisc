import type { PublishState } from "./tauri";

// The four-state Nostr publish lifecycle, as a single shared vocabulary so the
// filter control, the row indicator dot, and the publish/unpublish confirm copy
// all read the same labels and colours. Order is the natural lifecycle order.
export interface PublishStateMeta {
  value: PublishState;
  label: string;
  /** Tailwind text-colour class for the state dot. */
  dot: string;
  /** One-line meaning, used in tooltips + the filter menu. */
  desc: string;
}

export const PUBLISH_STATES: PublishStateMeta[] = [
  {
    value: "never",
    label: "Never",
    dot: "text-muted",
    desc: "never published to relays",
  },
  {
    // Nostr purple — its own token, NOT text-mauve. Mauve is the theme brand
    // tint and the upleb theme paints it orange, which sits right on top of
    // warn/amber and made Published and Stale read as the same dot.
    value: "published",
    label: "Published",
    dot: "text-nostr",
    desc: "a kind:31237 event is live on relays",
  },
  {
    value: "stale",
    label: "Stale",
    dot: "text-warn",
    desc: "edited since publishing — the live event is out of date",
  },
  {
    value: "retracted",
    label: "Retracted",
    dot: "text-alert",
    desc: "a kind:5 deletion was sent (relays that honour it dropped the event)",
  },
];

/** A release's state, treating NULL/absent as "never" (pre-column rows). */
export function publishStateOf(r: {
  publishState?: PublishState | null;
}): PublishState {
  return r.publishState ?? "never";
}

export function publishStateMeta(s: PublishState): PublishStateMeta {
  return PUBLISH_STATES.find((x) => x.value === s) ?? PUBLISH_STATES[0];
}
