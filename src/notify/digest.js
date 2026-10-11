// The Monday/Thursday brief, emailed to Vikram through his own Gmail
// (Apps Script bridge in apps-script/DigestMailer.gs).
import { db, q } from '../db/client.js';

const APP_URL = () => process.env.APP_URL || 'https://vc-pipeline-intel.vercel.app';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clean = (s) => String(s || '').replace(/ \[firm\]/g, '');

export async function buildDigest() {
  const vcs = await q(db.from('vcs').select('id, name, firm, follow_up_score, signal_summary, last_signal_date'));
  const checks = await q(db.from('vc_checks').select('vc_id, action_code, checked_at, draft_body').order('checked_at', { ascending: false }).limit(1000));
  const latest = new Map();
  for (const c of checks) if (!latest.has(c.vc_id)) latest.set(c.vc_id, c);
  const byCode = (codes) => vcs.filter((v) => codes.includes(latest.get(v.id)?.action_code))
    .sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0));
  const go = byCode(['REACH_OUT_NOW']), nudge = byCode(['NUDGE_NOW']), quiet = byCode(['DEPRIORITISE']);
  const day = new Date(Date.now() + 5.5 * 3_600_000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  const subject = `Pipeline brief · ${day}: reach out to ${go.length}, nudge ${nudge.length}`;
  const row = (v, label, color) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e3e7ef">
      <div style="font:600 16px Arial,sans-serif;color:#0e1a2e">${esc(v.name)} <span style="font-weight:400;color:#5b667c">· ${esc(v.firm)}</span></div>
      <div style="margin:4px 0 6px"><span style="background:${color};color:#fff;border-radius:10px;padding:2px 9px;font:600 12px Arial,sans-serif">${label}</span>
        <span style="font:12px Arial,sans-serif;color:#5b667c;margin-left:6px">score ${v.follow_up_score ?? 0}/100</span></div>
      <div style="font:14px/1.45 Arial,sans-serif;color:#33405a">${esc(clean(v.signal_summary))}</div>
      ${latest.get(v.id)?.draft_body ? `<div style="font:13px Arial,sans-serif;margin-top:6px"><a href="${APP_URL()}" style="color:#2747d6">Email draft ready in the dashboard →</a></div>` : ''}
    </td></tr>`;

  const html = `<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#13294b;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0">
      <div style="font:12px monospace;letter-spacing:1px;color:#b9c6e0">PIPELINE RADAR · ${esc(day.toUpperCase())}</div>
      <div style="font:700 24px/1.2 Arial,sans-serif;margin-top:8px">Reach out to ${go.length} and nudge ${nudge.length}. ${quiet.length} are quiet this week.</div>
    </div>
    <div style="background:#fff;border:1px solid #e3e7ef;border-top:0;padding:8px 24px 20px;border-radius:0 0 12px 12px">
      <table style="width:100%;border-collapse:collapse">
        ${go.map((v) => row(v, 'Reach out now', '#0d8048')).join('')}
        ${nudge.map((v) => row(v, 'Nudge now', '#a95b06')).join('')}
      </table>
      ${go.length + nudge.length === 0 ? '<p style="font:14px Arial,sans-serif;color:#33405a">No VC has a strong enough signal this week.</p>' : ''}
      <p style="font:13px/1.5 Arial,sans-serif;color:#5b667c;margin-top:18px"><b>Quiet this week:</b> ${quiet.map((v) => esc(v.firm.replace(/\s*\(.*?\)/g, ''))).join(', ') || 'none'}.</p>
      <p style="margin:22px 0 4px"><a href="${APP_URL()}" style="background:#2747d6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font:600 14px Arial,sans-serif">Open the dashboard</a></p>
      <p style="font:12px Arial,sans-serif;color:#8a94a8;margin-top:16px">Signals from the last 30 days · your notes and contact history were not changed.</p>
    </div></div>`;
  const text = `${subject}\n\n` + [...go.map((v) => `REACH OUT · ${v.name}, ${v.firm} (${v.follow_up_score}): ${clean(v.signal_summary)}`),
    ...nudge.map((v) => `NUDGE · ${v.name}, ${v.firm} (${v.follow_up_score}): ${clean(v.signal_summary)}`)].join('\n') + `\n\n${APP_URL()}`;
  return { subject, html, text, counts: { go: go.length, nudge: nudge.length, quiet: quiet.length } };
}

// Sends the brief once per run (force=true resends, e.g. the dashboard's "Email me the brief").
export async function sendDigest(runId, { force = false } = {}) {
  if (!process.env.DIGEST_WEBHOOK_URL || !process.env.DIGEST_SECRET) throw new Error('digest email is not set up (DIGEST_WEBHOOK_URL)');
  if (runId && !force) {
    const [run] = await q(db.from('signal_runs').select('digest_sent_at').eq('id', runId));
    if (run?.digest_sent_at) return { skipped: 'already sent' };
  }
  const digest = await buildDigest();
  const res = await fetch(process.env.DIGEST_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoids a CORS preflight Apps Script can't answer
    body: JSON.stringify({ secret: process.env.DIGEST_SECRET, to: process.env.DIGEST_TO || undefined,
      subject: digest.subject, html: digest.html, text: digest.text }),
    redirect: 'follow',
  });
  const data = await res.json().catch(() => ({ ok: false, error: `bridge returned ${res.status}` }));
  if (!data.ok) throw new Error(`digest: ${data.error}`);
  if (runId) await q(db.from('signal_runs').update({ digest_sent_at: new Date().toISOString() }).eq('id', runId));
  return { sent: true, to: data.to, ...digest.counts };
}
