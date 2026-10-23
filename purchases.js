// Buying a report, £30 (GBP, no VAT), on DIY Inventory's own page. The card payment itself is the shared checkout
// in payments.js (SumUp hosted checkout, or Stripe Checkout). A paid purchase gives a personal link /?access=RPT-…:
// a local token, checked here (never by any other system), good for one report.
//
//   GET  /buy[?for=tenant][&from=app]   the page (in the sitemap); ?cancelled=1 / ?failed=1 add a notice
//   POST /buy                           { name, email, for, from } → the provider's payment page (303)
//   GET  /buy/done?ref=                 checks the payment with the provider, issues the token, sets the diy_access
//                                       cookie in this browser and shows the link to keep or send to a tenant
//   GET  /buy/cancel?ref=               back to /buy with a notice
//   POST /api/buy/webhook               SumUp's server-to-server notice: re-checks that checkout with SumUp
//
// Purchases are kept in REPORTS_DIR/report-purchases.json: ref, token, provider ids, amount, name, email, times,
// and usedAt once a report has been stored with the token.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const payments = require('./payments');

const PRICE = 30, PENCE = 3000, PRICE_TEXT = '£30';
const REF_RE = /^[a-f0-9]{24}$/, TOKEN_RE = /^RPT-[A-Za-z0-9_-]{24}$/;
const env = k => String(process.env[k] || '').trim();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

let FILE = '';
function readAll(){ try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d.list) ? d : { list: [] }; } catch (e) { return { list: [] }; } }
function writeAll(d){
  const cut = Date.now() - 3 * 86400000;
  d.list = d.list.filter(r => r.status === 'paid' || Date.parse(r.createdAt) > cut).slice(-20000);
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(FILE + '.tmp', FILE);
}
function update(ref, fn){ const d = readAll(), r = d.list.find(x => x.ref === ref); if (r) { fn(r); writeAll(d); } return r; }
const find = (k, v) => readAll().list.find(x => x[k] === v);

const isToken = t => TOKEN_RE.test(String(t || ''));
// Whether a token from a link or cookie is a purchase made here: { valid, reason } (reason 'used' once a report was
// stored with it), or null if it isn't one of ours at all.
function access(token){
  if (!/^RPT-/.test(String(token || ''))) return null;
  const r = isToken(token) && find('token', token);
  if (!r || r.status !== 'paid') return { valid: false, reason: 'unknown' };
  return r.usedAt ? { valid: false, reason: 'used' } : { valid: true, reason: '' };
}
// A report has been stored with this token: it's spent (the same browser still sees and sends that report).
function markUsed(token, address){
  if (!isToken(token)) return false;
  const d = readAll(), r = d.list.find(x => x.token === token);
  if (!r || r.usedAt) return false;
  r.usedAt = new Date().toISOString(); r.usedFor = clip(address, 200);
  writeAll(d);
  console.log('report purchase used: ' + r.ref);
  return true;
}

// The buyer's receipt and link, by email (Resend), when they gave an address.
async function emailBuyer(rec, link){
  const key = env('RESEND_API_KEY');
  if (!key || !rec.email) return false;
  const from = env('REPORT_FROM_EMAIL') || 'DIY Inventory <onboarding@resend.dev>';
  const when = new Date(rec.paidAt || Date.now()).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
  const text = [
    (rec.name ? 'Hello ' + rec.name + ',' : 'Hello,'), '',
    'Thank you for buying a DIY Inventory report. Your report is ready to start.', '',
    'Your personal link:', link, '',
    'Open it on the phone you’ll take the photos with. Doing it for a tenant? Send them this link: they do the report on their phone and never see a price.',
    'Keep this link: it’s your access to this report. It’s good for one report (a check-in, a check-out or an inspection).', '',
    'Receipt', '-------',
    'DIY Inventory report (one check-in, check-out or inspection)',
    'Amount paid: £' + Number(rec.amount).toFixed(2) + ' (GBP)',
    'Paid: ' + when,
    'Paid by card' + (rec.providerRef ? ', payment reference ' + rec.providerRef : ''),
    'Order reference: ' + rec.ref, '',
    'DIY Inventory'
  ].join('\n');
  try {
    const res = await fetch((env('RESEND_API_BASE') || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', {   // the base can point at a mock, for tests only
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [rec.email], subject: 'Your DIY Inventory report link and receipt', text })
    });
    if (!res.ok) { console.error('report purchase email failed: HTTP ' + res.status, (await res.text().catch(() => '')).slice(0, 300)); return false; }
    return true;
  } catch (e) { console.error('report purchase email failed:', e.message); return false; }
}

