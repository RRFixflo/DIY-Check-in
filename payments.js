// Floor plans, £9.55: the /floor-plan page, the drawing tool at /floor-plan/create (public/floorplan.js), and
// paying for a plan by card. Drawing is free; downloading a plan (or adding it to a report in the app) is paid.
//
// Payment providers (the first one configured is used; FLOORPLAN_PROVIDER=sumup|stripe picks one):
//   SumUp hosted checkout  SUMUP_API_KEY + SUMUP_MERCHANT_CODE
//   Stripe Checkout        STRIPE_SECRET_KEY
// The buyer is sent to the provider's page; on the way back (/api/floorplan/return) the payment is checked with
// the provider itself, never taken from the address, and a random purchase token is handed to the browser,
// which keeps it with the plan. Purchases are kept in REPORTS_DIR/floorplans.json (the last 3000).
// The owner (signed in to /admin) and holders of the shared access code get plans without paying.
//
//   GET  /floor-plan                 the page about it (in the sitemap)
//   GET  /floor-plan/create          the drawing tool
//   GET  /floor-plan/sample.svg      the sample plan shown on the website
//   GET  /api/floorplan/status       { configured, provider, free, paid, token? } for ?token= or ?ref=
//   POST /api/floorplan/checkout     { from: 'app'|'tool', label } → { url, ref } (or { free: true })
//   GET  /api/floorplan/return?ref=  checks the payment, then back to the app or the tool with ?fp=<token>
//   GET  /api/floorplan/cancel?ref=  back without paying
//   POST /api/floorplan/webhook      SumUp's server-to-server notice: re-checks that checkout with SumUp
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const FP = require('./public/floorplan');

const PRICE = 9.55, PENCE = 955, CURRENCY = 'GBP', PRICE_TEXT = '£9.55';
const REF_RE = /^[a-f0-9]{24}$/, TOKEN_RE = /^fp_[A-Za-z0-9_-]{20,40}$/;
const env = k => String(process.env[k] || '').trim();
// Base URLs can be pointed at a local mock for tests only.
const SUMUP_BASE = () => (env('SUMUP_API_BASE') || 'https://api.sumup.com').replace(/\/+$/, '');
const STRIPE_BASE = () => (env('STRIPE_API_BASE') || 'https://api.stripe.com').replace(/\/+$/, '');

function provider(){
  const sumup = !!(env('SUMUP_API_KEY') && env('SUMUP_MERCHANT_CODE')), stripe = !!env('STRIPE_SECRET_KEY'), pick = (env('PAYMENT_PROVIDER') || env('FLOORPLAN_PROVIDER')).toLowerCase();
  if (pick === 'stripe' && stripe) return 'stripe';
  if (pick === 'sumup' && sumup) return 'sumup';
  return sumup ? 'sumup' : stripe ? 'stripe' : '';
}
// What a provider said, for the logs: its status and messages, never the key.
function said(d){
  if (!d || typeof d !== 'object') return String(d || '').slice(0, 200);
  const e = d.error && typeof d.error === 'object' ? d.error : d;
  return JSON.stringify({ status: d.status, error: typeof d.error === 'string' ? d.error : e.type || e.error_code, code: e.code || e.error_code, message: e.message || d.message, param: e.param, details: d.detail || d.details }).slice(0, 400);
}
async function call(url, opts){
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(15000) }, opts));
  let d = null; const text = await res.text();
  try { d = text ? JSON.parse(text) : {}; } catch (e) { d = { message: text.slice(0, 200) }; }
  return { ok: res.ok, status: res.status, d };
}

