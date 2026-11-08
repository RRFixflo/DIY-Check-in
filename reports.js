// Submitted reports: each finished report's PDF is sent here and kept on disk, with a small JSON
// file of details beside it. Only the owner can list, open or delete them, at /admin, with the
// password in ADMIN_PASSWORD. On Railway the files live on the attached volume so they survive deploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Origin = require('./origin');
const express = require('express');

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const VOLUME = (process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
const REPORTS_DIR = (process.env.REPORTS_DIR || '').trim() || (VOLUME ? path.join(VOLUME, 'reports') : path.join(__dirname, 'data', 'reports'));
const PERSISTENT = !!(process.env.REPORTS_DIR || VOLUME) || !process.env.RAILWAY_ENVIRONMENT;
const MAX_PDF = 80 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9-]{8,80}$/;
const KEY_RE = /^[a-f0-9]{32}$/;
// The example report shown on the website (public/example/, made by the PDF test harness).
const EXAMPLE_KEY = 'e8a1c0d2b4f6e8a1c0d2b4f6e8a1c0d2', EXAMPLE_DIR = path.join(__dirname, 'public', 'example', 'photos');       // a report's private photo key (random, made on the tenant's phone)
const photoDir = id => path.join(REPORTS_DIR, id + '.photos');
const shared = {};   // filled in by mount()
// Email to the owner (REPORT_TO_EMAIL) when a report is sent (via Resend, resend.com). Without
// RESEND_API_KEY and REPORT_TO_EMAIL the report is still marked as sent and waits on /admin (with the ntfy alert).
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const REPORT_TO_EMAIL = (process.env.REPORT_TO_EMAIL || '').trim();
const REPORT_FROM_EMAIL = (process.env.REPORT_FROM_EMAIL || '').trim() || 'DIY Inventory <onboarding@resend.dev>';
// When this version of the software went live (the server starts on each deploy) and what changed, for /admin.
const STARTED_AT = new Date();
const DEPLOY_NOTE = String(process.env.RAILWAY_GIT_COMMIT_MESSAGE || '').split('\n')[0].trim().slice(0, 160);
const PUBLIC_URL = (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '')).replace(/\/+$/, '');
// Phone alert when a tenant sends a report, via the free ntfy app (ntfy.sh): subscribe to NTFY_TOPIC.
const NTFY_TOPIC = (process.env.NTFY_TOPIC || '').trim();
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').trim().replace(/\/+$/, '');
const MAX_ATTACH = 28 * 1024 * 1024; // Resend allows 40 MB per email after base64; larger PDFs go as a link to /admin

fs.mkdirSync(REPORTS_DIR, { recursive: true });

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COPY_TYPES = ['Check-In', 'Check-Out', 'Interim Inspection', 'Renewal Inspection'];
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// One-off access codes (DIY-XXXX-XXXX / FREE-XXXX-XXXX) made on /admin before the shared code: each is
// good for one report. New ones are no longer made. Kept in REPORTS_DIR/access-codes.json.
const CODES_FILE = path.join(REPORTS_DIR, 'access-codes.json');
try { if (!fs.existsSync(CODES_FILE)) fs.renameSync(path.join(REPORTS_DIR, 'free-codes.json'), CODES_FILE); } catch (e) {}
function readCodes(){ try { return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8')); } catch (e) { return []; } }
function writeCodes(list){ fs.writeFileSync(CODES_FILE + '.tmp', JSON.stringify(list, null, 1)); fs.renameSync(CODES_FILE + '.tmp', CODES_FILE); }
// The shared access code (2830 to start with; the owner can change it on /admin). Anyone given it can
// use the app without paying, as often as they like. Once typed, the browser keeps a cookie made from
// the code with a secret (SHARED-…), so it can't be guessed by setting the cookie, and changing the
// code ends every earlier one. Kept in REPORTS_DIR/access-code.json.
const SHARED_FILE = path.join(REPORTS_DIR, 'access-code.json');
const DEFAULT_SHARED_CODE = '2830';
const normCode = raw => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function readShared(){
  let d = {}; try { d = JSON.parse(fs.readFileSync(SHARED_FILE, 'utf8')); } catch (e) {}
  if (!d.secret) { d = { code: DEFAULT_SHARED_CODE, uses: 0, ...d, secret: crypto.randomBytes(32).toString('hex') }; writeShared(d); }
  return d;
}
function writeShared(d){ fs.writeFileSync(SHARED_FILE + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(SHARED_FILE + '.tmp', SHARED_FILE); }
const sharedToken = d => 'SHARED-' + crypto.createHmac('sha256', d.secret).update('code:' + d.code).digest('hex').slice(0, 30);

// Agent links: a named link per estate agent (or anyone the owner chooses), /?access=AGT-…, that lets them
// use the app without paying or typing a code, for as many reports as they like, until the owner removes it.
// Made and removed on /admin; kept in REPORTS_DIR/agent-links.json with how often each has been used.
const AGENTS_FILE = path.join(REPORTS_DIR, 'agent-links.json');
const AGENT_RE = /^AGT-[\w-]{24}$/;
function readAgents(){ try { return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')); } catch (e) { return []; } }
function writeAgents(list){ fs.writeFileSync(AGENTS_FILE + '.tmp', JSON.stringify(list, null, 1)); fs.renameSync(AGENTS_FILE + '.tmp', AGENTS_FILE); }
const agentFor = token => AGENT_RE.test(String(token)) ? readAgents().find(a => a.token === token) || null : null;

// A typed code in any case or spacing, with or without "DIY" ("diy 7k4m q2px", "7K4MQ2PX") → its
// stored form, or '' if it isn't one. (Codes made before were FREE-XXXX-XXXX; they still work.)
function canonicalCode(raw){
  const t = normCode(raw), shared = readShared();
  if (t && t === shared.code) return sharedToken(shared);
  const m = /^(DIY|FREE)?([A-Z0-9]{4})([A-Z0-9]{4})$/.exec(t);
  if (!m) return '';
  const codes = readCodes();
  return [(m[1] || 'DIY') + '-' + m[2] + '-' + m[3]].concat(m[1] ? [] : ['FREE-' + m[2] + '-' + m[3]]).find(k => codes.some(c => c.code === k)) || '';
}
function codeAccess(code){
  if (/^AGT-/.test(code)) return agentFor(code) ? { valid: true, reason: '' } : { valid: false, reason: 'removed' };
  if (/^SHARED-/.test(code)) return code === sharedToken(readShared()) ? { valid: true, reason: '' } : { valid: false, reason: 'changed' };
  const c = readCodes().find(c => c.code === code);
  if (!c) return null;
  return c.usedAt ? { valid: false, reason: 'used' } : { valid: true, reason: '' };
}
// What people did with an access code, newest last: each time someone gets in with it ('in') and each
// report made with it ('report'), with the device. Shown on /admin, where entries since the owner's
// last visit are marked New. Kept in REPORTS_DIR/access-log.json (the last 300).
const LOG_FILE = path.join(REPORTS_DIR, 'access-log.json');
function readLog(){ try { const d = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); return { seenAt: d.seenAt || '', entries: d.entries || [] }; } catch (e) { return { seenAt: '', entries: [] }; } }
function writeLog(d){ fs.writeFileSync(LOG_FILE + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(LOG_FILE + '.tmp', LOG_FILE); }
function deviceName(ua){
  ua = String(ua || '');
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /EdgA?\/|EdgiOS/.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return br ? dev + ' · ' + br : dev;
}
function logCode(req, kind, code, address){
  try {
    const d = readLog();
    d.entries.push({ at: new Date().toISOString(), kind, code: /^SHARED-/.test(code) ? readShared().code : /^AGT-/.test(code) ? 'agent link: ' + ((agentFor(code) || {}).name || 'removed') : code, device: deviceName(req.headers['user-agent']), ...(address ? { address: clip(address, 200) } : {}) });
    if (d.entries.length > 300) d.entries = d.entries.slice(-300);
    writeLog(d);
  } catch (e) { console.error('access log failed:', e.message); }
}
// Someone has just got in with an access code (called by server.js when the code is accepted).
function codeLogin(req, code){ logCode(req, 'in', code); console.log('access code login: ' + deviceName(req.headers['user-agent'])); }

function useCode(code, address, req){
  if (req) logCode(req, 'report', code, address);
  if (/^SHARED-/.test(code)) {
    const d = readShared(); d.uses = (d.uses || 0) + 1; d.lastUsedAt = new Date().toISOString(); d.lastUsedFor = clip(address, 200);
    writeShared(d); console.log('access code used: ' + d.code); return;
  }
  if (/^AGT-/.test(code)) {
    const list = readAgents(), a = list.find(a => a.token === code); if (!a) return;
    a.uses = (a.uses || 0) + 1; a.lastUsedAt = new Date().toISOString(); a.lastUsedFor = clip(address, 200);
    writeAgents(list); console.log('agent link used: ' + a.name); return;
  }
  const list = readCodes(), c = list.find(c => c.code === code);
  if (!c || c.usedAt) return;
  c.usedAt = new Date().toISOString(); c.usedFor = clip(address, 200);
  writeCodes(list);
  console.log('access code used: ' + code);
}

// Small fixed-window counters, per IP.
function limiter(max, windowMs){
  const hits = new Map();
  return ip => {
    const now = Date.now(), h = hits.get(ip);
    if (!h || now - h.start > windowMs){ hits.set(ip, { start: now, n: 1 }); if (hits.size > 5000) hits.clear(); return true; }
    h.n++;
    return h.n <= max;
  };
}
const uploadAllowed = limiter(20, 60 * 60 * 1000);
const loginFailures = limiter(10, 15 * 60 * 1000);

// A report's details, or null. The folder also holds settings and logs (access-code.json, agent-links.json, …):
// only a file whose own id matches its name is a report, so those are never listed, opened or deleted as one.
function readMeta(id){
  try { const m = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, id + '.json'), 'utf8')); return m && !Array.isArray(m) && m.id === id ? m : null; } catch (e) { return null; }
}
function listReports(){
  return fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).map(f => readMeta(f.slice(0, -5))).filter(Boolean)
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
// A copy of a finished, paid report for the person who did it (the email typed on the phone, and the buyer's email
// from /buy) and for the agent whose tenant link was used (that link's email, set on /admin). Each address gets it
// once (r.copies), never before it's paid for, and never without Resend. Failures are logged and tried again on the next send.
let knownTargets = () => [];
async function deliverCopies(r, token){
  if (!RESEND_API_KEY || !r || (r.unpaid && !r.paidAt)) return;
  const agent = agentFor(token);
  if (agent && !r.agentId) { r.agentId = agent.id; r.agentName = agent.name; }
  let buyer = ''; try { buyer = require('./purchases').emailFor(token); } catch (e) {}
  const wanted = [];
  [r.copyEmail, buyer].forEach(e => { e = String(e || '').trim().toLowerCase(); if (EMAIL_RE.test(e) && !wanted.some(w => w.to === e)) wanted.push({ to: e, kind: 'self' }); });
  const ae = String((agent && agent.email) || '').trim().toLowerCase();
  if (EMAIL_RE.test(ae)) { const w = wanted.find(w => w.to === ae); if (w) w.kind = 'agent'; else wanted.push({ to: ae, kind: 'agent' }); }
  // Also whoever did it or paid for it when the report wasn't linked to them (made from the backup, a code, …).
  try { knownTargets(r).forEach(k => { if (/did the report|paid for it/.test(k.who) && !wanted.some(w => w.to === k.e)) wanted.push({ to: k.e, kind: 'self' }); }); } catch (e) {}
  r.copies = r.copies || {};
  for (const w of wanted) {
    if (r.copies[w.to]) continue;
    const ok = await emailCopy(r, w.to, w.kind);
    if (ok) r.copies[w.to] = new Date().toISOString();
  }
  try { fs.writeFileSync(path.join(REPORTS_DIR, r.id + '.json'), JSON.stringify(r, null, 2)); } catch (e) {}
}
async function emailCopy(r, to, kind){
  const attach = r.size <= MAX_ATTACH;
  const type = r.inspectionType || 'Check-in', when = r.finalizedAt ? new Date(r.finalizedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }) : '';
  const link = PUBLIC_URL && r.photoKey ? PUBLIC_URL + '/report/' + r.photoKey : '';   // view and download online
  const sign = PUBLIC_URL && r.photoKey ? PUBLIC_URL + '/sign/' + r.photoKey : '';
  const text = (kind === 'agent' ? [
    'A tenant has finished a ' + type.toLowerCase() + ' report using your DIY Inventory link.', '',
    'Property: ' + (r.address || '—'), 'Completed by: ' + (r.signedBy || r.inspectorName || '—'), when ? 'Finished: ' + when : '', r.rooms ? 'Contents: ' + r.rooms + ' rooms, ' + r.photos + ' photos' : '', '',
    attach ? 'The report is attached as a PDF.' : 'The report is too large to attach.', link ? 'View and download it online: ' + link : '',
    sign ? 'To have it checked and signed, send this link: ' + sign : ''
  ] : [
    'Here is your ' + type.toLowerCase() + ' report for ' + (r.address || 'the property') + '.', '',
    when ? 'Finished: ' + when : '', r.rooms ? 'Contents: ' + r.rooms + ' rooms, ' + r.photos + ' photos' : '', '',
    attach ? 'The report is attached as a PDF. Keep this email: it is your copy.' : 'The report is too large to attach.', link ? 'View and download it online at any time: ' + link : '',
    sign ? 'To have it checked and signed by the other party (tenant or landlord), send them this link: ' + sign : '', '',
    'DIY Inventory'
  ]).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  try {
    const res = await fetch((process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', {   // the base can point at a mock, for tests only
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: REPORT_FROM_EMAIL, to: [to], subject: (kind === 'agent' ? type + ' report: ' : 'Your ' + type.toLowerCase() + ' report: ') + (r.address || 'property'), text,
        attachments: attach ? [{ filename: r.fileName || (r.id + '.pdf'), content: fs.readFileSync(path.join(REPORTS_DIR, r.id + '.pdf')).toString('base64') }] : undefined })
    });
    if (!res.ok) { console.error('report copy email failed (' + kind + '): HTTP ' + res.status, (await res.text().catch(() => '')).slice(0, 300)); return false; }
    console.log('report copy emailed (' + kind + '): ' + r.id);
    return true;
  } catch (err) { console.error('report copy email failed (' + kind + '):', err.message); return false; }
}

async function emailReport(r){
  if (!RESEND_API_KEY || !REPORT_TO_EMAIL) return { ok: false, reason: 'not-configured' };
  const pdfPath = path.join(REPORTS_DIR, r.id + '.pdf');
  const attach = r.size <= MAX_ATTACH;
  const link = PUBLIC_URL ? PUBLIC_URL + '/admin/reports/' + r.id + '.pdf' : '';
  const text = [
    'A new ' + (r.inspectionType || 'check-in') + ' report has been sent.', '',
    'Property: ' + (r.address || '—'),
    'Reference: ' + (r.ref || '—'),
    'Completed by: ' + (r.signedBy || r.inspectorName || '—'),
    'Finished: ' + (r.finalizedAt ? new Date(r.finalizedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }) : '—'),
    'Contents: ' + r.rooms + ' rooms, ' + r.photos + ' photos', '',
    attach ? 'The report is attached as a PDF.' : 'The report is too large to attach (' + (r.size / 1048576).toFixed(0) + ' MB).',
    link ? (attach ? 'It is also on your reports page: ' : 'Open it here: ') + link : '',
    PUBLIC_URL ? 'All reports: ' + PUBLIC_URL + '/admin' : ''
  ].filter(l => l !== null).join('\n').trim();
  try {
    const res = await fetch((process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: REPORT_FROM_EMAIL, to: [REPORT_TO_EMAIL],
        subject: (r.inspectionType || 'Check-in') + ' report: ' + (r.address || 'property') + (r.ref ? ' [' + r.ref + ']' : ''),
        text,
        attachments: attach ? [{ filename: r.fileName || (r.id + '.pdf'), content: fs.readFileSync(pdfPath).toString('base64') }] : undefined
      })
    });
    if (!res.ok){ console.error('report email failed: HTTP ' + res.status, (await res.text().catch(() => '')).slice(0, 300)); return { ok: false, reason: 'send-failed' }; }
    return { ok: true };
  } catch (err) {
    console.error('report email failed:', err.message);
    return { ok: false, reason: 'send-failed' };
  }
}

