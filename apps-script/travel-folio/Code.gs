/**
 * SEGULA Central service (Google Apps Script web app). Runs as the shared
 * sender account segula-central@segula.mx: every email goes out from it.
 *
 * Every action is a POST with a JSON body and needs Script Property
 * AUTH_SHARED_SECRET (the same value the site middleware holds). Without it
 * every action answers "not_configured" (fail closed).
 *
 * Login (called by the site middleware, authenticated with `key` = the secret):
 * - "otp_request": emails a 6-digit code to a @segulagrp.com address. Only a hash
 *   of the code is kept, in CacheService, for 10 minutes. 60 s cooldown per email.
 * - "otp_verify": checks the code (max 5 wrong attempts per code, then a new one
 *   is required). A correct code is consumed.
 *
 * SEGULA Travel (called by the browser with a `ticket` signed by the middleware;
 * the email is taken ONLY from the verified ticket, never from the body):
 * - "reserve": issues folios STRA-VJ-<year>-<6-digit sequence> one at a time under
 *   a script lock, so two people never get the same number. The counter lives in
 *   Script Properties (one key per year) and every folio is logged as a row in
 *   the "Folios" sheet (Folio, Reservado, Correo, Descargado, Archivo).
 * - "deliver": emails the PDF (base64) to the ticket email, stamps "Descargado"
 *   with the first send time and stores an internal copy in the Drive folder of
 *   Script Property DRIVE_FOLDER_ID, linked in "Archivo" (best effort, never shown).
 *
 * Ticket / token format: base64url(JSON {email, exp}) + "." +
 * base64url(HMAC-SHA256(secret, first part)), both WITHOUT "=" padding; exp is in
 * unix seconds.
 *
 * Setup: see README.md in this folder.
 */
var PREFIX = 'STRA-VJ';
var CORPORATE = /^[a-z0-9._%+-]+@segulagrp\.com$/;
var FOLIO = /^STRA-VJ-\d{4}-\d{6}$/;
var SHEET_NAME = 'Folios';
var HEADERS = ['Folio', 'Reservado', 'Correo', 'Descargado', 'Archivo'];
var LOCK_WAIT_MS = 10000;
var DRIVE_FOLDER_KEY = 'DRIVE_FOLDER_ID';
var SECRET_KEY = 'AUTH_SHARED_SECRET';
var SENDER_NAME = 'SEGULA Central';
var OTP_TTL_S = 600; // a code lives 10 minutes
var OTP_COOLDOWN_S = 60; // one code per email per minute
var OTP_MAX_ATTEMPTS = 5; // wrong codes per email (across codes) before the lock
var OTP_LOCK_S = 86400; // the lock, and the window failures are counted in: 24 h
var OTP_CAP_CODES = 8; // codes per email per window
var OTP_CAP_WINDOW_S = 21600; // 6 h, the longest CacheService TTL
// Apps Script documents no doPost payload limit; 20 MB of PDF (~27 MB of base64)
// is a conservative cap chosen for the email and the internal copy.
var MAX_PDF_BYTES = 20 * 1024 * 1024;

function doPost(e) {
  var secret = secret_();
  if (!secret) {
    console.error('Missing Script Property ' + SECRET_KEY + ': refusing every action.');
    return json_({ ok: false, error: 'not_configured' });
  }
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (!body || typeof body !== 'object') return json_({ ok: false, error: 'bad_request' });
  var action = body.action;
  if (action === 'otp_request' || action === 'otp_verify') {
    if (typeof body.key !== 'string' || !safeEqual_(body.key, secret)) return json_({ ok: false, error: 'unauthorized' });
    var mail = String(body.email || '').trim().toLowerCase();
    if (!CORPORATE.test(mail)) return json_({ ok: false, error: 'invalid_email' });
    return action === 'otp_request' ? otpRequest_(mail, secret) : otpVerify_(mail, String(body.code || ''), secret);
  }
  if (action === 'reserve' || action === 'deliver') {
    var email = ticketEmail_(body.ticket, secret);
    if (!email) return json_({ ok: false, error: 'unauthorized' });
    if (action === 'reserve') return reserve_(email);
    return deliver_(email, String(body.folio || ''), body.pdf);
  }
  // Unknown or retired action ("downloaded", "archive", none): never falls through to reserve.
  return json_({ ok: false, error: 'bad_request' });
}

