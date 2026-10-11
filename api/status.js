// Live progress of the latest run, polled by the dashboard while a run is going.
//   GET /api/status?key=KEY → { run, checked, total }
import { db, q } from '../lib/db.js';

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  if (!process.env.DASHBOARD_KEY || req.query.key !== process.env.DASHBOARD_KEY) {
    return res.status(401).json({ error: 'unauthorised' });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const [run] = await q(db.from('signal_runs').select('*').order('id', { ascending: false }).limit(1));
    const { count: total } = await db.from('vcs').select('id', { count: 'exact', head: true });
    const { count: checked } = run
      ? await db.from('vc_checks').select('id', { count: 'exact', head: true }).eq('run_id', run.id)
      : { count: 0 };
    res.status(200).json({ run: run || null, checked: checked || 0, total: total || 0 });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
