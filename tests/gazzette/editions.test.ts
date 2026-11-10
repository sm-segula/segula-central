import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFlipbooks, mergeEditions, parseTitle } from '../../src/lib/gazzette/editions.ts';
import type { Edition, Flipbook } from '../../src/lib/gazzette/editions.ts';

const STATIC: Edition[] = [
  { year: 2026, no: '07', month: 'Julio', id: '5f7969b4ab', cover: 'static-07', available: true },
  { year: 2026, no: '06', month: 'Junio', id: '0165baa695', cover: 'static-06', available: true },
  { year: 2025, no: '11', month: 'Noviembre', id: 'f1ee64fcc9', available: false },
];

const book = (id: string, title: string, date = '2026-08-03T10:00:00Z', thumb = `https://cdnm.heyzine.com/${id}.jpg`): Flipbook => ({
  id,
  date,
  title,
  links: { base: `https://heyzine.com/flip-book/${id}.html`, thumbnail: thumb },
});

test('parseTitle reads "Gazzette <Mes> <Año>" in any case and spacing', () => {
  assert.deepEqual(parseTitle('Gazzette Julio 2026'), { month: 'Julio', no: '07', year: 2026 });
  assert.deepEqual(parseTitle('gazzette  septiembre 2026'), { month: 'Septiembre', no: '09', year: 2026 });
  assert.deepEqual(parseTitle('Gazzette Diciembre 2025 '), { month: 'Diciembre', no: '12', year: 2025 });
  for (const t of ['Online Flipbook', 'Gazzette', 'Gazzette Juliembre 2026', 'Boletín Julio 2026', '']) {
    assert.equal(parseTitle(t), null, t);
  }
});

test('a new Gazzette from Heyzine becomes the latest, with its thumbnail as cover', () => {
  const out = mergeEditions(STATIC, [book('a1b2c3d4e5', 'Gazzette Agosto 2026')]);
  assert.deepEqual(out[0], {
    year: 2026,
    no: '08',
    month: 'Agosto',
    id: 'a1b2c3d4e5',
    cover: 'https://cdnm.heyzine.com/a1b2c3d4e5.jpg',
    available: true,
  });
  assert.deepEqual(out.map((e) => e.id), ['a1b2c3d4e5', '5f7969b4ab', '0165baa695', 'f1ee64fcc9']);
});

test('flipbooks that are not a Gazzette are ignored', () => {
  const out = mergeEditions(STATIC, [book('zzzzzzzzzz', 'Online Flipbook'), book('yyyyyyyyyy', 'Manual de bienvenida 2026')]);
  assert.deepEqual(out, STATIC);
});

test('an edition already in the static list keeps its static data (no duplicate, static cover wins)', () => {
  const out = mergeEditions(STATIC, [book('5f7969b4ab', 'Gazzette Julio 2026')]);
  assert.deepEqual(out, STATIC);
});

test('a static edition missing from Heyzine is NOT hidden (the list may be partial)', () => {
  const out = mergeEditions(STATIC, []);
  assert.deepEqual(out, STATIC);
});

test('a re-uploaded edition (same month, new id) replaces the unavailable static entry', () => {
  const out = mergeEditions(STATIC, [book('n3wn3wn3wn', 'Gazzette Noviembre 2025')]);
  const nov = out.filter((e) => e.year === 2025 && e.month === 'Noviembre');
  assert.equal(nov.length, 1);
  assert.equal(nov[0]!.id, 'n3wn3wn3wn');
  assert.equal(nov[0]!.available, true);
});

test('two Heyzine uploads for the same month keep the most recent upload', () => {
  const out = mergeEditions([], [book('oldoldold0', 'Gazzette Agosto 2026', '2026-08-01T00:00:00Z'), book('newnewnew0', 'Gazzette Agosto 2026', '2026-08-05T00:00:00Z')]);
  assert.deepEqual(out.map((e) => e.id), ['newnewnew0']);
});

test('malformed API items are skipped, not thrown', () => {
  const junk = [null, 42, {}, { id: 'x', title: 'Gazzette Agosto 2026' }, { id: 'bad id!', title: 'Gazzette Agosto 2026', links: { base: 'u', thumbnail: 't' } }] as unknown as Flipbook[];
  assert.deepEqual(mergeEditions(STATIC, junk), STATIC);
});

test('fetchFlipbooks sends the bearer key and returns the array', async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const list = await fetchFlipbooks('KEY123', async (url, init) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify([book('a1b2c3d4e5', 'Gazzette Agosto 2026')]), { status: 200 });
  });
  assert.deepEqual(calls, [{ url: 'https://heyzine.com/api1/flipbook-list', auth: 'Bearer KEY123' }]);
  assert.equal(list.length, 1);
});

test('fetchFlipbooks throws on HTTP errors and non-array bodies (caller falls back)', async () => {
  await assert.rejects(fetchFlipbooks('K', async () => new Response('nope', { status: 401 })), /401/);
  await assert.rejects(fetchFlipbooks('K', async () => new Response('{"success":false}', { status: 200 })), /array/);
});
