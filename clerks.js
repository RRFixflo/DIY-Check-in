// For inventory companies (clerk firms): use DIY Inventory as their own inventory software, in their own brand, for a
// monthly fee (the owner: "market to inventory companies to use my software for a monthly fee… they can brand it how they want").
//
//   GET  /inventory-companies     the page (in the sitemap); ?sent=1 thanks
//        /white-label-inventory-software, /inventory-software-for-clerks → 301 here
//   POST /inventory-companies     the enquiry form: name, company, email, phone, clerks, reports a month, message
//
// No price is published: each company gets a monthly price for its size. Branding (logo, colours, company name on the
// app, the reports and the emails; their own web address) is set up by us for each company.
// Enquiries are kept in REPORTS_DIR/clerk-enquiries.json (the last 500), alert the owner (ntfy) and are listed on
// /admin → Enquiries → "🧾 Inventory company enquiries" (#clerkleads) with a status.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATH = '/inventory-companies';

const FAQS = [
  ['What does it cost?', 'One monthly fee for your company, set by the size of your team and how many reports you do. Tell us roughly on the form and we’ll send you a price. You aren’t charged per report on top.'],
  ['Can we really brand it as our own?', 'Yes. Your logo, your colours and your company name on the app your clerks use, on every report and on the emails that go with them, and it can run on your own web address (for example reports.yourcompany.co.uk). Your clients see your brand, not ours.'],
  ['How long does it take to get going?', 'Send us your logo and colours and we set your branded version up for you. Your clerks open it in the browser on their phones: there is nothing to install and no training course needed.'],
  ['Do our clerks need special phones or tablets?', 'No. It runs in the browser on any recent iPhone or Android phone, and on tablets. Photos are taken in the app and the report is built on the phone.'],
  ['Can we use our own checklists and wording?', 'Every report starts from a room-by-room checklist, and clerks can add, remove and rename rooms and items as they go. Tell us about your house style and we’ll talk through what we can set up for you.'],
  ['Can tenants or landlords sign the report?', 'Yes. Each report has a sign-off link: the tenant (or landlord) goes through it room by room, adds comments under any item and signs with a finger. The signed copy is kept with the report.'],
  ['What about check-outs?', 'A check-out starts from the check-in report: each item shows how it was then, and the report lists what has changed, with the earlier and new photos side by side.'],
  ['Can we offer clients a cheaper self check-in?', 'Yes. You can send a tenant a link to do their own check-in or inspection in your brand, and you get the report. It lets you offer a lower-priced service without a visit.'],
  ['Where are the reports kept?', 'Every report is backed up online as it is made, so a lost or broken phone loses nothing, and you have a dashboard of every report with the PDFs to download.'],
  ['Can we try it first?', 'Yes. Use the form and we’ll give you access to do a real report on a real property before you decide.'],
];

