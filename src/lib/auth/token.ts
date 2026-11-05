import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenPayload {
  email: string;
  /** Expiry, unix seconds. */
  exp: number;
}

// Token format shared with Apps Script: base64url(JSON) + "." + base64url(HMAC-SHA256),
// both parts WITHOUT "=" padding.
function b64u(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function mac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(mac(secret, body))}`;
}

const PART = /^[A-Za-z0-9_-]+$/;

export function verifyToken(token: unknown, secret: string, nowSeconds: number): TokenPayload | null {
  if (typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  if (!PART.test(body) || !PART.test(sig)) return null;

  const expected = mac(secret, body);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (typeof data.email !== 'string' || typeof data.exp !== 'number' || !Number.isFinite(data.exp)) return null;
    if (data.exp <= nowSeconds) return null;
    return { email: data.email, exp: data.exp };
  } catch {
    return null;
  }
}
