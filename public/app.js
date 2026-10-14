// Pipeline Radar dashboard. Plain JS, no framework: renders /api/vcs; acts through /api/vcs, /api/actions, /api/run, /api/status.
// Pages: #overview · #pipeline (drag-and-drop board) · #investors · #signals · #archived. A drawer shows one VC.

// ---------- state & helpers ----------
const params = new URLSearchParams(location.search);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let KEY = params.get('key') || store.get('vc_key'); // only needed if the server sets DASHBOARD_KEY
if (params.get('key')) store.set('vc_key', KEY);
const withKey = (p) => KEY ? `${p}${p.includes('?') ? '&' : '?'}key=${encodeURIComponent(KEY)}` : p;

let DATA = null, RUNNING = false, QUERY = '';
const UI = { inv: 'all', sort: { key: 'score', dir: 'desc' }, pri: 'all', sigType: 'all', sigRel: 'all' };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const fmtD = (d) => d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const fmtT = (d) => d ? new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const daysAgo = (d) => d ? Math.round((Date.parse(istToday()) - Date.parse(d.slice(0, 10))) / DAY) : null;
const ago = (d) => { const n = daysAgo(d); return n === null ? '—' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n}d ago`; };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const clean = (s) => String(s || '').replace(/ \[firm\]/g, '');
const short = (firm) => String(firm).replace(/\s*\(.*?\)\s*/g, ' ').trim();
const first = (name) => String(name).split(' ')[0];

const STATUS = { yet_to_reach_out: 'Yet to reach out', waiting_response: 'Waiting for reply', in_conversation: 'In conversation', passed: 'Passed' };
const STATUS_DOT = { yet_to_reach_out: '#2a78d6', waiting_response: '#eb6834', in_conversation: '#4a3aa7', passed: '#c3cad5' };
const GROUP = { REACH_OUT_NOW: 'go', NUDGE_NOW: 'nudge', HOLD_AWAITING_REPLY: 'hold', CONTINUE: 'hold', DEPRIORITISE: 'quiet', SKIP_PASSED: 'passed' };
const GROUP_LABEL = { go: 'Reach out now', nudge: 'Nudge now', hold: 'In progress', quiet: 'Quiet this week', passed: 'Passed' };
const SHORT = { REACH_OUT_NOW: 'Reach out now', NUDGE_NOW: 'Nudge now', HOLD_AWAITING_REPLY: 'Hold · awaiting reply', CONTINUE: 'In conversation', DEPRIORITISE: 'Quiet · skip this week', SKIP_PASSED: 'Passed' };
const TYPE = { investment: 'Deal', blog: 'Post', interview: 'Interview', event: 'Event', other: 'News' };
const PLURAL = { investment: 'Deals', blog: 'Posts', interview: 'Interviews', event: 'Events', other: 'Other news' };
const REL = ['Off-topic', 'General', 'B2B SaaS', 'Logistics'];
const THRESHOLD = 30;
const code = (v) => v.check?.action_code || 'DEPRIORITISE';
const group = (v) => GROUP[code(v)] || 'quiet';
const flags = (v) => v.change?.flags || [];

// ---------- icons ----------
const I = {
  overview: '<path d="M3 13h8V3H3zM13 21h8v-8h-8zM3 21h8v-6H3zM13 3v8h8V3z"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  investors: '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
  signals: '<path d="M2 12h3l3-8 4 16 3-8h7"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  run: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`;

// ---------- firm logos (favicon, falling back to initials) ----------
const LOGO_BG = ['#1f2a44', '#1f63c2', '#4a3aa7', '#0f766e', '#b8471a', '#475467', '#7a3e9d', '#2f6f4f'];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const initials = (firm) => short(firm).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '•';
function domainOf(v) { try { return new URL(v.website).hostname.replace(/^www\./, ''); } catch { return ''; } }
function logo(v, size = '') {
  const bg = LOGO_BG[hash(v.firm) % LOGO_BG.length], ini = esc(initials(v.firm)), d = domainOf(v);
  const img = d ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64" alt="" loading="lazy" onload="logoCheck(this)" onerror="logoFail(this)">` : '';
  return `<span class="logo ${size}" style="${d ? '' : `background:${bg};border-color:${bg}`}" data-bg="${bg}" data-ini="${ini}">${img || ini}</span>`;
}
window.logoFail = (img) => { const s = img.parentElement; s.style.background = s.dataset.bg; s.style.borderColor = s.dataset.bg; s.textContent = s.dataset.ini; };
window.logoCheck = (img) => { if (img.naturalWidth && img.naturalWidth <= 16) window.logoFail(img); }; // 16px = "no icon" placeholder

// ---------- api ----------
async function api(path, opts = {}) {
  const res = await fetch(withKey(path), { ...opts, headers: { 'Content-Type': 'application/json' } });
  let body = {};
  try { body = await res.json(); } catch {}
  if (res.status === 401) throw new Error('This dashboard needs an access key. Add ?key=… to the address.');
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const act = (payload) => api('/api/actions', { method: 'POST', body: JSON.stringify(payload) });
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(Object.assign(document.createElement('span'), { textContent: msg }));
  if (action) { const b = Object.assign(document.createElement('button'), { textContent: action.label, type: 'button' }); b.onclick = () => { t.classList.remove('on'); action.fn(); }; t.append(b); }
  t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), action ? 6000 : 3200);
}

async function load() {
  DATA = await api('/api/vcs');
  render();
}

// ---------- derived data ----------
function events(v) { // one row per real-world event; several outlets fold into one
  const map = new Map();
  for (const s of v.evidence) {
    const k = s.event || s.title, cur = map.get(k);
    if (!cur) map.set(k, { ...s, outlets: 1 });
    else { cur.outlets++; if (+s.points > +cur.points) Object.assign(cur, s, { outlets: cur.outlets }); }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.published.localeCompare(a.published));
}
const topEvent = (v) => events(v).sort((a, b) => b.relevance - a.relevance || b.points - a.points)[0];
function counts() {
  const c = { go: 0, nudge: 0, hold: 0, quiet: 0, passed: 0 };
  for (const v of DATA.vcs) c[group(v)]++;
  return c;
}
const allEvents = () => DATA.vcs.flatMap((v) => events(v).map((e) => ({ ...e, vc: v })));
function nextAutoRun() {
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, 1, 0));
    if ([1, 4].includes(d.getUTCDay()) && d > now) return d;
  }
}
const intact = (r) => r && r.protected_hash_after && r.protected_hash_before === r.protected_hash_after;
const matches = (v) => !QUERY || `${v.name} ${v.firm} ${v.notes || ''} ${v.signal_summary || ''}`.toLowerCase().includes(QUERY.toLowerCase());

