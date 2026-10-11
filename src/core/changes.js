// What changed for a VC between its two most recent checks.
import { ACTIVE_THRESHOLD } from './actions.js';

const ACTIONABLE = new Set(['REACH_OUT_NOW', 'NUDGE_NOW']);
export const TREND_STEP = 10; // score change that counts as heating up / cooling down

// latest, previous: { score, action_code, checked_at }; evidence: [{ published }] from the latest check.
export function changesSince(latest, previous, evidence = []) {
  if (!latest) return { delta: 0, flags: [], newSignals: 0 };
  if (!previous) return { delta: 0, flags: ['first_check'], newSignals: evidence.length };
  const since = String(previous.checked_at).slice(0, 10);
  const newSignals = evidence.filter((e) => e.published >= since).length;
  const delta = (latest.score ?? 0) - (previous.score ?? 0);
  const flags = [];
  if (ACTIONABLE.has(latest.action_code) && !ACTIONABLE.has(previous.action_code)) flags.push('now_actionable');
  if ((previous.score ?? 0) >= ACTIVE_THRESHOLD && (latest.score ?? 0) < ACTIVE_THRESHOLD) flags.push('went_quiet');
  if (delta >= TREND_STEP) flags.push('heating_up');
  if (delta <= -TREND_STEP && !flags.includes('went_quiet')) flags.push('cooling_down');
  if (newSignals) flags.push('new_signal');
  return { delta, flags, newSignals };
}
