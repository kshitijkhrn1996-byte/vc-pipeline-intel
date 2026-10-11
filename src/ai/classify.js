// Gemini judges only items we fetched; it never supplies the evidence itself.
import { generateJson } from './gemini-client.js';
import { STARTUP } from '../config.js';

const SCHEMA = {
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

const SYSTEM = `You help ${STARTUP.founder}, a founder raising Seed for: ${STARTUP.pitch}
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
  const out = await generateJson({ system: SYSTEM, user, schema: SCHEMA });
  return out.items || [];
}
