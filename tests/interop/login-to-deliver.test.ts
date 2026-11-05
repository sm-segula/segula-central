// Seam test: the real Vercel middleware handler talking to the real Code.gs
// (loaded in the Apps Script harness). No network, no canned replies: every
// Apps Script answer comes from Code.gs itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../src/lib/auth/handler.ts';
import type { AuthDeps, AuthEnv } from '../../src/lib/auth/handler.ts';
// @ts-ignore -- plain ESM test harness without types
import { load, SECRET, lastCode, PDF_B64 } from '../apps-script/harness.mjs';

const SCRIPT_URL = 'https://script.google.com/macros/s/INTEROP/exec';
const ORIGIN = 'https://central.test';

function wire() {
  const h = load();
  const env: AuthEnv = {
    SESSION_SECRET: 'interop-session-secret-0123456789',
    AUTH_SHARED_SECRET: SECRET,
    PUBLIC_TRAVEL_FOLIO_URL: SCRIPT_URL,
  };
  const deps: AuthDeps = {
    now: () => h.clock.now,
    fetch: async (url, init) => {
      assert.equal(String(url), SCRIPT_URL);
      return new Response(JSON.stringify(h.post(String(init?.body ?? ''))), { status: 200 });
    },
  };
  const call = (path: string, init: RequestInit = {}) =>
    handle(new Request(ORIGIN + path, init), env, deps) as Promise<Response>;
  const postJson = (path: string, body: unknown, cookie = '') =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  return { h, call, postJson };
}

test('OTP login through the middleware, then a ticket that Code.gs accepts for reserve and deliver', async () => {
  const { h, call, postJson } = wire();
  const email = 'Ana.Perez@SegulaGrp.com ';

  const req = await postJson('/auth/request', { email });
  assert.equal(req.status, 200);
  assert.deepEqual(await req.json(), { ok: true });
  assert.equal(h.state.mails.length, 1);
  assert.equal(h.state.mails[0].to, 'ana.perez@segulagrp.com');

  const ver = await postJson('/auth/verify', { email, code: lastCode(h) });
  assert.equal(ver.status, 200);
  const cookie = (ver.headers.get('set-cookie') ?? '').split(';')[0];
  assert.match(cookie, /^sc_session=.+/);

  const t = await call('/auth/ticket', { headers: { cookie } });
  assert.equal(t.status, 200);
  const { ticket, email: ticketEmail } = (await t.json()) as { ticket: string; email: string };
  assert.equal(ticketEmail, 'ana.perez@segulagrp.com');

  const reserved = h.post({ action: 'reserve', ticket });
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  assert.match(reserved.folio, /^STRA-VJ-\d{4}-\d{6}$/);

  const delivered = h.post({ action: 'deliver', ticket, folio: reserved.folio, pdf: PDF_B64 });
  assert.deepEqual(delivered, { ok: true });
  const mail = h.state.mails[h.state.mails.length - 1];
  assert.equal(mail.to, 'ana.perez@segulagrp.com');
});

test('a wrong code through the middleware never yields a session', async () => {
  const { h, postJson } = wire();
  await postJson('/auth/request', { email: 'ana@segulagrp.com' });
  const code = lastCode(h);
  const wrong = code === '000000' ? '000001' : '000000';
  const ver = await postJson('/auth/verify', { email: 'ana@segulagrp.com', code: wrong });
  assert.equal(ver.status, 400);
  assert.equal(ver.headers.get('set-cookie'), null);
});

test('the ticket expires for Code.gs after 15 minutes', async () => {
  const { h, call, postJson } = wire();
  await postJson('/auth/request', { email: 'ana@segulagrp.com' });
  const ver = await postJson('/auth/verify', { email: 'ana@segulagrp.com', code: lastCode(h) });
  const cookie = (ver.headers.get('set-cookie') ?? '').split(';')[0];
  const { ticket } = (await (await call('/auth/ticket', { headers: { cookie } })).json()) as { ticket: string };
  h.clock.now += 16 * 60 * 1000;
  assert.equal(h.post({ action: 'reserve', ticket }).error, 'unauthorized');
});
