import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, env, get, post, stubDeps, sessionCookie, AUTH_SHARED_SECRET, SESSION_SECRET, SCRIPT_URL, NOW_S } from './helpers.ts';
import { verifyToken } from '../../src/lib/auth/token.ts';

async function json(res: Response | null) {
  assert.ok(res, 'expected a response');
  return res.json() as Promise<Record<string, unknown>>;
}

// ---- /auth/request ----
test('request: forwards to Apps Script with key and normalized email', async () => {
  const { deps, calls } = stubDeps({ ok: true });
  const res = await handle(post('/auth/request', { email: ' ANA@segulagrp.com ' }), env, deps);
  assert.equal(res!.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, SCRIPT_URL);
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(calls[0]!.init.redirect, 'follow');
  assert.match(String((calls[0]!.init.headers as Record<string, string>)['content-type']), /^text\/plain;charset=utf-8$/i);
  assert.deepEqual(calls[0]!.body, { action: 'otp_request', key: AUTH_SHARED_SECRET, email: 'ana@segulagrp.com' });
  assert.ok(calls[0]!.init.signal);
});

test('request: rejects bad domain without calling Apps Script', async () => {
  const { deps, calls } = stubDeps();
  const res = await handle(post('/auth/request', { email: 'x@evil.com' }), env, deps);
  assert.equal(res!.status, 400);
  assert.deepEqual(await json(res), { ok: false, error: 'invalid_email' });
  assert.equal(calls.length, 0);
});

test('request: cooldown and busy pass through, other errors become generic and never leak the key', async () => {
  for (const [err, status, expected] of [
    ['cooldown', 429, 'cooldown'],
    ['busy', 503, 'busy'],
    ['unauthorized', 502, 'server_error'],
    ['server_error', 502, 'server_error'],
    ['weird', 502, 'server_error'],
  ] as const) {
    const { deps } = stubDeps({ ok: false, error: err });
    const res = await handle(post('/auth/request', { email: 'a@segulagrp.com' }), env, deps);
    assert.equal(res!.status, status, err);
    const text = JSON.stringify(await json(res));
    assert.equal(JSON.parse(text).error, expected);
    assert.ok(!text.includes(AUTH_SHARED_SECRET));
  }
});

test('request: Apps Script network failure, timeout and non-JSON are generic errors', async () => {
  for (const reply of [new Error('boom'), 'not json <html>']) {
    const { deps } = stubDeps(reply);
    const res = await handle(post('/auth/request', { email: 'a@segulagrp.com' }), env, deps);
    assert.equal(res!.status, 502);
    assert.deepEqual(await json(res), { ok: false, error: 'server_error' });
  }
  const { deps } = stubDeps();
  deps.timeoutMs = 20;
  deps.fetch = (_u, init) =>
    new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  const res = await handle(post('/auth/request', { email: 'a@segulagrp.com' }), env, deps);
  assert.equal(res!.status, 502);
  assert.deepEqual(await json(res), { ok: false, error: 'server_error' });
});

test('POST endpoints: Origin mismatch is 403, missing Origin is allowed', async () => {
  const { deps, calls } = stubDeps();
  const bad = await handle(post('/auth/request', { email: 'a@segulagrp.com' }, { origin: 'https://evil.com' }), env, deps);
  assert.equal(bad!.status, 403);
  assert.equal(calls.length, 0);
  const sub = await handle(post('/auth/logout', {}, { origin: 'https://sub.central.test' }), env, deps);
  assert.equal(sub!.status, 403);
  const req = new Request('https://central.test/auth/request', { method: 'POST', body: JSON.stringify({ email: 'a@segulagrp.com' }) });
  assert.equal((await handle(req, env, deps))!.status, 200);
});

test('POST bodies over 4 KB are 413', async () => {
  const { deps, calls } = stubDeps();
  const res = await handle(post('/auth/request', { email: 'a@segulagrp.com', pad: 'x'.repeat(5000) }), env, deps);
  assert.equal(res!.status, 413);
  assert.equal(calls.length, 0);
});

test('invalid JSON body is 400', async () => {
  const { deps } = stubDeps();
  const res = await handle(post('/auth/request', '{nope'), env, deps);
  assert.equal(res!.status, 400);
});

test('wrong method on /auth endpoints is 405, unknown /auth path is 404', async () => {
  const { deps } = stubDeps();
  assert.equal((await handle(get('/auth/request'), env, deps))!.status, 405);
  assert.equal((await handle(post('/auth/me', {}), env, deps))!.status, 405);
  assert.equal((await handle(get('/auth/nope'), env, deps))!.status, 404);
});

