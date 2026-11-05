// Vercel Routing Middleware: runs before the static files, so it protects the
// prerendered pages and assets (Astro middleware cannot). Logic lives in
// src/lib/auth/handler.ts; this file only wires env, fetch and next().
import { next } from '@vercel/functions';
import { handle } from './src/lib/auth/handler.ts';

// Node.js runtime, stated explicitly: the token code uses node:crypto, which the
// Edge runtime does not provide (on Edge every request failed with
// MIDDLEWARE_INVOCATION_FAILED before reaching this code).
export const config = { runtime: 'nodejs' };

export default async function middleware(request: Request): Promise<Response> {
  const answer = await handle(
    request,
    {
      SESSION_SECRET: process.env.SESSION_SECRET,
      AUTH_SHARED_SECRET: process.env.AUTH_SHARED_SECRET,
      PUBLIC_TRAVEL_FOLIO_URL: process.env.PUBLIC_TRAVEL_FOLIO_URL,
    },
    { fetch: (url, init) => fetch(url, init), now: () => Date.now() },
  );
  return answer ?? next();
}
