// Deterministic scoring. Gemini classifies items; this file decides what they
// are worth, so every score can be explained.

export const WINDOW_DAYS = 30;
export const GENERAL_CAP = 15;        // off-topic activity alone can never reach the outreach threshold

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
