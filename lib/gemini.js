// Gemini Flash: (1) classify each fetched item, (2) write outreach drafts.
// Gemini judges only items we fetched; it never supplies the evidence itself.
import { GEMINI_MODEL, STARTUP } from './config.js';

async function generate({ system, user, schema }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0,
          thinkingConfig: { thinkingLevel: 'low' } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 429 || res.status >= 500) {          // free-tier rate limit: back off and retry
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`gemini ${res.status}: ${data.error?.message}`);
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    return JSON.parse(text);
  }
  throw new Error('gemini: rate limited after retries');
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          idx: { type: 'integer' },
          about: { type: 'string', enum: ['partner', 'firm', 'neither'] },
          type: { type: 'string', enum: ['investment', 'blog', 'interview', 'event', 'other'] },
          relevance: { type: 'integer', minimum: 0, maximum: 3 },
          summary: { type: 'string' },
          event: { type: 'string' },
        },
        required: ['idx', 'about', 'type', 'relevance', 'summary', 'event'],
      },
    },
  },
  required: ['items'],
};

const CLASSIFY_SYSTEM = `You help ${STARTUP.founder}, a founder raising Seed for: ${STARTUP.pitch}
You get one VC (a named partner and their firm) and recent public items about them (news, blog posts, search results).
Return one entry for EVERY item index:
- about: "partner" if the item is about the named person (they wrote it, were quoted, spoke, or led the deal personally);
  "firm" if it is about the firm's activity: any round the firm invested in (lead OR co-investor), a portfolio company
  milestone, a firm post, fund or report; "neither" if it is a namesake, a different firm, or a generic list/tracker page.
- type: investment (the firm/partner invested or led a round), blog (they wrote it), interview (quoted, podcast, interview),
  event (spoke/judged/appeared at an event), other.
- relevance 0-3 to the founder's space: 3 = logistics, freight, supply chain, trucking, warehousing, procurement tech;
  2 = B2B SaaS / enterprise software / Indian SMB tooling; 1 = general startup or seed investing activity; 0 = unrelated.
- summary: max 18 words, factual, from the item only. No speculation.
- event: short kebab-case id of the underlying real-world event (e.g. "lumio-series-a"). Several outlets covering
  the same deal, post or talk MUST share the same event id.`;

// One VC per call: batching several made Gemini skip some VCs entirely.
export async function classifyVc(vc, items) {
  const user = `VC: ${vc.name}, ${vc.firm}. Thesis: ${vc.thesis || 'n/a'}\n` +
    items.map((it, i) => `[${i}] (${it.source}, ${it.published}, ${it.publisher || ''}) ${it.title}${it.snippet ? ' | ' + it.snippet.slice(0, 160) : ''}`).join('\n');
  const out = await generate({ system: CLASSIFY_SYSTEM, user, schema: CLASSIFY_SCHEMA });
  return out.items || [];
}

const DRAFT_SCHEMA = {
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

const DRAFT_SYSTEM = `You write short investor outreach emails for ${STARTUP.founder}, founder of ${STARTUP.company}: ${STARTUP.pitch}
Rules: under 120 words; plain text; open by referencing the VC's specific recent signal (give the concrete thing, not "your recent post");
one line on why ${STARTUP.company} fits their interest; one clear ask (a 20-minute call). For a NUDGE, it is a polite follow-up
to an earlier email, still anchored on the new signal. Use the founder's notes for context but never quote them.
No flattery, no buzzwords, no invented traction numbers. Sign off as "${STARTUP.founder}".`;

// list: [{ vc, kind: 'first'|'nudge', signals: [{title,summary,published}] }]
export async function draftEmails(list) {
  if (!list.length) return [];
  const user = list.map(({ vc, kind, signals }) =>
    `VC ${vc.id}: ${vc.name}, ${vc.firm}. Email type: ${kind === 'nudge' ? 'NUDGE (follow-up)' : 'FIRST outreach'}.` +
    ` Last contact: ${vc.last_contact || 'never'}. Contact history: ${vc.contact_history || 'none'}. Founder notes: ${vc.notes || 'none'}\n` +
    signals.map((s) => `  - ${s.published}: ${s.title} (${s.summary})`).join('\n'),
  ).join('\n\n');
  const out = await generate({ system: DRAFT_SYSTEM, user, schema: DRAFT_SCHEMA });
  return out.drafts || [];
}
