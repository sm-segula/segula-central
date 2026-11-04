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

export interface FolioReserver {
  /** The folio of the current request ('' while none is reserved). */
  readonly current: string;
  /** The in-flight reservation, if any. */
  readonly pending: Promise<string> | null;
  /** Returns the request's folio, reserving it once; concurrent callers share one request. */
  ensure(email: string): Promise<string>;
  /** Starts a new request: the next ensure() reserves a new folio. */
  clear(): void;
}

/**
 * Holds one folio per request. Once reserved it never changes until clear(),
 * and concurrent callers (gate, preview, download) share the same in-flight
 * request, so the number shown on screen is the number printed in the PDF.
 * A reservation that resolves after clear() is ignored for the new request.
 */
export function createFolioReserver(
  issue: (email: string) => Promise<string>,
  onChange: (folio: string, reserving: boolean) => void,
): FolioReserver {
  let folio = '';
  let pending: Promise<string> | null = null;
  let generation = 0;
  return {
    get current() {
      return folio;
    },
    get pending() {
      return pending;
    },
    ensure(email) {
      if (folio) return Promise.resolve(folio);
      if (pending) return pending;
      const gen = generation;
      onChange('', true);
      const p = issue(email).then(
        (v) => {
          if (gen !== generation) return v; // stale: belongs to a cleared request
          folio = v;
          pending = null;
          onChange(folio, false);
          return v;
        },
        (err: unknown) => {
          if (gen === generation) {
            pending = null;
            onChange('', false);
          }
          throw err;
        },
      );
      pending = p;
      return p;
    },
    clear() {
      generation++;
      folio = '';
      pending = null;
      onChange('', false);
    },
  };
}

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
  let data: { ok?: boolean; folio?: string; error?: string } | null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') throw new FolioError('El servicio de folios respondió algo inesperado.');
  if (data.ok && typeof data.folio === 'string' && data.folio.startsWith(`${prefix}-`)) return data.folio;
  if (data.error === 'invalid_email') throw new FolioError(EMAIL_ERROR);
  if (data.error === 'busy') throw new FolioError('El servicio de folios está ocupado. Intenta de nuevo.');
  throw new FolioError('El servicio de folios no pudo asignar el folio.');
}