// ---------- small components ----------
function meter(score) {
  return `<span class="meter" role="img" aria-label="Score ${score ?? 0} of 100; outreach line at ${THRESHOLD}"><span class="f" style="width:${Math.max(0, Math.min(100, score ?? 0))}%"></span><span class="th" style="left:${THRESHOLD}%"></span></span>`;
}
function spark(values, w = 84, h = 26) {
  if (!values || values.length < 2) return `<span class="spark-none">first run</span>`;
  const x = (i) => (i / (values.length - 1)) * (w - 4) + 2, y = (s) => h - 2 - (Math.min(100, s) / 100) * (h - 4);
  const pts = values.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score over the last ${values.length} runs: ${values.join(', ')}">
    <line x1="0" x2="${w}" y1="${y(THRESHOLD)}" y2="${y(THRESHOLD)}" class="spark-th"/><polygon points="2,${h - 2} ${pts} ${x(values.length - 1)},${h - 2}" class="spark-area"/>
    <polyline points="${pts}" class="spark-line"/><circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="3" class="spark-dot"/></svg>`;
}
function badges(v) {
  const c = v.change || {}, f = flags(v), out = [];
  if (f.includes('now_actionable')) out.push('<span class="badge new">New this run</span>');
  if (f.includes('heating_up')) out.push(`<span class="badge up">▲ +${c.delta}</span>`);
  if (f.includes('cooling_down')) out.push(`<span class="badge down">▼ ${c.delta}</span>`);
  if (f.includes('went_quiet')) out.push('<span class="badge down">Went quiet</span>');
  if (c.newSignals && !f.includes('first_check')) out.push(`<span class="badge sig">${plural(c.newSignals, 'new signal')}</span>`);
  return out.join('');
}
const relTag = (r) => `<span class="tag"><i style="background:var(--rel-${Math.max(1, r)})"></i>${REL[r]}</span>`;
const pill = (v) => `<span class="pill ${group(v)}">${SHORT[code(v)]}</span>`;
const scoreCell = (v) => `<span class="score"><b>${v.follow_up_score ?? 0}</b>${meter(v.follow_up_score)}</span>`;

function strip(v) {
  const today = Date.parse(istToday()), best = {};
  for (const s of v.evidence) { const k = Math.round((today - Date.parse(s.published)) / DAY); best[k] = Math.max(best[k] ?? -1, s.relevance); }
  let cells = '';
  for (let k = 29; k >= 0; k--) {
    const r = best[k], day = new Date(today - k * DAY).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    cells += `<i class="${r === undefined ? '' : 'r' + Math.max(1, r)}" title="${day}${r === undefined ? '' : ' · ' + REL[r] + ' signal'}"></i>`;
  }
  return `<div><div class="strip" aria-label="Signals over the last 30 days">${cells}</div><div class="strip-axis"><span>30 days ago</span><span>today</span></div></div>`;
}
function evRow(e, v) {
  const rej = e.verdict === 'not_relevant', ok = e.verdict === 'useful';
  return `<div class="ev ${rej ? 'rejected' : ''}"><span class="d">${fmtD(e.published)}</span>
    <span class="s"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(clean(e.summary || e.title))}</a>
      <small><span class="tag">${TYPE[e.type] || 'News'}</span>${relTag(e.relevance)}<span>${e.about === 'partner' ? 'About the partner' : 'Firm activity'} · ${e.source === 'blog' ? 'firm blog' : e.source === 'search' ? 'web search' : 'news'}${e.outlets > 1 ? ` · ${e.outlets} outlets` : ''}${rej ? ' · excluded from the next run' : ''}</span></small></span>
    ${fbButtons(e, v)}</div>`;
}
function fbButtons(e, v) {
  const rej = e.verdict === 'not_relevant', ok = e.verdict === 'useful', d = `data-vc="${v.id}" data-url="${esc(e.url)}" data-title="${esc(e.title)}"`;
  return `<span class="fb" role="group" aria-label="Was this signal useful?">
    <button type="button" class="fb-btn ${ok ? 'on' : ''}" data-act="fb" data-fb="useful" ${d} aria-pressed="${ok}" title="Useful signal">👍</button>
    <button type="button" class="fb-btn ${rej ? 'on' : ''}" data-act="fb" data-fb="not_relevant" ${d} aria-pressed="${rej}" title="Not relevant: ignore in future runs">👎</button></span>`;
}

// ---------- tooltip (charts) ----------
const TIPS = [];
const tipRef = (obj) => TIPS.push(obj) - 1;
function showTip(el, ev) {
  const t = TIPS[+el.dataset.tip]; if (!t) return;
  const box = $('#tip'); box.replaceChildren();
  const title = document.createElement('b'); title.textContent = t.title; box.append(title);
  for (const r of t.rows) {
    const row = document.createElement('div'); row.className = 'row';
    const k = document.createElement('span'); const key = document.createElement('i'); key.className = 'k'; key.style.background = r.color || '#fff';
    k.append(key, document.createTextNode(r.label));
    const val = document.createElement('b'); val.textContent = r.value; val.style.fontSize = '12.5px';
    row.append(k, val); box.append(row);
  }
  box.hidden = false;
  const x = Math.min(ev.clientX + 14, innerWidth - box.offsetWidth - 10), y = Math.max(10, ev.clientY - box.offsetHeight - 12);
  box.style.left = `${x}px`; box.style.top = `${y}px`;
}
document.addEventListener('pointermove', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el, e); else $('#tip').hidden = true; });
document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, { clientX: r.left + r.width / 2, clientY: r.top }); } });
document.addEventListener('focusout', () => { $('#tip').hidden = true; });

// ---------- charts ----------
const niceMax = (m) => { if (m <= 4) return 4; const p = 10 ** Math.floor(Math.log10(m)); const n = [1, 2, 2.5, 5, 10].find((k) => k * p >= m); return n * p; };
const topRounded = (x, y, w, h, r) => { r = Math.min(r, h, w / 2); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };

// Distinct events per day over the last 30 days, stacked by relevance (ordinal blue ramp).
function signalsChart() {
  const today = Date.parse(istToday()), W = 720, H = 230, L = 30, R = 8, T = 12, B = 26;
  const days = Array.from({ length: 30 }, (_, i) => ({ t: today - (29 - i) * DAY, g: 0, b: 0, l: 0 }));
  for (const e of allEvents()) {
    const k = 29 - Math.round((today - Date.parse(e.published)) / DAY);
    if (k < 0 || k > 29) continue;
    if (e.relevance === 3) days[k].l++; else if (e.relevance === 2) days[k].b++; else days[k].g++;
  }
  const max = niceMax(Math.max(...days.map((d) => d.g + d.b + d.l)));
  const pw = W - L - R, ph = H - T - B, slot = pw / 30, bw = Math.min(16, slot - 4), y = (v) => T + ph - (v / max) * ph;
  const ticks = [0, max / 2, max];
  let out = `<g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
  out += ticks.map((v) => `<text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  days.forEach((d, i) => {
    const x = L + i * slot + (slot - bw) / 2, total = d.g + d.b + d.l;
    const label = new Date(d.t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    let y0 = y(0), segs = '';
    const parts = [['g', d.g, 'var(--rel-1)'], ['b', d.b, 'var(--rel-2)'], ['l', d.l, 'var(--rel-3)']].filter((p) => p[1] > 0);
    parts.forEach(([, n, c], j) => {
      const h = (n / max) * ph, top = j === parts.length - 1, gap = j > 0 ? 2 : 0;
      segs += top ? `<path class="seg" d="${topRounded(x, y0 - h + gap, bw, h - gap, 4)}" fill="${c}"/>` : `<rect class="seg" x="${x}" y="${y0 - h + gap}" width="${bw}" height="${Math.max(0, h - gap)}" fill="${c}"/>`;
      y0 -= h;
    });
    const tip = tipRef({ title: `${label} · ${plural(total, 'signal')}`, rows: [
      { label: 'Logistics', value: d.l, color: '#104281' }, { label: 'B2B SaaS', value: d.b, color: '#2a78d6' }, { label: 'General', value: d.g, color: '#86b6ef' }] });
    out += `<g class="col" data-tip="${tip}" tabindex="0" aria-label="${label}: ${total} signals"><rect class="hl" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph}" rx="4"/>${segs}</g>`;
    if (i % 7 === 1 || i === 29) out += `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${i === 29 ? 'today' : label}</text>`;
  });
  out += `<line class="base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Signals per day over the last 30 days, by relevance">${out}</svg></div>
    <div class="legend"><span><i style="background:var(--rel-3)"></i>Logistics</span><span><i style="background:var(--rel-2)"></i>B2B SaaS</span><span><i style="background:var(--rel-1)"></i>General</span></div>`;
}

