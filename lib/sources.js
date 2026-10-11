// Live signal collectors. Each returns raw items: {source, title, url, published, publisher, snippet}.
import { fetchFeed } from './rss.js';
import { GEMINI_MODEL } from './config.js';

const newsUrl = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

// "Peak XV Partners (formerly Sequoia India & SEA)" → "Peak XV Partners"
export const shortFirm = (firm) => firm.replace(/\s*\(.*?\)\s*/g, ' ').trim();

// 1) Google News: the partner by name (anchored to investing context, so common
//    names don't pull in unrelated people), and the firm's deal/announcement news.
export async function newsItems(vc) {
  const firm = shortFirm(vc.firm);
  const queries = [
    `"${vc.name}" ("${firm}" OR investor OR VC OR startup OR founders) when:30d`,
    `"${firm}" (invests OR led OR raises OR backed OR funding OR partner) when:30d`,
  ];
  const lists = await Promise.all(queries.map((q) => fetchFeed(newsUrl(q)).catch(() => [])));
  return lists.flatMap((l) => l.slice(0, 10)).map((it) => ({ ...it, source: 'news' }));
}

// 2) The firm's own blog / Medium / Substack feed.
export async function blogItems(vc) {
  if (!vc.blog_rss) return [];
  const items = await fetchFeed(vc.blog_rss).catch(() => []);
  return items.slice(0, 10).map((it) => ({ ...it, publisher: it.publisher || vc.firm, source: 'blog' }));
}

// 3) Fallback when the feeds find nothing: Gemini with Google Search grounding.
//    Its URLs are model-reported, so each one must load before it is kept.
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
