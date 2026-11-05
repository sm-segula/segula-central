import test from 'node:test';
import assert from 'node:assert/strict';
import { load, SECRET, lastCode } from './harness.mjs';

const EMAIL = 'ana.perez@segulagrp.com';
const req = (h, over = {}) => h.post({ action: 'otp_request', key: SECRET, email: EMAIL, ...over });
const ver = (h, code, over = {}) => h.post({ action: 'otp_verify', key: SECRET, email: EMAIL, code, ...over });

test('missing AUTH_SHARED_SECRET fails closed on every action', () => {
  const h = load({ secret: null });
  for (const action of ['otp_request', 'otp_verify', 'reserve', 'deliver', 'whatever']) {
    assert.deepEqual(h.post({ action, key: SECRET, email: EMAIL }), { ok: false, error: 'not_configured' });
  }
  assert.ok(h.state.errors.some((e) => e.includes('AUTH_SHARED_SECRET')));
  assert.equal(h.state.mails.length, 0);
});

test('otp_request rejects a wrong, missing or non-string key', () => {
  const h = load();
  assert.equal(req(h, { key: 'nope' }).error, 'unauthorized');
  assert.equal(req(h, { key: undefined }).error, 'unauthorized');
  assert.equal(req(h, { key: SECRET + 'x' }).error, 'unauthorized');
  assert.equal(req(h, { key: 123 }).error, 'unauthorized');
  assert.equal(h.state.mails.length, 0);
});

test('otp_request rejects emails outside segulagrp.com', () => {
  const h = load();
  for (const email of ['a@gmail.com', 'a@segulagrp.com.evil.com', 'a@evilsegulagrp.com', '', undefined, 'a b@segulagrp.com', '@segulagrp.com']) {
    assert.equal(req(h, { email }).error, 'invalid_email', String(email));
  }
  assert.equal(h.state.mails.length, 0);
});

test('otp_request normalizes the email and sends a 6-digit code in Spanish from "SEGULA Central"', () => {
  const h = load();
  assert.deepEqual(req(h, { email: '  Ana.Perez@SEGULAGRP.com ' }), { ok: true });
  assert.equal(h.state.mails.length, 1);
  const m = h.state.mails[0];
  assert.equal(m.to, EMAIL);
  assert.equal(m.name, 'SEGULA Central');
  assert.match(m.body, /\b\d{6}\b/);
  assert.match(m.htmlBody, /\b\d{6}\b/);
  assert.match(m.body, /10 minutos/);
  assert.match(m.body, /ignora|ignore/i);
  assert.ok(m.subject.length > 0);
});

test('the cache never holds the plain code, only a hash', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  assert.ok(h.state.cacheData.size >= 1);
  for (const [k, e] of h.state.cacheData) {
    assert.ok(!k.includes(code) || k.length > 20);
    assert.ok(!e.value.includes(code), 'plain code stored: ' + e.value);
    assert.ok(!k.includes(EMAIL) && !e.value.includes(EMAIL), 'plain email stored');
  }
  const ttls = [...h.state.cacheData.values()].map((e) => e.expires - h.clock.now);
  assert.ok(ttls.includes(600 * 1000));
});

test('the correct code verifies once and is consumed', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  assert.deepEqual(ver(h, code), { ok: true });
  assert.equal(ver(h, code).error, 'expired');
});

test('verify normalizes the email and rejects bad key or domain', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  assert.equal(ver(h, code, { key: 'bad' }).error, 'unauthorized');
  assert.equal(ver(h, code, { email: 'ana.perez@gmail.com' }).error, 'invalid_email');
  assert.equal(ver(h, code, { email: ' ANA.PEREZ@segulagrp.com ' }).ok, true);
});

test('verify without a pending code returns expired', () => {
  const h = load();
  assert.equal(ver(h, '123456').error, 'expired');
});

test('a code expires after 10 minutes', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  h.clock.now += 601 * 1000;
  assert.equal(ver(h, code).error, 'expired');
});

test('a wrong code returns invalid_code and the right one still works afterwards', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  const wrong = code === '000000' ? '000001' : '000000';
  assert.equal(ver(h, wrong).error, 'invalid_code');
  assert.equal(ver(h, '12345').error, 'invalid_code');
  assert.equal(ver(h, undefined).error, 'invalid_code');
  assert.deepEqual(ver(h, code), { ok: true });
});

test('5 wrong attempts remove the code, even the right one then fails', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) assert.equal(ver(h, wrong).error, 'invalid_code', 'attempt ' + i);
  assert.equal(ver(h, wrong).error, 'too_many_attempts', 'attempt 4');
  assert.equal(ver(h, code).error, 'expired');
  h.clock.now += 61 * 1000;
  req(h);
  assert.deepEqual(ver(h, lastCode(h)), { ok: true });
});

test('an entry already at 5 attempts answers too_many_attempts and is removed', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  for (const [k, e] of h.state.cacheData) {
    if (!k.startsWith('otp-')) continue;
    const o = JSON.parse(e.value);
    {
      o.a = 5;
      e.value = JSON.stringify(o);
    }
  }
  assert.equal(ver(h, code).error, 'too_many_attempts');
  assert.equal(ver(h, code).error, 'expired');
});

test('attempts persist across calls (race-free read-modify-write under the lock)', () => {
  const h = load();
  req(h);
  const code = lastCode(h);
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) ver(h, wrong);
  assert.equal(ver(h, wrong).error, 'too_many_attempts'); // 5th wrong: locked out, entry removed
  assert.equal(ver(h, code).error, 'expired');
});

test('60 s cooldown per email, other emails unaffected', () => {
  const h = load();
  assert.equal(req(h).ok, true);
  assert.equal(req(h).error, 'cooldown');
  assert.equal(h.state.mails.length, 1);
  assert.equal(req(h, { email: 'otro@segulagrp.com' }).ok, true);
  h.clock.now += 61 * 1000;
  assert.equal(req(h).ok, true);
  assert.equal(h.state.mails.length, 3);
});

test('a new code replaces the previous one', () => {
  const h = load();
  req(h);
  const first = lastCode(h);
  h.clock.now += 61 * 1000;
  req(h);
  const second = lastCode(h);
  if (first !== second) assert.equal(ver(h, first).error, 'invalid_code');
  assert.deepEqual(ver(h, second), { ok: true });
});

test('mail failure returns server_error, logs, and leaves no code behind', () => {
  const h = load();
  h.state.mailFail = true;
  assert.equal(req(h).error, 'server_error');
  assert.ok(h.state.errors.length > 0);
  assert.equal(h.state.cacheData.size, 0);
  h.state.mailFail = false;
  assert.equal(req(h).ok, true); // no cooldown left from the failed attempt
});

test('lock failure returns busy for request and verify', () => {
  const h = load();
  h.state.lockBusy = true;
  assert.equal(req(h).error, 'busy');
  assert.equal(ver(h, '123456').error, 'busy');
  assert.equal(h.state.mails.length, 0);
});

test('codes come from Utilities.getUuid, never Math.random', () => {
  const h = load();
  h.ctx.Math = Object.assign(Object.create(Math), {
    random: () => {
      throw new Error('Math.random used');
    },
  });
  assert.equal(req(h).ok, true);
});

test('codes are 6 digits with leading zeros preserved', () => {
  const h = load();
  h.ctx.Utilities.getUuid = () => '00000000-0000-0000-0000-000000000000';
  req(h);
  assert.equal(lastCode(h), '000000');
  assert.deepEqual(ver(h, '000000'), { ok: true });
});