// How many VCs sit in each 10-point score band; bands at or above the outreach line are blue.
function scoreChart() {
  const W = 360, H = 200, L = 26, R = 6, T = 20, B = 26, bins = Array(10).fill(0);
  for (const v of DATA.vcs) bins[Math.min(9, Math.floor((v.follow_up_score ?? 0) / 10))]++;
  const max = niceMax(Math.max(...bins)), pw = W - L - R, ph = H - T - B, slot = pw / 10, bw = Math.min(22, slot - 6), y = (n) => T + ph - (n / max) * ph;
  let out = `<g class="grid">${[0, max / 2, max].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
  out += [0, max].map((v) => `<text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  bins.forEach((n, i) => {
    const x = L + i * slot + (slot - bw) / 2, h = (n / max) * ph, hot = i * 10 >= THRESHOLD;
    const tip = tipRef({ title: `Score ${i * 10}–${i === 9 ? 100 : i * 10 + 9}`, rows: [{ label: hot ? 'Worth contacting' : 'Below the line', value: plural(n, 'VC'), color: hot ? '#2a78d6' : '#c3cad5' }] });
    out += `<g class="col" data-tip="${tip}" tabindex="0"><rect class="hl" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph}" rx="4"/>`;
    if (n) out += `<path class="seg" d="${topRounded(x, y(n), bw, h, 4)}" fill="${hot ? '#2a78d6' : '#c3cad5'}"/><text class="lbl" x="${x + bw / 2}" y="${y(n) - 5}" text-anchor="middle">${n}</text>`;
    out += `</g>`;
    if (i % 2 === 0) out += `<text class="axis" x="${L + i * slot}" y="${H - 8}" text-anchor="middle">${i * 10}</text>`;
  });
  out += `<text class="axis" x="${W - R}" y="${H - 8}" text-anchor="end">100</text>`;
  const tx = L + (THRESHOLD / 100) * pw;
  out += `<line class="th" x1="${tx}" x2="${tx}" y1="${T - 8}" y2="${T + ph}"/><text class="th-lbl" x="${tx + 5}" y="${T - 2}">outreach line 30</text>`;
  out += `<line class="base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Number of VCs per follow-up score band">${out}</svg></div>`;
}
function hbars(rows, max, onClick) {
  return `<div class="hbars">${rows.map((r) => `<button type="button" class="hbar" ${onClick ? `data-act="${onClick}" data-key="${r.key}"` : ''}>
    <span class="nm">${r.dot ? `<span class="stage-dot" style="background:${r.dot}"></span>` : ''}${esc(r.label)}</span>
    <span class="track"><span class="fill" style="width:${max ? (r.n / max) * 100 : 0}%;background:${r.color}"></span></span><b>${r.n}</b></button>`).join('')}</div>`;
}

// ---------- layout ----------
const ROUTES = { overview: 'Overview', pipeline: 'Pipeline', investors: 'Investors', signals: 'Signals', archived: 'Archived' };
const route = () => { const [r, arg] = (location.hash.slice(1) || 'overview').split('/'); return { r: ROUTES[r] ? r : 'overview', arg }; };

