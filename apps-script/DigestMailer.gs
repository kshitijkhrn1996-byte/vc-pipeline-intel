/**
 * Pipeline Radar · digest mailer.
 * Sends Vikram's Monday/Thursday pipeline brief from his own Gmail.
 *
 * Setup (once):
 *   1. script.google.com → New project → paste this file.
 *   2. Project Settings → Script properties → add DIGEST_SECRET (same value as in Vercel).
 *   3. Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → Deploy.
 *   4. Copy the /exec URL into Vercel as DIGEST_WEBHOOK_URL.
 *
 * POST body (text/plain JSON): { secret, subject, html, text, to? }
 * Sends to `to` if given, otherwise to the account that owns this script.
 */
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad_json' }); }

  var SECRET = PropertiesService.getScriptProperties().getProperty('DIGEST_SECRET');
  if (!SECRET || req.secret !== SECRET) return json({ ok: false, error: 'unauthorised' });
  if (!req.subject || !req.html) return json({ ok: false, error: 'missing_fields' });

  var to = req.to || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: to, subject: req.subject, htmlBody: req.html, body: req.text || '', name: 'Pipeline Radar' });
  return json({ ok: true, to: to, remaining_quota: MailApp.getRemainingDailyQuota() });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
