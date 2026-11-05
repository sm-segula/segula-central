// Pure helpers, also imported by the login island: no node: imports here.

export const SESSION_COOKIE = 'sc_session';

const PUBLIC_EXACT = new Set(['/login', '/login/', '/favicon.svg', '/assets/segula-logo-powered-by-matra-white.png']);

/** Paths reachable without a session: the login page and what it needs to render. */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return true;
  if (pathname.startsWith('/_astro/') && /\.(css|js)$/.test(pathname)) return true;
  return /\.(woff2?)$/.test(pathname);
}

/** Only same-site relative paths survive; anything else (and login/auth loops) becomes "/". */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/';
  const path = value.split(/[?#]/)[0]!;
  if (path === '/login' || path === '/login/' || path.startsWith('/auth/')) return '/';
  return value;
}
