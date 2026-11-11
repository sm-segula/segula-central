import { buildEditions, fetchSabiasList, imageReachable } from '../lib/sabias-que';
import type { Edition } from '../lib/sabias-que';
import fallback from './sabias-que.json';

/**
 * Build time: lists the "¿Sabías qué?" Drive folder through the Apps Script
 * (action sabias_list, same web app and shared key as the login), so a new
 * image named "<número> Sabías Qué - <tema>.png" appears without a code change.
 * Any failure falls back to sabias-que.json (last manual list), so Drive or the
 * script being down never breaks the deploy. The daily rebuild
 * (.github/workflows/gazzette-rebuild.yml) picks up new editions.
 */
async function loadEditions(): Promise<Edition[]> {
  const url = import.meta.env.PUBLIC_TRAVEL_FOLIO_URL;
  const key = import.meta.env.AUTH_SHARED_SECRET;
  if (!url || !key) return fallback;
  try {
    const editions = buildEditions(await fetchSabiasList(url, key));
    if (!editions.length) throw new Error('no editions recognized in the folder');
    // Only the latest is shown as an image; drop it if Drive will not serve it
    // (file not shared by link), so the page shows a placeholder instead of
    // failing the build.
    const latest = editions[0]!;
    if (latest.img && !(await imageReachable(latest.img))) {
      console.warn(`[sabias-que] image of edition ${latest.n} is not reachable (is it shared by link?); showing a placeholder.`);
      delete latest.img;
    }
    for (const e of editions.slice(1)) delete e.img;
    return editions;
  } catch (err) {
    console.warn(`[sabias-que] Drive list unavailable, using sabias-que.json: ${err instanceof Error ? err.message : err}`);
    return fallback;
  }
}

export type { Edition };
export const EDITIONS: Edition[] = await loadEditions();