// Both providers take one checkout `o`: { ref, amountPence, name, detail, returnUrl, cancelUrl, hookUrl, tag } and
// are checked with { ref, providerId, amountPence, tag }. `tag` only prefixes the log lines ('floorplan', 'report').
const PROVIDERS = {
  sumup: {
    async create(o){
      const body = { checkout_reference: o.ref, amount: o.amountPence / 100, currency: CURRENCY, merchant_code: env('SUMUP_MERCHANT_CODE'),
        description: o.name + (o.detail ? ': ' + o.detail.slice(0, 80) : ''), redirect_url: o.returnUrl, return_url: o.hookUrl, hosted_checkout: { enabled: true } };
      const r = await call(SUMUP_BASE() + '/v0.1/checkouts', { method: 'POST', headers: { Authorization: 'Bearer ' + env('SUMUP_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      const url = r.d && (r.d.hosted_checkout_url || (r.d.hosted_checkout && (r.d.hosted_checkout.url || r.d.hosted_checkout.hosted_checkout_url)));
      if (!r.ok || !r.d.id || !url) { console.error(o.tag + ': SumUp checkout not created: HTTP ' + r.status + ' ' + said(r.d) + (r.ok ? ' (fields: ' + Object.keys(r.d || {}).join(', ') + ')' : '')); throw new Error('provider'); }
      return { id: String(r.d.id), url: String(url) };
    },
    async verify(o){
      const amount = o.amountPence / 100;
      const r = await call(SUMUP_BASE() + '/v0.1/checkouts/' + encodeURIComponent(o.providerId), { headers: { Authorization: 'Bearer ' + env('SUMUP_API_KEY'), Accept: 'application/json' } });
      if (!r.ok) { console.error(o.tag + ': SumUp checkout ' + o.ref + ' could not be checked: HTTP ' + r.status + ' ' + said(r.d)); return { paid: false, status: 'unknown' }; }
      const d = r.d || {}, status = String(d.status || '').toUpperCase();
      const amountOk = d.amount == null || Math.abs(Number(d.amount) - amount) < 0.005, curOk = !d.currency || String(d.currency).toUpperCase() === CURRENCY;
      const txn = d.transaction_code || (Array.isArray(d.transactions) && d.transactions[0] && (d.transactions[0].transaction_code || d.transactions[0].id)) || '';
      if (status === 'PAID' && !(amountOk && curOk)) console.error(o.tag + ': SumUp checkout ' + o.ref + ' paid with an unexpected amount: ' + d.amount + ' ' + d.currency);
      if (status !== 'PAID') console.log(o.tag + ': SumUp checkout ' + o.ref + ' status ' + (status || '(none)'));
      return { paid: status === 'PAID' && amountOk && curOk, status: status.toLowerCase() || 'unknown', providerRef: String(txn) };
    }
  },
  stripe: {
    async create(o){
      const f = new URLSearchParams();
      f.set('mode', 'payment');
      f.set('success_url', o.returnUrl + (o.returnUrl.includes('?') ? '&' : '?') + 'session_id={CHECKOUT_SESSION_ID}');
      f.set('cancel_url', o.cancelUrl);
      f.set('client_reference_id', o.ref);
      f.set('metadata[ref]', o.ref);
      f.set('line_items[0][quantity]', '1');
      f.set('line_items[0][price_data][currency]', 'gbp');
      f.set('line_items[0][price_data][unit_amount]', String(o.amountPence));
      f.set('line_items[0][price_data][product_data][name]', o.name);
      if (o.detail) f.set('line_items[0][price_data][product_data][description]', o.detail.slice(0, 200));
      if (o.email) f.set('customer_email', o.email);
      const r = await call(STRIPE_BASE() + '/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() });
      if (!r.ok || !r.d.id || !r.d.url) { console.error(o.tag + ': Stripe session not created: HTTP ' + r.status + ' ' + said(r.d)); throw new Error('provider'); }
      return { id: String(r.d.id), url: String(r.d.url) };
    },
    async verify(o){
      const r = await call(STRIPE_BASE() + '/v1/checkout/sessions/' + encodeURIComponent(o.providerId), { headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY') } });
      if (!r.ok) { console.error(o.tag + ': Stripe session ' + o.ref + ' could not be checked: HTTP ' + r.status + ' ' + said(r.d)); return { paid: false, status: 'unknown' }; }
      const d = r.d || {}, paid = d.payment_status === 'paid', amountOk = d.amount_total == null || Number(d.amount_total) === o.amountPence, curOk = !d.currency || String(d.currency).toLowerCase() === 'gbp';
      if (paid && !(amountOk && curOk)) console.error(o.tag + ': Stripe session ' + o.ref + ' paid with an unexpected amount: ' + d.amount_total + ' ' + d.currency);
      if (!paid) console.log(o.tag + ': Stripe session ' + o.ref + ' payment_status ' + (d.payment_status || '(none)') + ', status ' + (d.status || '(none)'));
      return { paid: paid && amountOk && curOk, status: String(d.payment_status || d.status || 'unknown'), providerRef: String(d.payment_intent || '') };
    }
  }
};
// The shared card checkout, for floor plans and reports alike (GBP, no VAT):
//   createCheckout({ ref, amountPence, name, detail, email, returnUrl, cancelUrl, hookUrl, tag }) → { provider, id, url }
//   verify({ provider, providerId, ref, amountPence, tag }) → { paid, status, providerRef }; always asks the provider itself.
async function createCheckout(o){
  const prov = o.provider || provider();
  if (!PROVIDERS[prov]) throw new Error('not-configured');
  const c = await PROVIDERS[prov].create(Object.assign({ tag: 'payments' }, o));
  return { provider: prov, id: c.id, url: c.url };
}
async function verify(o){
  const p = PROVIDERS[o.provider];
  if (!p || !o.providerId) return { paid: false, status: 'unknown' };
  return p.verify(Object.assign({ tag: 'payments' }, o));
}

let FILE = '';
function readAll(){ try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d.list) ? d : { list: [] }; } catch (e) { return { list: [] }; } }
function writeAll(d){
  const cut = Date.now() - 3 * 86400000;
  d.list = d.list.filter(r => r.status === 'paid' || Date.parse(r.createdAt) > cut).slice(-3000);
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(FILE + '.tmp', FILE);
}
function update(ref, fn){ const d = readAll(), r = d.list.find(x => x.ref === ref); if (r) { fn(r); writeAll(d); } return r; }
const find = (k, v) => readAll().list.find(x => x[k] === v);

function mount(app, ctx){
  FILE = path.join(ctx.REPORTS_DIR, 'floorplans.json');
  const { renderPage, isOwner, codeAccess, clientIp, limiter, notify, track, canonicalBase, PUBLIC_BASE } = ctx;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const checkoutLimit = limiter(10, 60 * 60 * 1000), statusLimit = limiter(240, 60 * 60 * 1000);
  const lastCheck = new Map();
  const ROOT = path.join(__dirname, 'public');
  const V = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'floorplan.js'))).update(fs.readFileSync(path.join(ROOT, 'floorplan.css'))).digest('hex').slice(0, 10);

  // Free for the owner and for the shared access code (the diy_access cookie SHARED-…); one-off codes are for one report only.
  function freeFor(req){
    if (isOwner && isOwner(req)) return 'owner';
    const m = /(?:^|;\s*)diy_access=(SHARED-[\w-]{10,40})/.exec(req.headers.cookie || '');
    if (m && codeAccess) { const a = codeAccess(m[1]); if (a && a.valid) return 'code'; }
    return '';
  }
  // Checks a purchase with its provider (at most every 4 seconds), and marks it paid.
  async function settle(rec, req){
    if (!rec || rec.status === 'paid') return rec;
    const p = PROVIDERS[rec.provider]; if (!p || !rec.providerId) return rec;
    const last = lastCheck.get(rec.ref) || 0; if (Date.now() - last < 4000) return rec;
    lastCheck.set(rec.ref, Date.now()); if (lastCheck.size > 2000) lastCheck.clear();
    let v; try { v = await verify({ provider: rec.provider, providerId: rec.providerId, ref: rec.ref, amountPence: PENCE, tag: 'floorplan' }); } catch (e) { console.error('floorplan: checking ' + rec.ref + ' failed: ' + e.message); return rec; }
    if (!v.paid) return update(rec.ref, r => { r.providerStatus = v.status; }) || rec;
    let first = false;
    const out = update(rec.ref, r => { if (r.status !== 'paid') { first = true; r.status = 'paid'; r.paidAt = new Date().toISOString(); r.providerRef = v.providerRef || r.providerRef || ''; r.providerStatus = v.status; } });
    if (first) {
      console.log('floorplan: paid ' + rec.ref + ' (' + rec.provider + ')');
      if (track && req) track(req, 'floorplan_purchase', PRICE);
      if (notify) notify({ title: 'Floor plan sold: ' + PRICE_TEXT, message: [rec.label || 'No address given', (rec.from === 'app' ? 'Added to a report in the app' : 'From the floor plan tool') + ' · paid by ' + (rec.provider === 'sumup' ? 'SumUp' : 'Stripe')].join('\n'), tags: ['house'], click: PUBLIC_BASE ? PUBLIC_BASE.replace(/\/+$/, '') + '/admin#floorplans' : '' });
    }
    return out;
  }
  const destOf = rec => rec && rec.from === 'app' ? '/app' : '/floor-plan/create';

  /* -------------------------------------------------------------- API */
  app.get('/api/floorplan/status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!statusLimit(clientIp(req))) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    const free = freeFor(req), token = String(req.query.token || ''), ref = String(req.query.ref || '');
    const out = { price: PRICE, priceText: PRICE_TEXT, configured: !!provider(), provider: provider(), free: !!free, freeReason: free, paid: false };
    if (TOKEN_RE.test(token)) { const r = find('token', token); if (r && r.status === 'paid') out.paid = true; }
    if (!out.paid && REF_RE.test(ref)) {
      const r = await settle(find('ref', ref), req);
      if (r && r.status === 'paid') { out.paid = true; out.token = r.token; }
      else if (r) out.pending = true;
    }
    res.json(out);
  });
  app.post('/api/floorplan/checkout', express.json({ limit: '4kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (freeFor(req)) return res.json({ free: true });
    const prov = provider();
    if (!prov) return res.status(503).json({ error: 'Card payments aren’t switched on yet. Please contact us and we’ll send you your plan.', notConfigured: true });
    if (!checkoutLimit(clientIp(req))) return res.status(429).json({ error: 'Too many payment attempts from here. Please try again in a while.' });
    const b = req.body || {};
    const rec = { ref: crypto.randomBytes(12).toString('hex'), token: 'fp_' + crypto.randomBytes(18).toString('base64url'), provider: prov, providerId: '', amount: PRICE, currency: CURRENCY, status: 'pending',
      from: b.from === 'app' ? 'app' : 'tool', label: String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200), createdAt: new Date().toISOString(), paidAt: '' };
    const base = canonicalBase(req);
    const urls = { ret: base + '/api/floorplan/return?ref=' + rec.ref, cancel: base + '/api/floorplan/cancel?ref=' + rec.ref, hook: base + '/api/floorplan/webhook' };
    try {
      const c = await createCheckout({ provider: prov, ref: rec.ref, amountPence: PENCE, name: 'Floor plan', detail: rec.label, returnUrl: urls.ret, cancelUrl: urls.cancel, hookUrl: urls.hook, tag: 'floorplan' });
      rec.providerId = c.id;
      const d = readAll(); d.list.push(rec); writeAll(d);
      console.log('floorplan: checkout ' + rec.ref + ' created (' + prov + ', from ' + rec.from + ')');
      res.json({ url: c.url, ref: rec.ref });
    } catch (e) {
      if (e.message !== 'provider') console.error('floorplan: checkout failed: ' + e.message);
      res.status(502).json({ error: 'The payment page couldn’t be opened just now. Please try again in a minute.' });
    }
  });
  app.get('/api/floorplan/return', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ref = String(req.query.ref || ''), rec0 = REF_RE.test(ref) ? find('ref', ref) : null;
    if (!rec0) return res.redirect(302, '/floor-plan/create');
    lastCheck.delete(ref);
    const rec = await settle(rec0, req);
    if (rec && rec.status === 'paid') return res.redirect(302, destOf(rec) + '?fp=' + encodeURIComponent(rec.token));
    res.redirect(302, destOf(rec0) + '?fp_ref=' + encodeURIComponent(ref));   // not confirmed yet: the page keeps checking
  });
  app.get('/api/floorplan/cancel', (req, res) => {
    const ref = String(req.query.ref || ''), rec = REF_RE.test(ref) ? find('ref', ref) : null;
    res.redirect(302, destOf(rec) + '?fp_cancel=1');
  });
  app.post('/api/floorplan/webhook', express.json({ limit: '16kb' }), async (req, res) => {
    // Only a nudge: the checkout is looked up by its id and checked with SumUp itself.
    const id = String((req.body || {}).id || (req.body || {}).checkout_id || '').slice(0, 80);
    const rec = id ? find('providerId', id) : null;
    if (rec) { lastCheck.delete(rec.ref); settle(rec, null).catch(() => {}); }
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------ pages */
  const sample = (() => {
    const p = FP.normalize({ unit: 'm', north: true, floors: ['Ground floor'], rooms: [
      { id: 'a', name: 'Living room', w: 4.6, l: 3.9, x: 0, y: 0, openings: [{ type: 'window', wall: 'n', pos: 2.3, width: 1.8 }, { type: 'door', wall: 's', pos: 3.8, width: 0.8, flip: true }] },
      { id: 'b', name: 'Kitchen', w: 3.2, l: 3.9, x: 4.6, y: 0, openings: [{ type: 'window', wall: 'n', pos: 1.6, width: 1.2 }, { type: 'door', wall: 'w', pos: 3.2, width: 0.8 }] },
      { id: 'c', name: 'Hallway', w: 4.6, l: 1.2, x: 0, y: 3.9, openings: [{ type: 'door', wall: 'w', pos: 0.6, width: 0.9 }] },
      { id: 'd', name: 'Bathroom', w: 2.1, l: 2.4, x: 0, y: 5.1, openings: [{ type: 'door', wall: 'n', pos: 1.65, width: 0.7 }, { type: 'window', wall: 'w', pos: 1.2, width: 0.6 }] },
      { id: 'e', name: 'Bedroom', w: 3.4, l: 3.6, x: 4.6, y: 3.9, openings: [{ type: 'door', wall: 'w', pos: 0.6, width: 0.8, flip: true }, { type: 'window', wall: 's', pos: 1.7, width: 1.4 }] },
      { id: 'f', name: 'Study', w: 2.5, l: 2.4, x: 2.1, y: 5.1, openings: [{ type: 'door', wall: 'n', pos: 0.55, width: 0.8, flip: true }, { type: 'window', wall: 's', pos: 1.25, width: 1 }] }
    ] });
    return { svg: FP.floorPreview(p, 0, { bg: true, margin: 0.5 }), area: FP.stats(p).total };
  })();
  app.get('/floor-plan/sample.svg', (req, res) => { res.set('Cache-Control', 'public, max-age=86400').type('image/svg+xml').send(sample.svg); });

  const ld = base => [{ '@type': 'Product', '@id': base + '/floor-plan#product', name: 'Floor plan', category: 'Property floor plan',
    description: 'A clean, measured floor plan of a property: every room with its size, the floor area of each floor and the total, as a PDF and a picture. Drawn on your phone from the room sizes you type in.',
    brand: { '@id': base + '/#org' }, image: base + '/floor-plan/sample.svg',
    offers: { '@type': 'Offer', price: PRICE.toFixed(2), priceCurrency: CURRENCY, availability: 'https://schema.org/InStock', url: base + '/floor-plan', seller: { '@id': base + '/#org' } } }];
  const tick = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const pageBody = `<div class="page-head"><div class="wrap"><span class="kicker">Floor plans</span><h1>A clear, measured floor plan, drawn on your phone.</h1>
<p>Type in each room’s width and length and the plan draws itself: every room with its size, and the total floor area. Free to draw. ${PRICE_TEXT} to download.</p>
<div class="cta fp-cta"><a class="btn primary" href="/floor-plan/create">Draw a floor plan</a><a class="btn ghost" href="/app">Add one to an inventory report</a><small>${PRICE_TEXT} per plan, every floor included. No subscription.</small></div></div></div>
<section class="tight"><div class="wrap fp-intro">
  <figure class="card fp-sample"><img src="/floor-plan/sample.svg" alt="An example floor plan: living room, kitchen, hallway, bathroom, bedroom and study, each with its size" width="900" height="950"><figcaption>An example plan · ${sample.area.toFixed(1)} m² in total</figcaption></figure>
  <div class="fp-why">
    <div class="steps fp-steps3">
      <div class="card step"><div class="n">1</div><h3>Pick the rooms</h3><p>Tap Living room, Kitchen, Bedroom… or start from the rooms in your inventory report.</p></div>
      <div class="card step"><div class="n">2</div><h3>Type the sizes</h3><p>Width and length of each room, in metres or feet and inches. Measure wall to wall.</p></div>
      <div class="card step"><div class="n">3</div><h3>Download it</h3><p>The plan is laid out for you straight away. Move rooms, add doors and windows if you like, then download.</p></div>
    </div>
  </div>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">What you get</span><h2>Clean, simple and measured</h2><p>Made for letting and selling: tenants and buyers see the layout and the size of every room at a glance.</p></div>
  <div class="card price fp-price-card">
    <div style="font-weight:700;color:var(--ink-soft)">One floor plan</div>
    <div class="amt">${PRICE_TEXT}</div>
    <div class="vat">Every floor of the property · PDF and picture · pay when you download</div>
    <ul>
      <li>${tick}Each room with its width, length and floor area, in metres and feet</li>
      <li>${tick}Total internal area in m² and ft²</li>
      <li>${tick}Doors, windows and stairs, with an optional north arrow</li>
      <li>${tick}Ground, first and second floors, each on its own page</li>
      <li>${tick}A PDF to print or email, and a picture (PNG) for listings</li>
      <li>${tick}Add it to your check-in, check-out or inspection report</li>
    </ul>
    <a class="btn primary" href="/floor-plan/create">Draw a floor plan</a>
  </div>
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="faq">
  <details><summary>How accurate is the plan?</summary><p>As accurate as the sizes you type in. The plan is drawn from your measurements, so it is marked “not to scale, for illustration only”. It shows the layout and room sizes clearly, but it isn’t a surveyor’s drawing.</p></details>
  <details><summary>Do I need special equipment?</summary><p>No. A tape measure or a laser measure is enough. Measure each room from wall to wall, at floor level. To the nearest 10 cm is fine.</p></details>
  <details><summary>Can I add a floor plan to my inventory report?</summary><p>Yes. On the review screen of the app, tap Draw a floor plan. Your report’s rooms are filled in for you; type their sizes and the plan is added to your report for ${PRICE_TEXT}. Your report is complete without it, if you’d rather skip it.</p></details>
  <details><summary>Is my plan saved?</summary><p>Yes, on your phone or computer as you go, so you can close the page and carry on later, or go to the payment page and come straight back to it.</p></details>
</div></div></section>`;
  const page = { key: 'floorplan', path: '/floor-plan', title: 'Floor plans · draw a measured floor plan on your phone · DIY Inventory', og: 'Floor plans by DIY Inventory',
    desc: 'Draw a clean, measured floor plan on your phone: type each room’s size and the plan draws itself, with room sizes and total floor area. Free to draw, ' + PRICE_TEXT + ' to download.',
    body: pageBody, jsonld: base => ld(base).concat(faqLd(pageBody)), head: '<style>' + PAGE_CSS + '</style>' };
  app.get(['/floor-plan', '/floor-plan/'], (req, res) => res.type('html').send(renderPage(page, req)));

  const tool = { key: 'floorplan', path: '/floor-plan/create', title: 'Draw a floor plan · DIY Inventory', og: 'Draw a floor plan', desc: page.desc,
    body: `<div class="fp-host" id="fpTool"><noscript><p style="padding:24px">The floor plan tool needs JavaScript switched on.</p></noscript></div>`,
    head: `<meta name="robots" content="noindex, follow"><link rel="stylesheet" href="/floorplan.css?v=${V}"><style>${TOOL_CSS}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" defer></script><script src="/floorplan.js?v=${V}" defer></script>
<script>addEventListener('DOMContentLoaded', function () { if (window.FloorPlan) FloorPlan.standalone(document.getElementById('fpTool')); });</script>`,
    jsonld: [] };
  app.get(['/floor-plan/create', '/floor-plan/create/'], (req, res) => res.set('Cache-Control', 'no-store').type('html').send(renderPage(tool, req)));

  /* ------------------------------------------------------------ /admin */
  if (ctx.addAdminSection) ctx.addAdminSection(() => {
    const all = readAll().list, paid = all.filter(r => r.status === 'paid').reverse(), pending = all.filter(r => r.status !== 'paid').length;
    const revenue = Math.round(paid.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100, prov = provider();
    const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const rows = paid.slice(0, 200).map(r => `<li><div style="flex:1;min-width:0"><strong>${esc(r.label || 'No address given')}</strong> <span class="pill sent">£${Number(r.amount).toFixed(2)}</span>
      <div class="sub">${esc(when(r.paidAt || r.createdAt))} · ${r.from === 'app' ? 'in a report (app)' : 'floor plan tool'} · ${r.provider === 'sumup' ? 'SumUp' : 'Stripe'}${r.providerRef ? ' · ' + esc(r.providerRef) : ''} · ref ${esc(r.ref)}</div></div></li>`).join('');
    return `<details class="codes" id="floorplans"><summary>📐 Floor plans <span class="sub" style="display:inline">— ${paid.length ? paid.length + ' sold, £' + revenue.toFixed(2) : 'none sold yet'}${pending ? ' · ' + pending + ' started, not paid' : ''}</span></summary>
<p class="sub" style="margin-top:12px">${PRICE_TEXT} each, on <a href="/floor-plan" target="_blank" rel="noopener">/floor-plan</a> and as a step in the app. Card payments: ${prov ? '<b>' + (prov === 'sumup' ? 'SumUp' : 'Stripe') + '</b>' : '<b>not set up</b> (set SUMUP_API_KEY and SUMUP_MERCHANT_CODE, or STRIPE_SECRET_KEY, in Railway). You can still make and download plans yourself while signed in here'}.</p>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  });

  console.log('floorplan: card payments ' + (provider() || 'off (set SUMUP_API_KEY + SUMUP_MERCHANT_CODE, or STRIPE_SECRET_KEY)'));
  return { paths: ['/floor-plan'] };
}
function faqLd(body){
  const qs = [...body.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => ({ q: m[1].replace(/<[^>]+>/g, '').trim(), a: m[2].replace(/<[^>]+>/g, '').trim() }));
  return qs.length ? [{ '@type': 'FAQPage', mainEntity: qs.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) }] : [];
}

const PAGE_CSS = `.fp-cta { justify-content: center; margin-top: 24px; } .fp-cta small { text-align: center; }
.fp-intro { display: grid; grid-template-columns: 1.15fr .85fr; gap: 24px; align-items: center; }
.fp-sample { margin: 0; padding: 14px; } .fp-sample img { width: 100%; height: auto; display: block; border-radius: 14px; box-shadow: 0 0 0 1px var(--line); }
.fp-sample figcaption { text-align: center; color: var(--ink-faint); font-weight: 600; font-size: 14px; margin-top: 10px; }
.fp-steps3 { grid-template-columns: 1fr; gap: 14px; } .fp-steps3 .step h3 { margin-top: 6px; }
.fp-price-card { max-width: 520px; margin: 0 auto; }
@media (max-width: 900px) { .fp-intro { grid-template-columns: 1fr; } }`;
const TOOL_CSS = `main { padding: 0; } .fp-host { max-width: 1120px; margin: 12px auto 28px; padding: 0 12px; height: calc(100vh - 64px - 40px); height: calc(100dvh - 64px - 40px); min-height: 560px; }
.fp-host .fp { box-shadow: var(--shadow), 0 0 0 1px var(--line); }
@media (max-width: 600px) { .fp-host { margin: 0; padding: 0; height: calc(100dvh - 64px); } .fp-host .fp { border-radius: 0; box-shadow: none; } }`;

module.exports = { mount, PRICE, PRICE_TEXT, provider, createCheckout, verify, CURRENCY, _test: { PROVIDERS, readAll } };