function mount(app, ctx){
  FILE = path.join(ctx.REPORTS_DIR, 'report-purchases.json');
  const { renderPage, clientIp, limiter, notify, track, PUBLIC_BASE } = ctx;
  const baseOf = req => (PUBLIC_BASE || ctx.canonicalBase(req)).replace(/\/+$/, '');
  const linkOf = (rec, req) => baseOf(req) + '/?access=' + rec.token;
  const checkoutLimit = limiter(10, 60 * 60 * 1000), doneLimit = limiter(300, 60 * 60 * 1000);
  const lastCheck = new Map();

  // Checks a purchase with its provider (at most every 3 seconds) and, the first time it is paid, tells the owner,
  // counts the sale and emails the buyer.
  async function settle(rec, req){
    if (!rec || rec.status === 'paid') return rec;
    const last = lastCheck.get(rec.ref) || 0; if (Date.now() - last < 3000) return rec;
    lastCheck.set(rec.ref, Date.now()); if (lastCheck.size > 2000) lastCheck.clear();
    let v; try { v = await payments.verify({ provider: rec.provider, providerId: rec.providerId, ref: rec.ref, amountPence: PENCE, tag: 'report' }); }
    catch (e) { console.error('report: checking ' + rec.ref + ' failed: ' + e.message); return rec; }
    if (!v.paid) return update(rec.ref, r => { r.providerStatus = v.status; }) || rec;
    let first = false;
    const out = update(rec.ref, r => { if (r.status !== 'paid') { first = true; r.status = 'paid'; r.paidAt = new Date().toISOString(); r.providerRef = v.providerRef || r.providerRef || ''; r.providerStatus = v.status; } });
    if (first) {
      console.log('report: paid ' + rec.ref + ' (' + rec.provider + ')');
      if (track) track(req, 'report_purchase', PRICE);
      if (notify) notify({ title: 'Report sold: ' + PRICE_TEXT, message: [(out.name || out.email) ? [out.name, out.email].filter(Boolean).join(' · ') : 'No name or email given', (out.for === 'tenant' ? 'Bought for a tenant' : 'Bought on /buy') + ' · paid by ' + (rec.provider === 'sumup' ? 'SumUp' : 'Stripe')].join('\n'), tags: ['moneybag'], click: PUBLIC_BASE ? PUBLIC_BASE.replace(/\/+$/, '') + '/admin#purchases' : '' });
      const link = PUBLIC_BASE ? PUBLIC_BASE.replace(/\/+$/, '') + '/?access=' + out.token : req ? linkOf(out, req) : '';
      if (out.email && link) emailBuyer(out, link).then(ok => { if (ok) update(rec.ref, r => { r.emailedAt = new Date().toISOString(); }); });
    }
    return out;
  }

  /* ------------------------------------------------------------ pages */
  const tick = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const head = '<style>' + CSS + '</style>';
  function buyPage(req, o){
    const forTenant = o.for === 'tenant', fromApp = o.from === 'app', on = !!payments.provider();
    const lead = fromApp ? 'Pay once to download your finished report, send it, and get it signed. Your report is saved on your phone and waiting for you.'
      : forTenant ? 'Pay now and send your tenant the link. They do the whole report on their phone and never see a price.'
      : 'One check-in, check-out or inspection, done on your phone, with a professional PDF report.';
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Buy a report</span><h1>${forTenant ? 'Buy a report for your tenant' : 'Buy a report'} · ${PRICE_TEXT}</h1><p>${lead}</p></div></div>
<section class="tight"><div class="wrap buy-grid${fromApp ? " pay-top" : ""}">
  <div class="card buy-what">
    <h2>What you get</h2>
    <ul class="buy-list">
      <li>${tick}<span><b>One report</b>: a check-in, a check-out or an inspection, for one property</span></li>
      <li>${tick}<span>A guided photo checklist for every room, with the date and time on every photo</span></li>
      <li>${tick}<span>Meters, keys, your signature and declaration</span></li>
      <li>${tick}<span>A professional PDF report, ready the moment it’s signed</span></li>
      <li>${tick}<span>Tenant sign-off on their phone, added to the report as a signed page</span></li>
      <li>${tick}<span>${forTenant ? 'Your tenant opens the link and does the report: they never see a price' : 'Use it yourself, or send the link to your tenant: they never see a price'}</span></li>
    </ul>
    <p class="buy-small">No subscription and no monthly fee. Prices are in pounds sterling (GBP); if your card is in another currency, your bank converts it.</p>
  </div>
  <div class="card buy-pay">
    <div class="buy-amt">${PRICE_TEXT}</div>
    <div class="buy-amt-sub">One report · paid once</div>
    ${on ? `<form class="form" method="post" action="/buy">
      <input type="hidden" name="for" value="${forTenant ? 'tenant' : ''}"><input type="hidden" name="from" value="${fromApp ? 'app' : ''}">
      <label><b>Your name <span>optional</span></b><input name="name" autocomplete="name" maxlength="80" value="${esc(o.name || '')}"></label>
      <label><b>Your email <span>optional, for your receipt and your link</span></b><input name="email" type="email" autocomplete="email" inputmode="email" maxlength="120" value="${esc(o.email || '')}"></label>
      <button class="btn primary buy-btn" type="submit">Pay ${PRICE_TEXT}</button>
      <p class="buy-small">You pay by card on our payment provider’s secure page${payments.provider() === 'sumup' ? ' (SumUp)' : ' (Stripe)'}, then come straight back here for your link.</p>
    </form>` : `<div class="buy-off"><b>Card payments are being switched on.</b><p>You can’t pay online just yet. <a href="/contact">Contact us</a> and we’ll set you up with a report straight away. Been given an access code? Enter it below.</p><a class="btn primary buy-btn" href="/contact">Contact us</a></div>`}
    <details class="buy-code"${on ? '' : ' open'}><summary>Have a link or an access code?</summary>
      <form method="get" action="/"><input name="access" placeholder="Link or access code" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Access code" required><button class="btn ghost">Go</button></form>
    </details>
  </div>
</div></section>`;
    return renderPage({ key: 'buy', path: '/buy', title: 'Buy a report · ' + PRICE_TEXT + ' · DIY Inventory', og: 'Buy a DIY Inventory report · ' + PRICE_TEXT,
      desc: 'Buy one DIY Inventory report for ' + PRICE_TEXT + ': a check-in, check-out or inspection done on your phone. Use it yourself or send the link to your tenant.',
      body, head: head + (forTenant || fromApp || o.notice ? '<meta name="robots" content="noindex, follow">' : ''),
      jsonld: base => [{ '@type': 'Product', name: 'DIY Inventory report', description: 'One property inventory report: a check-in, check-out or inspection, done on your phone, with a PDF report.', brand: { '@id': base + '/#org' },
        offers: { '@type': 'Offer', price: PRICE.toFixed(2), priceCurrency: 'GBP', availability: 'https://schema.org/InStock', url: base + '/buy', seller: { '@id': base + '/#org' } } }] }, req, o.notice);
  }
  function donePage(req, rec){
    const link = linkOf(rec, req), fromApp = rec.from === 'app';
    const msg = 'Here’s your link to do the property inventory report on your phone with DIY Inventory. It’s already paid for: open it on the phone you’ll take the photos with.';
    const wa = 'https://wa.me/?text=' + encodeURIComponent(msg + '\n' + link);
    const sms = 'sms:?&body=' + encodeURIComponent(msg + ' ' + link);
    const mail = 'mailto:?subject=' + encodeURIComponent('Your inventory report link') + '&body=' + encodeURIComponent(msg + '\n\n' + link + '\n');
    const when = new Date(rec.paidAt || rec.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
    const used = !!rec.usedAt;
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Payment received</span><h1>Paid. Your report is ready</h1>
<p>${used ? 'A report has already been made with this link.' : fromApp ? 'Your report is unlocked on this phone. Go back to it to download it and send it.' : 'Start it now on this phone, or send the link to your tenant: they do the report and never see a price.'}</p>
<div class="cta buy-cta"><a class="btn primary buy-start" href="${fromApp ? '/app?paid=1' : '/app'}">${fromApp ? 'Back to your report' : 'Start the report'}</a></div></div></div>
<section class="tight"><div class="wrap buy-done">
  <div class="card buy-link">
    <h2>Your personal link</h2>
    <p class="buy-small">Keep this link: it’s your access to this report. Open it on any phone to start or carry on.</p>
    <div class="buy-copy"><input id="buyLink" readonly value="${esc(link)}" aria-label="Your personal link" onclick="this.select()"><button type="button" class="btn primary" id="copyBtn">Copy</button></div>
    ${used ? '' : `<h3>Send it to your tenant</h3>
    <p class="buy-small">They open it on their phone, do the walk-round, and the finished report is unlocked for them straight away.</p>
    <div class="buy-share">
      <button type="button" class="btn primary" id="shareBtn" hidden>Share…</button>
      <a class="btn ghost" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn ghost" href="${esc(sms)}">Text message</a>
      <a class="btn ghost" href="${esc(mail)}">Email</a>
    </div>`}
  </div>
  <div class="card buy-receipt">
    <h2>Receipt</h2>
    <dl>
      <dt>Item</dt><dd>DIY Inventory report (one check-in, check-out or inspection)</dd>
      <dt>Amount paid</dt><dd>£${Number(rec.amount).toFixed(2)}</dd>
      <dt>Paid</dt><dd>${esc(when)} · by card</dd>
      ${rec.providerRef ? `<dt>Payment reference</dt><dd>${esc(rec.providerRef)}</dd>` : ''}
      <dt>Order reference</dt><dd>${esc(rec.ref)}</dd>
      <dt>Status</dt><dd>${used ? 'Used for a report' : 'Ready to use'}</dd>
    </dl>
    <p class="buy-small">${rec.email ? (env('RESEND_API_KEY') ? 'We’ve emailed your link and this receipt to ' + esc(rec.email) + '.' : 'Save or screenshot this page for your records.') : 'Save or screenshot this page for your records: it’s your receipt.'}</p>
  </div>
</div></section>
<script>(function(){var i=document.getElementById('buyLink'),c=document.getElementById('copyBtn'),s=document.getElementById('shareBtn');
c.addEventListener('click',function(){var done=function(){c.textContent='Copied';setTimeout(function(){c.textContent='Copy'},2000)};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(i.value).then(done,function(){i.select();document.execCommand('copy');done()});else{i.select();document.execCommand('copy');done()}});
if(s&&navigator.share){s.hidden=false;s.addEventListener('click',function(){navigator.share({title:'Your inventory report link',text:${JSON.stringify(msg).replace(/</g, '\\u003c')},url:i.value}).catch(function(){})})}})();</script>`;
    return renderPage({ key: 'buy', path: '/buy/done', title: 'Paid · your report is ready · DIY Inventory', desc: 'Your DIY Inventory report is paid for and ready.', body,
      head: head + '<meta name="robots" content="noindex, nofollow">', jsonld: [] }, req);
  }
  function waitPage(req, ref, n){
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Payment</span><h1>${n < 10 ? 'Checking your payment…' : 'We haven’t had confirmation yet'}</h1>
<p>${n < 10 ? 'This takes a few seconds. Please keep this page open.' : 'If you paid, it can take a minute to come through. Check again in a moment. Nothing will be taken twice.'}</p>
<div class="cta buy-cta"><a class="btn primary" href="/buy/done?ref=${ref}&amp;n=${n + 1}">Check again</a><a class="btn ghost" href="/contact">Contact us</a></div></div></div>`;
    return renderPage({ key: 'buy', path: '/buy/done', title: 'Checking your payment · DIY Inventory', desc: 'Checking your payment.', body,
      head: head + '<meta name="robots" content="noindex, nofollow">' + (n < 10 ? '<meta http-equiv="refresh" content="3;url=/buy/done?ref=' + ref + '&amp;n=' + (n + 1) + '">' : ''), jsonld: [] }, req);
  }
  const optsOf = q => ({ for: q.for === 'tenant' ? 'tenant' : '', from: q.from === 'app' ? 'app' : '' });
  const qs = o => { const p = []; if (o.for) p.push('for=tenant'); if (o.from) p.push('from=app'); return p.length ? '?' + p.join('&') : ''; };

  app.get(['/buy', '/buy/'], (req, res) => {
    const o = optsOf(req.query);
    if (req.query.cancelled) o.notice = { text: 'Payment cancelled. Nothing has been taken. You can try again whenever you like.' };
    if (req.query.failed) o.notice = { text: 'The payment didn’t go through and nothing has been taken. Please try again.' };
    res.set('Cache-Control', 'no-store').type('html').send(buyPage(req, o));
  });
  app.post(['/buy', '/buy/'], express.urlencoded({ extended: false, limit: '8kb' }), async (req, res) => {
    const b = req.body || {}, o = optsOf(b);
    o.name = clip(b.name, 80); o.email = clip(b.email, 120).toLowerCase();
    if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) return res.status(400).type('html').send(buyPage(req, Object.assign(o, { notice: { text: 'Please check your email address, or leave it blank.' } })));
    const prov = payments.provider();
    if (!prov) return res.status(503).type('html').send(buyPage(req, o));
    if (!checkoutLimit(clientIp(req))) return res.status(429).type('html').send(buyPage(req, Object.assign(o, { notice: { text: 'Too many payment attempts from here. Please try again in a while.' } })));
    const rec = { ref: crypto.randomBytes(12).toString('hex'), token: 'RPT-' + crypto.randomBytes(18).toString('base64url'), provider: prov, providerId: '', providerRef: '', amount: PRICE, currency: 'GBP', status: 'pending',
      name: o.name, email: o.email, for: o.for, from: o.from, createdAt: new Date().toISOString(), paidAt: '', usedAt: '' };
    const base = ctx.canonicalBase(req);
    try {
      const c = await payments.createCheckout({ provider: prov, ref: rec.ref, amountPence: PENCE, name: 'DIY Inventory report', detail: 'One check-in, check-out or inspection', email: rec.email,
        returnUrl: base + '/buy/done?ref=' + rec.ref, cancelUrl: base + '/buy/cancel?ref=' + rec.ref, hookUrl: base + '/api/buy/webhook', tag: 'report' });
      rec.providerId = c.id;
      const d = readAll(); d.list.push(rec); writeAll(d);
      console.log('report: checkout ' + rec.ref + ' created (' + prov + (rec.for ? ', for a tenant' : '') + (rec.from ? ', from the app' : '') + ')');
      res.redirect(303, c.url);
    } catch (e) {
      if (e.message !== 'provider') console.error('report: checkout failed: ' + e.message);
      res.status(502).type('html').send(buyPage(req, Object.assign(o, { notice: { text: 'The payment page couldn’t be opened just now. Please try again in a minute.' } })));
    }
  });
  app.get('/buy/done', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ref = String(req.query.ref || ''), n = Math.max(0, Math.min(99, parseInt(req.query.n, 10) || 0));
    if (!doneLimit(clientIp(req))) return res.status(429).type('html').send(buyPage(req, { notice: { text: 'Too many requests. Please wait a moment.' } }));
    const rec0 = REF_RE.test(ref) ? find('ref', ref) : null;
    if (!rec0) return res.status(404).type('html').send(buyPage(req, { notice: { text: 'We couldn’t find that payment. If you paid, please contact us with your card payment reference.' } }));
    if (!n) lastCheck.delete(ref);
    const rec = await settle(rec0, req);
    if (!rec || rec.status !== 'paid') {
      const st = String((rec || rec0).providerStatus || '');
      if (/failed|expired|cancel/.test(st)) { const q = qs(rec0); return res.redirect(302, '/buy' + (q ? q + '&' : '?') + 'failed=1'); }
      return res.status(202).type('html').send(waitPage(req, ref, n));
    }
    // The buyer's browser gets the token straight away, as /?access= does, so the app is unlocked here.
    if (!rec.usedAt) res.setHeader('Set-Cookie', 'diy_access=' + rec.token + '; Path=/; Max-Age=' + 200 * 86400 + '; HttpOnly; Secure; SameSite=Lax');
    res.type('html').send(donePage(req, rec));
  });
  app.get('/buy/cancel', (req, res) => {
    const ref = String(req.query.ref || ''), rec = REF_RE.test(ref) ? find('ref', ref) : null;
    const q = qs(rec || {});
    res.redirect(302, '/buy' + (q ? q + '&' : '?') + 'cancelled=1');
  });
  app.post('/api/buy/webhook', express.json({ limit: '16kb' }), (req, res) => {
    // Only a nudge: the checkout is looked up by its id and checked with SumUp itself.
    const id = String((req.body || {}).id || (req.body || {}).checkout_id || '').slice(0, 80);
    const rec = id ? find('providerId', id) : null;
    if (rec) { lastCheck.delete(rec.ref); settle(rec, null).catch(() => {}); }
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------ /admin */
  if (ctx.addAdminSection) ctx.addAdminSection(req => {
    const all = readAll().list, paid = all.filter(r => r.status === 'paid').reverse(), pending = all.filter(r => r.status !== 'paid').length;
    const revenue = Math.round(paid.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100, unused = paid.filter(r => !r.usedAt).length, prov = payments.provider();
    const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const rows = paid.slice(0, 300).map(r => `<li><div style="flex:1;min-width:0"><strong>${esc(r.name || r.email || 'No name given')}</strong> <span class="pill sent">£${Number(r.amount).toFixed(2)}</span> ${r.usedAt ? '<span class="pill">Used</span>' : '<span class="pill sent">Not used yet</span>'}
      <div class="sub">${esc(when(r.paidAt || r.createdAt))}${r.email ? ' · <a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : ''}${r.for === 'tenant' ? ' · for a tenant' : ''} · ${r.provider === 'sumup' ? 'SumUp' : 'Stripe'}${r.providerRef ? ' · ' + esc(r.providerRef) : ''} · ref ${esc(r.ref)}${r.usedAt ? ' · used ' + esc(when(r.usedAt)) + (r.usedFor ? ' for ' + esc(r.usedFor) : '') : ''}${r.emailedAt ? ' · link emailed' : ''}</div>
      <input readonly value="${esc(linkOf(r, req))}" onclick="this.select()" aria-label="Link to resend" style="width:100%;margin-top:6px;font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit"></div></li>`).join('');
    return `<details class="codes" id="purchases"><summary>💷 Report purchases <span class="sub" style="display:inline">— ${paid.length ? paid.length + ' sold, £' + revenue.toFixed(2) + ' · ' + unused + ' not used yet' : 'none sold yet'}${pending ? ' · ' + pending + ' started, not paid' : ''}</span></summary>
<p class="sub" style="margin-top:12px">${PRICE_TEXT} each, on <a href="/buy" target="_blank" rel="noopener">/buy</a>. Card payments: ${prov ? '<b>' + (prov === 'sumup' ? 'SumUp' : 'Stripe') + '</b>' : '<b>not set up</b> (set SUMUP_API_KEY and SUMUP_MERCHANT_CODE, or STRIPE_SECRET_KEY, in Railway). Until then /buy asks people to contact you'}. Copy a link below to send it to the buyer again.</p>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  });

  console.log('report purchases: card payments ' + (payments.provider() || 'off (set SUMUP_API_KEY + SUMUP_MERCHANT_CODE, or STRIPE_SECRET_KEY)'));
  return { paths: ['/buy'] };
}

