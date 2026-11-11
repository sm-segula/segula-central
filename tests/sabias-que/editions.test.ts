import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditions, fetchSabiasList, imageReachable, parseName } from '../../src/lib/sabias-que.ts';
import type { DriveFile } from '../../src/lib/sabias-que.ts';

// Real names from the Drive folder (2026-11-11), including every odd variant.
test('parseName reads the number and title from every naming variant in the folder', () => {
  const cases: [string, string, string][] = [
    ['80 Sabías Qué - Prima Vacacional.png', '80', 'Prima Vacacional'],
    ['00¿Sabías qué - Segula Technologies.png', '00', 'Segula Technologies'],
    ['09 - ¿Sabías qué  Oficinas Segula México.png', '09', 'Oficinas Segula México'],
    ['17 ¿Sabías Qué   Offboarding.png', '17', 'Offboarding'],
    ['22 - Sabías Qué - Historia Segula Technologies (1).png', '22', 'Historia Segula Technologies'],
    ['23 - ¿Sabías Que  HR Team (1).png', '23', 'HR Team'],
    ['25.1 - Sabías Qué  -  Información Documentada.png', '25.1', 'Información Documentada'],
    ['28 - Sabías qué Constancias Laborales.png', '28', 'Constancias Laborales'],
    ['29 - Sabias Qué - Shutdown.png', '29', 'Shutdown'],
    ['60- Sabías Qué - Maternidad.png', '60', 'Maternidad'],
    ['01 - ¿Sabías qué - Adendums -.png', '01', 'Adendums'],
    ['26 - Sabías qué - MySkills .png', '26', 'MySkills'],
    ['20 - ¿Sabías qué - PMO (2).png', '20', 'PMO'],
    ['46 - Sabías Que - Reporte de Evaluación de Desempeño.png', '46', 'Reporte de Evaluación de Desempeño'],
    ['81 - ¿Sabías qué? - Nuevo tema.pdf', '81', 'Nuevo tema'],
  ];
  for (const [name, n, t] of cases) assert.deepEqual(parseName(name), { n, t }, name);
  for (const bad of ['notas internas.png', 'Sabías Qué - Sin número.png', '', 'logo.png']) assert.equal(parseName(bad), null, bad);
});

const file = (id: string, name: string, created = '2026-11-05T16:20:00Z'): DriveFile => ({ id, name, mime: 'image/png', created });

test('buildEditions sorts by number (newest first) and builds the Drive links', () => {
  const out = buildEditions([
    file('a79', '79 Sabías Qué - Home Office Efectivo.png'),
    file('a80', '80 Sabías Qué - Prima Vacacional.png'),
    file('a09', '09 - ¿Sabías qué  Oficinas Segula México.png'),
    file('a251', '25.1 - Sabías Qué  -  Información Documentada.png'),
    file('a25', '25 - Sabías qué - Contrato y Adendums.png'),
  ]);
  assert.deepEqual(out.map((e) => e.n), ['80', '79', '25.1', '25', '09']);
  assert.deepEqual(out[0], {
    n: '80',
    t: 'Prima Vacacional',
    h: 'https://drive.google.com/file/d/a80/view',
    img: 'https://lh3.googleusercontent.com/d/a80=w1600',
  });
});

test('copies of the same edition ("(1)", "(2)") appear once, the most recent upload', () => {
  const out = buildEditions([
    file('old', '49 - Sabías qué - Política de Calidad 2026 (1).png', '2026-11-05T10:00:00Z'),
    file('new', '49 - Sabías qué - Política de Calidad 2026 (2).png', '2026-11-05T11:00:00Z'),
  ]);
  assert.deepEqual(out.map((e) => e.h), ['https://drive.google.com/file/d/new/view']);
});

test('two different topics with the same number are both kept', () => {
  const out = buildEditions([file('c', '26 - ¿Sabías qué - Contrato y Adendums.png'), file('m', '26 - Sabías qué - MySkills .png')]);
  assert.deepEqual(out.map((e) => e.t).sort(), ['Contrato y Adendums', 'MySkills']);
});

test('files that do not follow the naming are skipped; malformed items do not throw', () => {
  const junk = [null, 7, {}, { id: 'x' }, file('n', 'notas.png'), file('ok', '80 Sabías Qué - Prima Vacacional.png')] as unknown as DriveFile[];
  assert.deepEqual(buildEditions(junk).map((e) => e.n), ['80']);
});

test('fetchSabiasList posts the key as text/plain and returns the files', async () => {
  let seen: { url: string; body: unknown; type: string | null } | null = null;
  const files = await fetchSabiasList('https://script.example/exec', 'KEY', async (url, init) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body)), type: new Headers(init?.headers).get('content-type') };
    return new Response(JSON.stringify({ ok: true, files: [file('a80', '80 Sabías Qué - Prima Vacacional.png')] }));
  });
  assert.deepEqual(seen, { url: 'https://script.example/exec', body: { action: 'sabias_list', key: 'KEY' }, type: 'text/plain;charset=utf-8' });
  assert.equal(files.length, 1);
});

test('fetchSabiasList throws on errors so the build falls back', async () => {
  await assert.rejects(fetchSabiasList('u', 'K', async () => new Response('{"ok":false,"error":"unauthorized"}')), /unauthorized/);
  await assert.rejects(fetchSabiasList('u', 'K', async () => new Response('x', { status: 500 })), /500/);
});

test('imageReachable: true only for a 200 image response; never throws', async () => {
  const ok = await imageReachable('https://img', async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }));
  const html = await imageReachable('https://img', async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  const denied = await imageReachable('https://img', async () => new Response('', { status: 403 }));
  const down = await imageReachable('https://img', async () => {
    throw new Error('network');
  });
  assert.deepEqual([ok, html, denied, down], [true, false, false, false]);
});
