// The firm's own blog / Medium / Substack feed.
import { fetchFeed } from './rss.js';

export async function blogItems(vc) {
  if (!vc.blog_rss) return [];
  const items = await fetchFeed(vc.blog_rss).catch(() => []);
  return items.slice(0, 10).map((it) => ({ ...it, publisher: it.publisher || vc.firm, source: 'blog' }));
}
