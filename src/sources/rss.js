// Minimal RSS 2.0 / Atom reader. Enough for Google News, Medium, Substack
// and WordPress feeds without pulling in an XML library.

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const strip = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

export function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    items.push({
      title: strip(tag(b, 'title')),
      url: strip(tag(b, 'link')),
      published: strip(tag(b, 'pubDate') || tag(b, 'dc:date')),
      publisher: strip(tag(b, 'source')),
      snippet: strip(tag(b, 'description')).slice(0, 300),
    });
  }
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const b = m[0];
    const link = b.match(/<link[^>]*href="([^"]+)"/i);
    items.push({
      title: strip(tag(b, 'title')),
      url: link ? decode(link[1]) : '',
      published: strip(tag(b, 'published') || tag(b, 'updated')),
      publisher: '',
      snippet: strip(tag(b, 'summary') || tag(b, 'content')).slice(0, 300),
    });
  }
  return items;
}

export async function fetchFeed(url, timeoutMs = 10_000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (VC pipeline intelligence; +https://vercel.app)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`feed ${res.status} ${url}`);
  return parseFeed(await res.text());
}
