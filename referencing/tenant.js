// Tenant referencing, the tenant's and referees' side (no account; the random link is the access):
//   /reference/apply/<token>   the tenant's application, saved as they type (save), documents (file), then submit
//   /reference/r/<token>       the employer's or previous landlord's short reference form
// On submit the referees get their links by email (the landlord can also send them), the credit check runs if a
// provider is connected and the tenant consented, and the landlord is emailed.
const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const credit = require('./credit');
const { assess, pounds } = require('./assess');
const { tenantName } = require('./pdf');
const { esc, day, clip } = require('./util');
const landlords = require('../landlords');
const { saveFile } = require('./landlord');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const oneOf = (v, list) => list.includes(v) ? v : '';
const yn = v => oneOf(v, ['yes', 'no']);
const month = v => /^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : '';
const date = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
const num = v => { const n = Math.round(parseFloat(String(v == null ? '' : v).replace(/[£,\s]/g, ''))); return n >= 0 && n < 1e8 ? n : null; };
const STATUS = ['employed', 'self-employed', 'student', 'retired', 'not working'];

// Only the fields we ask for, each trimmed and checked.
function cleanApp(b){
  b = b || {}; const o = x => x || {};
  return {
    firstName: clip(b.firstName, 60), lastName: clip(b.lastName, 60), dob: date(b.dob), email: clip(b.email, 120).toLowerCase(), phone: clip(b.phone, 30),
    addresses: (Array.isArray(b.addresses) ? b.addresses : []).slice(0, 10).map(a => ({ line: clip(a.line, 200), postcode: clip(a.postcode, 10).toUpperCase(), from: month(a.from), to: a.to === 'current' ? 'current' : month(a.to), status: oneOf(a.status, ['renting', 'owner', 'family', 'other']) })),
    employment: { status: oneOf(o(b.employment).status, STATUS), employer: clip(o(b.employment).employer, 120), jobTitle: clip(o(b.employment).jobTitle, 80), salary: num(o(b.employment).salary), startDate: month(o(b.employment).startDate),
      refName: clip(o(b.employment).refName, 80), refEmail: clip(o(b.employment).refEmail, 120).toLowerCase(), refPhone: clip(o(b.employment).refPhone, 30) },
    otherIncome: { amount: num(o(b.otherIncome).amount), source: clip(o(b.otherIncome).source, 120) },
    prevLandlord: { has: yn(o(b.prevLandlord).has), name: clip(o(b.prevLandlord).name, 80), email: clip(o(b.prevLandlord).email, 120).toLowerCase(), phone: clip(o(b.prevLandlord).phone, 30), address: clip(o(b.prevLandlord).address, 200), rent: num(o(b.prevLandlord).rent) },
    rtr: { route: oneOf(o(b.rtr).route, ['passport', 'sharecode']), shareCode: String(o(b.rtr).shareCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9) },
    adverse: { ccj: yn(o(b.adverse).ccj), bankrupt: yn(o(b.adverse).bankrupt), details: clip(o(b.adverse).details, 400) },
    guarantor: { name: clip(o(b.guarantor).name, 80), email: clip(o(b.guarantor).email, 120).toLowerCase(), phone: clip(o(b.guarantor).phone, 30) },
    consents: { credit: o(b.consents).credit === true, data: o(b.consents).data === true, declaration: o(b.consents).declaration === true }, signature: clip(b.signature, 80),
  };
}
// What still stops the application being sent.
function problems(a, r){
  const p = [], e = a.employment, l = a.prevLandlord;
  if (!a.firstName || !a.lastName) p.push('your full name'); if (!a.dob) p.push('your date of birth');
  if (!EMAIL.test(a.email)) p.push('your email'); if (!a.phone) p.push('your mobile number');
  if (!a.addresses.length || !a.addresses[0].line || !a.addresses[0].postcode || !a.addresses[0].from) p.push('your current address and when you moved in');
  if (!e.status) p.push('your employment');
  if (e.status === 'employed' && (!e.employer || !e.salary || !e.refName || !(EMAIL.test(e.refEmail) || e.refPhone))) p.push('your employer, salary and a contact there for the reference');
  if (e.status === 'self-employed' && !e.salary) p.push('your yearly income');
  if (!l.has && r.role !== 'guarantor') p.push('whether you rent now (previous landlord)');
  if (l.has === 'yes' && (!l.name || !(EMAIL.test(l.email) || l.phone))) p.push('your landlord’s name and email or phone');
  if (!a.rtr.route) p.push('your Right to Rent evidence');
  if (a.rtr.route === 'sharecode' && a.rtr.shareCode.length !== 9) p.push('your 9-character share code');
  if (a.rtr.route === 'passport' && !(r.files || []).some(f => f.kind === 'id')) p.push('a photo of your passport');
  if (!a.adverse.ccj || !a.adverse.bankrupt) p.push('the questions about CCJs and bankruptcy');
  if (!a.consents.credit || !a.consents.data || !a.consents.declaration) p.push('the three consent boxes');
  if (!a.signature) p.push('your name as your signature');
  return p;
}

