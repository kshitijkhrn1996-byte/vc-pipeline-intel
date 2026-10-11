// Fallback when the feeds find nothing relevant: Gemini with Google Search grounding.
// Its URLs are model-reported, so each one must load before it is kept.
import { GEMINI_MODEL } from '../config.js';
import { shortFirm } from './google-news.js';

export async function searchItems(vc, today) {
  const from = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);
  const prompt = `Find public things that ${vc.name} of ${shortFirm(vc.firm)} (venture capital) wrote, said in an interview or podcast, ` +
    `invested in, or spoke at, published between ${from} and ${today}. Include investments announced by ${vc.firm}. ` +
    `Reply ONLY with a JSON array (max 5) of {"title","date":"YYYY-MM-DD","url"}. Use [] if you find nothing in that window. ` +
    `Never invent a URL.`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const match = text.match(/\[[\s\S]*\]/);
  let rows = [];
  try { rows = match ? JSON.parse(match[0]) : []; } catch { rows = []; }
  const checked = await Promise.all(rows.slice(0, 5).map(async (r) => ((await urlLoads(r.url)) ? r : null)));
  return checked.filter(Boolean).map((r) => ({
    source: 'search', title: r.title, url: r.url, published: r.date, publisher: hostOf(r.url), snippet: '',
  }));
}

async function urlLoads(url) {
  if (!/^https?:\/\//.test(url || '')) return false;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' } });
    return res.status < 400 || res.status === 403; // 403: exists but blocks bots
  } catch { return false; }
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
