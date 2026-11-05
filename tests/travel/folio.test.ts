import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FolioError,
  SessionGoneError,
  createFolioReserver,
  createTicketSource,
  deliverPdf,
  fetchTicket,
  issueFolio,
} from '../../src/islands/travel/folio.ts';

const ENDPOINT = 'https://script.google.com/macros/s/TEST/exec';

type Call = { url: string; init?: RequestInit };
const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Scripted fetch: answers with the queued replies in order and records every call. */
function scripted(replies: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    const r = replies.shift();
    if (!r) throw new Error('unexpected extra fetch');
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn: fn as typeof fetch, calls };
}
const bodyOf = (c: Call): Record<string, unknown> => JSON.parse(String(c.init?.body));

/** A fake ticket source that hands out t1, t2, ... and counts refreshes. */
function fakeSource() {
  let n = 1;
  let refreshes = 0;
  return {
    src: {
      get: async () => ({ ticket: `t${n}`, email: 'ana@segulagrp.com' }),
      refresh: async () => {
        refreshes++;
        n++;
        return { ticket: `t${n}`, email: 'ana@segulagrp.com' };
      },
    },
    refreshes: () => refreshes,
  };
}

test('fetchTicket returns ticket and email from /auth/ticket', async () => {
  const { fn, calls } = scripted([jsonRes({ ok: true, ticket: 'abc.def', email: 'ana@segulagrp.com' })]);
  const t = await fetchTicket(fn);
  assert.deepEqual(t, { ticket: 'abc.def', email: 'ana@segulagrp.com' });
  assert.equal(calls[0].url, '/auth/ticket');
});

test('fetchTicket signals a lost session on 401', async () => {
  const { fn } = scripted([jsonRes({ ok: false }, 401)]);
  await assert.rejects(fetchTicket(fn), SessionGoneError);
});

test('fetchTicket maps a network error to a FolioError (not session loss)', async () => {
  const { fn } = scripted([new TypeError('failed')]);
  await assert.rejects(fetchTicket(fn), (e: unknown) => e instanceof FolioError && !(e instanceof SessionGoneError));
});

test('fetchTicket rejects a garbled reply', async () => {
  const { fn } = scripted([jsonRes({ ok: true })]);
  await assert.rejects(fetchTicket(fn), FolioError);
});

test('ticket source caches the ticket until it expires and refresh() fetches again', async () => {
  const tok = (exp: number) => `${btoa(JSON.stringify({ email: 'a@segulagrp.com', exp })).replace(/=+$/, '')}.sig`;
  let now = 1_000_000;
  const { fn, calls } = scripted([
    jsonRes({ ok: true, ticket: tok(now + 900), email: 'a@segulagrp.com' }),
    jsonRes({ ok: true, ticket: tok(now + 1800), email: 'a@segulagrp.com' }),
    jsonRes({ ok: true, ticket: tok(now + 2700), email: 'a@segulagrp.com' }),
  ]);
  const src = createTicketSource(fn, () => now * 1000);
  await src.get();
  await src.get();
  assert.equal(calls.length, 1);
  now += 900; // expired
  await src.get();
  assert.equal(calls.length, 2);
  await src.refresh();
  assert.equal(calls.length, 3);
});

test('issueFolio sends exactly {action:"reserve", ticket} and no email', async () => {
  const { fn, calls } = scripted([jsonRes({ ok: true, folio: 'STRA-VJ-2026-000007' })]);
  const { src } = fakeSource();
  const folio = await issueFolio(ENDPOINT, src, 'STRA-VJ', 1000, fn);
  assert.equal(folio, 'STRA-VJ-2026-000007');
  assert.deepEqual(bodyOf(calls[0]), { action: 'reserve', ticket: 't1' });
  assert.equal(calls[0].init?.method, 'POST');
});

test('issueFolio: unauthorized triggers exactly one refresh and one retry', async () => {
  const { fn, calls } = scripted([
    jsonRes({ ok: false, error: 'unauthorized' }),
    jsonRes({ ok: true, folio: 'STRA-VJ-2026-000008' }),
  ]);
  const f = fakeSource();
  const folio = await issueFolio(ENDPOINT, f.src, 'STRA-VJ', 1000, fn);
  assert.equal(folio, 'STRA-VJ-2026-000008');
  assert.equal(f.refreshes(), 1);
  assert.equal(calls.length, 2);
  assert.equal(bodyOf(calls[1]).ticket, 't2');
});

