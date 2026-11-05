// Per-email cap on codes (verifier advisory T4-1): limits OTP guessing across codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, SECRET } from './harness.mjs';

const EMAIL = 'ana@segulagrp.com';
const ask = (h, email = EMAIL) => h.post({ action: 'otp_request', key: SECRET, email });

test('at most 8 codes per email every 6 hours; other emails unaffected; the window resets', () => {
  const h = load();
  for (let i = 0; i < 8; i++) {
    assert.equal(ask(h).ok, true, 'code ' + (i + 1));
    h.clock.now += 61 * 1000;
  }
  assert.equal(ask(h).error, 'cooldown');
  assert.equal(h.state.mails.length, 8);
  assert.equal(ask(h, 'otro@segulagrp.com').ok, true);
  h.clock.now += 6 * 3600 * 1000;
  assert.equal(ask(h).ok, true);
});

test('a failed mail does not count against the cap', () => {
  const h = load();
  h.state.mailFail = true;
  for (let i = 0; i < 10; i++) assert.equal(ask(h).error, 'server_error');
  h.state.mailFail = false;
  assert.equal(ask(h).ok, true);
});
