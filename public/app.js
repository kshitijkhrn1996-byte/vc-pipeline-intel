// Pipeline Radar dashboard. Plain JS: renders /api/vcs and calls /api/actions, /api/run, /api/status.

// ---------- setup ----------
const params = new URLSearchParams(location.search);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
// Only needed if the server sets DASHBOARD_KEY; otherwise the dashboard is open.
let KEY = params.get('key') || store.get('vc_key');
if (params.get('key')) store.set('vc_key', KEY);
const withKey = (path) => KEY ? `${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(KEY)}` : path;
if (store.get('vc_theme')) document.documentElement.dataset.theme = store.get('vc_theme');

let DATA = null, FILTER = 'all', QUERY = '', RUNNING = false;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const fmtD = (d) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const fmtT = (d) => d ? new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const daysAgo = (d) => d ? Math.round((Date.parse(istToday()) - Date.parse(d)) / DAY) : null;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const STATUS = { yet_to_reach_out: 'Yet to reach out', waiting_response: 'Waiting for reply', in_conversation: 'In conversation', passed: 'Passed' };
const GROUP = { REACH_OUT_NOW: 'go', NUDGE_NOW: 'nudge', HOLD_AWAITING_REPLY: 'hold', CONTINUE: 'hold', DEPRIORITISE: 'quiet', SKIP_PASSED: 'passed' };
const SHORT = { REACH_OUT_NOW: 'Reach out now', NUDGE_NOW: 'Nudge now', HOLD_AWAITING_REPLY: 'Hold · awaiting reply', CONTINUE: 'In conversation', DEPRIORITISE: 'Quiet · skip this week', SKIP_PASSED: 'Passed' };
const TYPE = { investment: 'Deal', blog: 'Post', interview: 'Interview', event: 'Event', other: 'News' };
const PLURAL = { investment: 'Deals', blog: 'Posts', interview: 'Interviews', event: 'Events', other: 'Other news' };
const REL = ['Off-topic', 'General', 'B2B SaaS', 'Logistics'];
const THRESHOLD = 30;
const code = (v) => v.check?.action_code || 'DEPRIORITISE';
const group = (v) => GROUP[code(v)] || 'quiet';
const flags = (v) => v.change?.flags || [];

