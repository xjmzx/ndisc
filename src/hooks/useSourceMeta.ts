import { useSyncExternalStore } from "react";
import { subscribeSourceMeta, sourceMetaVersion } from "../lib/source";

/** Re-render the caller whenever any source-meta (colour / digital / physical)
 *  is edited from a detail panel. Source meta lives in localStorage, which React
 *  can't observe, so without this the release-list rings + medium glyphs — which
 *  derive from it via isPaired / releaseSourceColor — would lag behind the write
 *  until some unrelated re-render. Calling this subscribes the component; the
 *  returned version bumps on every setSourceMeta write, forcing a fresh render. */
export function useSourceMetaVersion(): number {
  return useSyncExternalStore(subscribeSourceMeta, sourceMetaVersion);
}
