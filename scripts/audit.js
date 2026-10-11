// Audits the latest run end to end: coverage, evidence, score and action reproducibility,
// the four-column guarantee, and every email draft. Reads only; writes nothing.
// Usage: npm run audit            (latest run)     npm run audit -- 12   (a specific run)
import { db, q } from '../src/db/client.js';
import { scoreVc } from '../src/core/scoring.js';
import { decideAction, DRAFT_ACTIONS } from '../src/core/actions.js';
import { shortFirm } from '../src/sources/google-news.js';
import { citesSignal } from '../src/core/citation.js';

const runId = Number(process.argv[2]) || null;
const [run] = runId
  ? await q(db.from('signal_runs').select('*').eq('id', runId))
  : await q(db.from('signal_runs').select('*').neq('trigger', 'single').eq('status', 'done').order('id', { ascending: false }).limit(1));
const runDay = new Date(Date.parse(run.started_at) + 5.5 * 3_600_000).toISOString().slice(0, 10); // IST date of the run
const [vcs, checks, signals] = await Promise.all([
  q(db.from('vcs').select('*').order('id')),
  q(db.from('vc_checks').select('*').eq('run_id', run.id)),
  q(db.from('signals').select('*').eq('run_id', run.id)),
]);
const checkOf = new Map(checks.map((c) => [c.vc_id, c]));
const sigOf = new Map();
for (const s of signals) { if (!sigOf.has(s.vc_id)) sigOf.set(s.vc_id, []); sigOf.get(s.vc_id).push(s); }

const fails = [], warns = [];
const fail = (m) => fails.push(m), warn = (m) => warns.push(m);
const days = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);

// 1. Coverage and the notes guarantee
if (run.vcs_checked !== vcs.length) fail(`run checked ${run.vcs_checked} of ${vcs.length} VCs`);
for (const v of vcs) if (!checkOf.has(v.id)) fail(`${v.firm}: no check in run ${run.id}`);
if (run.protected_hash_before !== run.protected_hash_after) fail('Vikram\'s columns changed during the run');

