// Vercel Routing Middleware: runs before the static files, so it protects the
// prerendered pages and assets (Astro middleware cannot). Logic lives in
// src/lib/auth/handler.ts; this file only wires env, fetch and next().
import { next } from '@vercel/functions';
import { handle } from './src/lib/auth/handler.js';

// Node.js runtime, stated explicitly: the token code uses node:crypto.
// Relative imports use `.js`: Vercel transpiles each .ts file to .js on its own
// (no bundling), so a `.ts` specifier fails at runtime with ERR_MODULE_NOT_FOUND.
// tests/auth/deploy-load.test.ts reproduces that shipping step.
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
