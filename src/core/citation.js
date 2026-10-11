// Does an email draft open on the VC's own recent signal? Used by the drafting guard and the audit.

const GENERIC = new Set(['The', 'This', 'That', 'And', 'For', 'With', 'From', 'Series', 'Seed', 'Funding', 'India', 'Indian',
  'Partners', 'Ventures', 'Capital', 'Venture', 'Raises', 'Raised', 'Raise', 'Crore', 'Million', 'Billion', 'Round', 'Led',
  'Startup', 'Startups', 'Fund', 'Investment', 'Investors', 'New', 'Its', 'His', 'Her', 'Their', 'After', 'Over', 'More']);

// Words that say nothing about a specific signal, plus the founder's own pitch vocabulary
// (a draft describing FreightLoop must not count as citing the VC's signal).
const STOP = new Set(('funding raised raises million billion crore round series startup startups company companies platform ' +
  'investment invested investor investors venture ventures capital partners announced announces recent recently ' +
  'shippers shipper shipments shipment carriers carrier freight invoices invoice reconcile reconciliation workspace ' +
  'tracking booking logistics mid-market indian india founder building build seed raising ' +
  'supply chain chains operations automation automate legacy transform transforming transformation technology solutions').split(' '));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contentWords = (text) => new Set((text.toLowerCase().match(/[a-z][a-z-]{4,}/g) || []).filter((w) => !STOP.has(w)));

// Distinctive capitalised terms (company names, products, events) from the signals' titles and summaries.
export function signalTerms(signals, firm = '') {
  const firmWords = new Set(firm.split(/\W+/));
  const words = signals.flatMap((s) => `${s.title || ''} ${s.summary || ''}`.match(/\b[A-Z][\w.]*[A-Za-z0-9]\b/g) || []);
  return [...new Set(words)].filter((w) => w.length > 2 && !GENERIC.has(w) && !firmWords.has(w));
}

// Cited if the draft names a distinctive term from a signal, or shares at least two
// distinctive content words with one signal (e.g. a firm blog post with no company name in it).
// Only the opening paragraph after the greeting counts: that is where the hook must be.
export function opening(body) {
  const paras = String(body).trim().split(/\n\s*\n/);
  return (/^(hi|hello|dear)\b/i.test(paras[0]) ? paras.slice(1) : paras)[0] || '';
}

export function citesSignal(body, signals, firm = '') {
  const open = opening(body);
  if (signalTerms(signals, firm).some((t) => new RegExp(`\\b${escape(t)}\\b`).test(open))) return true;
  const draft = contentWords(open);
  return signals.some((s) => [...contentWords(`${s.title || ''} ${s.summary || ''}`)].filter((w) => draft.has(w)).length >= 2);
}
