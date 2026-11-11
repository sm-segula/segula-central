// Loads apps-script/travel-folio/Code.gs into a vm context with in-memory mocks
// of the Apps Script services it uses. Not a test file (no *.test.mjs suffix).
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(here, '..', '..', 'apps-script', 'travel-folio', 'Code.gs'), 'utf8');

export const SECRET = 'test-shared-secret-0123456789';
export const HEADERS = ['Folio', 'Reservado', 'Correo', 'Descargado', 'Archivo'];

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuffer = (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuffer(v));

export function makeSheet(rows = []) {
  const data = rows.map((r) => r.slice());
  let maxCols = 5;
  let frozen = 0;
  const sh = {
    data,
    get frozen() {
      return frozen;
    },
    getMaxColumns: () => maxCols,
    insertColumnsAfter: (_p, n) => {
      maxCols += n;
    },
    getLastRow: () => data.length,
    setFrozenRows: (n) => {
      frozen = n;
    },
    appendRow: (r) => {
      data.push(r.slice());
    },
    insertRowBefore: (n) => {
      data.splice(n - 1, 0, []);
    },
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValue: () => (data[r - 1] || [])[c - 1] ?? '',
      setValue: (v) => {
        while (data.length < r) data.push([]);
        data[r - 1][c - 1] = v;
      },
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) row.push((data[r - 1 + i] || [])[c - 1 + j] ?? '');
          out.push(row);
        }
        return out;
      },
      setValues: (vals) => {
        vals.forEach((vr, i) => {
          while (data.length < r + i) data.push([]);
          vr.forEach((v, j) => {
            data[r - 1 + i][c - 1 + j] = v;
          });
        });
      },
    }),
  };
  return sh;
}

export function load(opts = {}) {
  const clock = { now: Date.UTC(2026, 5, 1, 12, 0, 0) };
  class FakeDate extends Date {
    constructor(...a) {
      if (a.length === 0) super(clock.now);
      else super(...a);
    }
    static now() {
      return clock.now;
    }
  }

  const props = new Map();
  if (opts.secret !== null) props.set('AUTH_SHARED_SECRET', opts.secret ?? SECRET);
  if (opts.folderId !== null) props.set('DRIVE_FOLDER_ID', opts.folderId ?? 'folder-1');
  for (const [k, v] of Object.entries(opts.props || {})) props.set(k, v);

  const cacheData = new Map(); // key -> { value, expires }
  const cache = {
    get: (k) => {
      const e = cacheData.get(k);
      if (!e) return null;
      if (e.expires <= clock.now) {
        cacheData.delete(k);
        return null;
      }
      return e.value;
    },
    put: (k, v, ttl = 600) => {
      cacheData.set(k, { value: String(v), expires: clock.now + ttl * 1000 });
    },
    remove: (k) => {
      cacheData.delete(k);
    },
  };

  const state = {
    clock,
    props,
    propKeys: () => [...props.keys()],
    propDump: () => Object.fromEntries(props),
    cacheData,
    mails: [],
    mailFail: false,
    lockBusy: false,
    files: [],
    createFileFails: false,
    folderFiles: opts.folderFiles ?? {},
    listFails: false,
    errors: [],
    sheet: opts.sheet ?? makeSheet([HEADERS]),
    sheets: new Map(),
    uuidCounter: 0,
    quota: 100,
  };
  if (opts.sheet !== null) state.sheets.set('Folios', state.sheet);

  const ss = {
    getSheetByName: (n) => state.sheets.get(n) || null,
    insertSheet: (n) => {
      const s = makeSheet([]);
      state.sheets.set(n, s);
      state.sheet = s;
      return s;
    },
  };

  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    computeDigest: (_alg, v) => toSigned(crypto.createHash('sha256').update(toBuf(v)).digest()),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
    // Apps Script keeps '=' padding here.
    base64EncodeWebSafe: (v) => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => {
      if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error('Invalid base64');
      return toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    },
    base64Decode: (s) => {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('Invalid base64');
      return toSigned(Buffer.from(s, 'base64'));
    },
    newBlob: (bytes, type, name) => ({
      getBytes: () => bytes,
      getContentType: () => type,
      getName: () => name,
      getDataAsString: () => toBuffer(bytes).toString('utf8'),
    }),
  };

  const ctx = {
    console: {
      error: (...a) => state.errors.push(a.join(' ')),
      log: () => {},
    },
    Logger: { log: (m) => (state.logs = [...(state.logs || []), m]) },
    Date: FakeDate,
    JSON,
    Math,
    Number,
    String,
    Error,
    isFinite,
    Utilities,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k),
        getKeys: () => [...props.keys()],
      }),
    },
    CacheService: { getScriptCache: () => cache },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => !state.lockBusy,
        releaseLock: () => {},
      }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    DriveApp: {
      getFolderById: (id) => {
        if (opts.folderMissing) throw new Error('not found ' + id);
        return {
          getName: () => 'Viajes',
          getFiles: () => {
            if (state.listFails) throw new Error('drive down');
            const list = (state.folderFiles[id] || []).map((f) => ({
              getId: () => f.id,
              getName: () => f.name,
              getMimeType: () => f.mime,
              getDateCreated: () => new Date(f.created),
            }));
            let i = 0;
            return { hasNext: () => i < list.length, next: () => list[i++] };
          },
          createFile: (blob) => {
            if (state.createFileFails) throw new Error('drive down');
            const f = { blob, trashed: false, getUrl: () => 'https://drive.example/' + blob.getName(), setTrashed: (v) => (f.trashed = v) };
            state.files.push(f);
            return f;
          },
        };
      },
    },
    MailApp: {
      sendEmail: (msg) => {
        if (state.mailFail) throw new Error('mail down');
        state.mails.push(msg);
      },
      getRemainingDailyQuota: () => state.quota,
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (s) => ({ getContent: () => s, setMimeType() { return this; } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });

  const post = (body) => {
    const out = ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
    return JSON.parse(out.getContent());
  };
  return { ctx, state, post, clock };
}

const b64u = (b) => Buffer.from(b).toString('base64url'); // no padding

// Same construction the Vercel side uses.
export function makeTicket(email, expSeconds, secret = SECRET, extra = {}) {
  const p = b64u(JSON.stringify({ email, exp: expSeconds, ...extra }));
  const s = b64u(crypto.createHmac('sha256', secret).update(p).digest());
  return `${p}.${s}`;
}

export const nowSec = (h) => Math.floor(h.clock.now / 1000);
export const validTicket = (h, email = 'ana@segulagrp.com', extra = {}) => makeTicket(email, nowSec(h) + 900, SECRET, extra);

export const PDF_B64 = Buffer.from('%PDF-1.7\nhello\n').toString('base64');

export function lastCode(h) {
  const m = h.state.mails[h.state.mails.length - 1];
  return /\b(\d{6})\b/.exec(m.body)[1];
}
