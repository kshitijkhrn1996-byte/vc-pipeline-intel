// Builds sql/seed.sql from data/vcs.json, adding Vikram's (fictional) relationship
// columns: status, last contact, contact history and notes.
// Usage: node scripts/seed.js   → then run sql/seed.sql in Supabase.
import { readFileSync, writeFileSync } from 'node:fs';

const vcs = JSON.parse(readFileSync(new URL('../data/vcs.json', import.meta.url)));
const TODAY = Date.parse('2026-10-11');
const daysAgo = (n) => new Date(TODAY - n * 86_400_000).toISOString().slice(0, 10);

// A plausible two-month pipeline: [status, days since last contact, history, notes]
const PLAYBOOK = [
  ['waiting_response', 4, 'Cold email with deck', 'Sent via warm intro from IIM batchmate. Wait a week.'],
  ['waiting_response', 21, 'Cold email; one follow-up', 'Associate opened the deck twice (DocSend).'],
  ['in_conversation', 6, 'Intro call done; asked for unit economics', 'Liked the invoice-reconciliation wedge. Send cohort data.'],
  ['yet_to_reach_out', null, '', 'Need a warm intro. Check if any portfolio founder knows them.'],
  ['waiting_response', 33, 'Met at Bengaluru SaaS meetup; emailed deck', 'Said "logistics is crowded" but kept the deck.'],
  ['yet_to_reach_out', null, '', ''],
  ['passed', 18, 'Call + partner review', 'Passed: too early for them, revisit at Series A.'],
  ['waiting_response', 12, 'Email via founder referral', 'Referral from portfolio founder. Promised a reply after their AGM.'],
  ['yet_to_reach_out', null, '', 'Strong logistics portfolio. Prioritise when there is a hook.'],
  ['in_conversation', 9, 'Two calls; data room shared', 'Diligence on carrier network. Follow up on references.'],
];

const sql = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

const rows = vcs.map((vc, i) => {
  const [status, ago, history, notes] = PLAYBOOK[i % PLAYBOOK.length];
  const last = ago === null ? null : daysAgo(ago + (i % 3));
  const hist = history ? `${last}: ${history}` : '';
  const fullNotes = [notes, vc.portfolio_example ? `Portfolio fit: ${vc.portfolio_example}.` : ''].filter(Boolean).join(' ');
  return `(${[vc.name, vc.firm, vc.thesis, vc.email, vc.website, vc.blog_rss, status, last, hist, fullNotes].map(sql).join(', ')})`;
});

writeFileSync(new URL('../sql/seed.sql', import.meta.url),
  `insert into vcs (name, firm, thesis, email, website, blog_rss, status, last_contact, contact_history, notes) values\n` +
  rows.join(',\n') + `\non conflict (name, firm) do nothing;\n`);
console.log(`wrote ${rows.length} rows to sql/seed.sql`);
