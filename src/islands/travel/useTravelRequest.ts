/**
 * State and actions of the travel request form (port of the prototype's
 * Component class). The PDF module is imported on demand so pdf-lib is only
 * downloaded when the user asks for a preview or a download. The page opens
 * behind an access gate (corporate email) and the folio is issued only when
 * the user confirms the download.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  FIELDS, MAX_MB, emptyFields, emptyReq, fileKind, validate,
  type Attachment, type Currency, type Field, type Fields, type ReqKey, type ReqRow,
} from './model';
import { EMAIL_ERROR, isCorporateEmail, issueFolio, normalizeEmail, readRememberedEmail, rememberEmail } from './folio';
import type { Tone } from './ui';

/** Folio printed on preview PDFs, before the real one is issued at download. */
const PREVIEW_FOLIO = 'PREVIEW';

export interface ToastState {
  tone: Tone;
  title: string;
  msg: string;
}

let nextId = 1;

export function useTravelRequest(initialCurrency: Currency, prefix: string, endpoint?: string) {
  const [gateOpen, setGateOpen] = useState(true);
  const [gateEmail, setGateEmail] = useState('');
  const [gateRemember, setGateRemember] = useState(false);
  const [gateError, setGateError] = useState('');
  const [accessEmail, setAccessEmail] = useState('');
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [f, setF] = useState<Fields>(emptyFields);
  const [req, setReq] = useState<Record<ReqKey, ReqRow>>(emptyReq);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [folio, setFolio] = useState('');
  const [issued, setIssued] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busyDownload, setBusyDownload] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number>();
  const urlRef = useRef('');

  // localStorage only exists in the browser: read the remembered email after mount.
  useEffect(() => {
    const saved = readRememberedEmail();
    if (saved) {
      setGateEmail(saved);
      setGateRemember(true);
    }
  }, []);
  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const notify = useCallback((tone: Tone, title: string, msg: string): void => {
    window.clearTimeout(toastTimer.current);
    setToast({ tone, title, msg });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  // Unchecking "Recordar correo" forgets the stored email right away.
  const toggleRemember = (v: boolean): void => {
    setGateRemember(v);
    if (!v) rememberEmail('', false);
  };
  const setGateField = (v: string): void => {
    setGateEmail(v);
    setGateError('');
  };
  // Access gate: any rejection gets the same message, with no hint of the domain.
  const enter = (): void => {
    const email = normalizeEmail(gateEmail);
    if (!isCorporateEmail(email)) {
      setGateError(EMAIL_ERROR);
      return;
    }
    rememberEmail(email, gateRemember);
    setAccessEmail(email);
    setF((s) => ({ ...s, email }));
    setGateOpen(false);
  };

  const setField = (k: Field, v: string): void => {
    if (k === 'email') return; // locked to the email given at the access gate
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

  const build = async (pdfFolio: string): Promise<{ url: string; failed: string[] }> => {
    const { buildPdf } = await import('./pdf');
    const { bytes, failed } = await buildPdf({ f, req, files, folio: pdfFolio, currency });
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    // Copy into a plain ArrayBuffer-backed view: Blob does not accept SharedArrayBuffer views.
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    urlRef.current = url;
    setPreviewUrl(url);
    return { url, failed };
  };

  const preview = async (): Promise<void> => {
    if (busyPreview || !check()) return;
    setBusyPreview(true);
    try {
      const { failed } = await build(folio || PREVIEW_FOLIO);
      setPreviewOpen(true);
      if (failed.length) notify('warning', 'Adjuntos no fusionados', failed.join(', '));
    } catch (err) {
      notify('error', 'No se pudo generar el PDF', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPreview(false);
    }
  };

  // "Descargar PDF" validates first, then asks the user to confirm the currency
  // of their expenses; the PDF is only generated after that confirmation.
  const requestDownload = (): void => {
    if (busyDownload || !check()) return;
    setPreviewOpen(false);
    setConfirmOpen(true);
  };
  const confirmDownload = (): void => {
    setConfirmOpen(false);
    void download();
  };

  const download = async (): Promise<void> => {
    if (busyDownload || !check()) return;
    setBusyDownload(true);
    // The folio is issued once per request; later downloads reuse it.
    let current = folio;
    if (!current) {
      try {
        current = await issueFolio(endpoint, accessEmail, prefix);
      } catch (err) {
        notify('error', 'No se pudo asignar el folio', err instanceof Error ? err.message : String(err));
        setBusyDownload(false);
        return;
      }
      // Kept even if the build below fails, so a retry reuses it (no number burned).
      setFolio(current);
    }
    try {
      const { url, failed } = await build(current);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${current}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setIssued(true);
      notify(
        failed.length ? 'warning' : 'success',
        'PDF descargado',
        failed.length ? `Folio ${current}. No se fusionó: ${failed.join(', ')}` : `Folio ${current} emitido.`,
      );
    } catch (err) {
      notify('error', 'No se pudo generar el PDF', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDownload(false);
    }
  };

  const reset = (): void => {
    // A reset while a folio is being issued would hand that folio to the new form.
    if (busyDownload) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
    setF({ ...emptyFields(), email: accessEmail });
    setReq(emptyReq());
    setFiles([]);
    setErrors({});
    setIssued(false);
    setPreviewUrl('');
    setPreviewOpen(false);
    setConfirmOpen(false);
    setCurrency(initialCurrency);
    setToast(null);
    setFolio('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const closeToast = useCallback(() => setToast(null), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  return {
    gateOpen, gateEmail, gateRemember, gateError, setGateField, setGateRemember: toggleRemember, enter,
    currency, setCurrency, confirmOpen,
    f, req, files, errors, folio, issued, previewUrl, previewOpen, busyPreview, busyDownload, toast,
    setField, setReqField, addFiles, removeFile,
    preview, requestDownload, confirmDownload, reset, closePreview, closeToast, closeConfirm,
  };
}