// 2. Evidence: real link, inside the 30-day window, sane fields
for (const s of signals) {
  const age = days(s.published, runDay);
  if (!/^https?:\/\//.test(s.url)) fail(`signal ${s.id}: bad URL`);
  if (age < 0 || age > 30) fail(`signal ${s.id} (${s.published}) is outside the 30-day window`);
  if (!['partner', 'firm'].includes(s.about)) fail(`signal ${s.id}: about=${s.about}`);
  if (/tracxn|crunchbase|pitchbook/i.test(`${s.title} ${s.url}`)) fail(`signal ${s.id}: investor-database page slipped through`);
}

// 3. Scores, actions and the four signal columns are reproducible from the stored evidence
for (const v of vcs) {
  const c = checkOf.get(v.id); if (!c) continue;
  const score = scoreVc((sigOf.get(v.id) || []).map((s) => ({ ...s, relevance: s.relevance })), runDay);
  if (score !== c.score) fail(`${v.firm}: stored score ${c.score}, recomputed ${score}`);
  if (v.follow_up_score !== c.score) fail(`${v.firm}: vcs.follow_up_score ${v.follow_up_score} ≠ check ${c.score}`);
  const expected = decideAction({ score: c.score, status: v.status, lastContact: v.last_contact }, runDay).code;
  if (expected !== c.action_code) fail(`${v.firm}: action ${c.action_code}, rules say ${expected}`);
  const last = (sigOf.get(v.id) || []).map((s) => s.published).sort().pop();
  if (last && v.last_signal_date < last) fail(`${v.firm}: last_signal_date ${v.last_signal_date} older than newest signal ${last}`);
}

// 4. Email drafts
const FIRMS = vcs.map((v) => ({ id: v.id, name: shortFirm(v.firm).replace(/ (Partners|Ventures|Capital|Venture Partners)$/i, '') }));
const draftReport = [];
for (const v of vcs) {
  const c = checkOf.get(v.id); if (!c) continue;
  const wants = DRAFT_ACTIONS.has(c.action_code);
  if (wants && !c.draft_body) { fail(`${v.firm}: ${c.action_code} but no draft`); continue; }
  if (!wants && c.draft_body) { fail(`${v.firm}: draft written for ${c.action_code}`); continue; }
  if (!wants) continue;
  const body = c.draft_body, first = v.name.split(' ')[0];
  const words = body.split(/\s+/).filter(Boolean).length;
  const rel = (sigOf.get(v.id) || []).filter((s) => s.relevance >= 2);
  const text = rel.map((s) => `${s.title} ${s.summary}`).join(' ').toLowerCase();
  // the signal the draft cites must be one of this VC's own signals
  const citesOwn = citesSignal(body, rel, v.firm);
  const otherFirms = FIRMS.filter((f) => f.id !== v.id && f.name.length > 4 && new RegExp(`\\b${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body)
    && !new RegExp(f.name, 'i').test(`${v.firm} ${text}`)).map((f) => f.name);
  const nums = (body.match(/(?:\$|rs\.?\s?|₹)\s?[\d,.]+\s?(?:m|mn|million|crore|cr|k|bn|billion)?|\b\d+(?:\.\d+)?\s?%/gi) || [])
    .filter((n) => !text.includes(n.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^rs\.?\s?/, 'rs ')) && !text.includes(n.replace(/[^\d.]/g, '')));
  const isNudge = c.action_code === 'NUDGE_NOW';
  const nudgeWords = /follow(ing)? up|following up|my (earlier|previous|last) (note|email)|wanted to follow|circling back|reaching back/i.test(body);
  const checksRow = {
    vc: `${v.name} (${shortFirm(v.firm)})`, kind: isNudge ? 'nudge' : 'first', to: v.email || '(none on file)',
    greeting: new RegExp(`^(Hi|Hello|Dear) ${first}\\b`).test(body.trim()),
    signedVikram: /Best,?\s*\n\s*Vikram\s*$/.test(body.trim()),
    words, citesOwnSignal: citesOwn, otherFirms, unexplainedNumbers: nums,
    kindMatches: isNudge ? nudgeWords : !nudgeWords,
  };
  draftReport.push({ ...checksRow, subject: c.draft_subject, body });
  const tag = `${v.firm} draft`;
  if (!checksRow.greeting) fail(`${tag}: greeting is not "Hi ${first}"`);
  if (!checksRow.signedVikram) fail(`${tag}: not signed "Best, Vikram"`);
  if (words > 140) fail(`${tag}: ${words} words (limit ~120)`);
  if (!citesOwn) fail(`${tag}: does not cite any of this VC's own signals`);
  if (otherFirms.length) fail(`${tag}: mentions another VC on the list: ${otherFirms.join(', ')}`);
  if (nums.length) warn(`${tag}: numbers not found in its signals: ${nums.join(', ')}`);
  if (!checksRow.kindMatches) fail(`${tag}: written as ${isNudge ? 'a first email' : 'a follow-up'} but should be ${isNudge ? 'a nudge' : 'a first email'}`);
  if (!v.email) warn(`${tag}: no email address on file (Vikram adds it)`);
}

// Report
const by = {}; for (const c of checks) by[c.action_code] = (by[c.action_code] || 0) + 1;
console.log(`\nRUN ${run.id} · ${run.trigger} · ${run.started_at} · ${run.vcs_checked} VCs · ${signals.length} signals · notes ${run.protected_hash_before === run.protected_hash_after ? 'untouched' : 'CHANGED'}`);
console.log('actions:', JSON.stringify(by));
console.log(`\nDRAFTS (${draftReport.length})`);
for (const d of draftReport) {
  console.log(`\n— ${d.vc} · ${d.kind} · to ${d.to} · ${d.words} words · greeting ${d.greeting ? 'ok' : 'BAD'} · sign-off ${d.signedVikram ? 'ok' : 'BAD'} · cites own signal ${d.citesOwnSignal ? 'yes' : 'NO'} · type ${d.kindMatches ? 'ok' : 'WRONG'}`);
  console.log(`  Subject: ${d.subject}\n  ${d.body.replace(/\n+/g, '\n  ')}`);
}
console.log(`\n${fails.length ? `FAILED ${fails.length}:\n - ${fails.join('\n - ')}` : 'ALL CHECKS PASSED'}`);
if (warns.length) console.log(`warnings ${warns.length}:\n - ${warns.join('\n - ')}`);
process.exit(fails.length ? 1 : 0);