function renderSide() {
  const run = DATA.last_run, by = {};
  for (const v of DATA.vcs) by[v.status] = (by[v.status] || 0) + 1;
  const { r } = route(), evs = allEvents().length;
  const nav = [['overview', 'Overview', 'overview', ''], ['pipeline', 'Pipeline', 'board', ''], ['investors', 'Investors', 'investors', DATA.vcs.length],
    ['signals', 'Signals', 'signals', evs], ['archived', 'Archived', 'archive', (DATA.archived || []).length]];
  $('#side').innerHTML = `
    <div class="brand"><div class="brand-mark"><svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2.4"/><path d="M16 16 L26 10" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="22" cy="12.2" r="3" fill="#6ea8ff"/></svg></div>
      <div><b>Pipeline Radar</b><span>FreightLoop · Seed round</span></div></div>
    <nav class="nav">${nav.map(([k, l, ic, n]) => `<a href="#${k}" ${r === k ? 'aria-current="page"' : ''}>${icon(ic)}${l}${n !== '' ? `<span class="n">${n}</span>` : ''}</a>`).join('')}</nav>
    <div class="nav nav-stages"><div class="nav-label">Your pipeline</div>
      ${Object.entries(STATUS).map(([k, l]) => `<a href="#investors/${k}"><span class="stage-dot" style="background:${STATUS_DOT[k]}"></span>${l}<span class="n">${by[k] || 0}</span></a>`).join('')}</div>
    <div class="side-run">
      <div class="row"><span>Last run</span><b>${fmtT(run?.finished_at)}</b></div>
      <div class="row"><span>Next run</span><b>${fmtT(nextAutoRun())}</b></div>
      ${run ? `<span class="safe ${intact(run) ? '' : 'warn'}">${icon('shield').replace('<svg', '<svg width="15" height="15" stroke="currentColor"')}${intact(run) ? 'Your notes untouched' : 'Check your columns'}</span>` : ''}
      <div class="progress" id="progress" hidden><i id="pfill"></i></div><small class="muted" id="ptext" hidden></small>
      <button class="btn dark block" type="button" data-act="run" ${RUNNING ? 'disabled' : ''}>${icon('run')}${RUNNING ? 'Running…' : 'Run now'}</button>
    </div>`;
}
function renderTop() {
  const { r } = route(), c = counts();
  const crumb = { overview: `Week of ${new Date(Date.now() + 5.5 * 3600000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${DATA.vcs.length} VCs tracked`,
    pipeline: 'Drag a card to update your status', investors: `${DATA.vcs.length} VCs · ${c.go + c.nudge} worth contacting`,
    signals: 'Everything VCs did in the last 30 days', archived: 'Hidden from runs · notes kept' }[r];
  $('#top').innerHTML = `<div><h1>${ROUTES[r]}</h1><div class="crumb">${crumb}</div></div><div class="grow"></div>
    <label class="search">${icon('search')}<input id="q" type="search" placeholder="Search VCs, firms, notes" value="${esc(QUERY)}" aria-label="Search"></label>
    <button class="btn" type="button" data-act="digest">${icon('mail')}Email brief</button>
    <button class="btn primary" type="button" data-act="add">${icon('plus')}Add VC</button>`;
  $('#q').oninput = (e) => { QUERY = e.target.value; const { r: now } = route(); if (now === 'overview' || now === 'archived') { location.hash = 'investors'; return; } renderPage(true); };
}
function render() {
  TIPS.length = 0;
  renderSide(); renderTop(); renderPage();
}
function renderPage(keepFocus) {
  const { r, arg } = route();
  if (r === 'investors' && arg) { UI.inv = STATUS[arg] ? `s:${arg}` : arg; history.replaceState(null, '', '#investors'); }
  const page = $('#page');
  page.innerHTML = { overview: pageOverview, pipeline: pagePipeline, investors: pageInvestors, signals: pageSignals, archived: pageArchived }[r]();
  page.classList.remove('fade-in'); void page.offsetWidth; if (!keepFocus) page.classList.add('fade-in');
  if (r === 'pipeline') wireBoard();
  if (keepFocus) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

// ---------- pages ----------
function pageOverview() {
  const c = counts(), run = DATA.last_run, runs = (DATA.runs || []).filter((x) => x.status === 'done');
  const prev = runs[1], evs = allEvents(), rel = [0, 0, 0, 0]; for (const e of evs) rel[e.relevance]++;
  const withPrev = DATA.vcs.filter((v) => v.trend.length > 1);
  const avg = Math.round(DATA.vcs.reduce((s, v) => s + (v.follow_up_score ?? 0), 0) / Math.max(1, DATA.vcs.length));
  const avgPrev = withPrev.length ? Math.round(withPrev.reduce((s, v) => s + v.trend[v.trend.length - 2], 0) / withPrev.length) : null;
  const since = { actionable: DATA.vcs.filter((v) => flags(v).includes('now_actionable')).length, up: DATA.vcs.filter((v) => flags(v).includes('heating_up')).length,
    quiet: DATA.vcs.filter((v) => flags(v).includes('went_quiet')).length, fresh: DATA.vcs.filter((v) => (v.change?.newSignals || 0) > 0 && !flags(v).includes('first_check')).length };
  const delta = (now, before, unit = '') => before == null ? '<span class="delta flat">first run</span>'
    : now === before ? '<span class="delta flat">no change vs last run</span>'
    : `<span class="delta ${now > before ? 'up' : 'down'}">${now > before ? '▲' : '▼'} ${Math.abs(now - before)}${unit} vs last run</span>`;
  const fb = DATA.feedback || {};
  const types = {}; for (const e of evs) types[e.type] = (types[e.type] || 0) + 1;
  const typeRows = ['investment', 'blog', 'interview', 'event', 'other'].map((t) => ({ key: t, label: PLURAL[t], n: types[t] || 0, color: 'var(--accent)' }));
  const actRows = [['go', 'Reach out now', '#2a78d6'], ['nudge', 'Nudge now', '#eb6834'], ['hold', 'In progress', '#4a3aa7'], ['quiet', 'Quiet this week', '#c3cad5'], ['passed', 'Passed', '#e3e6ec']]
    .map(([k, l, col]) => ({ key: k, label: l, n: c[k], color: col, dot: col }));

  return `
  <div class="grid-12">
    <section class="card hero span-7">
      <div class="eyebrow">This week's brief · signals from the last 30 days</div>
      <div class="hero-nums">
        <div class="hero-num"><b>${c.go}</b><span><span class="stage-dot" style="background:#2a78d6"></span>Reach out now</span></div>
        <div class="hero-num"><b>${c.nudge}</b><span><span class="stage-dot" style="background:#eb6834"></span>Nudge now</span></div>
        <div class="hero-num"><b style="color:var(--muted)">${c.quiet}</b><span><span class="stage-dot" style="background:#c3cad5"></span>Quiet, skip this week</span></div>
      </div>
      <div class="dist" aria-hidden="true">${['go', 'nudge', 'hold', 'quiet', 'passed'].map((g) => `<span class="c-${g}" style="flex-grow:${c[g]}"></span>`).join('')}</div>
      <p>Every recommendation is backed by something the VC did, wrote, said or invested in during the last 30 days, with the link to check it.</p>
      <div class="since"><span class="badge new">${plural(since.actionable, 'VC')} newly worth contacting</span><span class="badge sig">${plural(since.fresh, 'VC')} with new signals</span>
        <span class="badge up">▲ ${since.up} heating up</span><span class="badge down">${since.quiet} went quiet</span></div>
    </section>
    <div class="tiles span-5">
      <div class="card tile"><div class="lbl">Signals found <span class="mono muted">last run</span></div><div class="val">${run?.signals_found ?? 0}</div>${delta(run?.signals_found ?? 0, prev?.signals_found)}</div>
      <div class="card tile"><div class="lbl">Average follow-up score</div><div class="val">${avg}<small> /100</small></div>${delta(avg, avgPrev)}</div>
      <div class="card tile"><div class="lbl">On-topic events</div><div class="val">${rel[3] + rel[2]}</div><div class="foot">${rel[3]} logistics · ${rel[2]} B2B SaaS of ${evs.length} events</div></div>
      <div class="card tile"><div class="lbl">Signal accuracy</div><div class="val">${fb.precision ?? '—'}${fb.precision != null ? '<small>%</small>' : ''}</div><div class="foot">${fb.rated ? `${plural(fb.rated, 'signal')} rated useful or not` : 'Rate signals with 👍 / 👎 to measure it'}</div></div>
    </div>

    <section class="card span-8"><div class="card-h"><div><h2>Signals over the last 30 days</h2><p>Distinct events per day across all VCs, by relevance to FreightLoop</p></div></div>
      <div class="card-b">${signalsChart()}</div></section>
    <section class="card span-4"><div class="card-h"><div><h2>Recommendations</h2><p>All ${DATA.vcs.length} VCs by this week's action · click to filter</p></div></div>
      <div class="card-b" style="display:grid;gap:18px">${hbars(actRows, Math.max(...actRows.map((x) => x.n)), 'goto-group')}
        <div class="proof"><div><strong>Worth contacting</strong><span style="font-size:20px;font-weight:600;color:var(--ink)">${c.go + c.nudge}</span> of ${DATA.vcs.length}</div>
          <div><strong>Talking to</strong><span style="font-size:20px;font-weight:600;color:var(--ink)">${DATA.vcs.filter((v) => v.status === 'in_conversation').length}</span> in conversation</div></div>
        <a class="btn sm" href="#pipeline" style="justify-self:start">${icon('board')}Open the pipeline board</a></div></section>

    <section class="card span-8" style="align-self:start">${priorityTable()}</section>
    <aside class="span-4" style="display:grid;gap:16px;align-content:start">${aiBrief()}${runHealth()}</aside>

    <section class="card span-4"><div class="card-h"><div><h2>Score distribution</h2><p>VCs per score band; blue bands clear the outreach line</p></div></div><div class="card-b">${scoreChart()}</div></section>
    <section class="card span-4"><div class="card-h"><div><h2>Signal types</h2><p>Distinct events in the last 30 days</p></div></div><div class="card-b">${hbars(typeRows, Math.max(...typeRows.map((x) => x.n)))}</div></section>
    <section class="card span-4"><div class="card-h"><div><h2>How the score works</h2><p>Transparent and reproducible</p></div></div><div class="card-b rules">
      <p>Each event earns up to 40 points: <b>type</b> (deal 1.0, post 0.8, event 0.7, interview 0.6) × <b>relevance</b> (logistics 1.0, B2B SaaS 0.6, general 0.15) × <b>recency</b> (full for 7 days, fading to zero at 30).</p>
      <p>One count per event, however many outlets cover it. Off-topic activity adds at most 15, so it never crosses the outreach line of ${THRESHOLD} alone.</p>
      <p>A pending reply is never chased within 10 days of your last contact.</p></div></section>
  </div>`;
}
function priorityTable() {
  const pri = DATA.vcs.filter((v) => ['go', 'nudge', 'hold'].includes(group(v)));
  const f = { all: (v) => ['go', 'nudge'].includes(group(v)), go: (v) => group(v) === 'go', nudge: (v) => group(v) === 'nudge',
    new: (v) => flags(v).includes('now_actionable') || flags(v).includes('heating_up'), hold: (v) => group(v) === 'hold' };
  const chips = [['all', 'This week'], ['go', 'Reach out'], ['nudge', 'Nudge'], ['new', 'New & heating up'], ['hold', 'In progress']];
  const rows = pri.filter(f[UI.pri] || f.all).sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0));
  return `<div class="card-h"><div><h2>Priority investors</h2><p>Who to act on, why now, and the draft ready to send</p></div></div>
    <div style="padding:12px 18px 4px" class="chips">${chips.map(([k, l]) => `<button type="button" class="chip" data-act="pri" data-key="${k}" aria-pressed="${UI.pri === k}">${l}<span class="n">${pri.filter(f[k]).length}</span></button>`).join('')}</div>
    <div class="table-wrap"><table class="pri"><thead><tr><th>Investor</th><th>Recommendation</th><th>Score</th><th>Why now</th><th></th></tr></thead><tbody>
    ${rows.map((v) => { const e = topEvent(v); return `<tr data-open="${v.id}" tabindex="0">
      <td><div class="who">${logo(v)}<div><b>${esc(short(v.firm))}</b><span>${esc(v.name)} · ${STATUS[v.status].toLowerCase()}</span></div></div></td>
      <td>${pill(v)}</td><td>${scoreCell(v)}</td>
      <td class="sum">${e ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">${relTag(e.relevance)}<span class="mono muted" style="font-size:11.5px">${fmtD(e.published)}</span></div><span class="clamp">${esc(clean(e.summary))}</span>` : '<span class="muted">No recent signal</span>'}</td>
      <td>${v.check?.draft_body ? `<button class="btn sm" type="button" data-act="open" data-id="${v.id}" data-tab="draft">${icon('mail')}Draft</button>` : ''}</td></tr>`; }).join('')
    || `<tr><td colspan="5" class="empty">Nothing in this view right now.</td></tr>`}
    </tbody></table></div>`;
}
function aiBrief() {
  const recs = DATA.vcs.filter((v) => ['go', 'nudge'].includes(group(v))).sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0)).slice(0, 3);
  return `<section class="card"><div class="card-h"><div class="ai-head"><span class="ai-orb">${icon('spark')}</span><div><h2>AI brief</h2><p>Gemini-drafted, evidence-backed next steps</p></div></div></div>
    <div class="card-b brief-list">${recs.map((v) => { const e = topEvent(v); const g = group(v); return `<div class="rec">
      <div class="who">${logo(v, 'sm')}<div><b>${g === 'go' ? 'Reach out to' : 'Nudge'} ${esc(first(v.name))} · ${esc(short(v.firm))}</b><span>Score ${v.follow_up_score} · ${g === 'nudge' ? `last contact ${ago(v.last_contact)}` : 'not contacted yet'}</span></div></div>
      ${e ? `<div class="why">${esc(clean(e.summary))} <span class="mono muted" style="font-size:11.5px">${fmtD(e.published)}</span></div>` : ''}
      <div class="acts">${v.check?.draft_body ? `<button class="btn sm primary" type="button" data-act="open" data-id="${v.id}" data-tab="draft">${icon('mail')}Open draft</button>` : ''}
        <button class="btn sm" type="button" data-act="sent" data-id="${v.id}">✓ Mark sent</button></div></div>`; }).join('') || '<p class="muted" style="margin:0">No VC has a strong enough signal right now.</p>'}</div></section>`;
}
function runHealth() {
  const run = DATA.last_run;
  const hist = (DATA.runs || []).slice(0, 4).map((r) => `<div><span>${fmtT(r.started_at)}</span><span class="mono">${r.vcs_checked}</span><span class="${r.status === 'failed' ? 'bad' : intact(r) ? 'ok' : ''}">${r.status === 'failed' ? 'failed' : r.status === 'running' ? 'running' : intact(r) ? '✓ notes safe' : r.status}</span></div>`).join('');
  return `<section class="card"><div class="card-h"><div><h2>Run health</h2><p>${run?.trigger === 'cron' ? 'Scheduled' : 'Manual'} run · ${fmtT(run?.finished_at)}</p></div>
      <span class="safe ${intact(run) ? '' : 'warn'}">${intact(run) ? '✓ Notes untouched' : '⚠ Check'}</span></div>
    <div class="card-b" style="display:grid;gap:12px">
      <div class="proof"><div><strong>Run writes</strong>Last signal date, summary, score, recommended action</div><div><strong>Never writes</strong>Status, last contact, history, notes, email</div></div>
      <div class="runs">${hist}</div>
      <div class="acts"><button class="btn sm" type="button" data-act="digest">${icon('mail')}Email me this brief</button><a class="btn sm ghost" href="${withKey('/api/actions?preview=digest')}" target="_blank" rel="noopener">${icon('eye')}Preview</a></div>
    </div></section>`;
}