// ---- Login (OTP) ----

function otpRequest_(email, secret) {
  var cache = CacheService.getScriptCache();
  var id = hmacHex_('id:' + email, secret);
  var otpKey = 'otp-' + id;
  var coolKey = 'cd-' + id;
  var code = newCode_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ ok: false, error: 'busy' });
  try {
    if (isLocked_(failState_(id))) return json_({ ok: false, error: 'too_many_attempts' });
    if (cache.get(coolKey)) return json_({ ok: false, error: 'cooldown' });
    // Per-email cap across codes: 8 codes per 6 h (CacheService's longest TTL),
    // so at most 40 guesses per window. Counted only after the mail is sent.
    var capKey = 'cap-' + id;
    var cap = JSON.parse(cache.get(capKey) || 'null');
    if (cap && cap.n >= OTP_CAP_CODES && Date.now() < cap.e) return json_({ ok: false, error: 'cooldown' });
    // Only a hash of the code is stored, never the code or the address.
    cache.put(otpKey, JSON.stringify({ h: hmacHex_('code:' + email + ':' + code, secret), e: Date.now() + OTP_TTL_S * 1000 }), OTP_TTL_S);
    cache.put(coolKey, '1', OTP_COOLDOWN_S);
  } finally {
    lock.releaseLock();
  }
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Tu código de acceso a SEGULA Central',
      body:
        'Tu código de acceso a SEGULA Central es: ' + code + '\n\n' +
        'El código vence en 10 minutos. Si no lo solicitaste, ignora este correo.',
      htmlBody:
        '<p>Tu código de acceso a SEGULA Central es:</p>' +
        '<p style="font-size:28px;letter-spacing:6px;font-weight:bold">' + code + '</p>' +
        '<p>El código vence en 10 minutos. Si no lo solicitaste, ignora este correo.</p>',
      name: SENDER_NAME
    });
  } catch (err) {
    console.error('otp_request: mail failed: ' + (err && err.message ? err.message : err));
    cache.remove(otpKey);
    cache.remove(coolKey); // the person got nothing: let them ask again right away
    return json_({ ok: false, error: 'server_error' });
  }
  var now = Date.now();
  var cur = JSON.parse(cache.get(capKey) || 'null');
  if (!cur || now >= cur.e) cur = { n: 0, e: now + OTP_CAP_WINDOW_S * 1000 };
  cur.n += 1;
  cache.put(capKey, JSON.stringify(cur), Math.max(1, Math.ceil((cur.e - now) / 1000)));
  return json_({ ok: true });
}

function otpVerify_(email, code, secret) {
  var cache = CacheService.getScriptCache();
  var id = hmacHex_('id:' + email, secret);
  var otpKey = 'otp-' + id;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ ok: false, error: 'busy' });
  try {
    var fails = failState_(id);
    if (isLocked_(fails)) {
      cache.remove(otpKey);
      return json_({ ok: false, error: 'too_many_attempts' });
    }
    var raw = cache.get(otpKey);
    var entry = null;
    try {
      entry = raw ? JSON.parse(raw) : null;
    } catch (err) {
      entry = null;
    }
    if (!entry || typeof entry.h !== 'string') {
      cache.remove(otpKey);
      return json_({ ok: false, error: 'expired' });
    }
    if (/^\d{6}$/.test(code) && safeEqual_(hmacHex_('code:' + email + ':' + code, secret), entry.h)) {
      cache.remove(otpKey); // consumed: a code works once
      PropertiesService.getScriptProperties().deleteProperty('fail-' + id); // success resets the count
      return json_({ ok: true });
    }
    // A wrong code only counts while a code is pending, so the stored entries are
    // bounded by the codes actually mailed (no flooding with made-up addresses).
    if (recordFailure_(id) >= OTP_MAX_ATTEMPTS) {
      cache.remove(otpKey);
      return json_({ ok: false, error: 'too_many_attempts' });
    }
    return json_({ ok: false, error: 'invalid_code' });
  } catch (err) {
    console.error('otp_verify: ' + (err && err.message ? err.message : err));
    return json_({ ok: false, error: 'server_error' });
  } finally {
    lock.releaseLock();
  }
}

