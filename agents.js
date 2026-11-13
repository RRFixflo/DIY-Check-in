// For letting agents and landlords with several properties: /agents.
// What it costs against an inventory clerk (a calculator), how tenant links work, prepaid packs (10, 25 or 50 reports,
// paid by card on /buy, which becomes a prepaid tenant link: purchases.js + reports.js addAgentCredits) and a
// "Talk to us" form for bigger volumes.
//
//   GET  /agents                 the page (in the sitemap); ?sent=1 thanks; ?err=…&pack=N after a pack payment problem
//   POST /agents                 the enquiry form: name, company, email, phone, properties, reports a year, message
//
// Enquiries are kept in REPORTS_DIR/agent-enquiries.json (the last 500), alert the owner (ntfy) and are listed on
// /admin → Enquiries → "🏢 Agent & landlord enquiries", with where each one came from.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mount(app, ctx){
  const FILE = path.join(ctx.REPORTS_DIR, 'agent-enquiries.json');
  const read = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { seenAt: d.seenAt || '', list: Array.isArray(d.list) ? d.list : [] }; } catch (e) { return { seenAt: '', list: [] }; } };
  const write = d => { d.list = d.list.slice(-500); fs.writeFileSync(FILE + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
  const allowed = ctx.limiter(5, 60 * 60 * 1000);
  const PACKS = require('./purchases').PACKS;
  const sizes = Object.keys(PACKS).map(Number).sort((a, b) => a - b);
  const per = n => (PACKS[n] / n).toFixed(2);
  const payOn = () => !!require('./payments').provider();

  const ERR = {
    details: 'Please give your company or name and a valid email address for the pack, so we can send you the link and receipt.',
    off: 'Card payments aren’t switched on yet. Use the form below and we’ll set your pack up for you straight away.',
    busy: 'Too many payment attempts from here. Please try again in a while.',
    provider: 'The payment page couldn’t be opened just now. Please try again in a minute.',
    failed: 'The payment didn’t go through and nothing has been taken. Please try again.',
    cancelled: 'Payment cancelled. Nothing has been taken.',
  };

  function page(req, o){
    o = o || {};
    const pick = sizes.includes(Number(o.pack)) ? Number(o.pack) : 25;
    const f = o.form || {};
    const cards = sizes.map(n => `<label class="ag-pack${n === pick ? ' on' : ''}">
        <input type="radio" name="pack" value="${n}"${n === pick ? ' checked' : ''}>
        ${n === 25 ? '<span class="ag-tag">Most popular</span>' : ''}
        <span class="ag-n">${n} reports</span>
        <span class="ag-p">£${PACKS[n].toLocaleString('en-GB')}</span>
        <span class="ag-u">£${per(n)} a report · save ${Math.round((1 - PACKS[n] / n / 29.99) * 100)}%</span>
      </label>`).join('') + `<a class="ag-pack ag-more" href="#talk"><span class="ag-n">100+ reports</span><span class="ag-p">Let’s talk</span><span class="ag-u">From about £17 a report, several branches, monthly invoice</span></a>`;
    const faqs = [
      ['How does it work for my tenants?', 'You get one tenant link. Send the same link to every tenant moving in or out (by email, WhatsApp or text). They open it on their phone, are guided room by room through the photos, sign it, and the finished report is emailed to you. They never see a price.'],
      ['Can tenants do a check-out or an inspection too?', 'Yes. The link opens on a check-in, and the tenant can change it to a check-out, a mid-term inspection or a renewal inspection. A check-out can start from the check-in report, so it’s compared item by item.'],
      ['What happens when my pack runs out?', 'We email you when you have 2 reports left. Buy another pack with the same email address and the reports are added to the same link, so nothing changes for your tenants. If it does run out, tenants who open the link are asked to come back later.'],
      ['Do the reports expire?', 'No. Your prepaid reports stay on your link until you use them.'],
      ['Can I do the reports myself instead of the tenant?', 'Yes. Open the same link on your own phone and do the walk-round yourself. Each finished report uses one from your pack.'],
      ['We need more than 50 a year, or several branches.', 'Use the form on this page. We’ll set you up with a price per report for your volume, a link per branch if you like, and a monthly invoice instead of paying upfront.'],
      ['Is there a dashboard for my reports?', 'Yes. Every pack comes with your own agent dashboard: every report made with your link (address, type, who did it, whether the other party has signed), PDFs to download, reports still in progress, how many reports you have left, and a list you can download for a spreadsheet. The link to it is in your pack email and in every report email.'],
      ['Who sees the reports?', 'You (on your dashboard and by email), and the tenant who made it. Each report is also kept safely online, so it can’t be lost if a phone is.'],
    ];
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">For letting agents and landlords</span>
<h1>Inventories for every tenancy, at a fraction of a clerk’s price</h1>
<p>Send one link to all your tenants. Each one does their own check-in or check-out on their phone, with dated photos and a signature, and you get a professional report for every tenancy. From £${per(sizes[sizes.length - 1])} a report.</p>
<p class="ag-disc"><b>Landlords with several properties get the same discount as agents:</b> up to a third off every report.</p>
<div class="cta"><a class="btn primary" href="#packs">See the packs</a><a class="btn ghost" href="#talk">Talk to us</a></div></div></div>

<section class="tight"><div class="wrap">
  <div class="ag-steps">
    <div class="card"><b>1</b><h3>One link for every tenant</h3><p>Buy a pack and you get a tenant link straight away. Send it by email, WhatsApp or text.</p></div>
    <div class="card"><b>2</b><h3>The tenant does the walk-round</h3><p>A guided checklist for every room, date and time burned into every photo, meters, keys and a signature.</p></div>
    <div class="card"><b>3</b><h3>You get the report</h3><p>A professional PDF in your inbox, made to be used as evidence at the end of the tenancy. No visit, no clerk.</p></div>
  </div>
</div></section>

<section class="tight"><div class="wrap ag-dash">
  <div><span class="kicker">Your agent dashboard</span><h2>Every tenancy’s report, in one place</h2>
    <p>Each pack comes with a private dashboard. See which tenants have finished, which are still going, and which reports have been signed by the other party, then download any PDF in a tap.</p>
    <ul class="buy-list"><li>✓<span>Every report from your link: address, check-in or check-out, who did it, date</span></li><li>✓<span>Signed or not by the other party, and a sign-off link to send</span></li><li>✓<span>Reports still in progress, so you can chase them</span></li><li>✓<span>Reports left on your pack, with a one-tap top-up</span></li><li>✓<span>Download the whole list for your spreadsheet</span></li></ul>
    <p class="buy-small">Already have one? <a href="/agent/lost">Get your dashboard link</a>.</p></div>
  <div class="card ad-demo" aria-hidden="true">
    <div class="ad-demo-t"><div><span>Reports left</span><b>18</b></div><div><span>Made</span><b>32</b></div><div><span>In progress</span><b>2</b></div></div>
    <div class="ad-demo-r"><b>Flat 4, 12 High Street</b><span><i>Check-Out</i> 11 Nov · signed ✍️</span></div>
    <div class="ad-demo-r"><b>7 Mill Lane</b><span><i>Check-In</i> 9 Nov · awaiting signature</span></div>
    <div class="ad-demo-r"><b>22 Park Road</b><span><i>Inspection</i> 3 Nov · signed ✍️</span></div>
    <p class="buy-small" style="margin:10px 0 0">Example only</p>
  </div>
</div></section>

<section class="tight ag-band"><div class="wrap">
  <div class="sec-head"><span class="kicker">What you’d save</span><h2>Against an inventory clerk</h2><p>Type your own figures.</p></div>
  <div class="card ag-calc">
    <div class="form ag-calc-in">
      <label><b>Reports a year</b><input id="agN" type="number" min="1" max="5000" value="60" inputmode="numeric"></label>
      <label><b>What a clerk charges you, per report</b><input id="agC" type="number" min="0" max="2000" value="150" inputmode="decimal"></label>
    </div>
    <div class="ag-calc-out" aria-live="polite"><div><span>A clerk</span><b id="agClerk">£9,000</b></div><div><span>DIY Inventory</span><b id="agUs">£1,199</b></div><div class="ag-save"><span>You save</span><b id="agSave">£7,801</b></div></div>
    <p class="buy-small" id="agHow">Worked out with the best pack for that many reports.</p>
  </div>
</div></section>

<section class="tight" id="packs"><div class="wrap">
  <div class="sec-head"><span class="kicker">Prepaid packs</span><h2>Pay once, use them when you need them</h2><p>The reports don’t expire. Top up any time with the same email and they’re added to the same link.</p></div>
  ${o.err ? `<div class="notice" role="alert">${esc(ERR[o.err] || ERR.provider)}</div>` : ''}
  <form class="card ag-buy" method="post" action="/buy">
    <div class="ag-packs">${cards}</div>
    ${payOn() ? `<div class="form ag-buy-f">
      <div class="row"><label><b>Company or your name</b><input name="name" required maxlength="80" autocomplete="organization" value="${esc(f.name || '')}" placeholder="e.g. Smith &amp; Co Lettings"></label>
      <label><b>Your name <span>optional</span></b><input name="contact" maxlength="80" autocomplete="name" value="${esc(f.contact || '')}"></label></div>
      <label><b>Email</b><span style="font-weight:500">for your tenant link, your receipt and each finished report</span><input name="email" type="email" required maxlength="120" autocomplete="email" inputmode="email" value="${esc(f.email || '')}"></label>
      <button class="btn primary buy-btn" type="submit" id="agPay">Pay £${PACKS[pick].toLocaleString('en-GB')} for ${pick} reports</button>
      <p class="buy-small">You pay by card on our payment provider’s secure page, then come straight back here for your tenant link.</p>
    </div>` : `<div class="buy-off" style="margin-top:16px"><b>Card payments are being switched on.</b><p>Choose your pack and use the form below: we’ll set it up for you straight away.</p></div>`}
  </form>
</div></section>

<section class="tight ag-band" id="talk"><div class="wrap ag-talk">
  <div><span class="kicker">Talk to us</span><h2>Bigger volumes, branches or a monthly invoice</h2>
    <p>Tell us roughly how many tenancies you handle and we’ll come back with a price per report, set you up with a link per branch if you like, and answer any questions.</p>
    <ul class="buy-list"><li>✓<span>A price for your volume, from about £17 a report</span></li><li>✓<span>A tenant link for each branch or landlord</span></li><li>✓<span>Pay upfront, or a monthly invoice</span></li></ul></div>
  ${o.sent ? `<div class="card"><h3>Thank you</h3><p>We’ve got your message and will be in touch shortly, usually the same working day.</p></div>` : `<form class="card form" method="post" action="/agents">
    <div class="row"><label><b>Your name</b><input name="name" required maxlength="80" autocomplete="name" value="${esc(f.tname || '')}"></label>
    <label><b>Company <span>optional</span></b><input name="company" maxlength="100" autocomplete="organization" value="${esc(f.company || '')}"></label></div>
    <div class="row"><label><b>Email</b><input name="email" type="email" required maxlength="120" autocomplete="email" value="${esc(f.temail || '')}"></label>
    <label><b>Phone <span>optional</span></b><input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${esc(f.phone || '')}"></label></div>
    <div class="row"><label><b>Properties you manage <span>roughly</span></b><input name="properties" maxlength="20" inputmode="numeric" value="${esc(f.properties || '')}"></label>
    <label><b>Reports a year <span>roughly</span></b><input name="volume" maxlength="20" inputmode="numeric" value="${esc(f.volume || '')}"></label></div>
    <label><b>Anything else? <span>optional</span></b><textarea name="message" maxlength="3000" style="min-height:100px">${esc(f.message || '')}</textarea></label>
    <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-5000px">
    <button class="btn primary">Send</button>
  </form>`}
</div></section>

<section class="tight"><div class="wrap"><div class="sec-head"><h2>Questions</h2></div><div class="faq">
${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</div></div></section>
<script>(function(){
var P=${JSON.stringify(PACKS)},S=${JSON.stringify(sizes)};function gbp(v){return '£'+Math.round(v).toLocaleString('en-GB')}
function best(n){var c=n*29.99,k;for(var i=0;i<S.length;i++){k=S[i];var packs=Math.ceil(n/k),cost=packs*P[k];if(cost<c)c=cost}return c}
var N=document.getElementById('agN'),C=document.getElementById('agC');function calc(){var n=Math.max(0,parseInt(N.value,10)||0),cl=Math.max(0,parseFloat(C.value)||0),us=n?best(n):0;
document.getElementById('agClerk').textContent=gbp(n*cl);document.getElementById('agUs').textContent=gbp(us);document.getElementById('agSave').textContent=gbp(Math.max(0,n*cl-us))}
N.addEventListener('input',calc);C.addEventListener('input',calc);calc();
var b=document.getElementById('agPay');[].forEach.call(document.querySelectorAll('.ag-pack input'),function(r){r.addEventListener('change',function(){
[].forEach.call(document.querySelectorAll('.ag-pack'),function(l){l.classList.toggle('on',!!(l.querySelector('input')||{}).checked)});
if(b)b.textContent='Pay £'+P[r.value].toLocaleString('en-GB')+' for '+r.value+' reports'})});})();</script>`;
    return ctx.renderPage({ key: 'agents', path: '/agents', title: 'Inventories in bulk for letting agents & landlords · DIY Inventory',
      og: 'DIY Inventory for letting agents and landlords', desc: 'One link for all your tenants: check-ins and check-outs done on their phones, with dated photos and a signed PDF. Prepaid packs from £' + per(sizes[sizes.length - 1]) + ' a report.',
      body, head: '<style>' + CSS + '</style>' + (o.err || o.sent ? '<meta name="robots" content="noindex, follow">' : ''),
      jsonld: base => [{ '@type': 'Service', name: 'DIY Inventory for letting agents and landlords', provider: { '@id': base + '/#org' }, areaServed: 'GB',
        description: 'Prepaid packs of property inventory reports (check-ins, check-outs and inspections) done by tenants on their phones from one link.',
        offers: sizes.map(n => ({ '@type': 'Offer', name: n + ' reports', price: PACKS[n].toFixed(2), priceCurrency: 'GBP', url: base + '/agents#packs' })) },
        { '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] }, req, o.notice);
  }

  app.get(['/agents', '/agents/'], (req, res) => {
    const err = String(req.query.err || '');
    res.set('Cache-Control', 'no-store').type('html').send(page(req, { sent: !!req.query.sent, err: ERR[err] ? err : '', pack: req.query.pack, form: { name: clip(req.query.name, 80), email: clip(req.query.email, 120) } }));
  });
  app.post(['/agents', '/agents/'], express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    const b = req.body || {};
    if (clip(b.website, 200)) return res.redirect(303, '/agents?sent=1#talk');   // the hidden field only robots fill in
    const e = { name: clip(b.name, 80), company: clip(b.company, 100), email: clip(b.email, 120).toLowerCase(), phone: clip(b.phone, 30), properties: clip(b.properties, 20), volume: clip(b.volume, 20), message: clip(String(b.message || '').replace(/\r/g, ''), 3000) };
    const form = { tname: e.name, company: e.company, temail: e.email, phone: e.phone, properties: e.properties, volume: e.volume, message: e.message };
    if (!e.name || !EMAIL_RE.test(e.email)) return res.status(400).type('html').send(page(req, { form, notice: { text: 'Please give your name and a valid email address.' } }));
    if (!allowed(ctx.clientIp(req))) return res.status(429).type('html').send(page(req, { form, notice: { text: 'Too many messages from here. Please try again later, or email us.' } }));
    const d = read();
    const rec = Object.assign({ id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), status: 'new', origin: require('./origin').of(req, b) }, e);
    d.list.push(rec); write(d);
    console.log('agent enquiry: ' + (e.company || e.name) + (e.volume ? ', ' + e.volume + ' reports a year' : ''));
    try { require('./analytics').lead(req, 'agent', rec.origin); } catch (x) {}
    if (ctx.notify) ctx.notify({ title: 'Agent enquiry: ' + (e.company || e.name), message: [e.name + (e.company ? ' · ' + e.company : ''), e.email + (e.phone ? ' · ' + e.phone : ''), (e.properties ? e.properties + ' properties' : '') + (e.properties && e.volume ? ' · ' : '') + (e.volume ? e.volume + ' reports a year' : ''), e.message.slice(0, 200)].filter(Boolean).join('\n'), tags: ['office'], click: ctx.PUBLIC_BASE ? ctx.PUBLIC_BASE.replace(/\/+$/, '') + '/admin#agentleads' : '' });
    res.redirect(303, '/agents?sent=1#talk');
  });

  const ownerOk = req => ctx.isOwner(req) && (() => { const o = String(req.get('origin') || req.get('referer') || ''); try { return !o || new URL(o).host === req.get('host'); } catch (x) { return false; } })();
  app.post('/admin/agent-enquiries/:id', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Sign in on /admin first.');
    const d = read(), r = d.list.find(x => x.id === String(req.params.id));
    const st = String((req.body || {}).status || '');
    if (r && st === 'delete') d.list = d.list.filter(x => x !== r);
    else if (r && ['new', 'contacted', 'won', 'lost'].includes(st)) r.status = st;
    write(d); res.redirect(303, '/admin#agentleads');
  });

  if (ctx.addAdminSection) ctx.addAdminSection(req => {
    const d = read(), list = d.list.slice().reverse(), seen = d.seenAt, fresh = list.filter(r => !seen || r.at > seen).length;
    if (fresh) { d.seenAt = new Date().toISOString(); write(d); }
    const when = t => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const ST = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Not going ahead' };
    const rows = list.slice(0, 200).map(r => `<li><div style="flex:1;min-width:0"><strong>${esc(r.company || r.name)}</strong>${r.company ? ' · ' + esc(r.name) : ''} ${(!seen || r.at > seen) ? '<span class="pill sent">New</span>' : ''} <span class="pill">${esc(ST[r.status] || 'New')}</span>
      <div class="sub">${esc(when(r.at))} · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? ' · <a href="tel:' + esc(r.phone.replace(/[^\d+]/g, '')) + '">' + esc(r.phone) + '</a>' : ''}${r.properties ? ' · ' + esc(r.properties) + ' properties' : ''}${r.volume ? ' · ' + esc(r.volume) + ' reports a year' : ''}</div>
      ${r.message ? '<div class="sub" style="white-space:pre-wrap;margin-top:4px">' + esc(r.message) + '</div>' : ''}${require('./origin').html(r.origin, esc)}
      <form method="post" action="/admin/agent-enquiries/${esc(r.id)}" style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${Object.keys(ST).filter(k => k !== r.status).map(k => `<button class="btn" name="status" value="${k}">${esc(ST[k])}</button>`).join('')}<button class="btn danger" name="status" value="delete" onclick="return confirm('Delete this enquiry?')">Delete</button></form></div></li>`).join('');
    return `<details class="codes" id="agentleads"${fresh ? ' open' : ''}><summary>🏢 Agent &amp; landlord enquiries <span class="sub" style="display:inline">— ${list.length ? list.length + (fresh ? ' · ' + fresh + ' new' : '') : 'none yet'}</span></summary>
<p class="sub" style="margin-top:12px">From <a href="/agents" target="_blank" rel="noopener">/agents</a>. Packs bought online appear under Tenant links (with how many reports are left) and Report purchases.</p>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  });

  return { paths: ['/agents'] };
}

