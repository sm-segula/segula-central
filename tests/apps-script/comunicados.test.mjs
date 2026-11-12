// comunicados_list: lists the Comunicados Drive folder for the site build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, SECRET } from './harness.mjs';

const FOLDER = 'comunicados-folder';
const SABIAS = 'sabias-folder';
const FILES = [
  { id: 'pdf1', name: '2026-11-10 - Cierre de incidencias · Noviembre.pdf', mime: 'application/pdf', created: '2026-11-10T16:20:04Z' },
  { id: 'png1', name: 'Aviso Pluxee.png', mime: 'image/png', created: '2026-11-03T10:00:00Z' },
  { id: 'doc1', name: 'borrador.gdoc', mime: 'application/vnd.google-apps.document', created: '2026-11-01T10:00:00Z' },
];
const opts = (over = {}) => ({
  props: { COMUNICADOS_FOLDER_ID: FOLDER, SABIAS_FOLDER_ID: SABIAS },
  folderFiles: { [FOLDER]: FILES, [SABIAS]: [{ id: 's80', name: '80 Sabías Qué - X.png', mime: 'image/png', created: '2026-11-05T16:20:04Z' }] },
  ...over,
});
const list = (h, over = {}) => h.post({ action: 'comunicados_list', key: SECRET, ...over });

test('comunicados_list returns the PDFs and images of its own folder', () => {
  const r = list(load(opts()));
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.files)), [
    { id: 'pdf1', name: '2026-11-10 - Cierre de incidencias · Noviembre.pdf', mime: 'application/pdf', created: '2026-11-10T16:20:04.000Z' },
    { id: 'png1', name: 'Aviso Pluxee.png', mime: 'image/png', created: '2026-11-03T10:00:00.000Z' },
  ]);
});

test('comunicados_list requires the shared key', () => {
  const h = load(opts());
  for (const key of ['nope', undefined, SECRET + 'x', 42]) assert.equal(list(h, { key }).error, 'unauthorized', String(key));
});

test('comunicados_list without COMUNICADOS_FOLDER_ID answers not_configured and logs it', () => {
  const h = load({ props: { SABIAS_FOLDER_ID: SABIAS }, folderFiles: opts().folderFiles });
  assert.equal(list(h).error, 'not_configured');
  assert.ok(h.state.errors.some((e) => e.includes('COMUNICADOS_FOLDER_ID')));
});

test('comunicados_list reports a Drive failure as server_error', () => {
  const h = load(opts());
  h.state.listFails = true;
  assert.equal(list(h).error, 'server_error');
});

test('comunicados_list is read-only: no property change, no mail', () => {
  const h = load(opts());
  const before = JSON.stringify(h.state.propDump());
  list(h);
  assert.equal(JSON.stringify(h.state.propDump()), before);
  assert.equal(h.state.mails.length, 0);
});

test('sabias_list still lists only the Sabías qué folder', () => {
  const r = load(opts()).post({ action: 'sabias_list', key: SECRET });
  assert.deepEqual(r.files.map((f) => f.id), ['s80']);
});