// Per-email failure count, in Script Properties because CacheService keeps data
// at most 6 h and the lock lasts 24 h. Keyed by an HMAC of the email (never the
// address). Entry: { t: [failure times in ms, at most 5], u: locked until ms }.
// Sliding window: each failure counts for 24 h after it happened.
// Callers hold the script lock.
function failState_(id) {
  var props = PropertiesService.getScriptProperties();
  var key = 'fail-' + id;
  var entry = cleanFail_(props.getProperty(key), Date.now());
  if (!entry) props.deleteProperty(key);
  return entry;
}

/** Parses a stored entry and drops expired parts; null when nothing is left or it is malformed. */
function cleanFail_(raw, now) {
  var entry = null;
  try {
    entry = JSON.parse(raw || 'null');
  } catch (err) {
    return null;
  }
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.t)) return null;
  var u = typeof entry.u === 'number' && isFinite(entry.u) ? entry.u : 0;
  if (u && now < u) return { t: [], u: u };
  var t = entry.t.filter(function (x) {
    return typeof x === 'number' && isFinite(x) && now - x < OTP_LOCK_S * 1000;
  });
  return t.length ? { t: t } : null;
}

function isLocked_(entry) {
  return !!(entry && entry.u && Date.now() < entry.u);
}

/** Adds one failure and returns how many fall inside the last 24 h; the 5th locks for 24 h. */
function recordFailure_(id) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var entry = failState_(id);
  if (!entry) {
    pruneFailures_(props, now);
    entry = { t: [] };
  }
  entry.t.push(now);
  entry.t = entry.t.slice(-OTP_MAX_ATTEMPTS);
  var n = entry.t.length;
  if (n >= OTP_MAX_ATTEMPTS) entry = { t: [], u: now + OTP_LOCK_S * 1000 };
  props.setProperty('fail-' + id, JSON.stringify(entry));
  return n;
}

function pruneFailures_(props, now) {
  var keys = props.getKeys();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('fail-') !== 0) continue;
    if (!cleanFail_(props.getProperty(keys[i]), now)) props.deleteProperty(keys[i]);
  }
}

// 6 digits from the randomness of Utilities.getUuid() (never Math.random).
function newCode_() {
  var hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return ('000000' + (parseInt(hex, 16) % 1000000)).slice(-6);
}

// ---- Secret, tokens, comparison ----

function secret_() {
  return String(PropertiesService.getScriptProperties().getProperty(SECRET_KEY) || '').trim();
}

// Compare in time that depends only on the longer length, not on where they differ.
function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function hex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return out;
}

function hmacHex_(value, secret) {
  return hex_(Utilities.computeHmacSha256Signature(value, secret));
}

// base64url without "=" padding (Utilities.base64EncodeWebSafe pads).
function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

// Email of a valid ticket `<p>.<s>`, or '' when it is missing, malformed, forged,
// expired or not a corporate address.
function ticketEmail_(ticket, secret) {
  if (typeof ticket !== 'string') return '';
  var parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '';
  if (!safeEqual_(parts[1], b64url_(Utilities.computeHmacSha256Signature(parts[0], secret)))) return '';
  var payload;
  try {
    var p = parts[0];
    while (p.length % 4) p += '=';
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p)).getDataAsString());
  } catch (err) {
    return '';
  }
  if (!payload || typeof payload.exp !== 'number' || !(payload.exp > Math.floor(Date.now() / 1000))) return '';
  if (typeof payload.email !== 'string' || !CORPORATE.test(payload.email)) return '';
  return payload.email;
}

