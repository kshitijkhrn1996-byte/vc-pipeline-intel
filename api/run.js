// Runs the signal pipeline.
//   Vercel Cron:  GET  /api/run              (Authorization: Bearer CRON_SECRET)
//   Dashboard:    POST /api/run              body {run_id?}  → forced full refresh, resumable
import { runPipeline } from '../src/pipeline/run.js';
import { isOwner } from '../src/http.js';
import { db } from '../src/db/client.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const isCron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && !isOwner(req)) return res.status(401).json({ error: 'unauthorised' });
  // Manual runs only from the dashboard's POST, so crawlers following a link can never start one.
  if (!isCron && req.method !== 'POST') return res.status(405).json({ error: 'Use POST to start a run.' });

  // A second "Run now" while one is going joins it instead of starting a duplicate run.
  if (!isCron && !req.body?.run_id) {
    const since = new Date(Date.now() - 6 * 60_000).toISOString();
    const { data } = await db.from('signal_runs').select('id').eq('status', 'running').neq('trigger', 'single')
      .gte('started_at', since).order('id', { ascending: false }).limit(1);
    if (data?.length) return res.status(200).json({ run_id: data[0].id, checked: 0, remaining: 1, joined: true });
  }

  try {
    const result = isCron
      ? await runPipeline({ trigger: 'cron' })
      : await runPipeline({ trigger: 'manual', runId: req.body?.run_id || null, force: true });
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
}
