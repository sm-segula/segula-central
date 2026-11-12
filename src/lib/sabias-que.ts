// "¿Sabías qué?" editions read from the Drive folder at build time (through the
// Apps Script action sabias_list). Pure functions, tested in tests/sabias-que.
import { fetchDriveList } from './drive-list.js';
import type { DriveFile } from './drive-list.js';

export type { DriveFile };

export interface Edition {
  /** Number as written in the file name ("80", "25.1", "00"). */
  n: string;
  t: string;
  /** Drive viewer link. */
  h: string;
  /** Image URL for showing the edition on the page (Drive-hosted, public by link). */
  img?: string;
}

/**
 * "80 Sabías Qué - Prima Vacacional.png" → { n: '80', t: 'Prima Vacacional' }.
 * Accepts the variants found in the folder: optional dash after the number,
 * "¿Sabías qué?" with or without accents/marks, copy suffixes "(1)", stray dashes.
 */
export function parseName(name: string): { n: string; t: string } | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*-?\s*¿?\s*sab[ií]as\s+qu[ée]\s*\??\s*-*\s*(.*?)\s*(?:\(\d+\))?\s*-*\s*\.[a-z0-9]+\s*$/i.exec(name ?? '');
  if (!m) return null;
  const t = m[2]!.replace(/^[\s-]+|[\s-]+$/g, '').replace(/\s{2,}/g, ' ');
  return t ? { n: m[1]!, t } : null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Newest number first; one entry per (number, title), keeping the latest upload. */
export function buildEditions(files: DriveFile[]): Edition[] {
  const best = new Map<string, { e: Edition; num: number; created: string }>();
  for (const f of files) {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string' || typeof f.name !== 'string') continue;
    const p = parseName(f.name);
    if (!p) continue;
    const created = String(f.created ?? '');
    const k = `${p.n}|${norm(p.t)}`;
    const prev = best.get(k);
    if (prev && prev.created >= created) continue;
    best.set(k, {
      num: Number(p.n),
      created,
      e: { n: p.n, t: p.t, h: `https://drive.google.com/file/d/${f.id}/view`, img: `https://lh3.googleusercontent.com/d/${f.id}=w1600` },
    });
  }
  return [...best.values()]
    .sort((a, b) => b.num - a.num || b.created.localeCompare(a.created) || a.e.t.localeCompare(b.e.t))
    .map((x) => x.e);
}

/**
 * Whether an image URL answers 200 with an image. Each Drive file is shared by
 * link one by one, so a new upload that was not shared would make the image
 * optimizer fail the whole build; the caller drops the image instead. Never throws.
 */
export async function imageReachable(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    const ok = res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
    await res.body?.cancel().catch(() => {});
    return ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** POST sabias_list to the Apps Script web app. Throws on any failure so the caller can fall back. */
export function fetchSabiasList(url: string, key: string, fetchImpl: typeof fetch = fetch, timeoutMs = 20000): Promise<DriveFile[]> {
  return fetchDriveList(url, key, 'sabias_list', fetchImpl, timeoutMs);
}
