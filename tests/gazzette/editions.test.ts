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

// Real flipbook-list shape (observed 2026-11-10 with `npm run gazzette:check`):
// `id` is the PDF hash + ".pdf"; the flipbook id is in links.base (and is the
// first 10 characters of that hash).
const real = (hash: string, title: string, date: string, base = true): Flipbook => ({
  id: `${hash}.pdf`,
  date,
  title,
  links: {
    ...(base ? { base: `https://heyzine.com/flip-book/${hash.slice(0, 10)}.html` } : {}),
    thumbnail: `https://cdnm.heyzine.com/files/uploaded/v3/${hash}.pdf-thumb.jpg`,
  },
});

test('real API items: the flipbook id comes from links.base, not from the PDF hash', () => {
  const out = mergeEditions([], [real('ea70ddd7741ae27ed83d1498446b179db2bb5722', 'Gazzette Agosto 2026', '2026-08-03T16:39:04Z')]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'ea70ddd774');
  assert.equal(out[0]!.cover, 'https://cdnm.heyzine.com/files/uploaded/v3/ea70ddd7741ae27ed83d1498446b179db2bb5722.pdf-thumb.jpg');
});

test('without links.base the id falls back to the first 10 characters of the hash', () => {
  const out = mergeEditions([], [real('168fa5946861d31914e7de75da9eb9589e3f358f', 'Gazzette Octubre 2026', '2026-09-30T22:57:23Z', false)]);
  assert.equal(out[0]!.id, '168fa59468');
});

test('a real item for a static edition is not duplicated (same flipbook id)', () => {
  const out = mergeEditions(STATIC, [real('5f7969b4ab9e5b2a49867ab3ecc45a722ae55178', 'Gazzette Julio 2026', '2026-06-29T20:56:15Z')]);
  assert.deepEqual(out, STATIC);
});

test('a title without year takes it from the publication date', () => {
  const out = mergeEditions([], [real('683f2f7823dd8b60bbd26832fb23eaaefb9c8de7', 'Gazzette Noviembre', '2026-10-30T19:39:12Z')]);
  assert.deepEqual([out[0]!.month, out[0]!.no, out[0]!.year], ['Noviembre', '11', 2026]);
  const jan = mergeEditions([], [real('aaaaaaaaaa1111111111', 'Gazzette Enero', '2026-12-29T10:00:00Z')]);
  assert.deepEqual([jan[0]!.month, jan[0]!.year], ['Enero', 2027]);
  const none = mergeEditions([], [real('bbbbbbbbbb2222222222', 'Gazzette Enero', 'not a date')]);
  assert.deepEqual(none, []);
});

test('the observed account list puts Noviembre 2026 first', () => {
  const list = [
    real('683f2f7823dd8b60bbd26832fb23eaaefb9c8de7', 'Gazzette Noviembre', '2026-10-30T19:39:12Z'),
    real('168fa5946861d31914e7de75da9eb9589e3f358f', 'Gazzette Octubre 2026', '2026-09-30T22:57:23Z'),
    real('d7c908a75ad4b8af6b58ac32ab81726a8cd14b88', 'Gazzette Septiembre 2026', '2026-08-27T22:41:57Z'),
    real('ea70ddd7741ae27ed83d1498446b179db2bb5722', 'Gazzette Agosto 2026', '2026-08-03T16:39:04Z'),
    real('5f7969b4ab9e5b2a49867ab3ecc45a722ae55178', 'Gazzette Julio 2026', '2026-06-29T20:56:15Z'),
  ];
  const out = mergeEditions(STATIC, list);
  assert.deepEqual(out.map((e) => `${e.month} ${e.year}`), ['Noviembre 2026', 'Octubre 2026', 'Septiembre 2026', 'Agosto 2026', 'Julio 2026', 'Junio 2026', 'Noviembre 2025']);
  assert.equal(out[0]!.id, '683f2f7823');
});
