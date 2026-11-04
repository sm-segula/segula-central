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
 *
 * Setup: see README.md in this folder.
 */
var PREFIX = 'STRA-VJ';
var CORPORATE = /^[a-z0-9._%+-]+@segulagrp\.com$/;
var FOLIO = /^STRA-VJ-\d{4}-\d{6}$/;
var SHEET_NAME = 'Folios';
var HEADERS = ['Folio', 'Reservado', 'Correo', 'Descargado'];
var LOCK_WAIT_MS = 10000;

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
    var rows = sh.getDataRange().getValues();
    for (var i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] !== folio) continue;
      if (String(rows[i][2]).toLowerCase() !== email) return json_({ ok: false, error: 'not_found' });
      if (!rows[i][3]) sh.getRange(i + 1, 4).setValue(new Date());
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'not_found' });
  } catch (err) {
    return json_({ ok: false, error: 'server_error' });
  }
}

// Returns the "Folios" sheet with the 4-column header, never overwriting data:
// - missing sheet: created with the header;
// - empty sheet: header written;
// - row 1 holds a folio (tab created by hand, no header): a header row is inserted above;
// - row 1 is the old header ("Folio | Emitido | Correo"): only B1/D1 are renamed or filled;
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
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
