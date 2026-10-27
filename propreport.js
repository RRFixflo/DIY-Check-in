// Free landlord property report: /property-report. Enter a postcode (and pick the address) and see what public
// UK data says about the property and the street, free and straight away: the EPC (rating, expiry, the letting
// minimum), recent sold prices (HM Land Registry), crime within a mile (data.police.uk), flood warning areas
// (Environment Agency), the council, a compliance checklist and a yield calculator. The full PDF report is given
// for a name, email and phone (a lead for the owner: /admin "📊 Property report leads", an ntfy alert), with a
// rent valuation sent by the owner afterwards.
// Every source is free and open, needs no key, and is asked separately with a timeout: one that fails or is
// slow leaves its section as "not available right now" and the rest still shows. Answers are cached per
// postcode for 12 hours. Base URLs can be pointed at a mock for tests (PR_*_BASE, EPC_WEB_BASE).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const epcweb = require('./epcweb');

const env = k => (process.env[k] || '').trim().replace(/\/+$/, '');
const BASE = {
  postcodes: () => env('PR_POSTCODES_BASE') || 'https://api.postcodes.io',
  police: () => env('PR_POLICE_BASE') || 'https://data.police.uk/api',
  flood: () => env('PR_FLOOD_BASE') || 'https://environment.data.gov.uk/flood-monitoring',
  lr: () => env('PR_LR_BASE') || 'https://landregistry.data.gov.uk',
};
const UA = { 'User-Agent': 'DIY Inventory property report (diyinventory.co.uk)' };
const PC_RE = /^([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})$/;
const normPc = v => { const t = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const m = PC_RE.exec(t.length > 3 ? t.slice(0, -3) + ' ' + t.slice(-3) : t); return m ? m[1] + ' ' + m[2] : ''; };
const PTYPE = { detached: 'Detached', 'semi-detached': 'Semi-detached', terraced: 'Terraced', 'flat-maisonette': 'Flat', otherPropertyType: 'Other' };
const CRIME = { 'anti-social-behaviour': 'Anti-social behaviour', 'bicycle-theft': 'Bicycle theft', burglary: 'Burglary', 'criminal-damage-arson': 'Criminal damage and arson', drugs: 'Drugs', 'other-theft': 'Other theft', 'possession-of-weapons': 'Possession of weapons', 'public-order': 'Public order', robbery: 'Robbery', shoplifting: 'Shoplifting', 'theft-from-the-person': 'Theft from the person', 'vehicle-crime': 'Vehicle crime', 'violent-crime': 'Violence and sexual offences', 'other-crime': 'Other crime' };
const RANK = 'ABCDEFG';

