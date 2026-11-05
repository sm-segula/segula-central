import test from 'node:test';
import assert from 'node:assert/strict';
import { load, makeSheet, makeTicket, validTicket, nowSec, SECRET, HEADERS, PDF_B64 } from './harness.mjs';

const ANA = 'ana@segulagrp.com';
const plain = (a) => JSON.parse(JSON.stringify(a));
const FOLIO_RE = /^STRA-VJ-2026-\d{6}$/;

// ---- ticket verification (through reserve) ----

test('reserve with a valid ticket issues a folio for the ticket email', () => {
  const h = load();
  const r = h.post({ action: 'reserve', ticket: validTicket(h) });
  assert.equal(r.ok, true);
  assert.match(r.folio, FOLIO_RE);
  assert.equal(h.state.sheet.data[1][2], ANA);
});

test('reserve ignores any email in the body', () => {
  const h = load();
  const r = h.post({ action: 'reserve', ticket: validTicket(h), email: 'intruso@segulagrp.com' });
  assert.equal(r.ok, true);
  assert.equal(h.state.sheet.data[1][2], ANA);
});

test('reserve without ticket, or with only an email, is unauthorized and burns no number', () => {
  const h = load();
  assert.equal(h.post({ action: 'reserve', email: ANA }).error, 'unauthorized');
  assert.equal(h.post({ action: 'reserve' }).error, 'unauthorized');
  assert.equal(h.post({ action: 'reserve', ticket: 42 }).error, 'unauthorized');
  assert.equal(h.state.props.get('seq-2026'), undefined);
});

test('tickets: expired, tampered, wrong secret, wrong domain, malformed are unauthorized', () => {
  const h = load();
  const ok = validTicket(h);
  const [p, s] = ok.split('.');
  const other = Buffer.from(JSON.stringify({ email: 'mallory@segulagrp.com', exp: nowSec(h) + 900 })).toString('base64url');
  const cases = {
    expired: makeTicket(ANA, nowSec(h) - 1),
    'exp == now': makeTicket(ANA, nowSec(h)),
    'wrong secret': makeTicket(ANA, nowSec(h) + 900, 'other-secret'),
    'tampered payload': other + '.' + s,
    'tampered sig': p + '.' + s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA'),
    'wrong domain': makeTicket('a@gmail.com', nowSec(h) + 900),
    'uppercase email': makeTicket('ANA@segulagrp.com', nowSec(h) + 900),
    'exp as string': makeTicket(ANA, String(nowSec(h) + 900)),
    'no exp': makeTicket(ANA, undefined),
    'no dot': p,
    'three parts': ok + '.x',
    empty: '',
    'empty sig': p + '.',
    'padded sig': ok + '=',
    'std base64 chars': validTicket(h, ANA, { pad: '???????' }).replace(/_/g, '/'),
  };
  for (const [name, t] of Object.entries(cases)) {
    assert.equal(h.post({ action: 'reserve', ticket: t }).error, 'unauthorized', name);
  }
  assert.equal(h.state.props.get('seq-2026'), undefined);
});

test('tickets verify for every base64 padding length', () => {
  const h = load();
  for (let i = 0; i < 6; i++) {
    const t = validTicket(h, ANA, { pad: 'x'.repeat(i) });
    assert.ok(!t.includes('='));
    assert.equal(h.post({ action: 'reserve', ticket: t }).ok, true, 'pad ' + i);
  }
});

test('a ticket becomes invalid once it expires', () => {
  const h = load();
  const t = validTicket(h);
  assert.equal(h.post({ action: 'reserve', ticket: t }).ok, true);
  h.clock.now += 901 * 1000;
  assert.equal(h.post({ action: 'reserve', ticket: t }).error, 'unauthorized');
});

// ---- retired and unknown actions ----

test('old and unknown actions are bad_request and never reserve', () => {
  const h = load();
  const t = validTicket(h);
  for (const action of ['downloaded', 'archive', 'nope', '', undefined]) {
    assert.equal(h.post({ action, ticket: t, email: ANA, folio: 'STRA-VJ-2026-000001', pdf: PDF_B64 }).error, 'bad_request', String(action));
  }
  assert.equal(h.state.props.get('seq-2026'), undefined);
  assert.equal(h.state.sheet.data.length, 1);
});