// ---- SEGULA Travel ----

function reserve_(email) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ ok: false, error: 'busy' });
  try {
    var year = new Date().getFullYear();
    var props = PropertiesService.getScriptProperties();
    var key = 'seq-' + year;
    var prev = Number(props.getProperty(key) || '0');
    // A hand-edited, non-numeric or exhausted counter must stop, not issue "000NaN".
    if (!isFinite(prev) || prev < 0 || prev % 1 !== 0 || prev >= 999999) return json_({ ok: false, error: 'server_error' });
    var seq = prev + 1;
    // Open the sheet before touching the counter, so a broken sheet burns no number.
    var sh = sheet_();
    // Save the counter before logging: if the log fails, the number is skipped,
    // never handed out twice.
    props.setProperty(key, String(seq));
    var folio = PREFIX + '-' + year + '-' + ('000000' + seq).slice(-6);
    sh.appendRow([folio, new Date(), email, '']);
    SpreadsheetApp.flush(); // write the row before releasing the lock, so rows stay in folio order
    return json_({ ok: true, folio: folio });
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  } finally {
    lock.releaseLock();
  }
}

// Emails the PDF to the ticket email. Only the email that reserved the folio can
// deliver it. "Descargado" keeps the first send time; the internal Drive copy is
// best effort and never changes the answer.
function deliver_(email, folio, pdf) {
  if (!FOLIO.test(folio) || typeof pdf !== 'string' || !pdf) return json_({ ok: false, error: 'bad_request' });
  // base64 is 4/3 of the bytes: refuse oversized payloads before decoding them.
  if (pdf.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) return json_({ ok: false, error: 'too_large' });
  var sh, row, bytes;
  try {
    sh = sheet_();
    row = findRow_(sh, folio, email);
    if (row < 0) return json_({ ok: false, error: 'not_found' });
    try {
      bytes = Utilities.base64Decode(pdf);
    } catch (err) {
      return json_({ ok: false, error: 'bad_request' });
    }
    if (bytes.length > MAX_PDF_BYTES || !isPdf_(bytes)) return json_({ ok: false, error: 'bad_request' });
    MailApp.sendEmail({
      to: email,
      subject: 'Tu solicitud SEGULA Travel ' + folio,
      body:
        'Hola,\n\nAdjuntamos tu solicitud SEGULA Travel con el folio ' + folio + '.\n\n' +
        'Si no la solicitaste, ignora este correo.',
      htmlBody:
        '<p>Hola,</p><p>Adjuntamos tu solicitud SEGULA Travel con el folio <strong>' + folio + '</strong>.</p>' +
        '<p>Si no la solicitaste, ignora este correo.</p>',
      name: SENDER_NAME,
      attachments: [Utilities.newBlob(bytes, 'application/pdf', folio + '.pdf')]
    });
  } catch (err) {
    console.error('deliver ' + folio + ': ' + (err && err.message ? err.message : err));
    return json_({ ok: false, error: 'server_error' });
  }
  // The email is out: from here on nothing changes the answer.
  try {
    var cell = sh.getRange(row, 4);
    if (!cell.getValue()) cell.setValue(new Date());
  } catch (err) {
    console.error('deliver ' + folio + ': could not stamp Descargado: ' + (err && err.message ? err.message : err));
  }
  archiveCopy_(sh, email, folio, bytes);
  return json_({ ok: true });
}

