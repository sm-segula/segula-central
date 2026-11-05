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

test('5 wrong attempts per email (across codes) lock the email for 24 h', () => {
  const h = load();
  req(h);
  const wrong1 = lastCode(h) === '000000' ? '000001' : '000000';
  for (let i = 0; i < 3; i++) assert.equal(ver(h, wrong1).error, 'invalid_code', 'attempt ' + i);
  h.clock.now += 61 * 1000;
  assert.equal(req(h).ok, true); // a new code does not reset the count
  const code = lastCode(h);
  const wrong2 = code === '000000' ? '000001' : '000000';
  assert.equal(ver(h, wrong2).error, 'invalid_code', 'attempt 3');
  assert.equal(ver(h, wrong2).error, 'too_many_attempts', 'attempt 4');
  // Locked: even the right code fails, and no new code is mailed.
  assert.equal(ver(h, code).error, 'too_many_attempts');
  const mails = h.state.mails.length;
  h.clock.now += 61 * 1000;
  assert.equal(req(h).error, 'too_many_attempts');
  assert.equal(h.state.mails.length, mails);
  // Still locked just before 24 h, free after.
  h.clock.now += 24 * 3600 * 1000 - 2 * 61 * 1000;
  assert.equal(req(h).error, 'too_many_attempts');
  h.clock.now += 2 * 61 * 1000;
  assert.equal(req(h).ok, true);
  assert.deepEqual(ver(h, lastCode(h)), { ok: true });
});

test('the lock is per email: other emails keep working', () => {
  const h = load();
  req(h);
  const wrong = lastCode(h) === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) ver(h, wrong);
  assert.equal(req(h, { email: 'otro@segulagrp.com' }).ok, true);
  assert.deepEqual(ver(h, lastCode(h), { email: 'otro@segulagrp.com' }), { ok: true });
});

test('a successful login resets the failure count', () => {
  const h = load();
  req(h);
  const wrong = lastCode(h) === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) ver(h, wrong);
  assert.deepEqual(ver(h, lastCode(h)), { ok: true });
  h.clock.now += 61 * 1000;
  req(h);
  const wrong2 = lastCode(h) === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) assert.equal(ver(h, wrong2).error, 'invalid_code', 'after reset ' + i);
});

test('verifying without a pending code never counts and never stores anything', () => {
  const h = load();
  for (let i = 0; i < 10; i++) assert.equal(ver(h, '123456').error, 'expired');
  assert.equal(h.state.propKeys().filter((k) => k.startsWith('fail-')).length, 0);
  assert.equal(req(h).ok, true);
});

test('the lock stores no plain email and expired locks are pruned', () => {
  const h = load();
  const lock = (email) => {
    req(h, { email });
    const wrong = lastCode(h) === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) ver(h, wrong, { email });
  };
  lock(EMAIL);
  const keys = h.state.propKeys().filter((k) => k.startsWith('fail-'));
  assert.equal(keys.length, 1);
  assert.ok(!JSON.stringify(h.state.propDump()).includes('ana'));
  h.clock.now += 25 * 3600 * 1000;
  lock('otro@segulagrp.com');
  assert.deepEqual(h.state.propKeys().filter((k) => k.startsWith('fail-')).length, 1);
  assert.notEqual(h.state.propKeys().find((k) => k.startsWith('fail-')), keys[0]);
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

// Verifier B1 (e87abd3): each failure expires 24 h after it happened (sliding
// window), not all together when the first one turns 24 h old.
test('failures expire one by one: 4 recent failures plus 1 more still lock', () => {
  const h = load();
  const DAY = 24 * 3600 * 1000;
  const t0 = h.clock.now;
  req(h);
  const w = (c) => (c === '000000' ? '000001' : '000000');
  assert.equal(ver(h, w(lastCode(h))).error, 'invalid_code'); // failure 1 at T0
  h.clock.now = t0 + DAY - 90 * 1000;
  req(h);
  for (let i = 0; i < 3; i++) assert.equal(ver(h, w(lastCode(h))).error, 'invalid_code'); // failures 2-4
  h.clock.now = t0 + DAY; // failure 1 is now 24 h old and drops out
  assert.equal(ver(h, w(lastCode(h))).error, 'invalid_code'); // 4 within 24 h
  assert.equal(ver(h, w(lastCode(h))).error, 'too_many_attempts'); // 5 within 24 h
});

test('a corrupted failure entry is treated as missing and counting still works', () => {
  for (const bad of ['5', '"x"', '[]', 'true', '{"n":"a"}', '{bad']) {
    const h = load();
    req(h);
    const id = [...h.state.cacheData.keys()].find((k) => k.startsWith('otp-')).slice(4);
    h.state.props.set('fail-' + id, bad);
    const wrong = lastCode(h) === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i++) assert.equal(ver(h, wrong).error, 'invalid_code', bad + ' #' + i);
    assert.equal(ver(h, wrong).error, 'too_many_attempts', bad);
  }
});
