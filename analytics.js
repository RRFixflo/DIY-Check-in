// First-party visit and sales-funnel counts for the owner's /admin/analytics. No cookies, no third-party
// scripts, no IP addresses kept: a visitor is a hash of (today's random salt + IP + browser), the salt is
// replaced every day (Europe/London), so nobody can be followed from one day to the next, and only counts
// are kept. Stored as one file per day in REPORTS_DIR/analytics/YYYY-MM-DD.json (400 days). Today's file
// also holds today's visitor hashes (needed for unique counts); they are dropped when the day ends.
//   mount(app, ctx)       records page views and the server-side funnel steps (from server.js, early)
//   track(req, name, v)   records one funnel step (certs.js calls it through its ctx)
//   mountAdmin(app, ctx)  /admin/analytics, and summaryHTML() for the card at the top of /admin
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const KEEP_DAYS = 400;
const REPORT_PRICE = 30;   // £, per paid report
// Funnel steps the app may send to POST /api/event (anything else is ignored).
const CLIENT_EVENTS = ['app_open', 'report_started', 'first_photo', 'report_finished', 'pay_click', 'unlocked', 'downloaded'];
// Recorded by the server itself.
const SERVER_EVENTS = ['report_submitted', 'certificate_booking', 'contact_message', 'sign_off', 'sign_page', 'floorplan_purchase'];
const BOT = /bot\b|bot\/|crawl|spider|slurp|preview|monitor|curl|wget|python|headless|facebookexternalhit|facebookcatalog|WhatsApp|Twitterbot|Slackbot|TelegramBot|LinkedInBot|Discordbot|Applebot|Pinterest|redditbot|Embedly|SkypeUriPreview|Googlebot|bingbot|vkShare|Iframely|lighthouse|pingdom|uptime|axios|node-fetch|undici|go-http|okhttp|java\/|libwww|httpclient|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|duckduck|GPTBot|ClaudeBot|PerplexityBot|OAI-SearchBot|bytespider|CCBot/i;
const SKIP_PATH = /^\/(api|admin|p|sign|icons|img|images|fonts|static)(\/|$)/;
const ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|pdf|json|txt|xml|webmanifest|woff2?|ttf|otf|mp4|webm|zip)$/i;

let DIR = '';
let ctx = {};
const TZ = 'Europe/London';
const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });          // YYYY-MM-DD
const hourOf = (d = new Date()) => parseInt(d.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }), 10) % 24;
const fileOf = day => path.join(DIR, day + '.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, d) => { fs.writeFileSync(f + '.tmp', JSON.stringify(d)); fs.renameSync(f + '.tmp', f); };

function blankDay(day){
  return { day, views: 0, visitors: 0, hours: new Array(24).fill(0), paths: {}, referrers: {}, utm: {}, devices: {}, countries: {}, events: {},
    sales: { link: 0, code: 0, open: 0 }, revenue: 0, certs: { n: 0, value: 0 }, seen: {} };
}
// Today's counts in memory; `seen` holds today's visitor hashes: seen['*'] everyone, seen['p:/path'], seen['e:name'].
let today = null, salt = null, dirty = false, timer = null;
function current(){
  const day = dayKey();
  if (today && today.day === day) return today;
  if (today) { flush(); finishDay(today.day); }
  today = readJson(fileOf(day), null) || blankDay(day);
  today.seen = today.seen || {};
  // Today's salt survives a restart (so a restart doesn't double-count); a new day gets a new one.
  const s = readJson(path.join(DIR, 'salt.json'), {});
  salt = s.day === day && s.salt ? s.salt : crypto.randomBytes(24).toString('hex');
  if (s.day !== day) writeJson(path.join(DIR, 'salt.json'), { day, salt });
  return today;
}
// A day that is over keeps its counts only.
function finishDay(day){
  const f = fileOf(day), d = readJson(f, null);
  if (d && d.seen) { delete d.seen; writeJson(f, d); }
}
function flush(){
  if (!dirty || !today) return;
  try { writeJson(fileOf(today.day), today); dirty = false; } catch (e) { console.error('analytics save failed:', e.message); }
}
function save(){ dirty = true; if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 30000); }
function prune(){
  try {
    const cut = dayKey(new Date(Date.now() - KEEP_DAYS * 86400000)), now = dayKey();
    for (const f of fs.readdirSync(DIR)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f); if (!m) continue;
      if (m[1] < cut) fs.unlinkSync(path.join(DIR, f));
      else if (m[1] < now) finishDay(m[1]);
    }
  } catch (e) { console.error('analytics prune failed:', e.message); }
}

