/**
 * State and actions of the travel request form (port of the prototype's
 * Component class). The PDF module is imported on demand so pdf-lib is only
 * downloaded when the user asks for a preview or to send it. The site is behind
 * the login: on load the session ticket gives the requester's email, the folio
 * is reserved with it, and the same folio is used by preview and delivery. The
 * PDF is emailed to the logged-in user, never downloaded.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  FIELDS, MAX_MB, emptyFields, emptyReq, fileKind, validate,
  type Attachment, type Currency, type Field, type Fields, type ReqKey, type ReqRow,
} from './model';
import {
  LOGIN_URL, SessionGoneError, createFolioReserver, createTicketSource, deliverPdf, issueFolio,
  type FolioReserver,
} from './folio';
import type { Tone } from './ui';

/** Folio printed on preview PDFs when no folio could be reserved yet. */
const PREVIEW_FOLIO = 'PREVIEW';

export interface ToastState {
  tone: Tone;
  title: string;
  msg: string;
}

let nextId = 1;

export function useTravelRequest(initialCurrency: Currency, prefix: string, endpoint?: string) {
  // Email of the logged-in user (from the session ticket); '' until it is known.
  const [accessEmail, setAccessEmail] = useState('');
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Delivery finished: issued folio, recipient + warnings, shown in a modal that leads to the site root.
  const [done, setDone] = useState<{ folio: string; email: string; notes: string[] } | null>(null);
  const [f, setF] = useState<Fields>(emptyFields);
  const [req, setReq] = useState<Record<ReqKey, ReqRow>>(emptyReq);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [folio, setFolio] = useState('');
  const [reserving, setReserving] = useState(false);
  const [issued, setIssued] = useState(false);
  // Session ticket, kept in memory only (renewed by folio.ts when it expires).
  const ticketsRef = useRef<ReturnType<typeof createTicketSource>>();
  if (!ticketsRef.current) ticketsRef.current = createTicketSource();
  const tickets = ticketsRef.current;
  // One folio per request, reserved as soon as the session is known (see folio.ts).
  const reserverRef = useRef<FolioReserver>();
  if (!reserverRef.current) {
    reserverRef.current = createFolioReserver(
      () => issueFolio(endpoint, tickets, prefix),
      (v, busy) => {
        setFolio(v);
        setReserving(busy);
      },
    );
  }
  const reserver = reserverRef.current;
  // Step shown by the blocking loader while preview/send wait ('' = hidden).
  const [step, setStep] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number>();
  const urlRef = useRef('');

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const notify = useCallback((tone: Tone, title: string, msg: string): void => {
    window.clearTimeout(toastTimer.current);
    setToast({ tone, title, msg });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  // A lost session sends the user to the login; anything else is reported by the caller.
  const sessionGone = (err: unknown): boolean => {
    if (!(err instanceof SessionGoneError)) return false;
    window.location.assign(LOGIN_URL);
    return true;
  };

  const reserve = (): void => {
    reserver.ensure().catch((err: unknown) => {
      if (sessionGone(err)) return;
      notify('error', 'No se pudo asignar el folio', `${err instanceof Error ? err.message : String(err)} Se intentará de nuevo al enviar.`);
    });
  };

  // On load: who is logged in (the session ticket), then reserve the folio.
  useEffect(() => {
    let alive = true;
    tickets.get().then(
      ({ email }) => {
        if (!alive) return;
        setAccessEmail(email);
        setF((s) => ({ ...s, email }));
        reserve();
      },
      (err: unknown) => {
        if (!alive || sessionGone(err)) return;
        notify('error', 'No se pudo validar tu sesión', `${err instanceof Error ? err.message : String(err)} Recarga la página.`);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const setField = (k: Field, v: string): void => {
    if (k === 'email') return; // locked to the email of the logged-in user
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => {
      if (!e[k]) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });
  };
  const setReqField = (k: ReqKey, prop: keyof ReqRow, v: string): void =>
    setReq((s) => ({ ...s, [k]: { ...s[k], [prop]: v } }));

  const addFiles = (list: FileList): void => {
    const arr: Attachment[] = Array.from(list).map((file) => ({
      id: nextId++, file, name: file.name, size: file.size, ...fileKind(file.name),
    }));
    if (!arr.length) return;
    const big = arr.find((a) => a.size > MAX_MB * 1048576);
    if (big) {
      notify('error', 'Archivo demasiado grande', `${big.name} supera ${MAX_MB} MB.`);
      return;
    }
    setFiles((s) => [...s, ...arr]);
  };
  const removeFile = (id: number): void => setFiles((s) => s.filter((x) => x.id !== id));

  const check = (): boolean => {
    const e = validate(f);
    setErrors(e);
    const keys = Object.keys(e);
    if (!keys.length) return true;
    const first = FIELDS.find((k) => e[k]);
    const el = first ? document.querySelector(`[data-field="${first}"]`) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      window.scrollTo({ top: r.top + window.scrollY - 140, behavior: 'smooth' });
    }
    notify('error', 'Faltan datos', `Revisa ${keys.length} ${keys.length === 1 ? 'campo marcado' : 'campos marcados'} antes de continuar.`);
    return false;
  };

  const build = async (pdfFolio: string): Promise<{ url: string; failed: string[]; bytes: Uint8Array }> => {
    const { buildPdf } = await import('./pdf');
    const { bytes, failed } = await buildPdf({ f, req, files, folio: pdfFolio, currency });
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    // Copy into a plain ArrayBuffer-backed view: Blob does not accept SharedArrayBuffer views.
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    urlRef.current = url;
    setPreviewUrl(url);
    return { url, failed, bytes };
  };

  const preview = async (): Promise<void> => {
    if (busyPreview || !check()) return;
    setBusyPreview(true);
    try {
      // Show the reserved folio; wait for it if the reservation is still in flight.
      if (reserver.pending) setStep('Asignando folio…');
      const reserved = await (reserver.pending ?? Promise.resolve(reserver.current)).catch(() => '');
      setStep('Generando vista previa…');
      const { failed } = await build(reserved || PREVIEW_FOLIO);
      setPreviewOpen(true);
      if (failed.length) notify('warning', 'Adjuntos no fusionados', failed.join(', '));
    } catch (err) {
      notify('error', 'No se pudo generar el PDF', err instanceof Error ? err.message : String(err));
    } finally {
      setStep('');
      setBusyPreview(false);
    }
  };

  // "Enviar a mi correo" validates first, then asks the user to confirm the
  // currency of their expenses; the PDF is only generated after that confirmation.
  const requestSend = (): void => {
    if (busySend || !check()) return;
    setPreviewOpen(false);
    setConfirmOpen(true);
  };
  const confirmSend = (): void => {
    setConfirmOpen(false);
    void send();
  };

  const send = async (): Promise<void> => {
    if (busySend || !check()) return;
    setBusySend(true);
    // Uses the folio reserved on load (or waits for / retries that reservation);
    // it is kept even if the build or the delivery fails, so a retry never burns a new number.
    let current: string;
    try {
      if (!reserver.current) setStep('Asignando folio…');
      current = await reserver.ensure();
    } catch (err) {
      if (!sessionGone(err)) notify('error', 'No se pudo asignar el folio', err instanceof Error ? err.message : String(err));
      setStep('');
      setBusySend(false);
      return;
    }
    try {
      setStep('Generando PDF…');
      const { failed, bytes } = await build(current);
      setStep('Enviando a tu correo…');
      try {
        await deliverPdf(endpoint, tickets, current, bytes);
      } catch (err) {
        if (sessionGone(err)) return;
        notify('error', 'No se pudo enviar el correo', err instanceof Error ? err.message : String(err));
        return;
      }
      setIssued(true);
      setToast(null);
      setDone({
        folio: current,
        email: accessEmail,
        notes: failed.length ? [`No se fusionó: ${failed.join(', ')}.`] : [],
      });
    } catch (err) {
      notify('error', 'No se pudo generar el PDF', err instanceof Error ? err.message : String(err));
    } finally {
      setStep('');
      setBusySend(false);
    }
  };

  const reset = (): void => {
    // A reset while a folio is being issued would hand that folio to the new form.
    if (busySend) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
    setF({ ...emptyFields(), email: accessEmail });
    setReq(emptyReq());
    setFiles([]);
    setErrors({});
    setPreviewUrl('');
    setPreviewOpen(false);
    setConfirmOpen(false);
    setCurrency(initialCurrency);
    setToast(null);
    // A folio that was never sent stays with the new request (no number
    // burned); once sent, the new request reserves its own.
    if (issued) {
      setIssued(false);
      reserver.clear();
      reserve();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const closeToast = useCallback(() => setToast(null), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  // Closing the "sent" modal leaves the page, so staying here cannot
  // reserve another folio by accident.
  const closeDone = useCallback(() => window.location.assign(import.meta.env.BASE_URL || '/'), []);

  return {
    currency, setCurrency, confirmOpen, done, closeDone, accessEmail,
    f, req, files, errors, folio, reserving, issued, step, previewUrl, previewOpen, busyPreview, busySend, toast,
    setField, setReqField, addFiles, removeFile,
    preview, requestSend, confirmSend, reset, closePreview, closeToast, closeConfirm,
  };
}
