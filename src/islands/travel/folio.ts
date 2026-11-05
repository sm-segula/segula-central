/**
 * Network side of SEGULA Travel: session ticket, folio reservation and PDF
 * delivery by email.
 *
 * The whole site sits behind the login (see src/lib/auth). The browser asks
 * `/auth/ticket` for a short-lived signed ticket and presents it to the folio
 * service in `apps-script/travel-folio/Code.gs`, which takes the requester's
 * email ONLY from that verified ticket: no email is ever typed or sent here.
 */
import { bumpSeq, peekFolio } from './model.ts';

/** Where the login lives; `next` brings the user back to the travel page. */
export const LOGIN_URL = '/login?next=/segula-travel';

export class FolioError extends Error {
  readonly code: string;
  constructor(message: string, code = 'error') {
    super(message);
    this.code = code;
  }
}

/** The login session is gone (or never existed): the user has to log in again. */
export class SessionGoneError extends FolioError {
  constructor() {
    super('Tu sesión terminó. Inicia sesión de nuevo.', 'session_gone');
  }
}

export interface Ticket {
  ticket: string;
  email: string;
}

export interface TicketSource {
  /** The current ticket, fetching one when there is none or it is about to expire. */
  get(): Promise<Ticket>;
  /** Discards the current ticket and fetches a new one. */
  refresh(): Promise<Ticket>;
}

type FetchFn = typeof fetch;

/** GET /auth/ticket: 401 means the session is gone. */
export async function fetchTicket(fetchFn: FetchFn = fetch): Promise<Ticket> {
  let res: Response;
  try {
    res = await fetchFn('/auth/ticket', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw new FolioError('Sin conexión. Intenta de nuevo.', 'network');
  }
  if (res.status === 401) throw new SessionGoneError();
  let data: { ok?: boolean; ticket?: unknown; email?: unknown } | null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.ok !== true || typeof data.ticket !== 'string' || typeof data.email !== 'string') {
    throw new FolioError('No se pudo validar tu sesión. Intenta de nuevo.', 'ticket');
  }
  return { ticket: data.ticket, email: data.email };
}

/** Expiry (unix seconds) read from the unsigned payload; 0 when unreadable. Only a cache hint: the server verifies. */
function ticketExp(ticket: string): number {
  try {
    const b64 = (ticket.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(b64)).exp;
    return typeof exp === 'number' ? exp : 0;
  } catch {
    return 0;
  }
}

const TICKET_MARGIN_S = 60;

