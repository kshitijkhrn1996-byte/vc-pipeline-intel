// The run: collect live signals → validate → Gemini classifies → score →
// action → draft → write ONLY the four signal columns (via apply_signal).
// Works in chunks under a time budget so it can resume on the next call.
import { db, q } from './db.js';
import { newsItems, blogItems, searchItems } from './sources.js';
import { classifyVc, draftEmails } from './gemini.js';
import { validateItems } from '../src/validate.js';
import { itemPoints, scoreVc, decideAction, DRAFT_ACTIONS } from '../src/scoring.js';
import { todayIst } from './config.js';

const CHUNK = 10;            // VCs processed end-to-end per step
const PARALLEL = 5;          // concurrent VCs within a chunk (feeds + Gemini)
const DRAFT_BATCH = 4;       // VCs per Gemini drafting call
const FRESH_HOURS = 6;       // skip VCs already checked this recently (lets a 2nd cron finish leftovers)

async function pool(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function startRun(trigger) {
  const hash = await q(db.rpc('protected_hash'));
  const [run] = await q(db.from('signal_runs').insert({ trigger, protected_hash_before: hash }).select());
  return run;
}

// VCs still to do in this run (not checked in this run or in the last FRESH_HOURS).
async function pendingVcs(runId, force) {
  const vcs = await q(db.from('vcs').select('*').order('id'));
  const since = new Date(Date.now() - FRESH_HOURS * 3_600_000).toISOString();
  let checks = db.from('vc_checks').select('vc_id, run_id, checked_at');
  if (force) checks = checks.eq('run_id', runId ?? 0);
  else checks = runId ? checks.or(`run_id.eq.${runId},checked_at.gte.${since}`) : checks.gte('checked_at', since);
  const done = new Set((await q(checks)).map((c) => c.vc_id));
  return vcs.filter((v) => !done.has(v.id));
}

async function feedItems(vc, today) {
  const [news, blog] = await Promise.all([newsItems(vc), blogItems(vc)]);
  return validateItems([...blog, ...news], today).slice(0, 15);
}

async function classify(vc, items, today) {
  if (!items.length) return [];
  const verdicts = new Map((await classifyVc(vc, items)).map((x) => [x.idx, x]));
  return items
    .map((it, i) => ({ ...it, ...verdicts.get(i) }))
    .filter((it) => (it.about === 'partner' || it.about === 'firm') && it.type)
    .map((it) => ({ ...it, points: itemPoints(it, today) }));
}

function summarise(kept, sources, found) {
  if (!kept.length) {
    return found
      ? `No public activity in the last 30 days: ${found} items matched the name but none were about this VC (checked ${sources.join(', ')}).`
      : `No public activity found in the last 30 days (checked ${sources.join(', ')}).`;
  }
  const seen = new Set();
  const top = [...kept].sort((a, b) => b.points - a.points || b.published.localeCompare(a.published))
    .filter((s) => !seen.has(s.event) && seen.add(s.event)).slice(0, 2);
  const lines = top.map((s) => `${s.published.slice(5)}: ${s.summary}${s.about === 'firm' ? ' [firm]' : ''}`);
  const offTopic = top.every((s) => s.relevance === 0);
  return (offTopic ? 'Active, but not on logistics/SaaS. ' : '') + lines.join(' | ');
}

// Collect + classify one VC. Returns null if Gemini failed, so the VC stays pending for the next call.
export async function assess(vc, today) {
  const sources = ['news', ...(vc.blog_rss ? ['blog'] : [])];
  try {
    let items = await feedItems(vc, today);
    let kept = await classify(vc, items, today);
    if (!kept.length) {                 // feeds had nothing about this VC: try grounded web search
      sources.push('search');
      const found = validateItems(await searchItems(vc, today).catch(() => []), today);
      kept = await classify(vc, found, today);
      items = [...items, ...found];
    }
    const score = scoreVc(kept, today);
    const action = decideAction({ score, status: vc.status, lastContact: vc.last_contact }, today);
    const lastSignal = kept.length ? kept.map((k) => k.published).sort().pop() : null;
    return { vc, sources, items, kept, score, action, lastSignal, summary: summarise(kept, sources, items.length) };
  } catch (err) {
    console.error(vc.firm, err.message);
    return null;
  }
}

async function processChunk(run, vcs, today) {
  const results = (await pool(vcs, PARALLEL, (vc) => assess(vc, today))).filter(Boolean);

  // Outreach drafts for the VCs worth contacting now.
  const toDraft = results.filter((r) => DRAFT_ACTIONS.has(r.action.code)).map((r) => ({
    vc: r.vc, kind: r.action.code === 'NUDGE_NOW' ? 'nudge' : 'first',
    signals: [...r.kept].sort((a, b) => b.points - a.points).filter((s) => s.relevance >= 2).slice(0, 2),
  }));
  const draftLists = await pool(chunks(toDraft, DRAFT_BATCH), 3, (b) => draftEmails(b).catch(() => []));
  const drafts = new Map(draftLists.flat().map((d) => [d.vc_id, d]));

  await pool(results, 5, async (r) => {
    // The ONLY write to vcs: four signal columns through the guarded function.
    await q(db.rpc('apply_signal', {
      p_vc_id: r.vc.id, p_last_signal_date: r.lastSignal, p_summary: r.summary,
      p_score: r.score, p_action: r.action.label,
    }));
    const d = drafts.get(r.vc.id);
    await q(db.from('vc_checks').upsert({
      run_id: run.id, vc_id: r.vc.id, sources_checked: r.sources, items_found: r.items.length,
      score: r.score, action_code: r.action.code, draft_subject: d?.subject || null, draft_body: d?.body || null,
    }, { onConflict: 'run_id,vc_id' }));
    if (r.kept.length) {
      await q(db.from('signals').insert(r.kept.map((s) => ({
        run_id: run.id, vc_id: r.vc.id, source: s.source, type: s.type, title: s.title, url: s.url,
        published: s.published, relevance: s.relevance, summary: s.summary, points: s.points,
        event: s.event || null, about: s.about,
      }))));
    }
  });
  return results;
}

export async function runPipeline({ trigger = 'manual', runId = null, force = false, budgetMs = 240_000 } = {}) {
  const started = Date.now();
  const today = todayIst();
  // A follow-up cron with nothing left to do should not open an empty run.
  if (!runId && !force && !(await pendingVcs(null, false)).length) {
    return { run_id: null, checked: 0, signals: 0, remaining: 0, skipped: 'all VCs checked in the last few hours' };
  }
  const run = runId
    ? (await q(db.from('signal_runs').select('*').eq('id', runId)))[0]
    : await startRun(trigger);
  if (!run) throw new Error(`run ${runId} not found`);

  try {
    const pending = await pendingVcs(run.id, force);
    let checked = 0, found = 0;
    for (const chunk of chunks(pending, CHUNK)) {
      if (Date.now() - started > budgetMs) break;
      const res = await processChunk(run, chunk, today);
      checked += res.length;
      found += res.reduce((s, r) => s + r.kept.length, 0);
    }
    const remaining = (await pendingVcs(run.id, force)).length;
    const hashAfter = await q(db.rpc('protected_hash'));
    await q(db.from('signal_runs').update({
      vcs_checked: (run.vcs_checked || 0) + checked,
      signals_found: (run.signals_found || 0) + found,
      protected_hash_after: hashAfter,
      status: remaining ? 'partial' : 'done',
      finished_at: new Date().toISOString(),
    }).eq('id', run.id));
    return { run_id: run.id, checked, signals: found, remaining, notes_untouched: hashAfter === run.protected_hash_before };
  } catch (err) {
    await db.from('signal_runs').update({ status: 'failed', error: String(err.message || err), finished_at: new Date().toISOString() }).eq('id', run.id);
    throw err;
  }
}
