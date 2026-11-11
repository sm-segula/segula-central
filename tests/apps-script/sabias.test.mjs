// sabias_list: lists the "¿Sabías qué?" Drive folder for the site build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, SECRET } from './harness.mjs';

const FOLDER = 'sabias-folder';
const FILES = [
  { id: 'img80', name: '80 Sabías Qué - Prima Vacacional.png', mime: 'image/png', created: '2026-11-05T16:20:04Z' },
  { id: 'img79', name: '79 Sabías Qué - Home Office Efectivo.png', mime: 'image/png', created: '2026-11-05T16:19:00Z' },
  { id: 'doc01', name: 'notas internas.gdoc', mime: 'application/vnd.google-apps.document', created: '2026-11-01T10:00:00Z' },
];
const opts = (over = {}) => ({ props: { SABIAS_FOLDER_ID: FOLDER }, folderFiles: { [FOLDER]: FILES }, ...over });
const list = (h, over = {}) => h.post({ action: 'sabias_list', key: SECRET, ...over });

test('sabias_list returns the images of the folder with id, name, type and creation date', () => {
  const h = load(opts());
  const r = list(h);
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.files)), [
    { id: 'img80', name: '80 Sabías Qué - Prima Vacacional.png', mime: 'image/png', created: '2026-11-05T16:20:04.000Z' },
    { id: 'img79', name: '79 Sabías Qué - Home Office Efectivo.png', mime: 'image/png', created: '2026-11-05T16:19:00.000Z' },
  ]);
});

test('sabias_list requires the shared key', () => {
  const h = load(opts());
  for (const key of ['nope', undefined, SECRET + 'x', 42]) assert.equal(list(h, { key }).error, 'unauthorized', String(key));
});

test('sabias_list without SABIAS_FOLDER_ID answers not_configured and logs it', () => {
  const h = load({ folderFiles: { [FOLDER]: FILES } });
  assert.equal(list(h).error, 'not_configured');
  assert.ok(h.state.errors.some((e) => e.includes('SABIAS_FOLDER_ID')));
});

test('sabias_list reports a Drive failure as server_error', () => {
  const h = load(opts());
  h.state.listFails = true;
  assert.equal(list(h).error, 'server_error');
});

test('sabias_list never touches the folio sequence or sends mail', () => {
  const h = load(opts());
  const before = JSON.stringify(h.state.propDump());
  list(h);
  assert.equal(JSON.stringify(h.state.propDump()), before);
  assert.equal(h.state.mails.length, 0);
});