// ---------- api ----------
async function api(path, opts = {}) {
  const res = await fetch(withKey(path), { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (res.status === 401) { gate(KEY ? 'That key was not accepted. Check it and try again.' : ''); throw new Error('unauthorised'); }
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const act = (payload) => api('/api/actions', { method: 'POST', body: JSON.stringify(payload) });
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3200); }

function gate(msg = '') {
  $('#app').innerHTML = `<div class="gate"><form id="gate">
    ${logo(34)}<h1>Pipeline Radar</h1><p>Enter the dashboard key to open Vikram's VC pipeline.</p>
    <input id="gate-key" type="password" autocomplete="off" placeholder="Dashboard key" aria-label="Dashboard key">
    <button class="btn run" type="submit">Open dashboard</button><div class="err">${esc(msg)}</div></form></div>`;
  $('#gate').onsubmit = (e) => { e.preventDefault(); KEY = $('#gate-key').value.trim(); store.set('vc_key', KEY); load(); };
  $('#gate-key').focus();
}

async function load() {
  if (!DATA) $('#app').innerHTML = `<div class="band"><div class="wrap">${topbar(0)}</div></div><main class="wrap"><div class="queue"><div class="skel"></div><div class="skel"></div></div></main>`;
  DATA = await api('/api/vcs');
  render();
}

// ---------- small components ----------
function logo(size = 26) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/>
  <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-width="2"/><path d="M16 16 L27 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="22.5" cy="11.5" r="2.6" fill="#3fcf8c"/></svg>`;
}
function topbar(n) {
  return `<div class="topbar"><div class="brand">${logo()}<div><b>Pipeline Radar</b><br><span>FreightLoop · Seed round${n ? ` · ${n} VCs` : ''}</span></div></div>
    <div class="top-actions"><button class="btn ghost-band sm" id="theme" type="button" aria-label="Toggle colour theme">◐ Theme</button>
    <button class="btn run" id="run" type="button" ${RUNNING ? 'disabled' : ''}>${RUNNING ? 'Running…' : '↻ Run now'}</button></div></div>`;
}
function nextAutoRun() {
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, 1, 0));
    if ([1, 4].includes(d.getUTCDay()) && d > now) return d;
  }
}
// Group several outlets covering one event; keep the strongest item per event.
function events(v) {
  const map = new Map();
  for (const s of v.evidence) {
    const k = s.event || s.title;
    const cur = map.get(k);
    if (!cur) map.set(k, { ...s, outlets: 1 });
    else { cur.outlets++; if (+s.points > +cur.points) Object.assign(cur, s, { outlets: cur.outlets }); }
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.published.localeCompare(a.published));
}
function strip(v) {
  const today = Date.parse(istToday());
  const best = {};
  for (const s of v.evidence) { const k = Math.round((today - Date.parse(s.published)) / DAY); best[k] = Math.max(best[k] ?? 0, s.relevance + 1); }
  let cells = '';
  for (let k = 29; k >= 0; k--) {
    const r = best[k] ? Math.max(1, best[k] - 1) : 0;
    const day = new Date(today - k * DAY).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    cells += `<i class="${best[k] ? 'r' + r : ''}" title="${day}${best[k] ? ' · signal (' + REL[best[k] - 1] + ')' : ''}"></i>`;
  }
  return `<div class="strip-wrap"><div class="strip" aria-label="Signals over the last 30 days">${cells}</div>
    <div class="strip-axis"><span>30 days ago</span><span>today</span></div></div>`;
}
function meter(score) {
  return `<div class="meter" role="img" aria-label="Score ${score ?? 0} of 100; outreach line at ${THRESHOLD}">
    <div class="f" style="width:${Math.max(0, Math.min(100, score ?? 0))}%"></div><div class="th" style="left:${THRESHOLD}%"></div></div>`;
}
// Score over the last few runs, with the outreach line dashed.
function spark(values, w = 96, h = 26) {
  if (!values || values.length < 2) return `<span class="spark-none">first run</span>`;
  const x = (i) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (s) => h - 2 - (Math.min(100, s) / 100) * (h - 4);
  const pts = values.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score over the last ${values.length} runs: ${values.join(', ')}">
    <line x1="0" x2="${w}" y1="${y(THRESHOLD)}" y2="${y(THRESHOLD)}" class="spark-th"/>
    <polygon points="2,${h - 2} ${pts} ${x(values.length - 1)},${h - 2}" class="spark-area"/>
    <polyline points="${pts}" class="spark-line"/><circle cx="${x(values.length - 1)}" cy="${y(last)}" r="2.6" class="spark-dot"/></svg>`;
}
function badges(v) {
  const c = v.change || {}, out = [];
  if (flags(v).includes('now_actionable')) out.push(`<span class="badge new">New this run</span>`);
  if (flags(v).includes('heating_up')) out.push(`<span class="badge up">▲ +${c.delta} heating up</span>`);
  if (flags(v).includes('cooling_down')) out.push(`<span class="badge down">▼ ${c.delta} cooling</span>`);
  if (flags(v).includes('went_quiet')) out.push(`<span class="badge down">Went quiet</span>`);
  if (c.newSignals && !flags(v).includes('first_check')) out.push(`<span class="badge sig">${plural(c.newSignals, 'new signal')}</span>`);
  return out.join('');
}
function evRow(e, v) {
  const rej = e.verdict === 'not_relevant', ok = e.verdict === 'useful';
  return `<div class="ev ${rej ? 'rejected' : ''}"><span class="d">${fmtD(e.published)}</span>
    <span class="t"><span class="tag">${TYPE[e.type] || 'News'}</span><span class="tag ${e.relevance === 3 ? 'rel3' : ''}">${REL[e.relevance]}</span></span>
    <span class="s"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc((e.summary || e.title).replace(/ \[firm\]/g, ''))}</a>
    <small>${e.about === 'partner' ? 'About the partner' : 'Firm activity'} · ${esc(e.source === 'blog' ? 'firm blog' : e.source === 'search' ? 'web search' : 'news')}${e.outlets > 1 ? ` · ${e.outlets} outlets` : ''}${rej ? ' · <b>excluded from the next run</b>' : ''}</small></span>
    <span class="fb" role="group" aria-label="Was this signal useful?">
      <button type="button" class="fb-btn ${ok ? 'on' : ''}" data-fb="useful" data-vc="${v.id}" data-url="${esc(e.url)}" data-title="${esc(e.title)}" aria-pressed="${ok}" title="Useful signal">👍</button>
      <button type="button" class="fb-btn ${rej ? 'on' : ''}" data-fb="not_relevant" data-vc="${v.id}" data-url="${esc(e.url)}" data-title="${esc(e.title)}" aria-pressed="${rej}" title="Not relevant: ignore in future runs">👎</button>
    </span></div>`;
}

// ---------- render ----------
function render() {
  const vcs = DATA.vcs, run = DATA.last_run;
  const n = (g) => vcs.filter((v) => group(v) === g).length;
  const counts = { go: n('go'), nudge: n('nudge'), hold: n('hold'), quiet: n('quiet'), passed: n('passed') };
  const intact = run && run.protected_hash_after && run.protected_hash_before === run.protected_hash_after;
  const next = nextAutoRun();
  const queue = vcs.filter((v) => ['go', 'nudge'].includes(group(v))).sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0));
  const since = {
    actionable: vcs.filter((v) => flags(v).includes('now_actionable')).length,
    fresh: vcs.filter((v) => (v.change?.newSignals || 0) > 0 && !flags(v).includes('first_check')).length,
    quiet: vcs.filter((v) => flags(v).includes('went_quiet')).length,
    up: vcs.filter((v) => flags(v).includes('heating_up')).length,
  };

  $('#app').innerHTML = `
  <header class="band"><div class="wrap">
    ${topbar(vcs.length)}
    <div class="brief">
      <div>
        <div class="eyebrow">This week's brief · signals from the last 30 days</div>
        <h1>Reach out to&nbsp;<em>${counts.go}</em> and nudge&nbsp;<i>${counts.nudge}</i>. ${counts.quiet}&nbsp;are quiet this week.</h1>
        <p class="since"><b>Since the last run:</b> ${plural(since.actionable, 'VC')} newly worth contacting · ${plural(since.fresh, 'VC')} with new signals · ${since.up} heating up · ${since.quiet} went quiet.</p>
      </div>
      <div class="runmeta">
        <span>Last run <b>${fmtT(run?.finished_at)}</b> · ${run?.trigger === 'cron' ? 'scheduled' : 'manual'} · <b class="mono">${run?.vcs_checked ?? 0}</b> VCs · <b class="mono">${run?.signals_found ?? 0}</b> signals</span>
        <span>Next automatic run <b>${fmtT(next)}</b> (Mon &amp; Thu, 6:30 am), with the brief emailed to you</span>
        ${run ? `<span class="proof ${intact ? '' : 'warn'}">${intact ? '✓ Your notes and contact history were not touched' : '⚠ Your columns changed during the last run (an edit made while it ran?)'}</span>` : ''}
      </div>
    </div>
    <div class="dist">
      <div class="dist-bar" aria-hidden="true">
        ${['go', 'nudge', 'hold', 'quiet', 'passed'].map((g) => `<span class="c-${g}" style="flex-grow:${counts[g]}"></span>`).join('')}
      </div>
      <div class="dist-legend">
        ${[['go', 'Reach out now'], ['nudge', 'Nudge now'], ['hold', 'In progress'], ['quiet', 'Quiet'], ['passed', 'Passed']].map(([g, l]) =>
          `<button type="button" data-filter="${g}" aria-pressed="${FILTER === g}"><span class="dot c-${g}"></span>${l} <b class="mono">${counts[g]}</b></button>`).join('')}
      </div>
    </div>
    <div class="progress" id="progress"><div class="track"><div class="fill" id="pfill"></div></div><small id="ptext">Starting run…</small></div>
  </div></header>

  <main class="wrap">
    <div class="cols">
      <section aria-labelledby="q-h">
        <div class="sec-head"><div><h2 id="q-h">Act on these this week</h2><p>Ranked by follow-up score. Check the signal, send the draft, then mark it sent.</p></div></div>
        <div class="queue">${queue.map(card).join('') || '<div class="card empty">No VC has a strong enough signal right now. Check back after the next run.</div>'}</div>
      </section>
      <aside class="rail">${railRun(run, intact)}${railMix(vcs)}${railRules()}</aside>
    </div>

    <section class="pipeline" aria-labelledby="p-h">
      <div class="sec-head"><div><h2 id="p-h">Full pipeline</h2><p>Click a VC for the evidence, the email draft, and your own notes.</p></div>
        <div class="tools"><button class="btn sm" id="add" type="button">＋ Add VC</button>
          <label class="btn sm" for="csv">⇪ Import CSV</label><input id="csv" type="file" accept=".csv,text/csv" hidden>
          <button class="btn sm" id="export" type="button">⇩ Export CSV</button></div></div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Filter">
          ${[['all', 'All'], ['go', 'Reach out'], ['nudge', 'Nudge'], ['hold', 'In progress'], ['quiet', 'Quiet'], ['passed', 'Passed']].map(([f, l]) =>
            `<button type="button" data-filter="${f}" aria-pressed="${FILTER === f}">${l}</button>`).join('')}
        </div>
        <input class="search" id="search" type="search" placeholder="Search VC, firm or note" value="${esc(QUERY)}" aria-label="Search">
      </div>
      <div class="card table-wrap"><table><thead><tr>
        <th>VC</th><th>Your status</th><th>Last contact</th><th>Score</th><th>Trend</th><th>Recommendation</th><th>Why</th>
      </tr></thead><tbody id="rows"></tbody></table></div>
    </section>

    <section class="archived" aria-labelledby="a-h">
      <div class="sec-head"><div><h2 id="a-h">Archived <span class="mono count">${(DATA.archived || []).length}</span></h2>
        <p>Hidden from the dashboard and skipped by runs. Your notes are kept. VCs with no public signal for ${DATA.archive_after_days || 60} days are archived automatically after a run (never ones you are in conversation with).</p></div></div>
      ${(DATA.archived || []).length ? `<div class="card arch-list">${DATA.archived.map((v) => `<div class="arch-row">
          <div class="who"><b>${esc(v.name)}</b><span>${esc(v.firm)}</span></div>
          <div class="arch-why"><span class="pill ${v.archive.archived_by === 'rule' ? 'quiet' : 'plain'}">${v.archive.archived_by === 'rule' ? 'Auto-archived' : 'Archived by you'}</span>
            <small>${esc(v.archive.reason || '')} · ${fmtD(v.archive.archived_at.slice(0, 10))}</small></div>
          <button class="btn sm" type="button" data-restore="${v.id}">↺ Restore</button></div>`).join('')}</div>`
        : '<div class="card empty">Nothing archived yet.</div>'}
    </section>
  </main>`;

  renderRows();
  wire();
}

function card(v) {
  const evs = events(v).slice(0, 3);
  const since = daysAgo(v.last_contact);
  return `<article class="card vc">
    <div class="vc-top">
      <div><h3 class="vc-name">${esc(v.name)}</h3><div class="vc-firm">${esc(v.firm)}</div>
        <div class="chips"><span class="pill ${group(v)}">${SHORT[code(v)]}</span><span class="pill plain">${STATUS[v.status]}${since !== null ? ` · ${since}d since contact` : ''}</span>${badges(v)}</div></div>
      <div class="score"><div class="n">${v.follow_up_score ?? 0}<small> /100</small></div>${meter(v.follow_up_score)}
        <div class="cap">outreach line at ${THRESHOLD}</div><div class="spark-wrap">${spark(v.trend)}</div></div>
    </div>
    <div class="why">${evs.map((e) => evRow(e, v)).join('')}</div>
    ${strip(v)}
    <div class="vc-foot">
      <div class="note">${v.notes ? `<b>Your note:</b> ${esc(v.notes)}` : ''}</div>
      <div class="acts">${v.check?.draft_body ? `<button class="btn primary sm" data-open="${v.id}" data-tab="draft" type="button">✉ Email draft</button>` : ''}
        <button class="btn sm" data-sent="${v.id}" type="button" title="Sets status to waiting for reply and last contact to today">✓ Mark sent</button>
        <button class="btn sm" data-open="${v.id}" type="button">Details</button></div>
    </div>
  </article>`;
}

function railRun(run, intact) {
  const hist = (DATA.runs || []).slice(0, 4).map((r) => {
    const ok = r.protected_hash_after && r.protected_hash_before === r.protected_hash_after;
    return `<div><span>${fmtT(r.started_at)}</span><span class="mono">${r.vcs_checked}/${DATA.vcs.length}</span><span class="${r.status === 'failed' ? 'bad' : ok ? 'ok' : ''}">${r.status === 'failed' ? 'failed' : r.status === 'running' ? 'running' : ok ? '✓ notes safe' : r.status}</span></div>`;
  }).join('');
  return `<section class="card panel"><h3>Last run</h3>
    <dl class="kv"><dt>Finished</dt><dd>${fmtT(run?.finished_at)}</dd><dt>VCs checked</dt><dd class="mono">${run?.vcs_checked ?? 0}</dd>
    <dt>Signals found</dt><dd class="mono">${run?.signals_found ?? 0}</dd><dt>Trigger</dt><dd>${run?.trigger === 'cron' ? 'Scheduled' : 'Manual'}</dd>
    <dt>Brief emailed</dt><dd>${run?.digest_sent_at ? fmtT(run.digest_sent_at) : 'on scheduled runs'}</dd></dl>
    <div class="guard ${intact ? '' : 'warn'}"><b>${intact ? '✓ Your columns untouched' : '⚠ Check your columns'}</b>
      <span>Fingerprint of your notes, history and status matched before and after the run.</span></div>
    <div class="cols-proof"><div><strong>Run writes</strong>Last signal date, signal summary, follow-up score, recommended action</div>
      <div><strong>Never writes</strong>Status, last contact, contact history, notes, email</div></div>
    <div class="history">${hist}</div>
    <div class="mail-acts" style="margin-top:12px"><button class="btn sm" id="digest" type="button">✉ Email me this brief</button>
      <a class="btn sm" href="${withKey('/api/actions?preview=digest')}" target="_blank" rel="noopener">Preview email</a></div></section>`;
}
function railMix(vcs) {
  const all = vcs.flatMap((v) => events(v));
  const by = {}; for (const e of all) by[e.type] = (by[e.type] || 0) + 1;
  const max = Math.max(1, ...Object.values(by));
  const rel = [0, 0, 0, 0]; for (const e of all) rel[e.relevance]++;
  const fb = DATA.feedback || {};
  return `<section class="card panel"><h3>Signal mix, last 30 days</h3><div class="mix">
    ${['investment', 'blog', 'interview', 'event', 'other'].map((t) => `<div class="mix-row"><span>${PLURAL[t]}</span><span class="b"><span style="width:${(by[t] || 0) / max * 100}%"></span></span><span class="mono">${by[t] || 0}</span></div>`).join('')}
    </div><p class="mix-note"><b class="mono">${rel[3]}</b> logistics and <b class="mono">${rel[2]}</b> B2B SaaS signals across ${all.length} distinct events.</p>
    <div class="accuracy"><div><strong class="mono">${fb.precision ?? '—'}${fb.precision != null ? '%' : ''}</strong><span>of signals you rated were useful</span></div>
      <small>${fb.rated ? `${plural(fb.rated, 'signal')} rated with 👍 / 👎.` : 'Rate signals with 👍 / 👎 to measure accuracy.'} 👎 removes a signal from future runs.</small></div></section>`;
}
function railRules() {
  return `<section class="card panel"><h3>How the score works</h3><div class="rules">
    <p>Each event earns up to 40 points: <b>type</b> (deal 1.0, post 0.8, event 0.7, interview 0.6) × <b>relevance</b> × <b>recency</b> (full for 7 days, fading to zero at 30).</p>
    <p>Several outlets covering one event count once. Off-topic activity adds at most 15, so it can never cross the outreach line of ${THRESHOLD} alone.</p>
    <p>A pending reply is never chased until 10 days after your last contact.</p>
    <div class="legend-rel"><span><i style="background:var(--rel3)"></i>Logistics</span><span><i style="background:var(--rel2)"></i>B2B SaaS</span><span><i style="background:var(--rel1)"></i>General</span></div>
  </div></section>`;
}

function renderRows() {
  const q = QUERY.toLowerCase();
  const rows = DATA.vcs
    .filter((v) => FILTER === 'all' || group(v) === FILTER)
    .filter((v) => !q || `${v.name} ${v.firm} ${v.notes || ''} ${v.signal_summary || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.follow_up_score ?? 0) - (a.follow_up_score ?? 0));
  $('#rows').innerHTML = rows.map((v) => `<tr data-open="${v.id}" tabindex="0">
    <td><div class="who"><b>${esc(v.name)}</b><span>${esc(v.firm)}</span></div></td>
    <td>${STATUS[v.status]}</td>
    <td class="mono">${fmtD(v.last_contact)}</td>
    <td><div class="mini-meter"><b>${v.follow_up_score ?? 0}</b>${meter(v.follow_up_score)}</div></td>
    <td>${spark(v.trend, 80, 24)}</td>
    <td><span class="pill ${group(v)}">${SHORT[code(v)]}</span></td>
    <td class="sum"><span class="clamp">${esc((v.signal_summary || 'Not checked yet.').replace(/ \[firm\]/g, ''))}</span></td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">No VCs match this filter.</td></tr>`;
  $$('#rows tr[data-open]').forEach((tr) => {
    tr.onclick = () => openDrawer(+tr.dataset.open);
    tr.onkeydown = (e) => { if (e.key === 'Enter') openDrawer(+tr.dataset.open); };
  });
}