async function getJson(url, opts = {}){
  const r = await fetch(url, Object.assign({ headers: Object.assign({ Accept: 'application/json' }, UA, opts.headers || {}), signal: AbortSignal.timeout(opts.timeout || 10000) }, opts.init || {}));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/* ------------------------------------------------------------------ the data */
async function geo(pc){
  const d = await getJson(BASE.postcodes() + '/postcodes/' + encodeURIComponent(pc));
  const r = d && d.result; if (!r) return null;
  return { lat: r.latitude, lon: r.longitude, district: r.admin_district || '', ward: r.admin_ward || '', region: r.region || '', country: r.country || '', constituency: r.parliamentary_constituency || '', outcode: r.outcode || pc.split(' ')[0] };
}
async function nearbyPostcodes(g, pc){
  if (!g || g.lat == null) return [pc];
  const d = await getJson(BASE.postcodes() + '/postcodes?lon=' + g.lon + '&lat=' + g.lat + '&radius=400&limit=25').catch(() => null);
  const list = (d && d.result || []).map(x => x.postcode).filter(Boolean);
  return [pc].concat(list.filter(p => p !== pc)).slice(0, 25);
}
// The EPC for the address picked (or every certificate at the postcode), plus what the certificate page adds.
async function epc(pc, picked){
  const list = await epcweb.search(pc);
  // The picked address is one of these labels (the postcode lookup reads the same register), so match it closely.
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''), want = norm(picked);
  const hit = want ? list.find(x => norm(x.address) === want) || list.find(x => norm(x.address).startsWith(want) || want.startsWith(norm(x.address))) : (list.length === 1 ? list[0] : null);
  const out = { all: list.slice(0, 60).map(x => ({ address: x.address, rating: x.rating, expires: x.expires, expired: x.expired, link: x.link })), cert: null };
  if (hit) {
    out.cert = Object.assign({}, hit);
    try {   // The certificate page: floor area, potential rating and property type, read where the page has them.
      const r = await fetch((env('EPC_WEB_BASE') || 'https://find-energy-certificate.service.gov.uk') + '/energy-certificate/' + encodeURIComponent(hit.reference), { headers: Object.assign({ Accept: 'text/html' }, UA), signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const t = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
        const area = /total floor area[^0-9]{0,40}([\d,.]+)\s*(?:square metres|m²|m2)/i.exec(t); if (area) out.cert.floorArea = parseFloat(area[1].replace(/,/g, ''));
        const pot = /potential (?:energy )?(?:efficiency )?rating (?:is |of )?([A-G])\b/i.exec(t) || /could be ([A-G])\b/i.exec(t); if (pot) out.cert.potential = pot[1].toUpperCase();
        const typ = /property type\s+([A-Za-z -]{3,40}?)\s+(?:total floor area|floor area)/i.exec(t); if (typ) out.cert.propertyType = typ[1].trim();
      }
    } catch (e) {}
  }
  return out;
}
// HM Land Registry Price Paid: sales at this postcode and those around it, last 5 years.
async function sales(postcodes){
  const since = (new Date().getFullYear() - 5) + '-01-01';
  const q = `PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?pc ?paon ?saon ?street ?amount ?date ?ptype ?estate ?newbuild WHERE {
  VALUES ?pc { ${postcodes.map(p => JSON.stringify(p)).join(' ')} }
  ?addr lrcommon:postcode ?pc .
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date .
  OPTIONAL { ?tx lrppi:propertyType ?ptype } OPTIONAL { ?tx lrppi:estateType ?estate } OPTIONAL { ?tx lrppi:newBuild ?newbuild }
  OPTIONAL { ?addr lrcommon:paon ?paon } OPTIONAL { ?addr lrcommon:saon ?saon } OPTIONAL { ?addr lrcommon:street ?street }
  FILTER (?date >= "${since}"^^xsd:date)
} ORDER BY DESC(?date) LIMIT 300`;
  const r = await fetch(BASE.lr() + '/landregistry/query', { method: 'POST', headers: Object.assign({ Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, UA),
    body: 'query=' + encodeURIComponent(q), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json(), v = (b, k) => b[k] ? b[k].value : '';
  const rows = ((d.results || {}).bindings || []).map(b => ({ postcode: v(b, 'pc'), address: [v(b, 'saon'), [v(b, 'paon'), v(b, 'street')].filter(Boolean).join(' ')].filter(Boolean).join(', ').replace(/\b([A-Z])([A-Z']+)\b/g, (m, a, z) => a + z.toLowerCase()),
    price: parseInt(v(b, 'amount'), 10) || 0, date: v(b, 'date').slice(0, 10), type: PTYPE[v(b, 'ptype').split('/').pop()] || '', tenure: /leasehold/.test(v(b, 'estate')) ? 'Leasehold' : /freehold/.test(v(b, 'estate')) ? 'Freehold' : '', newBuild: v(b, 'newbuild') === 'true' })).filter(x => x.price > 0);
  const recent = rows.filter(x => x.date >= (new Date().getFullYear() - 3) + '-01-01');
  const byType = {}; recent.forEach(x => { if (x.type) (byType[x.type] = byType[x.type] || []).push(x.price); });
  const byYear = {}; rows.forEach(x => { const y = x.date.slice(0, 4); (byYear[y] = byYear[y] || []).push(x.price); });
  return { rows: rows.slice(0, 40), count: rows.length, median3: median(recent.map(x => x.price)), recentCount: recent.length,
    byType: Object.keys(byType).map(t => ({ type: t, median: median(byType[t]), n: byType[t].length })).sort((a, b) => b.n - a.n),
    byYear: Object.keys(byYear).sort().map(y => ({ year: y, median: median(byYear[y]), n: byYear[y].length })) };
}
// data.police.uk: street-level crime within a mile, the last 3 months published.
async function crime(g){
  if (!g || g.lat == null) return null;
  const dates = await getJson(BASE.police() + '/crimes-street-dates');
  const months = (dates || []).map(x => x.date).filter(Boolean).sort().reverse().slice(0, 3);
  const per = await Promise.all(months.map(m => getJson(BASE.police() + '/crimes-street/all-crime?lat=' + g.lat + '&lng=' + g.lon + '&date=' + m, { timeout: 12000 }).then(a => a || []).catch(() => null)));
  if (per.every(x => x === null)) throw new Error('no data');
  const cats = {}, streets = {}; let total = 0, got = 0;
  per.forEach(list => { if (!list) return; got++; list.forEach(c => { total++; cats[c.category] = (cats[c.category] || 0) + 1; const s = c.location && c.location.street && c.location.street.name; if (s) streets[s] = (streets[s] || 0) + 1; }); });
  return { months: months.filter((m, i) => per[i]), total, perMonth: got ? Math.round(total / got) : 0,
    cats: Object.keys(cats).map(k => ({ name: CRIME[k] || k, n: cats[k] })).sort((a, b) => b.n - a.n), streets: Object.keys(streets).map(k => ({ name: k, n: streets[k] })).sort((a, b) => b.n - a.n).slice(0, 5) };
}
// Environment Agency: flood warning and alert areas near the property, and any flood warnings in force now.
async function flood(g){
  if (!g || g.lat == null) return null;
  const [areas, now] = await Promise.all([
    getJson(BASE.flood() + '/id/floodAreas?lat=' + g.lat + '&long=' + g.lon + '&dist=1'),
    getJson(BASE.flood() + '/id/floods?lat=' + g.lat + '&long=' + g.lon + '&dist=2').catch(() => null)]);
  const items = (areas && areas.items || []).map(a => ({ label: a.label || a.notation || '', river: a.riverOrSea || '', kind: /w$/i.test(String(a.notation || '')) || /warning/i.test(a.label || '') ? 'warning' : 'alert' }));
  return { areas: items.slice(0, 8), count: items.length, warnings: (now && now.items || []).map(w => ({ area: w.description || (w.floodArea && w.floodArea.label) || '', severity: w.severity || '', message: w.message || '' })).slice(0, 5) };
}
function compliance(country, cert){
  const eng = country === 'England', wales = country === 'Wales', scot = country === 'Scotland', ni = country === 'Northern Ireland';
  const r = cert && cert.rating ? RANK.indexOf(cert.rating) : -1;
  const epcOk = r < 0 ? null : r <= RANK.indexOf('E');
  return [
    { k: 'epc', t: 'Energy Performance Certificate (EPC)', d: cert ? (cert.expired ? 'The certificate has expired: you need a new one before letting or selling.' : 'Rated ' + cert.rating + (cert.expires ? ', valid until ' + cert.expires.split('-').reverse().join('/') : '') + '. ' + (epcOk === false ? 'Below E: it can’t be let until it is improved (or an exemption is registered).' : 'A property must be rated E or above to be let in England and Wales; the government has proposed raising this to C.')) : 'No certificate found for this address. You need one before you let or sell.', status: !cert || cert.expired || epcOk === false ? 'act' : 'ok', svc: 'epc' },
    { k: 'gas', t: 'Gas Safety certificate (CP12)', d: 'If there is a gas supply: checked every 12 months by a Gas Safe registered engineer, with a copy to the tenant.', status: 'check', svc: 'gas' },
    { k: 'eicr', t: 'Electrical safety report (EICR)', d: (scot ? 'Every 5 years in Scotland.' : 'Every 5 years') + ', with a copy to the tenant and any remedial work done within 28 days.', status: 'check', svc: 'eicr' },
    { k: 'alarms', t: 'Smoke and carbon monoxide alarms', d: eng ? 'A smoke alarm on every storey and a carbon monoxide alarm in any room with a fixed combustion appliance (not gas cookers), checked on the first day of each tenancy.' : 'Working smoke and carbon monoxide alarms, as required where the property is.', status: 'check' },
    { k: 'deposit', t: 'Deposit protection', d: scot ? 'Protected in an approved scheme within 30 working days.' : 'Protected in a government-approved scheme (DPS, TDS or mydeposits) within 30 days, with the prescribed information given to the tenant.', status: 'check' },
    ...(eng ? [{ k: 'rtr', t: 'Right to Rent checks', d: 'Check every adult tenant’s right to rent in the UK before the tenancy starts, and keep copies.', status: 'check' }] : []),
    ...(wales ? [{ k: 'rsw', t: 'Rent Smart Wales', d: 'Landlords must be registered, and whoever manages the property licensed, with Rent Smart Wales.', status: 'check' }] : []),
    ...(scot ? [{ k: 'reg', t: 'Landlord registration', d: 'Landlords in Scotland must be registered with the local council.', status: 'check' }] : []),
    ...(ni ? [{ k: 'reg', t: 'Landlord registration', d: 'Landlords in Northern Ireland must register with the Landlord Registration Scheme.', status: 'check' }] : []),
    { k: 'licence', t: 'Property licence', d: 'Some councils need a licence for every rented home (selective licensing), and all large HMOs need one. Check with the council.', status: 'check' },
    { k: 'inventory', t: 'Check-in inventory', d: 'A signed inventory with dated photos is the evidence you need if there is ever a deposit dispute.', status: 'check', svc: 'inventory' },
  ];
}

/* ------------------------------------------------------------------ mount */
// After each start, one quiet check of every public source with a sample postcode, logged, so a source that
// blocks the server (or changed its format) shows up in the logs before anyone uses the report.
async function selfTest(){
  const pc = 'SE1 7PB', out = [];
  const t = async (name, fn) => { try { const v = await fn(); out.push(name + ' ' + v); } catch (e) { out.push(name + ' FAILED ' + (e && e.message)); } };
  let g = null;
  await t('postcodes', async () => { g = await geo(pc); return g ? 'ok' : 'empty'; });
  await t('epc', async () => { const n = []; for (const x of ['SW11 6QS', 'M14 5RX', 'BS6 5JX']) n.push(x + ' ' + (await epcweb.search(x)).length); return n.join(', '); });
  await t('police', async () => { const c = await crime(g); return c ? c.total + ' crimes' : 'empty'; });
  await t('flood', async () => { const f = await flood(g); return f ? f.count + ' areas' : 'empty'; });
  await t('land registry', async () => (await sales([pc])).count + ' sales');
  // How the Land Registry answers other ways of asking, to pick one that isn't refused.
  const q = 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 1', u = BASE.lr() + '/landregistry/query';
  const tries = [['GET', u + '?query=' + encodeURIComponent(q), { Accept: 'application/sparql-results+json' }],
    ['GET browser', u + '?query=' + encodeURIComponent(q) + '&output=json', { Accept: 'application/sparql-results+json,application/json;q=0.9,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (compatible; DIYInventory/1.0; +https://diyinventory.co.uk)' }],
    ['ppd csv', BASE.lr() + '/app/ppd/ppd_data.csv?postcode=' + encodeURIComponent(pc) + '&limit=1', { Accept: 'text/csv' }]];
  for (const [name, url, headers] of tries) { try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) }); out.push('lr ' + name + ' HTTP ' + r.status + (r.headers.get('server') ? ' (' + r.headers.get('server') + ')' : '')); } catch (e) { out.push('lr ' + name + ' ' + e.message); } }
  console.log('property report sources: ' + out.join(' | '));
}

function mount(app, ctx){
  if (!process.env.PR_SELFTEST_OFF) setTimeout(() => selfTest().catch(() => {}), 60 * 1000).unref();
  const { REPORTS_DIR, renderPage, esc, clientIp, limiter, notify, addAdminSection, isOwner, PUBLIC_BASE, track } = ctx;
  const DIR = path.join(REPORTS_DIR, 'property-reports'); fs.mkdirSync(DIR, { recursive: true });
  const LEADS = path.join(DIR, 'leads.json');
  const readLeads = () => { try { return JSON.parse(fs.readFileSync(LEADS, 'utf8')); } catch (e) { return { seenAt: '', list: [] }; } };
  const writeLeads = d => { fs.writeFileSync(LEADS + '.tmp', JSON.stringify(d)); fs.renameSync(LEADS + '.tmp', LEADS); };
  const lookLimit = limiter(40, 3600 * 1000), leadLimit = limiter(10, 3600 * 1000);
  const cache = new Map();
  const settle = (p, ms) => Promise.race([p.then(v => ({ ok: true, v }), e => ({ ok: false, e: e && e.message })), new Promise(r => setTimeout(() => r({ ok: false, e: 'timeout' }), ms))]);

  async function gather(pc, picked){
    const key = pc + '|' + picked, hit = cache.get(key);
    if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.data;
    const g = await settle(geo(pc), 8000);
    const G = g.ok ? g.v : null;
    const [E, S, C, F] = await Promise.all([settle(epc(pc, picked), 20000), settle(nearbyPostcodes(G, pc).then(sales), 20000), settle(crime(G), 20000), settle(flood(G), 12000)]);
    ['epc', 'sales', 'crime', 'flood'].forEach((n, i) => { const x = [E, S, C, F][i]; if (!x.ok) console.error('property report: ' + n + ' for ' + pc + ' failed: ' + x.e); });
    if (!g.ok) console.error('property report: postcode lookup for ' + pc + ' failed: ' + g.e);
    const data = { postcode: pc, picked, at: new Date().toISOString(), geo: G, epc: E.ok ? E.v : null, sales: S.ok ? S.v : null, crime: C.ok ? C.v : null, flood: F.ok ? F.v : null };
    data.checklist = compliance(G && G.country, data.epc && data.epc.cert);
    if (G || data.epc || data.sales) { cache.set(key, { at: Date.now(), data }); if (cache.size > 500) cache.delete(cache.keys().next().value); }
    return data;
  }

  const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
  const fmtD = s => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  const monthName = m => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const na = '<p class="sub">Not available right now. Please try again later.</p>';
  const CSS = `<style>
.pr-hero{background:var(--grad,#1B2E4B);color:#fff;border-radius:22px;padding:22px;margin:0 0 18px}.pr-hero h2{color:#fff;margin:0 0 4px}.pr-hero p{margin:0;opacity:.85}
.pr-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}.pr-tile{background:rgba(255,255,255,.1);border-radius:14px;padding:12px}.pr-tile span{display:block;font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.05em}.pr-tile b{display:block;font-size:22px;margin-top:2px}.pr-tile small{opacity:.8}
.pr-sec{margin:0 0 16px}.pr-sec h2{margin:0 0 8px;font-size:20px}.pr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.pr-t{width:100%;border-collapse:collapse;font-size:14px}.pr-t th,.pr-t td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line,#E4D9C6);vertical-align:top}.pr-t th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft,#5A6475)}
.pr-epc{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:10px;font:800 24px/1 inherit;color:#fff}
.e-A{background:#0f8a4b}.e-B{background:#2aa44f}.e-C{background:#8cc63f}.e-D{background:#f2c200;color:#1B2E4B}.e-E{background:#f5a623}.e-F{background:#e8722c}.e-G{background:#d7263d}
.pr-bar{height:8px;border-radius:99px;background:var(--line,#E4D9C6);overflow:hidden}.pr-bar i{display:block;height:100%;background:var(--accent,#1B2E4B)}
.pr-check li{margin:0 0 10px;list-style:none;padding-left:30px;position:relative}.pr-check li:before{position:absolute;left:0;top:0;font-size:18px}.pr-check li.ok:before{content:'✅'}.pr-check li.act:before{content:'⚠️'}.pr-check li.check:before{content:'☐';font-size:20px;line-height:1}
.pr-lead{border:2px solid var(--accent,#1B2E4B)}.pr-lead form{display:grid;gap:10px;max-width:520px}.pr-lead input,.pr-lead select{width:100%}.pr-yield output{font-size:28px;font-weight:800;display:block}
.pr-search{display:flex;gap:8px;flex-wrap:wrap;max-width:560px;margin:16px auto 0}.pr-search input,.pr-search select,.pr-yield input,.pr-lead input:not([type=checkbox]),.pr-lead select{font:inherit;font-size:16px;padding:12px 14px;border-radius:12px;border:1px solid var(--line,#E4D9C6);background:var(--card,#fff);color:inherit;box-sizing:border-box;width:100%}.pr-search input{flex:1 1 200px;width:auto}.pr-search input{flex:1 1 200px}.pr-note{font-size:13px;color:var(--ink-soft,#5A6475)}</style>`;

  function searchForm(pc){
    return `<form class="pr-search" method="get" action="/property-report" id="prForm"><input name="postcode" required maxlength="10" placeholder="Postcode, e.g. SE1 3JQ" value="${esc(pc || '')}" autocomplete="off" aria-label="Postcode"><button class="btn primary">Get the report</button>
<select name="address" id="prAddr" style="display:none;flex-basis:100%" aria-label="Address"><option value="">Pick the address (optional)</option></select></form>
<script>(function(){var f=document.getElementById('prForm'),i=f.postcode,s=document.getElementById('prAddr'),t;function go(){var v=i.value.trim();if(!/^[A-Za-z]{1,2}\\d[A-Za-z\\d]?\\s*\\d[A-Za-z]{2}$/.test(v))return;fetch('/api/address/'+encodeURIComponent(v)).then(function(r){return r.ok?r.json():null}).then(function(d){if(!d||!d.addresses||!d.addresses.length)return;s.innerHTML='<option value="">Pick the address (optional)</option>'+d.addresses.map(function(a){var o=document.createElement('option');o.value=a.label;o.textContent=a.label;return o.outerHTML}).join('');s.style.display='block'}).catch(function(){})}i.addEventListener('input',function(){clearTimeout(t);t=setTimeout(go,500)});if(i.value)go()})();</script>`;
  }

  function resultsHTML(d){
    const cert = d.epc && d.epc.cert, s = d.sales, c = d.crime, f = d.flood, g = d.geo;
    const typeMedian = s && s.byType.length ? s.byType[0] : null;
    const tiles = [
      ['EPC', cert ? cert.rating + (cert.potential ? ' → ' + cert.potential : '') : d.epc ? (d.epc.all.length ? 'Pick address' : 'None found') : '—', cert ? (cert.expired ? 'Expired' : 'Until ' + fmtD(cert.expires)) : ''],
      ['Typical price', s && s.median3 ? gbp(s.median3) : '—', s && s.recentCount ? s.recentCount + ' sales, 3 years' : ''],
      ['Crime, 1 mile', c ? c.perMonth + '/month' : '—', c && c.cats[0] ? 'Most: ' + c.cats[0].name.toLowerCase() : ''],
      ['Flood areas', f ? (f.count ? f.count + ' nearby' : 'None nearby') : '—', f && f.warnings.length ? f.warnings.length + ' warning(s) now' : 'Within 1 km'],
    ];
    const epcSec = !d.epc ? na : cert ? `<div style="display:flex;gap:14px;align-items:center"><span class="pr-epc e-${esc(cert.rating)}">${esc(cert.rating)}</span><div><b>${esc(cert.address)}</b><br><span class="sub">${cert.expired ? 'Expired' : 'Valid until ' + esc(fmtD(cert.expires))}${cert.potential ? ' · could reach ' + esc(cert.potential) : ''}${cert.floorArea ? ' · ' + esc(cert.floorArea) + ' m²' : ''}${cert.propertyType ? ' · ' + esc(cert.propertyType) : ''}</span></div></div>
<p>${RANK.indexOf(cert.rating) > RANK.indexOf('E') ? '<b>Below the letting minimum (E).</b> The property can’t be let until it’s improved or an exemption is registered.' : RANK.indexOf(cert.rating) > RANK.indexOf('C') ? 'Meets today’s letting minimum (E), but is below C, which the government has proposed as the future minimum.' : 'Already C or better.'} <a href="${esc(cert.link)}" target="_blank" rel="noopener">See the certificate and its recommended improvements</a>.</p>`
      : `<p>${d.epc.all.length ? 'Pick the address above to see its certificate. Certificates at this postcode:' : 'No energy certificates found at this postcode.'}</p>${d.epc.all.length ? `<table class="pr-t"><tr><th>Address</th><th>Rating</th><th>Valid until</th></tr>${d.epc.all.slice(0, 12).map(x => `<tr><td>${esc(x.address)}</td><td><span class="pr-epc e-${esc(x.rating)}" style="width:26px;height:26px;font-size:14px">${esc(x.rating)}</span></td><td>${x.expired ? 'Expired' : esc(fmtD(x.expires))}</td></tr>`).join('')}</table>` : ''}`;
    const maxYear = s ? Math.max(1, ...s.byYear.map(y => y.median)) : 1;
    const salesSec = !s ? na : !s.count ? '<p>No sales recorded around this postcode in the last 5 years.</p>' : `<p>${s.count} sales at and around ${esc(d.postcode)} in the last 5 years. Typical price over the last 3 years: <b>${gbp(s.median3)}</b>.</p>
${s.byType.length ? `<table class="pr-t"><tr><th>Type</th><th>Typical price</th><th>Sales</th></tr>${s.byType.map(t => `<tr><td>${esc(t.type)}</td><td>${gbp(t.median)}</td><td>${t.n}</td></tr>`).join('')}</table>` : ''}
<h3 style="font-size:15px;margin:14px 0 6px">By year</h3>${s.byYear.map(y => `<div style="display:grid;grid-template-columns:44px 1fr 90px;gap:8px;align-items:center;font-size:14px;margin:4px 0"><span>${esc(y.year)}</span><div class="pr-bar"><i style="width:${Math.round(y.median / maxYear * 100)}%"></i></div><span>${gbp(y.median)}</span></div>`).join('')}
<details style="margin-top:12px"><summary>Recent sales</summary><table class="pr-t"><tr><th>Date</th><th>Address</th><th>Price</th></tr>${s.rows.slice(0, 20).map(x => `<tr><td>${esc(fmtD(x.date))}</td><td>${esc(x.address)}<br><span class="sub">${esc([x.type, x.tenure, x.newBuild ? 'New build' : ''].filter(Boolean).join(' · '))}</span></td><td>${gbp(x.price)}</td></tr>`).join('')}</table></details>`;
    const crimeSec = !c ? na : `<p><b>${c.total}</b> crimes reported within a mile in ${c.months.length} month${c.months.length === 1 ? '' : 's'} (${esc(c.months.map(monthName).reverse().join(', '))}): about <b>${c.perMonth} a month</b>.</p>
<table class="pr-t"><tr><th>Type</th><th>Reports</th></tr>${c.cats.slice(0, 8).map(x => `<tr><td>${esc(x.name)}</td><td>${x.n}</td></tr>`).join('')}</table>${c.streets.length ? `<p class="pr-note">Most reports near: ${esc(c.streets.map(x => x.name.replace(/^On or near /i, '')).join(', '))}. Locations are approximate.</p>` : ''}`;
    const floodSec = !f ? na : `<p>${f.count ? `${f.count} Environment Agency flood warning or alert area${f.count === 1 ? '' : 's'} within 1 km${f.areas.length ? ': ' + esc(f.areas.slice(0, 4).map(a => a.label).join('; ')) : ''}.` : 'No flood warning or alert areas within 1 km.'}${f.warnings.length ? ` <b>${f.warnings.length} flood warning${f.warnings.length === 1 ? '' : 's'} in force now.</b>` : ''}</p><p><a href="https://check-long-term-flood-risk.service.gov.uk/postcode" target="_blank" rel="noopener">Check the long-term flood risk for ${esc(d.postcode)} on GOV.UK</a>.</p>`;
    const area = g ? `<table class="pr-t"><tr><td>Council</td><td><b>${esc(g.district)}</b></td></tr>${g.ward ? `<tr><td>Ward</td><td>${esc(g.ward)}</td></tr>` : ''}<tr><td>Region</td><td>${esc([g.region, g.country].filter(Boolean).join(', '))}</td></tr>${g.constituency ? `<tr><td>Constituency</td><td>${esc(g.constituency)}</td></tr>` : ''}</table><p><a href="https://www.gov.uk/find-local-council" target="_blank" rel="noopener">Check ${esc(g.district)}’s licensing rules</a></p>` : na;
    const checklist = `<ul class="pr-check" style="padding:0;margin:0">${d.checklist.map(x => `<li class="${x.status}"><b>${esc(x.t)}</b><br><span class="sub">${esc(x.d)}</span>${x.svc ? ` <a href="${x.svc === 'inventory' ? '/app' : '/certificates?svc=' + x.svc + '&postcode=' + encodeURIComponent(d.postcode) + '#book'}">${x.svc === 'inventory' ? 'Do it for £30' : 'Book'}</a>` : ''}</li>`).join('')}</ul><p class="pr-note">General information, not legal advice. Rules differ between England, Wales, Scotland and Northern Ireland.</p>`;
    const price = typeMedian ? typeMedian.median : s && s.median3 || 0;
    const yieldCalc = `<div class="pr-yield"><div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>Property price (£)<br><input id="yP" type="number" inputmode="numeric" value="${price || ''}"></label><label>Monthly rent (£)<br><input id="yR" type="number" inputmode="numeric" placeholder="e.g. 1500"></label></div><p style="margin:12px 0 0">Gross yield <output id="yO">—</output><span class="pr-note" id="yN"></span></p></div>
<script>(function(){var p=document.getElementById('yP'),r=document.getElementById('yR'),o=document.getElementById('yO'),n=document.getElementById('yN');function u(){var P=+p.value,R=+r.value;if(P>0&&R>0){var y=R*12/P*100;o.textContent=y.toFixed(1)+'%';n.textContent=' · £'+Math.round(R*12).toLocaleString('en-GB')+' a year'}else{o.textContent='—';n.textContent=''}}p.oninput=r.oninput=u;u()})();</script><p class="pr-note">Don’t know the rent? Ask for the full report below and we’ll send you a rent valuation for this property.</p>`;
    return `<div class="pr-hero"><span class="kicker" style="color:#E8D5B5">Property report</span><h2>${esc(cert ? cert.address : d.picked || d.postcode)}</h2><p>${esc(g ? [g.district, g.country].filter(Boolean).join(', ') : d.postcode)}</p>
<div class="pr-tiles">${tiles.map(t => `<div class="pr-tile"><span>${esc(t[0])}</span><b>${esc(t[1])}</b><small>${esc(t[2])}</small></div>`).join('')}</div></div>
<div class="pr-grid">
<div class="card pr-sec"><h2>Energy (EPC)</h2>${epcSec}</div>
<div class="card pr-sec"><h2>Rental yield</h2>${yieldCalc}</div>
<div class="card pr-sec"><h2>Sold prices nearby</h2>${salesSec}</div>
<div class="card pr-sec"><h2>Crime within a mile</h2>${crimeSec}</div>
<div class="card pr-sec"><h2>Flood risk</h2>${floodSec}</div>
<div class="card pr-sec"><h2>Council and area</h2>${area}</div>
<div class="card pr-sec" style="grid-column:1/-1"><h2>Letting checklist</h2>${checklist}</div>
</div>`;
  }

  function leadForm(d, err, v){
    v = v || {};
    return `<div class="card pr-sec pr-lead" id="full"><h2>Get the full report as a PDF, and a rent valuation</h2><p>Everything above in a PDF to keep or share, plus a rent valuation for this property sent to you by our team. Free.</p>
${err ? `<p class="notice err" style="margin:0 0 10px">${esc(err)}</p>` : ''}
<form method="post" action="/property-report#full"><input type="hidden" name="postcode" value="${esc(d.postcode)}"><input type="hidden" name="address" value="${esc(d.picked || '')}">
<label>Your name<br><input name="name" required maxlength="80" autocomplete="name" value="${esc(v.name || '')}"></label>
<label>Email<br><input name="email" type="email" required maxlength="120" autocomplete="email" value="${esc(v.email || '')}"></label>
<label>Phone<br><input name="phone" type="tel" required maxlength="30" autocomplete="tel" value="${esc(v.phone || '')}"></label>
<label>You are<br><select name="role">${['Landlord', 'Letting agent', 'Buying to let', 'Tenant', 'Other'].map(r => `<option${v.role === r ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="ok" value="1" required style="width:auto;margin-top:4px"> <span>DIY Inventory may contact me about this property (rent valuation, certificates, inventories). See our <a href="/privacy">privacy notice</a>.</span></label>
<input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
<button class="btn primary">Send me the full report</button></form></div>`;
  }

  const page = (req, body, opts = {}) => renderPage({ key: 'report', path: '/property-report', title: opts.title || 'Free landlord property report: EPC, sold prices, crime, flood risk · DIY Inventory', og: 'Free landlord property report',
    desc: 'Free property report for landlords: enter a postcode for the EPC rating and expiry, sold prices nearby, crime within a mile, flood risk, the council, rental yield and a letting checklist. Full PDF and a rent valuation free.',
    head: CSS + (opts.noindex ? '<meta name="robots" content="noindex">' : ''), body, status: opts.status,
    jsonld: b => [{ '@type': 'WebApplication', name: 'Free landlord property report', url: b + '/property-report', applicationCategory: 'BusinessApplication', operatingSystem: 'Any', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' }, provider: { '@id': b + '/#org' } },
      { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] }, req);
  const FAQ = [
    ['Where does the data come from?', 'Public UK data: the EPC register, HM Land Registry Price Paid data, data.police.uk, the Environment Agency and postcodes.io. It’s fetched fresh for each postcode.'],
    ['Is the property report free?', 'Yes. The figures show on screen straight away, and the full PDF and a rent valuation are free for your name, email and phone.'],
    ['Which parts of the UK does it cover?', 'England and Wales fully. Sold prices come from HM Land Registry (England and Wales), flood areas from the Environment Agency (England), and crime from data.police.uk (England, Wales and Northern Ireland).'],
    ['What EPC rating do I need to let a property?', 'In England and Wales a rented home must be rated E or above, unless an exemption is registered. The government has proposed raising the minimum to C.'],
  ];
  const intro = pc => `<div class="page-head"><div class="wrap"><span class="kicker">Free for landlords</span><h1>Free landlord property report</h1><p>Enter a postcode and see the EPC rating and expiry, sold prices nearby, crime within a mile, flood risk, the council, rental yield and what you need to let it. From official public data, in seconds.</p>${searchForm(pc)}</div></div>`;

  app.get(['/property-report', '/property-report/'], async (req, res) => {
    const raw = String(req.query.postcode || '').trim(), picked = String(req.query.address || '').trim().slice(0, 200);
    if (!raw) return res.type('html').send(page(req, intro('') + `<section class="tight"><div class="wrap"><div class="pr-grid">${[['⚡', 'EPC rating and expiry', 'From the official register, with whether it meets the letting minimum and what it could reach.'], ['🏷️', 'Sold prices nearby', 'Every sale at and around the postcode in the last 5 years, by type and by year (HM Land Registry).'], ['📈', 'Rental yield', 'Typical local price and a yield calculator, plus a free rent valuation.'], ['🚓', 'Crime within a mile', 'Reports by type for the latest months (data.police.uk).'], ['🌊', 'Flood risk', 'Environment Agency flood warning areas nearby, and any warnings now.'], ['✅', 'Letting checklist', 'Every certificate and check you need to let it, with booking links.']].map(x => `<div class="card"><h3 style="margin:0 0 6px">${x[0]} ${esc(x[1])}</h3><p class="sub" style="margin:0">${esc(x[2])}</p></div>`).join('')}</div>
<div class="faq" style="margin-top:22px">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></div></section>`));
    const pc = normPc(raw);
    if (!pc) return res.status(400).type('html').send(page(req, intro(raw) + `<section class="tight"><div class="wrap"><p class="notice err">That doesn’t look like a UK postcode. Please check it and try again.</p></div></section>`, { noindex: true, status: 400 }));
    if (!lookLimit(clientIp(req))) return res.status(429).type('html').send(page(req, intro(pc) + `<section class="tight"><div class="wrap"><p class="notice err">Too many reports from your connection. Please try again in an hour.</p></div></section>`, { noindex: true, status: 429 }));
    const d = await gather(pc, picked);
    if (track) track(req, 'property_report_view');
    res.type('html').send(page(req, intro(pc) + `<section class="tight"><div class="wrap">${resultsHTML(d)}${leadForm(d)}</div></section>`, { noindex: true, title: 'Property report for ' + pc + ' · DIY Inventory' }));
  });

  app.post('/property-report', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    const b = req.body || {}, pc = normPc(b.postcode), picked = String(b.address || '').trim().slice(0, 200);
    if (!pc) return res.redirect(303, '/property-report');
    if (b.website) return res.redirect(303, '/property-report?postcode=' + encodeURIComponent(pc));   // a robot
    const v = { name: String(b.name || '').trim().slice(0, 80), email: String(b.email || '').trim().slice(0, 120), phone: String(b.phone || '').trim().slice(0, 30), role: String(b.role || '').slice(0, 30) };
    const d = await gather(pc, picked);
    const err = !v.name ? 'Please enter your name.' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) ? 'Please enter a valid email address.' : (v.phone.replace(/\D/g, '').length < 10) ? 'Please enter a phone number we can call.' : !b.ok ? 'Please tick the box so we can send you the report and valuation.' : '';
    if (err) return res.status(400).type('html').send(page(req, intro(pc) + `<section class="tight"><div class="wrap">${resultsHTML(d)}${leadForm(d, err, v)}</div></section>`, { noindex: true, status: 400 }));
    if (!leadLimit(clientIp(req))) return res.status(429).type('html').send(page(req, intro(pc) + `<section class="tight"><div class="wrap">${leadForm(d, 'Too many requests from your connection. Please try again later.', v)}</div></section>`, { noindex: true, status: 429 }));
    const id = crypto.randomBytes(6).toString('hex'), token = crypto.randomBytes(18).toString('base64url');
    const cert = d.epc && d.epc.cert;
    const lead = Object.assign({ id, token, at: new Date().toISOString(), postcode: pc, address: cert ? cert.address : picked, epc: cert ? cert.rating + (cert.expired ? ' (expired)' : ' until ' + cert.expires) : '', typical: d.sales ? d.sales.median3 : 0, council: d.geo ? d.geo.district : '' }, v);
    try { fs.writeFileSync(path.join(DIR, id + '.pdf'), await buildPdf(d, lead)); fs.writeFileSync(path.join(DIR, id + '.json'), JSON.stringify(d)); } catch (e) { console.error('property report pdf failed:', e.message); }
    const L = readLeads(); L.list.unshift(lead); L.list = L.list.slice(0, 2000); writeLeads(L);
    notify({ title: 'New lead: property report', message: `${v.name} (${v.role}) · ${v.phone} · ${v.email}\n${lead.address || pc}${lead.epc ? ' · EPC ' + lead.epc : ''}\nWants a rent valuation.`, tags: ['house_with_garden'], click: PUBLIC_BASE ? PUBLIC_BASE + '/admin#prleads' : '' });
    if (track) track(req, 'property_report_lead');
    emailReport(lead).catch(() => {});
    res.redirect(303, '/property-report/r/' + id + '-' + token);
  });

  const findLead = s => { const m = /^([a-f0-9]{12})-([\w-]{24})$/.exec(String(s)); if (!m) return null; const l = readLeads().list.find(x => x.id === m[1]); return l && l.token === m[2] ? l : null; };
  app.get('/property-report/r/:key.pdf', (req, res) => {
    const l = findLead(req.params.key); if (!l) return res.status(404).type('text/plain').send('Report not found.');
    res.set({ 'Content-Disposition': 'inline; filename="Property report - ' + String(l.address || l.postcode).replace(/[^\w ,.-]+/g, ' ').slice(0, 100) + '.pdf"', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
    res.type('pdf').sendFile(path.join(DIR, l.id + '.pdf'), e => { if (e && !res.headersSent) res.status(404).type('text/plain').send('Report not found.'); });
  });

  app.get('/property-report/r/:key', (req, res) => {
    const l = findLead(req.params.key); res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    if (!l) return res.status(404).type('html').send(page(req, intro('') + '<section class="tight"><div class="wrap"><p class="notice err">That report link isn’t valid.</p></div></section>', { noindex: true, status: 404 }));
    res.type('html').send(page(req, `<div class="page-head"><div class="wrap"><span class="kicker">Your property report</span><h1>Thanks, ${esc(l.name.split(' ')[0])}</h1><p>Your full report for <b>${esc(l.address || l.postcode)}</b> is ready. We’ll be in touch with a rent valuation for the property.</p>
<p style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn primary" href="/property-report/r/${esc(req.params.key)}.pdf">⬇ Download the PDF</a><a class="btn ghost" href="/property-report?postcode=${encodeURIComponent(l.postcode)}&address=${encodeURIComponent(l.address || '')}">Back to the report</a></p></div></div>
<section class="tight"><div class="wrap"><div class="pr-grid"><div class="card"><h3 style="margin-top:0">Track it for free</h3><p>Add the property to a free landlord dashboard: EPC, Gas Safety and EICR reminders, rent and receipts.</p><a class="btn" href="/landlords">Free landlord dashboard</a></div>
<div class="card"><h3 style="margin-top:0">Letting it soon?</h3><p>Do the check-in inventory yourself on your phone, with dated photos, for £30.</p><a class="btn" href="/app">Start free</a></div>
<div class="card"><h3 style="margin-top:0">Certificates</h3><p>Book a Gas Safety certificate, EICR or EPC at a fixed price.</p><a class="btn" href="/certificates">Landlord services</a></div></div></div></section>`, { noindex: true, title: 'Your property report · DIY Inventory' }));
  });
  async function emailReport(l){
    const key = env('RESEND_API_KEY'); if (!key) return;
    const from = env('REPORT_FROM_EMAIL') || 'DIY Inventory <onboarding@resend.dev>';
    let pdf = null; try { pdf = fs.readFileSync(path.join(DIR, l.id + '.pdf')).toString('base64'); } catch (e) {}
    const link = (PUBLIC_BASE || '') + '/property-report/r/' + l.id + '-' + l.token;
    const r = await fetch((env('RESEND_API_BASE') || 'https://api.resend.com') + '/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ from, to: [l.email], subject: 'Your property report: ' + (l.address || l.postcode),
        text: `Hi ${l.name.split(' ')[0]},\n\nYour property report for ${l.address || l.postcode} is attached${PUBLIC_BASE ? ', and you can see it again here: ' + link : ''}.\n\nWe'll be in touch with a rent valuation for the property.\n\nDIY Inventory`,
        attachments: pdf ? [{ filename: 'Property report.pdf', content: pdf }] : undefined }) });
    if (!r.ok) console.error('property report email failed: HTTP ' + r.status);
  }

  /* ------------------------------------------------------------------ the PDF (A4 portrait) */
  async function buildPdf(d, lead){
    const doc = await PDFDocument.create(); doc.setTitle('Property report: ' + (lead.address || d.postcode)); doc.setAuthor('DIY Inventory');
    const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold), T = await doc.embedFont(StandardFonts.TimesRomanBold);
    const W = 595.28, H = 841.89, M = 40, navy = rgb(27 / 255, 46 / 255, 75 / 255), soft = rgb(90 / 255, 100 / 255, 117 / 255), line = rgb(0.86, 0.82, 0.75), camel = rgb(196 / 255, 154 / 255, 108 / 255), paper = rgb(245 / 255, 239 / 255, 228 / 255);
    const EC = { A: [15, 138, 75], B: [42, 164, 79], C: [140, 198, 63], D: [242, 194, 0], E: [245, 166, 35], F: [232, 114, 44], G: [215, 38, 61] };
    const safe = s => String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/→/g, '->').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    const wrap = (s, font, size, w) => { const out = []; let cur = ''; safe(s).split(/\s+/).forEach(word => { const t = cur ? cur + ' ' + word : word; if (font.widthOfTextAtSize(t, size) <= w) cur = t; else { if (cur) out.push(cur); cur = word; } }); if (cur) out.push(cur); return out; };
    let pg, y; const pages = [];
    const np = () => { pg = doc.addPage([W, H]); pages.push(pg); y = H - M; };
    const tx = (s, x, yy, f, sz, c) => pg.drawText(safe(s), { x, y: yy, font: f, size: sz, color: c || navy });
    const need = h => { if (y - h < 60) np(); };
    const para = (s, sz = 9.5, c = soft) => wrap(s, F, sz, W - 2 * M).forEach(l => { need(14); tx(l, M, y, F, sz, c); y -= sz + 4; });
    const head = s => { need(50); y -= 10; pg.drawRectangle({ x: M, y: y - 4, width: 3, height: 18, color: navy }); tx(s, M + 10, y, T, 16); y -= 24; };
    const rows = (list, cols) => { list.forEach(r => { need(16); r.forEach((c, i) => tx(String(c).slice(0, 70), M + cols[i], y, i ? F : B, 9, i ? soft : navy)); y -= 14; pg.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.4, color: line }); }); y -= 4; };
    np();
    pg.drawRectangle({ x: 0, y: H - 190, width: W, height: 190, color: navy });
    tx('FREE LANDLORD PROPERTY REPORT', M, H - 52, B, 9, camel);
    wrap(lead.address || d.postcode, T, 24, W - 2 * M).slice(0, 3).forEach((l, i) => tx(l, M, H - 86 - i * 28, T, 24, rgb(1, 1, 1)));
    tx([d.geo && d.geo.district, d.postcode].filter(Boolean).join(' · ') + '   ·   Prepared for ' + lead.name + ', ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), M, H - 172, F, 9, rgb(0.9, 0.88, 0.84));
    y = H - 220;
    const cert = d.epc && d.epc.cert, s = d.sales, c = d.crime, f = d.flood;
    const tiles = [['EPC', cert ? cert.rating : '-', cert ? (cert.expired ? 'Expired' : 'until ' + fmtD(cert.expires)) : 'not found'], ['Typical price', s && s.median3 ? gbp(s.median3) : '-', s ? s.recentCount + ' sales, 3 yrs' : ''], ['Crime, 1 mile', c ? c.perMonth + '/month' : '-', c && c.cats[0] ? c.cats[0].name : ''], ['Flood areas', f ? String(f.count) : '-', 'within 1 km']];
    const tw = (W - 2 * M - 30) / 4;
    tiles.forEach((t, i) => { const x = M + i * (tw + 10); pg.drawRectangle({ x, y: y - 58, width: tw, height: 62, color: paper }); tx(t[0].toUpperCase(), x + 8, y - 10, B, 7, soft); tx(t[1], x + 8, y - 34, B, 18); tx(String(t[2]).slice(0, 26), x + 8, y - 50, F, 7.5, soft); });
    y -= 80;
    head('Energy (EPC)');
    if (cert) { const col = EC[cert.rating] || [120, 120, 120]; pg.drawRectangle({ x: M, y: y - 30, width: 38, height: 38, color: rgb(col[0] / 255, col[1] / 255, col[2] / 255) }); tx(cert.rating, M + 11, y - 22, B, 22, rgb(1, 1, 1)); tx(cert.address, M + 50, y - 6, B, 10); tx((cert.expired ? 'Expired' : 'Valid until ' + fmtD(cert.expires)) + (cert.potential ? ' · could reach ' + cert.potential : '') + (cert.floorArea ? ' · ' + cert.floorArea + ' m2' : ''), M + 50, y - 22, F, 9, soft); y -= 46;
      para(RANK.indexOf(cert.rating) > RANK.indexOf('E') ? 'Below the letting minimum (E): the property cannot be let until it is improved or an exemption is registered.' : RANK.indexOf(cert.rating) > RANK.indexOf('C') ? 'Meets today\'s letting minimum (E), but is below C, which the government has proposed as the future minimum.' : 'Already C or better.'); }
    else para(d.epc ? (d.epc.all.length ? 'No certificate matched the address. Certificates at this postcode: ' + d.epc.all.slice(0, 6).map(x => x.address + ' (' + x.rating + ')').join('; ') : 'No energy certificates found at this postcode.') : 'Not available when the report was made.');
    head('Sold prices nearby');
    if (s && s.count) { para(s.count + ' sales at and around ' + d.postcode + ' in the last 5 years. Typical price over the last 3 years: ' + gbp(s.median3) + '.'); if (s.byType.length) rows([['Type', 'Typical price', 'Sales']].concat(s.byType.map(t => [t.type, gbp(t.median), t.n])), [0, 180, 330]); rows([['Year', 'Typical price', 'Sales']].concat(s.byYear.map(t => [t.year, gbp(t.median), t.n])), [0, 180, 330]); rows([['Date', 'Address', 'Price']].concat(s.rows.slice(0, 12).map(x => [fmtD(x.date), x.address.slice(0, 50), gbp(x.price)])), [0, 80, 430]); }
    else para(s ? 'No sales recorded around this postcode in the last 5 years.' : 'Not available when the report was made.');
    head('Crime within a mile');
    if (c) { para(c.total + ' crimes reported within a mile in ' + c.months.length + ' months (' + c.months.map(monthName).reverse().join(', ') + '): about ' + c.perMonth + ' a month.'); rows(c.cats.slice(0, 8).map(x => [x.name, x.n]), [0, 330]); }
    else para('Not available when the report was made.');
    head('Flood risk');
    para(f ? (f.count ? f.count + ' Environment Agency flood warning or alert areas within 1 km: ' + f.areas.slice(0, 4).map(a => a.label).join('; ') + '.' : 'No flood warning or alert areas within 1 km.') + (f.warnings.length ? ' ' + f.warnings.length + ' flood warnings in force when the report was made.' : '') + ' Check the long-term flood risk at check-long-term-flood-risk.service.gov.uk.' : 'Not available when the report was made.');
    head('Council and area');
    if (d.geo) rows([['Council', d.geo.district], ['Ward', d.geo.ward], ['Region', [d.geo.region, d.geo.country].filter(Boolean).join(', ')], ['Constituency', d.geo.constituency]].filter(r => r[1]), [0, 120]);
    head('Letting checklist');
    d.checklist.forEach(x => { need(30); tx((x.status === 'ok' ? '[OK] ' : x.status === 'act' ? '[!] ' : '[  ] ') + x.t, M, y, B, 10); y -= 13; wrap(x.d, F, 8.5, W - 2 * M - 14).forEach(l => { need(12); tx(l, M + 14, y, F, 8.5, soft); y -= 11; }); y -= 4; });
    para('General information, not legal advice. Sources: EPC register, HM Land Registry Price Paid Data (Crown copyright, Open Government Licence), data.police.uk, Environment Agency, postcodes.io (Contains OS data, Royal Mail and ONS data).', 7.5);
    pages.forEach((p, i) => { p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.4, color: line }); p.drawText('DIY Inventory  ·  Free landlord property report  ·  diyinventory.co.uk', { x: M, y: 28, font: F, size: 7, color: soft }); const n = 'Page ' + (i + 1) + ' of ' + pages.length; p.drawText(n, { x: W - M - F.widthOfTextAtSize(n, 7), y: 28, font: F, size: 7, color: soft }); });
    return Buffer.from(await doc.save());
  }

  /* ------------------------------------------------------------------ the owner's leads on /admin */
  addAdminSection(() => {
    const L = readLeads(), seen = L.seenAt || '', fresh = L.list.filter(l => l.at > seen).length;
    if (L.list.length) { L.seenAt = new Date().toISOString(); writeLeads(L); }
    const when = s => new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const rows = L.list.slice(0, 300).map(l => `<li${l.at > seen ? ' class="isnew"' : ''}><div style="flex:1;min-width:0"><strong>${esc(l.name)}</strong> <span class="pill">${esc(l.role || '')}</span>${l.at > seen ? ' <span class="pill new">New</span>' : ''}
      <div class="sub"><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a> · <a href="mailto:${esc(l.email)}?subject=${encodeURIComponent('Rent valuation: ' + (l.address || l.postcode))}">${esc(l.email)}</a> · ${esc(when(l.at))}</div>
      <div class="sub">${esc(l.address || l.postcode)}${l.epc ? ' · EPC ' + esc(l.epc) : ''}${l.typical ? ' · typical price ' + esc(gbp(l.typical)) : ''}${l.council ? ' · ' + esc(l.council) : ''}</div></div>
      <div class="actions"><a class="btn" href="/property-report/r/${esc(l.id + '-' + l.token)}.pdf" target="_blank">PDF</a></div></li>`).join('');
    const banner = fresh ? `<a class="news" href="#prleads" onclick="document.getElementById('prleads').open=true">📊 ${fresh} new property report lead${fresh === 1 ? '' : 's'} since your last visit</a>` : '';
    return banner + `<details class="codes" id="prleads"${fresh ? ' open' : ''}><summary>📊 Property report leads <span class="sub" style="display:inline">— ${L.list.length ? L.list.length + ' lead' + (L.list.length === 1 ? '' : 's') : 'none yet'}</span></summary>
<p class="sub" style="margin-top:12px">People who asked for the full report on <a href="/property-report" target="_blank">/property-report</a>. Each one was promised a rent valuation for the property.</p>${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  });

  return { paths: ['/property-report'] };
}

module.exports = { mount, _test: { normPc, compliance, median } };