function mount(app, ctx){
  const FILE = path.join(ctx.REPORTS_DIR, 'clerk-enquiries.json');
  const read = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { seenAt: d.seenAt || '', list: Array.isArray(d.list) ? d.list : [] }; } catch (e) { return { seenAt: '', list: [] }; } };
  const write = d => { d.list = d.list.slice(-500); fs.writeFileSync(FILE + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
  const allowed = ctx.limiter(5, 60 * 60 * 1000);
  const AG_CSS = require('./agents').CSS;

  function page(req, o){
    o = o || {};
    const f = o.form || {};
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">For inventory companies</span>
<h1>Your own inventory app, in your brand, for one monthly fee</h1>
<p>Give your clerks a fast, guided inventory app on their phones, with your logo, your colours and your name on every report. No typing up back at the office, no per-report charges, nothing to install.</p>
<div class="cta"><a class="btn primary" href="#talk">Get a monthly price</a><a class="btn ghost" href="/example-report">See an example report</a></div></div></div>

<section class="tight"><div class="wrap cl-brand">
  <div><span class="kicker">Brand it how you want</span><h2>Your clients see your company, not ours</h2>
    <p>We set the app up in your brand. Your clerks use it, your clients receive it, your name is on it.</p>
    <ul class="buy-list">
      <li>✓<span>Your logo and colours on the app your clerks use</span></li>
      <li>✓<span>Your company name and logo on every PDF report</span></li>
      <li>✓<span>Report and sign-off emails sent in your name</span></li>
      <li>✓<span>Your own web address, such as reports.yourcompany.co.uk</span></li>
    </ul>
    <p class="cl-try">Try a colour: <button type="button" data-c="#1F3A5F" style="--s:#1F3A5F" aria-label="Navy"></button><button type="button" data-c="#0F766E" style="--s:#0F766E" aria-label="Teal"></button><button type="button" data-c="#7C2D12" style="--s:#7C2D12" aria-label="Rust"></button><button type="button" data-c="#6D28D9" style="--s:#6D28D9" aria-label="Purple"></button><button type="button" data-c="#111827" style="--s:#111827" aria-label="Black"></button></p>
  </div>
  <div class="cl-mock" id="clMock" aria-hidden="true">
    <div class="cl-cover"><div class="cl-logo"><span></span>Your Company<small>Inventory &amp; Check-in Services</small></div>
      <div class="cl-title">CHECK-IN REPORT</div><div class="cl-addr">Flat 4, 12 High Street<br>London SE1 6AD</div>
      <div class="cl-bars"><i style="width:62%"></i><i style="width:24%"></i><i style="width:9%"></i></div>
      <div class="cl-meta"><span>Prepared by<b>Your clerk</b></span><span>Rooms<b>6</b></span><span>Photos<b>94</b></span></div></div>
    <div class="cl-phone"><div class="cl-bar">Your Company</div><div class="cl-ph">PHOTOGRAPH<b>Oven</b></div><div class="cl-btn">Take photo</div></div>
  </div>
</div></section>

<section class="tight ag-band"><div class="wrap">
  <div class="sec-head"><span class="kicker">Why inventory companies switch</span><h2>More reports a day, less time at the desk</h2></div>
  <div class="ag-steps cl-grid">
    <div class="card"><b>1</b><h3>Finished on site</h3><p>The report is built on the phone as the clerk walks round. Sign it and the PDF is ready before they leave the property.</p></div>
    <div class="card"><b>2</b><h3>Guided, room by room</h3><p>A checklist for every room and an in-app camera that steps through each item, so nothing is missed and every clerk works the same way.</p></div>
    <div class="card"><b>3</b><h3>Dated photo evidence</h3><p>The date and time are burned into every photo, and every photo in the report links to the full-size picture.</p></div>
    <div class="card"><b>4</b><h3>Check-outs in minutes</h3><p>Start from the check-in: each item shows how it was, and the changes are listed with the earlier and new photos side by side.</p></div>
    <div class="card"><b>5</b><h3>Signed by the tenant</h3><p>Send a sign-off link. The tenant reviews each room, comments where they disagree and signs with a finger. The signed copy is kept.</p></div>
    <div class="card"><b>6</b><h3>Nothing lost</h3><p>Every report is backed up online as it is made, and you have a dashboard of every report with its PDF.</p></div>
    <!--AI--><div class="card"><b>7</b><h3>AI help with condition notes</h3><p>Each item photo can suggest a condition, a short description and any marks, for the clerk to accept or change.</p></div><!--/AI-->
    <div class="card"><b><!--AI-->8<!--/AI--><!--NOAI-->7<!--/NOAI--></b><h3>A new service to sell</h3><p>Offer clients a lower-priced tenant self check-in or mid-term inspection by link, in your brand, with no visit.</p></div>
  </div>
</div></section>

<section class="tight"><div class="wrap">
  <div class="sec-head"><span class="kicker">One monthly fee</span><h2>Priced for your company, not per report</h2><p>One price a month for your whole team, based on how many clerks you have and how many reports you do. No charge per report on top. Tell us your size and we’ll send you a price, and a trial on a real property first.</p></div>
  <div class="cl-incl card"><div><b>Included every month</b>
    <ul class="buy-list"><li>✓<span>Your branded app for all your clerks</span></li><li>✓<span>Check-ins, check-outs, mid-term and renewal inspections</span></li><li>✓<span>Branded PDF reports and sign-off links</span></li><li>✓<span>Tenant self check-in links in your brand</span></li><li>✓<span>Online backup and a dashboard of every report</span></li><li>✓<span>Set-up and help from us</span></li></ul></div>
    <a class="btn primary" href="#talk">Get a monthly price</a></div>
</div></section>

<section class="tight ag-band" id="talk"><div class="wrap ag-talk">
  <div><span class="kicker">Talk to us</span><h2>Get a price and a free trial</h2>
    <p>Tell us a little about your company. We’ll come back with a monthly price, set up a trial so a clerk can do a real report, and show you your brand on it.</p>
    <ul class="buy-list"><li>✓<span>A monthly price for your team</span></li><li>✓<span>A trial on a real property</span></li><li>✓<span>Your branding set up for you</span></li></ul></div>
  ${o.sent ? `<div class="card"><h3>Thank you</h3><p>We’ve got your message and will be in touch shortly, usually the same working day.</p></div>` : `<form class="card form" method="post" action="${PATH}">
    <div class="row"><label><b>Your name</b><input name="name" required maxlength="80" autocomplete="name" value="${esc(f.name || '')}"></label>
    <label><b>Company</b><input name="company" required maxlength="100" autocomplete="organization" value="${esc(f.company || '')}"></label></div>
    <div class="row"><label><b>Email</b><input name="email" type="email" required maxlength="120" autocomplete="email" value="${esc(f.email || '')}"></label>
    <label><b>Phone <span>optional</span></b><input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${esc(f.phone || '')}"></label></div>
    <div class="row"><label><b>Clerks <span>roughly</span></b><input name="clerks" maxlength="20" inputmode="numeric" value="${esc(f.clerks || '')}"></label>
    <label><b>Reports a month <span>roughly</span></b><input name="volume" maxlength="20" inputmode="numeric" value="${esc(f.volume || '')}"></label></div>
    <label><b>Anything else? <span>optional</span></b><textarea name="message" maxlength="3000" style="min-height:100px" placeholder="What you use now, what you’d like in your brand…">${esc(f.message || '')}</textarea></label>
    <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-5000px">
    <button class="btn primary">Send</button>
  </form>`}
</div></section>

<section class="tight"><div class="wrap"><div class="sec-head"><span class="kicker">More for inventory companies</span><h2>Find out more</h2></div>
<div class="cl-links">${require('./clerkseo').PAGES.map(p => `<a class="card" href="${p.path}"><b>${esc(p.short)}</b><span>${esc(p.desc)}</span></a>`).join('')}</div></div></section>

<section class="tight"><div class="wrap"><div class="sec-head"><h2>Questions</h2></div><div class="faq">
${FAQS.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</div></div></section>
<script>(function(){var m=document.getElementById('clMock');[].forEach.call(document.querySelectorAll('.cl-try button'),function(b){b.addEventListener('click',function(){m.style.setProperty('--brand',b.getAttribute('data-c'))})})})();</script>`;
    return ctx.renderPage({ key: 'clerks', path: PATH, title: 'White-label inventory software for inventory companies · DIY Inventory',
      og: 'Your own inventory app, in your brand', desc: 'Inventory software for inventory clerks and companies: a guided phone app and PDF reports in your own brand, with sign-off links and check-out comparisons, for one monthly fee.',
      body, head: '<style>' + AG_CSS + CSS + '</style>' + (o.sent ? '<meta name="robots" content="noindex, follow">' : ''),
      jsonld: base => [{ '@type': 'Service', name: 'White-label inventory software for inventory companies', provider: { '@id': base + '/#org' }, areaServed: 'GB', serviceType: 'Inventory software subscription',
        description: 'A branded property inventory app and PDF reports for inventory clerks and companies, for a monthly fee.', url: base + PATH },
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' }, { '@type': 'ListItem', position: 2, name: 'For inventory companies', item: base + PATH }] },
        { '@type': 'FAQPage', mainEntity: FAQS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] }, req, o.notice);
  }

  app.get([PATH, PATH + '/'], (req, res) => res.set('Cache-Control', 'no-store').type('html').send(page(req, { sent: !!req.query.sent })));
  app.get(['/white-label-inventory-software', '/inventory-software-for-clerks', '/inventory-clerks-software'], (req, res) => res.redirect(301, PATH));
  app.post([PATH, PATH + '/'], express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    const b = req.body || {};
    if (clip(b.website, 200)) return res.redirect(303, PATH + '?sent=1#talk');
    const e = { name: clip(b.name, 80), company: clip(b.company, 100), email: clip(b.email, 120).toLowerCase(), phone: clip(b.phone, 30), clerks: clip(b.clerks, 20), volume: clip(b.volume, 20), message: clip(String(b.message || '').replace(/\r/g, ''), 3000) };
    if (!e.name || !e.company || !EMAIL_RE.test(e.email)) return res.status(400).type('html').send(page(req, { form: e, notice: { text: 'Please give your name, your company and a valid email address.' } }));
    if (!allowed(ctx.clientIp(req))) return res.status(429).type('html').send(page(req, { form: e, notice: { text: 'Too many messages from here. Please try again later, or email us.' } }));
    const d = read();
    const rec = Object.assign({ id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), status: 'new', origin: require('./origin').of(req, b) }, e);
    d.list.push(rec); write(d);
    console.log('inventory company enquiry: ' + e.company + (e.clerks ? ', ' + e.clerks + ' clerks' : ''));
    try { require('./analytics').lead(req, 'clerk', rec.origin); } catch (x) {}
    if (ctx.notify) ctx.notify({ title: 'Inventory company enquiry: ' + e.company, message: [e.name + ' · ' + e.company, e.email + (e.phone ? ' · ' + e.phone : ''), (e.clerks ? e.clerks + ' clerks' : '') + (e.clerks && e.volume ? ' · ' : '') + (e.volume ? e.volume + ' reports a month' : ''), e.message.slice(0, 200)].filter(Boolean).join('\n'), tags: ['office'],
      click: ctx.PUBLIC_BASE ? ctx.PUBLIC_BASE.replace(/\/+$/, '') + '/admin#clerkleads' : '' });
    res.redirect(303, PATH + '?sent=1#talk');
  });

  const ownerOk = req => ctx.isOwner(req) && (() => { const o = String(req.get('origin') || req.get('referer') || ''); try { return !o || new URL(o).host === req.get('host'); } catch (x) { return false; } })();
  app.post('/admin/clerk-enquiries/:id', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Sign in on /admin first.');
    const d = read(), r = d.list.find(x => x.id === String(req.params.id)), st = String((req.body || {}).status || '');
    if (r && st === 'delete') d.list = d.list.filter(x => x !== r);
    else if (r && ['new', 'contacted', 'trial', 'won', 'lost'].includes(st)) r.status = st;
    write(d); res.redirect(303, '/admin#clerkleads');
  });

  if (ctx.addAdminSection) ctx.addAdminSection(() => {
    const d = read(), list = d.list.slice().reverse(), seen = d.seenAt, fresh = list.filter(r => !seen || r.at > seen).length;
    if (fresh) { d.seenAt = new Date().toISOString(); write(d); }
    const when = t => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const ST = { new: 'New', contacted: 'Contacted', trial: 'On a trial', won: 'Signed up', lost: 'Not going ahead' };
    const rows = list.slice(0, 200).map(r => `<li><div style="flex:1;min-width:0"><strong>${esc(r.company)}</strong> · ${esc(r.name)} ${(!seen || r.at > seen) ? '<span class="pill sent">New</span>' : ''} <span class="pill">${esc(ST[r.status] || r.status)}</span>
      <div class="sub">${esc(when(r.at))} · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? ' · <a href="tel:' + esc(r.phone.replace(/[^\d+]/g, '')) + '">' + esc(r.phone) + '</a>' : ''}${r.clerks ? ' · ' + esc(r.clerks) + ' clerks' : ''}${r.volume ? ' · ' + esc(r.volume) + ' reports a month' : ''}</div>
      ${r.message ? '<div class="sub" style="white-space:pre-wrap;margin-top:4px">' + esc(r.message) + '</div>' : ''}${require('./origin').html(r.origin, esc)}
      <form method="post" action="/admin/clerk-enquiries/${esc(r.id)}" style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${Object.keys(ST).filter(k => k !== r.status).map(k => `<button class="btn" name="status" value="${k}">${esc(ST[k])}</button>`).join('')}<button class="btn" name="status" value="delete" onclick="return confirm('Delete this enquiry?')">Delete</button></form></div></li>`).join('');
    return `<details class="codes" id="clerkleads"${fresh ? ' open' : ''}><summary>🧾 Inventory company enquiries <span class="sub" style="display:inline">— ${list.length ? list.length + (fresh ? ' · ' + fresh + ' new' : '') : 'none yet'}</span></summary>
<p class="sub" style="margin-top:12px">From <a href="${PATH}" target="_blank" rel="noopener">${PATH}</a>: inventory companies asking about the branded app for a monthly fee. For a trial, make them a Tenant link under Access &amp; links.</p>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  });

  return { paths: [PATH] };
}