const CSS = `.buy-small { color: var(--ink-faint); font-size: 14px; margin: 0; }
.buy-btn { width: 100%; font-size: 17px; padding: 16px 24px; }
.buy-off b { display: block; font-size: 16px; } .buy-off p { color: var(--ink-soft); font-size: 15px; margin: 6px 0 14px; }
.ag-disc { display: inline-block; background: var(--soft); border-radius: 16px; padding: 8px 16px; font-size: 15px; margin: 4px auto 14px; }
.page-head .cta { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; }
.ag-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.ag-steps .card b { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--grad); color: #fff; font-size: 15px; }
.ag-steps h3 { margin: 12px 0 6px; font-size: 18px; } .ag-steps p { margin: 0; color: var(--ink-soft); }
.ag-band { background: var(--soft); padding-top: 56px; }
.ag-calc { max-width: 860px; margin: 0 auto; }
.ag-calc-in { grid-template-columns: 1fr 1fr; }
.ag-calc-out { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 18px 0 8px; }
.ag-calc-out div { background: var(--bg); border-radius: 16px; padding: 14px 16px; box-shadow: inset 0 0 0 1px var(--line); }
.ag-calc-out span { display: block; color: var(--ink-faint); font-size: 13.5px; font-weight: 600; }
.ag-calc-out b { font-size: clamp(22px, 3vw, 30px); letter-spacing: -.02em; }
.ag-calc-out .ag-save { background: var(--grad); box-shadow: none; } .ag-calc-out .ag-save span, .ag-calc-out .ag-save b { color: #fff; }
.ag-buy { max-width: 980px; margin: 0 auto; }
.ag-packs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.ag-pack { position: relative; display: grid; gap: 4px; padding: 20px 16px 16px; border-radius: 18px; background: var(--bg); box-shadow: inset 0 0 0 1px var(--line); cursor: pointer; text-align: center; color: inherit; text-decoration: none; }
.ag-pack input { position: absolute; opacity: 0; pointer-events: none; }
.ag-pack.on, .ag-pack:has(input:checked) { box-shadow: inset 0 0 0 2px var(--accent); }
.ag-pack:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.ag-tag { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: var(--accent); color: #fff; font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.ag-n { font-weight: 700; } .ag-p { font-size: 30px; font-weight: 800; letter-spacing: -.03em; } .ag-u { color: var(--ink-faint); font-size: 13px; }
.ag-more { background: transparent; box-shadow: inset 0 0 0 1px dashed var(--line); border: 1px dashed var(--line); } .ag-more .ag-p { font-size: 22px; padding: 6px 0; }
.ag-buy-f { margin-top: 20px; }
.ag-talk { display: grid; grid-template-columns: .9fr 1.1fr; gap: 28px; align-items: start; max-width: 1040px; }
.ag-talk h2 { font-size: clamp(26px, 3.2vw, 36px); line-height: 1.15; margin: 8px 0 12px; } .ag-talk > div > p { color: var(--ink-soft); }
.ag-talk .kicker { color: var(--accent); font-weight: 700; font-size: 13.5px; text-transform: uppercase; letter-spacing: .08em; }
.ag-talk .buy-list { list-style: none; padding: 0; display: grid; gap: 8px; } .ag-talk .buy-list li { display: flex; gap: 10px; }
.ag-dash { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: center; max-width: 1040px; }
.ag-dash h2 { font-size: clamp(26px, 3.2vw, 36px); line-height: 1.15; margin: 8px 0 12px; } .ag-dash > div > p { color: var(--ink-soft); }
.ag-dash .kicker { color: var(--accent); font-weight: 700; font-size: 13.5px; text-transform: uppercase; letter-spacing: .08em; }
.ag-dash .buy-list { list-style: none; padding: 0; display: grid; gap: 8px; } .ag-dash .buy-list li { display: flex; gap: 10px; }
.ad-demo-t { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
.ad-demo-t div { background: var(--bg); border-radius: 12px; padding: 10px 12px; box-shadow: inset 0 0 0 1px var(--line); } .ad-demo-t span { display: block; font-size: 12px; color: var(--ink-faint); font-weight: 600; } .ad-demo-t b { font-size: 24px; }
.ad-demo-r { display: grid; gap: 2px; padding: 10px 0; border-top: 1px solid var(--line); } .ad-demo-r span { font-size: 13px; color: var(--ink-soft); }
.ad-demo-r i { font-style: normal; background: var(--soft); color: var(--accent); font-weight: 700; font-size: 11.5px; padding: 1px 8px; border-radius: 999px; margin-right: 4px; }
@media (max-width: 860px) { .ag-dash, .ag-steps, .ag-talk { grid-template-columns: 1fr; } .ag-packs { grid-template-columns: 1fr 1fr; } }
@media (max-width: 560px) { .ag-calc-in, .ag-calc-out { grid-template-columns: 1fr; } .form .row { grid-template-columns: 1fr; } }`;

module.exports = { mount };