test('issueFolio: a second unauthorized is an error, with no third call', async () => {
  const { fn, calls } = scripted([
    jsonRes({ ok: false, error: 'unauthorized' }),
    jsonRes({ ok: false, error: 'unauthorized' }),
  ]);
  const f = fakeSource();
  await assert.rejects(issueFolio(ENDPOINT, f.src, 'STRA-VJ', 1000, fn), FolioError);
  assert.equal(calls.length, 2);
  assert.equal(f.refreshes(), 1);
});

test('issueFolio: session loss during refresh propagates as SessionGoneError', async () => {
  const { fn } = scripted([jsonRes({ ok: false, error: 'unauthorized' })]);
  const src = {
    get: async () => ({ ticket: 't1', email: 'a@segulagrp.com' }),
    refresh: async () => {
      throw new SessionGoneError();
    },
  };
  await assert.rejects(issueFolio(ENDPOINT, src, 'STRA-VJ', 1000, fn), SessionGoneError);
});

test('deliverPdf sends {action, ticket, folio, pdf} with base64 pdf', async () => {
  const { fn, calls } = scripted([jsonRes({ ok: true })]);
  const { src } = fakeSource();
  await deliverPdf(ENDPOINT, src, 'STRA-VJ-2026-000007', new Uint8Array([37, 80, 68, 70]), 1000, fn);
  assert.deepEqual(bodyOf(calls[0]), {
    action: 'deliver',
    ticket: 't1',
    folio: 'STRA-VJ-2026-000007',
    pdf: btoa('%PDF'),
  });
});

test('deliverPdf maps too_large to its own message', async () => {
  const { fn } = scripted([jsonRes({ ok: false, error: 'too_large' })]);
  const { src } = fakeSource();
  await assert.rejects(
    deliverPdf(ENDPOINT, src, 'F-1', new Uint8Array([1]), 1000, fn),
    (e: unknown) => e instanceof FolioError && e.code === 'too_large' && /20 MB/.test(e.message),
  );
});

test('deliverPdf refuses a PDF over 20 MB without calling the service', async () => {
  const { fn, calls } = scripted([]);
  const { src } = fakeSource();
  await assert.rejects(
    deliverPdf(ENDPOINT, src, 'F-1', new Uint8Array(20 * 1024 * 1024 + 1), 1000, fn),
    (e: unknown) => e instanceof FolioError && e.code === 'too_large',
  );
  assert.equal(calls.length, 0);
});

test('deliverPdf: unauthorized refreshes once and retries once', async () => {
  const { fn, calls } = scripted([jsonRes({ ok: false, error: 'unauthorized' }), jsonRes({ ok: true })]);
  const f = fakeSource();
  await deliverPdf(ENDPOINT, f.src, 'F-1', new Uint8Array([1, 2]), 1000, fn);
  assert.equal(f.refreshes(), 1);
  assert.equal(calls.length, 2);
  assert.equal(bodyOf(calls[1]).ticket, 't2');
});

test('deliverPdf maps busy, server errors and network failures to FolioError', async () => {
  for (const reply of [
    jsonRes({ ok: false, error: 'busy' }),
    jsonRes({ ok: false, error: 'server_error' }),
    jsonRes({ ok: false, error: 'not_found' }),
    jsonRes({ ok: false }),
    new TypeError('offline'),
  ]) {
    const { fn } = scripted([reply]);
    const { src } = fakeSource();
    await assert.rejects(deliverPdf(ENDPOINT, src, 'F-1', new Uint8Array([1]), 1000, fn), FolioError);
  }
});

// Previous behavior that must keep holding: one folio per request, shared in-flight reservation.
test('reserver: concurrent callers share one reservation and clear() starts a new request', async () => {
  let issued = 0;
  const reserver = createFolioReserver(
    async () => `F-${++issued}`,
    () => {},
  );
  const [a, b] = await Promise.all([reserver.ensure(), reserver.ensure()]);
  assert.equal(a, 'F-1');
  assert.equal(b, 'F-1');
  assert.equal(issued, 1);
  assert.equal(await reserver.ensure(), 'F-1');
  assert.equal(reserver.current, 'F-1');
  reserver.clear();
  assert.equal(await reserver.ensure(), 'F-2');
});
