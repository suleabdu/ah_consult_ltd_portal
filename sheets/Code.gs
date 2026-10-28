/**
 * AH Student Hub - Google Sheet READ-ONLY MIRROR (v3, Phase 16)
 *
 * The database (Supabase) is the single source of truth. This sheet only displays what the sync worker writes.
 * It has NO power to approve payments, activate staff or change any record - the old two-way "review" webhook
 * (sheet-review) was removed because anyone with Editor access to a sheet could have used it to approve money.
 * All approvals happen in the Admin Dashboard, which writes an audit-log entry for every action.
 *
 * SETUP (once):
 *  1. Extensions > Apps Script > delete older code > paste this file > Save.
 *  2. Project Settings > Script Properties > add SERVICE_ACCOUNT_EMAIL = the client_email from your service-account JSON.
 *  3. Run ahctRetireLegacyReview()  (removes the old edit trigger and the old webhook secret).
 *  4. Run ahctProtectMirror()       (locks every tab so only you and the service account can edit).
 *  5. Run ahctDiagnose()            (prints a pass/fail checklist in the Execution log).
 *  6. Share the spreadsheet with staff as VIEWER only.
 */
function ahctProps_() { return PropertiesService.getScriptProperties(); }

function ahctRetireLegacyReview() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'ahctOnReviewEdit') ScriptApp.deleteTrigger(t); });
  ahctProps_().deleteProperty('SHEET_WEBHOOK_SECRET');
  Logger.log('Legacy review trigger and SHEET_WEBHOOK_SECRET removed. Also delete SHEET_WEBHOOK_SECRET from Supabase secrets.');
}

function ahctProtectMirror() {
  var sa = (ahctProps_().getProperty('SERVICE_ACCOUNT_EMAIL') || '').trim().toLowerCase();
  if (!sa) throw new Error('Set SERVICE_ACCOUNT_EMAIL in Project Settings > Script Properties first.');
  var ss = SpreadsheetApp.getActive(), me = Session.getEffectiveUser().getEmail().toLowerCase();
  ss.getSheets().forEach(function (sheet) {
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    var p = sheet.protect().setDescription('Read-only mirror. Make changes in the Student Hub dashboard.');
    p.addEditor(me); p.addEditor(sa);
    var strangers = p.getEditors().filter(function (u) { var e = u.getEmail().toLowerCase(); return e !== me && e !== sa; });
    if (strangers.length) p.removeEditors(strangers);
    if (p.canDomainEdit()) p.setDomainEdit(false);
    sheet.getDataRange().clearDataValidations();   // remove legacy approval dropdowns
  });
  Logger.log('Protected ' + ss.getSheets().length + ' tab(s). Editors: ' + me + ', ' + sa);
}

function ahctDiagnose() {
  var out = [], ss = SpreadsheetApp.getActive();
  var legacy = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'ahctOnReviewEdit'; }).length;
  out.push((legacy ? 'FAIL' : 'PASS') + ' - legacy review trigger ' + (legacy ? 'still installed: run ahctRetireLegacyReview()' : 'removed'));
  out.push((ahctProps_().getProperty('SHEET_WEBHOOK_SECRET') ? 'FAIL' : 'PASS') + ' - legacy SHEET_WEBHOOK_SECRET ' + (ahctProps_().getProperty('SHEET_WEBHOOK_SECRET') ? 'still present' : 'removed'));
  out.push((ahctProps_().getProperty('SERVICE_ACCOUNT_EMAIL') ? 'PASS' : 'FAIL') + ' - SERVICE_ACCOUNT_EMAIL set');
  ss.getSheets().forEach(function (s) {
    var prot = s.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0;
    out.push((prot ? 'PASS' : 'FAIL') + ' - tab "' + s.getName() + '" ' + (prot ? 'is protected' : 'is NOT protected: run ahctProtectMirror()'));
  });
  var editors = ss.getEditors().map(function (u) { return u.getEmail(); });
  out.push('INFO - file editors (should be only you + the service account): ' + editors.join(', '));
  Logger.log(out.join('\n'));
}
