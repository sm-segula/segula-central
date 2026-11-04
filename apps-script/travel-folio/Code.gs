/**
 * SEGULA Travel folio service (Google Apps Script web app).
 *
 * Two actions, both POST with a JSON body:
 * - "reserve" (default): issues folios STRA-VJ-<year>-<6-digit sequence> one at
 *   a time under a script lock, so two people never get the same number. The
 *   counter lives in Script Properties (one key per year) and every folio is
 *   logged as a row in the "Folios" sheet (Folio, Reservado, Correo, Descargado).
 * - "downloaded": stamps the "Descargado" column of that folio's row with the
 *   first download time. Rows left empty are reservations nobody downloaded.
 * - "archive": internal copy. Saves the downloaded PDF (base64) as <folio>.pdf in
 *   the Drive folder of Script Property DRIVE_FOLDER_ID and writes its link in
 *   the "Archivo" column. The requester is never told about this copy.
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
// Apps Script documents no doPost payload limit; 20 MB of PDF (~27 MB of base64)
// is a conservative cap chosen for the internal copy.
var MAX_PDF_BYTES = 20 * 1024 * 1024;

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (!body || typeof body !== 'object') return json_({ ok: false, error: 'bad_request' });
  var email = String(body.email || '').trim().toLowerCase();
  if (!CORPORATE.test(email)) return json_({ ok: false, error: 'invalid_email' });
  var action = body.action || 'reserve';
  if (action === 'reserve') return reserve_(email);
  if (action === 'downloaded') return downloaded_(email, String(body.folio || ''));
  if (action === 'archive') return archive_(email, String(body.folio || ''), body.pdf);
  return json_({ ok: false, error: 'bad_request' });
}

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

// Only the email that reserved the folio can mark it; the first download time is kept.
function downloaded_(email, folio) {
  if (!FOLIO.test(folio)) return json_({ ok: false, error: 'bad_request' });
  try {
    var sh = sheet_();
    var row = findRow_(sh, folio, email);
    if (row < 0) return json_({ ok: false, error: 'not_found' });
    var cell = sh.getRange(row, 4);
    if (!cell.getValue()) cell.setValue(new Date());
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  }
}

// Internal copy of the downloaded PDF in Drive, linked in "Archivo". Only the
// email that reserved the folio can send it, and the first copy is kept. The
// file inherits the folder's sharing: it is never shared by link.
function archive_(email, folio, pdf) {
  if (!FOLIO.test(folio) || typeof pdf !== 'string' || !pdf) return json_({ ok: false, error: 'bad_request' });
  // base64 is 4/3 of the bytes: refuse oversized payloads before decoding them.
  if (pdf.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) return json_({ ok: false, error: 'too_large' });
  var file = null;
  try {
    var folderId = folderId_();
    if (!folderId) {
      console.error('archive ' + folio + ': missing Script Property ' + DRIVE_FOLDER_KEY);
      return json_({ ok: false, error: 'not_configured' });
    }
    var sh = sheet_();
    var row = findRow_(sh, folio, email);
    if (row < 0) return json_({ ok: false, error: 'not_found' });
    if (sh.getRange(row, 5).getValue()) return json_({ ok: true }); // already archived
    var bytes;
    try {
      bytes = Utilities.base64Decode(pdf);
    } catch (err) {
      return json_({ ok: false, error: 'bad_request' });
    }
    if (bytes.length > MAX_PDF_BYTES || !isPdf_(bytes)) return json_({ ok: false, error: 'bad_request' });
    file = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, 'application/pdf', folio + '.pdf'));
    // Claim the cell under the lock, so two uploads of one folio write one link;
    // the upload that loses keeps no file behind.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) {
      discard_(file);
      return json_({ ok: false, error: 'busy' });
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
    return json_({ ok: true });
  } catch (err) {
    // The requester is never told; the Executions panel keeps the cause.
    console.error('archive ' + folio + ': ' + (err && err.message ? err.message : err));
    if (file) discard_(file);
    return json_({ ok: false, error: 'server_error' });
  }
}

function folderId_() {
  return String(PropertiesService.getScriptProperties().getProperty(DRIVE_FOLDER_KEY) || '').trim();
}

/**
 * Run once from the editor (select checkSetup, then Ejecutar): Google asks to
 * authorize Drive, and the log shows whether DRIVE_FOLDER_ID opens the folder.
 * Creates nothing.
 */
function checkSetup() {
  var id = folderId_();
  if (!id) throw new Error('Falta la propiedad del script ' + DRIVE_FOLDER_KEY + '.');
  var folder;
  try {
    folder = DriveApp.getFolderById(id);
  } catch (err) {
    throw new Error('No se pudo abrir la carpeta ' + id + ': ' + (err && err.message ? err.message : err));
  }
  Logger.log('Carpeta OK: "' + folder.getName() + '" (' + id + '). Las copias se guardarán ahí.');
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
