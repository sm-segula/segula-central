import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail } from '../../src/lib/auth/email.ts';

test('accepts and normalizes segulagrp.com addresses', () => {
  assert.equal(normalizeEmail('  Ana.Lopez+x@SEGULAGRP.com '), 'ana.lopez+x@segulagrp.com');
});

test('rejects other domains, lookalikes and subdomains', () => {
  for (const e of [
    'x@segulagrp.com.mx',
    'x@evil.com',
    'x@sub.segulagrp.com',
    'x@segulagrp.com.evil.com',
    'x@segulagrp.co',
    '@segulagrp.com',
    'x@@segulagrp.com',
    'a b@segulagrp.com',
    'x@segulagrp.com\nx@evil.com',
    '',
  ]) {
    assert.equal(normalizeEmail(e), null, e);
  }
});

test('rejects non-strings', () => {
  assert.equal(normalizeEmail(undefined), null);
  assert.equal(normalizeEmail(42), null);
});
