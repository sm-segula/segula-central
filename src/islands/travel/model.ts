/**
 * Travel request model: fields, requirement rows, validation and number helpers.
 * No dependencies, so the island can import it without pulling pdf-lib.
 */
export type Currency = 'MXN' | 'USD' | 'EUR';

export const FIELDS = [
  'requestDate', 'employeeName', 'employeeNumber', 'email', 'clientProject', 'objective',
  'departureDate', 'returnDate', 'origin', 'destination', 'destinationAddress', 'returnDestination',
  'po', 'managerName', 'managerPosition',
] as const;
export type Field = (typeof FIELDS)[number];
export type Fields = Record<Field, string>;

export const REQUIRED: Field[] = [
  'employeeName', 'employeeNumber', 'email', 'clientProject', 'objective',
  'departureDate', 'returnDate', 'origin', 'destination', 'managerName', 'managerPosition',
];

export const REQ = [
  { key: 'transport', label: 'Transporte', en: 'Transportation', icon: 'plane' },
  { key: 'hotel', label: 'Hotel', en: 'Hotel', icon: 'bed-double' },
  { key: 'meals', label: 'Comidas', en: 'Meals', icon: 'utensils' },
  { key: 'taxi', label: 'Taxi', en: 'Taxi', icon: 'car-taxi-front' },
  { key: 'tolls', label: 'Casetas', en: 'Tolls', icon: 'route' },
  { key: 'others', label: 'Otros', en: 'Others', icon: 'package' },
] as const;
export type ReqKey = (typeof REQ)[number]['key'];
export type ReqRow = { details: string; cost: string };

export type FileKind = 'pdf' | 'image' | 'other';
export type Attachment = { id: number; file: File; name: string; size: number; kind: FileKind; ext: string };

export interface TravelData {
  f: Fields;
  req: Record<ReqKey, ReqRow>;
  files: Attachment[];
  folio: string;
  currency: Currency;
}

export const MAX_MB = 25;

export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const emptyFields = (): Fields => {
  const f = Object.fromEntries(FIELDS.map((k) => [k, ''])) as Fields;
  f.requestDate = today();
  return f;
};
export const emptyReq = (): Record<ReqKey, ReqRow> =>
  Object.fromEntries(REQ.map((r) => [r.key, { details: '', cost: '' }])) as Record<ReqKey, ReqRow>;

export const fileKind = (name: string): { kind: FileKind; ext: string } => {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const kind: FileKind = ext === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg'].includes(ext) ? 'image' : 'other';
  return { kind, ext };
};

export function validate(f: Fields): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  REQUIRED.forEach((k) => {
    if (!String(f[k] ?? '').trim()) e[k] = 'Campo obligatorio.';
  });
  // The full name doubles as the requester signature in the PDF: at least two words.
  if (!e.employeeName && f.employeeName.trim().split(/\s+/).length < 2) {
    e.employeeName = 'Escribe tu nombre completo (mínimo 2 palabras).';
  }
  if (f.email && !e.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = 'Escribe un correo válido.';
  if (f.departureDate && f.returnDate && f.returnDate < f.departureDate) {
    e.returnDate = 'La fecha de regreso no puede ser anterior a la salida.';
  }
  return e;
}

export const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};
export const money = (v: unknown): string =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(v));
export const total = (d: Pick<TravelData, 'req'>): number =>
  Object.values(d.req).reduce((t, r) => t + num(r.cost), 0);
export const fmtSize = (b: number): string =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Folio counter: browser-local, as in the prototype (no backend yet). */
const SEQ_KEY = 'segula.viajes.seq';
export const readSeq = (): number => {
  try {
    return parseInt(localStorage.getItem(SEQ_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
};
export const bumpSeq = (): void => {
  try {
    localStorage.setItem(SEQ_KEY, String(readSeq() + 1));
  } catch {
    /* storage blocked: folio stays the same next time */
  }
};
export const peekFolio = (prefix = 'SEG-VJ'): string =>
  `${prefix}-${new Date().getFullYear()}-${String(readSeq() + 1).padStart(6, '0')}`;
