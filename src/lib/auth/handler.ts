import { normalizeEmail } from './email.js';
import { SESSION_COOKIE, isPublicPath, safeNext } from './routes.js';
import { signToken, verifyToken } from './token.js';

export interface AuthEnv {
  SESSION_SECRET?: string | undefined;
  AUTH_SHARED_SECRET?: string | undefined;
  PUBLIC_TRAVEL_FOLIO_URL?: string | undefined;
}

export interface AuthDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Current time in milliseconds. */
  now: () => number;
  /** Apps Script call timeout, default 15 s. */
  timeoutMs?: number;
}

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const TICKET_SECONDS = 15 * 60;
const MAX_BODY_BYTES = 4096;

const BASE_HEADERS = { 'cache-control': 'no-store' };

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...BASE_HEADERS, ...extra },
  });
}

function cookieHeader(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sessionEmail(request: Request, env: AuthEnv, nowSeconds: number): string | null {
  if (!env.SESSION_SECRET) return null;
  return verifyToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, nowSeconds)?.email ?? null;
}

let warned = false;
function configured(env: AuthEnv): boolean {
  const ok = Boolean(env.SESSION_SECRET && env.AUTH_SHARED_SECRET && env.PUBLIC_TRAVEL_FOLIO_URL);
  if (!ok && !warned) {
    warned = true;
    console.error('[auth] SESSION_SECRET, AUTH_SHARED_SECRET and PUBLIC_TRAVEL_FOLIO_URL must be set: failing closed.');
  }
  return ok;
}

/** Reads a small JSON object body; returns a Response when it must be rejected. */
async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' });
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    /* falls through */
  }
  return json(400, { ok: false, error: 'bad_request' });
}

async function callScript(
  env: AuthEnv,
  deps: AuthDeps,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15000);
  try {
    const res = await deps.fetch(env.PUBLIC_TRAVEL_FOLIO_URL!, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, key: env.AUTH_SHARED_SECRET }),
      redirect: 'follow',
      signal: controller.signal,
    });
    const data: unknown = JSON.parse(await res.text());
    if (data && typeof data === 'object') {
      const d = data as { ok?: unknown; error?: unknown };
      if (d.ok === true) return { ok: true };
      return { ok: false, error: typeof d.error === 'string' ? d.error : 'server_error' };
    }
  } catch {
    /* network error, timeout or non-JSON: generic below */
  } finally {
    clearTimeout(timer);
  }
  return { ok: false, error: 'server_error' };
}

const REQUEST_ERRORS: Record<string, [number, string]> = {
  invalid_email: [400, 'invalid_email'],
  cooldown: [429, 'cooldown'],
  too_many_attempts: [429, 'too_many_attempts'],
  busy: [503, 'busy'],
};
const VERIFY_ERRORS: Record<string, [number, string]> = {
  invalid_code: [400, 'invalid_code'],
  expired: [400, 'expired'],
  too_many_attempts: [429, 'too_many_attempts'],
  busy: [503, 'busy'],
};

function mapError(table: Record<string, [number, string]>, error: string | undefined): Response {
  const [status, code] = (error && table[error]) || [502, 'server_error'];
  return json(status, { ok: false, error: code });
}

async function handleAuth(request: Request, url: URL, env: AuthEnv, deps: AuthDeps, nowSeconds: number): Promise<Response> {
  const route = url.pathname.replace(/\/+$/, '');
  const isPost = route === '/auth/request' || route === '/auth/verify' || route === '/auth/logout';
  const isGet = route === '/auth/ticket' || route === '/auth/me';
  if (!isPost && !isGet) return json(404, { ok: false, error: 'not_found' });
  if (request.method !== (isPost ? 'POST' : 'GET')) {
    return json(405, { ok: false, error: 'method_not_allowed' }, { allow: isPost ? 'POST' : 'GET' });
  }

  if (isPost) {
    const origin = request.headers.get('origin');
    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        /* invalid origin */
      }
      if (host !== url.host) return json(403, { ok: false, error: 'forbidden' });
    }
  }

  // Clearing a cookie is harmless, so logout works even when unconfigured.
  if (route === '/auth/logout') return json(200, { ok: true }, { 'set-cookie': cookieHeader('', 0) });
  if (!configured(env)) return json(500, { ok: false, error: 'not_configured' });

  if (route === '/auth/me' || route === '/auth/ticket') {
    const email = sessionEmail(request, env, nowSeconds);
    if (!email) return json(401, { ok: false, error: 'unauthorized' });
    if (route === '/auth/me') return json(200, { ok: true, email });
    const ticket = signToken({ email, exp: nowSeconds + TICKET_SECONDS }, env.AUTH_SHARED_SECRET!);
    return json(200, { ok: true, ticket, email });
  }

  const body = await readBody(request);
  if (body instanceof Response) return body;
  const email = normalizeEmail(body.email);
  if (!email) return json(400, { ok: false, error: 'invalid_email' });

  if (route === '/auth/request') {
    const r = await callScript(env, deps, { action: 'otp_request', email });
    return r.ok ? json(200, { ok: true }) : mapError(REQUEST_ERRORS, r.error);
  }

  const code = body.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return json(400, { ok: false, error: 'invalid_code' });
  const r = await callScript(env, deps, { action: 'otp_verify', email, code });
  if (!r.ok) return mapError(VERIFY_ERRORS, r.error);
  const token = signToken({ email, exp: nowSeconds + SESSION_SECONDS }, env.SESSION_SECRET!);
  return json(200, { ok: true }, { 'set-cookie': cookieHeader(token, SESSION_SECONDS) });
}

/**
 * Returns the Response that answers the request, or null to let it continue
 * to the static site (the middleware adapter then calls next()).
 */
export async function handle(request: Request, env: AuthEnv, deps: AuthDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const nowSeconds = Math.floor(deps.now() / 1000);

  if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
    return handleAuth(request, url, env, deps, nowSeconds);
  }

  const email = sessionEmail(request, env, nowSeconds);

  if (url.pathname === '/login' || url.pathname === '/login/') {
    if (email) return redirect(safeNext(url.searchParams.get('next')));
    return null;
  }
  if (isPublicPath(url.pathname) || email) return null;

  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  if ((request.method === 'GET' || request.method === 'HEAD') && wantsHtml) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return json(401, { ok: false, error: 'unauthorized' });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, ...BASE_HEADERS } });
}
