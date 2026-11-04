// Tenant referencing, the landlord's (and their staff's) side, inside the DIY Inventory landlord dashboard:
//   /account/references                 the board: every applicant in columns by stage, with figures and a search
//   /account/references/new[?g=]        start references for a tenancy: its tenants and guarantors in one go, one payment
//   /account/references/g/<group>       the tenancy: each applicant's progress, their links to send, chase them all at once
//   /account/references/<id>            one applicant: links to send, guarantor, checks, Right to Rent, credit, documents
//   /account/references/<id>/report     the report (page and .pdf), plus the application form and signed consent as PDFs
// Signed-in landlords and their staff (staff.js) both get here; only the account holder manages staff.
const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const credit = require('./credit');
const staff = require('./staff');
const { assess, stage, headline, STAGES, pounds, RATIO, GUARANTOR_RATIO } = require('./assess');
const { reportPdf, applicationPdf, consentPdf, tenantName, refNo } = require('./pdf');
const { esc, gbp, when, day, clip } = require('./util');
const payments = require('../payments');
const landlords = require('../landlords');

const form = express.urlencoded({ extended: false, limit: '32kb' });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const waNum = p => String(p || '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^0/, '44');
const KIND = { id: 'Identity', income: 'Income', credit: 'Credit report', other: 'Other' };
const ICON = { pass: '✓', warn: '!', fail: '×', pending: '…', na: '–' };
const MAX_PEOPLE = 8;
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const pence = v => { const n = Math.round(parseFloat(String(v || '').replace(/[£,\s]/g, '')) * 100); return n > 0 && n < 1e8 ? n : 0; };
const itemsHTML = o => `<div class="rf-items">${o.items.map(i => `<div class="rf-item"><span class="rf-ic ${i.status}">${ICON[i.status]}</span><div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p></div></div>`).join('')}</div>`;
const isG = r => r.role === 'guarantor';
const roleBadge = r => isG(r) ? `<span class="rf-role g">Guarantor for ${esc((r.guarantorFor || {}).name || 'a tenant')}</span>` : '<span class="rf-role">Tenant</span>';
const STAGE_LABEL = Object.fromEntries(STAGES);
function pillFor(r, o){
  const st = stage(r, o);
  if (st === 'complete' || (st === 'review' && o.outcome === 'checks')) return `<span class="rf-pill ${{ accepted: 'ok', guarantor: 'wait', checks: 'bad' }[o.outcome] || ''}">${esc(o.label)}</span>`;
  return `<span class="rf-pill ${st === 'review' ? 'wait' : ''}">${esc(STAGE_LABEL[st])}</span>`;
}

function mount(app, H){
  const { PRICE_P, PRICE_TEXT } = H;
  const newLimit = H.limiter(60, 3600e3), remindLimit = H.limiter(60, 3600e3);
  // A signed-in landlord, or a member of their staff (req.staff), for their account's references.
  const need = (req, res, next) => {
    let acc = landlords.currentAccount(req), st = null;
    if (!acc) { const c = staff.current(req); if (c) { acc = c.acc; st = c.staff; } }
    if (!acc) return req.method === 'GET' ? res.redirect(303, '/account/sign-in?next=' + encodeURIComponent(req.originalUrl)) : res.status(401).type('text/plain').send('Signed out. Please sign in again.');
    if (req.method !== 'GET' && !H.sameOrigin(req)) return res.status(403).type('text/plain').send('Please use the buttons on the page.');
    req.acc = acc; req.staff = st; req.who = st ? st.name + ' (staff)' : acc.name; next();
  };
  const show = (req, res, o) => H.show(req, res, Object.assign({ acc: req.acc, staff: req.staff }, o));
  const mineAll = req => store.allRefs().filter(r => r.accountId === req.acc.id);
  const mine = (req, res) => {
    const r = store.ref(req.params.id);
    if (!r || r.accountId !== req.acc.id) { show(req, res, { path: '/account/references', title: 'Not found', status: 404, body: '<div class="card"><h1>Reference not found</h1><p><a href="/account/references">Back to your references</a></p></div>' }); return null; }
    return r;
  };
  const group = (req, gid) => mineAll(req).filter(r => r.groupId === gid).sort((a, b) => (isG(a) - isG(b)) || a.createdAt.localeCompare(b.createdAt));
  const say = req => req.query.m ? { ok: true, text: String(req.query.m).slice(0, 200) } : null;
  const back = (r, m) => `/account/references/${r.id}` + (m ? '?m=' + encodeURIComponent(m) : '');
  const gback = (gid, m) => `/account/references/g/${gid}` + (m ? '?m=' + encodeURIComponent(m) : '');
  const free = req => (H.isOwner && H.isOwner(req)) || process.env.REFERENCING_FREE === '1';

  /* ------------------------------ messages with each link ------------------------------ */
  const first = n => String(n || '').split(' ')[0];
  function applyMsg(base, r){
    const url = `${base}/reference/apply/${r.tokens.apply}`;
    return isG(r) ? `Hi ${first(r.tenant.name)}, ${r.guarantorFor.name} has named you as their guarantor for ${r.property.address}. Please complete the guarantor reference here (about 10 minutes): ${url}`
      : `Hi ${first(r.tenant.name)}, please complete your tenant reference for ${r.property.address} here (about 10 minutes): ${url}`;
  }
  function refereeMsg(base, r, k){ const who = k === 'employer' ? 'employer' : 'previous landlord';
    return `Hello, ${tenantName(r)} has applied to rent a property${isG(r) ? ' as a guarantor' : ''} and named you as their ${who} referee. Please give a short reference here (about 2 minutes): ${base}/reference/r/${r.tokens[k]}`; }
  // Everything still waiting on someone: [label, url, email, phone, message, emailedAt, kind]
  function outstanding(base, r){
    const a = r.application || {}, emp = a.employment || {}, pl = a.prevLandlord || {}, out = [];
    if (r.status === 'awaiting_payment') return out;
    if (!a.submittedAt) out.push([isG(r) ? `${r.tenant.name} (guarantor)` : r.tenant.name, `${base}/reference/apply/${r.tokens.apply}`, r.tenant.email, r.tenant.phone, applyMsg(base, r), r.tenantEmailedAt, 'apply', r]);
    for (const [k, who, name, email, phone] of [['employer', 'Employer', emp.refName || emp.employer, emp.refEmail, emp.refPhone], ['landlord', 'Previous landlord', pl.name, pl.email, pl.phone]])
      if (r.tokens[k] && !(r.refs[k] || {}).answers) out.push([`${who} of ${tenantName(r)}${name ? ': ' + name : ''}`, `${base}/reference/r/${r.tokens[k]}`, email, phone, refereeMsg(base, r, k), (r.refs[k] || {}).emailedAt, k, r]);
    return out;
  }
  const sendBtns = (email, phone, msg, subject) => `${phone ? `<a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${esc(waNum(phone))}?text=${encodeURIComponent(msg)}">WhatsApp</a><a class="btn ghost sm" href="sms:${esc(String(phone).replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(msg)}">Text</a>` : ''}
    ${email ? `<a class="btn ghost sm" href="mailto:${esc(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}">Email</a>` : ''}`;
  const linksHTML = links => links.map(([label, url, email, phone, msg, sent, kind, r]) => `<div class="rf-send"><div class="rf-top"><b>${esc(label)}</b>${sent ? `<span class="rf-pill ok">Emailed ${esc(day(sent))}</span>` : ''}</div>
    <div class="rf-link"><input readonly value="${esc(url)}" onclick="this.select()" aria-label="Link"><button class="btn ghost sm" type="button" data-copy="${esc(url)}">Copy link</button>
    ${sendBtns(email, phone, msg, kind === 'apply' ? 'Your tenant reference' : 'Reference request')}
    ${r && email && landlords.emailOn() ? `<form method="post" action="/account/references/${r.id}/remind?k=${kind}" class="inline"><button class="btn ghost sm">${sent ? 'Email again' : 'Email it'}</button></form>` : ''}</div></div>`).join('');
  const COPY_JS = `<script>document.addEventListener('click',function(e){var b=e.target.closest('[data-copy]');if(!b)return;var t=b.getAttribute('data-copy');(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copied';},function(){prompt('Copy this:',t);});});</script>`;

  // Emails sent by us (with Resend); each returns a promise of { ok }.
  function emailApply(base, r){
    const g = isG(r), url = `${base}/reference/apply/${r.tokens.apply}`;
    return landlords.sendEmail({ to: r.tenant.email, replyTo: r.landlordEmail, fromName: `${r.landlordName} via DIY Inventory`, subject: g ? `Guarantor reference for ${r.property.address}` : `Your tenant reference for ${r.property.address}`,
      text: `Hi ${first(r.tenant.name)},\n\n${g ? `${r.guarantorFor.name} has applied to rent ${r.property.address} and named you as their guarantor. Please complete the guarantor reference here:` : `You’ve applied to rent ${r.property.address}. Please complete your tenant reference here:`}\n${url}\n\nIt takes about 10 minutes. Have these to hand: your employer’s contact details${g ? '' : ', your current landlord’s details (if you rent now)'}, your Right to Rent share code or passport, and a recent payslip.\n\nDIY Inventory, for ${r.landlordName}` })
      .then(x => { if (x && x.ok) { const y = store.ref(r.id); if (y) { y.tenantEmailedAt = new Date().toISOString(); store.event(y, `Application link emailed to ${y.tenant.email}`); store.saveRef(y); } } return x || {}; });
  }
  function emailReferee(base, r, k){
    const x = r.refs[k] || {}; if (!EMAIL.test(x.email || '')) return Promise.resolve({});
    return landlords.sendEmail({ to: x.email, replyTo: r.landlordEmail, subject: `Reference request: ${tenantName(r)}`, text: `Hello${x.name ? ' ' + first(x.name) : ''},\n\n${refereeMsg(base, r, k)}\n\nThey agreed to us contacting you. Thank you.\n\nDIY Inventory, for ${r.landlordName}` })
      .then(s => { if (s && s.ok) { const y = store.ref(r.id); if (y && y.refs[k]) { y.refs[k].emailedAt = new Date().toISOString(); store.event(y, `Reference request emailed again to the ${k === 'employer' ? 'employer' : 'previous landlord'}`); store.saveRef(y); } } return s || {}; });
  }

  /* ------------------------------ the board ------------------------------ */
  app.get('/account/references', need, (req, res) => {
    const list = mineAll(req).sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)), now = Date.now(), today = new Date().toISOString().slice(0, 10);
    const rows = list.map(r => { const o = assess(r); return { r, o, st: stage(r, o) }; });
    const by = k => rows.filter(x => x.st === k);
    const card = ({ r, o, st }) => {
      const a = r.application || {}, waitFor = o.items.filter(i => ['employer', 'landlord'].includes(i.key) && i.status === 'pending').map(i => i.key === 'employer' ? 'employer' : 'landlord');
      const meta = st === 'pay' ? `<a class="btn primary sm" href="${back(r)}">Pay ${PRICE_TEXT}</a>`
        : st === 'applicant' ? `Link sent ${esc(day(r.activatedAt || r.createdAt))}${r.tenantEmailedAt ? ' · emailed' : ''}`
        : st === 'refs' ? `Waiting for ${esc(waitFor.join(' and '))} reference`
        : st === 'review' ? esc([!r.rtrChecked && 'Record the Right to Rent check', o.items.some(i => i.key === 'credit' && i.status === 'pending') && 'Add the credit result', o.outcome === 'checks' && 'Further checks needed'].filter(Boolean).join(' · ') || 'Review the result')
        : `${pillFor(r, o)} <a class="btn good sm" href="/account/references/${r.id}/report">Report</a>`;
      return `<div class="rf-card" data-q="${esc((tenantName(r) + ' ' + r.property.address + ' ' + refNo(r) + ' ' + (r.tenant.email || '')).toLowerCase())}"><a class="rf-card-name" href="${back(r)}">${esc(tenantName(r))}</a>${roleBadge(r)}
        <a class="rf-card-addr" href="${gback(r.groupId)}">${esc(r.property.address)}</a><div class="rf-card-meta"><span>${esc(refNo(r))} · ${pounds(r.property.rentP / 100)}/month</span></div><div class="rf-card-meta">${meta}</div></div>`;
    };
    const cols = STAGES.filter(([k]) => k !== 'pay' || by('pay').length);
    const tiles = [['Started today', rows.filter(x => x.r.createdAt.slice(0, 10) === today).length, 'navy'], ['Awaiting the applicant', by('applicant').length, 'amber'],
      ['Awaiting referees', by('refs').length, 'blue'], ['Ready for your review', by('review').length, 'red'], ['Completed in 30 days', rows.filter(x => x.st === 'complete' && now - Date.parse(x.r.updatedAt || x.r.createdAt) < 30 * 864e5).length, 'green']];
    show(req, res, { wide: true, path: '/account/references', title: 'Tenant references', notice: say(req), body: `
      <div class="rf-top"><div><h1>Tenant references</h1><p class="sub">${PRICE_TEXT} per applicant, tenants and guarantors. Each applies online; we contact their referees; you get one report each.</p></div>
        <span style="display:flex;gap:10px;flex-wrap:wrap">${req.staff ? '' : '<a class="btn ghost" href="/account/references/team">Staff logins</a>'}<a class="btn primary" href="/account/references/new">+ New reference</a></span></div>
      ${rows.length ? `<div class="rf-tiles">${tiles.map(([l, n, c]) => `<div class="rf-tile ${c}"><span>${esc(l)}</span><b>${n}</b></div>`).join('')}</div>
      <div class="rf-search"><input type="search" id="rfq" placeholder="Search by name, address, email or reference number" aria-label="Search references"></div>
      <div class="rf-board">${cols.map(([k, l]) => `<section class="rf-col ${k}"><h2>${esc(l)} <span>${by(k).length}</span></h2><div class="rf-col-list">${by(k).map(card).join('') || '<p class="sub">None</p>'}</div></section>`).join('')}</div>
      <script>(function(){var q=document.getElementById('rfq');q.oninput=function(){var v=q.value.trim().toLowerCase();document.querySelectorAll('.rf-card').forEach(function(c){c.hidden=v&&c.getAttribute('data-q').indexOf(v)<0;});};})();</script>`
      : `<div class="card" style="text-align:center"><h2>No references yet</h2><p class="sub">Start one when someone applies for one of your properties: add each tenant and any guarantors, and we send them their links.</p><a class="btn primary" href="/account/references/new">Start your first reference</a> <a class="btn ghost" href="/tenant-referencing">What’s checked</a></div>`}` });
  });

  /* ------------------------------ starting references for a tenancy ------------------------------ */
  const personBlock = (i, p = {}) => `<div class="rf-person" data-person><div class="rf-top"><b data-n>Applicant ${i + 1}</b><button type="button" class="btn ghost sm" data-rm hidden>Remove</button></div>
    <div class="rf-two"><label>They are<select name="a_type" data-type><option value="tenant">A tenant</option>${p.type && p.type !== 'tenant' ? `<option value="${esc(p.type)}" selected>${esc(p.typeText || 'A guarantor')}</option>` : ''}</select></label>
      <label data-share>Their share of the rent (£ a month) <span class="opt">(blank = split equally)</span><input name="a_share" inputmode="decimal" value="${esc(p.share)}"></label></div>
    <div class="rf-three"><label>Full name<input name="a_name" maxlength="80" value="${esc(p.name)}" autocomplete="off"></label><label>Email<input name="a_email" type="email" maxlength="120" value="${esc(p.email)}" autocomplete="off"></label>
      <label>Mobile <span class="opt">(for WhatsApp or text)</span><input name="a_phone" type="tel" maxlength="30" value="${esc(p.phone)}" autocomplete="off"></label></div></div>`;
  const newPage = (req, res, b = {}, msg) => {
    const gid = String(req.query.g || b.g || ''), existing = gid ? group(req, gid) : [], g0 = existing[0];
    const tenantsThere = existing.filter(r => !isG(r));
    const props = (req.acc.properties || []).filter(p => p.address || p.line1 || p.road);
    const addr = p => [p.address || [p.houseNo, p.building, p.road].filter(Boolean).join(' '), p.town, p.postcode].filter(Boolean).join(', ');
    const people = b.people && b.people.length ? b.people : [{}];
    show(req, res, { path: '/account/references/new', title: 'New reference', status: msg ? 400 : 200, notice: msg ? { text: msg } : null, body: `<p class="sub"><a href="${g0 ? gback(gid) : '/account/references'}">← ${g0 ? esc(g0.property.address) : 'Tenant references'}</a></p><div class="card">
      <h1>${g0 ? 'Add a tenant or guarantor' : 'New tenant reference'}</h1><p class="sub">Add each tenant and any guarantors. We send each of them their own link to apply. ${PRICE_TEXT} each, paid by card on the next step.</p>
      <form class="rf-form" method="post" action="/account/references/new" id="nf">${g0 ? `<input type="hidden" name="g" value="${esc(gid)}">` : ''}
        ${g0 ? `<p><b>${esc(g0.property.address)}</b> · ${pounds((g0.property.totalRentP || g0.property.rentP) / 100)} a month</p>` : `<fieldset><legend>The property</legend>
          ${props.length ? `<label>Your property <span class="opt">(or type the address below)</span><select onchange="if(this.value)this.form.address.value=this.value"><option value="">Choose…</option>${props.map(p => `<option>${esc(addr(p))}</option>`).join('')}</select></label>` : ''}
          <label>Address<input name="address" required maxlength="200" placeholder="Flat 2, 10 High Street, London SE1 1AA" value="${esc(b.address)}"></label>
          <div class="rf-three"><label>Total rent (£ a month)<input name="rent" required inputmode="decimal" placeholder="1500" value="${esc(b.rent)}"></label><label>Tenancy start <span class="opt">(optional)</span><input name="start" type="date" value="${esc(b.start)}"></label>
            <label>Term <span class="opt">(months, optional)</span><input name="term" inputmode="numeric" value="${esc(b.term)}" placeholder="12"></label></div></fieldset>`}
        <fieldset><legend>Who to reference</legend><div id="people" style="display:grid;gap:12px">${people.map((p, i) => personBlock(i, p)).join('')}</div>
          <button type="button" class="btn ghost sm" id="addP" style="justify-self:start" hidden>+ Add another tenant or guarantor</button>
          <noscript>${people.length < 3 ? personBlock(people.length) + personBlock(people.length + 1) : ''}<p class="sub">Leave a block empty if you don’t need it. Guarantors can be added afterwards from the tenancy page.</p></noscript></fieldset>
        <label class="rf-check"><input type="checkbox" name="ok" required> These people have applied to rent the property (or agreed to be a guarantor) and know they will be referenced.</label>
        <button class="btn primary" id="go">Continue to payment · ${PRICE_TEXT}</button>
      </form></div>
      <script>(function(){
        var box=document.getElementById('people'),add=document.getElementById('addP'),go=document.getElementById('go'),FREE=${free(req) ? 1 : 0},P=${PRICE_P},MAX=${MAX_PEOPLE};
        var EX=${JSON.stringify(tenantsThere.map(r => ['t:' + r.id, tenantName(r)]))};
        add.hidden=false;
        function blocks(){return [].slice.call(box.querySelectorAll('[data-person]'));}
        function sync(){var bs=blocks(),n=0;bs.forEach(function(b,i){
          b.querySelector('[data-n]').textContent='Applicant '+(i+1);b.querySelector('[data-rm]').hidden=bs.length<2;
          var sel=b.querySelector('[data-type]'),cur=sel.value,opts=[['tenant','A tenant']];
          EX.forEach(function(e){opts.push([e[0],'Guarantor for '+e[1]]);});
          bs.forEach(function(o,j){if(o!==b&&o.querySelector('[data-type]').value==='tenant'){var nm=o.querySelector('[name=a_name]').value.trim();opts.push(['g:'+(j+1),'Guarantor for '+(nm||'applicant '+(j+1))]);}});
          sel.innerHTML='';opts.forEach(function(o){var x=document.createElement('option');x.value=o[0];x.textContent=o[1];sel.appendChild(x);});
          sel.value=opts.some(function(o){return o[0]===cur;})?cur:'tenant';
          b.querySelector('[data-share]').hidden=sel.value!=='tenant';
          if(b.querySelector('[name=a_name]').value.trim()||b.querySelector('[name=a_email]').value.trim())n++;});
          add.hidden=bs.length>=MAX;n=Math.max(n,1);
          go.textContent=FREE?'Send '+(n>1?'the '+n+' links':'the link')+' (no payment)':'Continue to payment · £'+(P*n/100).toFixed(P*n%100?2:0)+(n>1?' ('+n+' × £'+(P/100)+')':'');}
        add.onclick=function(){var b=blocks()[0].cloneNode(true);b.querySelectorAll('input').forEach(function(i){i.value='';});box.appendChild(b);sync();b.querySelector('[name=a_name]').focus();};
        box.addEventListener('click',function(e){if(e.target.closest('[data-rm]')){e.target.closest('[data-person]').remove();sync();}});
        box.addEventListener('input',sync);box.addEventListener('change',sync);sync();
      })();</script>` });
  };
  app.get('/account/references/new', need, (req, res) => newPage(req, res));
  app.post('/account/references/new', need, form, async (req, res) => {
    const b = req.body || {}, gid = clip(b.g, 40), existing = gid ? group(req, gid) : [], g0 = existing[0];
    const T = arr(b.a_type), N = arr(b.a_name), E = arr(b.a_email), P = arr(b.a_phone), S = arr(b.a_share);
    const blocks = N.map((n, i) => ({ type: clip(T[i] || 'tenant', 40), name: clip(n, 80), email: clip(E[i], 120).toLowerCase(), phone: clip(P[i], 30), share: clip(S[i], 12), n: i + 1 }));
    const people = blocks.filter(p => p.name || p.email || p.phone);
    const redo = m => newPage(req, res, Object.assign({}, b, { people: people.length ? people : blocks }), m);
    if (gid && !g0) return res.redirect(303, '/account/references');
    const prop = g0 ? Object.assign({}, g0.property) : { address: clip(b.address, 200), totalRentP: pence(b.rent), start: /^\d{4}-\d{2}-\d{2}$/.test(b.start) ? b.start : '', term: Math.min(120, parseInt(b.term, 10) || 0) || null };
    if (!prop.address || !(prop.totalRentP || prop.rentP)) return redo('Fill in the address and the total monthly rent.');
    if (!prop.totalRentP) prop.totalRentP = prop.rentP;
    if (!people.length) return redo('Add at least one tenant or guarantor: their name and email.');
    if (people.length > MAX_PEOPLE) return redo(`Up to ${MAX_PEOPLE} at a time.`);
    const bad = people.find(p => !p.name || !EMAIL.test(p.email));
    if (bad) return redo(`Add a full name and a valid email for applicant ${bad.n}.`);
    for (const p of people) {
      if (p.type === 'tenant') continue;
      const m = /^g:(\d+)$/.exec(p.type), t = /^t:([a-z0-9]+)$/.exec(p.type);
      if (m) { const ten = people.find(x => x.n === +m[1] && x.type === 'tenant'); if (!ten) return redo(`Applicant ${p.n} is a guarantor for someone who isn’t a tenant on this form.`); p.forPerson = ten; }
      else if (t) { const ten = existing.find(x => x.id === t[1] && !isG(x)); if (!ten) return redo('Choose who the guarantor is for.'); p.forRef = ten; }
      else p.type = 'tenant';
    }
    // Rent shares: what's typed, and the rest split equally between the tenants left blank.
    const tenants = people.filter(p => p.type === 'tenant');
    if (!g0 || tenants.length) {
      const typed = tenants.filter(p => pence(p.share)), blank = tenants.filter(p => !pence(p.share));
      const left = Math.max(0, prop.totalRentP - typed.reduce((s, p) => s + pence(p.share), 0) - (g0 ? existing.filter(r => !isG(r)).reduce((s, r) => s + r.property.rentP, 0) : 0));
      typed.forEach(p => { p.shareP = pence(p.share); });
      blank.forEach((p, i) => { p.shareP = Math.floor(left / blank.length) + (i < left % blank.length ? 1 : 0); });
      if (blank.length && !left) return redo('The shares typed already add up to the whole rent: type each tenant’s share, or leave them all blank to split it equally.');
    }
    if (!newLimit('new:' + req.acc.id)) return redo('Too many new references in an hour. Try again later.');
    const groupId = g0 ? gid : store.id(), now = new Date().toISOString(), made = [];
    const mk = (p, extra) => {
      const r = Object.assign({ id: store.id(), groupId, accountId: req.acc.id, landlordName: req.acc.name, landlordEmail: req.acc.email, createdAt: now, status: 'awaiting_payment', role: 'tenant', startedBy: req.who,
        property: Object.assign({}, prop, { rentP: p.shareP }), tenant: { name: p.name, email: p.email, phone: p.phone }, tokens: {}, refs: {}, files: [], events: [] }, extra);
      store.event(r, `Reference started by ${req.who}`); store.saveRef(r); made.push(r); return r;
    };
    for (const p of tenants) p.ref = mk(p);
    for (const p of people.filter(x => x.type !== 'tenant')) { const ten = p.forPerson ? p.forPerson.ref : p.forRef;
      p.shareP = ten.property.rentP; mk(p, { role: 'guarantor', guarantorFor: { id: ten.id, name: tenantName(ten) } }); }
    if (free(req)) { made.forEach(r => activate(req, r, true)); return res.redirect(303, gback(groupId, `${made.length === 1 ? 'Link' : made.length + ' links'} ready to send (no payment: owner or free mode).`)); }
    if (!payments.provider()) return res.redirect(303, gback(groupId));
    checkout(req, res, made, groupId);
  });

  // One card payment for several references.
  async function checkout(req, res, refs, gid){
    try {
      const ref = store.token(), base = H.base(req), total = PRICE_P * refs.length;
      const c = await payments.createCheckout({ ref, amountPence: total, name: `DIY Inventory: ${refs.length} tenant reference${refs.length === 1 ? '' : 's'}`, detail: `${refs.map(r => r.tenant.name).join(', ')}, ${refs[0].property.address}`.slice(0, 200), email: req.acc.email,
        returnUrl: `${base}/account/references/paid?ref=${ref}`, cancelUrl: `${base}${gback(gid, 'Payment cancelled. You can pay when you’re ready.')}`, hookUrl: `${base}/api/references/webhook`, tag: 'reference' });
      for (const r of refs) { const y = store.ref(r.id); y.payment = { ref, provider: c.provider, providerId: c.id, amountP: total, count: refs.length, createdAt: new Date().toISOString() }; store.saveRef(y); }
      res.redirect(303, c.url);
    } catch (e) { console.error('referencing: checkout failed: ' + e.message); res.redirect(303, gback(gid, 'The card payment page couldn’t open. Try again in a moment.')); }
  }
  app.post('/account/references/g/:gid/pay', need, (req, res) => {
    const refs = group(req, req.params.gid).filter(r => r.status === 'awaiting_payment');
    if (!refs.length || !payments.provider()) return res.redirect(303, gback(req.params.gid));
    if (free(req)) { refs.forEach(r => activate(req, r, true)); return res.redirect(303, gback(req.params.gid, 'Links ready to send.')); }
    checkout(req, res, refs, req.params.gid);
  });
  // Back from the card page: checked with the provider itself, never taken from the address.
  app.get('/account/references/paid', need, async (req, res) => {
    const refs = mineAll(req).filter(x => x.payment && x.payment.ref === String(req.query.ref || ''));
    if (!refs.length) return res.redirect(303, '/account/references');
    const p = refs[0].payment, gid = refs[0].groupId;
    if (refs.some(r => r.status === 'awaiting_payment')) {
      const v = await payments.verify({ provider: p.provider, providerId: p.providerId, ref: p.ref, amountPence: p.amountP || PRICE_P, tag: 'reference' });
      if (!v.paid) return show(req, res, { path: '/account/references', title: 'Checking your payment', status: 202, body: `<meta http-equiv="refresh" content="3"><div class="card" style="text-align:center"><h1>Checking your payment…</h1><p class="sub">This page refreshes by itself. <a href="${gback(gid)}">Back to the tenancy</a></p></div>` });
      const paidAt = new Date().toISOString(), fresh = refs.filter(r => r.status === 'awaiting_payment');
      fresh.forEach(r => { r.payment.paidAt = paidAt; r.payment.providerRef = v.providerRef || ''; activate(req, r, false); });
      if (fresh.length) { if (H.notify) H.notify({ title: `Tenant reference${fresh.length === 1 ? '' : 's'} sold: ${gbp(PRICE_P * fresh.length)}`, message: `${fresh[0].property.address}\n${req.acc.name} · ${req.acc.email}`, tags: ['mag'] });
        if (H.track) H.track(req, 'reference_purchase', PRICE_P * fresh.length / 100); }
    }
    res.redirect(303, gback(gid, 'Paid. The links are ready and have been emailed.'));
  });
  app.post('/api/references/webhook', (req, res) => res.json({ ok: true }));   // the return page does the checking

  // Paid (or free): make the applicant's link and email it to them.
  function activate(req, r, isFree){
    r.status = 'sent'; r.free = !!isFree; r.activatedAt = new Date().toISOString(); r.tokens.apply = r.tokens.apply || store.token();
    store.event(r, isFree ? 'Started without payment' : `Paid ${gbp(PRICE_P)} by card`); store.saveRef(r);
    emailApply(H.base(req), r);
  }

  /* ------------------------------ the tenancy (all its applicants) ------------------------------ */
  app.get('/account/references/g/:gid', need, (req, res) => {
    const refs = group(req, req.params.gid); if (!refs.length) return res.redirect(303, '/account/references');
    const base = H.base(req), p = refs[0].property, unpaid = refs.filter(r => r.status === 'awaiting_payment');
    const all = refs.flatMap(r => outstanding(base, r));
    const cards = refs.map(r => { const o = assess(r), st = stage(r, o);
      return `<div class="rf-appl"><div class="rf-appl-h"><a href="${back(r)}">${esc(tenantName(r))}</a>${roleBadge(r)}</div>
        <table class="rf-kv"><tr><td>Reference</td><td>${esc(refNo(r))}</td></tr><tr><td>Email</td><td>${esc(r.tenant.email)}</td></tr>${r.tenant.phone ? `<tr><td>Mobile</td><td>${esc(r.tenant.phone)}</td></tr>` : ''}
        <tr><td>${isG(r) ? 'Rent guaranteed' : 'Share of rent'}</td><td>${pounds(r.property.rentP / 100)} a month</td></tr><tr><td>Progress</td><td>${pillFor(r, o)}</td></tr>
        ${st === 'refs' ? `<tr><td>Waiting for</td><td>${esc(o.pending.filter(t => /Employ|landlord/.test(t)).join(', '))}</td></tr>` : ''}</table>
        <div class="rf-prog">${['applicant', 'refs', 'review', 'complete'].map((k, i) => `<i class="${['applicant', 'refs', 'review', 'complete'].indexOf(st) > i || st === 'complete' ? 'on' : ''}"></i>`).join('')}</div>
        <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn ghost sm" href="${back(r)}">Open</a>${(r.application || {}).submittedAt ? `<a class="btn ${st === 'complete' ? 'good' : 'ghost'} sm" href="/account/references/${r.id}/report">${st === 'complete' ? 'Final report' : 'Interim report'}</a>` : ''}</p></div>`; }).join('');
    const events = refs.flatMap(r => (r.events || []).map(e => ({ at: e.at, text: `${tenantName(r)}: ${e.text}` }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
    show(req, res, { wide: true, path: '/account/references', title: p.address, notice: say(req), body: `<p class="sub"><a href="/account/references">← Tenant references</a></p>
      <div class="rf-tenancy"><aside class="card rf-summary"><h1 style="font-size:22px">${esc(p.address)}</h1>
        <table class="rf-kv"><tr><td>Monthly rent</td><td>${pounds((p.totalRentP || p.rentP) / 100)}</td></tr><tr><td>Weekly rent</td><td>${gbp(Math.round((p.totalRentP || p.rentP) * 12 / 52))}</td></tr>
        <tr><td>Tenancy start</td><td>${p.start ? esc(day(p.start)) : 'Not set'}</td></tr>${p.term ? `<tr><td>Term</td><td>${p.term} months</td></tr>` : ''}<tr><td>Applicants</td><td>${refs.filter(r => !isG(r)).length} tenant${refs.filter(r => !isG(r)).length === 1 ? '' : 's'}, ${refs.filter(isG).length} guarantor${refs.filter(isG).length === 1 ? '' : 's'}</td></tr></table>
        <p style="margin-top:14px"><a class="btn primary sm" href="/account/references/new?g=${esc(req.params.gid)}">+ Add a tenant or guarantor</a></p></aside>
      <div>${unpaid.length ? `<div class="card"><h2>Pay to send ${unpaid.length === 1 ? 'the link' : 'the ' + unpaid.length + ' links'}</h2><p class="sub">${unpaid.map(r => esc(r.tenant.name)).join(', ')} · ${gbp(PRICE_P * unpaid.length)}</p>
          ${payments.provider() || free(req) ? `<form method="post" action="/account/references/g/${esc(req.params.gid)}/pay"><button class="btn primary">${free(req) ? 'Send without payment' : 'Pay ' + gbp(PRICE_P * unpaid.length) + ' by card'}</button></form>` : '<p class="notice">Card payments aren’t switched on yet.</p>'}</div>` : ''}
        ${all.length ? `<div class="card"><div class="rf-top"><h2>Links to send</h2>${landlords.emailOn() ? `<form method="post" action="/account/references/g/${esc(req.params.gid)}/remind"><button class="btn primary sm">Email everyone still to reply</button></form>` : ''}</div>
          <p class="sub">${landlords.emailOn() ? 'We email each link when it’s ready. Chase anyone by WhatsApp, text or email from here.' : 'Send each link by WhatsApp, text or email: tap the button and it opens with the message written.'}</p>
          ${linksHTML(all)}
          <details><summary>Copy all the links at once</summary><textarea readonly rows="${Math.min(12, all.length * 2 + 1)}" style="margin-top:10px" onclick="this.select()">${esc(all.map(l => `${l[0]}: ${l[1]}`).join('\n'))}</textarea></details></div>` : ''}
        <h2 style="margin-top:22px">Applicants</h2><div class="rf-appls">${cards}</div>
        <div class="card"><h2>Activity</h2><table class="rf-kv">${events.map(e => `<tr><td>${esc(when(e.at))}</td><td>${esc(e.text)}</td></tr>`).join('')}</table></div></div></div>${COPY_JS}` });
  });
  app.post('/account/references/g/:gid/remind', need, async (req, res) => {
    const refs = group(req, req.params.gid); if (!refs.length) return res.redirect(303, '/account/references');
    if (!remindLimit('r:' + req.acc.id)) return res.redirect(303, gback(req.params.gid, 'Too many reminders in an hour. Try again later.'));
    const base = H.base(req), jobs = [];
    for (const r of refs) for (const l of outstanding(base, r)) if (l[2]) jobs.push(l[6] === 'apply' ? emailApply(base, r) : emailReferee(base, r, l[6]));
    const out = await Promise.all(jobs), sent = out.filter(x => x && x.ok).length;
    res.redirect(303, gback(req.params.gid, sent ? `${sent} email${sent === 1 ? '' : 's'} sent.` : 'Nothing could be emailed (no email addresses, or email isn’t set up).'));
  });
  app.post('/account/references/:id/remind', need, async (req, res) => {
    const r = mine(req, res); if (!r) return;
    if (!remindLimit('r:' + req.acc.id)) return res.redirect(303, back(r, 'Too many reminders in an hour. Try again later.'));
    const k = String(req.query.k || 'apply'), base = H.base(req);
    const x = k === 'apply' ? (!(r.application || {}).submittedAt && r.tokens.apply ? await emailApply(base, r) : {}) : ['employer', 'landlord'].includes(k) && r.tokens[k] ? await emailReferee(base, r, k) : {};
    res.redirect(303, (req.get('referer') && /\/g\//.test(req.get('referer')) ? gback(r.groupId) : back(r)) + '?m=' + encodeURIComponent(x.ok ? 'Email sent.' : 'That couldn’t be emailed.'));
  });

  /* ------------------------------ one applicant ------------------------------ */
  app.get('/account/references/:id', need, (req, res) => {
    const r = mine(req, res); if (!r) return;
    const o = assess(r), a = r.application || {}, base = H.base(req), st = stage(r, o), refs = group(req, r.groupId);
    let body = `<p class="sub"><a href="/account/references">← Tenant references</a> · <a href="${gback(r.groupId)}">${esc(r.property.address)}</a></p>
      <div class="rf-out ${r.status === 'awaiting_payment' ? 'waiting' : st === 'complete' ? o.outcome : o.outcome === 'checks' ? 'checks' : 'progress'}"><div><h2>${esc(tenantName(r))}</h2><p>${isG(r) ? `Guarantor for ${esc(r.guarantorFor.name)} · ` : ''}${esc(r.property.address)} · ${pounds(r.property.rentP / 100)} a month · ${esc(refNo(r))}</p></div>${pillFor(r, o)}</div>`;
    if (r.status === 'awaiting_payment') {
      body += `<div class="card"><h2>Pay to send the link</h2><p class="sub">${PRICE_TEXT} per applicant. Once paid, ${esc(first(r.tenant.name))} gets their link to apply.</p>
        <p><a class="btn primary" href="${gback(r.groupId)}">Pay for this tenancy</a></p><form method="post" action="/account/references/${r.id}/delete" onsubmit="return confirm('Remove this unpaid reference?')"><button class="btn ghost sm">Remove</button></form></div>`;
      return show(req, res, { path: '/account/references', title: tenantName(r), notice: say(req), body });
    }
    const links = outstanding(base, r);
    if (links.length) body += `<div class="card"><h2>Waiting for</h2><p class="sub">${landlords.emailOn() ? 'We’ve emailed these. Chase them by WhatsApp, text or email from here.' : 'Send these links yourself: WhatsApp, text, email or copy.'}</p>${linksHTML(links)}</div>`;
    // Guarantors for this tenant (and the one the tenant named, ready to reference).
    if (!isG(r)) {
      const gs = refs.filter(x => isG(x) && x.guarantorFor && x.guarantorFor.id === r.id), named = a.guarantor || {};
      body += `<div class="card" id="guarantor"><h2>Guarantor</h2>${gs.length ? gs.map(x => `<p><a href="${back(x)}"><b>${esc(tenantName(x))}</b></a> · ${pillFor(x, assess(x))}</p>`).join('') : `<p class="sub">${o.outcome === 'guarantor' ? 'The income doesn’t cover the rent on its own: a guarantor earning ' + pounds(o.afford.guarantorNeed) + ' a year or more would.' : 'None yet.'}${named.name ? ` ${esc(first(tenantName(r)))} named <b>${esc(named.name)}</b> as a guarantor.` : ''}</p>`}
        <details${!gs.length && (named.name || o.outcome === 'guarantor') ? ' open' : ''}><summary>Reference a guarantor · ${PRICE_TEXT}</summary><form class="rf-form" method="post" action="/account/references/new" style="margin-top:12px"><input type="hidden" name="g" value="${esc(r.groupId)}"><input type="hidden" name="a_type" value="t:${r.id}"><input type="hidden" name="a_share" value="">
          <div class="rf-three"><label>Full name<input name="a_name" required maxlength="80" value="${esc(gs.length ? '' : named.name)}"></label><label>Email<input name="a_email" type="email" required value="${esc(gs.length ? '' : named.email)}"></label><label>Mobile<input name="a_phone" type="tel" value="${esc(gs.length ? '' : named.phone)}"></label></div>
          <label class="rf-check"><input type="checkbox" name="ok" required> They have agreed to be the guarantor and know they will be referenced.</label><button class="btn primary sm">${free(req) ? 'Send them a link' : 'Continue to payment · ' + PRICE_TEXT}</button></form></details></div>`;
    }
    body += `<div class="card"><div class="rf-top"><h2>Checks</h2>${a.submittedAt ? `<span style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost sm" href="/account/references/${r.id}/report">${st === 'complete' ? 'Final report' : 'Interim report'}</a><a class="btn primary sm" href="/account/references/${r.id}/report.pdf">Download PDF</a></span>` : ''}</div>${itemsHTML(o)}
      <p class="sub" style="margin-top:12px">A recommendation to help you decide; the decision is yours. Refusing a tenant because they receive benefits or have children is unlawful in England.</p></div>`;
    if (a.submittedAt) {
      body += `<div class="card" id="rtr"><h2>Right to Rent</h2><p class="sub">The landlord’s legal duty: check before the tenancy starts and keep a record.
        ${a.rtr && a.rtr.route === 'sharecode' ? ` Share code <b>${esc(a.rtr.shareCode)}</b>, date of birth ${esc(day(a.dob))}: check it on <a href="https://www.gov.uk/view-right-to-rent" target="_blank" rel="noopener">GOV.UK</a>.` : ' They gave a British or Irish passport: see the original (in person or with a certified ID checking service) and keep a copy.'}</p>
        ${r.rtrChecked ? `<p class="notice ok">Recorded: checked on ${esc(day(r.rtrChecked.date))}, ${esc(r.rtrChecked.how)}${r.rtrChecked.by ? ', by ' + esc(r.rtrChecked.by) : ''}.</p>` : `<form class="rf-form" method="post" action="/account/references/${r.id}/rtr"><div class="rf-two"><label>Date checked<input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
          <label>How<select name="how"><option>online with the share code</option><option>original passport seen in person</option><option>certified ID checking service</option></select></label></div><button class="btn ghost">Record the check</button></form>`}</div>`;
      const cr = r.credit || {}, crText = { clear: 'Clear', adverse: 'Adverse information found', no_trace: 'No credit file found', error: 'Could not be completed', pending: 'Running…' }[cr.status];
      body += `<div class="card" id="credit"><h2>Credit check</h2>${crText ? `<p><b>${esc(crText)}</b>${cr.provider === 'manual' ? ', from a credit report added by hand' : cr.provider === 'sandbox' ? ' (TEST DATA)' : ''} · ${esc(when(cr.at))}</p>` : `<p class="sub">${credit.provider() ? 'Runs once the applicant submits their application with consent.' : 'No credit check provider is connected yet. You can add a credit report by hand (for example one the applicant got from Experian or ClearScore): record what it shows and attach it below.'}</p>`}
        ${!credit.provider() || cr.status === 'error' ? `<details><summary>Add a credit report by hand</summary><form class="rf-form" method="post" action="/account/references/${r.id}/credit" style="margin-top:12px">
          <div class="rf-three"><label>CCJs<input name="ccjs" inputmode="numeric" value="0"></label><label>Total of CCJs (£)<input name="ccjValue" inputmode="numeric" value="0"></label><label>Defaults<input name="defaults" inputmode="numeric" value="0"></label></div>
          <div class="rf-two"><label>Bankruptcy or IVA<select name="insolvency"><option value="no">No</option><option value="yes">Yes</option></select></label><label>On the electoral roll<select name="roll"><option value="">Not shown</option><option value="yes">Yes</option><option value="no">No</option></select></label></div>
          <label>Source<input name="notes" maxlength="300" placeholder="e.g. Experian report dated 2 Nov 2026, from the applicant"></label><button class="btn ghost">Save the credit result</button></form></details>` : ''}</div>`;
    }
    // Documents, as the report pack: application form, report, consent, then what was uploaded.
    const docs = a.submittedAt ? [['Application form', `/account/references/${r.id}/application.pdf`], [st === 'complete' ? 'Final report' : 'Interim report', `/account/references/${r.id}/report.pdf`], ['Signed consent', `/account/references/${r.id}/consent.pdf`]] : [];
    body += `<div class="card" id="docs"><h2>Documents</h2><div class="rf-docs">${docs.map(([l, h]) => `<a href="${h}" target="_blank" rel="noopener"><span>» ${esc(l)}</span><span aria-hidden="true">⤓</span></a>`).join('')}
      ${r.filesDeletedAt ? `<p class="sub">Uploaded documents were deleted on ${esc(day(r.filesDeletedAt))}, at the end of the retention period.</p>` : (r.files || []).map(f => `<a href="/account/references/${r.id}/file/${f.id}" target="_blank" rel="noopener"><span>» ${esc(f.name)} <small>${esc(KIND[f.kind] || f.kind)}</small></span><span aria-hidden="true">⤓</span></a>`).join('')}</div>
      ${!docs.length && !(r.files || []).length ? '<p class="sub">The application form and reports appear here once the applicant has applied.</p>' : ''}
      ${r.filesDeletedAt ? '' : `<p style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px"><select id="upKind" style="width:auto"><option value="credit">Credit report</option><option value="other">Other</option></select><button class="btn ghost sm" type="button" onclick="document.getElementById('upFile').click()">Add a document</button><input type="file" id="upFile" hidden accept=".pdf,image/*"></p>
        <script>document.getElementById('upFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const r=await fetch('/account/references/${r.id}/upload?kind='+document.getElementById('upKind').value+'&name='+encodeURIComponent(f.name),{method:'POST',headers:{'content-type':'application/octet-stream'},body:f});const j=await r.json().catch(()=>({}));if(r.ok)location.reload();else alert(j.error||'That didn’t upload.');};</script>`}</div>`;
    body += `<div class="card"><h2>History</h2><table class="rf-kv">${(r.events || []).slice().reverse().map(e => `<tr><td>${esc(when(e.at))}</td><td>${esc(e.text)}</td></tr>`).join('')}</table></div>${COPY_JS}`;
    show(req, res, { path: '/account/references', title: tenantName(r), notice: say(req), body });
  });

  app.post('/account/references/:id/delete', need, (req, res) => {
    const r = mine(req, res); if (!r) return;
    if (r.status === 'awaiting_payment') store.deleteRef(r.id);
    res.redirect(303, group(req, r.groupId).length ? gback(r.groupId) : '/account/references');
  });
  app.post('/account/references/:id/rtr', need, form, (req, res) => {
    const r = mine(req, res); if (!r) return;
    const d = String((req.body || {}).date || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { r.rtrChecked = { date: d, how: clip(req.body.how, 60), by: req.who, at: new Date().toISOString() }; store.event(r, `Right to Rent check recorded by ${req.who}`); store.saveRef(r); }
    res.redirect(303, back(r, 'Right to Rent check recorded.') + '#rtr');
  });
  app.post('/account/references/:id/credit', need, form, (req, res) => {
    const r = mine(req, res); if (!r) return;
    const b = req.body || {}, n = v => Math.max(0, Math.min(1e7, parseInt(String(v || '0').replace(/[£,\s]/g, ''), 10) || 0));
    const s = { ccjs: n(b.ccjs), ccjValue: n(b.ccjValue), defaults: n(b.defaults), insolvency: b.insolvency === 'yes', electoralRoll: b.roll === 'yes' ? true : b.roll === 'no' ? false : null, notes: clip(b.notes, 300) };
    r.credit = { provider: 'manual', status: s.ccjs || s.insolvency || s.defaults ? 'adverse' : 'clear', summary: s, at: new Date().toISOString(), addedBy: req.who };
    store.event(r, `Credit result added by hand by ${req.who}`); store.saveRef(r);
    res.redirect(303, back(r, 'Credit result saved.') + '#credit');
  });
  app.post('/account/references/:id/upload', need, express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
    const r = mine(req, res); if (!r) return;
    const f = saveFile(r, req.body, ['credit', 'other'].includes(req.query.kind) ? req.query.kind : 'other', req.query.name);
    if (f.error) return res.status(400).json(f);
    store.event(r, `Document added by ${req.who}: ${f.name}`); store.saveRef(r); res.json({ ok: true });
  });
  app.get('/account/references/:id/file/:fid', need, (req, res) => {
    const r = mine(req, res); if (!r) return;
    const f = (r.files || []).find(x => x.id === req.params.fid);
    if (!f || r.filesDeletedAt) return res.status(404).type('text/plain').send('Not found');
    res.set({ 'Content-Type': f.mime, 'Content-Disposition': `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(path.join(store.fileDir(r.id), f.id));
  });

  /* ------------------------------ the report ------------------------------ */
  app.get('/account/references/:id/report', need, (req, res) => {
    const r = mine(req, res); if (!r) return;
    const o = assess(r), a = r.application || {}, st = stage(r, o), fin = st === 'complete', emp = a.employment || {}, er = (r.refs.employer || {}).answers, lr = (r.refs.landlord || {}).answers, cr = r.credit || {}, cs = cr.summary || {};
    const cur = (a.addresses || [])[0] || {}, hl = headline(o), ok = { pass: '✓', na: '✓', warn: '!', fail: '×', pending: '…' };
    const kv = rows => `<table class="rf-kv">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>`;
    const verdict = { accepted: 'pass', guarantor: 'warn', checks: 'fail', progress: 'pending', waiting: 'pending' }[o.outcome];
    show(req, res, { path: '/account/references', title: 'Report: ' + tenantName(r), body: `<p class="sub"><a href="${back(r)}">← Back to ${esc(tenantName(r))}</a></p>
      <div class="rf-rep-h"><div><h1><span>${fin ? 'Final' : 'Interim'} report for</span> ${esc(tenantName(r))}</h1>${isG(r) ? `<p class="rf-rep-g"><b>Guarantor for</b> ${esc(r.guarantorFor.name)}</p>` : ''}</div><a class="btn primary sm" href="/account/references/${r.id}/report.pdf">Download PDF</a></div>
      <div class="card rf-strip"><div><span>${fin ? 'Date completed' : 'Date'}</span><b>${esc(day(fin ? r.updatedAt : new Date()))}</b></div><div><span>Requested by</span><b>${esc(r.landlordName)}</b></div><div><span>Our reference</span><b class="rf-code">${esc(refNo(r))}</b></div>
        <div><span>Product</span><b>${isG(r) ? 'Guarantor reference' : 'Tenant reference'}</b></div><div><span>Rent applied for</span><b class="rf-money">${gbp(r.property.rentP)}</b></div></div>
      <div class="rf-outcome"><h2>Outcome</h2><div class="rf-outcome-row">${hl.map(([t, s]) => `<div><span class="rf-circ ${s}">${ok[s]}</span><b>${esc(t)}</b></div>`).join('')}<div class="rf-eq">=</div><div><span class="rf-circ big ${verdict}">${ok[verdict]}</span><b>${esc(o.label)}</b></div></div>
        <p class="rf-band">Yearly income ${pounds(o.afford.income)} ${o.afford.verified ? '(confirmed by the employer)' : '(as declared)'} = ${o.afford.ratio ? o.afford.ratio.toFixed(1) : '0'} × the monthly rent of ${pounds(r.property.rentP / 100)} · needs ${o.afford.multiple} ×</p></div>
      <div class="rf-two" style="margin-top:18px;align-items:start"><div class="card" style="margin:0"><h2>Prospective property</h2>${kv([['Address', r.property.address], ['Tenancy start', r.property.start ? day(r.property.start) : ''], ['Term', r.property.term ? r.property.term + ' months' : ''], ['Total rent', gbp(r.property.totalRentP || r.property.rentP)], [isG(r) ? 'Rent guaranteed' : 'Rent share', gbp(r.property.rentP)]])}</div>
        <div class="card" style="margin:0"><h2>Applicant</h2>${kv([['Name', tenantName(r)], ['Current address', cur.line], ['Postcode', cur.postcode], ['Date of birth', a.dob ? day(a.dob) : ''], ['Mobile', a.phone], ['Email', a.email]])}</div></div>
      <div class="card"><h2>Identity and Right to Rent</h2>${kv([['Evidence given', a.rtr ? (a.rtr.route === 'sharecode' ? 'Home Office share code ' + (a.rtr.shareCode || '') : 'British or Irish passport' + ((r.files || []).some(f => f.kind === 'id') ? ' (photo uploaded)' : '')) : ''], ['Checked by the landlord', r.rtrChecked ? `${day(r.rtrChecked.date)}, ${r.rtrChecked.how}` : 'Not yet recorded']])}</div>
      <div class="card"><h2>Verification of earnings</h2>${kv([['Status', emp.status], ['Employer name', emp.employer], ['Confirmed job title', er ? (er.jobTitle || 'Not confirmed') : 'Not confirmed yet'], ['Position', er ? er.contract : ''], ['Employment start date', er && er.start ? day(er.start) : emp.startDate || ''], ['In probation', er ? er.probation : ''],
        ['Confirmed income', er && +er.salary ? gbp(+er.salary * 100) + ' a year' : ''], ['Declared income', +emp.salary ? gbp(+emp.salary * 100) + ' a year' : ''], ['Other income', a.otherIncome && +a.otherIncome.amount ? gbp(+a.otherIncome.amount * 100) + ' a year' + (a.otherIncome.source ? ' (' + a.otherIncome.source + ')' : '') : ''],
        ['Verified method', er ? `Employer reference online from ${[er.refName, er.refPosition].filter(Boolean).join(', ')}` : (r.files || []).some(f => f.kind === 'income') ? 'Documents uploaded (see Documents)' : 'Not verified']])}</div>
      ${lr ? `<div class="card"><h2>Previous landlord</h2>${kv([['Given by', lr.refName], ['Rent', +lr.rent ? gbp(+lr.rent * 100) + ' a month' : ''], ['Rent paid on time', lr.paidOnTime], ['Arrears now', +lr.arrears ? gbp(+lr.arrears * 100) : 'None'], ['Condition of the property', lr.condition], ['Would rent to them again', lr.again], ['Comments', lr.comments]])}</div>` : ''}
      <div class="card"><h2>Addresses (${(a.addresses || []).length})</h2><div class="rf-docs">${(a.addresses || []).map(x => `<div><span>${esc([x.line, x.postcode].filter(Boolean).join(', ').toUpperCase())}</span><small>${esc(x.from)} to ${x.to === 'current' ? 'now' : esc(x.to)}</small></div>`).join('')}</div></div>
      <div class="card"><h2>Public information and credit</h2>${cr.status && cr.status !== 'pending' ? kv([['County Court Judgments', String(cs.ccjs || 0) + (cs.ccjValue ? ' (' + pounds(cs.ccjValue) + ')' : '')], ['Bankruptcies and insolvencies', cs.insolvency ? '1 or more' : '0'], ['Defaults', cs.defaults != null ? String(cs.defaults) : ''], ['Electoral roll', cs.electoralRoll == null ? '' : cs.electoralRoll ? 'Registered' : 'Not registered'], ['Source', cr.provider === 'manual' ? 'Credit report added by hand' : cr.provider === 'sandbox' ? 'Sandbox: TEST DATA' : cr.provider]]) : '<p class="sub">Not checked yet.</p>'}
        ${a.adverse && (a.adverse.ccj === 'yes' || a.adverse.bankrupt === 'yes') ? `<p class="notice">Declared by the applicant: ${esc([a.adverse.ccj === 'yes' && 'a CCJ', a.adverse.bankrupt === 'yes' && 'a bankruptcy or IVA'].filter(Boolean).join(' and '))}${a.adverse.details ? ': ' + esc(a.adverse.details) : ''}.</p>` : ''}</div>
      <div class="card"><h2>All checks</h2>${itemsHTML(o)}</div>
      <p class="sub" style="margin-top:18px">The information in this report was given by the applicant, their referees and, where shown, a credit reference provider. It is a recommendation to help you decide, not a guarantee that the applicant will keep to the tenancy; the decision is yours. Refusing a tenant because they receive benefits or have children is unlawful in England.</p>` });
  });
  const pdfOut = (res, buf, name) => res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name.replace(/[^\w .-]/g, '')}.pdf"`, 'Cache-Control': 'private, no-store' }).send(buf);
  app.get('/account/references/:id/report.pdf', need, async (req, res) => { const r = mine(req, res); if (!r) return; pdfOut(res, await reportPdf(r), `${stage(r) === 'complete' ? 'Final' : 'Interim'} report - ${tenantName(r)}`); });
  app.get('/account/references/:id/application.pdf', need, async (req, res) => { const r = mine(req, res); if (!r) return; if (!(r.application || {}).submittedAt) return res.redirect(303, back(r)); pdfOut(res, await applicationPdf(r), `Application form - ${tenantName(r)}`); });
  app.get('/account/references/:id/consent.pdf', need, async (req, res) => { const r = mine(req, res); if (!r) return; if (!(r.application || {}).submittedAt) return res.redirect(303, back(r)); pdfOut(res, await consentPdf(r), `Signed consent - ${tenantName(r)}`); });
}

// Uploaded documents: PDF, JPEG, PNG or WebP, checked by their first bytes; up to 10 MB and 20 per reference.
function saveFile(r, buf, kind, name){
  if (!Buffer.isBuffer(buf) || buf.length < 50) return { error: 'That file is empty.' };
  const mime = buf.slice(0, 4).toString() === '%PDF' ? 'application/pdf' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.slice(1, 4).toString() === 'PNG' ? 'image/png' : buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : '';
  if (!mime) return { error: 'Upload a PDF or a photo (JPEG, PNG or WebP).' };
  if ((r.files || []).length >= 20) return { error: 'Up to 20 documents per reference.' };
  const id = store.id(); fs.writeFileSync(path.join(store.fileDir(r.id), id), buf);
  const f = { id, kind, name: clip(name, 100) || kind + '.' + mime.split('/')[1], mime, size: buf.length, at: new Date().toISOString() };
  (r.files = r.files || []).push(f); return f;
}
module.exports = { mount, saveFile };
