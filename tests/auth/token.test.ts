import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../../src/lib/auth/token.ts';

const SECRET = 'a-secret';
const NOW = 1_800_000_000;

test('roundtrip returns the payload', () => {
  const t = signToken({ email: 'a@segulagrp.com', exp: NOW + 60 }, SECRET);
  assert.deepEqual(verifyToken(t, SECRET, NOW), { email: 'a@segulagrp.com', exp: NOW + 60 });
});

test('base64url has no padding or unsafe characters on both parts', () => {
  for (let i = 0; i < 50; i++) {
    const t = signToken({ email: `u${'x'.repeat(i)}@segulagrp.com`, exp: NOW + i }, SECRET);
    assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  }
});

test('wrong secret is rejected', () => {
  const t = signToken({ email: 'a@segulagrp.com', exp: NOW + 60 }, SECRET);
  assert.equal(verifyToken(t, 'other', NOW), null);
});

test('tampered payload or signature is rejected', () => {
  const t = signToken({ email: 'a@segulagrp.com', exp: NOW + 60 }, SECRET);
  const [p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'boss@segulagrp.com', exp: NOW + 60 })).toString('base64url');
  assert.equal(verifyToken(`${forged}.${s}`, SECRET, NOW), null);
  assert.equal(verifyToken(`${p}.${s!.slice(0, -2)}AA`, SECRET, NOW), null);
});

test('expired token is rejected (exp <= now)', () => {
  const t = signToken({ email: 'a@segulagrp.com', exp: NOW }, SECRET);
  assert.equal(verifyToken(t, SECRET, NOW), null);
  assert.equal(verifyToken(t, SECRET, NOW - 1)?.email, 'a@segulagrp.com');
});

test('malformed tokens are rejected', () => {
  for (const t of ['', 'abc', 'a.b.c', '.', 'a.', '.b', 'not base64.sig', undefined as unknown as string]) {
    assert.equal(verifyToken(t, SECRET, NOW), null);
  }
});

test('payload with wrong shape is rejected even when correctly signed', () => {
  const bad = signToken({ email: 5, exp: 'x' } as never, SECRET);
  assert.equal(verifyToken(bad, SECRET, NOW), null);
});
