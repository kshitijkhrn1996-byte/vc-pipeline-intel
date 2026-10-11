// Outreach and nudge drafts that open with the VC's specific recent signal.
import { generateJson } from './gemini-client.js';
import { STARTUP } from '../config.js';
import { citesSignal } from '../core/citation.js';

const SCHEMA = {
  type: 'object',
  properties: {
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { vc_id: { type: 'integer' }, subject: { type: 'string' }, body: { type: 'string' } },
        required: ['vc_id', 'subject', 'body'],
      },
    },
  },
  required: ['drafts'],
};

const SYSTEM = `You write short investor outreach emails for ${STARTUP.founder}, founder of ${STARTUP.company}: ${STARTUP.pitch}
Rules: under 120 words; plain text.
The FIRST sentence after the greeting MUST name one of the "Recent signals" listed for that VC: the company, deal, post or
event and what happened (e.g. "Saw that you led BackOps' $42M round for AI supply chain automation"). Prefer the signal most
relevant to logistics or B2B SaaS. Never open with anything else. Portfolio companies or facts in the founder's notes are
background only: never use them as the hook and never present them as recent.
Then one line on why ${STARTUP.company} fits their interest, and one clear ask (a 20-minute call). For a NUDGE, it is a polite
follow-up to an earlier email ("Following up on my note from …"), still anchored on the new signal.
No flattery, no buzzwords, no invented traction numbers, no figures that are not in the signals.
Format as a real email with line breaks: "Hi <first name>," on its own line, a blank line, two or three short paragraphs
separated by blank lines, then "Best," and "${STARTUP.founder}" on separate lines.`;

const describe = ({ vc, kind, signals }) =>
  `VC ${vc.id}: ${vc.name}, ${vc.firm}. Email type: ${kind === 'nudge' ? 'NUDGE (follow-up)' : 'FIRST outreach'}.` +
  ` Last contact: ${vc.last_contact || 'never'}. Contact history: ${vc.contact_history || 'none'}. Founder notes (background only): ${vc.notes || 'none'}\n` +
  `  Recent signals (open with one of these):\n` +
  signals.map((s) => `  - ${s.published}: ${s.title} (${s.summary})`).join('\n');

// list: [{ vc, kind: 'first'|'nudge', signals: [{title,summary,published}] }]
export async function draftEmails(list) {
  if (!list.length) return [];
  const out = await generateJson({ system: SYSTEM, user: list.map(describe).join('\n\n'), schema: SCHEMA });
  const drafts = out.drafts || [];

  // Guard: a draft that does not cite one of its own signals is regenerated once, on its own.
  for (const item of list) {
    const i = drafts.findIndex((d) => d.vc_id === item.vc.id);
    if (i >= 0 && citesSignal(drafts[i].body, item.signals, item.vc.firm)) continue;
    const retry = await generateJson({
      system: SYSTEM,
      user: `${describe(item)}\n\nYour previous draft did not open with one of these recent signals. Rewrite it so the first sentence names one of them.`,
      schema: SCHEMA,
    }).catch(() => ({ drafts: [] }));
    const fixed = (retry.drafts || [])[0];
    if (fixed && citesSignal(fixed.body, item.signals, item.vc.firm)) {
      fixed.vc_id = item.vc.id;
      if (i >= 0) drafts[i] = fixed; else drafts.push(fixed);
    }
  }
  return drafts;
}