/** Keeps the ticket in memory (never persisted) and renews it when it is about to expire. */
export function createTicketSource(fetchFn: FetchFn = fetch, nowMs: () => number = Date.now): TicketSource {
  let current: Ticket | null = null;
  let inflight: Promise<Ticket> | null = null;
  const load = (): Promise<Ticket> => {
    if (!inflight) {
      inflight = fetchTicket(fetchFn)
        .then((t) => (current = t))
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
  return {
    get() {
      if (current && ticketExp(current.ticket) - TICKET_MARGIN_S > nowMs() / 1000) return Promise.resolve(current);
      return load();
    },
    refresh() {
      current = null;
      return load();
    },
  };
}

export interface FolioReserver {
  /** The folio of the current request ('' while none is reserved). */
  readonly current: string;
  /** The in-flight reservation, if any. */
  readonly pending: Promise<string> | null;
  /** Returns the request's folio, reserving it once; concurrent callers share one request. */
  ensure(): Promise<string>;
  /** Starts a new request: the next ensure() reserves a new folio. */
  clear(): void;
}

/**
 * Holds one folio per request. Once reserved it never changes until clear(),
 * and concurrent callers (page load, preview, send) share the same in-flight
 * request, so the number shown on screen is the number printed in the PDF.
 * A reservation that resolves after clear() is ignored for the new request.
 */
export function createFolioReserver(
  issue: () => Promise<string>,
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
    ensure() {
      if (folio) return Promise.resolve(folio);
      if (pending) return pending;
      const gen = generation;
      onChange('', true);
      const p = issue().then(
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
async function post(endpoint: string, payload: Record<string, string>, timeoutMs: number, fetchFn: FetchFn): Promise<Reply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let data: Reply | null;
  try {
    let res: Response;
    try {
      res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } catch {
      throw new FolioError(
        ctrl.signal.aborted
          ? 'El servicio tardó demasiado. Intenta de nuevo.'
          : 'Sin conexión con el servicio. Intenta de nuevo.',
        'network',
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
  if (!data || typeof data !== 'object') throw new FolioError('El servicio respondió algo inesperado.', 'bad_reply');
  return data;
}

/**
 * Calls a ticketed action. When the service answers `unauthorized` (expired
 * ticket) it fetches a new ticket and retries exactly once.
 */
async function postTicketed(
  endpoint: string, auth: TicketSource, payload: Record<string, string>, timeoutMs: number, fetchFn: FetchFn,
): Promise<Reply> {
  let t = await auth.get();
  let data = await post(endpoint, { ...payload, ticket: t.ticket }, timeoutMs, fetchFn);
  if (data.error === 'unauthorized') {
    t = await auth.refresh();
    data = await post(endpoint, { ...payload, ticket: t.ticket }, timeoutMs, fetchFn);
  }
  return data;
}

/** Largest PDF the folio service accepts (Apps Script documents no doPost limit). */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

const TOO_LARGE = 'El PDF supera 20 MB y no se puede enviar por correo. Quita o reduce algún adjunto.';

const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  // Chunked: spreading a whole PDF into fromCharCode would overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Asks the folio service to email the PDF to the logged-in user. Resolves once
 * the email was sent; any failure throws a FolioError with a user-facing
 * message, and the same folio can be delivered again.
 */
export async function deliverPdf(
  endpoint: string | undefined, auth: TicketSource, folio: string, bytes: Uint8Array,
  timeoutMs = 90000, fetchFn: FetchFn = fetch,
): Promise<void> {
  if (!endpoint) throw new FolioError('El envío por correo no está configurado.', 'not_configured');
  if (bytes.length > MAX_PDF_BYTES) throw new FolioError(TOO_LARGE, 'too_large');
  const data = await postTicketed(endpoint, auth, { action: 'deliver', folio, pdf: toBase64(bytes) }, timeoutMs, fetchFn);
  if (data.ok === true) return;
  switch (data.error) {
    case 'too_large':
      throw new FolioError(TOO_LARGE, 'too_large');
    case 'busy':
      throw new FolioError('El servicio está ocupado. Intenta de nuevo.', 'busy');
    case 'unauthorized':
      throw new FolioError('No se pudo validar tu sesión. Intenta de nuevo.', 'unauthorized');
    default:
      throw new FolioError('No se pudo enviar el correo. Intenta de nuevo.', data.error ?? 'error');
  }
}

/**
 * Issues the next folio. With an endpoint, the Apps Script web app assigns it
 * atomically (shared across users). Without one (local dev), the old per-browser
 * counter is used.
 */
export async function issueFolio(
  endpoint: string | undefined, auth: TicketSource, prefix: string, timeoutMs = 20000, fetchFn: FetchFn = fetch,
): Promise<string> {
  if (!endpoint) {
    const folio = peekFolio(prefix);
    bumpSeq();
    return folio;
  }
  const data = await postTicketed(endpoint, auth, { action: 'reserve' }, timeoutMs, fetchFn);
  if (data.ok && typeof data.folio === 'string' && data.folio.startsWith(`${prefix}-`)) return data.folio;
  if (data.error === 'busy') throw new FolioError('El servicio de folios está ocupado. Intenta de nuevo.', 'busy');
  if (data.error === 'unauthorized') throw new FolioError('No se pudo validar tu sesión. Intenta de nuevo.', 'unauthorized');
  throw new FolioError('El servicio de folios no pudo asignar el folio.', data.error ?? 'error');
}