// Internal copy of the delivered PDF in Drive, linked in "Archivo". The first copy
// is kept. The file inherits the folder's sharing: it is never shared by link.
// Failures are only logged; the requester is never told.
function archiveCopy_(sh, email, folio, bytes) {
  var file = null;
  try {
    var folderId = folderId_();
    if (!folderId) {
      console.error('archive ' + folio + ': missing Script Property ' + DRIVE_FOLDER_KEY);
      return;
    }
    var row = findRow_(sh, folio, email);
    if (row < 0 || sh.getRange(row, 5).getValue()) return; // already archived
    file = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, 'application/pdf', folio + '.pdf'));
    // Claim the cell under the lock, so two sends of one folio write one link;
    // the one that loses keeps no file behind.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) {
      discard_(file);
      return;
    }
    try {
      row = findRow_(sh, folio, email);
      var cell = row < 0 ? null : sh.getRange(row, 5);
      if (!cell || cell.getValue()) {
        discard_(file);
        file = null;
      } else {
        cell.setValue(file.getUrl());
        file = null; // linked from the sheet now: never trash it, even if flush fails
        SpreadsheetApp.flush();
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error('archive ' + folio + ': ' + (err && err.message ? err.message : err));
    if (file) discard_(file);
  }
}

function folderId_() {
  return String(PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_KEY) || '').trim();
}

/**
 * Run once from the editor (select checkSetup, then Ejecutar): Google asks to
 * authorize Drive and sending mail, and the log shows whether AUTH_SHARED_SECRET
 * is set, whether DRIVE_FOLDER_ID opens the folder and the remaining daily mail
 * quota. Creates and sends nothing.
 */
function checkSetup() {
  if (!secret_()) throw new Error('Falta la propiedad del script ' + SECRET_KEY + '.');
  var id = folderId_();
  if (!id) throw new Error('Falta la propiedad del script ' + DRIVE_FOLDER_KEY + '.');
  var folder;
  try {
    folder = DriveApp.getFolderById(id);
  } catch (err) {
    throw new Error('No se pudo abrir la carpeta ' + id + ': ' + (err && err.message ? err.message : err));
  }
  Logger.log('Carpeta OK: "' + folder.getName() + '" (' + id + '). Las copias se guardarán ahí.');
  Logger.log(SECRET_KEY + ' OK.');
  Logger.log('Cuota diaria de correo restante: ' + MailApp.getRemainingDailyQuota());
}

// Row number (1-based) of `folio` when `email` reserved it, otherwise -1.
function findRow_(sh, folio, email) {
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] !== folio) continue;
    return String(rows[i][2]).toLowerCase() === email ? i + 1 : -1;
  }
  return -1;
}

// A PDF file starts with "%PDF" (bytes 37 80 68 70).
function isPdf_(bytes) {
  return bytes.length > 4 && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70;
}

function discard_(file) {
  try {
    file.setTrashed(true);
  } catch (err) {
    /* an orphan copy in the folder is harmless */
  }
}

// Returns the "Folios" sheet with the 5-column header, never overwriting data:
// - missing sheet: created with the header;
// - empty sheet: header written;
// - row 1 holds a folio (tab created by hand, no header): a header row is inserted above;
// - row 1 is an older header ("Folio | Emitido | Correo", or without "Archivo"):
//   only B1 is renamed and empty D1/E1 are filled;
// - anything else in row 1 is left untouched.
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    return sh;
  }
  var n = HEADERS.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, n).setValues([HEADERS]);
    sh.setFrozenRows(1);
    return sh;
  }
  var first = sh.getRange(1, 1, 1, n).getValues()[0];
  if (FOLIO.test(String(first[0]))) {
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, n).setValues([HEADERS]);
    sh.setFrozenRows(1);
  } else if (first[0] === 'Folio') {
    if (first[1] === 'Emitido') sh.getRange(1, 2).setValue('Reservado');
    if (!first[3]) sh.getRange(1, 4).setValue('Descargado');
    if (!first[4]) sh.getRange(1, 5).setValue('Archivo');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
