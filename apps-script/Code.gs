function ahctSecret_() {
  return PropertiesService.getScriptProperties().getProperty('SHEET_WEBHOOK_SECRET') || '';
}

/**
 * AH Student Hub - Approvals from Google Sheets (payments + staff accounts)
 * SETUP: Extensions > Apps Script > delete any older version > paste this > set SHEET_WEBHOOK_SECRET in Project Settings > Script Properties > Save.
 * Pick  ahctSetupSheet  in the toolbar > Run > Review permissions > Allow. A report pops up; fix anything marked MISSING/FAILED.
 * Names are prefixed "ahct" so they cannot clash with other scripts in this spreadsheet.
 */
const AHCT = {
  SUPABASE_URL: 'https://xwieiqrnlvcjajdeinqc.supabase.co',
  APP_TAB: 'Online Applications', APP_REVIEW_COL: 13,   // column M = Payment Review
  ADM_TAB: 'Admin Registrations',  ADM_REVIEW_COL: 7    // column G = Approval
};
const AHCT_APP_HEAD = ['ApplicationID','StudentID','Name','Phone','Intake','Courses','Total','Status','Created','Paid','Submitted','PaymentClaimed','Payment Review','Occupation','EducationLevel','LaptopAvailable','LaptopBattery','Skills'];
const AHCT_ADM_HEAD = ['StaffID','Name','Email','Phone','Position','Registered','Approval','Role'];

function ahctPrepareTab_(name, head, reviewCol) {
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(name) || ss.insertSheet(name), n = head.length;
  sh.getRange(1, 1, 1, n).setValues([head]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff'); // header row only
  sh.getRange(2, 1, 1999, n).setBackground(null).setFontColor('#000000').setFontWeight('normal');                  // data rows: plain text
  sh.setFrozenRows(1);
  const col = sh.getRange(2, reviewCol, 1999, 1);
  col.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pending','Approved','Rejected'], true).setAllowInvalid(false).build());
  const rule = (t, bg, fg) => SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(t).setBackground(bg).setFontColor(fg).setRanges([col]).build();
  sh.setConditionalFormatRules([rule('Approved','#dcfce7','#166534'), rule('Rejected','#fee2e2','#991b1b'), rule('Pending','#fef3c7','#92400e')]);
}

function ahctSetupSheet() {
  ahctPrepareTab_(AHCT.APP_TAB, AHCT_APP_HEAD, AHCT.APP_REVIEW_COL);
  ahctPrepareTab_(AHCT.ADM_TAB, AHCT_ADM_HEAD, AHCT.ADM_REVIEW_COL);
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t => { if (['onReviewEdit','ahctOnReviewEdit'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); }); // only OUR old triggers
  ScriptApp.newTrigger('ahctOnReviewEdit').forSpreadsheet(ss).onEdit().create();
  ahctDiagnose();
}

function ahctCall(payload) {
  const res = UrlFetchApp.fetch(AHCT.SUPABASE_URL + '/functions/v1/sheet-review', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-sheet-secret': ahctSecret_() }, payload: JSON.stringify(payload) });
  let body = {}; try { body = JSON.parse(res.getContentText()); } catch (x) { body = { error: res.getContentText().slice(0, 120) }; }
  return { code: res.getResponseCode(), body: body };
}

function ahctDiagnose() {   // run any time to see why approvals are not reaching the portal
  const ss = SpreadsheetApp.getActive(), out = [];
  [AHCT.APP_TAB, AHCT.ADM_TAB].forEach(t => out.push((ss.getSheetByName(t) ? 'OK' : 'MISSING') + ' - tab "' + t + '"'));
  const n = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'ahctOnReviewEdit').length;
  out.push((n === 1 ? 'OK' : n ? 'DUPLICATE (' + n + ' triggers: run ahctSetupSheet again)' : 'MISSING - run ahctSetupSheet') + ' - edit trigger');
  out.push(ahctSecret_() ? 'OK - SHEET_WEBHOOK_SECRET is set in Script Properties' : 'MISSING - set SHEET_WEBHOOK_SECRET in Project Settings > Script Properties');
  try { const r = ahctCall({ applicationId: 'TEST', decision: 'pending' });
    out.push((r.code === 200 ? 'OK' : 'FAILED') + ' - server: ' + (r.body.message || r.body.error || r.body.msg || '?') + ' (HTTP ' + r.code + ')'
      + (r.code === 401 ? '  -> wrong SECRET, or sheet-review was not deployed with --no-verify-jwt' : r.code === 404 ? '  -> sheet-review is not deployed' : ''));
  } catch (e) { out.push('FAILED - cannot reach Supabase: ' + e.message); }
  SpreadsheetApp.getUi().alert('Approvals check', out.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function ahctOnReviewEdit(e) {   // installable trigger: simple onEdit cannot call external services
  const ss = SpreadsheetApp.getActive();
  try {
    const r = e.range, sh = r.getSheet(), name = sh.getName();
    const isApp = name === AHCT.APP_TAB, isAdm = name === AHCT.ADM_TAB; if (!isApp && !isAdm) return;
    const rc = isApp ? AHCT.APP_REVIEW_COL : AHCT.ADM_REVIEW_COL;
    if (r.getColumn() > rc || r.getLastColumn() < rc) return;
    for (let row = Math.max(2, r.getRow()); row <= r.getLastRow(); row++) {   // handles paste / drag-fill too
      const id = sh.getRange(row, 1).getValue(); if (!id) continue;
      const cell = sh.getRange(row, rc), val = String(cell.getValue() || 'Pending').trim().toLowerCase();
      const res = ahctCall(isApp ? { applicationId: id, decision: val, by: Session.getActiveUser().getEmail() }
                                 : { kind: 'admin', staffId: id, decision: val, by: Session.getActiveUser().getEmail() });
      if (res.code !== 200) { cell.setValue(e.oldValue && r.getNumRows() === 1 ? e.oldValue : 'Pending'); ss.toast(res.body.error || res.body.msg || ('HTTP ' + res.code), 'Approval FAILED (row ' + row + ')', 10); }
      else ss.toast(res.body.message || 'Updated', isApp ? 'Payment Review' : 'Staff Approval', 5);
    }
  } catch (err) { ss.toast(String(err.message || err), 'Approval error', 10); }
}