// Never delays or breaks sending the report. Carries the address and who sent it, nothing more.
function notifyPhone(r){
  if (!NTFY_TOPIC) return Promise.resolve(false);
  const body = {
    topic: NTFY_TOPIC,
    title: 'New ' + (r.inspectionType || 'check-in') + ' report',
    message: [r.address || 'No address given', 'From ' + (r.signedBy || r.inspectorName || 'the tenant') + (r.rooms ? ' · ' + r.rooms + ' rooms, ' + r.photos + ' photos' : ''), r.ref ? 'Ref ' + r.ref : ''].filter(Boolean).join('\n'),
    priority: 4,
    tags: ['house']
  };
  if (PUBLIC_URL){
    body.click = PUBLIC_URL + '/admin/reports/' + r.id + '.pdf';
    body.actions = [{ action: 'view', label: 'Open report', url: body.click }, { action: 'view', label: 'All reports', url: PUBLIC_URL + '/admin' }];
  }
  return fetch(NTFY_SERVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
    .then(res => { if (!res.ok) console.error('phone alert failed: HTTP ' + res.status); return res.ok; })
    .catch(err => { console.error('phone alert failed:', err.message); return false; });
}

// Messages from the website's contact form (/contact): kept in REPORTS_DIR/messages.json (the last 500),
// shown on /admin with the ones since the owner's last visit marked New, and a phone alert via ntfy.
const MSG_FILE = path.join(REPORTS_DIR, 'messages.json');
const messageLimit = limiter(5, 60 * 60 * 1000);
function readMessages(){ try { const d = JSON.parse(fs.readFileSync(MSG_FILE, 'utf8')); return { seenAt: d.seenAt || '', list: d.list || [] }; } catch (e) { return { seenAt: '', list: [] }; } }
function writeMessages(d){ fs.writeFileSync(MSG_FILE + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(MSG_FILE + '.tmp', MSG_FILE); }
function saveMessage(req, b){
  if (clip(b.website, 200)) return { ok: true };   // the hidden field only robots fill in
  const m = { name: clip(b.name, 80), email: clip(b.email, 120), phone: clip(b.phone, 30), topic: clip(b.topic, 60), message: String(b.message == null ? '' : b.message).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 3000) };
  if (!m.name || !m.message) return { ok: false, error: 'Please fill in your name and a message.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) return { ok: false, error: 'Please enter a valid email address so we can reply.' };
  if (!messageLimit(clientIp(req))) return { ok: false, status: 429, error: 'Too many messages from here. Please try again in an hour.' };
  const d = readMessages();
  Object.assign(m, { id: Date.now().toString(36) + crypto.randomBytes(4).toString('hex'), at: new Date().toISOString(), device: deviceName(req.headers['user-agent']) });
  m.origin = Origin.of(req, b);
  try { require('./analytics').lead(req, 'message', m.origin); } catch (e) {}
  d.list.push(m); if (d.list.length > 500) d.list = d.list.slice(-500);
  writeMessages(d);
  console.log('message received from ' + m.email);
  if (NTFY_TOPIC) {
    const body = { topic: NTFY_TOPIC, title: 'New message from ' + m.name, message: (m.topic ? m.topic + '\n' : '') + m.message.slice(0, 300), priority: 4, tags: ['envelope'] };
    if (PUBLIC_URL) { body.click = PUBLIC_URL + '/admin#messages'; body.actions = [{ action: 'view', label: 'Open messages', url: body.click }]; }
    fetch(NTFY_SERVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) console.error('message alert failed: HTTP ' + r.status); }).catch(e => console.error('message alert failed:', e.message));
  }
  return { ok: true };
}

