// Comunicados read from the Drive folder at build time (through the Apps Script
// action comunicados_list), merged with the historic list. Pure functions,
// tested in tests/comunicados.
import type { DriveFile } from './drive-list.js';

/** What the page lists (src/islands/SearchList.tsx). */
export interface Comunicado {
  year: string;
  title: string;
  href: string;
}

/** A Drive comunicado plus its sort date (ISO, from the name prefix or the upload). */
export interface DriveComunicado extends Comunicado {
  date: string;
}

// Optional leading date: "2026-11-10 - ", "2026-11 ", "2026_01_08 - ". The month
// is required, so a title like "2000 empleados celebran" keeps its number.
const DATE_PREFIX = /^\s*(\d{4})[-_.](\d{1,2})(?:[-_.](\d{1,2}))?(?=[\s\-_·]|$)[\s\-_·]*/;
// Extension: starts with a letter, so "Comunicado v2.1" keeps its ".1".
const EXTENSION = /\.[a-z][a-z0-9]{1,4}\s*$/i;

const pad = (s: string | undefined) => (s ?? '1').padStart(2, '0');
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const key = (c: Comunicado) => `${c.year}|${norm(c.title)}`;

/**
 * "2026-11-10 - Cierre de incidencias · Noviembre.pdf" → year 2026, that title.
 * Without a leading date, the year comes from the upload date. Copy suffixes
 * "(1)", stray dashes and double spaces are removed. Null when there is no title.
 */
export function parseComunicado(f: DriveFile): DriveComunicado | null {
  if (!f || typeof f !== 'object' || typeof f.id !== 'string' || typeof f.name !== 'string') return null;
  let base = f.name.replace(EXTENSION, '');
  let date = String(f.created ?? '');
  const m = DATE_PREFIX.exec(base);
  if (m) {
    date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    base = base.slice(m[0].length);
  }
  const title = base
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .replace(/\s{2,}/g, ' ');
  const year = /^\d{4}/.exec(date)?.[0];
  if (!title || !year) return null;
  return { year, title, href: `https://drive.google.com/file/d/${f.id}/view`, date };
}

/** Newest first by date; one entry per (year, title), keeping the latest upload. */
export function buildComunicados(files: DriveFile[]): DriveComunicado[] {
  const best = new Map<string, { c: DriveComunicado; created: string }>();
  for (const f of files) {
    const c = parseComunicado(f);
    if (!c) continue;
    const created = String(f.created ?? '');
    const k = key(c);
    const prev = best.get(k);
    if (prev && prev.created >= created) continue;
    best.set(k, { c, created });
  }
  return [...best.values()].map((x) => x.c).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Drive comunicados first, then the historic ones not already in Drive (same
 * file or same year and title), grouped by year, newest year first. The sort is
 * stable, so each year keeps that order.
 */
export function mergeComunicados(drive: Comunicado[], historic: Comunicado[]): Comunicado[] {
  const seen = new Set<string>();
  const out: Comunicado[] = [];
  for (const c of [...drive, ...historic]) {
    const k = key(c);
    if (seen.has(k) || seen.has(c.href)) continue;
    seen.add(k);
    seen.add(c.href);
    out.push({ year: c.year, title: c.title, href: c.href });
  }
  return out.sort((a, b) => b.year.localeCompare(a.year));
}