const ipOf = req => (ctx.clientIp ? ctx.clientIp(req) : String(req.socket.remoteAddress || ''));
const uaOf = req => String(req.headers['user-agent'] || '');
const isBot = req => { const ua = uaOf(req); return !ua || BOT.test(ua) || /prefetch|prerender/i.test(String(req.headers['sec-purpose'] || req.headers.purpose || '')); };
const skip = req => isBot(req) || (ctx.isOwner && ctx.isOwner(req));
function visitorOf(req){ current(); return crypto.createHash('sha256').update(salt + '|' + ipOf(req) + '|' + uaOf(req)).digest('base64url').slice(0, 16); }
function deviceOf(ua){ return /iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobi/i.test(ua)) ? 'tablet' : /Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua) ? 'phone' : 'desktop'; }
// A guess from the browser's language setting (en-GB → GB), not a location.
function countryOf(req){ const m = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})\b/.exec(String(req.headers['accept-language'] || '').trim()); return m ? m[1].toUpperCase() : '?'; }
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const cap = (o, k, max) => (k in o || Object.keys(o).length < max) ? k : '(other)';
// Adds v to today's set `key`; true the first time today.
function firstToday(d, key, v){ const s = d.seen[key] || (d.seen[key] = []); if (s.includes(v)) return false; s.push(v); return true; }

// The other site a page view came from, 'direct' when none, '' when from one of our own pages.
function referrerOf(req){
  const r = String(req.headers.referer || '');
  if (!r) return 'direct';
  let host = ''; try { host = new URL(r).host.toLowerCase(); } catch (e) { return 'direct'; }
  const own = [String(req.headers.host || '').toLowerCase()]; try { own.push(new URL(ctx.PUBLIC_BASE || 'x:').host.toLowerCase()); } catch (e) {}
  const bare = h => h.replace(/^www\./, '');
  if (own.filter(Boolean).some(h => bare(h) === bare(host))) return '';   // moving between our own pages
  return bare(host).slice(0, 80) || 'direct';
}
function pageView(req, pathName){
  const d = current(), v = visitorOf(req), ua = uaOf(req);
  d.views++;
  const first = firstToday(d, '*', v);
  if (first) { d.visitors++; d.hours[hourOf()]++; bump(d.devices, deviceOf(ua)); bump(d.countries, cap(d.countries, countryOf(req), 120)); }
  const p = cap(d.paths, pathName, 300), pc = d.paths[p] || (d.paths[p] = { views: 0, visitors: 0 });
  pc.views++; if (firstToday(d, 'p:' + p, v)) pc.visitors++;
  const ref = referrerOf(req); if (ref && (ref !== 'direct' || first)) bump(d.referrers, cap(d.referrers, ref, 200));
  const q = req.query || {}, u = k => String(q['utm_' + k] || '').trim().toLowerCase().replace(/[^\w .+-]/g, '').slice(0, 40);
  if (u('source') || u('medium') || u('campaign')) bump(d.utm, cap(d.utm, [u('source') || '-', u('medium') || '-', u('campaign') || '-'].join(' / '), 200));
  save();
}
// One funnel step. `value` is money (£) for sales and bookings; `kind` says how a report was paid for.
function track(req, name, value, kind){
  if (!DIR || !(CLIENT_EVENTS.includes(name) || SERVER_EVENTS.includes(name))) return;
  if (req && skip(req)) return;
  const d = current(), e = d.events[name] || (d.events[name] = { n: 0, visitors: 0 });
  e.n++;
  if (req && firstToday(d, 'e:' + name, visitorOf(req))) e.visitors++;
  if (name === 'report_submitted') { bump(d.sales, kind || 'link'); if (kind === 'link') d.revenue = Math.round((d.revenue + REPORT_PRICE) * 100) / 100; }
  if (name === 'certificate_booking') { d.certs.n++; d.certs.value = Math.round((d.certs.value + (Number(value) || 0)) * 100) / 100; }
  if (name === 'floorplan_purchase') { const f = d.floorplans || (d.floorplans = { n: 0, value: 0 }); f.n++; f.value = Math.round((f.value + (Number(value) || 0)) * 100) / 100; }
  save();
}
const cookieToken = req => { const m = /(?:^|;\s*)diy_access=([\w-]{12,40})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; };