function wire() {
  $('#run').onclick = runNow;
  $('#theme').onclick = toggleTheme;
  $('#add').onclick = openAddForm;
  $('#export').onclick = exportCsv;
  $('#csv').onchange = (e) => importCsv(e.target.files[0]).finally(() => { e.target.value = ''; });
  $('#digest').onclick = sendDigestNow;
  $$('[data-restore]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Restoring…';
    try {
      const v = DATA.archived.find((x) => x.id === +b.dataset.restore);
      await act({ action: 'restore', id: v.id });
      await load();
      toast(`${v.name} is back in the pipeline. The next run will check them again.`);
    } catch (err) { toast(err.message); b.disabled = false; b.textContent = '↺ Restore'; }
  });
  $$('[data-filter]').forEach((b) => b.onclick = () => {
    FILTER = FILTER === b.dataset.filter && b.closest('.dist-legend') ? 'all' : b.dataset.filter;
    $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.filter === FILTER));
    renderRows();
    if (b.closest('.dist-legend')) $('.pipeline').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#search').oninput = (e) => { QUERY = e.target.value; renderRows(); };
  $$('.queue [data-open]').forEach((b) => b.onclick = () => openDrawer(+b.dataset.open, b.dataset.tab));
  $$('.queue [data-sent]').forEach((b) => b.onclick = () => markSent(+b.dataset.sent, null, b));
  wireFeedback($('.queue'));
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('vc_theme', root.dataset.theme);
}

