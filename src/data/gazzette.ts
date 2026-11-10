import type { ImageMetadata } from 'astro';
import c202607 from '../assets/gazzette/2026-07.webp';
import c202606 from '../assets/gazzette/2026-06.webp';
import c202605 from '../assets/gazzette/2026-05.webp';
import c202604 from '../assets/gazzette/2026-04.webp';
import c202603 from '../assets/gazzette/2026-03.webp';
import c202602 from '../assets/gazzette/2026-02.webp';
import c202601 from '../assets/gazzette/2026-01.webp';
import c202512 from '../assets/gazzette/2025-12.webp';

export interface Edition {
  year: number;
  /** Edition number within the year, as printed ("07"). */
  no: string;
  month: string;
  /** Heyzine flipbook id: https://heyzine.com/flip-book/<id>.html */
  id: string;
  cover?: ImageMetadata;
  /**
   * false when the flipbook no longer exists on Heyzine ("Page not found",
   * checked 2026-11-10). Hidden from the page until it is uploaded again.
   */
  available: boolean;
}

/**
 * Newest first. To publish a new edition: add it at the top with its Heyzine id
 * and its cover in src/assets/gazzette/<year>-<month>.webp. The first available
 * one is shown embedded on the page and featured on the home page.
 */
export const EDITIONS: Edition[] = [
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

const live = EDITIONS.filter((e) => e.available);
export const LATEST: Edition = live[0]!;
/** Available editions after the latest, grouped by year (newest year first). */
export const ARCHIVE: { year: number; editions: Edition[] }[] = [...new Set(live.slice(1).map((e) => e.year))].map((year) => ({
  year,
  editions: live.slice(1).filter((e) => e.year === year),
}));