// ---- /auth/verify ----
test('verify: valid code sets a 7-day session cookie', async () => {
  const { deps, calls } = stubDeps({ ok: true });
  const res = await handle(post('/auth/verify', { email: 'ANA@segulagrp.com', code: '123456' }), env, deps);
  assert.equal(res!.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  assert.deepEqual(calls[0]!.body, { action: 'otp_verify', key: AUTH_SHARED_SECRET, email: 'ana@segulagrp.com', code: '123456' });
  const cookie = res!.headers.get('set-cookie')!;
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']) {
    assert.ok(cookie.includes(attr), `${attr} in ${cookie}`);
  }
  const token = /^sc_session=([^;]+)/.exec(cookie)![1]!;
  assert.deepEqual(verifyToken(token, SESSION_SECRET, NOW_S), { email: 'ana@segulagrp.com', exp: NOW_S + 604800 });
});

test('verify: bad code format is 400 without calling Apps Script', async () => {
  const { deps, calls } = stubDeps();
  for (const code of ['12345', '1234567', 'abcdef', '12 456', 123456 as unknown as string, undefined as unknown as string]) {
    const res = await handle(post('/auth/verify', { email: 'a@segulagrp.com', code }), env, deps);
    assert.equal(res!.status, 400);
    assert.deepEqual(await json(res), { ok: false, error: 'invalid_code' });
  }
  assert.equal(calls.length, 0);
});

test('verify: Apps Script rejections map to statuses and set no cookie', async () => {
  for (const [err, status, expected] of [
    ['invalid_code', 400, 'invalid_code'],
    ['expired', 400, 'expired'],
    ['too_many_attempts', 429, 'too_many_attempts'],
    ['unauthorized', 502, 'server_error'],
    ['server_error', 502, 'server_error'],
  ] as const) {
    const { deps } = stubDeps({ ok: false, error: err });
    const res = await handle(post('/auth/verify', { email: 'a@segulagrp.com', code: '000000' }), env, deps);
    assert.equal(res!.status, status, err);
    assert.equal((await json(res)).error, expected);
    assert.equal(res!.headers.get('set-cookie'), null);
  }
});

