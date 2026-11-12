import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComunicados, mergeComunicados, parseComunicado } from '../../src/lib/comunicados.ts';
import type { DriveFile } from '../../src/lib/drive-list.ts';

const file = (id: string, name: string, created = '2026-11-05T16:20:00Z', mime = 'application/pdf'): DriveFile => ({ id, name, mime, created });

test('parseComunicado: the file name is the title; the year comes from the upload date', () => {
  assert.deepEqual(parseComunicado(file('a', 'Encuesta de Clima Laboral 2026 · Segula Technologies México.pdf')), {
    year: '2026',
    title: 'Encuesta de Clima Laboral 2026 · Segula Technologies México',
    href: 'https://drive.google.com/file/d/a/view',
    date: '2026-11-05T16:20:00Z',
  });
});

test('parseComunicado: an optional leading date sets the year and is removed from the title', () => {
  const cases: [string, string, string][] = [
    ['2025-12-15 - Aguinaldo 2025.pdf', '2025', 'Aguinaldo 2025'],
    ['2025-12 Cierre de incidencias · Diciembre.png', '2025', 'Cierre de incidencias · Diciembre'],
    ['2026_01_08 - Calendario de pagos.pdf', '2026', 'Calendario de pagos'],
    ['Feliz Día del Padre (1).png', '2026', 'Feliz Día del Padre'],
    ['  ¡Aviso importante!  Actualiza tu app Pluxee - .pdf', '2026', '¡Aviso importante! Actualiza tu app Pluxee'],
    // A leading number alone is part of the title, not a date.
    ['1000 días sin accidentes.pdf', '2026', '1000 días sin accidentes'],
    ['2000 empleados celebran.pdf', '2026', '2000 empleados celebran'],
  ];
  for (const [name, year, title] of cases) {
    const c = parseComunicado(file('x', name));
    assert.deepEqual([c?.year, c?.title], [year, title], name);
  }
});

test('parseComunicado skips files without a usable name; malformed items do not throw', () => {
  for (const f of [file('x', '.pdf'), file('x', '2026-01-01.pdf'), null, {}, { id: 'x' }] as unknown as DriveFile[]) assert.equal(parseComunicado(f), null);
});

test('buildComunicados: newest first by date, one entry per title and year (latest upload)', () => {
  const out = buildComunicados([
    file('old', 'Aviso Pluxee.pdf', '2026-03-01T10:00:00Z'),
    file('nov', 'Cierre de incidencias · Noviembre.pdf', '2026-11-10T10:00:00Z'),
    file('dic25', '2025-12-15 - Aguinaldo 2025.pdf', '2026-11-11T10:00:00Z'),
    file('new', 'Aviso Pluxee (1).pdf', '2026-03-02T10:00:00Z'),
  ]);
  assert.deepEqual(out.map((c) => c.href.split('/')[5]), ['nov', 'new', 'dic25']);
  assert.deepEqual(out.map((c) => c.year), ['2026', '2026', '2025']);
});

test('mergeComunicados: Drive first, then the historic list without repeats, grouped by year', () => {
  const drive = buildComunicados([
    file('n1', 'Cierre de incidencias · Noviembre.pdf', '2026-11-10T10:00:00Z'),
    file('h1', 'SEGULA AI Essentials.pdf', '2026-11-09T10:00:00Z'),
  ]);
  const historic = [
    { year: '2026', title: 'Segula AI essentials', href: 'https://drive.google.com/file/d/old/view' },
    { year: '2026', title: 'Cierre de incidencias · Agosto', href: 'https://drive.google.com/file/d/ago/view' },
    { year: '2025', title: 'Aguinaldo 2025', href: 'https://drive.google.com/file/d/ag/view' },
  ];
  const out = mergeComunicados(drive, historic);
  assert.deepEqual(out.map((c) => c.title), [
    'Cierre de incidencias · Noviembre',
    'SEGULA AI Essentials',
    'Cierre de incidencias · Agosto',
    'Aguinaldo 2025',
  ]);
  // Only the fields the page uses.
  assert.deepEqual(Object.keys(out[0]!).sort(), ['href', 'title', 'year']);
});

test('mergeComunicados keeps a Drive file from an older year in its own group', () => {
  const drive = buildComunicados([file('d', '2024-05-01 - Política vieja.pdf')]);
  const out = mergeComunicados(drive, [{ year: '2025', title: 'B', href: 'h' }]);
  assert.deepEqual(out.map((c) => c.year), ['2025', '2024']);
});
