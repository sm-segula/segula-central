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

type Reply = { ok?: boolean; folio?: string; error?: string };

/**
 * POSTs to the Apps Script web app. text/plain keeps it a "simple" request
 * (Apps Script cannot answer a CORS preflight) and the timeout keeps a hung
 * request from leaving the loader spinning forever.
 */
async function post(endpoint: string, payload: Record<string, string>, timeoutMs: number): Promise<Reply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let data: Reply | null;
  try {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch {
      throw new FolioError(
        ctrl.signal.aborted
          ? 'El servicio de folios tardó demasiado. Intenta de nuevo.'
          : 'Sin conexión con el servicio de folios. Intenta de nuevo.',
      );
    }
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!data || typeof data !== 'object') throw new FolioError('El servicio de folios respondió algo inesperado.');
  return data;
}

type MarkStatus = 'ok' | 'retry' | 'rejected';

async function mark(endpoint: string, email: string, folio: string, timeoutMs: number): Promise<MarkStatus> {
  let data: Reply;
  try {
    data = await post(endpoint, { action: 'downloaded', email: normalizeEmail(email), folio }, timeoutMs);
  } catch {
    return 'retry'; // network, timeout or garbled reply: worth trying again
  }
  // A reply carrying a folio comes from an older Code.gs that treated the call
  // as a reservation: retrying would burn more numbers, so give up.
  if (data.ok === true && !data.folio) return 'ok';
  if (data.folio || data.error === 'not_found' || data.error === 'bad_request' || data.error === 'invalid_email') return 'rejected';
  return 'retry';
}

/**
 * Records in the folio sheet that the PDF of `folio` was downloaded. Never
 * throws: a failure only leaves the row unmarked (the download already happened).
 */
export async function markDownloaded(endpoint: string | undefined, email: string, folio: string, timeoutMs = 20000): Promise<boolean> {
  if (!endpoint) return true;
  return (await mark(endpoint, email, folio, timeoutMs)) === 'ok';
}

// Downloads whose registration failed, kept in the browser so a later download
// or a later visit retries them, even after "Nueva solicitud" or a reload.
const UNMARKED_KEY = 'segula.travel.unmarked';
type Unmarked = { folio: string; email: string };
const sameEntry = (a: Unmarked, b: Unmarked): boolean => a.folio === b.folio && a.email === b.email;

export const readUnmarked = (): Unmarked[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(UNMARKED_KEY) ?? '[]');
    return Array.isArray(v)
      ? v.filter((x): x is Unmarked => !!x && typeof x.folio === 'string' && typeof x.email === 'string')
      : [];
  } catch {
    return [];
  }
};
const writeUnmarked = (list: Unmarked[]): void => {
  try {
    if (list.length) localStorage.setItem(UNMARKED_KEY, JSON.stringify(list));
    else localStorage.removeItem(UNMARKED_KEY);
  } catch {
    /* storage blocked: the retry only lives in this page */
  }
};

/**
 * Records the download of `folio`. On a retryable failure it is queued so
 * retryUnmarked() sends it again later. Resolves to whether it is registered.
 */
export async function registerDownload(endpoint: string | undefined, email: string, folio: string, timeoutMs = 20000): Promise<boolean> {
  if (!endpoint) return true;
  const entry = { folio, email: normalizeEmail(email) };
  const status = await mark(endpoint, email, folio, timeoutMs);
  const rest = readUnmarked().filter((x) => !sameEntry(x, entry));
  writeUnmarked(status === 'retry' ? [...rest, entry] : rest);
  return status === 'ok';
}

/**
 * Sends again the queued registrations of this email (other emails' entries
 * are kept: the sheet only accepts the email that reserved the folio).
 * Registered or rejected entries leave the queue; entries added meanwhile stay.
 */
export async function retryUnmarked(endpoint: string | undefined, email: string, skipFolio = '', timeoutMs = 20000): Promise<void> {
  if (!endpoint) return;
  const me = normalizeEmail(email);
  const done: Unmarked[] = [];
  for (const it of readUnmarked()) {
    if (it.email !== me || it.folio === skipFolio) continue;
    if ((await mark(endpoint, it.email, it.folio, timeoutMs)) !== 'retry') done.push(it);
  }
  if (done.length) writeUnmarked(readUnmarked().filter((x) => !done.some((d) => sameEntry(d, x))));
}

/** Largest PDF sent for the internal copy (Apps Script documents no doPost limit). */
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  // Chunked: spreading a whole PDF into fromCharCode would overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Sends the downloaded PDF to the folio service, which keeps an internal copy
 * in Drive linked from the folio sheet. Internal control only: it never throws,
 * is never retried and its outcome is never shown to the requester. Resolves to
 * whether the copy was stored.
 */
export async function archivePdf(
  endpoint: string | undefined, email: string, folio: string, bytes: Uint8Array, timeoutMs = 45000,
): Promise<boolean> {
  if (!endpoint || !bytes.length || bytes.length > MAX_ARCHIVE_BYTES) return false;
  try {
    const data = await post(endpoint, { action: 'archive', email: normalizeEmail(email), folio, pdf: toBase64(bytes) }, timeoutMs);
    return data.ok === true && !data.folio;
  } catch {
    return false;
  }
}

/**
 * Issues the next folio. With an endpoint, the Apps Script web app assigns it
 * atomically (shared across users). Without one (local dev), the old per-browser
 * counter is used.
 */
export async function issueFolio(endpoint: string | undefined, email: string, prefix: string, timeoutMs = 20000): Promise<string> {
  if (!endpoint) {
    const folio = peekFolio(prefix);
    bumpSeq();
    return folio;
  }
  const data = await post(endpoint, { action: 'reserve', email: normalizeEmail(email) }, timeoutMs);
  if (data.ok && typeof data.folio === 'string' && data.folio.startsWith(`${prefix}-`)) return data.folio;
  if (data.error === 'invalid_email') throw new FolioError(EMAIL_ERROR);
  if (data.error === 'busy') throw new FolioError('El servicio de folios está ocupado. Intenta de nuevo.');
  throw new FolioError('El servicio de folios no pudo asignar el folio.');
}