function pagePipeline() {
  const cols = Object.keys(STATUS);
  const sub = { yet_to_reach_out: 'Not contacted yet', waiting_response: 'Emailed, no reply yet', in_conversation: 'Talking: never auto-archived', passed: 'Said no for now' };
  return `<div class="board">${cols.map((s) => {
    const vs = DATA.vcs.filter((v) => v.status === s && matches(v)).sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0));
    const avg = vs.length ? Math.round(vs.reduce((t, v) => t + (v.follow_up_score ?? 0), 0) / vs.length) : 0;
    return `<section class="col" data-status="${s}" aria-label="${STATUS[s]}">
      <div class="col-h"><span class="stage-dot" style="background:${STATUS_DOT[s]}"></span>${STATUS[s]}<span class="n">${vs.length}</span><span class="avg">avg ${avg}</span></div>
      <div class="col-sub">${sub[s]}</div>
      ${vs.map(kcard).join('') || '<div class="muted" style="font-size:12.5px;padding:8px 4px">Drop a VC here</div>'}</section>`; }).join('')}</div>`;
}
function kcard(v) {
  const e = topEvent(v), s = v.follow_up_score ?? 0;
  return `<article class="kcard" draggable="true" data-id="${v.id}" data-open="${v.id}" tabindex="0" aria-label="${esc(v.name)}, ${esc(short(v.firm))}">
    <div class="top-row"><div class="who">${logo(v)}<div><b>${esc(short(v.firm))}</b><span>${esc(v.name)}</span></div></div><span class="kscore ${s >= THRESHOLD ? 'hi' : s > 0 ? 'mid' : 'lo'}">${s}</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${pill(v)}${badges(v)}</div>
    ${e ? `<div class="sig clamp">${esc(clean(e.summary))}</div>` : `<div class="sig muted">No public signal in 30 days</div>`}
    <div class="meta"><span>${v.last_contact ? `Contacted ${ago(v.last_contact)}` : 'Never contacted'}</span>${spark(v.trend, 64, 20)}</div></article>`;
}

function pageInvestors() {
  const c = counts();
  const chips = [['all', 'All', DATA.vcs.length], ['go', 'Reach out', c.go], ['nudge', 'Nudge', c.nudge], ['hold', 'In progress', c.hold], ['quiet', 'Quiet', c.quiet], ['passed', 'Passed', c.passed],
    ...Object.entries(STATUS).map(([k, l]) => [`s:${k}`, l, DATA.vcs.filter((v) => v.status === k).length])];
  const sortVal = { investor: (v) => short(v.firm).toLowerCase(), status: (v) => v.status, contact: (v) => v.last_contact || '', score: (v) => v.follow_up_score ?? 0, signal: (v) => v.last_signal_date || '' };
  const filt = (v) => UI.inv === 'all' || (UI.inv.startsWith('s:') ? v.status === UI.inv.slice(2) : group(v) === UI.inv);
  const { key, dir } = UI.sort;
  const rows = DATA.vcs.filter(filt).filter(matches).sort((a, b) => { const x = sortVal[key](a), y = sortVal[key](b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'asc' ? 1 : -1); });
  const th = (k, l) => `<th><button type="button" data-act="sort" data-key="${k}" ${key === k ? `data-dir="${dir}"` : ''}>${l}</button></th>`;
  return `<section class="card">
    <div class="toolbar"><div class="chips">${chips.map(([k, l, n]) => `<button type="button" class="chip" data-act="inv" data-key="${k}" aria-pressed="${UI.inv === k}">${l}<span class="n">${n}</span></button>`).join('')}</div>
      <div class="acts"><label class="btn sm" for="csv">${icon('upload')}Import CSV</label><input id="csv" type="file" accept=".csv,text/csv" hidden>
        <button class="btn sm" type="button" data-act="export">${icon('download')}Export CSV</button></div></div>
    <div class="table-wrap"><table><thead><tr>${th('investor', 'Investor')}${th('status', 'Your status')}${th('contact', 'Last contact')}${th('score', 'Score')}<th>Trend</th><th>Recommendation</th>${th('signal', 'Last signal')}<th>Why</th></tr></thead><tbody>
    ${rows.map((v) => `<tr data-open="${v.id}" tabindex="0">
      <td><div class="who">${logo(v)}<div><b>${esc(short(v.firm))}</b><span>${esc(v.name)}</span></div></div></td>
      <td><span style="display:inline-flex;align-items:center;gap:7px"><span class="stage-dot" style="background:${STATUS_DOT[v.status]}"></span>${STATUS[v.status]}</span></td>
      <td class="mono">${fmtD(v.last_contact)}</td><td>${scoreCell(v)}</td><td>${spark(v.trend, 72, 22)}</td><td>${pill(v)}</td>
      <td class="mono">${fmtD(v.last_signal_date)}</td><td class="sum"><span class="clamp">${esc(clean(v.signal_summary || 'Not checked yet.'))}</span></td></tr>`).join('')
    || `<tr><td colspan="8" class="empty">No VCs match. Clear the search or pick another filter.</td></tr>`}
    </tbody></table></div></section>`;
}

