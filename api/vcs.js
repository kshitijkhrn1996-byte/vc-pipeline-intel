// Dashboard data and Vikram's own edits.
//   GET   /api/vcs?key=KEY   → pipeline with latest check, evidence and draft per VC
//   PATCH /api/vcs?key=KEY   body {id, status?, last_contact?, contact_history?, notes?, email?}
import { db, q } from '../lib/db.js';

export const config = { maxDuration: 30 };

// What Vikram can edit from the dashboard. Signal columns are deliberately absent.
const EDITABLE = ['status', 'last_contact', 'contact_history', 'notes', 'email'];

export default async function handler(req, res) {
  if (!process.env.DASHBOARD_KEY || req.query.key !== process.env.DASHBOARD_KEY) {
    return res.status(401).json({ error: 'unauthorised' });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'PATCH') {
      const { id, ...rest } = req.body || {};
      const patch = Object.fromEntries(Object.entries(rest).filter(([k]) => EDITABLE.includes(k))
        .map(([k, v]) => [k, v === '' ? null : v]));
      if (!id || !Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
      const [row] = await q(db.from('vcs').update(patch).eq('id', id).select());
      return res.status(200).json(row);
    }

    const [vcs, runs] = await Promise.all([
      q(db.from('vcs').select('*').order('follow_up_score', { ascending: false, nullsFirst: false })),
      q(db.from('signal_runs').select('*').order('id', { ascending: false }).limit(5)),
    ]);
    const lastDone = runs.find((r) => r.status !== 'running' && r.status !== 'failed') || null;

    // Latest check per VC, and the evidence from that same run.
    const checks = await q(db.from('vc_checks').select('*').order('checked_at', { ascending: false }).limit(500));
    const latest = new Map();
    for (const c of checks) if (!latest.has(c.vc_id)) latest.set(c.vc_id, c);
    const runIds = [...new Set([...latest.values()].map((c) => c.run_id))];
    const signals = runIds.length
      ? await q(db.from('signals').select('*').in('run_id', runIds).order('points', { ascending: false }))
      : [];
    const evidence = new Map();
    for (const s of signals) {
      if (latest.get(s.vc_id)?.run_id !== s.run_id) continue;
      if (!evidence.has(s.vc_id)) evidence.set(s.vc_id, []);
      evidence.get(s.vc_id).push(s);
    }

    res.status(200).json({
      runs,
      last_run: lastDone,
      vcs: vcs.map((v) => ({ ...v, check: latest.get(v.id) || null, evidence: evidence.get(v.id) || [] })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
}
