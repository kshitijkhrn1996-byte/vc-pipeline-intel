// Runs the signal pipeline.
//   Vercel Cron:  GET  /api/run              (Authorization: Bearer CRON_SECRET)
//   Dashboard:    POST /api/run?key=KEY      body {run_id?}  → forced full refresh, resumable
import { runPipeline } from '../src/pipeline/run.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const isCron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const isOwner = process.env.DASHBOARD_KEY && req.query.key === process.env.DASHBOARD_KEY;
  if (!isCron && !isOwner) return res.status(401).json({ error: 'unauthorised' });

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
