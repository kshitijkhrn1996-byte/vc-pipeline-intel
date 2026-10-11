// Google News RSS: the partner by name (anchored to investing context, so common
// names don't pull in unrelated people), and the firm's deal/announcement news.
import { fetchFeed } from './rss.js';

const newsUrl = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

// "Peak XV Partners (formerly Sequoia India & SEA)" → "Peak XV Partners"
export const shortFirm = (firm) => firm.replace(/\s*\(.*?\)\s*/g, ' ').trim();

export async function newsItems(vc) {
  const firm = shortFirm(vc.firm);
  const queries = [
    `"${vc.name}" ("${firm}" OR investor OR VC OR startup OR founders) when:30d`,
    `"${firm}" (invests OR led OR raises OR backed OR funding OR partner) when:30d`,
  ];
  const lists = await Promise.all(queries.map((q) => fetchFeed(newsUrl(q)).catch(() => [])));
  return lists.flatMap((l) => l.slice(0, 10)).map((it) => ({ ...it, source: 'news' }));
}