function pageSignals() {
  const evs = allEvents().filter((e) => matches(e.vc));
  const tf = (e) => UI.sigType === 'all' || e.type === UI.sigType, rf = (e) => UI.sigRel === 'all' || String(e.relevance) === UI.sigRel || (UI.sigRel === '1' && e.relevance <= 1);
  const list = evs.filter(tf).filter(rf).sort((a, b) => b.published.localeCompare(a.published) || b.points - a.points);
  const days = new Map(); for (const e of list) { if (!days.has(e.published)) days.set(e.published, []); days.get(e.published).push(e); }
  const typeChips = [['all', 'All types'], ...['investment', 'blog', 'interview', 'event', 'other'].map((t) => [t, PLURAL[t]])];
  const relChips = [['all', 'Any relevance'], ['3', 'Logistics'], ['2', 'B2B SaaS'], ['1', 'General']];
  return `<section class="card">
    <div class="toolbar"><div class="chips">${typeChips.map(([k, l]) => `<button type="button" class="chip" data-act="sigtype" data-key="${k}" aria-pressed="${UI.sigType === k}">${l}<span class="n">${k === 'all' ? evs.length : evs.filter((e) => e.type === k).length}</span></button>`).join('')}</div>
      <div class="chips">${relChips.map(([k, l]) => `<button type="button" class="chip" data-act="sigrel" data-key="${k}" aria-pressed="${UI.sigRel === k}">${l}</button>`).join('')}</div></div>
    ${[...days.entries()].map(([d, es]) => `<div class="feed-day">${new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} · ${plural(es.length, 'event')}</div>
      ${es.map((e) => `<div class="sig-row ${e.verdict === 'not_relevant' ? 'rejected' : ''}">${logo(e.vc)}
        <div class="s"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(clean(e.summary || e.title))}</a>
          <small><button type="button" class="btn sm ghost" style="padding:0 4px" data-act="open" data-id="${e.vc.id}">${esc(short(e.vc.firm))}</button><span class="tag">${TYPE[e.type] || 'News'}</span>${relTag(e.relevance)}
          <span>${e.about === 'partner' ? 'About ' + esc(first(e.vc.name)) : 'Firm activity'}${e.outlets > 1 ? ` · ${e.outlets} outlets` : ''}</span></small></div>
        ${fbButtons(e, e.vc)}</div>`).join('')}`).join('') || '<div class="empty">No signals match these filters.</div>'}
  </section>`;
}

function pageArchived() {
  const a = DATA.archived || [];
  return `<section class="card"><div class="card-h"><div><h2>${plural(a.length, 'archived VC')}</h2><p>VCs with no public signal for ${DATA.archive_after_days || 60} days are archived after a run (never ones you are in conversation with). Archive any VC from its panel. Notes are kept.</p></div></div>
    <div class="card-b" style="padding:8px 0 4px">${a.map((v) => `<div class="arch-row"><div class="who">${logo(v)}<div><b>${esc(short(v.firm))}</b><span>${esc(v.name)}</span></div></div>
      <div class="arch-why"><span class="pill ${v.archive.archived_by === 'rule' ? 'quiet' : 'plain'}">${v.archive.archived_by === 'rule' ? 'Auto-archived' : 'Archived by you'}</span>${esc(v.archive.reason || '')} · ${fmtD(v.archive.archived_at)}</div>
      <button class="btn sm" type="button" data-act="restore" data-id="${v.id}">↺ Restore</button></div>`).join('') || '<div class="empty">Nothing archived yet.</div>'}</div></section>`;
}

// ---------- board drag & drop ----------
function wireBoard() {
  $$('.kcard').forEach((c) => {
    c.ondragstart = (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); };
    c.ondragend = () => c.classList.remove('dragging');
  });
  $$('.col').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
    col.ondrop = (e) => { e.preventDefault(); col.classList.remove('over'); moveTo(+e.dataTransfer.getData('text/plain'), col.dataset.status); };
  });
}
async function moveTo(id, status) {
  const v = DATA.vcs.find((x) => x.id === id);
  if (!v || v.status === status) return;
  const before = { status: v.status, last_contact: v.last_contact || '' };
  const patch = { id, status, ...(status === 'waiting_response' ? { last_contact: istToday() } : {}) };
  Object.assign(v, patch); renderPage(); // optimistic
  try {
    await api('/api/vcs', { method: 'PATCH', body: JSON.stringify(patch) });
    await load();
    toast(`${short(v.firm)} → ${STATUS[status]}${status === 'waiting_response' ? ', last contact set to today' : ''}.`, { label: 'Undo', fn: async () => {
      await api('/api/vcs', { method: 'PATCH', body: JSON.stringify({ id, ...before }) }); await load(); toast('Moved back.'); } });
  } catch (err) { toast(err.message); await load(); }
}

// ---------- click handling (one delegated listener) ----------
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-act]');
  if (a) {
    e.stopPropagation();
    const k = a.dataset.key, id = +a.dataset.id;
    switch (a.dataset.act) {
      case 'run': return runNow();
      case 'add': return openAddForm();
      case 'digest': return sendDigestNow(a);
      case 'export': return exportCsv();
      case 'open': return openDrawer(id, a.dataset.tab);
      case 'sent': return markSent(id, null, a);
      case 'restore': return restore(id, a);
      case 'fb': return feedback(a);
      case 'pri': UI.pri = k; return renderPage();
      case 'inv': UI.inv = k; return renderPage();
      case 'sigtype': UI.sigType = k; return renderPage();
      case 'sigrel': UI.sigRel = k; return renderPage();
      case 'goto-group': UI.inv = k; location.hash = 'investors'; return;
      case 'sort': UI.sort = { key: k, dir: UI.sort.key === k && UI.sort.dir === 'desc' ? 'asc' : 'desc' }; return renderPage();
    }
    return;
  }
  const row = e.target.closest('[data-open]');
  if (row && !e.target.closest('a')) openDrawer(+row.dataset.open);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('[data-open]')) openDrawer(+e.target.dataset.open);
  if (e.key === '/' && !e.target.matches('input, textarea')) { e.preventDefault(); $('#q')?.focus(); }
});
document.addEventListener('change', (e) => { if (e.target.id === 'csv') importCsv(e.target.files[0]).finally(() => { e.target.value = ''; }); });
addEventListener('hashchange', () => { if (DATA) { TIPS.length = 0; renderSide(); renderTop(); renderPage(); scrollTo(0, 0); } });
addEventListener('scroll', () => $('#top')?.classList.toggle('scrolled', scrollY > 4), { passive: true });

async function feedback(b) {
  const vc = DATA.vcs.find((v) => v.id === +b.dataset.vc);
  const verdict = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.fb;
  try {
    await act({ action: 'feedback', vc_id: vc.id, url: b.dataset.url, title: b.dataset.title, verdict });
    vc.evidence.filter((s) => s.url === b.dataset.url || s.title === b.dataset.title).forEach((s) => { s.verdict = verdict; });
    const rated = [...new Set(DATA.vcs.flatMap((v) => v.evidence.filter((s) => s.verdict).map((s) => `${v.id}|${s.url}|${s.verdict}`)))];
    DATA.feedback = { rated: rated.length, useful: rated.filter((x) => x.endsWith('|useful')).length };
    DATA.feedback.precision = DATA.feedback.rated ? Math.round(DATA.feedback.useful / DATA.feedback.rated * 100) : null;
    toast(verdict === 'not_relevant' ? 'Marked not relevant. The next run will ignore it.' : verdict === 'useful' ? 'Marked useful.' : 'Rating cleared.');
    const open = $('#drawer').open ? +$('#drawer').dataset.vc : null;
    renderPage(); if (open) openDrawer(open);
  } catch (err) { toast(err.message); }
}
async function markSent(id, subject, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const r = await act({ action: 'mark_sent', id, subject });
    if ($('#drawer').open) $('#drawer').close();
    await load();
    toast(`Logged. ${r.vc.name} is on hold until a reply or 10 days pass.`);
  } catch (err) { toast(err.message); if (btn) { btn.disabled = false; btn.textContent = '✓ Mark sent'; } }
}
async function restore(id, b) {
  b.disabled = true; b.textContent = 'Restoring…';
  try { const v = DATA.archived.find((x) => x.id === id); await act({ action: 'restore', id }); await load(); toast(`${v.name} is back. The next run will check them again.`); }
  catch (err) { toast(err.message); b.disabled = false; b.textContent = '↺ Restore'; }
}
async function sendDigestNow(b) {
  const label = b.innerHTML; b.disabled = true; b.textContent = 'Sending…';
  try { const r = await act({ action: 'send_digest' }); toast(`Brief emailed to ${r.to}.`); }
  catch (err) { toast(err.message.includes('not set up') ? 'Email is not set up yet: deploy the Apps Script mailer (see README).' : err.message); }
  finally { b.disabled = false; b.innerHTML = label; }
}

