// Pure helpers, also imported by the login island: no node: imports here.

export const SESSION_COOKIE = 'sc_session';

const PUBLIC_EXACT = new Set(['/login', '/login/', '/favicon.svg', '/assets/segula-logo-powered-by-matra-white.png']);

/** Paths reachable without a session: the login page and what it needs to render. */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return true;
  // Bundles and fonts only: a flat, plain file name under /_astro/. No encoded
  // characters, parameters or sub-paths, so "/_astro/x.webp%3F.js" stays protected.
  return /^\/_astro\/[A-Za-z0-9._-]+\.(css|js|woff2?)$/.test(pathname);
}

/** Only same-site relative paths survive; anything else (and login/auth loops) becomes "/". */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex
  // Printable ASCII only: a Location header cannot carry other characters.
  if (value.includes('\\') || !/^[\x20-\x7e]*$/.test(value)) return '/';
  const path = value.split(/[?#]/)[0]!;
  if (path === '/login' || path === '/login/' || path.startsWith('/auth/')) return '/';
  return value;
}
