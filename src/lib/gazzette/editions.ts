// Gazzette editions: the static list in src/data/gazzette.ts plus whatever the
// Heyzine API reports at build time. Pure functions, tested in tests/gazzette.
import type { ImageMetadata } from 'astro';

export interface Edition {
  year: number;
  /** Month number as printed on the edition ("07"). */
  no: string;
  month: string;
  /** Heyzine flipbook id: https://heyzine.com/flip-book/<id>.html */
  id: string;
  /** Imported asset (static list) or the Heyzine thumbnail URL (API). */
  cover?: ImageMetadata | string;
  /** false when the flipbook no longer exists on Heyzine; hidden from the page. */
  available: boolean;
}

/** One item of GET https://heyzine.com/api1/flipbook-list (fields we use). */
export interface Flipbook {
  id: string;
  date?: string;
  title?: string;
  links?: { base?: string; thumbnail?: string };
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ID = /^[a-z0-9]{6,32}$/i;

/**
 * "Gazzette Julio 2026" → { month: 'Julio', no: '07', year: 2026 }.
 * "Gazzette Noviembre" (no year, seen on Heyzine) → { month, no } without year.
 * Anything else → null.
 */
export function parseTitle(title: string): { month: string; no: string; year?: number } | null {
  const m = /^\s*gazzette\s+([a-záéíóúñ]+)(?:\s+(\d{4}))?\s*$/i.exec(title ?? '');
  if (!m) return null;
  const idx = MONTHS.findIndex((x) => x.toLowerCase() === m[1]!.toLowerCase());
  if (idx < 0) return null;
  const base = { month: MONTHS[idx]!, no: String(idx + 1).padStart(2, '0') };
  return m[2] ? { ...base, year: Number(m[2]) } : base;
}

/**
 * The flipbook id used in https://heyzine.com/flip-book/<id>.html. The API's
 * own `id` is the PDF hash plus ".pdf" (e.g. "5f7969b4ab9e…178.pdf"), so the id
 * comes from links.base, or else from the first 10 characters of that hash.
 */
function flipbookId(f: Flipbook): string | null {
  const fromBase = /\/flip-book\/([a-z0-9]+)\.html/i.exec(String(f.links?.base ?? ''));
  if (fromBase && ID.test(fromBase[1]!)) return fromBase[1]!;
  const hash = /^([a-f0-9]{10})[a-f0-9]*\.pdf$/i.exec(f.id);
  if (hash) return hash[1]!.toLowerCase();
  return ID.test(f.id) ? f.id : null;
}

/** Year for a month published around `date`: the one closest to it ("Enero" published in late December → next year). */
function inferYear(monthNo: number, date: string): number | null {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const at = y * 12 + d.getUTCMonth();
  return [y - 1, y, y + 1].reduce((best, c) => (Math.abs(c * 12 + monthNo - 1 - at) < Math.abs(best * 12 + monthNo - 1 - at) ? c : best), y);
}

const key = (e: { year: number; no: string }) => `${e.year}-${e.no}`;

/**
 * Adds the Gazzette flipbooks reported by Heyzine to the static list.
 * - Only titles like "Gazzette <Mes> <Año>" count; other flipbooks are ignored.
 * - A month already present and available in the static list keeps the static
 *   entry (its optimized cover); a month marked unavailable is replaced by the
 *   re-uploaded flipbook.
 * - Static entries missing from the API are kept as they are: the API list may
 *   be partial, so absence never hides an edition.
 * Result: newest first.
 */
export function mergeEditions(staticList: Edition[], flipbooks: Flipbook[]): Edition[] {
  const byMonth = new Map<string, { edition: Edition; date: string }>();
  for (const f of flipbooks) {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string') continue;
    const id = flipbookId(f);
    const title = parseTitle(String(f.title ?? ''));
    if (!id || !title) continue;
    const date = String(f.date ?? '');
    const year = title.year ?? inferYear(Number(title.no), date);
    if (year === null) continue;
    const parsed = { month: title.month, no: title.no, year };
    const prev = byMonth.get(key(parsed));
    if (prev && prev.date >= date) continue;
    const thumb = f.links?.thumbnail;
    byMonth.set(key(parsed), {
      date,
      edition: { ...parsed, id, ...(typeof thumb === 'string' && thumb.startsWith('https://') ? { cover: thumb } : {}), available: true },
    });
  }

  const out: Edition[] = [];
  const seen = new Set<string>();
  for (const s of staticList) {
    const fromApi = byMonth.get(key(s));
    out.push(!s.available && fromApi && fromApi.edition.id !== s.id ? fromApi.edition : s);
    seen.add(key(s));
  }
  for (const [k, v] of byMonth) if (!seen.has(k)) out.push(v.edition);

  return out.sort((a, b) => b.year - a.year || Number(b.no) - Number(a.no));
}

/** GET flipbook-list. Throws on network/HTTP errors or an unexpected body, so the caller can fall back. */
export async function fetchFlipbooks(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10000): Promise<Flipbook[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://heyzine.com/api1/flipbook-list', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Heyzine flipbook-list: HTTP ${res.status}`);
    const body: unknown = await res.json().catch(() => null);
    if (!Array.isArray(body)) throw new Error('Heyzine flipbook-list: expected an array');
    return body as Flipbook[];
  } finally {
    clearTimeout(timer);
  }
}
