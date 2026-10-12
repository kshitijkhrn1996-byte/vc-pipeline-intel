// The run: collect live signals → validate → Gemini classifies → score →
// action → draft → write ONLY the four signal columns (via apply_signal).
// Works in chunks under a time budget so it can resume on the next call.
import { db, q } from '../db/client.js';
import { newsItems } from '../sources/google-news.js';
import { blogItems } from '../sources/blog-rss.js';
import { searchItems } from '../sources/web-search.js';
import { classifyVc } from '../ai/classify.js';
import { draftEmails } from '../ai/draft-email.js';
import { validateItems, normaliseTitle } from '../core/validate.js';
import { itemPoints, scoreVc } from '../core/scoring.js';
import { decideAction, DRAFT_ACTIONS } from '../core/actions.js';
import { todayIst } from '../config.js';
import { sendDigest } from '../notify/digest.js';
import { shouldArchive } from '../core/archive.js';

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
// VCs currently archived (by the rule or by Vikram). Runs skip them.
export async function archivedIds() {
  return new Set((await q(db.from('vc_archive').select('vc_id').is('restored_at', null))).map((a) => a.vc_id));
}

async function pendingVcs(runId, force) {
  const archived = await archivedIds();
  const vcs = (await q(db.from('vcs').select('*').order('id'))).filter((v) => !archived.has(v.id));
  const since = new Date(Date.now() - FRESH_HOURS * 3_600_000).toISOString();
  let checks = db.from('vc_checks').select('vc_id, run_id, checked_at');
  if (force) checks = checks.eq('run_id', runId ?? 0);
  else checks = runId ? checks.or(`run_id.eq.${runId},checked_at.gte.${since}`) : checks.gte('checked_at', since);
  const done = new Set((await q(checks)).map((c) => c.vc_id));
  return vcs.filter((v) => !done.has(v.id));
}

// Signals Vikram marked "not relevant" on the dashboard never count again for that VC.
async function loadRejected() {
  const rows = await q(db.from('signal_feedback').select('vc_id, url, title').eq('verdict', 'not_relevant'));
  const set = new Set();
  for (const r of rows) { set.add(`${r.vc_id}|${r.url}`); if (r.title) set.add(`${r.vc_id}|${normaliseTitle(r.title)}`); }
  return set;
}
const notRejected = (vc, rejected) => (it) =>
  !rejected.has(`${vc.id}|${it.url}`) && !rejected.has(`${vc.id}|${normaliseTitle(it.title)}`);