test('bad JSON or non-object body is bad_request', () => {
  const h = load();
  assert.equal(h.post('{nope').error, 'bad_request');
  assert.equal(h.post('null').error, 'bad_request');
  assert.equal(h.post({}).error, 'bad_request');
});

// ---- pre-existing behavior still holds ----

test('folio format and sequence: STRA-VJ-<year>-<6 digits>, increments, never repeats', () => {
  const h = load();
  const t = validTicket(h);
  assert.equal(h.post({ action: 'reserve', ticket: t }).folio, 'STRA-VJ-2026-000001');
  assert.equal(h.post({ action: 'reserve', ticket: t }).folio, 'STRA-VJ-2026-000002');
  assert.equal(h.state.props.get('seq-2026'), '2');
  h.state.sheet.data.length = 1; // deleting rows does not reuse numbers
  assert.equal(h.post({ action: 'reserve', ticket: t }).folio, 'STRA-VJ-2026-000003');
  h.clock.now = Date.UTC(2027, 0, 5);
  assert.equal(h.post({ action: 'reserve', ticket: validTicket(h) }).folio, 'STRA-VJ-2027-000001');
});

test('reserve: busy lock, corrupt counter and exhausted counter are rejected without advancing', () => {
  const h = load();
  const t = validTicket(h);
  h.state.lockBusy = true;
  assert.equal(h.post({ action: 'reserve', ticket: t }).error, 'busy');
  h.state.lockBusy = false;
  h.state.props.set('seq-2026', 'abc');
  assert.equal(h.post({ action: 'reserve', ticket: t }).error, 'server_error');
  h.state.props.set('seq-2026', '999999');
  assert.equal(h.post({ action: 'reserve', ticket: t }).error, 'server_error');
});

test('sheet header migration: creates, inserts above a folio row, upgrades old header, keeps data', () => {
  const t = (h) => validTicket(h);
  let h = load({ sheet: null });
  assert.equal(h.post({ action: 'reserve', ticket: t(h) }).ok, true);
  assert.deepEqual(plain(h.state.sheet.data[0]), HEADERS);

  h = load({ sheet: makeSheet([['STRA-VJ-2026-000009', new Date(0), 'x@segulagrp.com', '']]) });
  h.state.props.set('seq-2026', '9');
  assert.equal(h.post({ action: 'reserve', ticket: t(h) }).folio, 'STRA-VJ-2026-000010');
  assert.deepEqual(plain(h.state.sheet.data[0]), HEADERS);
  assert.equal(h.state.sheet.data[1][0], 'STRA-VJ-2026-000009');

  h = load({ sheet: makeSheet([['Folio', 'Emitido', 'Correo'], ['STRA-VJ-2026-000001', new Date(0), 'x@segulagrp.com']]) });
  assert.equal(h.post({ action: 'reserve', ticket: t(h) }).ok, true);
  assert.deepEqual(plain(h.state.sheet.data[0]), HEADERS);
  assert.equal(h.state.sheet.data[1][2], 'x@segulagrp.com');

  h = load({ sheet: makeSheet([['Mi tabla', 'otra']]) });
  h.post({ action: 'reserve', ticket: t(h) });
  assert.deepEqual(plain(h.state.sheet.data[0].slice(0, 2)), ['Mi tabla', 'otra']);
});

// ---- deliver ----

function reserved(h, email = ANA) {
  return h.post({ action: 'reserve', ticket: validTicket(h, email) }).folio;
}
const deliver = (h, over = {}) => h.post({ action: 'deliver', ticket: validTicket(h), pdf: PDF_B64, ...over });

test('deliver emails the PDF to the ticket email, fills Descargado, stores one Drive copy', () => {
  const h = load();
  const folio = reserved(h);
  assert.deepEqual(deliver(h, { folio }), { ok: true });
  assert.equal(h.state.mails.length, 1);
  const m = h.state.mails[0];
  assert.equal(m.to, ANA);
  assert.equal(m.name, 'SEGULA Central');
  assert.ok(m.subject.includes(folio));
  assert.ok(m.body.includes(folio));
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].getName(), folio + '.pdf');
  assert.equal(m.attachments[0].getContentType(), 'application/pdf');
  const row = h.state.sheet.data[1];
  assert.ok(row[3] instanceof Date);
  assert.equal(h.state.files.length, 1);
  assert.equal(h.state.files[0].blob.getName(), folio + '.pdf');
  assert.equal(row[4], 'https://drive.example/' + folio + '.pdf');
});

