// Outreach and nudge drafts that open with the VC's specific recent signal.
import { generateJson } from './gemini-client.js';
import { STARTUP } from '../config.js';

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
Rules: under 120 words; plain text; open by referencing the VC's specific recent signal (give the concrete thing, not "your recent post");
one line on why ${STARTUP.company} fits their interest; one clear ask (a 20-minute call). For a NUDGE, it is a polite follow-up
to an earlier email, still anchored on the new signal. Use the founder's notes for context but never quote them.
No flattery, no buzzwords, no invented traction numbers.
Format as a real email with line breaks: "Hi <first name>," on its own line, a blank line, two or three short paragraphs
separated by blank lines, then "Best," and "${STARTUP.founder}" on separate lines.`;

// list: [{ vc, kind: 'first'|'nudge', signals: [{title,summary,published}] }]
export async function draftEmails(list) {
  if (!list.length) return [];
  const user = list.map(({ vc, kind, signals }) =>
    `VC ${vc.id}: ${vc.name}, ${vc.firm}. Email type: ${kind === 'nudge' ? 'NUDGE (follow-up)' : 'FIRST outreach'}.` +
    ` Last contact: ${vc.last_contact || 'never'}. Contact history: ${vc.contact_history || 'none'}. Founder notes: ${vc.notes || 'none'}\n` +
    signals.map((s) => `  - ${s.published}: ${s.title} (${s.summary})`).join('\n'),
  ).join('\n\n');
  const out = await generateJson({ system: SYSTEM, user, schema: SCHEMA });
  return out.drafts || [];
}