function mount(app, c){
  ctx = c || {};
  DIR = path.join(ctx.REPORTS_DIR, 'analytics');
  fs.mkdirSync(DIR, { recursive: true });
  current(); prune();
  setInterval(() => { current(); prune(); }, 6 * 3600 * 1000).unref();
  const done = () => { flush(); process.exit(0); };
  process.once('SIGTERM', done); process.once('SIGINT', done);

  app.use((req, res, next) => {
    const p = req.path;
    if (req.method === 'GET') {
      if (SKIP_PATH.test(p) || ASSET.test(p) || skip(req)) {
        if (/^\/sign\/[a-f0-9]{32}\/?$/.test(p) && !skip(req)) res.on('finish', () => { if (res.statusCode === 200) track(req, 'sign_page'); });
        return next();
      }
      res.on('finish', () => {
        if (!(res.statusCode === 200 || res.statusCode === 402) || !/text\/html/.test(String(res.get('Content-Type') || ''))) return;
        let name = p.length > 1 ? p.replace(/\/+$/, '') : '/';
        // The app's page (a static file) is also the fallback for any unknown address: only /app counts. Other
        // pages count only when a route of their own sent them (the paywall answers unknown addresses with the
        // home page), and "/" (the home page, sent by the paywall).
        if (res.get('Last-Modified')) { if (!['/', '/app', '/index.html'].includes(name)) return; name = '/app'; }
        else if (!req.route && name !== '/') return;
        pageView(req, name.slice(0, 120));
      });
      return next();
    }
    if (req.method === 'POST') {
      // Funnel steps the server sees for itself (the route's own body parser has run by 'finish').
      if (p === '/api/reports') res.on('finish', () => {
        if (res.statusCode !== 201) return;
        const t = cookieToken(req);
        track(req, 'report_submitted', REPORT_PRICE, !t ? 'open' : ctx.codeAccess && ctx.codeAccess(t) ? 'code' : 'link');
      });
      else if (p === '/contact') res.on('finish', () => { if (res.statusCode === 303 && !String((req.body || {}).website || '').trim()) track(req, 'contact_message'); });
      else if (/^\/sign\/[a-f0-9]{32}\/?$/.test(p)) res.on('finish', () => { if (res.statusCode === 200) track(req, 'sign_off'); });
    }
    next();
  });

  // Funnel steps from the app (navigator.sendBeacon): just the step's name.
  const allowed = ctx.limiter ? ctx.limiter(240, 60 * 60 * 1000) : () => true;
  app.post('/api/event', express.text({ type: ['text/plain', 'application/octet-stream'], limit: '2kb' }), (req, res) => {
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    const name = String((b || {}).name || '');
    if (!CLIENT_EVENTS.includes(name)) return res.status(400).json({ error: 'Unknown event.' });
    if (allowed(ipOf(req))) track(req, name);
    res.status(204).end();
  });
}

/* ------------------------------- owner's side ------------------------------- */
function daysBack(n){ const t = Date.parse(dayKey() + 'T12:00:00Z'), out = []; for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * 86400000).toISOString().slice(0, 10)); return out; }
function load(n){ const t = current(); flush(); return daysBack(n).map(day => day === t.day ? t : (readJson(fileOf(day), null) || blankDay(day))); }
function sum(days){
  const s = blankDay(''); delete s.seen; s.pathsV = {}; s.floorplans = { n: 0, value: 0 };
  for (const d of days) {
    s.views += d.views || 0; s.visitors += d.visitors || 0; s.revenue += d.revenue || 0;
    (d.hours || []).forEach((h, i) => s.hours[i] += h || 0);
    for (const [k, v] of Object.entries(d.paths || {})) { bump(s.paths, k, v.views); bump(s.pathsV, k, v.visitors); }
    for (const f of ['referrers', 'utm', 'devices', 'countries']) for (const [k, v] of Object.entries(d[f] || {})) bump(s[f], k, v);
    for (const [k, v] of Object.entries(d.events || {})) { const e = s.events[k] || (s.events[k] = { n: 0, visitors: 0 }); e.n += v.n || 0; e.visitors += v.visitors || 0; }
    for (const k of Object.keys(s.sales)) s.sales[k] += (d.sales || {})[k] || 0;
    s.certs.n += (d.certs || {}).n || 0; s.certs.value += (d.certs || {}).value || 0;
    s.floorplans.n += (d.floorplans || {}).n || 0; s.floorplans.value += (d.floorplans || {}).value || 0;
  }
  s.revenue = Math.round(s.revenue * 100) / 100; s.certs.value = Math.round(s.certs.value * 100) / 100;
  return s;
}
const people = (s, name) => { const e = s.events[name]; return e ? (e.visitors || e.n) : 0; };
const money = n => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// The card at the top of /admin.
function summaryHTML(esc){
  if (!DIR) return '';
  const t = sum(load(1)), w = sum(load(7));
  return `<a class="news stats" href="/admin/analytics">📈 <span>Visits and sales: today <b>${t.visitors}</b> visitor${t.visitors === 1 ? '' : 's'}, 7 days <b>${w.visitors}</b>, <b>${w.sales.link}</b> report${w.sales.link === 1 ? '' : 's'} sold</span><span class="open">Open ›</span></a>`;
}