// ---------- CSV ----------
const CSV_COLUMNS = ['name', 'firm', 'thesis', 'email', 'website', 'blog_rss', 'status', 'last_contact', 'contact_history', 'notes', 'last_signal_date', 'signal_summary', 'follow_up_score', 'recommended_action'];
function exportCsv() {
  const cell = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [CSV_COLUMNS.join(','), ...DATA.vcs.map((v) => CSV_COLUMNS.map((c) => cell(v[c])).join(','))].join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `vc-pipeline-${istToday()}.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${plural(DATA.vcs.length, 'VC')}.`);
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const HEADER_ALIASES = { name: ['name', 'partner', 'vc', 'investor', 'contact'], firm: ['firm', 'fund', 'company', 'vc_firm'], thesis: ['thesis', 'focus'],
  email: ['email', 'e_mail', 'email_address'], website: ['website', 'site', 'url'], blog_rss: ['blog_rss', 'blog', 'rss', 'feed'], status: ['status', 'stage'],
  last_contact: ['last_contact', 'last_contacted', 'last_contact_date'], contact_history: ['contact_history', 'history'], notes: ['notes', 'note', 'comments'] };
function toStatus(s) {
  s = String(s || '').toLowerCase();
  if (s.includes('wait') || s.includes('pending') || s.includes('sent')) return 'waiting_response';
  if (s.includes('conversation') || s.includes('talk') || s.includes('meeting')) return 'in_conversation';
  if (/\b(passed|pass|declined|rejected)\b/.test(s)) return 'passed';
  return 'yet_to_reach_out';
}
function toDate(s) {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(s); return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}
async function importCsv(file) {
  if (!file) return;
  const [head, ...body] = parseCsv(await file.text());
  if (!head) return toast('That file is empty.');
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const col = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([f, names]) => [f, keys.findIndex((k) => names.includes(k))]));
  if (col.name < 0 || col.firm < 0) return toast('The CSV needs a name (or partner) column and a firm (or fund) column.');
  const rows = body.map((r) => { const o = {}; for (const [f, i] of Object.entries(col)) if (i >= 0) o[f] = (r[i] || '').trim(); o.status = toStatus(o.status); o.last_contact = toDate(o.last_contact); return o; }).filter((o) => o.name && o.firm);
  const existing = new Set([...DATA.vcs, ...(DATA.archived || [])].map((v) => `${v.name}|${v.firm}`.toLowerCase()));
  const fresh = rows.filter((o) => !existing.has(`${o.name}|${o.firm}`.toLowerCase()));
  $('#drawer').dataset.vc = '';
  $('#drawer-body').innerHTML = `
    <div class="d-head"><span></span><div><div class="muted mono" style="font-size:11.5px;text-transform:uppercase;letter-spacing:.06em">Import from CSV</div><h2>${esc(file.name)}</h2></div><button class="close" type="button" data-close aria-label="Close">×</button></div>
    <p style="margin:0;color:var(--ink-2)">${plural(rows.length, 'row')} with a name and firm. <b>${plural(fresh.length, 'new VC')}</b> will be added; ${rows.length - fresh.length} already in the pipeline will be skipped. Existing notes are not changed.</p>
    ${fresh.length ? `<div class="card table-wrap"><table><thead><tr><th>VC</th><th>Status</th><th>Last contact</th></tr></thead><tbody>${fresh.slice(0, 8).map((o) => `<tr><td><div class="who"><div><b>${esc(o.firm)}</b><span>${esc(o.name)}</span></div></div></td><td>${STATUS[o.status]}</td><td class="mono">${fmtD(o.last_contact)}</td></tr>`).join('')}</tbody></table></div>${fresh.length > 8 ? `<p class="muted" style="margin:0">…and ${fresh.length - 8} more.</p>` : ''}` : ''}
    <div class="acts"><button class="btn primary" id="do-import" type="button" ${fresh.length ? '' : 'disabled'}>Import ${plural(fresh.length, 'VC')}</button><span class="muted" style="font-size:13px">New VCs get signals on the next run, or press Run now.</span></div>`;
  showDrawer();
  $('#do-import').onclick = async () => {
    const b = $('#do-import'); b.disabled = true; b.textContent = 'Importing…';
    try { const r = await act({ action: 'import', rows: fresh }); $('#drawer').close(); await load(); toast(`Imported ${plural(r.imported, 'VC')}${r.skipped ? `, skipped ${r.skipped}` : ''}. Press Run now to check them.`); }
    catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Import'; }
  };
}