test('deliver sends to the ticket email, not a body email, and only for its own folio', () => {
  const h = load();
  const folio = reserved(h);
  assert.equal(deliver(h, { folio, email: 'intruso@segulagrp.com' }).ok, true);
  assert.equal(h.state.mails[0].to, ANA);
  const h2 = load();
  const f2 = reserved(h2, 'otro@segulagrp.com');
  assert.equal(deliver(h2, { folio: f2 }).error, 'not_found');
  assert.equal(h2.state.mails.length, 0);
  assert.equal(h2.state.sheet.data[1][3], '');
});

test('deliver keeps the first Descargado time and one Drive copy on repeat', () => {
  const h = load();
  const folio = reserved(h);
  deliver(h, { folio });
  const first = h.state.sheet.data[1][3];
  h.clock.now += 3600 * 1000;
  assert.equal(deliver(h, { folio }).ok, true);
  assert.equal(h.state.sheet.data[1][3], first);
  assert.equal(h.state.files.length, 1);
  assert.equal(h.state.mails.length, 2);
});

test('deliver validation: unauthorized, bad folio, bad pdf, too large, not_found', () => {
  const h = load();
  const folio = reserved(h);
  assert.equal(h.post({ action: 'deliver', pdf: PDF_B64, folio }).error, 'unauthorized');
  assert.equal(deliver(h, { folio: 'nope' }).error, 'bad_request');
  assert.equal(deliver(h, { folio, pdf: undefined }).error, 'bad_request');
  assert.equal(deliver(h, { folio, pdf: '' }).error, 'bad_request');
  assert.equal(deliver(h, { folio, pdf: '***' }).error, 'bad_request');
  assert.equal(deliver(h, { folio, pdf: Buffer.from('not a pdf at all').toString('base64') }).error, 'bad_request');
  assert.equal(deliver(h, { folio, pdf: 'A'.repeat(Math.ceil((20 * 1024 * 1024) / 3) * 4 + 4) }).error, 'too_large');
  assert.equal(deliver(h, { folio: 'STRA-VJ-2026-000999' }).error, 'not_found');
  assert.equal(h.state.mails.length, 0);
  assert.equal(h.state.sheet.data[1][3], '');
});

test('deliver: mail failure is server_error, no Descargado, no Drive copy', () => {
  const h = load();
  const folio = reserved(h);
  h.state.mailFail = true;
  assert.equal(deliver(h, { folio }).error, 'server_error');
  assert.equal(h.state.sheet.data[1][3], '');
  assert.equal(h.state.files.length, 0);
  assert.ok(h.state.errors.length > 0);
  h.state.mailFail = false;
  assert.equal(deliver(h, { folio }).ok, true); // retry works
});

test('deliver: Drive copy failure is logged only and the response stays ok', () => {
  const h = load();
  const folio = reserved(h);
  h.state.createFileFails = true;
  assert.deepEqual(deliver(h, { folio }), { ok: true });
  assert.equal(h.state.mails.length, 1);
  assert.ok(h.state.sheet.data[1][3] instanceof Date);
  assert.equal(h.state.sheet.data[1][4] || '', '');
  assert.ok(h.state.errors.some((e) => e.includes(folio)));
});

test('deliver: missing DRIVE_FOLDER_ID still sends the email', () => {
  const h = load({ folderId: null });
  const folio = reserved(h);
  assert.deepEqual(deliver(h, { folio }), { ok: true });
  assert.equal(h.state.files.length, 0);
  assert.equal(h.state.mails.length, 1);
});

test('deliver: a lost claim on the Archivo cell trashes the new file, never a linked one', () => {
  const h = load();
  const folio = reserved(h);
  deliver(h, { folio });
  const linked = h.state.files[0];
  deliver(h, { folio });
  assert.equal(linked.trashed, false);
  assert.equal(h.state.files.length, 1);
});

test('checkSetup requires AUTH_SHARED_SECRET and logs the mail quota', () => {
  let h = load({ secret: null });
  assert.throws(() => h.ctx.checkSetup(), /AUTH_SHARED_SECRET/);
  h = load();
  h.ctx.checkSetup();
  assert.ok(h.state.logs.some((l) => l.includes('100')));
});