// ---------- actions ----------
function wireFeedback(scope) {
  $$('[data-fb]', scope).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const vc = DATA.vcs.find((v) => v.id === +b.dataset.vc);
    const items = vc.evidence.filter((s) => s.url === b.dataset.url || s.title === b.dataset.title);
    const verdict = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.fb;
    try {
      await act({ action: 'feedback', vc_id: vc.id, url: b.dataset.url, title: b.dataset.title, verdict });
      items.forEach((s) => { s.verdict = verdict; });
      const fb = DATA.feedback; // recount locally so the accuracy panel updates without a reload
      const all = DATA.vcs.flatMap((v) => v.evidence.filter((s) => s.verdict).map((s) => `${v.id}|${s.url}|${s.verdict}`));
      const uniq = [...new Set(all)];
      fb.rated = uniq.length; fb.useful = uniq.filter((x) => x.endsWith('|useful')).length;
      fb.precision = fb.rated ? Math.round(fb.useful / fb.rated * 100) : null;
      toast(verdict === 'not_relevant' ? 'Marked not relevant. The next run will ignore it.' : verdict === 'useful' ? 'Marked useful. Thanks, that sharpens the accuracy figure.' : 'Rating cleared.');
      const open = $('#drawer').open ? +$('#drawer').dataset.vc : null;
      render();
      if (open) openDrawer(open);
    } catch (err) { toast(err.message); }
  });
}

