// Live progress of the latest run, polled by the dashboard while a run is going.
//   GET /api/status?key=KEY → { run, checked, total }
import { db, q } from '../src/db/client.js';
import { ownerRoute } from '../src/http.js';

export const config = { maxDuration: 10 };

export default ownerRoute(async (req, res) => {
  const [run] = await q(db.from('signal_runs').select('*').neq('trigger', 'single').order('id', { ascending: false }).limit(1));
  const { count: total } = await db.from('vcs').select('id', { count: 'exact', head: true });
  const { count: checked } = run
    ? await db.from('vc_checks').select('id', { count: 'exact', head: true }).eq('run_id', run.id)
    : { count: 0 };
  res.status(200).json({ run: run || null, checked: checked || 0, total: total || 0 });
});
