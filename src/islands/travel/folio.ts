/**
 * Access email and folio issuing for SEGULA Travel.
 *
 * The email gate only checks the corporate domain: it is NOT authentication
 * (anyone can type a made-up address on the domain). The folio service in
 * `apps-script/travel-folio/Code.gs` repeats the same check server-side.
 */
import { bumpSeq, peekFolio } from './model';

const CORPORATE = /^[a-z0-9._%+-]+@segulagrp\.com$/;
const EMAIL_KEY = 'segula.travel.email';

export const normalizeEmail = (v: string): string => v.trim().toLowerCase();
export const isCorporateEmail = (v: string): boolean => CORPORATE.test(normalizeEmail(v));

/** Same wording for every rejection: the UI must not hint at the expected domain. */
export const EMAIL_ERROR = 'Correo incorrecto.';

export const readRememberedEmail = (): string => {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
};
export const rememberEmail = (email: string, remember: boolean): void => {
  try {
    if (remember) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* storage blocked: the email is simply not remembered */
  }
};

export class FolioError extends Error {}

/**
 * Issues the next folio. With an endpoint, the Apps Script web app assigns it
 * atomically (shared across users). Without one (local dev), the old per-browser
 * counter is used. POST with text/plain keeps it a "simple" request: Apps Script
 * cannot answer a CORS preflight.
 */
export async function issueFolio(endpoint: string | undefined, email: string, prefix: string): Promise<string> {
  if (!endpoint) {
    const folio = peekFolio(prefix);
    bumpSeq();
    return folio;
  }
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ email: normalizeEmail(email) }),
      redirect: 'follow',
    });
  } catch {
    throw new FolioError('Sin conexión con el servicio de folios. Intenta de nuevo.');
  }
  let data: { ok?: boolean; folio?: string; error?: string };
  try {
    data = await res.json();
  } catch {
    throw new FolioError('El servicio de folios respondió algo inesperado.');
  }
  if (data.ok && typeof data.folio === 'string' && data.folio.startsWith(`${prefix}-`)) return data.folio;
  if (data.error === 'invalid_email') throw new FolioError(EMAIL_ERROR);
  if (data.error === 'busy') throw new FolioError('El servicio de folios está ocupado. Intenta de nuevo.');
  throw new FolioError('El servicio de folios no pudo asignar el folio.');
}
