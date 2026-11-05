import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../../src/lib/auth/routes.ts';

test('safeNext keeps same-site relative paths', () => {
  assert.equal(safeNext('/segula-travel?a=1#x'), '/segula-travel?a=1#x');
  assert.equal(safeNext('/'), '/');
});

test('safeNext falls back to / for open-redirect attempts and junk', () => {
  for (const v of ['//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'javascript:alert(1)', 'evil', '', null, undefined, '/a\nb', '/login', '/login?next=/x', '/auth/me']) {
    assert.equal(safeNext(v as string), '/', String(v));
  }
});
