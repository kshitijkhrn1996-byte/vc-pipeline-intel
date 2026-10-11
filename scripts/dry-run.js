// Live collection + Gemini classification + scoring for a few VCs. Reads VCs from Supabase, writes nothing.
// Usage: node --env-file=.env scripts/dry-run.js "Peak XV" "Schematic"
import { db, q } from '../lib/db.js';
import { assess } from '../lib/pipeline.js';
import { todayIst } from '../lib/config.js';

const today = todayIst();
const vcs = (await q(db.from('vcs').select('*').order('id')))
  .filter((v) => process.argv.slice(2).some((f) => v.firm.includes(f)));
for (const r of await Promise.all(vcs.map((vc) => assess(vc, today)))) {
  if (!r) { console.log('classification failed'); continue; }
  console.log(`\n== ${r.vc.name} (${r.vc.firm}) items=${r.items.length} kept=${r.kept.length} score=${r.score} → ${r.action.label}\n   ${r.summary}`);
  for (const k of r.kept.slice(0, 6)) console.log(`  ${k.published} ${k.about}/${k.type}/r${k.relevance} +${k.points} ${k.summary}`);
}