async function feedItems(vc, today, rejected) {
  const [news, blog] = await Promise.all([newsItems(vc), blogItems(vc)]);
  return validateItems([...blog, ...news], today).filter(notRejected(vc, rejected)).slice(0, 15);
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
export async function assess(vc, today, rejected = new Set()) {
  const sources = ['news', ...(vc.blog_rss ? ['blog'] : [])];
  try {
    let items = await feedItems(vc, today, rejected);
    let kept = await classify(vc, items, today);
    if (!kept.length) {                 // feeds had nothing about this VC: try grounded web search
      sources.push('search');
      const found = validateItems(await searchItems(vc, today).catch(() => []), today).filter(notRejected(vc, rejected));
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

async function processChunk(run, vcs, today, rejected) {
  const results = (await pool(vcs, PARALLEL, (vc) => assess(vc, today, rejected))).filter(Boolean);

  // Outreach drafts for the VCs worth contacting now.
  const toDraft = results.filter((r) => DRAFT_ACTIONS.has(r.action.code)).map((r) => ({
    vc: r.vc, kind: r.action.code === 'NUDGE_NOW' ? 'nudge' : 'first',
    // Most on-topic first (logistics before B2B SaaS), then strongest; one item per event.
    signals: [...r.kept].filter((s) => s.relevance >= 2)
      .sort((a, b) => b.relevance - a.relevance || b.points - a.points)
      .filter((s, i, arr) => arr.findIndex((x) => (x.event || x.title) === (s.event || s.title)) === i).slice(0, 3),
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
    const rejected = await loadRejected();
    let checked = 0, found = 0;
    for (const chunk of chunks(pending, CHUNK)) {
      if (Date.now() - started > budgetMs) break;
      const res = await processChunk(run, chunk, today, rejected);
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
    // A complete run archives VCs that have been quiet past the window (kept in vc_archive, restorable).
    const archived = remaining ? [] : await archiveStale(run.id, today).catch((e) => { console.error('archive:', e.message); return []; });
    // Scheduled runs email Vikram the brief once the whole pipeline is done.
    if (!remaining && run.trigger === 'cron') await sendDigest(run.id).catch((e) => console.error('digest:', e.message));
    return { run_id: run.id, checked, signals: found, remaining, archived: archived.length, notes_untouched: hashAfter === run.protected_hash_before };
  } catch (err) {
    await db.from('signal_runs').update({ status: 'failed', error: String(err.message || err), finished_at: new Date().toISOString() }).eq('id', run.id);
    throw err;
  }
}

// Check specific VCs right away (a newly added VC), as a small run of its own.
export async function checkVcs(vcIds) {
  const today = todayIst();
  const run = await startRun('single');
  const vcs = await q(db.from('vcs').select('*').in('id', vcIds));
  const res = await processChunk(run, vcs, today, await loadRejected());
  const hashAfter = await q(db.rpc('protected_hash'));
  await q(db.from('signal_runs').update({
    vcs_checked: res.length, signals_found: res.reduce((s, r) => s + r.kept.length, 0),
    protected_hash_after: hashAfter, status: 'done', finished_at: new Date().toISOString(),
  }).eq('id', run.id));
  return { run_id: run.id, checked: res.length };
}

// After Vikram changes his status or last contact, re-decide the action from the
// latest score (no new fetch), still writing only through apply_signal().
export async function reapplyAction(vcId) {
  const today = todayIst();
  const [vc] = await q(db.from('vcs').select('*').eq('id', vcId));
  const [check] = await q(db.from('vc_checks').select('*').eq('vc_id', vcId).order('checked_at', { ascending: false }).limit(1));
  if (!vc || !check) return null;
  const action = decideAction({ score: check.score ?? 0, status: vc.status, lastContact: vc.last_contact }, today);
  await q(db.rpc('apply_signal', {
    p_vc_id: vc.id, p_last_signal_date: vc.last_signal_date, p_summary: vc.signal_summary,
    p_score: check.score ?? 0, p_action: action.label,
  }));
  await q(db.from('vc_checks').update({ action_code: action.code }).eq('id', check.id));
  return action;
}

// Applies the auto-archive rule to every active VC. Writes only to vc_archive, never to vcs.
export async function archiveStale(runId, today) {
  const archived = await archivedIds();
  const vcs = (await q(db.from('vcs').select('id, firm, status, last_signal_date'))).filter((v) => !archived.has(v.id));
  const firstChecks = await q(db.from('vc_checks').select('vc_id, checked_at').order('checked_at', { ascending: true }));
  const first = new Map();
  for (const c of firstChecks) if (!first.has(c.vc_id)) first.set(c.vc_id, c.checked_at.slice(0, 10));
  const restores = await q(db.from('vc_archive').select('vc_id, restored_at').not('restored_at', 'is', null));
  const restored = new Map();
  for (const r of restores) if (!restored.has(r.vc_id) || r.restored_at > restored.get(r.vc_id)) restored.set(r.vc_id, r.restored_at.slice(0, 10));
  const rows = vcs.map((vc) => ({ vc, reason: shouldArchive({ vc, firstChecked: first.get(vc.id), lastRestored: restored.get(vc.id) }, today) }))
    .filter((x) => x.reason)
    .map(({ vc, reason }) => ({ vc_id: vc.id, archived_by: 'rule', reason, run_id: runId }));
  if (rows.length) await q(db.from('vc_archive').insert(rows));
  return rows;
}
