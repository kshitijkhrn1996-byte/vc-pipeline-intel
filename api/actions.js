// Vikram's one-click actions from the dashboard.
//   POST /api/actions?key=KEY
//     { action: 'mark_sent', id, subject? }            → status waiting, last contact today, history line, action → hold
//     { action: 'feedback', vc_id, url, title, verdict } → 'useful' | 'not_relevant' | null (clear)
//     { action: 'import', rows: [{name, firm, ...}] }   → bulk add from CSV, skipping VCs already in the pipeline
//     { action: 'send_digest' }                         → email the current brief now
//   GET  /api/actions?key=KEY&preview=digest           → the brief email as HTML
import { db, q } from '../src/db/client.js';
import { ownerRoute, badRequest, istToday } from '../src/http.js';
import { reapplyAction } from '../src/pipeline/run.js';
import { buildDigest, sendDigest } from '../src/notify/digest.js';

export const config = { maxDuration: 30 };

const IMPORTABLE = ['name', 'firm', 'thesis', 'email', 'website', 'blog_rss', 'status', 'last_contact', 'contact_history', 'notes'];
const STATUSES = ['yet_to_reach_out', 'waiting_response', 'in_conversation', 'passed'];

export default ownerRoute(async (req, res) => {
  if (req.method === 'GET' && req.query.preview === 'digest') {
    const { html } = await buildDigest();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }
  if (req.method !== 'POST') throw badRequest('Use POST.');
  const body = req.body || {};

  switch (body.action) {
    case 'mark_sent': {
      const [vc] = await q(db.from('vcs').select('id, contact_history').eq('id', body.id));
      if (!vc) throw badRequest('VC not found.');
      const today = istToday();
      const line = `${today}: Emailed${body.subject ? ` "${String(body.subject).slice(0, 120)}"` : ''} (sent from Pipeline Radar)`;
      await q(db.from('vcs').update({
        status: 'waiting_response', last_contact: today,
        contact_history: vc.contact_history ? `${vc.contact_history}\n${line}` : line,
      }).eq('id', vc.id));
      const action = await reapplyAction(vc.id);
      const [row] = await q(db.from('vcs').select('*').eq('id', vc.id));
      return res.status(200).json({ vc: row, action });
    }

    case 'feedback': {
      const { vc_id, url, title, verdict } = body;
      if (!vc_id || !url) throw badRequest('vc_id and url are required.');
      if (verdict === null) {
        await q(db.from('signal_feedback').delete().eq('vc_id', vc_id).eq('url', url));
      } else {
        if (!['useful', 'not_relevant'].includes(verdict)) throw badRequest('Unknown verdict.');
        await q(db.from('signal_feedback').upsert({ vc_id, url, title, verdict }, { onConflict: 'vc_id,url' }));
      }
      return res.status(200).json({ ok: true });
    }

    case 'import': {
      const rows = (Array.isArray(body.rows) ? body.rows : []).map((r) => Object.fromEntries(
        Object.entries(r).filter(([k]) => IMPORTABLE.includes(k)).map(([k, v]) => [k, String(v ?? '').trim() || null])))
        .filter((r) => r.name && r.firm)
        .map((r) => ({ ...r, status: STATUSES.includes(r.status) ? r.status : 'yet_to_reach_out',
          last_contact: /^\d{4}-\d{2}-\d{2}$/.test(r.last_contact || '') ? r.last_contact : null }));
      if (!rows.length) throw badRequest('No rows with both a name and a firm.');
      if (rows.length > 500) throw badRequest('Import at most 500 VCs at a time.');
      const { data, error } = await db.from('vcs').upsert(rows, { onConflict: 'name,firm', ignoreDuplicates: true }).select('id');
      if (error) throw badRequest(error.message);
      return res.status(200).json({ imported: data.length, skipped: rows.length - data.length });
    }

    case 'send_digest':
      return res.status(200).json(await sendDigest(null, { force: true }));

    default:
      throw badRequest('Unknown action.');
  }
});
