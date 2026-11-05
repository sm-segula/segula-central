import { handle } from '../../src/lib/auth/handler.ts';
import type { AuthEnv, AuthDeps } from '../../src/lib/auth/handler.ts';
import { signToken } from '../../src/lib/auth/token.ts';

export const SESSION_SECRET = 'session-secret-for-tests-0123456789';
export const AUTH_SHARED_SECRET = 'shared-secret-for-tests-0123456789';
export const SCRIPT_URL = 'https://script.google.com/macros/s/TEST/exec';
export const NOW_MS = 1_800_000_000_000;
export const NOW_S = NOW_MS / 1000;

export const env: AuthEnv = {
  SESSION_SECRET,
  AUTH_SHARED_SECRET,
  PUBLIC_TRAVEL_FOLIO_URL: SCRIPT_URL,
};

export interface FetchCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

export function stubDeps(reply: unknown = { ok: true }) {
  const calls: FetchCall[] = [];
  const deps: AuthDeps = {
    now: () => NOW_MS,
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ url: String(url), init: init ?? {}, body });
      if (reply instanceof Error) throw reply;
      return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status: 200 });
    },
  };
  return { deps, calls };
}

export function sessionCookie(email = 'ana@segulagrp.com', exp = NOW_S + 3600, secret = SESSION_SECRET) {
  return `sc_session=${signToken({ email, exp }, secret)}`;
}

export function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://central.test${path}`, { method: 'GET', headers });
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://central.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://central.test', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export { handle };
