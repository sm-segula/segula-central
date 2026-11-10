import { fetchFlipbooks, mergeEditions } from '../lib/gazzette/editions';
import type { Edition } from '../lib/gazzette/editions';
import c202607 from '../assets/gazzette/2026-07.webp';
import c202606 from '../assets/gazzette/2026-06.webp';
import c202605 from '../assets/gazzette/2026-05.webp';
import c202604 from '../assets/gazzette/2026-04.webp';
import c202603 from '../assets/gazzette/2026-03.webp';
import c202602 from '../assets/gazzette/2026-02.webp';
import c202601 from '../assets/gazzette/2026-01.webp';
import c202512 from '../assets/gazzette/2025-12.webp';

/**
 * Known editions, newest first, with optimized covers. New editions do not need
 * to be added here: name the flipbook "Gazzette <Mes> <Año>" on Heyzine and the
 * next build adds it (see loadEditions). Add one here only to give it a local
 * cover or to mark it unavailable.
 */
const STATIC_EDITIONS: Edition[] = [
  { year: 2026, no: '07', month: 'Julio', id: '5f7969b4ab', cover: c202607, available: true },
  { year: 2026, no: '06', month: 'Junio', id: '0165baa695', cover: c202606, available: true },
  { year: 2026, no: '05', month: 'Mayo', id: 'ce0090495a', cover: c202605, available: true },
  { year: 2026, no: '04', month: 'Abril', id: 'a377387d79', cover: c202604, available: true },
  { year: 2026, no: '03', month: 'Marzo', id: 'fa7cd6302d', cover: c202603, available: true },
  { year: 2026, no: '02', month: 'Febrero', id: '3845bdfb42', cover: c202602, available: true },
  { year: 2026, no: '01', month: 'Enero', id: '7db462b355', cover: c202601, available: true },
  { year: 2025, no: '12', month: 'Diciembre', id: '56def59229', cover: c202512, available: true },
  { year: 2025, no: '11', month: 'Noviembre', id: 'f1ee64fcc9', available: false },
  { year: 2025, no: '10', month: 'Octubre', id: '3b544c23cc', available: false },
  { year: 2025, no: '08', month: 'Agosto', id: '84ec260f08', available: false },
  { year: 2025, no: '07', month: 'Julio', id: '9b1169a568', available: false },
  { year: 2025, no: '06', month: 'Junio', id: '8969ab08a1', available: false },
  { year: 2025, no: '05', month: 'Mayo', id: 'f90fdc41b7', available: false },
  { year: 2025, no: '04', month: 'Abril', id: '08eb868da2', available: false },
  { year: 2025, no: '03', month: 'Marzo', id: 'f87c28a2f1', available: false },
];

export const flipbookUrl = (e: Edition): string => `https://heyzine.com/flip-book/${e.id}.html`;
export const editionTitle = (e: Edition): string => `Gazzette ${e.month} ${e.year}`;

/**
 * Build time: adds the Gazzettes published on Heyzine (titled "Gazzette <Mes> <Año>")
 * when HEYZINE_API_KEY is set. Any failure falls back to the static list, so a
 * Heyzine outage never breaks the deploy. A daily rebuild picks up new editions
 * (.github/workflows/gazzette-rebuild.yml).
 */
async function loadEditions(): Promise<Edition[]> {
  const apiKey = import.meta.env.HEYZINE_API_KEY;
  if (!apiKey) return STATIC_EDITIONS;
  try {
    return mergeEditions(STATIC_EDITIONS, await fetchFlipbooks(apiKey));
  } catch (err) {
    console.warn(`[gazzette] Heyzine API unavailable, using the static list: ${err instanceof Error ? err.message : err}`);
    return STATIC_EDITIONS;
  }
}

export type { Edition };
export const EDITIONS: Edition[] = await loadEditions();

const live = EDITIONS.filter((e) => e.available);
export const LATEST: Edition = live[0]!;
/** Available editions after the latest, grouped by year (newest year first). */
export const ARCHIVE: { year: number; editions: Edition[] }[] = [...new Set(live.slice(1).map((e) => e.year))].map((year) => ({
  year,
  editions: live.slice(1).filter((e) => e.year === year),
}));
