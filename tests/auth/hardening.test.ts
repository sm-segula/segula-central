// Regression tests for the independent verifier's findings (T4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicPath, safeNext } from '../../src/lib/auth/routes.ts';
import { env, stubDeps, sessionCookie, get, handle } from './helpers.ts';

test('a signed-in user with a non-ASCII next is sent to "/" instead of crashing', async () => {
  const { deps } = stubDeps();
  for (const next of ['/€', '/café', '/中']) {
    const res = (await handle(
      get(`/login?next=${encodeURIComponent(next)}`, { cookie: sessionCookie(), accept: 'text/html' }),
      env,
      deps,
    )) as Response;
    assert.equal(res.status, 302, next);
    assert.equal(res.headers.get('location'), '/', next);
  }
  assert.equal(safeNext('/café'), '/');
  assert.equal(safeNext('/recursos-humanos/directorio?q=ana'), '/recursos-humanos/directorio?q=ana');
});

test('encoded or parameter tricks never make a protected file public', () => {
  for (const p of [
    '/_astro/x.webp%3F.js',
    '/_astro/x.webp%2f.js',
    '/_astro/x.webp%00.js',
    '/_astro/x.webp;.js',
    '/_astro/..%2fassets/directorio/a.webp.js',
    '/assets/directorio/a.webp.woff',
    '/assets/directorio/a.webp.woff2',
  ]) {
    assert.equal(isPublicPath(p), false, p);
  }
});

test('the login page assets stay public', () => {
  for (const p of ['/login', '/favicon.svg', '/_astro/Login.Bx9_a-1.js', '/_astro/global.C1d-2.css', '/_astro/inter.Ab12.woff2']) {
    assert.equal(isPublicPath(p), true, p);
  }
});

test('protected paths without a session are still gated after the hardening', async () => {
  const { deps } = stubDeps();
  const res = (await handle(get('/_astro/x.webp%3F.js'), env, deps)) as Response;
  assert.equal(res.status, 401);
});