const CSS = `.buy-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 20px; max-width: 980px; margin: 0 auto; align-items: start; }
.buy-what h2, .buy-link h2, .buy-receipt h2 { margin: 0 0 12px; font-size: 22px; }
.buy-list { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 11px; }
.buy-list li { display: flex; gap: 10px; align-items: flex-start; } .buy-list svg { flex: none; margin-top: 4px; color: var(--good); }
.buy-small { color: var(--ink-faint); font-size: 14px; margin: 0; }
.buy-pay { position: relative; overflow: hidden; padding-top: 30px; }
.buy-pay::before { content: ""; position: absolute; inset: 0 0 auto; height: 6px; background: var(--grad); }
.buy-amt { font: 800 56px/1 'Plus Jakarta Sans', sans-serif; letter-spacing: -.04em; text-align: center; }
.buy-amt-sub { text-align: center; color: var(--ink-faint); font-size: 14px; margin: 4px 0 18px; }
.buy-btn { width: 100%; font-size: 17px; padding: 16px 24px; }
.buy-off b { display: block; font-size: 16px; } .buy-off p { color: var(--ink-soft); font-size: 15px; margin: 6px 0 14px; }
.buy-code { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 12px; }
.buy-code summary { cursor: pointer; font-weight: 600; font-size: 14.5px; color: var(--ink-soft); }
.buy-code form { display: flex; gap: 8px; margin-top: 10px; }
.buy-code input { flex: 1; min-width: 0; padding: 12px 16px; border: 0; background: var(--bg); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); border-radius: 999px; font: inherit; font-weight: 600; }
.buy-code input:focus { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
.buy-cta { justify-content: center; margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap; }
.buy-start { font-size: 18px; padding: 18px 34px; min-width: 260px; }
.buy-done { display: grid; grid-template-columns: 1.2fr .8fr; gap: 20px; max-width: 980px; margin: 0 auto; align-items: start; }
.buy-link h3 { margin: 22px 0 4px; font-size: 17px; }
.buy-copy { display: flex; gap: 8px; margin: 12px 0 4px; }
.buy-copy input { flex: 1; min-width: 0; padding: 13px 16px; border: 0; border-radius: 14px; background: var(--bg); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); font: inherit; font-size: 14.5px; font-weight: 600; }
.buy-share { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; } .buy-share .btn { flex: 1 1 130px; padding: 12px 16px; }
.buy-receipt dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; margin: 0 0 14px; font-size: 14.5px; }
.buy-receipt dt { color: var(--ink-faint); font-weight: 600; } .buy-receipt dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 820px) { .buy-grid, .buy-done { grid-template-columns: 1fr; } .pay-top .buy-pay { order: -1; } .buy-start { min-width: 0; width: 100%; } .buy-copy { flex-wrap: wrap; } .buy-copy .btn { flex: 1 1 100%; } }`;

module.exports = { mount, access, markUsed, isToken, PRICE, PRICE_TEXT };