// ---------- drawer ----------
function showDrawer() {
  const dlg = $('#drawer');
  if (!dlg.open) dlg.showModal();
  dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); };
  $('#drawer-body').scrollTop = 0;
}
function openAddForm() {
  $('#drawer').dataset.vc = '';
  $('#drawer-body').innerHTML = `
    <div class="d-head"><span></span><div><div class="muted mono" style="font-size:11.5px;text-transform:uppercase;letter-spacing:.06em">New VC</div><h2>Add to the pipeline</h2></div><button class="close" type="button" data-close aria-label="Close">×</button></div>
    <p style="margin:0;color:var(--ink-2)">The VC is checked as soon as you save: news, their blog and the web for the last 30 days.</p>
    <form id="add-form" class="d-sec">
      <div class="grid2"><label class="field">Partner name *<input id="a-name" required placeholder="e.g. Karthik Reddy"></label><label class="field">Firm *<input id="a-firm" required placeholder="e.g. Blume Ventures"></label></div>
      <label class="field">Thesis<input id="a-thesis" placeholder="What they invest in"></label>
      <div class="grid2"><label class="field">Email<input id="a-email" type="email"></label><label class="field">Website<input id="a-website" type="url" placeholder="https://"></label></div>
      <label class="field">Blog / Medium / Substack RSS feed<input id="a-rss" type="url" placeholder="https://medium.com/feed/…"></label>
      <div class="grid2"><label class="field">Status<select id="a-status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="field">Last contact<input id="a-last" type="date"></label></div>
      <label class="field">Notes<textarea id="a-notes"></textarea></label>
      <div class="acts"><button class="btn primary" type="submit" id="a-save">Add and check now</button><span id="a-msg" class="muted" style="font-size:13px"></span></div>
    </form>`;
  showDrawer(); $('#a-name').focus();
  $('#add-form').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('#a-save'); b.disabled = true; b.textContent = 'Adding…'; $('#a-msg').textContent = 'Checking news, blog and the web. About 20 seconds.';
    try {
      const vc = await api('/api/vcs', { method: 'POST', body: JSON.stringify({ name: $('#a-name').value, firm: $('#a-firm').value, thesis: $('#a-thesis').value, email: $('#a-email').value,
        website: $('#a-website').value, blog_rss: $('#a-rss').value, status: $('#a-status').value, last_contact: $('#a-last').value, notes: $('#a-notes').value }) });
      await load(); toast(`${vc.name} added. Score ${vc.follow_up_score ?? 0}: ${vc.recommended_action || 'checked'}.`); openDrawer(vc.id);
    } catch (err) { $('#a-msg').textContent = err.message; b.disabled = false; b.textContent = 'Add and check now'; }
  };
}
function openDrawer(id, tab) {
  const v = DATA.vcs.find((x) => x.id === id); if (!v) return;
  const evs = events(v), d = v.check || {};
  $('#drawer').dataset.vc = id;
  $('#drawer-body').innerHTML = `
    <div class="d-head">${logo(v, 'lg')}<div><h2>${esc(v.name)}</h2><div class="firm">${esc(v.firm)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${pill(v)}<span class="pill plain">${STATUS[v.status]}</span>${badges(v)}</div></div>
      <button class="close" type="button" data-close aria-label="Close">×</button></div>
    <div class="kv3"><div><span>Follow-up score</span><b>${v.follow_up_score ?? 0}<span style="display:inline;font-size:13px;color:var(--muted)"> /100</span></b></div>
      <div><span>Last signal</span><b>${fmtD(v.last_signal_date)}</b></div><div><span>Last contact</span><b>${v.last_contact ? ago(v.last_contact) : 'never'}</b></div></div>
    ${v.thesis ? `<p style="margin:0;color:var(--ink-2);font-size:13.5px">${esc(v.thesis)}</p>` : ''}

    ${d.draft_body ? `<section class="d-sec" id="d-draft"><h3>${icon('mail').replace('<svg', '<svg width="14" height="14" stroke="currentColor"')}Email draft · ${d.action_code === 'NUDGE_NOW' ? 'follow-up nudge' : 'first outreach'}</h3>
      <div class="mail"><div class="row"><label for="m-to">To</label><input id="m-to" value="${esc(v.email || '')}" placeholder="No public email on file. Add one."></div>
      <div class="row"><label for="m-su">Subject</label><input id="m-su" value="${esc(d.draft_subject || '')}"></div><textarea id="m-body" aria-label="Email body">${esc(d.draft_body)}</textarea></div>
      <div class="acts"><a class="btn primary" id="m-gmail" target="_blank" rel="noopener">Open in Gmail</a><button class="btn" type="button" id="m-copy">Copy</button><a class="btn" id="m-mailto">Mail app</a><button class="btn" type="button" id="m-sent">✓ Mark as sent</button></div>
      <p class="muted" style="margin:0;font-size:12.5px">After sending, mark it sent: status becomes "Waiting for reply", last contact becomes today, and a line is added to your contact history.</p></section>` : ''}

    <section class="d-sec"><h3>Why now · ${plural(evs.length, 'event')} in 30 days</h3>
      ${evs.length ? `<div>${evs.map((e) => evRow(e, v)).join('')}</div>` : `<p style="margin:0;color:var(--ink-2)">${esc(clean(v.signal_summary || 'Not checked yet.'))}</p>`}
      ${strip(v)}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--ink-2)"><span>Score over recent runs</span>${spark(v.trend, 160, 36)}</div>
      <p class="muted" style="margin:0;font-size:12.5px">Checked: ${esc((d.sources_checked || []).join(', ') || '—')} · ${d.items_found ?? 0} items found · ${fmtT(d.checked_at)}</p></section>

    <section class="d-sec"><h3>Your columns · you edit these</h3>
      <form id="d-form" class="d-sec">
        <div class="grid2"><label class="field">Status<select id="f-status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Last contact<input id="f-last" type="date" value="${esc(v.last_contact || '')}"></label></div>
        <label class="field">Email<input id="f-email" type="email" value="${esc(v.email || '')}"></label>
        <label class="field">Contact history<textarea id="f-hist">${esc(v.contact_history || '')}</textarea></label>
        <label class="field">Notes<textarea id="f-notes">${esc(v.notes || '')}</textarea></label>
        <div class="acts"><button class="btn primary" type="submit" id="f-save">Save changes</button><span class="muted" style="font-size:13px">Runs read these but never change them.</span></div>
      </form></section>

    <section class="d-sec"><h3>🔒 Signal columns · written only by the run</h3>
      <div class="locked"><div><span>Last signal date</span><b class="mono">${fmtD(v.last_signal_date)}</b></div><div><span>Follow-up score</span><b class="mono">${v.follow_up_score ?? '—'}</b></div>
      <div><span>Recommended action</span><b>${esc(v.recommended_action || '—')}</b></div><div><span>Signal summary</span><span style="color:var(--ink)">${esc(clean(v.signal_summary || '—'))}</span></div></div></section>

    <section class="d-sec"><h3>Remove from pipeline</h3>
      <p class="muted" style="margin:0;font-size:13px">Archiving hides ${esc(first(v.name))} from the dashboard and future runs. Notes and history are kept; restore any time.</p>
      <div class="acts"><button class="btn danger" type="button" id="d-archive">Archive this VC</button><span id="d-archive-msg" class="muted" style="font-size:13px"></span></div></section>`;
  showDrawer();
  if (d.draft_body) wireDraft(v);
  if (tab === 'draft' && d.draft_body) $('#m-body').focus();
  $('#d-archive').onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = `Yes, archive ${first(v.name)}`; $('#d-archive-msg').textContent = 'Click again to confirm.'; return; }
    b.disabled = true; b.textContent = 'Archiving…';
    try { await act({ action: 'archive', id: v.id }); $('#drawer').close(); await load(); toast(`${v.name} archived.`, { label: 'Undo', fn: async () => { await act({ action: 'restore', id: v.id }); await load(); toast('Restored.'); } }); }
    catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Archive this VC'; }
  };
  $('#d-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#f-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api('/api/vcs', { method: 'PATCH', body: JSON.stringify({ id: v.id, status: $('#f-status').value, last_contact: $('#f-last').value, email: $('#f-email').value, contact_history: $('#f-hist').value, notes: $('#f-notes').value }) });
      await load(); $('#drawer').close(); toast('Saved. The recommendation was updated for your new status.');
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Save changes'; }
  };
}
function wireDraft(v) {
  const sync = () => {
    const to = $('#m-to').value.trim(), su = $('#m-su').value, body = $('#m-body').value;
    $('#m-gmail').href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;
    $('#m-mailto').href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;
  };
  ['#m-to', '#m-su', '#m-body'].forEach((s) => { $(s).oninput = sync; }); sync();
  $('#m-copy').onclick = async () => {
    const text = `To: ${$('#m-to').value}\nSubject: ${$('#m-su').value}\n\n${$('#m-body').value}`;
    try { await navigator.clipboard.writeText(text); toast('Email copied'); } catch { $('#m-body').select(); toast('Press Ctrl+C to copy the selected text'); }
  };
  $('#m-sent').onclick = (e) => markSent(v.id, $('#m-su').value, e.currentTarget);
}

// ---------- run ----------
async function runNow() {
  if (RUNNING) return;
  RUNNING = true; renderSide();
  const show = (pct, text) => { $('#progress').hidden = false; $('#ptext').hidden = false; $('#pfill').style.width = `${pct}%`; $('#ptext').textContent = text; };
  show(2, 'Starting run…');
  const total = DATA.vcs.length;
  const poll = setInterval(async () => {
    try { const s = await api('/api/status'); if (['running', 'partial'].includes(s.run?.status)) show(Math.round(s.checked / total * 100), `${s.checked} of ${total} VCs checked`); } catch {}
  }, 3000);
  let runId = null;
  try {
    for (let step = 0; step < 6; step++) {
      const r = await api('/api/run', { method: 'POST', body: JSON.stringify({ run_id: runId }) });
      runId = r.run_id;
      if (r.joined) { // someone else's run is going: follow it rather than run twice
        for (let i = 0; i < 100; i++) { await new Promise((ok) => setTimeout(ok, 3000)); const s = await api('/api/status'); if (s.run?.id !== runId || s.run.status !== 'running') break; }
        break;
      }
      if (!r.remaining) break;
    }
    clearInterval(poll); RUNNING = false; await load(); toast('Run complete. The pipeline is up to date.');
  } catch (err) { clearInterval(poll); RUNNING = false; renderSide(); toast(`The run stopped: ${err.message}. Press Run now to continue.`); }
}

load().catch((e) => { $('#page').innerHTML = `<div class="card empty">Could not load the pipeline: ${esc(e.message)} Refresh to try again.</div>`; });