// ---- /auth/logout, /auth/me, /auth/ticket ----
test('logout clears the cookie', async () => {
  const { deps } = stubDeps();
  const res = await handle(post('/auth/logout', {}), env, deps);
  assert.equal(res!.status, 200);
  assert.deepEqual(await json(res), { ok: true });
  const cookie = res!.headers.get('set-cookie')!;
  assert.match(cookie, /^sc_session=;/);
  for (const attr of ['Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(attr), attr);
});

test('me: session returns the email, no session is 401', async () => {
  const { deps } = stubDeps();
  const ok = await handle(get('/auth/me', { cookie: sessionCookie() }), env, deps);
  assert.equal(ok!.status, 200);
  assert.deepEqual(await json(ok), { ok: true, email: 'ana@segulagrp.com' });
  const no = await handle(get('/auth/me'), env, deps);
  assert.equal(no!.status, 401);
  const expired = await handle(get('/auth/me', { cookie: sessionCookie('a@segulagrp.com', NOW_S - 1) }), env, deps);
  assert.equal(expired!.status, 401);
  const wrong = await handle(get('/auth/me', { cookie: sessionCookie('a@segulagrp.com', NOW_S + 60, 'other') }), env, deps);
  assert.equal(wrong!.status, 401);
});

test('ticket: requires a session and returns a 15-minute ticket signed with AUTH_SHARED_SECRET', async () => {
  const { deps } = stubDeps();
  const no = await handle(get('/auth/ticket'), env, deps);
  assert.equal(no!.status, 401);
  const res = await handle(get('/auth/ticket', { cookie: sessionCookie() }), env, deps);
  assert.equal(res!.status, 200);
  const body = await json(res);
  assert.equal(body.ok, true);
  assert.equal(body.email, 'ana@segulagrp.com');
  assert.deepEqual(verifyToken(String(body.ticket), AUTH_SHARED_SECRET, NOW_S), { email: 'ana@segulagrp.com', exp: NOW_S + 900 });
  assert.equal(verifyToken(String(body.ticket), SESSION_SECRET, NOW_S), null);
});

// ---- fail closed ----
test('missing secrets: /auth endpoints answer not_configured 500', async () => {
  const { deps, calls } = stubDeps();
  for (const missing of ['SESSION_SECRET', 'AUTH_SHARED_SECRET', 'PUBLIC_TRAVEL_FOLIO_URL'] as const) {
    const e = { ...env, [missing]: undefined };
    for (const req of [
      post('/auth/request', { email: 'a@segulagrp.com' }),
      post('/auth/verify', { email: 'a@segulagrp.com', code: '123456' }),
      get('/auth/ticket', { cookie: sessionCookie() }),
      get('/auth/me', { cookie: sessionCookie() }),
    ]) {
      const res = await handle(req, e, deps);
      assert.equal(res!.status, 500);
      assert.deepEqual(await json(res), { ok: false, error: 'not_configured' });
    }
  }
  assert.equal(calls.length, 0);
});

test('missing SESSION_SECRET: protected routes stay blocked even with a cookie', async () => {
  const { deps } = stubDeps();
  const e = { ...env, SESSION_SECRET: undefined };
  const res = await handle(get('/', { accept: 'text/html', cookie: sessionCookie() }), e, deps);
  assert.equal(res!.status, 302);
  const api = await handle(get('/data.json', { cookie: sessionCookie() }), e, deps);
  assert.equal(api!.status, 401);
});

// ---- gatekeeping ----
test('unauthenticated HTML GET/HEAD redirects to /login with encoded next', async () => {
  const { deps } = stubDeps();
  const res = await handle(get('/segula-travel?a=1&b=x y', { accept: 'text/html,application/xhtml+xml' }), env, deps);
  assert.equal(res!.status, 302);
  assert.equal(res!.headers.get('location'), `/login?next=${encodeURIComponent('/segula-travel?a=1&b=x%20y')}`);
  const head = await handle(new Request('https://central.test/', { method: 'HEAD', headers: { accept: 'text/html' } }), env, deps);
  assert.equal(head!.status, 302);
  assert.equal(head!.headers.get('location'), '/login?next=%2F');
});

test('unauthenticated non-HTML requests are 401 JSON', async () => {
  const { deps } = stubDeps();
  for (const req of [
    get('/api/x', { accept: 'application/json' }),
    get('/'),
    get('/segula-travel', { accept: '*/*' }),
    new Request('https://central.test/', { method: 'POST', headers: { accept: 'text/html' }, body: 'x' }),
  ]) {
    const res = await handle(req, env, deps);
    assert.equal(res!.status, 401);
    assert.deepEqual(await json(res), { ok: false, error: 'unauthorized' });
  }
});

test('content images stay protected', async () => {
  const { deps } = stubDeps();
  for (const p of ['/_astro/x.webp', '/assets/directorio/a.webp', '/assets/segula-logo-classic-white.png', '/login/secret']) {
    const res = await handle(get(p, { accept: 'image/webp,*/*' }), env, deps);
    assert.equal(res!.status, 401, p);
  }
});

test('login-page assets and /login pass through unauthenticated', async () => {
  const { deps } = stubDeps();
  for (const p of [
    '/login',
    '/login/',
    '/favicon.svg',
    '/assets/segula-logo-powered-by-matra-white.png',
    '/_astro/global.abc123.css',
    '/_astro/LoginForm.abc123.js',
    '/_astro/font.abc.woff2',
    '/_astro/font.abc.woff',
  ]) {
    assert.equal(await handle(get(p, { accept: 'text/html' }), env, deps), null, p);
  }
});

test('valid session passes protected routes', async () => {
  const { deps } = stubDeps();
  assert.equal(await handle(get('/assets/directorio/a.webp', { cookie: sessionCookie() }), env, deps), null);
  assert.equal(await handle(get('/', { accept: 'text/html', cookie: `x=1; ${sessionCookie()}; y=2` }), env, deps), null);
});

test('a forged or expired cookie does not pass', async () => {
  const { deps } = stubDeps();
  const res = await handle(get('/', { accept: 'text/html', cookie: sessionCookie('a@segulagrp.com', NOW_S - 5) }), env, deps);
  assert.equal(res!.status, 302);
  const wrong = await handle(get('/', { accept: 'text/html', cookie: sessionCookie('a@segulagrp.com', NOW_S + 60, 'nope') }), env, deps);
  assert.equal(wrong!.status, 302);
});

test('logged-in user on /login is sent home or to a safe next', async () => {
  const { deps } = stubDeps();
  const c = { cookie: sessionCookie(), accept: 'text/html' };
  assert.equal((await handle(get('/login', c), env, deps))!.headers.get('location'), '/');
  assert.equal((await handle(get('/login?next=%2Fsegula-travel%3Fa%3D1', c), env, deps))!.headers.get('location'), '/segula-travel?a=1');
  for (const evil of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)']) {
    const res = await handle(get(`/login?next=${encodeURIComponent(evil)}`, c), env, deps);
    assert.equal(res!.status, 302);
    assert.equal(res!.headers.get('location'), '/', evil);
  }
});

test('responses are not cacheable', async () => {
  const { deps } = stubDeps();
  const res = await handle(get('/auth/me'), env, deps);
  assert.match(res!.headers.get('cache-control')!, /no-store/);
  const redirect = await handle(get('/', { accept: 'text/html' }), env, deps);
  assert.match(redirect!.headers.get('cache-control')!, /no-store/);
});