async function markSent(id, subject, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const r = await act({ action: 'mark_sent', id, subject });
    const v = DATA.vcs.find((x) => x.id === id);
    Object.assign(v, r.vc);
    if (v.check && r.action) v.check.action_code = r.action.code;
    toast(`Logged. ${v.name} is now on hold until a reply or 10 days pass.`);
    $('#drawer').open && $('#drawer').close();
    render();
  } catch (err) { toast(err.message); if (btn) { btn.disabled = false; btn.textContent = '✓ Mark sent'; } }
}

async function sendDigestNow() {
  const b = $('#digest'); b.disabled = true; b.textContent = 'Sending…';
  try { const r = await act({ action: 'send_digest' }); toast(`Brief emailed to ${r.to}.`); }
  catch (err) { toast(err.message.includes('not set up') ? 'Email is not set up yet: deploy the Apps Script mailer (see README).' : err.message); }
  finally { b.disabled = false; b.textContent = '✉ Email me this brief'; }
}

// ---------- CSV ----------
const CSV_COLUMNS = ['name', 'firm', 'thesis', 'email', 'website', 'blog_rss', 'status', 'last_contact', 'contact_history', 'notes',
  'last_signal_date', 'signal_summary', 'follow_up_score', 'recommended_action'];
function exportCsv() {
  const cell = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [CSV_COLUMNS.join(','), ...DATA.vcs.map((v) => CSV_COLUMNS.map((c) => cell(v[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `vc-pipeline-${istToday()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${plural(DATA.vcs.length, 'VC')}.`);
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
// Accepts Vikram's own spreadsheet headings ("Partner", "Fund", "Last contacted", ...).
const HEADER_ALIASES = { name: ['name', 'partner', 'vc', 'investor', 'contact'], firm: ['firm', 'fund', 'company', 'vc_firm'],
  thesis: ['thesis', 'focus'], email: ['email', 'e_mail', 'email_address'], website: ['website', 'site', 'url'],
  blog_rss: ['blog_rss', 'blog', 'rss', 'feed'], status: ['status', 'stage'], last_contact: ['last_contact', 'last_contacted', 'last_contact_date'],
  contact_history: ['contact_history', 'history'], notes: ['notes', 'note', 'comments'] };
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
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy (Indian format)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}
async function importCsv(file) {
  if (!file) return;
  const [head, ...body] = parseCsv(await file.text());
  if (!head) return toast('That file is empty.');
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const col = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([field, names]) => [field, keys.findIndex((k) => names.includes(k))]));
  if (col.name < 0 || col.firm < 0) return toast('The CSV needs a name (or partner) column and a firm (or fund) column.');
  const rows = body.map((r) => {
    const o = {};
    for (const [field, i] of Object.entries(col)) if (i >= 0) o[field] = (r[i] || '').trim();
    o.status = toStatus(o.status); o.last_contact = toDate(o.last_contact);
    return o;
  }).filter((o) => o.name && o.firm);
  const existing = new Set(DATA.vcs.map((v) => `${v.name}|${v.firm}`.toLowerCase()));
  const fresh = rows.filter((o) => !existing.has(`${o.name}|${o.firm}`.toLowerCase()));
  openImportPreview(file.name, rows, fresh);
}
function openImportPreview(fileName, rows, fresh) {
  $('#drawer').dataset.vc = '';
  $('#drawer-body').innerHTML = `
    <div class="d-head"><div><div class="eyebrow" style="color:var(--muted)">Import from CSV</div><h2>${esc(fileName)}</h2></div>
      <button class="close" type="button" id="d-close" aria-label="Close">×</button></div>
    <p style="margin:0;color:var(--ink-2)">${plural(rows.length, 'row')} with a name and firm. <b>${plural(fresh.length, 'new VC')}</b> will be added; ${rows.length - fresh.length} already in the pipeline will be skipped. Your existing notes are not changed.</p>
    ${fresh.length ? `<div class="card table-wrap"><table class="compact"><thead><tr><th>VC</th><th>Status</th><th>Last contact</th></tr></thead><tbody>
      ${fresh.slice(0, 8).map((o) => `<tr><td><div class="who"><b>${esc(o.name)}</b><span>${esc(o.firm)}</span></div></td><td>${STATUS[o.status]}</td><td class="mono">${fmtD(o.last_contact)}</td></tr>`).join('')}
      </tbody></table></div>${fresh.length > 8 ? `<p style="margin:0;font-size:13px;color:var(--muted)">…and ${fresh.length - 8} more.</p>` : ''}` : ''}
    <div class="mail-acts"><button class="btn primary" id="do-import" type="button" ${fresh.length ? '' : 'disabled'}>Import ${plural(fresh.length, 'VC')}</button>
      <button class="btn" type="button" id="cancel-import">Cancel</button>
      <span style="font-size:13px;color:var(--muted)">New VCs get signals on the next run, or press Run now.</span></div>`;
  showDrawer();
  $('#cancel-import').onclick = () => $('#drawer').close();
  $('#do-import').onclick = async () => {
    const b = $('#do-import'); b.disabled = true; b.textContent = 'Importing…';
    try {
      const r = await act({ action: 'import', rows: fresh });
      $('#drawer').close();
      await load();
      toast(`Imported ${plural(r.imported, 'VC')}${r.skipped ? `, skipped ${r.skipped}` : ''}. Press Run now to check them.`);
    } catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Import'; }
  };
}

// ---------- drawer ----------
function showDrawer() {
  const dlg = $('#drawer');
  if (!dlg.open) dlg.showModal();
  $('#d-close').onclick = () => dlg.close();
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  $('#drawer-body').scrollTop = 0;
}

function openAddForm() {
  $('#drawer').dataset.vc = '';
  $('#drawer-body').innerHTML = `
    <div class="d-head"><div><div class="eyebrow" style="color:var(--muted)">New VC</div><h2>Add to the pipeline</h2></div>
      <button class="close" type="button" id="d-close" aria-label="Close">×</button></div>
    <p style="margin:0;color:var(--ink-2);font-size:14px">The VC is checked as soon as you save: news, their blog and the web for the last 30 days.</p>
    <form id="add-form" class="d-sec">
      <div class="grid2"><label class="field">Partner name *<input id="a-name" required placeholder="e.g. Karthik Reddy"></label>
        <label class="field">Firm *<input id="a-firm" required placeholder="e.g. Blume Ventures"></label></div>
      <label class="field">Thesis<input id="a-thesis" placeholder="What they invest in"></label>
      <div class="grid2"><label class="field">Email<input id="a-email" type="email"></label>
        <label class="field">Website<input id="a-website" type="url" placeholder="https://"></label></div>
      <label class="field">Blog / Medium / Substack RSS feed<input id="a-rss" type="url" placeholder="https://medium.com/feed/…"></label>
      <div class="grid2"><label class="field">Status<select id="a-status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field">Last contact<input id="a-last" type="date"></label></div>
      <label class="field">Notes<textarea id="a-notes"></textarea></label>
      <div class="mail-acts"><button class="btn primary" type="submit" id="a-save">Add and check now</button><span id="a-msg" style="font-size:13px;color:var(--muted)"></span></div>
    </form>`;
  showDrawer();
  $('#a-name').focus();
  $('#add-form').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('#a-save'); b.disabled = true; b.textContent = 'Adding…';
    $('#a-msg').textContent = 'Checking news, blog and the web. This takes about 15 seconds.';
    try {
      const vc = await api('/api/vcs', { method: 'POST', body: JSON.stringify({ name: $('#a-name').value, firm: $('#a-firm').value,
        thesis: $('#a-thesis').value, email: $('#a-email').value, website: $('#a-website').value, blog_rss: $('#a-rss').value,
        status: $('#a-status').value, last_contact: $('#a-last').value, notes: $('#a-notes').value }) });
      await load();
      toast(`${vc.name} added. Score ${vc.follow_up_score ?? 0}: ${vc.recommended_action || 'checked'}.`);
      openDrawer(vc.id);
    } catch (err) { $('#a-msg').textContent = err.message; b.disabled = false; b.textContent = 'Add and check now'; }
  };
}

function openDrawer(id, tab) {
  const v = DATA.vcs.find((x) => x.id === id);
  if (!v) return;
  const evs = events(v);
  const d = v.check || {};
  $('#drawer').dataset.vc = id;
  $('#drawer-body').innerHTML = `
    <div class="d-head"><div><div class="eyebrow" style="color:var(--muted)">${esc(v.firm)}</div><h2>${esc(v.name)}</h2>
      <div class="chips"><span class="pill ${group(v)}">${SHORT[code(v)]}</span><span class="pill plain">Score ${v.follow_up_score ?? 0}/100</span>${badges(v)}</div></div>
      <button class="close" type="button" id="d-close" aria-label="Close">×</button></div>
    ${v.thesis ? `<p style="margin:0;color:var(--ink-2);font-size:14px">${esc(v.thesis)}</p>` : ''}

    ${d.draft_body ? `<section class="d-sec" id="d-draft"><h3>✉ Email draft · ${d.action_code === 'NUDGE_NOW' ? 'follow-up nudge' : 'first outreach'}</h3>
      <div class="mail"><div class="row"><label for="m-to">To</label><input id="m-to" value="${esc(v.email || '')}" placeholder="No public email on file. Add one."></div>
      <div class="row"><label for="m-su">Subject</label><input id="m-su" value="${esc(d.draft_subject || '')}"></div>
      <textarea id="m-body" aria-label="Email body">${esc(d.draft_body)}</textarea></div>
      <div class="mail-acts"><a class="btn primary" id="m-gmail" target="_blank" rel="noopener">Open in Gmail</a>
      <button class="btn" type="button" id="m-copy">Copy email</button><a class="btn" id="m-mailto">Mail app</a>
      <button class="btn" type="button" id="m-sent">✓ Mark as sent</button></div>
      <p style="margin:0;font-size:12.5px;color:var(--muted)">After sending, mark it sent: status becomes "Waiting for reply", last contact becomes today, and a line is added to your contact history.</p></section>` : ''}

    <section class="d-sec"><h3>Why now · ${plural(evs.length, 'event')} in 30 days</h3>
      ${evs.length ? `<div class="why">${evs.map((e) => evRow(e, v)).join('')}</div>` : `<p style="margin:0;color:var(--ink-2)">${esc(v.signal_summary || 'Not checked yet.')}</p>`}
      ${strip(v)}
      <div class="trend-row"><span>Score over the last runs</span>${spark(v.trend, 160, 36)}</div>
      <p style="margin:0;font-size:12.5px;color:var(--muted)">Checked: ${esc((d.sources_checked || []).join(', ') || '—')} · ${d.items_found ?? 0} items found · ${fmtT(d.checked_at)}</p></section>

    <section class="d-sec"><h3>Your columns · you edit these</h3>
      <form id="d-form" class="d-sec">
        <div class="grid2"><label class="field">Status<select id="f-status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Last contact<input id="f-last" type="date" value="${esc(v.last_contact || '')}"></label></div>
        <label class="field">Email<input id="f-email" type="email" value="${esc(v.email || '')}"></label>
        <label class="field">Contact history<textarea id="f-hist">${esc(v.contact_history || '')}</textarea></label>
        <label class="field">Notes<textarea id="f-notes">${esc(v.notes || '')}</textarea></label>
        <div class="mail-acts"><button class="btn primary" type="submit" id="f-save">Save changes</button><span style="font-size:13px;color:var(--muted)">Runs read these but never change them.</span></div>
      </form></section>

    <section class="d-sec"><h3>🔒 Signal columns · written only by the run</h3>
      <div class="locked"><div><span>Last signal date</span><b class="mono">${fmtD(v.last_signal_date)}</b></div>
      <div><span>Follow-up score</span><b class="mono">${v.follow_up_score ?? '—'}</b></div>
      <div><span>Recommended action</span><b>${esc(v.recommended_action || '—')}</b></div>
      <div><span>Signal summary</span><span style="color:var(--ink)">${esc((v.signal_summary || '—').replace(/ \[firm\]/g, ''))}</span></div></div></section>

    <section class="d-sec"><h3>Remove from pipeline</h3>
      <p style="margin:0;font-size:13.5px;color:var(--ink-2)">Archiving hides ${esc(v.name.split(' ')[0])} from the dashboard and from future runs. Your notes and history are kept, and you can restore them any time.</p>
      <div class="mail-acts"><button class="btn danger" type="button" id="d-archive">Archive this VC</button><span id="d-archive-msg" style="font-size:13px;color:var(--muted)"></span></div></section>`;

  showDrawer();
  if (d.draft_body) wireDraft(v);
  $('#d-archive').onclick = async (e) => {
    const b = e.currentTarget;
    if (!b.dataset.confirm) { // two-step: the first click asks, the second archives
      b.dataset.confirm = '1'; b.textContent = `Yes, archive ${v.name.split(' ')[0]}`;
      $('#d-archive-msg').textContent = 'Click again to confirm.';
      return;
    }
    b.disabled = true; b.textContent = 'Archiving…';
    try {
      await act({ action: 'archive', id: v.id });
      $('#drawer').close();
      await load();
      toast(`${v.name} archived. Restore them any time from the Archived list.`);
    } catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Archive this VC'; }
  };
  if (tab === 'draft' && d.draft_body) $('#m-body').focus();
  wireFeedback($('#drawer-body'));

  $('#d-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#f-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const updated = await api('/api/vcs', { method: 'PATCH', body: JSON.stringify({ id: v.id, status: $('#f-status').value, last_contact: $('#f-last').value,
        email: $('#f-email').value, contact_history: $('#f-hist').value, notes: $('#f-notes').value }) });
      Object.assign(v, updated);
      await load();
      toast('Saved. The recommendation was updated for your new status.');
      $('#drawer').close();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Save changes'; }
  };
}
function wireDraft(v) {
  const sync = () => {
    const to = $('#m-to').value.trim(), su = $('#m-su').value, body = $('#m-body').value;
    $('#m-gmail').href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;
    $('#m-mailto').href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;
  };
  ['#m-to', '#m-su', '#m-body'].forEach((s) => $(s).oninput = sync); sync();
  $('#m-copy').onclick = async () => {
    const text = `To: ${$('#m-to').value}\nSubject: ${$('#m-su').value}\n\n${$('#m-body').value}`;
    try { await navigator.clipboard.writeText(text); toast('Email copied'); }
    catch { $('#m-body').select(); toast('Press Ctrl+C to copy the selected text'); }
  };
  $('#m-sent').onclick = (e) => markSent(v.id, $('#m-su').value, e.currentTarget);
}