function mountAdmin(app, a){
  const { esc, requireAdmin } = a;
  const PERIODS = { 1: 'Today', 7: '7 days', 30: '30 days', 90: '90 days' };
  const EVENT_LABEL = { sign_page: 'Opened a sign-off link', sign_off: 'Signed a report (tenant sign-off)', contact_message: 'Sent a message (contact form)', certificate_booking: 'Booked certificates', downloaded: 'Downloaded or shared the PDF' };
  let regionName = c => c; try { const dn = new Intl.DisplayNames(['en-GB'], { type: 'region' }); regionName = c => { try { return dn.of(c) || c; } catch (e) { return c; } }; } catch (e) {}

  // Bar chart as inline SVG; drawn twice, wide and narrow (phones), so its text stays a readable size.
  function chart(series, labels, title, W = 720){
    const H = W < 500 ? 230 : 220, L = 34, R = 8, T = 14, B = 26, max = Math.max(1, ...series.map(x => x.v));
    const step = max <= 5 ? 1 : Math.ceil(max / 4 / Math.pow(10, Math.floor(Math.log10(max / 4)))) * Math.pow(10, Math.floor(Math.log10(max / 4)));
    const top = Math.ceil(max / step) * step, y = v => T + (H - T - B) * (1 - v / top), slot = (W - L - R) / series.length, bw = Math.max(2, Math.min(28, slot - 2));
    let g = '';
    for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const every = Math.ceil(series.length / (W < 500 ? 5 : 8));
    const bars = series.map((s, i) => {
      const x = L + i * slot + (slot - bw) / 2, h = Math.max(0, y(0) - y(s.v)), r = Math.min(4, bw / 2, h);
      const path = h ? `M${x},${y(0)}V${y(0) - h + r}Q${x},${y(0) - h} ${x + r},${y(0) - h}H${x + bw - r}Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + r}V${y(0)}Z` : '';
      return `<g class="bar"><title>${esc(s.label)}: ${s.v} visitor${s.v === 1 ? '' : 's'}</title><rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}"/>${path ? `<path d="${path}"/>` : ''}</g>`
        + (i % every === 0 && labels[i] ? `<text class="ax" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(labels[i])}</text>` : '');
    }).join('');
    return `<svg class="${W < 500 ? 'narrow' : 'wide'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}<line class="base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${bars}</svg>`;
  }
  function list(obj, total, fmt, n = 10){
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
    if (!rows.length) return '<p class="sub">Nothing yet.</p>';
    const max = rows[0][1] || 1;
    return '<ul class="top">' + rows.map(([k, v]) => `<li><span class="k">${fmt ? fmt(k) : esc(k)}</span><span class="v">${v}${total ? ` <small>${Math.round(v / total * 100)}%</small>` : ''}</span><i style="width:${Math.max(2, v / max * 100)}%"></i></li>`).join('') + '</ul>';
  }

  app.get('/admin/analytics', requireAdmin, (req, res) => {
    const n = PERIODS[req.query.days] ? Number(req.query.days) : 7, days = load(n), s = sum(days);
    const fmtDay = k => new Date(k + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const chartHTML = [720, 360].map(W => n === 1
      ? chart(s.hours.map((v, h) => ({ v, label: String(h).padStart(2, '0') + ':00' })), s.hours.map((v, h) => String(h).padStart(2, '0')), 'New visitors by hour today', W)
      : chart(days.map(d => ({ v: d.visitors || 0, label: fmtDay(d.day) })), days.map(d => fmtDay(d.day)), 'Visitors per day', W)).join('');
    const sold = s.sales.link, appVisitors = s.pathsV['/app'] || 0;
    const steps = [
      ['Visited the website', s.visitors],
      ['Opened the app', Math.max(people(s, 'app_open'), appVisitors)],
      ['Started a report', people(s, 'report_started')],
      ['Took the first photo', people(s, 'first_photo')],
      ['Finished (signed and declared)', people(s, 'report_finished')],
      ['Clicked Pay £30', people(s, 'pay_click')],
      ['Unlocked the report', people(s, 'unlocked')],
      ['Report sold', sold],
    ];
    const funnel = steps.map(([label, v], i) => {
      const prev = i ? steps[i - 1][1] : 0, pct = i && prev ? Math.round(v / prev * 100) + '%' : i ? '—' : '';
      return `<tr><td>${esc(label)}</td><td class="n">${v}</td><td class="n">${pct}</td><td class="bar"><i style="width:${s.visitors ? Math.max(v ? 1 : 0, v / s.visitors * 100) : 0}%"></i></td></tr>`;
    }).join('');
    const others = ['downloaded', 'sign_page', 'sign_off', 'contact_message', 'certificate_booking'].map(k => `<li><span class="k">${esc(EVENT_LABEL[k])}</span><span class="v">${people(s, k)}</span></li>`).join('')
      + `<li><span class="k">Bought a floor plan <small>${money(Math.round(s.floorplans.value * 100) / 100)}</small></span><span class="v">${s.floorplans.n}</span></li>`;
    const pages = Object.fromEntries(Object.entries(s.paths));
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Visits and sales</title><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><meta name="apple-mobile-web-app-title" content="Reports">
<style>
  :root { --ink:#0F172A; --soft:#475569; --faint:#8A96A8; --line:#E4E8EF; --bg:#F4F5FB; --card:#fff; --chip:#F1F3F7; --accent:#4F46E5; --accent-soft:#EEF0FF; --accent-ink:#3730A3; --bar:#4F46E5; --bar-hover:#3730A3; --good:#15803D; }
  @media (prefers-color-scheme: dark) { :root { --ink:#E7E9F3; --soft:#A3ABC2; --faint:#7C859E; --line:#2A2F45; --bg:#0D1020; --card:#161A2E; --chip:#20253D; --accent:#8B8CF8; --accent-soft:#25285A; --accent-ink:#C7C8FF; --bar:#8B8CF8; --bar-hover:#B4B5FF; --good:#4ADE80; } }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  main { max-width:1100px; margin:0 auto; padding:24px 16px 60px; }
  a { color:var(--accent); } .back { display:inline-block; font-size:14px; font-weight:600; text-decoration:none; margin-bottom:10px; }
  h1 { font-size:28px; margin:0 0 4px; letter-spacing:-.03em; font-weight:800; } h2 { font-size:16px; margin:0 0 10px; letter-spacing:-.01em; }
  .lead, .sub { color:var(--soft); } .lead { margin:0 0 16px; } .sub { font-size:12.5px; margin:4px 0 0; }
  .periods { display:inline-flex; background:var(--card); border-radius:999px; padding:4px; box-shadow:0 0 0 1px var(--line); margin-bottom:18px; max-width:100%; overflow-x:auto; }
  .periods a { padding:7px 14px; border-radius:999px; text-decoration:none; color:var(--soft); font-weight:600; font-size:14px; white-space:nowrap; }
  .periods a.on { background:linear-gradient(135deg,#4F46E5,#7C3AED); color:#fff; }
  .tiles { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; margin-bottom:14px; }
  .tile, .card { background:var(--card); border-radius:18px; padding:14px 16px; box-shadow:0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06); min-width:0; }
  .tile .l { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); font-weight:700; } .tile .v { font-size:30px; font-weight:800; letter-spacing:-.03em; margin-top:2px; } .tile .sub { margin:0; }
  .grid2 { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; margin-bottom:12px; } .card { margin-bottom:12px; } .grid2 .card { margin:0; }
  svg { width:100%; height:auto; display:block; } svg.narrow { display:none; } svg .grid { stroke:var(--line); stroke-width:1; } svg .base { stroke:var(--faint); stroke-width:1; }
  svg .ax { fill:var(--faint); font-size:11px; } svg .bar path { fill:var(--bar); } svg .bar .hit { fill:transparent; } svg .bar:hover path { fill:var(--bar-hover); } svg .bar:hover .hit { fill:var(--chip); opacity:.6; }
  table { width:100%; border-collapse:collapse; } th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); padding:8px 6px; border-bottom:1px solid var(--line); }
  td { padding:9px 6px; border-bottom:1px solid var(--line); } tr:last-child td { border-bottom:none; } td.n, th.n { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; } td.n:nth-child(2) { font-weight:700; }
  td.bar { width:34%; } td.bar i { display:block; height:10px; border-radius:0 4px 4px 0; background:var(--bar); min-width:0; }
  .top { list-style:none; margin:0; padding:0; } .top li { position:relative; display:flex; justify-content:space-between; gap:10px; padding:7px 8px; margin:2px 0; border-radius:8px; overflow:hidden; }
  .top li i { position:absolute; left:0; top:0; bottom:0; background:var(--accent-soft); z-index:0; border-radius:8px; } .top .k, .top .v { position:relative; z-index:1; } .top .k { overflow-wrap:anywhere; min-width:0; } .top .v { font-weight:700; white-space:nowrap; font-variant-numeric:tabular-nums; } .top small { color:var(--soft); font-weight:500; }
  .plain li i { display:none; }
  @media (max-width:760px) { .tiles { grid-template-columns:repeat(2, minmax(0, 1fr)); } .grid2 { grid-template-columns:1fr; } .tile .v { font-size:25px; } th.bar, td.bar { display:none; } h1 { font-size:24px; } svg.wide { display:none; } svg.narrow { display:block; } }
</style></head><body><main>
<a class="back" href="/admin">‹ Reports</a>
<h1>Visits and sales</h1>
<p class="lead">Counted on this server, without cookies and without keeping IP addresses. Robots and your own visits while signed in here aren’t counted.</p>
<nav class="periods" aria-label="Period">${Object.entries(PERIODS).map(([k, l]) => `<a href="/admin/analytics?days=${k}"${Number(k) === n ? ' class="on" aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
<div class="tiles">
  <div class="tile"><div class="l">Visitors</div><div class="v">${s.visitors}</div><p class="sub">${s.views} page view${s.views === 1 ? '' : 's'}</p></div>
  <div class="tile"><div class="l">Opened the app</div><div class="v">${steps[1][1]}</div><p class="sub">${people(s, 'report_started')} started a report</p></div>
  <div class="tile"><div class="l">Reports sold</div><div class="v">${sold}</div><p class="sub">${money(s.revenue)}${s.sales.code ? ` · ${s.sales.code} with the access code` : ''}${s.sales.open ? ` · ${s.sales.open} with the paywall off` : ''}</p></div>
  <div class="tile"><div class="l">Certificate bookings</div><div class="v">${s.certs.n}</div><p class="sub">${money(s.certs.value)} requested</p></div>
</div>
<div class="card"><h2>${n === 1 ? 'New visitors by hour today' : 'Visitors per day'}</h2>${chartHTML}<p class="sub">${n === 1 ? 'UK time. ' : ''}Hover or tap a bar for its number. A visitor is counted once a day.</p></div>
<div class="card"><h2>Sales funnel</h2><table><thead><tr><th>Step</th><th class="n">People</th><th class="n">From step before</th><th class="bar"></th></tr></thead><tbody>${funnel}</tbody></table>
<p class="sub">People are counted once a day per step, so over several days someone who came back is counted again. “Report sold” is a report stored with a paid link (office links from Fixflow look the same here).</p></div>
<div class="grid2">
  <div class="card"><h2>Top pages</h2>${list(pages, s.views, k => `<a href="${esc(k)}" target="_blank" rel="noopener">${esc(k)}</a>`)}<p class="sub">Page views.</p></div>
  <div class="card"><h2>Where visitors came from</h2>${list(s.referrers, Object.values(s.referrers).reduce((a, b) => a + b, 0))}<p class="sub">Arrivals from another site; “direct” is a typed address, a bookmark or an app that doesn’t say.</p></div>
  <div class="card"><h2>Campaigns (UTM)</h2>${list(s.utm, 0)}<p class="sub">Source / medium / campaign, from links tagged with utm_… .</p></div>
  <div class="card"><h2>Devices</h2>${list(s.devices, s.visitors, k => ({ phone: '📱 Phone', tablet: '📲 Tablet', desktop: '🖥️ Computer' }[k] || esc(k)))}</div>
  <div class="card"><h2>Countries (a guess)</h2>${list(s.countries, s.visitors, k => esc(k === '?' ? 'Not known' : regionName(k)))}<p class="sub">From the browser’s language setting (e.g. English, UK), not from location.</p></div>
  <div class="card"><h2>Other actions</h2><ul class="top plain">${others}</ul></div>
</div>
</main></body></html>`);
  });
}

module.exports = { mount, mountAdmin, track, summaryHTML, CLIENT_EVENTS };