function mount(app, H){
  const json = express.json({ limit: '64kb' }), form = express.urlencoded({ extended: false, limit: '16kb' });
  const saveLimit = H.limiter(600, 3600e3), fileLimit = H.limiter(60, 3600e3), refLimit = H.limiter(20, 3600e3);
  const find = (req, kind) => { const x = store.byToken(req.params.token); return x && (kind ? x.kind === kind || (kind === 'ref' && ['employer', 'landlord'].includes(x.kind)) : true) ? x : null; };
  const gone = (req, res) => H.show(req, res, { path: '/reference', title: 'Link not found', status: 404, body: '<div class="card"><h1>This link isn’t working</h1><p>It may have been mistyped, or the reference was cancelled. Ask the landlord or agent to send it again.</p></div>' });

  /* ------------------------------ the tenant's application ------------------------------ */
  app.get('/reference/apply/:token', (req, res) => {
    const x = find(req, 'apply'); if (!x) return gone(req, res);
    const r = x.r, a = r.application, G = r.role === 'guarantor';
    if (a && a.submittedAt) return H.show(req, res, { path: '/reference', title: 'Application sent', body: `<div class="card" style="text-align:center"><h1>Thank you, ${esc(a.firstName)}</h1>
      <p>Your application for <b>${esc(r.property.address)}</b> has been sent to ${esc(r.landlordName || 'the landlord')}.</p><p class="sub">We’re now asking your referees to reply. If they don’t hear from us, ask them to check their spam folder.</p></div>` });
    const d = r.draft || { firstName: r.tenant.name.split(' ')[0], lastName: r.tenant.name.split(' ').slice(1).join(' '), email: r.tenant.email, phone: r.tenant.phone };
    const v = (p, dflt = '') => { const val = p.split('.').reduce((o, k) => (o || {})[k], d); return esc(val == null ? dflt : val); };
    const sel = (p, opts, ph) => `<select data-k="${p}"><option value="">${ph || 'Choose…'}</option>${opts.map(([val, t]) => `<option value="${val}"${v(p) === val ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    const radio = (p, opts) => `<div style="display:flex;gap:18px;flex-wrap:wrap">${opts.map(([val, t]) => `<label class="rf-check"><input type="radio" name="${p}" data-k="${p}" value="${val}"${v(p) === val ? ' checked' : ''}> ${t}</label>`).join('')}</div>`;
    const addrs = (d.addresses && d.addresses.length ? d.addresses : [{ to: 'current' }]);
    const addrBlock = (ad, i) => `<div class="rf-addr" data-addr><b>${i ? 'Previous address' : 'Your current address'}</b>
      <label>Address<input data-a="line" maxlength="200" value="${esc(ad.line)}" autocomplete="${i ? 'off' : 'street-address'}"></label>
      <div class="rf-three"><label>Postcode<input data-a="postcode" maxlength="10" value="${esc(ad.postcode)}"></label><label>Moved in<input data-a="from" type="month" value="${esc(ad.from)}"></label>
      ${i ? `<label>Moved out<input data-a="to" type="month" value="${esc(ad.to === 'current' ? '' : ad.to)}"></label>` : '<input type="hidden" data-a="to" value="current">'}</div>
      <label>You were<select data-a="status">${[['renting', 'Renting'], ['family', 'Living with family or friends'], ['owner', 'A homeowner'], ['other', 'Other']].map(([val, t]) => `<option value="${val}"${ad.status === val ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      ${i ? '<button type="button" class="btn ghost sm" data-del>Remove this address</button>' : ''}</div>`;
    const files = kind => (r.files || []).filter(f => f.kind === kind).map(f => `<div class="rf-file"><span>${esc(f.name)}</span><button type="button" data-delfile="${f.id}">Remove</button></div>`).join('');
    H.show(req, res, { path: '/reference', title: 'Your tenant reference', body: `
      <span class="kicker">${G ? 'Guarantor reference' : 'Tenant reference'}</span><h1 style="margin-top:6px">${G ? `Guarantor for ${esc(r.guarantorFor.name)}` : `Apply for ${esc(r.property.address)}`}</h1>
      <p class="sub">${G ? `${esc(r.guarantorFor.name)} has applied to rent ${esc(r.property.address)} and named you as their guarantor: someone who agrees to pay the rent if they can’t. This reference checks you could. ` : ''}For ${esc(r.landlordName || 'the landlord')} · rent ${pounds(r.property.rentP / 100)} a month. About 10 minutes. Your answers save as you go: you can close this page and come back to the same link.</p>
      <noscript><p class="notice">Please turn on JavaScript to fill in this form.</p></noscript>
      <form id="app" class="rf-form" onsubmit="return false">
      <div class="card"><fieldset><legend>1. About you</legend>
        <div class="rf-two"><label>First name<input data-k="firstName" maxlength="60" value="${v('firstName')}" autocomplete="given-name"></label><label>Last name<input data-k="lastName" maxlength="60" value="${v('lastName')}" autocomplete="family-name"></label></div>
        <div class="rf-three"><label>Date of birth<input data-k="dob" type="date" value="${v('dob')}" autocomplete="bday"></label><label>Email<input data-k="email" type="email" value="${v('email')}" autocomplete="email"></label><label>Mobile<input data-k="phone" type="tel" value="${v('phone')}" autocomplete="tel"></label></div></fieldset></div>
      <div class="card"><fieldset><legend>2. Where you’ve lived (the last 3 years)</legend><div id="addrs" style="display:grid;gap:12px">${addrs.map(addrBlock).join('')}</div>
        <button type="button" class="btn ghost sm" id="addAddr" style="justify-self:start">+ Add a previous address</button></fieldset></div>
      <div class="card"><fieldset><legend>3. Work and income</legend>
        <label>You are${sel('employment.status', [['employed', 'Employed'], ['self-employed', 'Self-employed'], ['student', 'A student'], ['retired', 'Retired'], ['not working', 'Not working at the moment']])}</label>
        <div data-show="employment.status=employed|self-employed" class="rf-form">
          <div class="rf-two"><label><span data-emp>Employer</span><input data-k="employment.employer" maxlength="120" value="${v('employment.employer')}"></label><label>Job title<input data-k="employment.jobTitle" maxlength="80" value="${v('employment.jobTitle')}"></label></div>
          <div class="rf-two"><label>Yearly income before tax (£)<input data-k="employment.salary" inputmode="numeric" value="${v('employment.salary')}"></label><label>Started<input data-k="employment.startDate" type="month" value="${v('employment.startDate')}"></label></div></div>
        <div data-show="employment.status=employed" class="rf-form"><p class="sub" style="margin:0">Who can confirm your job? Usually your manager or HR. We’ll ask them for a short reference.</p>
          <div class="rf-three"><label>Their name<input data-k="employment.refName" maxlength="80" value="${v('employment.refName')}"></label><label>Their work email<input data-k="employment.refEmail" type="email" value="${v('employment.refEmail')}"></label><label>Their phone <span class="opt">(optional)</span><input data-k="employment.refPhone" type="tel" value="${v('employment.refPhone')}"></label></div></div>
        <div class="rf-two"><label>Other income a year (£) <span class="opt">(optional)</span><input data-k="otherIncome.amount" inputmode="numeric" value="${v('otherIncome.amount')}"></label><label>From <span class="opt">(e.g. a second job, pension, benefits)</span><input data-k="otherIncome.source" maxlength="120" value="${v('otherIncome.source')}"></label></div>
        <label>Payslips, bank statements or accounts <span class="opt">(the last 3 months is ideal)</span></label><div class="rf-files" id="files-income">${files('income')}</div>
        <button type="button" class="btn ghost sm" data-up="income" style="justify-self:start">+ Add a document</button></fieldset></div>
      <div class="card"${G ? ' hidden' : ''}><fieldset><legend>4. Your landlord</legend>
        <label>Do you rent from a landlord or letting agent now (or did you in the last 3 years)?</label>${radio('prevLandlord.has', [['yes', 'Yes'], ['no', 'No']])}
        <div data-show="prevLandlord.has=yes" class="rf-form"><p class="sub" style="margin:0">We’ll ask them for a short reference.</p>
          <div class="rf-three"><label>Landlord or agent name<input data-k="prevLandlord.name" maxlength="80" value="${v('prevLandlord.name')}"></label><label>Their email<input data-k="prevLandlord.email" type="email" value="${v('prevLandlord.email')}"></label><label>Their phone <span class="opt">(optional)</span><input data-k="prevLandlord.phone" type="tel" value="${v('prevLandlord.phone')}"></label></div>
          <label>Monthly rent there (£) <span class="opt">(optional)</span><input data-k="prevLandlord.rent" inputmode="numeric" value="${v('prevLandlord.rent')}"></label></div></fieldset></div>
      <div class="card"><fieldset><legend>5. Right to Rent and identity</legend>
        <p class="sub" style="margin:0">Landlords in England must check everyone’s right to rent.</p>
        ${radio('rtr.route', [['passport', 'I have a British or Irish passport'], ['sharecode', 'I have a Home Office share code']])}
        <div data-show="rtr.route=sharecode"><label>Share code <span class="opt">(9 characters, from gov.uk/prove-right-to-rent)</span><input data-k="rtr.shareCode" maxlength="11" value="${v('rtr.shareCode')}" style="text-transform:uppercase;letter-spacing:.1em"></label></div>
        <label>A photo of your passport or ID <span class="opt" data-show="rtr.route=sharecode">(optional with a share code)</span></label><div class="rf-files" id="files-id">${files('id')}</div>
        <button type="button" class="btn ghost sm" data-up="id" style="justify-self:start">+ Add a photo</button></fieldset></div>
      <div class="card"><fieldset><legend>6. Credit history</legend>
        <label>Have you ever had a County Court Judgment (CCJ)?</label>${radio('adverse.ccj', [['no', 'No'], ['yes', 'Yes']])}
        <label>Have you ever been bankrupt or had an IVA?</label>${radio('adverse.bankrupt', [['no', 'No'], ['yes', 'Yes']])}
        <div data-show="adverse.ccj=yes|adverse.bankrupt=yes"><label>Tell us briefly what happened <span class="opt">(optional)</span><textarea data-k="adverse.details" maxlength="400" rows="2">${v('adverse.details')}</textarea></label></div></fieldset></div>
      <div class="card"${G ? ' hidden' : ''}><fieldset><legend>7. Guarantor <span class="opt" style="font-size:14px;font-weight:400">(optional)</span></legend>
        <p class="sub" style="margin:0">Someone who agrees to pay the rent if you can’t. Only if you have one in mind.</p>
        <div class="rf-three"><label>Name<input data-k="guarantor.name" maxlength="80" value="${v('guarantor.name')}"></label><label>Email<input data-k="guarantor.email" type="email" value="${v('guarantor.email')}"></label><label>Phone<input data-k="guarantor.phone" type="tel" value="${v('guarantor.phone')}"></label></div></fieldset></div>
      <div class="card"><fieldset><legend>8. Consent and declaration</legend>
        <label class="rf-check"><input type="checkbox" data-k="consents.credit"${d.consents && d.consents.credit ? ' checked' : ''}> I agree to a credit search being made to check my identity and credit history. It leaves a “soft” footprint that other lenders can’t see.</label>
        <label class="rf-check"><input type="checkbox" data-k="consents.data"${d.consents && d.consents.data ? ' checked' : ''}> I agree to DIY Inventory contacting my referees and sharing this application and its results with ${esc(r.landlordName || 'the landlord')} for this tenancy (<a href="/privacy#referencing" target="_blank">how my data is used</a>).</label>
        ${G ? `<p class="sub" style="margin:0">You are being referenced as guarantor for ${esc(r.guarantorFor.name)}. The guarantee itself is a separate agreement you’ll be asked to sign by the landlord or agent.</p>` : ''}
        <label class="rf-check"><input type="checkbox" data-k="consents.declaration"${d.consents && d.consents.declaration ? ' checked' : ''}> The information I’ve given is true and complete. I understand that giving false information may mean my application is refused.</label>
        <label>Type your full name to sign<input data-k="signature" maxlength="80" value="${v('signature')}" autocomplete="name"></label></fieldset>
        <div id="err" class="notice" hidden style="margin:16px 0 0"></div>
        <p style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:18px"><button type="button" class="btn primary" id="send">Send my application</button><span class="rf-saved" id="saved"></span></p></div>
      </form><input type="file" id="pick" hidden accept=".pdf,image/*">
      <script>${APP_JS.replace('%TOKEN%', r.tokens.apply)}</script>` });
  });
  app.post('/reference/apply/:token/save', json, (req, res) => {
    const x = find(req, 'apply'); if (!x) return res.status(404).json({ error: 'gone' });
    if (!saveLimit(x.r.id)) return res.status(429).json({ error: 'busy' });
    if (x.r.application && x.r.application.submittedAt) return res.status(409).json({ error: 'Already sent.' });
    x.r.draft = cleanApp(req.body); store.saveRef(x.r); res.json({ ok: true });
  });
  app.post('/reference/apply/:token/file', express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
    const x = find(req, 'apply'); if (!x) return res.status(404).json({ error: 'gone' });
    if (x.r.application && x.r.application.submittedAt) return res.status(409).json({ error: 'Already sent.' });
    if (!fileLimit(x.r.id)) return res.status(429).json({ error: 'Too many uploads. Try again later.' });
    const f = saveFile(x.r, req.body, req.query.kind === 'id' ? 'id' : 'income', req.query.name);
    if (f.error) return res.status(400).json(f);
    store.saveRef(x.r); res.json({ ok: true, file: { id: f.id, name: f.name, kind: f.kind } });
  });
  app.post('/reference/apply/:token/file/:fid/delete', (req, res) => {
    const x = find(req, 'apply'); if (!x) return res.status(404).json({ error: 'gone' });
    if (x.r.application && x.r.application.submittedAt) return res.status(409).json({ error: 'Already sent.' });
    const f = (x.r.files || []).find(y => y.id === req.params.fid && ['id', 'income'].includes(y.kind));
    if (f) { fs.rmSync(path.join(store.fileDir(x.r.id), f.id), { force: true }); x.r.files = x.r.files.filter(y => y !== f); store.saveRef(x.r); }
    res.json({ ok: true });
  });
  app.post('/reference/apply/:token/submit', json, async (req, res) => {
    const x = find(req, 'apply'); if (!x) return res.status(404).json({ error: 'gone' });
    const r = x.r;
    if (r.application && r.application.submittedAt) return res.json({ ok: true });
    const a = cleanApp(req.body), miss = problems(a, r);
    r.draft = a;
    if (miss.length) { store.saveRef(r); return res.status(400).json({ error: 'Please add ' + miss.join(', ') + '.' }); }
    a.submittedAt = new Date().toISOString(); a.ip = H.clientIp ? H.clientIp(req) : req.ip;
    r.application = a; delete r.draft; r.status = 'submitted';
    const base = H.base(req), who = `${a.firstName} ${a.lastName}`;
    store.event(r, 'Application sent by the tenant');
    const ask = (kind, name, email, label) => {
      r.tokens[kind] = r.tokens[kind] || store.token(); r.refs[kind] = Object.assign(r.refs[kind] || {}, { requestedAt: a.submittedAt, email, name });
      if (!EMAIL.test(email || '')) return;
      landlords.sendEmail({ to: email, subject: `Reference request: ${who}`, replyTo: r.landlordEmail,
        text: `Hello${name ? ' ' + name.split(' ')[0] : ''},\n\n${who} has applied to rent a property and named you as their ${label}. Please give a short reference here (about 2 minutes):\n${base}/reference/r/${r.tokens[kind]}\n\nThey agreed to us contacting you. Thank you.\n\nDIY Inventory, for ${r.landlordName}` })
        .then(s => { if (s && s.ok) { const y = store.ref(r.id); if (y && y.refs[kind]) { y.refs[kind].emailedAt = new Date().toISOString(); store.event(y, `Reference request emailed to the ${label}`); store.saveRef(y); } } });
    };
    if (a.employment.status === 'employed') ask('employer', a.employment.refName, a.employment.refEmail, 'employer');
    if (a.prevLandlord.has === 'yes') ask('landlord', a.prevLandlord.name, a.prevLandlord.email, 'previous landlord');
    if (credit.provider() && a.consents.credit) r.credit = { status: 'pending', at: a.submittedAt };
    store.saveRef(r);
    landlords.sendEmail({ to: r.landlordEmail, subject: `${who} has sent their application`, text: `${who} has completed their application for ${r.property.address}.\n\nSee the progress and the report: ${base}/account/references/${r.id}\n\nDIY Inventory` });
    if (r.credit && r.credit.status === 'pending') credit.run({ tenant: { firstName: a.firstName, lastName: a.lastName }, dob: a.dob, addresses: a.addresses, consentAt: a.submittedAt }).then(c => {
      const y = store.ref(r.id); if (!y) return; y.credit = c; store.event(y, 'Credit check: ' + c.status); store.saveRef(y); });
    res.json({ ok: true });
  });

  /* ------------------------------ referees ------------------------------ */
  const refPage = (req, res, x, msg) => {
    const r = x.r, a = r.application || {}, who = `${a.firstName} ${a.lastName}`, done = (r.refs[x.kind] || {}).answers;
    if (done) return H.show(req, res, { path: '/reference', title: 'Reference sent', body: `<div class="card" style="text-align:center"><h1>Thank you</h1><p>Your reference for ${esc(who)} has been received.</p></div>` });
    const radio = (n, opts) => `<div style="display:flex;gap:18px;flex-wrap:wrap">${opts.map(([v, t]) => `<label class="rf-check"><input type="radio" name="${n}" value="${v}" required> ${t}</label>`).join('')}</div>`;
    const emp = x.kind === 'employer';
    H.show(req, res, { path: '/reference', title: 'Reference for ' + who, notice: msg ? { text: msg } : null, body: `<span class="kicker">${emp ? 'Employer' : 'Landlord'} reference</span><h1 style="margin-top:6px">Reference for ${esc(who)}</h1>
      <p class="sub">${esc(who)} has applied to rent a property and named you as their ${emp ? 'employer' : 'previous landlord'}. They consented to us asking. It takes about 2 minutes.</p>
      <div class="card"><form class="rf-form" method="post" action="/reference/r/${esc(req.params.token)}">
      ${emp ? `<label>Does ${esc(a.firstName)} work for ${esc(a.employment.employer || 'your organisation')}?</label>${radio('employed', [['yes', 'Yes'], ['no', 'No']])}
        <div class="rf-two"><label>Job title<input name="jobTitle" maxlength="80" value="${esc(a.employment.jobTitle)}"></label><label>Start date<input name="start" type="date"></label></div>
        <div class="rf-two"><label>Contract<select name="contract"><option value="permanent">Permanent</option><option value="fixed-term">Fixed-term</option><option value="zero-hours">Zero hours</option><option value="agency">Agency or temporary</option><option value="other">Other</option></select></label>
          <label>Yearly salary before tax (£)<input name="salary" inputmode="numeric" required></label></div>
        <label>Still in a probation period?</label>${radio('probation', [['no', 'No'], ['yes', 'Yes']])}
        <div class="rf-two"><label>Your name<input name="refName" required maxlength="80"></label><label>Your position<input name="refPosition" maxlength="80"></label></div>`
      : `<div class="rf-two"><label>Tenancy started<input name="from" type="date"></label><label>Ended <span class="opt">(leave empty if they still rent from you)</span><input name="to" type="date"></label></div>
        <label>Monthly rent (£)<input name="rent" inputmode="numeric"></label>
        <label>Did they pay the rent on time?</label>${radio('paidOnTime', [['always', 'Always'], ['mostly', 'Mostly'], ['no', 'Often late']])}
        <label>Rent arrears owed now (£)<input name="arrears" inputmode="numeric" value="0"></label>
        <label>How did they look after the property?</label>${radio('condition', [['good', 'Well'], ['fair', 'Fairly'], ['poor', 'Poorly']])}
        <label>Would you rent to them again?</label>${radio('again', [['yes', 'Yes'], ['no', 'No'], ['prefer not to say', 'Prefer not to say']])}
        <label>Your name<input name="refName" required maxlength="80"></label>`}
      <label>Anything else <span class="opt">(optional)</span><textarea name="comments" rows="3" maxlength="800"></textarea></label>
      <label class="rf-check"><input type="checkbox" name="confirm" required> The information I’ve given is accurate to the best of my knowledge.</label>
      <label class="hp" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="btn primary">Send the reference</button></form></div>
      <p class="sub">Your answers go only to the landlord or agent for this tenancy. <a href="/privacy#referencing">Privacy</a></p>` });
  };
  app.get('/reference/r/:token', (req, res) => { const x = find(req, 'ref'); if (!x || !(x.r.application || {}).submittedAt) return gone(req, res); refPage(req, res, x); });
  app.post('/reference/r/:token', form, (req, res) => {
    const x = find(req, 'ref'); if (!x || !(x.r.application || {}).submittedAt) return gone(req, res);
    const b = req.body || {}, r = x.r;
    if (b.website) return res.redirect(303, req.originalUrl);
    if ((r.refs[x.kind] || {}).answers) return refPage(req, res, x);
    if (!refLimit(H.clientIp ? H.clientIp(req) : req.ip)) return refPage(req, res, x, 'Too many tries from here. Try again later.');
    if (!b.confirm || !clip(b.refName, 80)) return refPage(req, res, x, 'Please add your name and tick the confirmation.');
    const ans = x.kind === 'employer'
      ? { employed: yn(b.employed), jobTitle: clip(b.jobTitle, 80), start: date(b.start), contract: oneOf(b.contract, ['permanent', 'fixed-term', 'zero-hours', 'agency', 'other']), salary: num(b.salary), probation: yn(b.probation), refName: clip(b.refName, 80), refPosition: clip(b.refPosition, 80), comments: clip(b.comments, 800) }
      : { from: date(b.from), to: date(b.to), rent: num(b.rent), paidOnTime: oneOf(b.paidOnTime, ['always', 'mostly', 'no']), arrears: num(b.arrears) || 0, condition: oneOf(b.condition, ['good', 'fair', 'poor']), again: oneOf(b.again, ['yes', 'no', 'prefer not to say']), refName: clip(b.refName, 80), comments: clip(b.comments, 800) };
    r.refs[x.kind] = Object.assign(r.refs[x.kind] || {}, { answers: ans, at: new Date().toISOString(), ip: H.clientIp ? H.clientIp(req) : req.ip });
    store.event(r, (x.kind === 'employer' ? 'Employer' : 'Previous landlord') + ' reference received from ' + ans.refName); store.saveRef(r);
    const o = assess(r), base = H.base(req);
    landlords.sendEmail({ to: r.landlordEmail, subject: o.complete ? `Reference complete: ${tenantName(r)}` : `${x.kind === 'employer' ? 'Employer' : 'Landlord'} reference received for ${tenantName(r)}`,
      text: `${o.complete ? 'All checks are back. Outcome: ' + o.label + '.' : 'A reference has come back for ' + tenantName(r) + '.'}\n\nSee it here: ${base}/account/references/${r.id}\n\nDIY Inventory` });
    refPage(req, res, x);
  });
}

// The application page's script: collects the answers, saves them a moment after each change, uploads documents,
// shows and hides the parts that depend on an answer, and sends the application.
const APP_JS = String.raw`(function(){
  var T = '%TOKEN%', f = document.getElementById('app'), saved = document.getElementById('saved'), timer = null;
  function setp(o, k, v){ var ks = k.split('.'); while (ks.length > 1) { var x = ks.shift(); o = o[x] = o[x] || {}; } o[ks[0]] = v; }
  function collect(){
    var o = {};
    f.querySelectorAll('[data-k]').forEach(function(el){
      if (el.type === 'radio') { if (el.checked) setp(o, el.dataset.k, el.value); }
      else setp(o, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value);
    });
    o.addresses = [].map.call(f.querySelectorAll('[data-addr]'), function(b){ var a = {}; b.querySelectorAll('[data-a]').forEach(function(el){ a[el.dataset.a] = el.value; }); return a; });
    return o;
  }
  function val(k){ var el = f.querySelector('[data-k="' + k + '"]:checked') || f.querySelector('select[data-k="' + k + '"]'); return el ? el.value : ''; }
  function shows(){ f.querySelectorAll('[data-show]').forEach(function(el){ el.hidden = !el.dataset.show.split('|').some(function(c){ var p = c.split('='); return val(p[0].indexOf('.') < 0 && p.length === 1 ? '' : p[0]) === p[1] || (p.length === 1 && false); }); });
    var e = document.querySelector('[data-emp]'); if (e) e.textContent = val('employment.status') === 'self-employed' ? 'Business name' : 'Employer'; }
  // Conditions like "a.b=x|c.d=y": each part names its own field.
  shows = (function(){ return function(){ f.querySelectorAll('[data-show]').forEach(function(el){ var cur = ''; el.hidden = !el.dataset.show.split('|').some(function(c){ var p = c.split('='); if (p.length === 2) { cur = p[0]; return val(p[0]) === p[1]; } return val(cur) === p[0]; }); });
    var e = document.querySelector('[data-emp]'); if (e) e.textContent = val('employment.status') === 'self-employed' ? 'Business name' : 'Employer'; }; })();
  function post(url, body){ return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  function save(){ clearTimeout(timer); saved.textContent = 'Saving…'; post('/reference/apply/' + T + '/save', collect()).then(function(r){ saved.textContent = r.ok ? 'Saved' : 'Not saved: check your connection'; }).catch(function(){ saved.textContent = 'Not saved: check your connection'; }); }
  f.addEventListener('input', function(){ clearTimeout(timer); saved.textContent = ''; timer = setTimeout(save, 1200); });
  f.addEventListener('change', function(){ shows(); clearTimeout(timer); timer = setTimeout(save, 400); });
  var addrs = document.getElementById('addrs');
  document.getElementById('addAddr').onclick = function(){
    var b = addrs.querySelector('[data-addr]').cloneNode(true); b.querySelector('b').textContent = 'Previous address';
    b.querySelectorAll('input,select').forEach(function(el){ el.value = el.tagName === 'SELECT' ? 'renting' : ''; });
    var h = b.querySelector('input[type=hidden][data-a=to]'); if (h) { var l = document.createElement('label'); l.innerHTML = 'Moved out<input data-a="to" type="month">'; h.replaceWith(l); }
    if (!b.querySelector('[data-del]')) { var d = document.createElement('button'); d.type = 'button'; d.className = 'btn ghost sm'; d.dataset.del = '1'; d.textContent = 'Remove this address'; b.appendChild(d); }
    addrs.appendChild(b); b.querySelector('input').focus();
  };
  addrs.addEventListener('click', function(e){ if (e.target.dataset.del) { e.target.closest('[data-addr]').remove(); save(); } });
  // Documents: photos are made smaller on the phone first; PDFs go as they are.
  var pick = document.getElementById('pick'), kind = '';
  f.addEventListener('click', function(e){
    var up = e.target.closest('[data-up]'); if (up) { kind = up.dataset.up; pick.click(); return; }
    var del = e.target.closest('[data-delfile]'); if (del && confirm('Remove this document?')) fetch('/reference/apply/' + T + '/file/' + del.dataset.delfile + '/delete', { method: 'POST' }).then(function(){ del.parentNode.remove(); });
  });
  function shrink(file){ return new Promise(function(ok){ if (!/^image\//.test(file.type)) return ok(file); var img = new Image(); img.onload = function(){ var s = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(function(b){ ok(b || file); }, 'image/jpeg', .85); }; img.onerror = function(){ ok(file); }; img.src = URL.createObjectURL(file); }); }
  pick.onchange = function(){
    var file = pick.files[0], k = kind; pick.value = ''; if (!file) return;
    var list = document.getElementById('files-' + k), row = document.createElement('div'); row.className = 'rf-file'; row.textContent = 'Uploading ' + file.name + '…'; list.appendChild(row);
    shrink(file).then(function(body){ return fetch('/reference/apply/' + T + '/file?kind=' + k + '&name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: body }); })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(x){ if (!x.ok) { row.textContent = x.j.error || 'That didn’t upload.'; return; } row.innerHTML = ''; var s = document.createElement('span'); s.textContent = x.j.file.name; var d = document.createElement('button'); d.type = 'button'; d.dataset.delfile = x.j.file.id; d.textContent = 'Remove'; row.append(s, d); })
      .catch(function(){ row.textContent = 'That didn’t upload: check your connection and try again.'; });
  };
  var err = document.getElementById('err'), send = document.getElementById('send');
  send.onclick = function(){
    send.disabled = true; send.textContent = 'Sending…'; err.hidden = true;
    post('/reference/apply/' + T + '/submit', collect()).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); }).then(function(x){
      if (x.ok) { location.reload(); return; }
      err.textContent = x.j.error || 'That didn’t send.'; err.hidden = false; send.disabled = false; send.textContent = 'Send my application';
    }).catch(function(){ err.textContent = 'That didn’t send: check your connection and try again.'; err.hidden = false; send.disabled = false; send.textContent = 'Send my application'; });
  };
  shows();
})();`;

module.exports = { mount, cleanApp, problems };
