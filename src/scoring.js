// Deterministic scoring and action rules. Gemini classifies items; this file
// decides what they are worth, so every score can be explained.

export const WINDOW_DAYS = 30;
export const ACTIVE_THRESHOLD = 30;   // score at which a VC is "worth reaching out to"
export const GENERAL_CAP = 15;        // off-topic activity alone can never reach the threshold
export const NUDGE_AFTER_DAYS = 10;   // don't chase a pending reply sooner than this

export const TYPE_WEIGHT = { investment: 1.0, blog: 0.8, event: 0.7, interview: 0.6, other: 0.3 };
// relevance 0..3 → how much it speaks to B2B logistics / supply-chain SaaS
export const RELEVANCE_FACTOR = [0.05, 0.15, 0.6, 1.0];
const MAX_ITEM_POINTS = 40;

export function daysBetween(a, b) {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// Full weight within a week, fading linearly to zero at 30 days.
export function recencyFactor(ageDays) {
  if (ageDays < 0 || ageDays > WINDOW_DAYS) return 0;
  if (ageDays <= 7) return 1;
  return (WINDOW_DAYS - ageDays) / (WINDOW_DAYS - 7);
}

export function itemPoints(item, today) {
  const age = daysBetween(item.published, today);
  const w = TYPE_WEIGHT[item.type] ?? TYPE_WEIGHT.other;
  const r = RELEVANCE_FACTOR[item.relevance] ?? 0;
  return Math.round(MAX_ITEM_POINTS * w * r * recencyFactor(age) * 10) / 10;
}

// Each event counts once (items with the same `event` key are coverage of one thing).
export function scoreVc(items, today) {
  const best = new Map();
  for (const it of items) {
    const key = it.event ?? it.url ?? Math.random();
    const p = itemPoints(it, today);
    if (!best.has(key) || best.get(key).p < p) best.set(key, { p, relevant: it.relevance >= 2 });
  }
  let relevant = 0, general = 0;
  for (const { p, relevant: r } of best.values()) r ? (relevant += p) : (general += p);
  return Math.min(100, Math.round(relevant + Math.min(general, GENERAL_CAP)));
}

export const ACTIONS = {
  REACH_OUT_NOW: 'Reach out now',
  NUDGE_NOW: 'Nudge now',
  HOLD_AWAITING_REPLY: 'Hold: awaiting reply',
  CONTINUE: 'Continue conversation',
  DEPRIORITISE: 'Deprioritise this week',
  SKIP_PASSED: 'Skip: passed',
};

// score × Vikram's own status × time since he last contacted them.
export function decideAction({ score, status, lastContact }, today) {
  const sinceContact = lastContact ? daysBetween(lastContact, today) : null;
  const active = score >= ACTIVE_THRESHOLD;
  switch (status) {
    case 'passed':
      return { code: 'SKIP_PASSED', label: ACTIONS.SKIP_PASSED };
    case 'in_conversation':
      return { code: 'CONTINUE', label: active ? `${ACTIONS.CONTINUE}: mention their recent signal` : ACTIONS.CONTINUE };
    case 'waiting_response':
      if (sinceContact !== null && sinceContact <= NUDGE_AFTER_DAYS)
        return { code: 'HOLD_AWAITING_REPLY', label: `${ACTIONS.HOLD_AWAITING_REPLY} (contacted ${sinceContact}d ago)` };
      return active
        ? { code: 'NUDGE_NOW', label: `${ACTIONS.NUDGE_NOW}: follow up using their signal` }
        : { code: 'DEPRIORITISE', label: `${ACTIONS.DEPRIORITISE}: quiet, nudge when they resurface` };
    default: // yet_to_reach_out
      return active
        ? { code: 'REACH_OUT_NOW', label: `${ACTIONS.REACH_OUT_NOW}: open with their signal` }
        : { code: 'DEPRIORITISE', label: `${ACTIONS.DEPRIORITISE}: no relevant activity` };
  }
}

export const DRAFT_ACTIONS = new Set(['REACH_OUT_NOW', 'NUDGE_NOW']);
