/**
 * Travel request PDF (pdf-lib). Port of the prototype's buildPdf(): Letter page,
 * header with logo + folio + gradient rule, sections 01 Request (incl. direct
 * manager), 02 Special requirements + total and 03 Attachments, attachments
 * merged (PDF pages copied, images as one page each, other formats only listed) and a
 * footer on every page. Uses the PDF standard fonts: the Proxima Nova / Rakesly
 * TTFs are not shipped because their web licence is unconfirmed.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { REQ, fmtSize, money, num, total, type TravelData } from './model';

const LOGO = '/assets/segula-logo-classic-darkblue.png';

// Standard fonts only encode WinAnsi: keep Latin-1 plus a few typographic marks,
// strip diacritics from anything else and drop what still cannot be encoded.
const EXTRA = new Set(['–', '—', '‘', '’', '“', '”', '•']);
const encodable = (ch: string): boolean => {
  const c = ch.charCodeAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRA.has(ch);
};
export const clean = (s: unknown): string =>
  Array.from(String(s ?? '').replace(/\t/g, ' '))
    .map((ch) => (encodable(ch) ? ch : ch.normalize('NFD').charAt(0)))
    .filter(encodable)
    .join('');

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const C = {
  dark: hex('#0A1220'), navy: hex('#174564'), blue: hex('#008FD5'),
  muted: hex('#5A6B85'), line: hex('#DCE4F0'), panel: hex('#F2F5FA'),
};

const fmtDate = (d: string): string =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export interface PdfResult {
  bytes: Uint8Array;
  failed: string[];
}

export async function buildPdf(d: TravelData): Promise<PdfResult> {
  const { f, req, files, folio, currency: cur } = d;
  const doc = await PDFDocument.create();
  doc.setTitle(`Travel request ${folio}`);
  doc.setAuthor('SEGULA Technologies');
  doc.setSubject('Travel request & authorization');

  const F = {
    black: await doc.embedFont(StandardFonts.HelveticaBold),
    reg: await doc.embedFont(StandardFonts.Helvetica),
    semi: await doc.embedFont(StandardFonts.HelveticaBold),
    tech: await doc.embedFont(StandardFonts.Courier),
  };
  let logo: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  try {
    const r = await fetch(LOGO);
    if (r.ok) logo = await doc.embedPng(new Uint8Array(await r.arrayBuffer()));
  } catch {
    logo = null;
  }

  const W = 612, H = 792, M = 48, CW = W - 2 * M;
  let pg!: PDFPage;
  let y = 0;

  const text = (s: string, x: number, yy: number, o: { size: number; font: PDFFont; color?: RGB }): void => {
    pg.drawText(clean(s), { x, y: yy, size: o.size, font: o.font, color: o.color ?? C.dark });
  };
  const tw = (s: string, font: PDFFont, size: number): number => font.widthOfTextAtSize(clean(s), size);
  const gradient = (x: number, yy: number, w: number, h: number): void => {
    const st = [[61, 154, 254], [146, 105, 189], [231, 57, 125]];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const [a, b, k] = t < 0.5 ? [st[0], st[1], t * 2] : [st[1], st[2], (t - 0.5) * 2];
      const c = a.map((v, j) => (v + (b[j] - v) * k) / 255);
      pg.drawRectangle({ x: x + (w * i) / n, y: yy, width: w / n + 0.4, height: h, color: rgb(c[0], c[1], c[2]) });
    }
  };
  const wrap = (s: string, font: PDFFont, size: number, maxW: number): string[] => {
    const out: string[] = [];
    clean(s).split(/\r?\n/).forEach((par) => {
      let line = '';
      par.split(/\s+/).filter(Boolean).forEach((w) => {
        const t = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(t, size) <= maxW) line = t;
        else {
          if (line) out.push(line);
          line = w;
        }
      });
      out.push(line);
    });
    return out.length ? out : [''];
  };
  const newPage = (): void => {
    pg = doc.addPage([W, H]);
    y = H - M;
    if (logo) {
      const lh = 20;
      pg.drawImage(logo, { x: M, y: y - lh, width: (lh * logo.width) / logo.height, height: lh });
    }
    const t = 'TRAVEL REQUEST & AUTHORIZATION';
    text(t, W - M - tw(t, F.black, 11), y - 10, { size: 11, font: F.black, color: C.navy });
    text(folio, W - M - tw(folio, F.tech, 9), y - 24, { size: 9, font: F.tech, color: C.blue });
    y -= 34;
    gradient(M, y, CW, 3);
    y -= 24;
  };
  const ensure = (h: number): void => {
    if (y - h < M + 24) newPage();
  };
  const section = (n: string, title: string): void => {
    ensure(56);
    text(`${n} · ${title.toUpperCase()}`, M, y - 8, { size: 7.5, font: F.tech, color: C.blue });
    y -= 22;
    text(title, M, y, { size: 13, font: F.black, color: C.navy });
    y -= 7;
    gradient(M, y - 2.5, 120, 2.5);
    y -= 18;
  };
  const row = (items: [string, string, number][]): void => {
    const unit = CW / 12;
    const lines = items.map(([, v, span]) => wrap(v || '—', F.reg, 10, unit * span - 10));
    const h = Math.max(...lines.map((l) => 10 + l.length * 13 + 8));
    ensure(h + 8);
    let x = M;
    items.forEach(([label, value, span], i) => {
      const w = unit * span;
      text(label.toUpperCase(), x, y - 8, { size: 6.5, font: F.tech, color: C.muted });
      lines[i].forEach((l, j) => text(l, x, y - 21 - j * 13, { size: 10, font: F.reg, color: value ? C.dark : C.muted }));
      pg.drawLine({ start: { x, y: y - h + 2 }, end: { x: x + w - 12, y: y - h + 2 }, thickness: 0.6, color: C.line });
      x += w;
    });
    y -= h + 8;
  };
  type Col = { label: string; w: number; align?: 'right' };
  const table = (cols: Col[], rows: string[][]): void => {
    const pad = 6;
    const head = (): void => {
      ensure(26);
      pg.drawRectangle({ x: M, y: y - 18, width: CW, height: 18, color: C.panel });
      let x = M;
      cols.forEach((c) => {
        const w = CW * c.w;
        const l = c.label.toUpperCase();
        text(l, c.align === 'right' ? x + w - pad - tw(l, F.tech, 7) : x + pad, y - 12, { size: 7, font: F.tech, color: C.muted });
        x += w;
      });
      y -= 18;
    };
    head();
    rows.forEach((r) => {
      const cells = r.map((v, i) => wrap(v || '—', i === 0 ? F.semi : F.reg, 9.5, CW * cols[i].w - 2 * pad));
      const h = Math.max(...cells.map((c) => c.length)) * 12 + 10;
      if (y - h < M + 24) {
        newPage();
        head();
      }
      let x = M;
      cells.forEach((lines, i) => {
        const w = CW * cols[i].w;
        const font = i === 0 ? F.semi : F.reg;
        lines.forEach((l, j) =>
          text(l, cols[i].align === 'right' ? x + w - pad - tw(l, font, 9.5) : x + pad, y - 13 - j * 12, {
            size: 9.5, font, color: r[i] ? C.dark : C.muted,
          }),
        );
        x += w;
      });
      y -= h;
      pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: C.line });
    });
    y -= 14;
  };
  const amount = (v: string): string => (num(v) ? `$ ${money(v)} ${cur}` : '');

  newPage();
  section('01', 'Request');
  row([['Request date', fmtDate(f.requestDate), 3], ["Employee's full name", f.employeeName, 5], ['Employee number / TID', f.employeeNumber, 4]]);
  row([['SEGULA email', f.email, 6], ['Client / Project', f.clientProject, 6]]);
  row([['Travel objective', f.objective, 12]]);
  row([['Departure date', fmtDate(f.departureDate), 3], ['Return date', fmtDate(f.returnDate), 3], ['Origin of the trip', f.origin, 6]]);
  row([['Destination', f.destination, 4], ['Destination address', f.destinationAddress, 8]]);
  row([['Return destination', f.returnDestination, 6], ['PO to invoice', f.po, 6]]);
  row([['Direct manager', f.managerName, 6], ['Direct manager position', f.managerPosition, 6]]);

  section('02', 'Special requirements');
  table(
    [{ label: 'Concept', w: 0.22 }, { label: 'Details / instructions', w: 0.56 }, { label: 'Approved cost', w: 0.22, align: 'right' }],
    REQ.map((r) => [r.en, req[r.key].details, amount(req[r.key].cost)]),
  );

  ensure(52);
  pg.drawRectangle({ x: W - M - 240, y: y - 44, width: 240, height: 44, color: C.panel });
  pg.drawRectangle({ x: W - M - 240, y: y - 44, width: 3, height: 44, color: C.blue });
  text('TOTAL COST APPROVED', W - M - 226, y - 14, { size: 7, font: F.tech, color: C.muted });
  const tot = `$ ${money(total(d))} ${cur}`;
  text(tot, W - M - 12 - tw(tot, F.black, 14), y - 34, { size: 14, font: F.black, color: C.navy });
  y -= 60;

  // Without attachments the section is omitted entirely, so a typical request
  // fits on a single page instead of spilling a "No attachments." page.
  if (files.length) {
    section('03', 'Attachments');
    table(
      [{ label: '#', w: 0.06 }, { label: 'File', w: 0.5 }, { label: 'Size', w: 0.14, align: 'right' }, { label: 'Status', w: 0.3 }],
      files.map((fl, i) => [
        String(i + 1),
        fl.name,
        fmtSize(fl.size),
        fl.kind === 'other' ? `Listed only · ${fl.ext.toUpperCase()} cannot be merged` : 'Merged in this document',
      ]),
    );
  }

  const failed: string[] = [];
  for (const fl of files) {
    if (fl.kind === 'other') continue;
    try {
      const bytes = new Uint8Array(await fl.file.arrayBuffer());
      if (fl.kind === 'pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copied = await doc.copyPages(src, src.getPageIndices());
        copied.forEach((p) => doc.addPage(p));
      } else {
        const img = fl.ext === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const p = doc.addPage([W, H]);
        const sc = Math.min(CW / img.width, (H - 2 * M - 40) / img.height);
        const w = img.width * sc, h = img.height * sc;
        p.drawText(clean(`ATTACHMENT · ${fl.name}`), { x: M, y: H - M - 4, size: 7, font: F.tech, color: C.muted });
        p.drawImage(img, { x: (W - w) / 2, y: M + 16 + (H - 2 * M - 40 - h) / 2, width: w, height: h });
      }
    } catch {
      failed.push(fl.name);
    }
  }

  const all = doc.getPages();
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  all.forEach((p, i) => {
    const { width } = p.getSize();
    p.drawText(clean(`SEGULA Technologies · Travel request ${folio} · Page ${i + 1} of ${all.length}`), {
      x: 48, y: 18, size: 7, font: F.tech, color: C.muted,
    });
    p.drawText(today, { x: width - 48 - F.tech.widthOfTextAtSize(today, 7), y: 18, size: 7, font: F.tech, color: C.muted });
  });

  return { bytes: await doc.save(), failed };
}