const CSS = `
.cl-brand { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: center; max-width: 1040px; }
.cl-brand h2 { font-size: clamp(26px, 3.2vw, 36px); line-height: 1.15; margin: 8px 0 12px; } .cl-brand > div > p { color: var(--ink-soft); }
.cl-brand .kicker { color: var(--accent); font-weight: 700; font-size: 13.5px; text-transform: uppercase; letter-spacing: .08em; }
.cl-brand .buy-list { list-style: none; padding: 0; display: grid; gap: 8px; } .cl-brand .buy-list li { display: flex; gap: 10px; }
.cl-try { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14.5px; }
.cl-try button { width: 28px; height: 28px; border-radius: 50%; border: 3px solid #fff; background: var(--s); box-shadow: 0 0 0 1px var(--line); cursor: pointer; padding: 0; }
.cl-mock { --brand: #1F3A5F; position: relative; min-height: 360px; }
.cl-cover { background: #fff; border-radius: 14px; box-shadow: 0 20px 50px rgba(20,30,50,.14), 0 0 0 1px var(--line); padding: 22px; width: 82%; aspect-ratio: 1.414 / 1; display: flex; flex-direction: column; gap: 8px; }
.cl-logo { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--brand); font-size: 15px; flex-wrap: wrap; transition: color .3s; }
.cl-logo span { width: 26px; height: 26px; border-radius: 7px; background: var(--brand); transition: background .3s; }
.cl-logo small { flex-basis: 100%; font-weight: 500; color: var(--ink-faint); font-size: 11px; margin-left: 34px; margin-top: -6px; }
.cl-title { margin-top: auto; font-size: 11px; letter-spacing: .14em; font-weight: 700; color: var(--brand); transition: color .3s; }
.cl-addr { font-family: Georgia, serif; font-size: clamp(16px, 2vw, 21px); line-height: 1.2; }
.cl-bars { display: flex; height: 7px; border-radius: 4px; overflow: hidden; background: var(--soft); } .cl-bars i:nth-child(1) { background: #3f8f5b; } .cl-bars i:nth-child(2) { background: #d4a43a; } .cl-bars i:nth-child(3) { background: #c2553f; }
.cl-meta { display: flex; gap: 14px; font-size: 11px; color: var(--ink-faint); } .cl-meta b { display: block; color: var(--ink); font-size: 12.5px; }
.cl-phone { position: absolute; right: 0; bottom: 0; width: 36%; aspect-ratio: 9 / 18; background: #0d1117; border-radius: 22px; border: 6px solid #1c2128; box-shadow: 0 20px 40px rgba(0,0,0,.25); overflow: hidden; display: flex; flex-direction: column; }
.cl-bar { background: var(--brand); color: #fff; font-size: 11px; font-weight: 700; padding: 10px 10px 8px; transition: background .3s; }
.cl-ph { flex: 1; color: rgba(255,255,255,.75); font-size: 9px; letter-spacing: .12em; padding: 12px 10px; background: linear-gradient(160deg, #3b4350, #1d232b); } .cl-ph b { display: block; color: #fff; font-size: 16px; letter-spacing: 0; margin-top: 2px; }
.cl-btn { margin: 10px; background: var(--brand); color: #fff; text-align: center; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 8px; transition: background .3s; }
.cl-grid { grid-template-columns: repeat(4, 1fr); }
.cl-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; } .cl-links a { text-decoration: none; color: inherit; display: grid; gap: 6px; } .cl-links span { color: var(--ink-soft); font-size: 14.5px; }
.cl-incl { display: flex; gap: 24px; align-items: center; justify-content: space-between; max-width: 860px; margin: 0 auto; flex-wrap: wrap; }
.cl-incl .buy-list { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; margin: 10px 0 0; } .cl-incl .buy-list li { display: flex; gap: 10px; }
@media (max-width: 960px) { .cl-grid, .cl-links { grid-template-columns: 1fr 1fr; } }
@media (max-width: 860px) { .cl-brand { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .cl-grid, .cl-links, .cl-incl .buy-list { grid-template-columns: 1fr; } .cl-cover { width: 88%; padding: 16px; } .cl-mock { min-height: 300px; } }
@media (prefers-reduced-motion: reduce) { .cl-logo, .cl-logo span, .cl-title, .cl-bar, .cl-btn { transition: none; } }`;

module.exports = { mount };
