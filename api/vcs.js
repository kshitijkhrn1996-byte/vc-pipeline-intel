// Vikram's pipeline.
//   GET   /api/vcs?key=KEY  → VCs with latest check, evidence, draft, score history, what changed, feedback
//   POST  /api/vcs?key=KEY  body {name, firm, thesis?, email?, website?, blog_rss?, status?, last_contact?, notes?}
//                           → adds a VC and checks it right away
//   PATCH /api/vcs?key=KEY  body {id, status?, last_contact?, contact_history?, notes?, email?}
import { db, q } from '../src/db/client.js';
import { ownerRoute, badRequest } from '../src/http.js';
import { changesSince } from '../src/core/changes.js';
import { checkVcs, reapplyAction } from '../src/pipeline/run.js';

export const config = { maxDuration: 60 };

// What Vikram can edit from the dashboard. Signal columns are deliberately absent.
const EDITABLE = ['status', 'last_contact', 'contact_history', 'notes', 'email'];
const CREATABLE = ['name', 'firm', 'thesis', 'email', 'website', 'blog_rss', 'status', 'last_contact', 'contact_history', 'notes'];
const STATUSES = ['yet_to_reach_out', 'waiting_response', 'in_conversation', 'passed'];
const HISTORY = 8; // checks kept for the score sparkline

const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {})
  .filter(([k]) => keys.includes(k)).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]));

export default ownerRoute(async (req, res) => {
  if (req.method === 'POST') {
    const row = pick(req.body, CREATABLE);
    if (!row.name || !row.firm) throw badRequest('Name and firm are required.');
    if (row.status && !STATUSES.includes(row.status)) throw badRequest('Unknown status.');
    const { data, error } = await db.from('vcs').insert(row).select();
    if (error) throw badRequest(error.code === '23505' ? `${row.name} at ${row.firm} is already in the pipeline.` : error.message);
    await checkVcs([data[0].id]);
    const [vc] = await q(db.from('vcs').select('*').eq('id', data[0].id));
    return res.status(201).json(vc);
  }

  if (req.method === 'PATCH') {
    const { id } = req.body || {};
    const patch = pick(req.body, EDITABLE);
    if (!id || !Object.keys(patch).length) throw badRequest('Nothing to update.');
    if (patch.status && !STATUSES.includes(patch.status)) throw badRequest('Unknown status.');
    await q(db.from('vcs').update(patch).eq('id', id));
    // Status or last contact changes the recommendation (e.g. just emailed → hold).
    if ('status' in patch || 'last_contact' in patch) await reapplyAction(id);
    const [row] = await q(db.from('vcs').select('*').eq('id', id));
    return res.status(200).json(row);
  }

  const [vcs, runs, feedback] = await Promise.all([
    q(db.from('vcs').select('*').order('follow_up_score', { ascending: false, nullsFirst: false })),
    q(db.from('signal_runs').select('*').neq('trigger', 'single').order('id', { ascending: false }).limit(5)),
    q(db.from('signal_feedback').select('vc_id, url, verdict')),
  ]);
  const lastDone = runs.find((r) => r.status !== 'running' && r.status !== 'failed') || null;

  // Recent checks per VC, newest first.
  const checks = await q(db.from('vc_checks').select('*').order('checked_at', { ascending: false }).limit(60 * HISTORY));
  const history = new Map();
  for (const c of checks) {
    if (!history.has(c.vc_id)) history.set(c.vc_id, []);
    if (history.get(c.vc_id).length < HISTORY) history.get(c.vc_id).push(c);
  }
  const latestRunIds = [...new Set([...history.values()].map((h) => h[0].run_id))];
  const signals = latestRunIds.length
    ? await q(db.from('signals').select('*').in('run_id', latestRunIds).order('points', { ascending: false }))
    : [];
  const evidence = new Map();
  for (const s of signals) {
    if (history.get(s.vc_id)?.[0].run_id !== s.run_id) continue;
    if (!evidence.has(s.vc_id)) evidence.set(s.vc_id, []);
    evidence.get(s.vc_id).push(s);
  }
  const verdicts = new Map(feedback.map((f) => [`${f.vc_id}|${f.url}`, f.verdict]));
  const rated = feedback.length, useful = feedback.filter((f) => f.verdict === 'useful').length;

  res.status(200).json({
    runs,
    last_run: lastDone,
    feedback: { rated, useful, precision: rated ? Math.round((useful / rated) * 100) : null },
    vcs: vcs.map((v) => {
      const h = history.get(v.id) || [];
      const ev = (evidence.get(v.id) || []).map((s) => ({ ...s, verdict: verdicts.get(`${v.id}|${s.url}`) || null }));
      return {
        ...v,
        check: h[0] || null,
        evidence: ev,
        trend: h.map((c) => c.score ?? 0).reverse(),
        change: changesSince(h[0], h[1], ev),
      };
    }),
  });
});
