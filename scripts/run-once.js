// Runs the full pipeline once from your machine (same code path as the scheduled run).
// Usage: npm run pipeline
import { runPipeline } from '../src/pipeline/run.js';

let r = await runPipeline({ trigger: 'manual', force: true, budgetMs: 900_000 });
while (r.remaining) r = await runPipeline({ trigger: 'manual', runId: r.run_id, force: true, budgetMs: 900_000 });
console.log(r);
