// Evidence validator: a signal only counts if it has a real link and a date
// inside the 30-day window. Applied to every item, whatever its source.
import { WINDOW_DAYS, daysBetween } from './scoring.js';

export function toIsoDate(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function normaliseTitle(title) {
  return String(title || '')
    .replace(/\s+-\s+[^-]+$/, '') // drop " - Publisher" suffix that Google News adds
    .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Investor databases and company-profile pages list old rounds; they are not something the VC did.
const DATABASE_PAGES = /\b(tracxn|crunchbase|pitchbook|cb ?insights|zaubacorp|tofler|craft\.co|wellfound|private company profile|funding rounds (&|and) (list of )?investors)\b/i;

export function validateItems(items, today) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const published = toIsoDate(it.published);
    if (!published || !/^https?:\/\//.test(it.url || '') || !it.title) continue;
    if (DATABASE_PAGES.test(`${it.title} ${it.publisher || ''} ${it.url}`)) continue;
    const age = daysBetween(published, today);
    if (age < 0 || age > WINDOW_DAYS) continue;
    const key = normaliseTitle(it.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...it, published });
  }
  return out.sort((a, b) => b.published.localeCompare(a.published));
}