// A phone alert to the owner (ntfy), for anything other than a new report.
function notifyOwner({ title, message, tags, click }){
  if (!NTFY_TOPIC) return;
  const body = { topic: NTFY_TOPIC, title: clip(title, 120), message: String(message || '').slice(0, 1000), priority: 4, tags: tags || [] };
  if (click){ body.click = click; body.actions = [{ action: 'view', label: 'Open', url: click }]; }
  fetch(NTFY_SERVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
    .then(r => { if (!r.ok) console.error('phone alert failed: HTTP ' + r.status); }).catch(e => console.error('phone alert failed:', e.message));
}

// Owner session: signed cookie diy_admin, good for a year on that device (until Sign out, or
// ADMIN_PASSWORD changes). Path=/ so the owner also gets into the app itself past the paywall.
const SESSION_DAYS = 365;
const signingKey = crypto.createHash('sha256').update('diy-admin-session:' + ADMIN_PASSWORD).digest();
const sign = exp => crypto.createHmac('sha256', signingKey).update('admin:' + exp).digest('hex');
const makeToken = () => { const exp = Date.now() + SESSION_DAYS * 86400000; return exp + '.' + sign(exp); };
function signedIn(req){
  if (!ADMIN_PASSWORD) return false;
  const all = String(req.headers.cookie || '').match(/(?:^|;\s*)diy_admin=[^;]+/g) || [];
  return all.some(c => {
    const [exp, mac] = decodeURIComponent(c.split('=').slice(1).join('=')).split('.');
    if (!exp || !mac || !(Number(exp) > Date.now())) return false;
    const a = Buffer.from(mac), b = Buffer.from(sign(exp));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// Sections other modules add to the /admin page (e.g. landlord accounts, landlords.js).
const adminSections = [];
function addAdminSection(fn){ adminSections.push(fn); }

function mount(app){
  /* ---------- tenant side: send a copy of the finished report ---------- */
  // Saves one report PDF with its details. Returns [httpStatus, jsonBody].
  // opts.unpaid: a finished report sent before it was paid for, so the owner has it anyway. It is stored once and
  // upgraded in place when the paid copy arrives (that upload answers 201, so the paid link is marked used then).
  function storeReport(pdf, m, source, opts){
    opts = opts || {};
    if (!Buffer.isBuffer(pdf) || pdf.length < 1000 || pdf.slice(0, 5).toString() !== '%PDF-') return [400, { error: 'Expected the report PDF.' }];
    const meta = {
      address: clip(m.address, 200), inspectionType: clip(m.inspectionType, 40), ref: clip(m.ref, 40),
      inspectorName: clip(m.inspectorName, 120), signedBy: clip(m.signedBy, 120), createdAt: clip(m.createdAt, 40),
      finalizedAt: clip(m.finalizedAt, 40), rooms: Math.max(0, Math.min(99, parseInt(m.rooms, 10) || 0)),
      photos: Math.max(0, Math.min(9999, parseInt(m.photos, 10) || 0)), fileName: clip(m.fileName, 200).replace(/[\\/"]/g, '-'),
      photoKey: KEY_RE.test(String(m.photoKey || '')) ? String(m.photoKey) : '',
      basedOnRef: clip(m.basedOnRef, 40),
      copyEmail: EMAIL_RE.test(String(m.copyEmail || '').trim()) ? clip(String(m.copyEmail).trim().toLowerCase(), 120) : '',
      origin: m.origin && typeof m.origin === 'object' && !Array.isArray(m.origin) ? m.origin : undefined,
      tokenHash: /^[a-f0-9]{20}$/.test(String(m.tokenHash || '')) ? m.tokenHash : undefined,
      paidWith: clip(m.paidWith, 200) || undefined,
      source
    };
    // The same report is only ever stored once: by reference + finish time from the app, by file contents when uploaded.
    const basis = meta.finalizedAt ? meta.ref + '|' + meta.finalizedAt : 'file|' + crypto.createHash('sha256').update(pdf).digest('hex');
    const key = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 12);
    const existing = listReports().find(r => r.key === key);
    // An edited copy of a finished report (photos added or removed, or its type changed on the phone): it replaces the
    // stored one in place, so its id, link, payment and copies stay the same. Only from the phone that made it (its photo key).
    if (existing && m.editedAt && clip(m.editedAt, 40) !== String(existing.editedAt || '') && !((meta.photoKey && existing.photoKey === meta.photoKey) || (opts && opts.owner)))
      console.log('report edit not applied (photo key differs): ' + existing.id);
    if (existing && m.editedAt && ((meta.photoKey && existing.photoKey === meta.photoKey) || (opts && opts.owner)) && clip(m.editedAt, 40) !== String(existing.editedAt || '')) {
      try { fs.writeFileSync(path.join(REPORTS_DIR, existing.id + '.pdf'), pdf); } catch (err) { return [500, { error: 'The report could not be saved.' }]; }
      const was = existing.inspectionType;
      ['address', 'inspectionType', 'inspectorName', 'signedBy', 'rooms', 'photos', 'fileName', 'basedOnRef'].forEach(k => { if (meta[k] !== '' && meta[k] !== undefined) existing[k] = meta[k]; });
      if (meta.copyEmail && !existing.copyEmail) existing.copyEmail = meta.copyEmail;
      Object.assign(existing, { size: pdf.length, source: 'app', editedAt: clip(m.editedAt, 40), edits: (existing.edits || 0) + 1 });
      if (existing.tenantSignedAt) existing.editedAfterSigning = true;   // the signed copy stays as the version they signed
      let status = 200;
      if (existing.unpaid && !opts.unpaid) { existing.unpaid = false; existing.paidAt = new Date().toISOString(); status = 201; }
      fs.writeFileSync(path.join(REPORTS_DIR, existing.id + '.json'), JSON.stringify(existing, null, 2));
      console.log('report edited on the phone: ' + existing.id + (was !== existing.inspectionType ? ' (' + was + ' → ' + existing.inspectionType + ')' : ''));
      notifyOwner({ title: 'Report edited: ' + (existing.address || 'a report'), message: [existing.inspectionType + (was !== existing.inspectionType ? ' (was ' + was + ')' : ''), existing.rooms + ' rooms, ' + existing.photos + ' photos', existing.ref ? 'Ref ' + existing.ref : ''].filter(Boolean).join(' · '), tags: ['pencil2'], click: PUBLIC_URL ? PUBLIC_URL + '/admin#reports' : '' });
      return [status, { id: existing.id, replaced: true }];
    }
    if (existing) {
      if (meta.copyEmail && !existing.copyEmail) existing.copyEmail = meta.copyEmail;
      if (meta.origin && !existing.origin) existing.origin = meta.origin;
      if (meta.tokenHash && !existing.tokenHash) existing.tokenHash = meta.tokenHash;
      if (meta.paidWith && !existing.paidWith) existing.paidWith = meta.paidWith;   // given on the phone after an earlier copy arrived
      // The server made this one from the backup; the phone's own PDF, when it does arrive, takes its place.
      if (existing.source === 'backup' && source === 'app') {
        try { fs.writeFileSync(path.join(REPORTS_DIR, existing.id + '.pdf'), pdf); } catch (err) { return [500, { error: 'The report could not be saved.' }]; }
        existing.size = pdf.length; existing.source = 'app'; existing.replacedBackupAt = new Date().toISOString();
        Object.assign(existing, meta, { source: 'app' });
        if (existing.unpaid && !opts.unpaid) { existing.unpaid = false; existing.paidAt = new Date().toISOString(); }
        fs.writeFileSync(path.join(REPORTS_DIR, existing.id + '.json'), JSON.stringify(existing, null, 2));
        console.log('report replaced by the phone\'s own PDF: ' + existing.id);
        return [opts.unpaid || !existing.paidAt ? 200 : 201, { id: existing.id }];
      }
      if (existing.unpaid && !opts.unpaid) {
        existing.unpaid = false; existing.paidAt = new Date().toISOString();
        try { fs.writeFileSync(path.join(REPORTS_DIR, existing.id + '.json'), JSON.stringify(existing, null, 2)); } catch (err) { return [500, { error: 'The report could not be saved.' }]; }
        console.log('report paid for: ' + existing.id);
        return [201, { id: existing.id }];
      }
      if (meta.copyEmail && existing.copyEmail === meta.copyEmail) { try { fs.writeFileSync(path.join(REPORTS_DIR, existing.id + '.json'), JSON.stringify(existing, null, 2)); } catch (e) {} }
      return [200, { id: existing.id, duplicate: true }];
    }

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const id = `${stamp}-${key}`;
    const record = Object.assign({ id, key, size: pdf.length, receivedAt: new Date().toISOString() }, meta, opts.unpaid ? { unpaid: true } : {});
    try {
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.pdf'), pdf);
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(record, null, 2));
    } catch (err) {
      console.error('report save failed', err);
      return [500, { error: 'The report could not be saved.' }];
    }
    console.log(`report stored (${source}${opts.unpaid ? ', not paid yet' : ''}): ${id} (${meta.ref}, ${meta.address}, ${Math.round(pdf.length / 1024)} KB)`);
    return [201, { id }];
  }
  function metaHeader(req){
    try { return JSON.parse(decodeURIComponent(String(req.headers['x-report-meta'] || '%7B%7D'))) || {}; } catch (e) { return {}; }
  }

  /* ---------- tenant side: send a copy of the finished report ---------- */
  // The app reports a finished report it couldn't send (PDF build or upload failed), so it shows in the logs.
  const problemAllowed = limiter(30, 60 * 60 * 1000);
  app.post('/api/report-problem', express.text({ type: '*/*', limit: '4kb' }), (req, res) => {
    if (!problemAllowed(clientIp(req))) return res.status(204).end();
    let d = {}; try { d = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (e) {}
    console.error('report not sent from a phone: ' + [clip(d.stage, 20), 'ref ' + clip(d.ref, 40), 'backup ' + clip(d.key, 32), clip(d.msg, 300), d.online === false ? 'offline' : '', clip(d.ua, 160)].filter(Boolean).join(' | '));
    res.status(204).end();
  });
  // A big PDF arrives in pieces first (PUT /api/report-chunks/<upload>/<n>, 2 MB each from the app; GET lists the
  // pieces already here, so a broken upload carries on), then POST /api/reports names the upload (X-Report-Upload,
  // -Chunks, -Size) instead of carrying the file. Pieces are kept in REPORTS_DIR/chunks/<upload>/ and removed once
  // the report is stored, or after a day.
  const CHUNK_DIR = path.join(REPORTS_DIR, 'chunks'), UP_RE = /^[a-f0-9]{32}$/, CHUNK_MAX = 4 * 1024 * 1024, CHUNKS_MAX_BYTES = 1536 * 1024 * 1024;
  const chunkAllowed = limiter(3000, 60 * 60 * 1000);
  const chunkFiles = up => { try { return fs.readdirSync(path.join(CHUNK_DIR, up)).filter(f => /^\d+$/.test(f)).map(Number); } catch (e) { return []; } };
  function chunksSize(){
    let t = 0;
    try { for (const d of fs.readdirSync(CHUNK_DIR)) for (const f of fs.readdirSync(path.join(CHUNK_DIR, d))) t += fs.statSync(path.join(CHUNK_DIR, d, f)).size; } catch (e) {}
    return t;
  }
  function sweepChunks(){
    try { for (const d of fs.readdirSync(CHUNK_DIR)) { const p = path.join(CHUNK_DIR, d); if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true }); } } catch (e) {}
  }
  sweepChunks(); setInterval(sweepChunks, 60 * 60 * 1000).unref();
  app.get('/api/report-chunks/:up', (req, res) => {
    const up = String(req.params.up);
    if (!UP_RE.test(up)) return res.status(404).json({ error: 'Unknown upload.' });
    res.set('Cache-Control', 'no-store').json({ have: chunkFiles(up) });
  });
  app.put('/api/report-chunks/:up/:n', express.raw({ type: '*/*', limit: CHUNK_MAX }), (req, res) => {
    if (!chunkAllowed(clientIp(req))) return res.status(429).json({ error: 'Too many uploads from here. Try again later.' });
    const up = String(req.params.up), n = parseInt(req.params.n, 10);
    if (!UP_RE.test(up) || !(n >= 0 && n < Math.ceil(MAX_PDF / (1024 * 1024))) || String(n) !== req.params.n) return res.status(400).json({ error: 'Bad upload.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty upload.' });
    if (chunksSize() > CHUNKS_MAX_BYTES) { console.error('report chunks folder full'); return res.status(503).json({ error: 'Busy right now. Try again later.' }); }
    try {
      const dir = path.join(CHUNK_DIR, up); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, n + '.tmp'), req.body); fs.renameSync(path.join(dir, n + '.tmp'), path.join(dir, String(n)));
    } catch (e) { console.error('report chunk save failed', e.message); return res.status(500).json({ error: 'Could not save that part.' }); }
    res.json({ ok: true });
  });
  // The pieces put back together: [buffer] or [status, body] when something is missing.
  function assembled(req){
    const up = String(req.headers['x-report-upload'] || ''), count = parseInt(req.headers['x-report-chunks'], 10), size = parseInt(req.headers['x-report-size'], 10);
    if (!UP_RE.test(up) || !(count > 0 && count <= 200) || !(size > 0 && size <= MAX_PDF)) return [400, { error: 'Bad upload.' }];
    const have = new Set(chunkFiles(up)), missing = [];
    for (let i = 0; i < count; i++) if (!have.has(i)) missing.push(i);
    if (missing.length) return [409, { error: 'Part of the report hasn’t arrived yet. It will be sent again.', missing }];
    const buf = Buffer.concat(Array.from({ length: count }, (_, i) => fs.readFileSync(path.join(CHUNK_DIR, up, String(i)))));
    if (buf.length !== size) { fs.rmSync(path.join(CHUNK_DIR, up), { recursive: true, force: true }); return [409, { error: 'The report arrived incomplete. It will be sent again.' }]; }
    return [buf, up];
  }
  app.post('/api/reports', express.raw({ type: 'application/pdf', limit: MAX_PDF }), (req, res) => {
    if (!uploadAllowed(clientIp(req))) return res.status(429).json({ error: 'Too many reports sent from here. Try again later.' });
    const unpaid = req.headers['x-report-unpaid'] === '1';
    const meta = metaHeader(req);
    meta.origin = meta.visit && typeof meta.visit === 'object' ? Origin.of(req, {}, { visit: meta.visit }) : undefined;   // never trusted from the phone as is
    meta.tokenHash = tokenHash(accessToken(req));
    meta.paidWith = req.headers['x-report-unpaid'] === '1' ? '' : accessLabel(accessToken(req), signedIn(req));
    delete meta.visit;
    let pdf = req.body, up = '';
    if (req.headers['x-report-upload']) {
      const a = assembled(req);
      if (!Buffer.isBuffer(a[0])) return res.status(a[0]).json(a[1]);
      [pdf, up] = a;
    }
    const [status, body] = storeReport(pdf, meta, 'app', { unpaid, owner: signedIn(req) });
    if (status === 201 && meta.origin) { try { require('./analytics').lead(req, 'report', meta.origin); } catch (e) {} }
    if (up && status < 400) fs.rmSync(path.join(CHUNK_DIR, up), { recursive: true, force: true });
    res.status(unpaid && status === 201 ? 202 : status).json(body);
  });

  // A finished report is sent: the stored report is marked as sent, the owner is alerted, and it is emailed to REPORT_TO_EMAIL if set.
  // Repeats are harmless: a report already emailed is not emailed again.
  const sendAllowed = limiter(20, 60 * 60 * 1000);
  const sending = new Set();
  app.post('/api/reports/:id/send', async (req, res) => {
    const id = String(req.params.id);
    if (!sendAllowed(clientIp(req))) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    if (sending.has(id)) return res.status(409).json({ error: 'Already sending.' });
    sending.add(id);
    try {
      if (!r.sentAt) r.sentAt = new Date().toISOString();
      // One phone alert per report, straight away (even if the email below fails).
      if (NTFY_TOPIC && !r.notifiedAt){
        r.notifiedAt = new Date().toISOString();
        fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2));
        notifyPhone(r);
      }
      let ownerFailed = false;
      if (!r.emailedAt){
        const mail = await emailReport(r);
        if (mail.ok) r.emailedAt = new Date().toISOString();
        else if (mail.reason === 'send-failed') ownerFailed = true;
      }
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2));
      // The person's and the agent's copies go whatever happened to the owner's email.
      await deliverCopies(r, accessToken(req)).catch(e => console.error('report copies failed:', e.message));
      if (ownerFailed) return res.status(502).json({ error: "The email didn't go through." });
      console.log('report sent: ' + id + (r.emailedAt ? ' (emailed to ' + REPORT_TO_EMAIL + ')' : ' (email not set up)'));
      res.json({ ok: true, sentAt: r.sentAt, emailed: !!r.emailedAt });
    } finally { sending.delete(id); }
  });

  /* ---------- who opened each report: REPORTS_DIR/<id>.access.json (the last 500), shown on /admin ---------- */
  const ACCESS_KIND = { page: 'Viewed it online', pdf: 'Opened the PDF', download: 'Downloaded the PDF', sign_page: 'Opened the sign-off page', sign_pdf: 'Opened the PDF from the sign-off page', signed_pdf: 'Opened the signed copy',
    app_download: 'Downloaded it on the phone that made it', app_open: 'Opened it on the phone that made it', app_share: 'Shared or saved it from the phone that made it' };
  const tokenHash = t => t ? crypto.createHash('sha256').update('diy-report|' + t).digest('hex').slice(0, 20) : '';
  function whoOpened(req, r){
    if (r.tokenHash && tokenHash(accessToken(req)) === r.tokenHash) return 'The person who did the report';
    const a = agentFor(accessToken(req)); if (a) return 'Someone with ' + a.name + '’s tenant link';
    if (r.tenantSignedBy && /(^|;\s*)diy_signed=/.test(req.headers.cookie || '')) return r.tenantSignedBy + ' (who signed it)';
    return 'Someone with the link';
  }
  function logAccess(id, req, what, who){
    try {
      if (signedIn(req)) return;   // the owner's own looks aren't logged
      const ua = String(req.headers['user-agent'] || ''); if (/bot|crawl|spider|preview|facebookexternalhit|whatsapp|slackbot|telegram|discord|curl|wget|headless/i.test(ua)) return;
      const r = readMeta(id); if (!r) return;
      const file = path.join(REPORTS_DIR, id + '.access.json');
      let L = []; try { L = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
      const ref = String(req.headers.referer || ''); let from = ''; try { const h = new URL(ref).host.replace(/^www\./, ''); if (h && h !== String(req.headers.host || '').replace(/^www\./, '')) from = h; } catch (e) {}
      let place = {}; try { place = require('./analytics').placeOf(req); } catch (e) {}
      L.push({ at: new Date().toISOString(), what, who: who || whoOpened(req, r), device: deviceName(ua), place: Object.keys(place).length ? place : undefined, from: from || undefined });
      // The first time anyone other than its maker opens the report from its link: tell the owner once.
      const e = L[L.length - 1];
      if (!/^app_/.test(what) && e.who !== 'The person who did the report' && !L.slice(0, -1).some(x => !/^app_/.test(x.what) && x.who !== 'The person who did the report'))
        notifyOwner({ title: 'Report opened: ' + (r.address || 'a report'), message: [ACCESS_KIND[what] || what, e.who, e.device, [place.city, place.region, place.country].filter(Boolean).join(', '), e.from ? 'came from ' + e.from : ''].filter(Boolean).join(' · '), tags: ['eyes'], click: PUBLIC_URL ? PUBLIC_URL + '/admin/reports/' + id + '/opened' : '' });
      fs.writeFileSync(file, JSON.stringify(L.slice(-500)));
    } catch (e) { console.error('access log failed: ' + e.message); }
  }
  const readAccess = id => { try { return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, id + '.access.json'), 'utf8')); } catch (e) { return []; } };
  // The app says when its PDF was downloaded, opened or shared (the key proves it's that report's phone).
  app.post('/api/reports/:id/opened', express.text({ type: '*/*', limit: '2kb' }), (req, res) => {
    let b = {}; try { b = JSON.parse(req.body || '{}'); } catch (e) {}
    const id = String(req.params.id), r = ID_RE.test(id) && readMeta(id);
    if (r && r.photoKey && b.key === r.photoKey && ['download', 'open', 'share'].includes(b.kind)) logAccess(id, req, 'app_' + b.kind, 'The person who did the report');
    res.status(204).end();
  });

  /* ---------- the report online: /report/<key>, to view and download (paid reports only) ---------- */
  const onlineLink = r => r && r.photoKey ? (PUBLIC_URL || '') + '/report/' + r.photoKey : '';
  function onlineReport(key){
    key = String(key || '').toLowerCase();
    if (!KEY_RE.test(key)) return null;
    const id = findByKey(key), r = id && readMeta(id);
    if (!r || notPaid(r) || !fs.existsSync(path.join(REPORTS_DIR, id + '.pdf'))) return null;
    const signed = path.join(REPORTS_DIR, id + '.signed.pdf');
    return { key, id, r, file: fs.existsSync(signed) ? signed : path.join(REPORTS_DIR, id + '.pdf'), signed: fs.existsSync(signed), canSign: fs.existsSync(path.join(photoDir(id), 'data.json')) };
  }
  app.get('/report/:key.pdf', (req, res) => {
    const o = onlineReport(req.params.key);
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store' });
    if (!o) return res.status(404).type('text/plain').send('Report not found.');
    if (!/bytes=(?!0-)/.test(String(req.headers.range || ''))) logAccess(o.id, req, req.query.download ? 'download' : 'pdf');   // not each piece a PDF viewer fetches
    const name = String(o.r.fileName || 'report.pdf').replace(/\.pdf$/i, '').replace(/["\\\r\n]/g, '') + (o.signed ? ' - signed' : '') + '.pdf';
    res.type('application/pdf').set('Content-Disposition', (req.query.download ? 'attachment' : 'inline') + '; filename="' + name + '"');
    fs.createReadStream(o.file).pipe(res);
  });
  app.get('/report/:key', (req, res) => {
    const o = onlineReport(req.params.key);
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store' });
    const shell = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title><link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<style>
  :root{--bg:#F6F1EA;--card:#fff;--ink:#1B2A4A;--muted:#5E6B80;--line:#E6DED2;--accent:#1B2A4A;--good:#1F7A4D}
  @media(prefers-color-scheme:dark){:root{--bg:#0F1A2E;--card:#16233D;--ink:#EEF2F8;--muted:#A9B4C6;--line:#25365A;--accent:#C49A6C;--good:#5FC28E}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  header{padding:14px 18px;display:flex;align-items:center;gap:10px;font-weight:700}header img{border-radius:8px}
  main{max-width:980px;margin:0 auto;padding:0 16px 40px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
  h1{font:600 clamp(24px,4vw,34px)/1.15 Georgia,'Times New Roman',serif;margin:2px 0 6px}
  .k{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  .facts{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--muted);font-size:14px;margin:8px 0 16px}
  .btns{display:flex;flex-wrap:wrap;gap:10px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 20px;border-radius:999px;font-weight:650;text-decoration:none;border:1px solid var(--line);color:var(--ink);background:var(--card);cursor:pointer;font-size:15px}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .ok{color:var(--good);font-weight:600;font-size:14px;margin-top:12px}
  .viewer{margin-top:16px;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:#525659;height:80vh}
  .viewer iframe{width:100%;height:100%;border:0;display:block}
  .note{font-size:13px;color:var(--muted);margin-top:14px}
  @media(max-width:700px){.viewer{display:none}.btn{flex:1 1 100%}}
</style></head><body><header><img src="/icons/icon-192.png" alt="" width="30" height="30">DIY Inventory</header><main>${body}</main></body></html>`;
    if (!o) return res.status(404).type('html').send(shell('Report not found', '<div class="card"><h1>Report not found</h1><p>Check the link you were sent. If it still doesn’t work, ask whoever sent it for a new one.</p></div>'));
    logAccess(o.id, req, 'page');
    const r = o.r, pdf = '/report/' + o.key + '.pdf';
    const when = r.finalizedAt ? new Date(r.finalizedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const type = /check-?out/i.test(r.inspectionType || '') ? 'Check-Out' : /inspection/i.test(r.inspectionType || '') ? 'Inspection' : 'Check-In';
    res.type('html').send(shell(type + ' – ' + (r.address || 'report'), `<div class="card">
  <div class="k">${esc(type)} report</div>
  <h1>${esc(r.address || 'Property report')}</h1>
  <div class="facts">${when ? `<span>Finished ${esc(when)}</span>` : ''}${r.signedBy || r.inspectorName ? `<span>By ${esc(r.signedBy || r.inspectorName)}</span>` : ''}${r.rooms ? `<span>${r.rooms} rooms · ${r.photos} photos</span>` : ''}${r.ref ? `<span>Ref ${esc(r.ref)}</span>` : ''}</div>
  <div class="btns"><a class="btn primary" href="${pdf}?download=1">Download PDF</a><a class="btn" href="${pdf}" target="_blank" rel="noopener">Open full screen</a>${o.canSign && !r.tenantSignedAt ? `<a class="btn" href="/sign/${o.key}">Check and sign it</a>` : ''}<button class="btn" type="button" id="share">Share this link</button></div>
  ${r.tenantSignedAt ? `<div class="ok">✓ Signed by ${esc(r.tenantSignedBy || 'the tenant')}${r.tenantAgree === 'comments' ? ', with comments' : ''}: this is the signed copy.</div>` : ''}
  <div class="viewer"><iframe src="${pdf}#view=FitH" title="The report"></iframe></div>
  <p class="note">Anyone with this link can view and download the report. Photos in the PDF open full size when tapped.</p>
</div>
<script>document.getElementById('share').onclick=async function(){var u=location.href;try{if(navigator.share){await navigator.share({title:document.title,url:u});return;}await navigator.clipboard.writeText(u);this.textContent='Link copied';}catch(e){}};</script>`));
  });

  // One-off, for the owner: LOG_ONLINE_LINK=<ref>[,<ref>…] (a Railway variable) makes sure those paid reports have an
  // online link and writes it to the logs at start-up. Remove the variable afterwards.
  const wantLinks = String(process.env.LOG_ONLINE_LINK || '').split(',').map(x => x.trim()).filter(Boolean);
  if (wantLinks.length) setTimeout(() => {
    for (const ref of wantLinks) {
      const found = listReports().filter(r => r.ref === ref);
      if (!found.length) { console.log('online link for ' + ref + ': no report with that reference'); continue; }
      for (const r of found) {
        if (notPaid(r)) { console.log('online link for ' + ref + ': not paid for, so no link (' + r.id + ')'); continue; }
        if (!r.photoKey) { r.photoKey = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(path.join(REPORTS_DIR, r.id + '.json'), JSON.stringify(r, null, 2)); }
        console.log('online link for ' + ref + ' (' + (r.address || '') + '): ' + (PUBLIC_URL || '') + '/report/' + r.photoKey);
      }
    }
  }, 3000).unref();

  /* ---------- full-size photos: the PDF shows smaller pictures that link here ---------- */
  // Uploaded after the report, a few at a time, with the report's photo key. A report sent before photo
  // links existed takes the key the first time its photos arrive.
  const photoUploads = limiter(600, 60 * 60 * 1000);
  const keyToId = new Map();
  // A report sent before it was paid for (stored so the owner has it): nothing of it is served by its key until it's paid.
  const notPaid = r => !!(r && r.unpaid && !r.paidAt);
  function findByKey(key){
    const hit = keyToId.get(key);
    if (hit && readMeta(hit)) return hit;
    const r = listReports().find(x => x.photoKey === key);
    if (r) keyToId.set(key, r.id);
    return r ? r.id : null;
  }
  // Online backups of reports while they're being done (drafts.js), listed on /admin.
  // A report finished on a phone whose PDF never arrived is made from its backup (drafts.js) and filed here.
  const accessToken = req => { const m = /(?:^|;\s*)diy_access=([\w-]{12,40})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; };
  const hasAccess = req => { if (signedIn(req)) return true; const t = accessToken(req); if (!t) return false; const c = codeAccess(t); if (c) return !!c.valid; try { const p = require('./purchases').access(t); return !!(p && p.valid); } catch (e) { return false; } };
  const backupKey = s => crypto.createHash('sha256').update(clip((s.meta || {}).ref, 40) + '|' + clip(s.finalizedAt, 40)).digest('hex').slice(0, 12);
  // The online backup of a stored report: the server made it from that backup, the phone that sent it backed it up
  // (its id, photo key, or reference + finish time, also while it is being edited: `editOf` holds the finish time then).
  const isBackupOf = (s, r) => !!(s && r) && (s._serverReportId === r.id || s.submittedId === r.id || s.unpaidId === r.id ||
    (r.photoKey && s.photoKey === r.photoKey) ||
    ((s.finalizedAt || s.editOf) && backupKey(Object.assign({}, s, { finalizedAt: s.finalizedAt || s.editOf })) === r.key));
  // The full-size photos of a report made from the backup, served at /p/<photoKey>/<n> like the phone's own.
  function attachBackupPhotos(id, key, photos, photoFile){
    try {
      const r = readMeta(id); if (!r) return;
      if (KEY_RE.test(String(key || '')) && r.photoKey !== key) { r.photoKey = key; fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2)); keyToId.set(key, id); }
      const dir = photoDir(id); fs.mkdirSync(dir, { recursive: true });
      let index = {}; try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch (e) {}
      for (const ph of photos || []) { const f = photoFile(ph.id); if (f && fs.existsSync(f)) { fs.copyFileSync(f, path.join(dir, ph.n + '.jpg')); index[ph.n] = { title: clip(ph.title, 200), ts: clip(ph.ts, 40) }; } }
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    } catch (e) { console.error('backup photos not attached: ' + e.message); }
  }
  // How a report was paid for or unlocked, in words for /admin.
  function accessLabel(token, byOwner){
    if (byOwner) return 'You (signed in to admin) · no charge';
    if (!token) return '';
    try { const d = require('./purchases').describe(token); if (d) return d; } catch (e) {}
    const a = agentFor(token); if (a) return 'Tenant link of ' + a.name + ' · no charge to the tenant';
    if (/^AGT-/.test(token)) return 'A tenant link that has since been removed';
    if (/^SHARED-/.test(token)) return 'Your access code (' + readShared().code + ') · no charge';
    if (/^(DIY|FREE)-/.test(token)) return 'One-off access code ' + token + ' · no charge';
    if (/^RPT-/.test(token)) return 'A /buy link that isn’t recorded as paid';
    return 'A paid link from the older system';
  }
  async function fromBackup(pdf, s, info){
    const m = s.meta || {}, pr = s.property || {};
    let photos = 0; (s.rooms || []).forEach(r => { (r.items || []).forEach(i => { photos += (i.photos || []).length; }); photos += (r.extraPhotos || []).length; }); photos += ((pr.exterior || {}).photos || []).length;
    const [status, body] = storeReport(pdf, Object.assign({}, m, { finalizedAt: s.finalizedAt, rooms: (s.rooms || []).length, photos, photoKey: s.photoKey || '', basedOnRef: (s.earlier && s.earlier.ref) || '',
      fileName: [m.address, m.inspectionType, m.date, m.ref].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '-') + '.pdf' }), 'backup', { unpaid: !((info && info.paid) || s._access || reportsAccessFree()) });
    if (status >= 400 || !body.id) throw new Error(body.error || 'store failed');
    // The link or code the phone had pays for this report: mark it used, as storing the phone's own PDF would have.
    if (status === 201 && s._token && !reportsAccessFree()) {
      try {
        if (codeAccess(s._token)) useCode(s._token, m.address);
        else if (require('./purchases').markUsed(s._token, m.address)) console.log('report purchase used (report made from the backup)');
      } catch (e) { console.error('marking the link used failed:', e.message); }
    }
    if (info && info.photos) attachBackupPhotos(body.id, s.photoKey, info.photos, info.photoFile);
    { const rr = readMeta(body.id); const lab = info && info.byOwner ? 'You (marked complete in admin)' : accessLabel(s._token, s._byOwner); if (rr && lab && !rr.paidWith) { rr.paidWith = lab; fs.writeFileSync(path.join(REPORTS_DIR, rr.id + '.json'), JSON.stringify(rr, null, 2)); } }
    const r = readMeta(body.id);
    if (r && !r.sentAt) {
      r.sentAt = new Date().toISOString(); r.fromBackup = true; if (info && info.missing) r.backupMissingPhotos = info.missing;
      if (NTFY_TOPIC && !r.notifiedAt) { r.notifiedAt = r.sentAt; notifyPhone(r); }
      fs.writeFileSync(path.join(REPORTS_DIR, r.id + '.json'), JSON.stringify(r, null, 2));
      try { const mail = await emailReport(r); if (mail.ok) { r.emailedAt = new Date().toISOString(); fs.writeFileSync(path.join(REPORTS_DIR, r.id + '.json'), JSON.stringify(r, null, 2)); } } catch (e) {}
      await deliverCopies(r, s._token || '').catch(e => console.error('report copies failed:', e.message));
    }
    return body.id;
  }
  const reportsAccessFree = () => /^(off|false|0|no)$/i.test(String(process.env.DIY_PAYWALL || ''));
  const drafts = require('./drafts').mount(app, { REPORTS_DIR, esc, clip, clientIp, limiter, deviceName, notify: notifyOwner, requireAdmin, sameOrigin, PUBLIC_URL,
    hasAccess, accessToken, isOwnerReq: req => signedIn(req), accessLabel, fromBackup, alreadyStored: s => listReports().some(r => r.key === backupKey(s)) });

  // A finished report being edited (on the phone, or by the owner from /admin) is kept up to date by itself: about a
  // minute after the last change reaches its online backup (and once its photos are there), the stored report is
  // rebuilt from the backup with the app's own design and replaced in place: same id, link, payment and copies.
  // Finishing the edit on the phone still sends the phone's own PDF, which replaces this one.
  let liveBusy = false;
  async function liveEditSweep(){
    if (liveBusy) return; liveBusy = true;
    try {
      for (const { key, s } of drafts.all()) {
        if (!s.editOf || !s._savedAt || s._liveBuiltAt === s._savedAt) continue;
        const idle = Date.now() - new Date(s._savedAt).getTime();
        if (idle < 45000) continue;
        if (drafts.missingPhotos(key, s) && idle < 10 * 60000) continue;
        const r = listReports().find(x => isBackupOf(s, x));
        if (!r || r.source === 'uploaded') { drafts.saveState(key, { _liveBuiltAt: s._savedAt }); continue; }
        try {
          const s2 = Object.assign({}, s, { finalizedAt: s.editOf, declarationAccepted: true, photoKey: r.photoKey || s.photoKey });
          const { pdf, photos, photoFile } = await drafts.buildFor(key, s2);
          fs.writeFileSync(path.join(REPORTS_DIR, r.id + '.pdf'), pdf);
          // The photo links follow the new numbering: the old full-size copies go, the backup's are put in their place.
          const dir = photoDir(r.id);
          try { fs.readdirSync(dir).forEach(f => { if (/^\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(dir, f)); }); fs.writeFileSync(path.join(dir, 'index.json'), '{}'); } catch (e) {}
          attachBackupPhotos(r.id, s2.photoKey, photos, photoFile);
          const now = readMeta(r.id), m = s.meta || {}, pr = s.property || {};
          let n = 0; (s.rooms || []).forEach(x => { (x.items || []).forEach(i => { n += (i.photos || []).length; }); n += (x.extraPhotos || []).length; }); n += ((pr.exterior || {}).photos || []).length;
          Object.assign(now, { size: pdf.length, rooms: (s.rooms || []).length, photos: n, editedAt: new Date().toISOString(), edits: (now.edits || 0) + (now.liveEditOf === s._createdAt + s.editOf ? 0 : 1), liveEditOf: s._createdAt + s.editOf });
          ['address', 'inspectionType', 'inspectorName', 'signedBy'].forEach(k => { if (m[k]) now[k] = clip(m[k], 300); });
          if (now.tenantSignedAt) now.editedAfterSigning = true;
          fs.writeFileSync(path.join(REPORTS_DIR, r.id + '.json'), JSON.stringify(now, null, 2));
          drafts.saveState(key, { _liveBuiltAt: s._savedAt });
          console.log('report updated from its edit: ' + r.id + ' (' + now.rooms + ' rooms, ' + n + ' photos)');
        } catch (e) { console.error('report edit update failed: ' + r.id + ': ' + e.message); drafts.saveState(key, { _liveBuiltAt: s._savedAt }); }
      }
    } finally { liveBusy = false; }
  }
  setInterval(() => liveEditSweep().catch(() => {}), 30000).unref();

  // Every email we hold for a report (the person who did it first): the admin Email form and the automatic copies.
  // Every email sent about a report, newest first, with when: the copies after payment, links sent from here, and the owner's own copy.
  const whenTxt = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  function sentLog(r){
    const L = [];
    Object.entries(r.copies || {}).forEach(([to, at]) => L.push({ to, at, what: 'copy after payment' }));
    (r.linkEmails || []).forEach(x => L.push({ to: x.to, at: x.at, what: 'link sent from admin' }));
    if (r.emailedAt) L.push({ to: REPORT_TO_EMAIL || 'you', at: r.emailedAt, what: 'your copy' });
    if (!L.length) return '';
    L.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const line = x => '<li><b>' + esc(whenTxt(x.at)) + '</b> ' + esc(x.to) + ' <span class="what">' + esc(x.what) + '</span></li>';
    return ` <details class="sub sentlog"><summary>✉ Emailed ${L.length === 1 ? 'once' : L.length + ' times'} · last ${esc(whenTxt(L[0].at))}</summary><ul>${L.map(line).join('')}</ul></details>`;
  }
  let efCache = null;
  function emailsForReport(r){
      if (!efCache || Date.now() - efCache.at > 30000) {
        const m = new Map(); try { drafts.all().forEach(({ s }) => { if (s._serverReportId) m.set('id:' + s._serverReportId, s); if (s.submittedId) m.set('id:' + s.submittedId, s); if (s.finalizedAt || s.editOf) m.set('k:' + backupKey(Object.assign({}, s, { finalizedAt: s.finalizedAt || s.editOf })), s); }); } catch (e) {}
        let b = []; try { b = require('./purchases').paidWithEmail(); } catch (e) {}
        efCache = { at: Date.now(), bk: m, agents: readAgents(), buys: b };
      }
      const bk = efCache.bk, agentsAll = efCache.agents, buys = efCache.buys;
      const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const emailsFor = r => {
        const out = [], add = (e, who, name) => { e = String(e || '').trim().toLowerCase(); if (EMAIL_RE.test(e) && !out.some(x => x.e === e)) out.push({ e, who, name: name || '' }); };
        const s = bk.get('id:' + r.id) || bk.get('k:' + r.key) || null, doer = r.signedBy || r.inspectorName || '';
        add(r.copyEmail, 'did the report', doer); if (s) add((s.meta || {}).copyEmail, 'did the report', doer);
        let buyer = ''; try { buyer = s && s._token ? require('./purchases').emailFor(s._token) : ''; } catch (e) {}
        add(buyer, 'paid for it');
        // A purchase that names this report's person, or was used for this address, even if the report was never linked to it.
        const dn = norm(doer), ad = norm(r.address);
        const sameName = (a, b) => { if (!a || !b) return false; if (a === b) return true; const A = a.split(' '), B = b.split(' '), [x, y] = A.length <= B.length ? [A, B] : [B, A]; return x.length >= 2 && x.every(w => y.includes(w)); };
        buys.forEach(b => { const bn = norm(b.name), bu = norm(b.usedFor); if (sameName(bn, dn) || (bu && ad && (bu === ad || bu.includes(ad) || ad.includes(bu))) || (s && s._token && s._token === b.token)) add(b.email, 'paid for it', b.name); });
        { const pw = String(r.paidWith || ''), m = / by ([^,()]+?),\s*([^\s,()<>]+@[^\s,()<>]+\.[a-z]{2,})/i.exec(pw); if (m) add(m[2], 'paid for it', m[1].trim()); (pw.match(/[^\s,()<>]+@[^\s,()<>]+\.[a-z]{2,}/gi) || []).forEach(e => add(e, 'paid for it')); }
        const ag = r.agentId && agentsAll.find(a => a.id === r.agentId); if (ag) add(ag.email, 'agent link: ' + ag.name, ag.name);
        Object.keys(r.copies || {}).forEach(e => add(e, 'sent a copy'));
        (r.linkEmails || []).forEach(x => add(x.to, 'emailed before', x.name));
        return out;
      };
    return emailsFor(r);
  }
  knownTargets = r => emailsForReport(r);
  // Once a report is paid for, the link goes to the person who did it and whoever paid, by itself: checked every
  // 30 minutes for paid reports of the last 30 days, so one that couldn't be sent before (e.g. while the email domain
  // wasn't verified) still goes. Each address once (r.copies, with the time).
  let copySweeping = false;
  async function copySweep(){
    if (copySweeping || !RESEND_API_KEY) return; copySweeping = true;
    try {
      for (const r of listReports()) {
        if (r.unpaid && !r.paidAt) continue;
        if (r.source === 'uploaded' || r.source === 'copy') continue;
        if (Date.now() - new Date(r.paidAt || r.receivedAt || 0).getTime() > 30 * 86400000) continue;
        const want = emailsForReport(r).filter(k => /did the report|paid for it/.test(k.who) && !(r.copies || {})[k.e]);
        if (!want.length) continue;
        if (!r.photoKey) { r.photoKey = crypto.randomBytes(16).toString('hex'); keyToId.set(r.photoKey, r.id); }
        await deliverCopies(r, '').catch(e => console.error('automatic copy failed:', e.message));
      }
    } finally { copySweeping = false; }
  }
  setTimeout(() => copySweep().catch(() => {}), 90 * 1000).unref();
  setInterval(() => copySweep().catch(() => {}), 30 * 60 * 1000).unref();
  // Tenant sign-off links (/sign/<key>), in signoff.js.
  require('./signoff').mount(app, { REPORTS_DIR, photoDir, findByKey, readMeta, notPaid, logAccess: (...a) => logAccess(...a), esc, clip, clientIp, limiter, deviceName, notify: notifyOwner, PUBLIC_URL });

  // A finished report's details (rooms, items, conditions, meters, keys; photos as their numbers), so a
  // later check-out or inspection can start from it and compare. Kept beside its photos (data.json).
  app.post('/api/reports/:id/data', (req, res) => {
    if (!photoUploads(clientIp(req))) return res.status(429).json({ error: 'Too many uploads. Try again later.' });
    const id = String(req.params.id), b = req.body || {}, key = String(b.key || '');
    const r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    if (!KEY_RE.test(key) || (r.photoKey && r.photoKey !== key)) return res.status(403).json({ error: 'Wrong photo key.' });
    const d = b.data;
    if (!d || typeof d !== 'object' || !Array.isArray(d.rooms) || d.rooms.length > 60) return res.status(400).json({ error: 'Expected the report details.' });
    const text = JSON.stringify(d);
    if (text.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'The report details are too large.' });
    fs.mkdirSync(photoDir(id), { recursive: true });
    fs.writeFileSync(path.join(photoDir(id), 'data.json'), text);
    if (!r.photoKey){ r.photoKey = key; fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2)); }
    keyToId.set(key, id);
    res.json({ ok: true });
  });
  // An earlier report's details, for starting a new report from it. The random key is the access.
  app.get('/api/earlier/:key', (req, res) => {
    const key = String(req.params.key).toLowerCase();
    if (!KEY_RE.test(key)) return res.status(404).json({ error: 'That report could not be found.' });
    const id = findByKey(key);
    if (id && notPaid(readMeta(id))) return res.status(402).json({ error: 'That report hasn’t been paid for yet, so it can’t be used to start a new one.' });
    let data = null;
    try { data = id && JSON.parse(fs.readFileSync(path.join(photoDir(id), 'data.json'), 'utf8')); } catch (e) {}
    if (!data) return res.status(404).json({ error: id ? 'That report was made before reports could be reused, so it can’t be used to start a new one.' : 'That report could not be found.' });
    res.set('Cache-Control', 'no-store').json({ id, base: '/p/' + key + '/', data });
  });

  app.post('/api/reports/:id/photos', (req, res) => {
    if (!photoUploads(clientIp(req))) return res.status(429).json({ error: 'Too many uploads. Try again later.' });
    const id = String(req.params.id), b = req.body || {}, key = String(b.key || '');
    const r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    if (!KEY_RE.test(key) || (r.photoKey && r.photoKey !== key)) return res.status(403).json({ error: 'Wrong photo key.' });
    const list = Array.isArray(b.photos) ? b.photos.slice(0, 12) : [];
    const dir = photoDir(id);
    fs.mkdirSync(dir, { recursive: true });
    // The first photo of an edited version: the earlier version's photos (numbered differently) are cleared first.
    const edit = /^[\w:.\-]{10,40}$/.test(String(b.edit || '')) ? String(b.edit) : '';
    if (edit) {
      let was = ''; try { was = fs.readFileSync(path.join(dir, 'edit.txt'), 'utf8'); } catch (e) {}
      if (was !== edit) {
        try { for (const f of fs.readdirSync(dir)) if (/^\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(dir, f)); } catch (e) {}
        try { fs.unlinkSync(path.join(dir, 'index.json')); } catch (e) {}
        fs.writeFileSync(path.join(dir, 'edit.txt'), edit);
      }
    }
    let index = {};
    try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch (e) {}
    let saved = 0;
    for (const ph of list){
      const n = parseInt(ph && ph.n, 10);
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String((ph && ph.dataUrl) || ''));
      if (!(n >= 1 && n <= 5000) || !m) continue;
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length < 100 || buf.length > 12 * 1024 * 1024 || buf[0] !== 0xFF || buf[1] !== 0xD8) continue;
      const file = path.join(dir, n + '.jpg');
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
      index[n] = { title: clip(ph.title, 200), ts: clip(ph.ts, 40) };
      saved++;
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    if (!r.photoKey){ r.photoKey = key; fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2)); }
    keyToId.set(key, id);
    res.json({ ok: true, saved });
  });
  // The full-size file of photo n of a report (by its key), for the AI comparison of a check-out with its check-in.
  shared.photoFile = (key, n) => { const f = photoFor({ params: { key: String(key || ''), n: String(n || '') } }); return f && f.file && fs.existsSync(f.file) ? f.file : null; };
  function photoFor(req){
    const key = String(req.params.key), n = parseInt(req.params.n, 10);
    if (!KEY_RE.test(key) || !(n >= 1 && n <= 5000)) return null;
    if (key === EXAMPLE_KEY){   // the example report on the website: its photos ship with the app
      let idx = {}; try { idx = JSON.parse(fs.readFileSync(path.join(EXAMPLE_DIR, 'index.json'), 'utf8')); } catch (e) {}
      return { id: 'example', n, file: path.join(EXAMPLE_DIR, n + '.jpg'), info: idx[n] || {}, meta: { address: idx.address } };
    }
    const id = findByKey(key);
    if (!id || notPaid(readMeta(id))) return null;
    const file = path.join(photoDir(id), n + '.jpg');
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(photoDir(id), 'index.json'), 'utf8'))[n] || {}; } catch (e) {}
    return { id, n, file, info, meta: readMeta(id) };
  }
  const photoHeaders = res => res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
  app.get('/p/:key/:n.jpg', (req, res) => {
    photoHeaders(res);
    const f = photoFor(req);
    if (!f || !fs.existsSync(f.file)) return res.status(404).type('text/plain').send('Photo not found.');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.type('jpeg').sendFile(f.file);
  });
  app.get('/p/:key/:n', (req, res) => {
    photoHeaders(res);
    const f = photoFor(req);
    const ok = f && fs.existsSync(f.file);
    const when = f && f.info.ts ? new Date(f.info.ts) : null;
    const taken = when && !isNaN(when) ? when.toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    res.status(ok ? 200 : 404).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${ok ? esc(f.info.title || 'Photograph') : 'Photo not available'}</title><link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<style>
  * { box-sizing: border-box; } body { margin:0; background:#0B0F19; color:#E5E9F0; font:15px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  header { padding:14px 16px 10px; } h1 { font-size:15px; margin:0 0 3px; font-weight:650; } .sub { color:#9AA4B5; font-size:13px; }
  main { padding:0 8px 16px; display:flex; justify-content:center; } img { max-width:100%; height:auto; display:block; border-radius:6px; }
  .none { padding:40px 16px; text-align:center; color:#9AA4B5; }
</style></head><body>
${ok ? `<header><h1>${esc(f.info.title || 'Photograph')}</h1><div class="sub">${esc([f.meta && f.meta.address, taken ? 'Taken ' + taken : ''].filter(Boolean).join(' · '))}</div></header>
<main><img src="/p/${esc(req.params.key)}/${f.n}.jpg" alt="${esc(f.info.title || 'Photograph')}"></main>`
      : '<div class="none">This photo isn’t available. It may not have finished uploading yet, or the report has been removed.</div>'}
</body></html>`);
  });

  /* ---------- owner side: /admin, behind ADMIN_PASSWORD ---------- */
  // Sign-in: a form, then a signed cookie that keeps the owner signed in on that device for a year
  // (until they sign out, or ADMIN_PASSWORD changes, which signs every device out).
  const secure = req => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  function setSession(req, res, token, maxAge){
    // Lax, so links to a report (e.g. from the email) open straight away; changes still need the same origin.
    const flags = `HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
    // Path=/ covers the app too; the old Path=/admin cookie is cleared so signing out signs out everywhere.
    res.set('Set-Cookie', [`diy_admin=${token}; Path=/; ${flags}`, `diy_admin=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`]);
  }
  const safeNext = v => (typeof v === 'string' && /^\/admin(\/[\w.\-\/]*)?(\?download=1)?$/.test(v)) ? v : '/admin';
  function loginPage(res, status, next, msg){
    res.status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Reports sign in</title><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><meta name="apple-mobile-web-app-title" content="Reports">
<style>
  * { box-sizing: border-box; } body { margin:0; min-height:100vh; display:grid; place-items:center; background:#F3F5F9; color:#0F172A; font:16px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding:16px; }
  form { width:100%; max-width:360px; background:#fff; border:1px solid #E4E8EF; border-radius:18px; padding:26px 22px; box-shadow:0 4px 16px rgba(15,23,42,.06); }
  img { width:52px; height:52px; border-radius:13px; display:block; margin-bottom:14px; } h1 { font-size:21px; margin:0 0 4px; } p { color:#475569; margin:0 0 18px; font-size:14.5px; }
  label { font-size:13px; font-weight:600; display:block; margin-bottom:6px; } input { width:100%; font:inherit; padding:12px 13px; border:1px solid #CDD4DF; border-radius:11px; }
  input:focus { outline:none; border-color:#3257C8; box-shadow:0 0 0 4px rgba(50,87,200,.16); }
  button { width:100%; margin-top:14px; font:inherit; font-weight:700; padding:13px; border:0; border-radius:11px; background:#3257C8; color:#fff; cursor:pointer; }
  .err { background:#FDECEA; color:#B42318; font-size:14px; padding:10px 12px; border-radius:10px; margin-bottom:14px; }
</style></head><body>
<form method="post" action="/admin/login">
  <img src="/icons/apple-touch-icon.png" alt="">
  <h1>Submitted reports</h1><p>Sign in once and you stay signed in on this device.</p>
  ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">Sign in</button>
</form></body></html>`);
  }
  function requireAdmin(req, res, next){
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    if (!ADMIN_PASSWORD) return res.status(503).type('text/plain').send('Reports are locked. Set ADMIN_PASSWORD in Railway → Variables to open this page.');
    if (signedIn(req)){
      if (req.method === 'GET' && req.path === '/admin' && !/(?:^|;\s*)diy_admin=[^;]+;[^]*diy_admin=/.test(String(req.headers.cookie || ''))) setSession(req, res, makeToken(), SESSION_DAYS * 86400);
      return next();
    }
    if (req.method !== 'GET') return res.status(401).json({ error: 'Signed out. Reload the page and sign in.' });
    loginPage(res, 401, safeNext(req.originalUrl), '');
  }
  app.post('/admin/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    if (!ADMIN_PASSWORD) return res.status(503).type('text/plain').send('Reports are locked. Set ADMIN_PASSWORD in Railway → Variables to open this page.');
    const next = safeNext((req.body || {}).next);
    if (!sameOrigin(req)) return loginPage(res, 403, next, 'Please sign in from this page.');
    const given = String((req.body || {}).password || '');
    const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (!crypto.timingSafeEqual(a, b)){
      if (!loginFailures(clientIp(req))) return loginPage(res, 429, next, 'Too many attempts. Try again in 15 minutes.');
      return loginPage(res, 401, next, "That password isn't right.");
    }
    setSession(req, res, makeToken(), SESSION_DAYS * 86400);
    res.redirect(303, next);
  });
  app.post('/admin/logout', (req, res) => { setSession(req, res, '', 0); res.redirect(303, '/admin'); });
  // Deleting only from the admin page itself, never from another site's form.
  function sameOrigin(req){
    const origin = req.headers.origin || req.headers.referer || '';
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
  }

  // Certificate bookings (Gas Safety, EICR, EPC) and their prices: certs.js.
  const certs = require('./certs').mountAdmin(app, { REPORTS_DIR, esc, requireAdmin, sameOrigin });
  // Visits and sales funnel: /admin/analytics (analytics.js).
  // The admin sidebar, shared by /admin and the pages beside it (Visits and sales), so they look like one place.
  const ADMIN_SECTIONS = [['overview', 'Overview', '◎'], ['reports', 'Reports', '📄'], ['sales', 'Sales', '💷'], ['enquiries', 'Enquiries', '✉️'], ['work', 'In progress', '📝'], ['landlords', 'Landlords', '🏠'], ['access', 'Access & links', '🔑']];
  const SHELL_CSS = `.shell{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}.shell>main{min-width:0}
  .shell aside{background:#1B2A4A;color:#DCE3EF;padding:20px 14px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:4px;font:14.5px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .shell aside .brand{display:flex;align-items:center;gap:10px;font-weight:750;color:#fff;padding:2px 10px 18px;font-size:15px}.shell aside .brand img{border-radius:8px}
  .shell aside nav{display:flex;flex-direction:column;gap:2px}
  .shell aside nav a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;color:#C9D3E3;text-decoration:none;font-weight:600}
  .shell aside nav a i{font-style:normal;width:20px;text-align:center}.shell aside nav a:hover{background:rgba(255,255,255,.07);color:#fff}.shell aside nav a.on{background:#fff;color:#1B2A4A}
  .shell aside .foot{margin-top:auto;display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;color:#9FB0C8}
  .shell aside .foot a,.shell aside .foot button{display:block;text-align:center;font:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;text-decoration:none;cursor:pointer;width:100%}
  .shell aside .foot a.primary{background:#C49A6C;border-color:#C49A6C;color:#1B2A4A}
  @media(max-width:760px){.shell{grid-template-columns:minmax(0,1fr)}.shell aside{position:sticky;top:0;z-index:5;height:auto;padding:10px 10px 8px}.shell aside .brand{padding:2px 4px 8px}.shell aside .foot{display:none}
  .shell aside nav{flex-direction:row;overflow-x:auto;gap:6px;scrollbar-width:none}.shell aside nav::-webkit-scrollbar{display:none}.shell aside nav a{flex:0 0 auto;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.08)}.shell aside nav a i{display:none}}`;
  const shellAside = active => `<aside><div class="brand"><img src="/icons/icon-192.png" alt="" width="28" height="28">DIY Inventory · Admin</div>
<nav>${ADMIN_SECTIONS.map(([k, l, i]) => `<a href="/admin#${k}"${active === k ? ' class="on"' : ''}><i>${i}</i><span>${esc(l)}</span></a>`).join('')}<a href="/admin/analytics"${active === 'analytics' ? ' class="on"' : ''}><i>📈</i><span>Visits and sales</span></a></nav>
<div class="foot"><a class="primary" href="/app">Open the app</a><form method="post" action="/admin/logout"><button>Sign out</button></form></div></aside>`;
  const analytics = require('./analytics'); analytics.mountAdmin(app, { esc, requireAdmin, shell: { css: SHELL_CSS, aside: shellAside } });

  // Contact form messages for the admin page; opening the page marks them as seen.
  function messagesHTML(){
    const d = readMessages(), seen = d.seenAt, list = d.list.slice().reverse();
    const isNew = m => !seen || m.at > seen, fresh = list.filter(isNew).length;
    if (list.length) { d.seenAt = new Date().toISOString(); writeMessages(d); }
    const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const rows = list.slice(0, 200).map(m => `<li${isNew(m) ? ' class="isnew"' : ''}><div style="flex:1;min-width:0"><strong>${esc(m.name)}</strong>${isNew(m) ? ' <span class="pill new">New</span>' : ''}${m.topic ? ' <span class="pill">' + esc(m.topic) + '</span>' : ''}
      <div class="sub"><a href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message to DIY Inventory')}">${esc(m.email)}</a>${m.phone ? ' · <a href="tel:' + esc(m.phone.replace(/[^\d+]/g, '')) + '">' + esc(m.phone) + '</a>' : ''} · ${esc(when(m.at))}</div>
      <div class="msg">${esc(m.message)}</div>${Origin.html(m.origin, esc)}</div>
      <div class="actions"><form method="post" action="/admin/messages/${esc(m.id)}/delete" onsubmit="return confirm('Delete this message?')"><button class="btn danger">Delete</button></form></div></li>`).join('');
    const banner = fresh ? `<a class="news" href="#messages" onclick="document.getElementById('messages').open=true">✉️ ${fresh} new message${fresh === 1 ? '' : 's'} from the website</a>` : '';
    return banner + `<details class="codes" id="messages"${fresh ? ' open' : ''}><summary>✉️ Messages <span class="sub" style="display:inline">— ${list.length ? list.length + ' from the contact form' : 'none yet'}</span></summary>
${rows ? '<ul>' + rows + '</ul>' : '<p class="sub">Messages sent from the website’s Contact page appear here.</p>'}</details>`;
  }
  app.post('/admin/messages/:id/delete', requireAdmin, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Delete messages from the reports page.');
    const d = readMessages(); d.list = d.list.filter(m => m.id !== String(req.params.id)); writeMessages(d);
    res.redirect(303, '/admin#messages');
  });

  // Access code activity for the admin page; opening the page marks everything as seen.
  function activityHTML(){
    const log = readLog(), seen = log.seenAt, entries = log.entries.slice().reverse();
    const isNew = e => !seen || e.at > seen, fresh = entries.filter(isNew);
    if (entries.length) { log.seenAt = new Date().toISOString(); writeLog(log); }
    const when = d => new Date(d).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const ins = fresh.filter(e => e.kind === 'in').length, reps = fresh.filter(e => e.kind === 'report').length;
    const banner = fresh.length ? `<a class="news" href="#activity" onclick="document.getElementById('activity').open=true">🔔 ${[ins ? ins + ' new login' + (ins === 1 ? '' : 's') + ' with the access code' : '', reps ? reps + ' new report' + (reps === 1 ? '' : 's') + ' made with it' : ''].filter(Boolean).join(' and ')} since your last visit</a>` : '';
    const rows = entries.slice(0, 100).map(e => `<li${isNew(e) ? ' class="isnew"' : ''}><div><strong>${e.kind === 'report' ? '📄 Made a report' + (e.address ? ': ' + esc(e.address) : '') : '🔓 Logged in with ' + (/^agent link: /.test(e.code) ? 'the ' + esc(e.code) : 'the access code')}</strong>${isNew(e) ? ' <span class="pill new">New</span>' : ''}
      <div class="sub">${esc(when(e.at))} · ${esc(e.device)} · ${/^agent link: /.test(e.code) ? esc(e.code) : 'code ' + esc(e.code)}</div></div></li>`).join('');
    return banner + `<details class="codes" id="activity"${fresh.length ? ' open' : ''}><summary>👥 Who has used the access code <span class="sub" style="display:inline">— ${entries.length ? entries.filter(e => e.kind === 'in').length + ' login' + (entries.filter(e => e.kind === 'in').length === 1 ? '' : 's') + ', ' + entries.filter(e => e.kind === 'report').length + ' report' + (entries.filter(e => e.kind === 'report').length === 1 ? '' : 's') : 'nobody yet'}</span></summary>
${rows ? '<ul>' + rows + '</ul>' : '<p class="sub">When someone gets in with the access code, it shows here with the time and their device.</p>'}</details>`;
  }

  function codesHTML(req){
    const base = (PUBLIC_URL || (req.protocol + '://' + req.headers.host)) + '/?access=';
    const day = d => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
    const rows = readCodes().slice().reverse().map(c => `<li><div><code>${esc(c.code)}</code>${c.name ? ' <strong>' + esc(c.name) + '</strong>' : ''}
      <div class="sub">Made ${esc(day(c.createdAt))} · ${c.usedAt ? '<span class="pill">Used ' + esc(day(c.usedAt)) + (c.usedFor ? ' · ' + esc(c.usedFor) : '') + '</span>' : '<span class="pill sent">Not used yet</span>'}</div></div>
      <div class="actions">${c.usedAt ? '' : `<button class="btn" type="button" onclick="copyLink(this,'${esc(base + c.code)}')">Copy link</button>`}<form method="post" action="/admin/codes/${esc(c.code)}/delete" onsubmit="return confirm('Delete code ${esc(c.code)}? It will stop working.')"><button class="btn danger">Delete</button></form></div></li>`).join('');
    const d = readShared();
    return `<details class="codes" id="codes"><summary>🔑 Access code: <code>${esc(d.code)}</code></summary>
<p class="sub">Give this code to anyone you want to use the app without paying. They type it on the “Buy a report” page, or you send them the link. It works for as many reports as they like${d.uses ? `; used for ${d.uses} report${d.uses === 1 ? '' : 's'} so far, last ${esc(day(d.lastUsedAt))}${d.lastUsedFor ? ' (' + esc(d.lastUsedFor) + ')' : ''}` : ''}.</p>
<div class="newcode"><button class="btn" type="button" onclick="copyLink(this,'${esc(base + d.code)}')">Copy link</button></div>
<form method="post" action="/admin/code" class="newcode" onsubmit="return confirm('Change the access code? The old one will stop working, including for anyone part-way through a report with it.')"><input name="code" required pattern="[A-Za-z0-9]{4,20}" maxlength="20" placeholder="New code (4–20 letters or numbers)" autocomplete="off"><button class="btn">Change code</button></form>
${rows ? '<p class="sub" style="margin-top:12px">One-off codes made before:</p><ul>' + rows + '</ul>' : ''}</details>`;
  }

  function agentsHTML(req){
    const base = (PUBLIC_URL || (req.protocol + '://' + req.headers.host)) + '/?access=', end = '&start=checkin';
    const day = d => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
    const list = readAgents().slice().reverse();
    const rows = list.map(a => `<li><div style="flex:1;min-width:0"><strong>${esc(a.name)}</strong>
      <div class="sub">Made ${esc(day(a.createdAt))} · ${a.uses ? 'used for ' + a.uses + ' report' + (a.uses === 1 ? '' : 's') + ', last ' + esc(day(a.lastUsedAt)) + (a.lastUsedFor ? ' (' + esc(a.lastUsedFor) + ')' : '') : 'not used yet'}</div>
      <input readonly value="${esc(base + a.token + end)}" onclick="this.select()" style="width:100%;margin-top:6px;font:13px monospace">
      <form method="post" action="/admin/agents/${esc(a.id)}/email" style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><input name="email" type="email" maxlength="120" value="${esc(a.email || '')}" placeholder="Email finished reports to… (optional)" style="flex:1;min-width:180px"><button class="btn">Save</button></form>
      <div class="sub">${a.email ? '📧 Each finished report from this link is emailed to ' + esc(a.email) + (RESEND_API_KEY ? '' : ' (once email is set up: RESEND_API_KEY)') : 'No email: finished reports from this link only come to you.'}</div></div>
      <div class="actions"><button class="btn" type="button" onclick="copyLink(this,'${esc(base + a.token + end)}')">Copy link</button><form method="post" action="/admin/agents/${esc(a.id)}/delete" onsubmit="return confirm('Remove the link for ${esc(String(a.name).replace(/'/g, ''))}? It will stop working straight away.')"><button class="btn danger">Remove</button></form></div></li>`).join('');
    return `<details class="codes" id="agents"><summary>🏢 Tenant links: check-in or check-out <span class="sub" style="display:inline">— ${list.length ? list.length + ' link' + (list.length === 1 ? '' : 's') : 'none yet'}</span></summary>
<p class="sub">A link for tenants to do their own check-in or check-out, without paying or typing a code. It opens straight on a new report with Check-In chosen, and they can change it to Check-Out (or an inspection). Make one per estate agent (or landlord) and they can send the same link to every tenant; it keeps working until you remove it, and each report made with it is counted here. The reports arrive here like any other.</p>
<form method="post" action="/admin/agents" class="newcode"><input name="name" required maxlength="80" placeholder="Which agent or landlord is it for? e.g. Smith &amp; Co Lettings" autocomplete="off"><input name="email" type="email" maxlength="120" placeholder="Their email for finished reports (optional)" autocomplete="off"><button class="btn primary">Make a link</button></form>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  }
  app.post('/admin/agents', requireAdmin, express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Make links from the reports page.');
    const name = clip(req.body && req.body.name, 80);
    if (!name) return res.status(400).type('text/plain').send('Please say who the link is for.');
    const list = readAgents();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return res.status(400).type('text/plain').send('Please check the email address, or leave it blank.');
    list.push({ id: crypto.randomBytes(6).toString('hex'), name, email: clip(email, 120), token: 'AGT-' + crypto.randomBytes(18).toString('base64url'), createdAt: new Date().toISOString(), uses: 0 });
    writeAgents(list);
    res.redirect(303, '/admin#agents');
  });
  app.post('/admin/agents/:id/email', requireAdmin, express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Change links from the reports page.');
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return res.status(400).type('text/plain').send('Please check the email address, or leave it blank.');
    const list = readAgents(), a = list.find(a => a.id === String(req.params.id));
    if (!a) return res.status(404).type('text/plain').send('That link has been removed.');
    a.email = clip(email, 120); writeAgents(list);
    res.redirect(303, '/admin#agents');
  });
  app.post('/admin/agents/:id/delete', requireAdmin, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Remove links from the reports page.');
    writeAgents(readAgents().filter(a => a.id !== String(req.params.id)));
    res.redirect(303, '/admin#agents');
  });

  app.post('/admin/code', requireAdmin, express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Change the code from the reports page.');
    const code = normCode(req.body && req.body.code);
    if (!/^[A-Z0-9]{4,20}$/.test(code)) return res.status(400).type('text/plain').send('The code must be 4 to 20 letters or numbers.');
    const d = readShared(); if (code !== d.code) { d.code = code; d.uses = 0; delete d.lastUsedAt; delete d.lastUsedFor; writeShared(d); }
    res.redirect(303, '/admin#codes');
  });

  app.post('/admin/codes/:code/delete', requireAdmin, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Delete codes from the reports page.');
    writeCodes(readCodes().filter(c => c.code !== String(req.params.code)));
    res.redirect(303, '/admin#codes');
  });

  app.get('/admin', requireAdmin, (req, res) => {
    const reports = listReports();
    const rows = reports.map(r => { const known = emailsForReport(r); return `
      <tr data-q="${esc((r.address + ' ' + r.ref + ' ' + r.inspectorName + ' ' + r.inspectionType).toLowerCase())}">
        <td>${esc(new Date(r.receivedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}</td>
        <td><strong>${esc(r.address || '—')}</strong><div class="sub">${esc([r.inspectionType, r.ref, r.basedOnRef ? 'compared with ' + r.basedOnRef : '', r.source === 'uploaded' ? 'added from a PDF' : '', r.source === 'backup' ? 'made from the online backup (the phone’s PDF didn’t arrive)' + (r.backupMissingPhotos ? ', ' + r.backupMissingPhotos + ' photos missing' : '') : ''].filter(Boolean).join(' · '))}</div>${r.origin ? Origin.html(r.origin, esc) : ''}</td>
        <td>${esc(r.signedBy || r.inspectorName || '—')}<div class="sub">${r.source === 'uploaded' ? '' : r.sentAt ? '<span class="pill sent">Sent ' + esc(new Date(r.sentAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })) + (r.emailedAt ? ' · emailed' : '') + '</span>' : '<span class="pill">Not sent by tenant yet</span>'}${r.unpaid ? ' <span class="pill wait">Not paid yet</span>' : ''}${r.paidWith ? ' <div class="sub">💳 ' + esc(r.paidWith) + '</div>' : ''}${r.agentName ? ' <span class="pill">via ' + esc(r.agentName) + '</span>' : ''}${r.tenantSignedAt ? ' <span class="pill sent">✍️ Signed by ' + esc(r.tenantSignedBy) + (r.tenantAgree === 'comments' ? ', with comments' : '') + '</span>' : ''}${sentLog(r)}${r.copiedFrom ? ' <div class="sub">📄 Copy of the ' + esc(r.copiedFromType || 'report') + ' ' + esc(r.copiedFromRef || '') + '</div>' : ''}${r.editedAt ? ' <div class="sub">✏️ Edited on the phone ' + esc(new Date(r.editedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })) + (r.edits > 1 ? ' (' + r.edits + ' times)' : '') + (r.editedAfterSigning ? ' · after the tenant signed: their signed copy is the earlier version' : '') + '</div>' : ''}</div></td>
        <td class="num">${r.rooms ? r.rooms + ' rooms · ' + r.photos + ' photos' : '—'}<div class="sub">${(r.size / 1048576).toFixed(1)} MB</div>${(() => { const L = readAccess(r.id); if (!L.length) return ''; const dl = L.filter(x => /download|app_share/.test(x.what)).length; return `<div class="sub"><a href="/admin/reports/${r.id}/opened">👁 ${L.length - dl} view${L.length - dl === 1 ? '' : 's'} · ⬇ ${dl} download${dl === 1 ? '' : 's'}</a></div>`; })()}</td>
        <td class="actions"><div class="act">
          ${notPaid(r) || (!r.sentAt && r.source !== 'uploaded') ? `<form method="post" action="/admin/reports/${r.id}/complete" onsubmit="return confirm('Mark this report as complete${notPaid(r) ? ' and paid' : ''}? Its online link will work and any copies are emailed.')"><button class="btn primary">Mark as complete</button></form>` : ''}
          <a class="btn" href="/admin/reports/${r.id}.pdf" target="_blank" rel="noopener">View</a>
          <a class="btn" href="/admin/reports/${r.id}.pdf?download=1">Download</a>
          ${r.source !== 'uploaded' ? `<a class="btn" href="/admin/reports/${r.id}/edit" title="Open it in the app on this device, change anything, finish again: it replaces this report (same link and payment)">✏️ Edit</a>` : ''}
          ${!notPaid(r) ? `<details class="more mail"><summary class="btn">✉ Email</summary><form class="menu mailf" onsubmit="return sendLink(this, '${r.id}')">
            ${known.length ? `<div class="known"><span>Send to:</span>${known.map((k, i) => `<button type="button" class="kchip${i ? '' : ' on'}" data-e="${esc(k.e)}" data-n="${esc(k.name)}" onclick="pickTo(this)"><b>${esc(k.name || k.e)}</b> · ${esc(k.who)}<i>${esc(k.e)}</i></button>`).join('')}</div>` : ''}
            <label>Email address<input type="email" name="to" required placeholder="name@example.com" value="${esc(known[0] ? known[0].e : '')}"></label>
            <label>Their name <span>(optional)</span><input name="name" placeholder="e.g. Mr Smith" value="${esc(known[0] ? known[0].name : '')}"></label>
            <label>Message<textarea name="note" rows="4">Please find the ${esc((r.inspectionType || 'inventory').toLowerCase())} report for ${esc(r.address || 'your property')} below. You can view it online and download the PDF.</textarea></label>
            <div class="mrow"><button class="btn primary">Send the link</button><span class="mres"></span></div></form></details>` : ''}
          <details class="more"><summary class="btn">More ▾</summary><div class="menu">
            ${!notPaid(r) && r.photoKey ? `<button class="mi" type="button" onclick="copyLink(this,'${esc(onlineLink(r) || '/report/' + r.photoKey)}')">🔗 Copy link</button><a class="mi" href="/report/${r.photoKey}" target="_blank" rel="noopener">🌐 Open the online page</a>` : ''}
            ${!notPaid(r) && !r.photoKey ? `<form method="post" action="/admin/reports/${r.id}/link"><button class="mi">🌐 Make an online link</button></form>` : ''}
            ${r.tenantSignedAt && r.photoKey ? `<a class="mi" href="/sign/${r.photoKey}/signed.pdf" target="_blank" rel="noopener">✍️ Signed copy</a>` : ''}
            <form method="post" action="/admin/reports/${r.id}/copy" class="copyas" onsubmit="if(!this.type.value){alert('Choose the type for the copy.');return false}this.querySelector('button').textContent='Copying…'"><span class="ml">📄 Make a copy as another type</span><span class="mr"><select name="type" aria-label="Type for the copy"><option value="">Choose…</option>${COPY_TYPES.filter(t => t !== r.inspectionType).map(t => `<option>${t}</option>`).join('')}</select><button class="btn" title="A separate copy: same rooms, conditions and photos, new reference. The original stays as it is.">Make copy</button></span></form>
            ${r.source === 'backup' ? `<form method="post" action="/admin/reports/${r.id}/rebuild" onsubmit="this.querySelector('button').textContent='Rebuilding…'"><button class="mi" title="Remake it with clickable full-size photos and an index of photographs">🔄 Rebuild from backup</button></form>` : ''}
            <form method="post" action="/admin/reports/${r.id}/delete" onsubmit="return confirm('Delete the report for ${esc(String(r.address).replace(/'/g, ''))}? This cannot be undone.')"><button class="mi danger">🗑 Delete</button></form>
          </div></details>
        </div></td>
      </tr>`; }).join('');
    // Reports finished on a phone whose PDF hasn't arrived (not paid, or the upload failed): shown from their backup.
    const have = new Set(reports.map(r => r.key));
    const orphans = drafts.finishedOnly().filter(({ s }) => !have.has(crypto.createHash('sha256').update(clip((s.meta || {}).ref, 40) + '|' + clip(s.finalizedAt, 40)).digest('hex').slice(0, 12)));
    const orphanRows = orphans.map(({ key, s }) => { const m = s.meta || {}; return `
      <tr data-q="${esc(((m.address || '') + ' ' + (m.ref || '') + ' ' + (m.inspectorName || '') + ' ' + (m.inspectionType || '')).toLowerCase())}">
        <td>${esc(new Date(s.finalizedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}</td>
        <td><strong>${esc(m.address || '—')}</strong><div class="sub">${esc([m.inspectionType, m.ref, s._device].filter(Boolean).join(' · '))}</div></td>
        <td>${esc(m.signedBy || m.inspectorName || '—')}<div class="sub"><span class="pill wait">Finished on the phone · PDF not received</span></div></td>
        <td class="num">${(s.rooms || []).length} rooms<div class="sub">from the online backup</div></td>
        <td class="actions"><a class="btn" href="/admin/drafts/${key}" target="_blank" rel="noopener">View</a><form method="post" action="/admin/drafts/${key}/make" onsubmit="this.querySelector('button').textContent='Making it…'"><button class="btn primary">Make the report now</button></form></td>
      </tr>`; }).join('');
    // The page is laid out as a dashboard: a sidebar of sections, each shown on its own (#hash), with an Overview first.
    // Every block (bookings, purchases, messages…) is still made by its own module; here they're only sorted into groups.
    const secs = [];
    const addSec = html => {
      if (!html) return;
      const i = html.indexOf('<details'), banner = i > 0 ? html.slice(0, i) : '', body = i >= 0 ? html.slice(i) : html;
      const tag = body.slice(0, body.indexOf('>') + 1), id = (/\sid="([^"]+)"/.exec(tag) || [])[1] || '';
      const title = ((/<summary>([\s\S]*?)<\/summary>/.exec(body) || [])[1] || '');
      secs.push({ id, banner, body: body.replace(/^<details(?![^>]*\sopen)/, '<details open'), fresh: /\sopen[\s>]/.test(tag), title });
    };
    const safe = f => { try { return f(); } catch (e) { console.error('admin section failed:', e.message); return ''; } };
    addSec(safe(() => certs.adminHTML()));
    adminSections.forEach(f => addSec(safe(() => f(req))));
    addSec(safe(messagesHTML)); addSec(safe(() => drafts.draftsHTML())); addSec(safe(activityHTML)); addSec(safe(() => codesHTML(req))); addSec(safe(() => agentsHTML(req)));
    const GROUPS = [['sales', 'Sales', '💷', ['purchases', 'floorplans']], ['enquiries', 'Enquiries', '✉️', ['messages', 'bookings', 'prleads']],
      ['work', 'In progress', '📝', ['drafts', 'inspections', 'midterm']], ['landlords', 'Landlords', '🏠', ['landlords']], ['access', 'Access & links', '🔑', ['agents', 'codes', 'activity']]];
    const known = new Set(GROUPS.flatMap(g => g[3]));
    const groups = GROUPS.map(([k, label, icon, ids]) => ({ k, label, icon, secs: ids.map(id => secs.find(x => x.id === id)).filter(Boolean) }))
      .concat([{ k: 'more', label: 'More', icon: '⋯', secs: secs.filter(x => !known.has(x.id)) }]).filter(g => g.secs.length);
    const groupOf = id => (groups.find(g => g.secs.some(x => x.id === id)) || {}).k || 'overview';
    const plain = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const weekAgo = Date.now() - 7 * 864e5;
    const thisWeek = reports.filter(r => Date.parse(r.receivedAt) > weekAgo).length, unpaidN = reports.filter(r => notPaid(r)).length;
    const attention = [].concat(
      orphans.length ? [`<a href="#reports"><div><b>${orphans.length}</b> finished on a phone, PDF not received yet</div><span>Reports</span></a>`] : [],
      unpaidN ? [`<a href="#reports"><div><b>${unpaidN}</b> finished report${unpaidN === 1 ? '' : 's'} not paid for yet</div><span>Reports</span></a>`] : [],
      secs.filter(x => x.fresh || x.banner).map(x => `<a href="#${esc(x.id)}"><div>${esc(plain(x.banner) || plain(x.title))}</div><span>${esc((groups.find(g => g.k === groupOf(x.id)) || {}).label || '')}</span></a>`));
    const fmt = d => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const latest = reports.slice(0, 5).map(r => `<a href="#reports"><div><b>${esc(r.address || '—')}</b></div><span>${esc([r.inspectionType, fmt(r.receivedAt), notPaid(r) ? 'not paid yet' : ''].filter(Boolean).join(' · '))}</span></a>`).join('');
    const NAV = [['overview', 'Overview', '◎', attention.length], ['reports', 'Reports', '📄', 0]].concat(groups.map(g => [g.k, g.label, g.icon, g.secs.filter(x => x.fresh).length]));
    const nav = NAV.map(([k, label, icon, n]) => `<a href="#${k}" data-k="${k}"><i>${icon}</i><span>${esc(label)}</span>${k === 'reports' ? `<em class="c">${reports.length}</em>` : n ? `<em>${n}</em>` : ''}</a>`).join('') + '<a href="/admin/analytics"><i>📈</i><span>Visits and sales</span></a>';
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Admin · DIY Inventory</title><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><meta name="apple-mobile-web-app-title" content="Admin">
<style>
  :root { --ink:#13203A; --soft:#5B677C; --faint:#8A95A8; --line:#E6E9F0; --bg:#F5F6F9; --card:#fff; --navy:#1B2A4A; --accent:#1B2A4A; --camel:#C49A6C; --danger:#B42318; --good:#15803D; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:14.5px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .shell { display:grid; grid-template-columns:240px minmax(0,1fr); min-height:100vh; } main { min-width:0; }
  .list a > div { min-width:0; } .list a span { text-align:right; }
  aside { background:var(--navy); color:#DCE3EF; padding:20px 14px; position:sticky; top:0; height:100vh; display:flex; flex-direction:column; gap:4px; }
  aside .brand { display:flex; align-items:center; gap:10px; font-weight:750; color:#fff; padding:2px 10px 18px; font-size:15px; } aside .brand img { border-radius:8px; }
  aside nav { display:flex; flex-direction:column; gap:2px; }
  aside nav a { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:10px; color:#C9D3E3; text-decoration:none; font-weight:600; }
  aside nav a i { font-style:normal; width:20px; text-align:center; } aside nav a span { flex:1; }
  aside nav a:hover { background:rgba(255,255,255,.07); color:#fff; } aside nav a.on { background:#fff; color:var(--navy); }
  aside nav a em { font-style:normal; font-size:11.5px; font-weight:700; background:var(--camel); color:#1B2A4A; border-radius:999px; padding:1px 7px; } aside nav a em.c { background:rgba(255,255,255,.14); color:#fff; } aside nav a.on em.c { background:#EEF1F6; color:var(--navy); }
  aside .foot { margin-top:auto; display:flex; flex-direction:column; gap:8px; padding:10px; font-size:12px; color:#9FB0C8; }
  aside .foot .btn { text-align:center; margin:0; }
  main { padding:28px 32px 60px; max-width:1180px; width:100%; }
  .top { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:18px; flex-wrap:wrap; }
  h1 { font-size:26px; margin:0; letter-spacing:-.02em; font-weight:800; } .lead { color:var(--soft); margin:4px 0 0; }
  h2.ph { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--faint); margin:26px 0 10px; }
  .tiles { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
  .tile { background:var(--card); border-radius:16px; padding:16px 18px; box-shadow:0 1px 2px rgba(19,32,58,.05), 0 0 0 1px var(--line); text-decoration:none; color:inherit; }
  .tile b { display:block; font-size:28px; letter-spacing:-.02em; } .tile span { color:var(--soft); font-size:13px; } .tile.warn b { color:#B45309; }
  .list { background:var(--card); border-radius:16px; box-shadow:0 0 0 1px var(--line); overflow:hidden; }
  .list a { display:flex; justify-content:space-between; gap:12px; padding:13px 16px; border-top:1px solid var(--line); color:var(--ink); text-decoration:none; } .list a:first-child { border-top:0; }
  .list a:hover { background:#FAFBFD; } .list a span { color:var(--faint); font-size:13px; white-space:nowrap; } .list a b { font-weight:600; }
  .list .none { padding:16px; color:var(--soft); }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:16px; } .two > div { min-width:0; }
  .warn { background:#FDF3E1; color:#8A5A16; padding:12px 14px; border-radius:10px; margin-bottom:16px; font-size:14px; }
  input[type=search] { width:100%; max-width:420px; padding:11px 16px; border:0; background:#fff; box-shadow:0 0 0 1px var(--line); border-radius:999px; font-size:15px; }
  .card { background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 0 0 1px var(--line); }
  table { width:100%; border-collapse:collapse; } th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); padding:12px 14px; border-bottom:1px solid var(--line); background:#FAFBFD; }
  td { padding:13px 14px; border-bottom:1px solid var(--line); vertical-align:top; } tr:last-child td { border-bottom:none; }
  .sub { color:var(--soft); font-size:12.5px; margin-top:2px; } .num { white-space:nowrap; }
  .actions { white-space:nowrap; } .actions form { display:inline; }
  td.actions { width:330px; min-width:330px; } .act { display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end; align-items:flex-start; } .act .btn { margin:0; white-space:nowrap; padding:6px 11px; }
  details.more > summary { list-style:none; } details.more > summary::-webkit-details-marker { display:none; } details.more[open] > summary { background:#F1F3F7; }
  @media (max-width:760px) { .act { justify-content:flex-start; max-width:none; margin-left:0; } td.actions { width:auto; min-width:0; } }
  details.more { flex-basis:auto; } details.more[open] { flex-basis:100%; }
  .menu { margin-top:8px; background:#FAFBFD; border:1px solid var(--line); border-radius:12px; padding:6px; display:grid; gap:2px; white-space:normal; text-align:left; }
  .actions form.mailf { display:grid; gap:2px; }
  .sentlog { margin-top:4px; } .sentlog summary { cursor:pointer; color:var(--soft); } .sentlog ul { margin:4px 0 0; padding-left:16px; } .sentlog li { margin:2px 0; overflow-wrap:anywhere; } .sentlog .what { display:block; color:var(--faint); font-size:11px; }
  .known { display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:4px 6px 6px; } .known > span { font-size:12.5px; font-weight:600; color:var(--soft); width:100%; }
  .kchip { font:inherit; font-size:12.5px; text-align:left; background:#fff; border:1px solid #CDD4DF; border-radius:10px; padding:6px 10px; cursor:pointer; color:var(--ink); max-width:100%; } .kchip b { font-weight:600; } .kchip i { display:block; font-style:normal; color:var(--soft); font-size:12px; overflow-wrap:anywhere; } .kchip.on { border-color:var(--navy); box-shadow:0 0 0 1px var(--navy); }
  .mailf label { display:block; font-size:12.5px; font-weight:600; color:var(--soft); padding:4px 6px; } .mailf label span { font-weight:400; } .mailf input, .mailf textarea { display:block; width:100%; margin-top:4px; font:inherit; font-size:14px; font-weight:400; color:var(--ink); padding:8px 10px; border:1px solid #CDD4DF; border-radius:8px; background:#fff; } .mailf textarea { resize:vertical; }
  .mailf .mrow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:6px; } .mres { font-size:13px; } .mres.ok { color:var(--good); } .mres.bad { color:var(--danger); }
  .menu form { display:block; } .menu .mi { display:block; width:100%; text-align:left; font:inherit; font-size:14px; color:var(--ink); background:none; border:0; border-radius:8px; padding:9px 10px; cursor:pointer; text-decoration:none; } .menu .mi:hover { background:#EEF1F6; } .menu .mi.danger { color:var(--danger); }
  .menu .copyas { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:8px 10px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); margin:2px 0; } .menu .ml { font-size:14px; } .menu .mr { display:flex; gap:6px; } .menu select { font:inherit; font-size:13px; padding:6px 8px; border-radius:8px; border:1px solid #CDD4DF; background:#fff; color:var(--ink); }
  .btn { display:inline-block; font:inherit; font-size:13px; font-weight:600; padding:7px 13px; border-radius:999px; border:1px solid #CDD4DF; background:#fff; color:var(--ink); text-decoration:none; cursor:pointer; margin:2px 4px 2px 0; }
  .btn:hover { border-color:var(--navy); } .btn.danger { color:var(--danger); } .btn.danger:hover { border-color:var(--danger); }
  .btn.primary { background:var(--navy); border-color:var(--navy); color:#fff; } .btn.primary:hover { opacity:.92; }
  aside .btn { background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.18); color:#fff; } aside .btn.primary { background:var(--camel); border-color:var(--camel); color:#1B2A4A; }
  .tools { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; } #upStatus { font-size:14px; color:var(--soft); }
  .empty { padding:40px 16px; text-align:center; color:var(--soft); }
  .alerts { background:#fff; border-radius:12px; padding:12px 16px; font-size:14px; color:var(--soft); line-height:1.6; box-shadow:0 0 0 1px var(--line); }
  .alerts code { background:#F1F3F7; color:var(--ink); padding:2px 6px; border-radius:6px; font-size:13px; user-select:all; word-break:break-all; }
  .pill { display:inline-block; margin-top:4px; font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:999px; background:#F1F3F7; color:var(--soft); } .pill.sent { background:#E7F6EC; color:var(--good); } .pill.wait { background:#FEF3E2; color:#B45309; } .pill.new { background:var(--navy); color:#fff; }
  /* sections from each module: shown as open cards with a heading */
  .codes { background:#fff; border-radius:16px; padding:16px 18px; margin-bottom:16px; box-shadow:0 0 0 1px var(--line); }
  .codes > summary { list-style:none; cursor:default; font-weight:750; font-size:17px; margin-bottom:8px; pointer-events:none; } .codes > summary::-webkit-details-marker { display:none; }
  .codes > summary .sub { font-weight:500; font-size:13px; }
  .codes .newcode { display:flex; gap:8px; flex-wrap:wrap; margin:6px 0 10px; } .codes input:not([type=checkbox]):not([type=radio]) { flex:1; min-width:180px; padding:10px 14px; border:0; background:#F1F3F7; border-radius:999px; font:inherit; }
  .codes ul { list-style:none; margin:0; padding:0; } .codes li { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 0; border-top:1px solid var(--line); }
  .codes select { padding:8px 12px; border:0; background:#F1F3F7; border-radius:999px; font:inherit; }
  .codes .msg { white-space:pre-wrap; overflow-wrap:anywhere; margin-top:6px; color:var(--ink); }
  /* On phones a row's details take the full width and its buttons wrap underneath (they used to squeeze the text into a
     one-word column beside them). */
  @media (max-width:760px) { .codes li > div:first-child { flex:1 1 100% !important; } .codes li .actions { white-space:normal; display:flex; flex-wrap:wrap; gap:8px; } .codes li .actions .btn { margin:0; } }
  .codes li.isnew { background:#F7F8FC; margin:0 -18px; padding:10px 18px; }
  .codes code { background:#EEF1F6; color:var(--navy); padding:3px 8px; border-radius:6px; font-weight:700; letter-spacing:.04em; user-select:all; } .codes li.new code { background:var(--navy); color:#fff; }
  .news { display:block; background:#FFF6EA; color:#7A4B12; font-weight:650; text-decoration:none; padding:12px 16px; border-radius:12px; margin-bottom:12px; }
  .news.stats { display:flex; justify-content:space-between; align-items:center; gap:10px; background:#fff; color:var(--ink); box-shadow:0 0 0 1px var(--line); border-radius:16px; } .news.stats b { font-size:17px; } .news.stats .open { white-space:nowrap; background:var(--navy); color:#fff; padding:6px 12px; border-radius:999px; font-size:13px; }
  .pane > .banner .news { margin-bottom:12px; }
  @media (max-width: 980px) { .tiles { grid-template-columns:repeat(2,minmax(0,1fr)); } .two { grid-template-columns:1fr; } }
  @media (max-width: 760px) {
    .shell { grid-template-columns:minmax(0,1fr); } main { padding:16px 14px 50px; } .list a { flex-wrap:wrap; } .list a span { white-space:normal; text-align:left; }
    aside { position:sticky; top:0; z-index:5; height:auto; padding:10px 10px 8px; flex-direction:column; }
    aside .brand { padding:2px 4px 8px; } aside .foot { display:none; }
    aside nav { flex-direction:row; overflow-x:auto; gap:6px; scrollbar-width:none; } aside nav::-webkit-scrollbar { display:none; }
    aside nav a { flex:0 0 auto; padding:7px 12px; border-radius:999px; background:rgba(255,255,255,.08); } aside nav a i { display:none; }
    thead { display:none; } tr { display:block; border-bottom:1px solid var(--line); padding:8px 0; } td { display:block; border:none; padding:4px 14px; }
    .mob-foot { display:flex !important; }
  }
  .mob-foot { display:none; gap:8px; flex-wrap:wrap; margin-top:28px; }
</style></head><body><div class="shell">
<aside><div class="brand"><img src="/icons/icon-192.png" alt="" width="28" height="28">DIY Inventory · Admin</div>
<nav>${nav}</nav>
<div class="foot"><a class="btn primary" href="/app">Open the app</a><form method="post" action="/admin/logout"><button class="btn" style="width:100%">Sign out</button></form>
<span>Updated ${esc(STARTED_AT.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}${DEPLOY_NOTE ? ': ' + esc(DEPLOY_NOTE) : ''}</span></div></aside>
<main>
${PERSISTENT ? '' : '<div class="warn">No storage volume is attached, so reports stored here are lost the next time the app is deployed. Attach a volume to this service in Railway.</div>'}
<section class="pane" id="p-overview">
  <div class="top"><div><h1>Overview</h1><p class="lead">What needs you, and how things are going.</p></div></div>
  <div class="tiles">
    <a class="tile" href="#reports"><b>${reports.length}</b><span>reports received</span></a>
    <a class="tile" href="#reports"><b>${thisWeek}</b><span>in the last 7 days</span></a>
    <a class="tile${unpaidN ? ' warn' : ''}" href="#reports"><b>${unpaidN}</b><span>finished, not paid yet</span></a>
    <a class="tile${orphans.length ? ' warn' : ''}" href="#reports"><b>${orphans.length}</b><span>PDF not received yet</span></a>
  </div>
  <h2 class="ph">Needs your attention</h2>
  <div class="list">${attention.length ? attention.join('') : '<div class="none">Nothing waiting for you. ✓</div>'}</div>
  <div class="two"><div><h2 class="ph">Latest reports</h2><div class="list">${latest || '<div class="none">No reports yet.</div>'}</div></div>
  <div><h2 class="ph">Visits and sales</h2>${analytics.summaryHTML(esc)}
  ${NTFY_TOPIC ? `<div class="alerts">📱 Phone alerts: in the <strong>ntfy</strong> app, subscribe to <code>${esc(NTFY_TOPIC)}</code></div>` : ''}
  <h2 class="ph">Email</h2><div class="alerts">${RESEND_API_KEY ? `✉️ On · sending from <code>${esc(REPORT_FROM_EMAIL)}</code>${REPORT_TO_EMAIL ? ' · your copies go to <code>' + esc(REPORT_TO_EMAIL) + '</code>' : ' · <b>REPORT_TO_EMAIL isn’t set</b>, so you don’t get a copy of each report'}` : '✉️ <b>Off</b>: set RESEND_API_KEY in Railway.'}
  ${req.query.mail ? `<p style="margin:8px 0 0;font-weight:600;color:${String(req.query.mail)[0] === '✓' ? '#15803D' : '#B42318'}">${esc(String(req.query.mail).slice(0, 300))}</p>` : ''}
  <form method="post" action="/admin/test-email" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><input name="to" type="email" required placeholder="Send a test email to…" value="${esc(REPORT_TO_EMAIL)}" style="flex:1;min-width:200px;padding:9px 14px;border:0;background:#F1F3F7;border-radius:999px;font:inherit"><button class="btn primary">Send a test email</button></form></div></div></div>
</section>
<section class="pane" id="p-reports">
  <div class="top"><div><h1>Reports</h1><p class="lead">${reports.length} report${reports.length === 1 ? '' : 's'}, newest first.</p></div></div>
  <div class="tools">${reports.length || orphanRows ? `<input type="search" placeholder="Search by address, reference or name" oninput="const q=this.value.toLowerCase();document.querySelectorAll('#p-reports tbody tr').forEach(r=>r.style.display=r.dataset.q.includes(q)?'':'none')">` : ''}
  <a class="btn" href="/admin/opened">👁 Who viewed and downloaded</a>
  <label class="btn">Upload report PDFs<input type="file" accept="application/pdf,.pdf" multiple onchange="uploadPdfs(this)" hidden></label><span id="upStatus"></span></div>
  ${reports.length || orphanRows ? `<div class="card"><table><thead><tr><th>Received</th><th>Property</th><th>Signed by / sent</th><th>Contents</th><th></th></tr></thead><tbody>${orphanRows}${rows}</tbody></table></div>`
      : '<div class="card"><div class="empty">No reports yet. They appear here as soon as a tenant finishes one.</div></div>'}
</section>
${groups.map(g => `<section class="pane" id="p-${g.k}">
  <div class="top"><div><h1>${esc(g.label)}</h1></div></div>
  ${g.secs.map(x => (x.banner ? `<div class="banner">${x.banner}</div>` : '') + x.body).join('')}
</section>`).join('')}
<div class="mob-foot"><a class="btn primary" href="/app">Open the app</a><a class="btn" href="/admin/analytics">Visits and sales</a><form method="post" action="/admin/logout"><button class="btn">Sign out</button></form></div>
</main></div>
<script>
// One section at a time, by the address's #: a section name (#reports, #sales…) or any block inside one (#agents, #purchases…).
(function(){
  const panes = [].slice.call(document.querySelectorAll('.pane')), links = [].slice.call(document.querySelectorAll('aside nav a'));
  function show(h){
    const id = String(h || '').replace(/^#/, '');
    let pane = id && document.getElementById('p-' + id), target = null;
    if (!pane && id) { target = document.getElementById(id); pane = target && target.closest('.pane'); }
    if (!pane) pane = document.getElementById('p-overview');
    panes.forEach(p => { p.hidden = p !== pane; });
    links.forEach(a => a.classList.toggle('on', 'p-' + a.dataset.k === pane.id));
    if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => show(location.hash));
  show(location.hash);
})();

function pickTo(b){ const f = b.closest('form'); f.to.value = b.dataset.e; f.name.value = b.dataset.n || ''; f.querySelectorAll('.kchip').forEach(x => x.classList.toggle('on', x === b)); }
function sendLink(f, id){
  const out = f.querySelector('.mres'), btn = f.querySelector('button'); btn.disabled = true; out.className = 'mres'; out.textContent = 'Sending…';
  fetch('/admin/reports/' + id + '/email', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(new FormData(f)) })
    .then(r => r.json().catch(() => ({})).then(d => { btn.disabled = false; if (d.ok) { out.className = 'mres ok'; out.textContent = '✓ Sent to ' + d.to; f.to.value = ''; f.name.value = ''; } else { out.className = 'mres bad'; out.textContent = d.error || 'It didn’t send.'; } }))
    .catch(() => { btn.disabled = false; out.className = 'mres bad'; out.textContent = 'No connection. Try again.'; });
  return false;
}
function copyLink(btn, url){
  const was = btn.textContent, done = () => { btn.textContent = 'Copied ✓'; setTimeout(() => btn.textContent = was, 2000); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url)); else prompt('Copy this link:', url);
}
// A code just made: open the section and show it.
(function(){ const c = new URLSearchParams(location.search).get('code'), d = document.getElementById('codes');
  if (d && (location.hash === '#codes' || c)) { d.open = true; if (c) location.hash = '#codes'; }
  if (c) document.querySelectorAll('#codes li').forEach(li => { const k = li.querySelector('code'); if (k && k.textContent === c) li.classList.add('new'); });
  if (c) history.replaceState(null, '', '/admin#codes'); })();
// Details come from the app's file names: "Address - Type - Date - Ref.pdf"; anything else keeps its file name.
function metaFromName(name){
  const base = name.replace(/\.pdf$/i, ''), parts = base.split(' - ');
  if (parts.length >= 4) return { address: parts[0].replace(/-/g, ' ').trim(), inspectionType: parts[1].trim(), ref: parts[parts.length - 1].trim(), fileName: name };
  return { address: base, fileName: name };
}
async function uploadPdfs(input){
  const files = Array.from(input.files || []), st = document.getElementById('upStatus');
  let added = 0, dup = 0, failed = [];
  for (const [i, f] of files.entries()){
    st.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
    try {
      const res = await fetch('/admin/upload', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Report-Meta': encodeURIComponent(JSON.stringify(metaFromName(f.name))) }, body: f });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      data.duplicate ? dup++ : added++;
    } catch (e) { failed.push(f.name + ' (' + e.message + ')'); }
  }
  st.textContent = added + ' added' + (dup ? ', ' + dup + ' already here' : '') + (failed.length ? '. Not added: ' + failed.join(', ') : '');
  if (added) setTimeout(() => location.reload(), 900);
}
</script>
</main></body></html>`);
  });

  app.get('/admin/reports/:file', requireAdmin, (req, res) => {
    const id = String(req.params.file).replace(/\.pdf$/, '');
    const meta = ID_RE.test(id) && readMeta(id);
    if (!meta) return res.status(404).type('text/plain').send('Report not found.');
    const name = (meta.fileName || (id + '.pdf')).replace(/[^\w .,()-]/g, '-');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name}"`);
    res.type('application/pdf').sendFile(path.join(REPORTS_DIR, id + '.pdf'));
  });

  // The owner adds a report PDF they already have (for example one finished before reports were stored).
  app.post('/admin/upload', requireAdmin, express.raw({ type: 'application/pdf', limit: MAX_PDF }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Upload from the reports page.' });
    const [status, body] = storeReport(req.body, metaHeader(req), 'uploaded');
    res.status(status).json(body);
  });

  // Remake a report that was made from the online backup with the current builder (clickable photos, index of photographs).
  // The owner edits any report in the app (the owner asked: "allow me to edit the report"): its online backup is opened
  // in the app on the owner's device (/app?ownerEdit=<backup key>), where everything can be changed; finishing replaces
  // the stored report in place (same id, link and payment), as an edit on the phone does.
  app.get('/admin/reports/:id/edit', requireAdmin, (req, res) => {
    const id = String(req.params.id), r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).type('text/plain').send('Report not found.');
    const b = (drafts.all().filter(({ s }) => isBackupOf(s, r)).sort((a, b) => String(b.s._savedAt || '').localeCompare(String(a.s._savedAt || '')))[0] || null);
    if (!b) return res.status(404).type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.5"><h1 style="font-size:20px">This report can’t be edited</h1><p>Its online backup is no longer on the server (backups are kept for 180 days, or it was uploaded as a PDF), so there is nothing to open in the app.</p><p><a href="/admin#reports">Back to reports</a></p></body>');
    res.redirect(302, '/app?ownerEdit=' + b.key);
  });
  app.post('/admin/reports/:id/rebuild', requireAdmin, async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Rebuild from the reports page.');
    const id = String(req.params.id), r = ID_RE.test(id) && readMeta(id);
    if (!r || r.source !== 'backup') return res.status(404).type('text/plain').send('Only a report made from the backup can be rebuilt.');
    try {
      const b = await drafts.rebuild(id);
      if (!b) return res.status(404).type('text/plain').send('Its backup is no longer on the server.');
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.pdf'), b.pdf);
      const now = readMeta(id); now.size = b.pdf.length; now.rebuiltAt = new Date().toISOString(); fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(now, null, 2));
      attachBackupPhotos(id, b.s.photoKey, b.photos, b.photoFile);
      console.log('report rebuilt from its backup: ' + id + ' (' + b.photos.length + ' photos linked)');
      res.redirect(303, '/admin#reports');
    } catch (e) { console.error('rebuild failed: ' + e.message); res.status(500).type('text/plain').send('The rebuild failed: ' + e.message); }
  });
  // The owner emails a report's online link (view and download) to the property owner, or anyone, from /admin.
  // Each email is kept on the report (r.linkEmails) and shown on the row. Never for a report not paid for yet.
  app.post('/admin/reports/:id/email', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Send it from the reports page.' });
    const id = String(req.params.id), r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    if (notPaid(r)) return res.status(409).json({ error: 'This report isn’t paid for yet, so its link doesn’t open. Mark it as complete first.' });
    const b = req.body || {}, to = String(b.to || '').trim().toLowerCase(), name = clip(b.name, 80), note = String(b.note || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 2000);
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!RESEND_API_KEY) return res.status(503).json({ error: 'Email isn’t switched on (RESEND_API_KEY isn’t set).' });
    if (!r.photoKey) { r.photoKey = crypto.randomBytes(16).toString('hex'); keyToId.set(r.photoKey, id); fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2)); }
    const link = (PUBLIC_URL || (req.protocol + '://' + req.get('host'))) + '/report/' + r.photoKey;
    const type = r.inspectionType || 'Inventory';
    const text = [name ? 'Dear ' + name + ',' : 'Hello,', '', note || ('Please find the ' + type.toLowerCase() + ' report for ' + (r.address || 'the property') + ' below.'), '',
      'View and download the report: ' + link, '', 'Property: ' + (r.address || '—'), r.ref ? 'Reference: ' + r.ref : '', r.rooms ? 'Contents: ' + r.rooms + ' rooms, ' + r.photos + ' photos' : '', '',
      'Every photograph in the report is date and time stamped; tap one to see it full size.'].filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    try {
      const resp = await fetch((process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ from: REPORT_FROM_EMAIL, to: [to], subject: type + ' report: ' + (r.address || 'your property'), text }, REPORT_TO_EMAIL ? { reply_to: REPORT_TO_EMAIL } : {})) });
      if (!resp.ok) { const t = (await resp.text().catch(() => '')).slice(0, 300); console.error('report link email failed: HTTP ' + resp.status, t); let m = ''; try { m = JSON.parse(t).message; } catch (e) {} return res.status(502).json({ error: 'The email didn’t go: ' + (m || 'HTTP ' + resp.status) }); }
    } catch (e) { return res.status(502).json({ error: 'The email didn’t go: ' + e.message }); }
    const now = readMeta(id) || r; now.linkEmails = (now.linkEmails || []).concat([{ to, name, at: new Date().toISOString() }]).slice(-50);
    fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(now, null, 2));
    console.log('report link emailed by the owner: ' + id + ' → ' + to);
    res.json({ ok: true, to });
  });
  // The owner (only) makes a copy of a report as another type, e.g. a check-out copied as a check-in: the same rooms,
  // items, conditions and photos from its online backup, a new reference and photo key, built with the app's own
  // design and stored as a separate, paid report. The original is left exactly as it is; nothing is emailed to anyone.
  async function copyAs(id, type){
    const r = ID_RE.test(id) && readMeta(id);
    if (!r) return { error: 'Report not found.', status: 404 };
    if (!COPY_TYPES.includes(type)) return { error: 'Choose the type for the copy.', status: 400 };
    const b = (drafts.all().filter(({ s }) => isBackupOf(s, r)).sort((a, b) => String(b.s._savedAt || '').localeCompare(String(a.s._savedAt || '')))[0] || null);
    if (!b) return { error: 'This report’s online backup is no longer on the server, so it can’t be copied.', status: 404 };
    const s = JSON.parse(JSON.stringify(b.s));
    ['_serverReportId', '_rescueFailed', '_token', '_access', '_startAlerted', 'submittedId', 'unpaidId', 'sentAt', 'editOf', 'editedAt', 'pendingReplace', 'photosUploaded', 'dataUploaded', 'cloudSent'].forEach(k => delete s[k]);
    s.meta = Object.assign({}, s.meta, { inspectionType: type, ref: 'SC-' + crypto.randomBytes(5).toString('hex').slice(0, 7).toUpperCase(), copyEmail: '' });
    if (type === 'Check-In') s.earlier = null;   // a check-in isn't compared with an earlier report
    s.photoKey = crypto.randomBytes(16).toString('hex');
    s.finalizedAt = s.finalizedAt || new Date().toISOString();
    const built = await drafts.buildFor(b.key, s);
    const pr = s.property || {}; let photos = ((pr.exterior || {}).photos || []).length;
    (s.rooms || []).forEach(x => { (x.items || []).forEach(i => { photos += (i.photos || []).length; }); photos += (x.extraPhotos || []).length; });
    const m = s.meta;
    const [status, body] = storeReport(built.pdf, Object.assign({}, m, { finalizedAt: s.finalizedAt, rooms: (s.rooms || []).length, photos, photoKey: s.photoKey,
      basedOnRef: (s.earlier && s.earlier.ref) || '', fileName: [m.address, type, m.date, m.ref].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '-') + '.pdf' }), 'copy', {});
    if (status >= 400 || !body.id) return { error: body.error || 'It could not be saved.', status: 500 };
    attachBackupPhotos(body.id, s.photoKey, built.photos, built.photoFile);
    const c = readMeta(body.id);
    Object.assign(c, { sentAt: new Date().toISOString(), paidWith: 'You (copied from ' + (r.inspectionType || 'report') + ' ' + (r.ref || r.id) + ')', copiedFrom: r.id, copiedFromRef: r.ref || '', copiedFromType: r.inspectionType || '' });
    fs.writeFileSync(path.join(REPORTS_DIR, c.id + '.json'), JSON.stringify(c, null, 2));
    console.log('report copied by the owner: ' + r.id + ' (' + r.inspectionType + ') → ' + c.id + ' (' + type + ', ' + built.design + ' design)');
    return { id: c.id, key: c.photoKey, ref: c.ref, type };
  }
  app.post('/admin/reports/:id/copy', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Copy it from the reports page.');
    const wantsJson = /json/.test(String(req.headers.accept || ''));
    try {
      const out = await copyAs(String(req.params.id), String((req.body || {}).type || ''));
      if (out.error) return wantsJson ? res.status(out.status).json({ error: out.error }) : res.status(out.status).type('text/plain').send(out.error);
      if (wantsJson) return res.json(Object.assign({ ok: true, url: '/report/' + out.key }, out));
      res.redirect(303, '/admin#reports');
    } catch (e) { console.error('report copy failed: ' + e.message); return wantsJson ? res.status(500).json({ error: 'The copy failed: ' + e.message }) : res.status(500).type('text/plain').send('The copy failed: ' + e.message); }
  });
  // The owner marks a report as complete at any time: paid and sent, so its online link and copies work.
  app.post('/admin/reports/:id/complete', requireAdmin, async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Mark it from the reports page.');
    const id = String(req.params.id), r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).type('text/plain').send('Report not found.');
    const now = new Date().toISOString();
    if (r.unpaid) { r.unpaid = false; r.paidAt = now; r.completedByOwner = now; r.paidWith = r.paidWith || 'You (marked complete in admin)'; }
    if (!r.sentAt) r.sentAt = now;
    if (!r.photoKey) { r.photoKey = crypto.randomBytes(16).toString('hex'); keyToId.set(r.photoKey, id); }
    fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2));
    console.log('report marked complete by the owner: ' + id);
    await deliverCopies(r, '').catch(() => {});
    res.redirect(303, '/admin#reports');
  });
  // Who opened a report (/admin/reports/:id/opened), and every report's opens together (/admin/opened).
  const accessRows = (list, withReport) => list.map(x => `<tr><td class="num">${esc(new Date(x.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}</td>${withReport ? `<td><a href="/admin/reports/${esc(x.id)}/opened">${esc(x.address || '—')}</a><div class="sub">${esc(x.ref || '')}</div></td>` : ''}<td><b>${esc(ACCESS_KIND[x.what] || x.what)}</b><div class="sub">${esc(x.who || '')}</div></td><td>${esc(x.device || '')}<div class="sub">${esc([x.place && x.place.city, x.place && x.place.region, x.place && x.place.postcode, x.place && x.place.country].filter(Boolean).join(', ') || 'Location not known')}${x.from ? ' · came from ' + esc(x.from) : ''}</div></td></tr>`).join('');
  const shellPage = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Admin</title><link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<style>body{margin:0;background:#F5F6F9;color:#13203A;font:14.5px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}${SHELL_CSS}main{padding:28px 32px 60px;max-width:1180px}@media(max-width:760px){main{padding:16px 14px 50px}}
h1{font-size:26px;margin:0 0 4px}.lead{color:#5B677C;margin:0 0 18px}.card{background:#fff;border-radius:16px;box-shadow:0 0 0 1px #E6E9F0;overflow:hidden}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:#8A95A8;padding:12px 14px;border-bottom:1px solid #E6E9F0;background:#FAFBFD}td{padding:12px 14px;border-bottom:1px solid #E6E9F0;vertical-align:top}.sub{color:#5B677C;font-size:12.5px;margin-top:2px}.num{white-space:nowrap}a{color:#1B2A4A}.empty{padding:30px;text-align:center;color:#5B677C}
@media(max-width:760px){thead{display:none}tr{display:block;border-bottom:1px solid #E6E9F0;padding:8px 0}td{display:block;border:none;padding:4px 14px}}</style></head>
<body><div class="shell">${shellAside('reports')}<main>${body}</main></div></body></html>`;
  app.get('/admin/reports/:id/opened', requireAdmin, (req, res) => {
    const id = String(req.params.id), r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).type('text/plain').send('Report not found.');
    const L = readAccess(id).slice().reverse();
    res.type('html').send(shellPage('Who opened it', `<p><a href="/admin#reports">‹ Reports</a></p><h1>Who opened it</h1><p class="lead">${esc(r.address || '—')} · ${esc(r.inspectionType || '')} · ${esc(r.ref || '')}. Every view and download of this report, newest first (not your own).</p>
<div class="card">${L.length ? `<table><thead><tr><th>When</th><th>What and who</th><th>Device and where</th></tr></thead><tbody>${accessRows(L, false)}</tbody></table>` : '<div class="empty">Nobody has opened it yet.</div>'}</div>`));
  });
  app.get('/admin/opened', requireAdmin, (req, res) => {
    const all = [];
    for (const r of listReports()) for (const x of readAccess(r.id)) all.push(Object.assign({ id: r.id, address: r.address, ref: r.ref }, x));
    all.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const only = req.query.downloads ? all.filter(x => /download|app_share/.test(x.what)) : all;
    res.type('html').send(shellPage('Views and downloads', `<p><a href="/admin#reports">‹ Reports</a></p><h1>Views and downloads</h1><p class="lead">${req.query.downloads ? 'Every download of a report' : 'Every view and download of every report'}, newest first (not your own). ${req.query.downloads ? '<a href="/admin/opened">Show views too</a>' : '<a href="/admin/opened?downloads=1">Downloads only</a>'}</p>
<div class="card">${only.length ? `<table><thead><tr><th>When</th><th>Report</th><th>What and who</th><th>Device and where</th></tr></thead><tbody>${accessRows(only.slice(0, 1000), true)}</tbody></table>` : '<div class="empty">Nothing yet.</div>'}</div>`));
  });
  // A test email from the admin page, with Resend's own answer shown (domain not verified, wrong key…).
  app.post('/admin/test-email', requireAdmin, express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Send it from the admin page.');
    const to = String((req.body && req.body.to) || '').trim().toLowerCase();
    const back = m => res.redirect(303, '/admin?mail=' + encodeURIComponent(m.slice(0, 300)) + '#overview');
    if (!RESEND_API_KEY) return back('Email is off: RESEND_API_KEY isn’t set in Railway.');
    if (!EMAIL_RE.test(to)) return back('Please enter a valid email address.');
    try {
      const r = await fetch((process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: REPORT_FROM_EMAIL, to: [to], subject: 'DIY Inventory: test email', text: 'This is a test email from your DIY Inventory admin page.\n\nIf you can read this, report copies, receipts and reminders will reach people too.\n\nSent from: ' + REPORT_FROM_EMAIL }) });
      const body = await r.text().catch(() => '');
      if (r.ok) { console.log('test email sent to ' + to); return back('✓ Sent to ' + to + ' from ' + REPORT_FROM_EMAIL + '. Check that inbox (and spam).'); }
      let msg = body; try { msg = JSON.parse(body).message || body; } catch (e) {}
      console.error('test email failed: HTTP ' + r.status + ' ' + msg);
      back('✗ Resend said: ' + msg + ' (HTTP ' + r.status + ')');
    } catch (e) { back('✗ Could not reach Resend: ' + e.message); }
  });
  app.post('/admin/reports/:id/link', requireAdmin, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Make links from the reports page.');
    const id = String(req.params.id), r = ID_RE.test(id) && readMeta(id);
    if (!r) return res.status(404).type('text/plain').send('Report not found.');
    if (!r.photoKey) { r.photoKey = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2)); keyToId.set(r.photoKey, id); }
    res.redirect(303, '/admin#reports');
  });
  app.post('/admin/reports/:id/delete', requireAdmin, (req, res) => {
    const id = String(req.params.id);
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Delete from the reports page.');
    if (!ID_RE.test(id) || !readMeta(id)) return res.status(404).type('text/plain').send('Report not found.');
    for (const ext of ['.pdf', '.json', '.signed.pdf']) { try { fs.unlinkSync(path.join(REPORTS_DIR, id + ext)); } catch (e) {} }
    try { fs.rmSync(photoDir(id), { recursive: true, force: true }); } catch (e) {}
    console.log('report deleted: ' + id);
    res.redirect(303, '/admin');
  });

  console.log(`reports: stored in ${REPORTS_DIR}${PERSISTENT ? '' : ' (NOT persistent: no volume attached)'}, admin ${ADMIN_PASSWORD ? 'enabled' : 'locked (ADMIN_PASSWORD not set)'}`);
}

// May this upload replace a stored report with an edited copy, without paying again? Only the phone that made it
// (same reference, finish time and private photo key), only for a report already paid for.
function editAllowed(m){
  m = m || {};
  if (!m.editedAt || !/^[a-f0-9]{32}$/.test(String(m.photoKey || '')) || !m.finalizedAt) return false;
  const key = crypto.createHash('sha256').update(clip(m.ref, 40) + '|' + clip(m.finalizedAt, 40)).digest('hex').slice(0, 12);
  const r = listReports().find(x => x.key === key);
  return !!(r && r.photoKey === m.photoKey && !(r.unpaid && !r.paidAt));
}

module.exports = { photoFile: (key, n) => shared.photoFile ? shared.photoFile(key, n) : null, mount, editAllowed, deviceName, REPORTS_DIR, isOwner: signedIn, canonicalCode, codeAccess, useCode, codeLogin, saveMessage, clip, clientIp, limiter, notifyOwner, addAdminSection };
