/**
 * State and actions of the travel request form (port of the prototype's
 * Component class). The PDF module is imported on demand so pdf-lib is only
 * downloaded when the user asks for a preview or a download.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  FIELDS, MAX_MB, bumpSeq, emptyFields, emptyReq, fileKind, peekFolio, validate,
  type Attachment, type Currency, type Field, type Fields, type ReqKey, type ReqRow,
} from './model';
import type { Tone } from './ui';

export interface ToastState {
  tone: Tone;
  title: string;
  msg: string;
}

let nextId = 1;

export function useTravelRequest(initialCurrency: Currency, prefix: string) {
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

  // localStorage only exists in the browser: reserve the folio after mount.
  useEffect(() => setFolio(peekFolio(prefix)), [prefix]);
  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const notify = useCallback((tone: Tone, title: string, msg: string): void => {
    window.clearTimeout(toastTimer.current);
    setToast({ tone, title, msg });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  const setField = (k: Field, v: string): void => {
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

  const build = async (): Promise<{ url: string; failed: string[] }> => {
    const { buildPdf } = await import('./pdf');
    const { bytes, failed } = await buildPdf({ f, req, files, folio, currency });
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
      const { failed } = await build();
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
    try {
      const { url, failed } = await build();
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folio}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (!issued) {
        bumpSeq();
        setIssued(true);
      }
      notify(
        failed.length ? 'warning' : 'success',
        'PDF descargado',
        failed.length ? `Folio ${folio}. No se fusionó: ${failed.join(', ')}` : `Folio ${folio} emitido.`,
      );
    } catch (err) {
      notify('error', 'No se pudo generar el PDF', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDownload(false);
    }
  };

  const reset = (): void => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
    setF(emptyFields());
    setReq(emptyReq());
    setFiles([]);
    setErrors({});
    setIssued(false);
    setPreviewUrl('');
    setPreviewOpen(false);
    setConfirmOpen(false);
    setCurrency(initialCurrency);
    setToast(null);
    setFolio(peekFolio(prefix));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const closeToast = useCallback(() => setToast(null), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  return {
    currency, setCurrency, confirmOpen,
    f, req, files, errors, folio, issued, previewUrl, previewOpen, busyPreview, busyDownload, toast,
    setField, setReqField, addFiles, removeFile,
    preview, requestDownload, confirmDownload, reset, closePreview, closeToast, closeConfirm,
  };
}