// ---------- run ----------
async function runNow() {
  if (RUNNING) return;
  RUNNING = true;
  const btn = $('#run'); btn.disabled = true; btn.textContent = 'Running…';
  $('#progress').classList.add('on');
  const total = DATA.vcs.length;
  const poll = setInterval(async () => {
    try {
      const s = await api('/api/status');
      if (s.run?.status === 'running' || s.run?.status === 'partial') {
        $('#pfill').style.width = `${Math.round(s.checked / total * 100)}%`;
        $('#ptext').textContent = `Checking news, blogs and the web for each VC… ${s.checked} of ${total} done`;
      }
    } catch {}
  }, 3000);
  let runId = null;
  try {
    for (let step = 0; step < 6; step++) {
      const r = await api('/api/run', { method: 'POST', body: JSON.stringify({ run_id: runId }) });
      runId = r.run_id;
      if (r.joined) { // someone else's run is in progress: wait for it rather than run twice
        $('#ptext').textContent = 'A run is already in progress. Showing its progress…';
        for (let i = 0; i < 100; i++) {
          await new Promise((ok) => setTimeout(ok, 3000));
          const s = await api('/api/status');
          if (s.run?.id !== runId || !['running'].includes(s.run.status)) break;
        }
        break;
      }
      if (!r.remaining) break;
    }
    clearInterval(poll); RUNNING = false;
    await load();
    toast('Run complete. The pipeline is up to date.');
  } catch (err) {
    clearInterval(poll); RUNNING = false;
    btn.disabled = false; btn.textContent = '↻ Run now';
    $('#ptext').textContent = `The run stopped: ${err.message}. Press Run now to continue where it left off.`;
  }
}

load().catch((e) => { if (e.message !== 'unauthorised') $('#app').innerHTML = `<div class="wrap" style="padding-block:40px"><div class="card empty">Could not load the pipeline: ${esc(e.message)}. Refresh to try again.</div></div>`; });
