// Staff logins for tenant referencing. A landlord or agency account adds its staff (name, email, a password they
// pass on); staff sign in at /team/sign-in and see only the account's references: the board, each reference, sending
// and chasing links, recording the Right to Rent check, reports and documents. They never see the account's
// properties, rent, expenses or settings, and only the account holder can add or remove staff.
// Stored in REPORTS_DIR/referencing/staff.json: { secret, staff: [{ id, accountId, name, email, salt, hash, ver, createdAt, lastSignInAt, by }] }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { esc, clip, when } = require('./util');
const landlords = require('../landlords');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAYS = 30, MAX_STAFF = 25;
let FILE = '';
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; } };
const write = s => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(s, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
function state(){ let s = read(); if (!s) { s = { secret: crypto.randomBytes(32).toString('hex'), staff: [] }; write(s); } return s; }
const mac = v => crypto.createHmac('sha256', state().secret).update(v).digest('hex');
const secure = req => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

function init(reportsDir){ const d = path.join(reportsDir, 'referencing'); fs.mkdirSync(d, { recursive: true }); FILE = path.join(d, 'staff.json'); state(); }
const forAccount = accId => state().staff.filter(s => s.accountId === accId);

// The signed-in member of staff, with their account, or null.
function current(req){
  const m = /(?:^|;\s*)diy_staff=([a-f0-9]{16})\.(\d{10,16})\.(\d{1,9})\.([a-f0-9]{64})/.exec((req && req.headers && req.headers.cookie) || '');
  if (!m || Number(m[2]) < Date.now()) return null;
  const a = Buffer.from(m[4]), b = Buffer.from(mac(m[1] + '.' + m[2] + '.' + m[3]));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const st = state().staff.find(s => s.id === m[1]);
  if (!st || String(st.ver || 0) !== m[3]) return null;
  const acc = landlords.readAccount(st.accountId);
  return acc ? { staff: st, acc } : null;
}
function setCookie(req, res, st){
  const v = st ? st.id + '.' + (Date.now() + DAYS * 864e5) + '.' + (st.ver || 0) : '';
  res.append('Set-Cookie', `diy_staff=${v ? v + '.' + mac(v) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${v ? DAYS * 86400 : 0}${secure(req) ? '; Secure' : ''}`);
}

function mount(app, H){
  const form = express.urlencoded({ extended: false, limit: '8kb' });
  const signLimit = H.limiter(10, 15 * 60e3);
  const page = (req, res, title, body, status) => H.show(req, res, { path: '/team/sign-in', title, status, body: `<div class="card" style="max-width:440px;margin:0 auto">${body}</div>` });

  /* ------------------------------ staff sign in / out ------------------------------ */
  const signIn = (req, res, msg, email) => page(req, res, 'Staff sign in', `<span class="kicker">Tenant referencing</span><h1 style="margin-top:6px">Staff sign in</h1>
    <p class="sub">See the progress of your team’s tenant references.</p>${msg ? `<p class="notice">${esc(msg)}</p>` : ''}
    <form class="rf-form" method="post" action="/team/sign-in"><label>Email<input name="email" type="email" required autocomplete="username" value="${esc(email || '')}"></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password"></label><button class="btn primary">Sign in</button></form>
    <p class="sub" style="margin-top:14px">Forgotten your password? Ask whoever added you to set a new one. Account holder? <a href="/account/sign-in">Sign in here</a>.</p>`, msg ? 400 : 200);
  app.get('/team/sign-in', (req, res) => current(req) ? res.redirect(303, '/account/references') : signIn(req, res));
  app.post('/team/sign-in', form, async (req, res) => {
    const b = req.body || {}, email = clip(b.email, 120).toLowerCase();
    if (!H.sameOrigin(req)) return signIn(req, res, 'Please sign in from this page.', email);
    if (!signLimit('staff:' + (H.clientIp ? H.clientIp(req) : req.ip))) return signIn(req, res, 'Too many tries. Wait 15 minutes and try again.', email);
    const st = state().staff.find(s => s.email === email);
    const ok = await landlords.checkPassword(st || null, String(b.password || ''));
    if (!st || !ok || !landlords.readAccount(st.accountId)) return signIn(req, res, 'That email and password don’t match.', email);
    const s = state(), x = s.staff.find(y => y.id === st.id); x.lastSignInAt = new Date().toISOString(); write(s);
    setCookie(req, res, x); res.redirect(303, '/account/references');
  });
  app.post('/team/sign-out', (req, res) => { setCookie(req, res, null); res.redirect(303, '/team/sign-in'); });

  // Staff change their own password.
  const pwPage = (req, res, c, msg, ok) => H.show(req, res, { staff: c.staff, acc: c.acc, path: '/team/password', title: 'Your password', status: msg && !ok ? 400 : 200, notice: msg ? { ok, text: msg } : null,
    body: `<div class="card" style="max-width:480px"><h1>Change your password</h1><form class="rf-form" method="post" action="/team/password">
      <label>Current password<input name="old" type="password" required autocomplete="current-password"></label><label>New password <span class="opt">(8 or more characters)</span><input name="pw" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary">Change password</button></form></div>` });
  app.get('/team/password', (req, res) => { const c = current(req); if (!c) return res.redirect(303, '/team/sign-in'); pwPage(req, res, c); });
  app.post('/team/password', form, async (req, res) => {
    const c = current(req); if (!c) return res.redirect(303, '/team/sign-in');
    if (!H.sameOrigin(req)) return pwPage(req, res, c, 'Please use this page.');
    const b = req.body || {};
    if (String(b.pw || '').length < 8) return pwPage(req, res, c, 'The new password needs 8 or more characters.');
    if (!(await landlords.checkPassword(c.staff, String(b.old || '')))) return pwPage(req, res, c, 'Your current password isn’t right.');
    const h = await landlords.hashPassword(String(b.pw)), s = state(), x = s.staff.find(y => y.id === c.staff.id);
    Object.assign(x, h, { ver: (x.ver || 0) + 1 }); write(s); setCookie(req, res, x);
    pwPage(req, res, { staff: x, acc: c.acc }, 'Password changed. Other devices have been signed out.', true);
  });

  /* ------------------------------ the account holder manages staff ------------------------------ */
  const owner = (req, res, next) => {
    const acc = landlords.currentAccount(req);
    if (!acc) return current(req) ? res.status(403).type('html').send('<p>Only the account holder can manage staff. <a href="/account/references">Back</a></p>') : res.redirect(303, '/account/sign-in?next=/account/references/team');
    if (req.method !== 'GET' && !H.sameOrigin(req)) return res.status(403).type('text/plain').send('Please use the buttons on the page.');
    req.acc = acc; next();
  };
  const teamPage = (req, res, msg, ok, shown) => {
    const list = forAccount(req.acc.id), base = H.base(req);
    H.show(req, res, { acc: req.acc, path: '/account/references/team', title: 'Staff', status: msg && !ok ? 400 : 200, notice: msg ? { ok, text: msg } : null, body: `
      <p class="sub"><a href="/account/references">← Tenant references</a></p>
      <div class="card"><h1>Staff</h1><p class="sub">Staff sign in at <b>${esc(base)}/team/sign-in</b> and see only your tenant references: progress, sending and chasing links, reports and documents. They can’t see your properties, rent or settings.</p>
      ${shown ? `<div class="notice ok"><b>Pass these on to ${esc(shown.name)}</b> (shown once):<br>Sign in at ${esc(base)}/team/sign-in<br>Email: ${esc(shown.email)}<br>Password: <code>${esc(shown.pw)}</code><br><span class="sub">They can change the password after signing in.</span></div>` : ''}
      ${list.length ? `<div class="rf-list">${list.map(s => `<div class="rf-row"><div><h3>${esc(s.name)}</h3><div class="sub">${esc(s.email)} · added ${esc(when(s.createdAt))} · ${s.lastSignInAt ? 'last signed in ' + esc(when(s.lastSignInAt)) : 'not signed in yet'}</div></div>
        <span style="display:flex;gap:8px;flex-wrap:wrap"><form method="post" action="/account/references/team/${s.id}/reset"><button class="btn ghost sm">New password</button></form>
        <form method="post" action="/account/references/team/${s.id}/delete" onsubmit="return confirm('Remove ${esc(s.name).replace(/'/g, '')}? They will be signed out.')"><button class="btn ghost sm">Remove</button></form></span></div>`).join('')}</div>` : '<p class="sub">No staff yet.</p>'}</div>
      <div class="card"><h2>Add a member of staff</h2><form class="rf-form" method="post" action="/account/references/team/add">
        <div class="rf-two"><label>Name<input name="name" required maxlength="80"></label><label>Work email<input name="email" type="email" required maxlength="120"></label></div>
        <p class="sub" style="margin:0">We make a password for them and show it to you once${landlords.emailOn() ? ', and email them how to sign in' : ''}.</p>
        <button class="btn primary">Add</button></form></div>` });
  };
  const newPw = () => crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
  app.get('/account/references/team', owner, (req, res) => teamPage(req, res));
  app.post('/account/references/team/add', owner, form, async (req, res) => {
    const b = req.body || {}, name = clip(b.name, 80), email = clip(b.email, 120).toLowerCase();
    if (!name || !EMAIL.test(email)) return teamPage(req, res, 'Add their name and work email.');
    const s = state();
    if (s.staff.some(x => x.email === email)) return teamPage(req, res, 'Someone with that email is already a member of staff.');
    if (forAccount(req.acc.id).length >= MAX_STAFF) return teamPage(req, res, `Up to ${MAX_STAFF} staff per account.`);
    const pw = newPw(), h = await landlords.hashPassword(pw);
    const st = Object.assign({ id: crypto.randomBytes(8).toString('hex'), accountId: req.acc.id, name, email, ver: 0, createdAt: new Date().toISOString(), by: req.acc.name }, h);
    s.staff.push(st); write(s);
    landlords.sendEmail({ to: email, replyTo: req.acc.email, fromName: `${req.acc.name} via DIY Inventory`, subject: 'Your staff sign-in for tenant references',
      text: `Hi ${name.split(' ')[0]},\n\n${req.acc.name} has added you as staff, so you can follow the progress of tenant references.\n\nSign in: ${H.base(req)}/team/sign-in\nEmail: ${email}\n\n${req.acc.name} will give you your password.\n\nDIY Inventory` });
    teamPage(req, res, 'Added.', true, { name, email, pw });
  });
  app.post('/account/references/team/:sid/reset', owner, async (req, res) => {
    const s = state(), x = s.staff.find(y => y.id === req.params.sid && y.accountId === req.acc.id);
    if (!x) return teamPage(req, res, 'Not found.');
    const pw = newPw(); Object.assign(x, await landlords.hashPassword(pw), { ver: (x.ver || 0) + 1 }); write(s);
    teamPage(req, res, 'New password made. They have been signed out.', true, { name: x.name, email: x.email, pw });
  });
  app.post('/account/references/team/:sid/delete', owner, (req, res) => {
    const s = state(), n = s.staff.length; s.staff = s.staff.filter(y => !(y.id === req.params.sid && y.accountId === req.acc.id));
    if (s.staff.length !== n) write(s);
    res.redirect(303, '/account/references/team');
  });
}
// When an account is deleted its staff go too (checked lazily: current() refuses staff of a missing account).
module.exports = { init, mount, current, forAccount };
