// Who Vikram is and what he is raising. Used to judge relevance and write drafts.
export const STARTUP = {
  founder: process.env.FOUNDER_NAME || 'Vikram',
  company: process.env.COMPANY_NAME || 'FreightLoop',
  pitch: process.env.COMPANY_PITCH ||
    'B2B logistics SaaS for Indian mid-market shippers: one workspace to book carriers, track shipments ' +
    'and reconcile freight invoices. Raising a Seed round.',
};

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export function todayIst() {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
