// Submitted reports: each finished report's PDF is sent here and kept on disk, with a small JSON
// file of details beside it. Only the owner can list, open or delete them, at /admin, with the
// password in ADMIN_PASSWORD. On Railway the files live on the attached volume so they survive deploys.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
    const res = await fetch('https://api.resend.com/emails', {
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
      source
    };
    // The same report is only ever stored once: by reference + finish time from the app, by file contents when uploaded.
    const basis = meta.finalizedAt ? meta.ref + '|' + meta.finalizedAt : 'file|' + crypto.createHash('sha256').update(pdf).digest('hex');
    const key = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 12);
    const existing = listReports().find(r => r.key === key);
    if (existing) {
      if (existing.unpaid && !opts.unpaid) {
        existing.unpaid = false; existing.paidAt = new Date().toISOString();
        try { fs.writeFileSync(path.join(REPORTS_DIR, existing.id + '.json'), JSON.stringify(existing, null, 2)); } catch (err) { return [500, { error: 'The report could not be saved.' }]; }
        console.log('report paid for: ' + existing.id);
        return [201, { id: existing.id }];
      }
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
  app.post('/api/reports', express.raw({ type: 'application/pdf', limit: MAX_PDF }), (req, res) => {
    if (!uploadAllowed(clientIp(req))) return res.status(429).json({ error: 'Too many reports sent from here. Try again later.' });
    const unpaid = req.headers['x-report-unpaid'] === '1';
    const [status, body] = storeReport(req.body, metaHeader(req), 'app', { unpaid });
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
      if (!r.emailedAt){
        const mail = await emailReport(r);
        if (mail.ok) r.emailedAt = new Date().toISOString();
        else if (mail.reason === 'send-failed'){ fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2)); return res.status(502).json({ error: "The email didn't go through." }); }
      }
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(r, null, 2));
      console.log('report sent: ' + id + (r.emailedAt ? ' (emailed to ' + REPORT_TO_EMAIL + ')' : ' (email not set up)'));
      res.json({ ok: true, sentAt: r.sentAt, emailed: !!r.emailedAt });
    } finally { sending.delete(id); }
  });

  /* ---------- full-size photos: the PDF shows smaller pictures that link here ---------- */
  // Uploaded after the report, a few at a time, with the report's photo key. A report sent before photo
  // links existed takes the key the first time its photos arrive.
  const photoUploads = limiter(600, 60 * 60 * 1000);
  const keyToId = new Map();
  function findByKey(key){
    const hit = keyToId.get(key);
    if (hit && readMeta(hit)) return hit;
    const r = listReports().find(x => x.photoKey === key);
    if (r) keyToId.set(key, r.id);
    return r ? r.id : null;
  }
  // Online backups of reports while they're being done (drafts.js), listed on /admin.
  const drafts = require('./drafts').mount(app, { REPORTS_DIR, esc, clip, clientIp, limiter, deviceName, notify: notifyOwner, requireAdmin, sameOrigin, PUBLIC_URL });

  // Tenant sign-off links (/sign/<key>), in signoff.js.
  require('./signoff').mount(app, { REPORTS_DIR, photoDir, findByKey, readMeta, esc, clip, clientIp, limiter, deviceName, notify: notifyOwner, PUBLIC_URL });

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
  function photoFor(req){
    const key = String(req.params.key), n = parseInt(req.params.n, 10);
    if (!KEY_RE.test(key) || !(n >= 1 && n <= 5000)) return null;
    if (key === EXAMPLE_KEY){   // the example report on the website: its photos ship with the app
      let idx = {}; try { idx = JSON.parse(fs.readFileSync(path.join(EXAMPLE_DIR, 'index.json'), 'utf8')); } catch (e) {}
      return { id: 'example', n, file: path.join(EXAMPLE_DIR, n + '.jpg'), info: idx[n] || {}, meta: { address: idx.address } };
    }
    const id = findByKey(key);
    if (!id) return null;
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
  const analytics = require('./analytics'); analytics.mountAdmin(app, { esc, requireAdmin });

  // Contact form messages for the admin page; opening the page marks them as seen.
  function messagesHTML(){
    const d = readMessages(), seen = d.seenAt, list = d.list.slice().reverse();
    const isNew = m => !seen || m.at > seen, fresh = list.filter(isNew).length;
    if (list.length) { d.seenAt = new Date().toISOString(); writeMessages(d); }
    const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const rows = list.slice(0, 200).map(m => `<li${isNew(m) ? ' class="isnew"' : ''}><div style="flex:1;min-width:0"><strong>${esc(m.name)}</strong>${isNew(m) ? ' <span class="pill new">New</span>' : ''}${m.topic ? ' <span class="pill">' + esc(m.topic) + '</span>' : ''}
      <div class="sub"><a href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message to DIY Inventory')}">${esc(m.email)}</a>${m.phone ? ' · <a href="tel:' + esc(m.phone.replace(/[^\d+]/g, '')) + '">' + esc(m.phone) + '</a>' : ''} · ${esc(when(m.at))}</div>
      <div class="msg">${esc(m.message)}</div></div>
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
      <input readonly value="${esc(base + a.token + end)}" onclick="this.select()" style="width:100%;margin-top:6px;font:13px monospace"></div>
      <div class="actions"><button class="btn" type="button" onclick="copyLink(this,'${esc(base + a.token + end)}')">Copy link</button><form method="post" action="/admin/agents/${esc(a.id)}/delete" onsubmit="return confirm('Remove the link for ${esc(String(a.name).replace(/'/g, ''))}? It will stop working straight away.')"><button class="btn danger">Remove</button></form></div></li>`).join('');
    return `<details class="codes" id="agents"><summary>🏢 Tenant links: check-in or check-out <span class="sub" style="display:inline">— ${list.length ? list.length + ' link' + (list.length === 1 ? '' : 's') : 'none yet'}</span></summary>
<p class="sub">A link for tenants to do their own check-in or check-out, without paying or typing a code. It opens straight on a new report with Check-In chosen, and they can change it to Check-Out (or an inspection). Make one per estate agent (or landlord) and they can send the same link to every tenant; it keeps working until you remove it, and each report made with it is counted here. The reports arrive here like any other.</p>
<form method="post" action="/admin/agents" class="newcode"><input name="name" required maxlength="80" placeholder="Which agent or landlord is it for? e.g. Smith &amp; Co Lettings" autocomplete="off"><button class="btn primary">Make a link</button></form>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  }
  app.post('/admin/agents', requireAdmin, express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Make links from the reports page.');
    const name = clip(req.body && req.body.name, 80);
    if (!name) return res.status(400).type('text/plain').send('Please say who the link is for.');
    const list = readAgents();
    list.push({ id: crypto.randomBytes(6).toString('hex'), name, token: 'AGT-' + crypto.randomBytes(18).toString('base64url'), createdAt: new Date().toISOString(), uses: 0 });
    writeAgents(list);
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
    const rows = reports.map(r => `
      <tr data-q="${esc((r.address + ' ' + r.ref + ' ' + r.inspectorName + ' ' + r.inspectionType).toLowerCase())}">
        <td>${esc(new Date(r.receivedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}</td>
        <td><strong>${esc(r.address || '—')}</strong><div class="sub">${esc([r.inspectionType, r.ref, r.basedOnRef ? 'compared with ' + r.basedOnRef : '', r.source === 'uploaded' ? 'added from a PDF' : ''].filter(Boolean).join(' · '))}</div></td>
        <td>${esc(r.signedBy || r.inspectorName || '—')}<div class="sub">${r.source === 'uploaded' ? '' : r.sentAt ? '<span class="pill sent">Sent ' + esc(new Date(r.sentAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })) + (r.emailedAt ? ' · emailed' : '') + '</span>' : '<span class="pill">Not sent by tenant yet</span>'}${r.unpaid ? ' <span class="pill wait">Not paid yet</span>' : ''}${r.tenantSignedAt ? ' <span class="pill sent">✍️ Signed by ' + esc(r.tenantSignedBy) + (r.tenantAgree === 'comments' ? ', with comments' : '') + '</span>' : ''}</div></td>
        <td class="num">${r.rooms ? r.rooms + ' rooms · ' + r.photos + ' photos' : '—'}<div class="sub">${(r.size / 1048576).toFixed(1)} MB</div></td>
        <td class="actions">
          <a class="btn" href="/admin/reports/${r.id}.pdf" target="_blank" rel="noopener">View</a>
          <a class="btn" href="/admin/reports/${r.id}.pdf?download=1">Download</a>
          ${r.tenantSignedAt && r.photoKey ? `<a class="btn" href="/sign/${r.photoKey}/signed.pdf" target="_blank" rel="noopener">Signed copy</a>` : ''}
          <form method="post" action="/admin/reports/${r.id}/delete" onsubmit="return confirm('Delete the report for ${esc(String(r.address).replace(/'/g, ''))}? This cannot be undone.')"><button class="btn danger">Delete</button></form>
        </td>
      </tr>`).join('');
    // Reports finished on a phone whose PDF hasn't arrived (not paid, or the upload failed): shown from their backup.
    const have = new Set(reports.map(r => r.key));
    const orphans = drafts.finishedOnly().filter(({ s }) => !have.has(crypto.createHash('sha256').update(clip((s.meta || {}).ref, 40) + '|' + clip(s.finalizedAt, 40)).digest('hex').slice(0, 12)));
    const orphanRows = orphans.map(({ key, s }) => { const m = s.meta || {}; return `
      <tr data-q="${esc(((m.address || '') + ' ' + (m.ref || '') + ' ' + (m.inspectorName || '') + ' ' + (m.inspectionType || '')).toLowerCase())}">
        <td>${esc(new Date(s.finalizedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}</td>
        <td><strong>${esc(m.address || '—')}</strong><div class="sub">${esc([m.inspectionType, m.ref, s._device].filter(Boolean).join(' · '))}</div></td>
        <td>${esc(m.signedBy || m.inspectorName || '—')}<div class="sub"><span class="pill wait">Finished on the phone · PDF not received</span></div></td>
        <td class="num">${(s.rooms || []).length} rooms<div class="sub">from the online backup</div></td>
        <td class="actions"><a class="btn" href="/admin/drafts/${key}" target="_blank" rel="noopener">View</a></td>
      </tr>`; }).join('');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Submitted reports</title><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><meta name="apple-mobile-web-app-title" content="Reports">
<style>
  :root { --ink:#0F172A; --soft:#475569; --line:#E4E8EF; --bg:#F4F5FB; --accent:#4F46E5; --danger:#B42318; }
  * { box-sizing: border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 28px 16px 60px; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -.03em; font-weight: 800; } .lead { color: var(--soft); margin: 0 0 18px; }
  .warn { background:#FDF3E1; color:#8A5A16; padding:12px 14px; border-radius:10px; margin-bottom:16px; font-size:14px; }
  input[type=search] { width:100%; max-width:420px; padding:12px 16px; border:0; background:#fff; box-shadow:0 0 0 1px var(--line); border-radius:999px; font-size:15px; margin-bottom:14px; }
  .card { background:#fff; border:0; border-radius:22px; overflow:hidden; box-shadow:0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06); }
  table { width:100%; border-collapse:collapse; } th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:#8A96A8; padding:12px 14px; border-bottom:1px solid var(--line); }
  td { padding:13px 14px; border-bottom:1px solid var(--line); vertical-align:top; } tr:last-child td { border-bottom:none; }
  .sub { color:var(--soft); font-size:12.5px; margin-top:2px; } .num { white-space:nowrap; }
  .actions { white-space:nowrap; } .actions form { display:inline; }
  .btn { display:inline-block; font:inherit; font-size:13px; font-weight:600; padding:8px 14px; border-radius:999px; border:1px solid #CDD4DF; background:#fff; color:var(--ink); text-decoration:none; cursor:pointer; margin:2px 4px 2px 0; }
  .btn:hover { border-color: var(--accent); color: var(--accent); } .btn.danger { color: var(--danger); } .btn.danger:hover { border-color: var(--danger); }
  .upload { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px; } #upStatus { font-size:14px; color:var(--soft); }
  .btn.primary { background:linear-gradient(135deg,#4F46E5,#7C3AED); border-color:var(--accent); color:#fff; padding:10px 14px; font-size:14px; } .btn.primary:hover { color:#fff; opacity:.92; }
  .empty { padding: 40px 16px; text-align:center; color: var(--soft); }
  .alerts { background:#fff; border:1px solid var(--line); border-radius:12px; padding:10px 14px; margin-bottom:14px; font-size:14px; color:var(--soft); line-height:1.6; }
  .alerts code { background:#F1F3F7; color:var(--ink); padding:2px 6px; border-radius:6px; font-size:13px; user-select:all; word-break:break-all; }
  .pill { display:inline-block; margin-top:4px; font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:999px; background:#F1F3F7; color:var(--soft); } .pill.sent { background:#E7F6EC; color:#15803D; }
  .codes { background:#fff; border-radius:16px; padding:12px 16px; margin-bottom:14px; box-shadow:0 1px 2px rgba(15,23,42,.04); } .codes summary { cursor:pointer; font-weight:700; }
  .codes .newcode { display:flex; gap:8px; flex-wrap:wrap; margin:6px 0 10px; } .codes input { flex:1; min-width:180px; padding:10px 14px; border:0; background:#F1F3F7; border-radius:999px; font:inherit; }
  .codes ul { list-style:none; margin:0; padding:0; } .codes li { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 0; border-top:1px solid var(--line); }
  .news { display:block; background:#EEF0FF; color:#3730A3; font-weight:700; text-decoration:none; padding:12px 16px; border-radius:14px; margin-bottom:12px; }
  .pill.wait { background:#FEF3E2; color:#B45309; }
  .news.stats { display:flex; justify-content:space-between; align-items:center; gap:10px; background:linear-gradient(135deg,#EEF0FF,#F3EEFF); } .news.stats b { font-size:17px; } .news.stats .open { white-space:nowrap; background:#4F46E5; color:#fff; padding:6px 12px; border-radius:999px; font-size:13px; }
  .codes select { padding:8px 12px; border:0; background:#F1F3F7; border-radius:999px; font:inherit; }
  .codes .msg { white-space:pre-wrap; overflow-wrap:anywhere; margin-top:6px; color:var(--ink); }
  .codes li.isnew { background:#F7F7FF; margin:0 -16px; padding:10px 16px; } .pill.new { background:#4F46E5; color:#fff; }
  .codes code { background:#EEF0FF; color:#3730A3; padding:3px 8px; border-radius:6px; font-weight:700; letter-spacing:.04em; user-select:all; } .codes li.new code { background:#4F46E5; color:#fff; }
  @media (max-width: 720px) { thead { display:none; } tr { display:block; border-bottom:1px solid var(--line); padding:8px 0; } td { display:block; border:none; padding:4px 14px; } }
</style></head><body><main>
<h1>Submitted reports</h1>
<form method="post" action="/admin/logout" style="float:right;margin-top:4px"><button class="btn">Sign out</button></form>
<p class="lead">${reports.length} report${reports.length === 1 ? '' : 's'}, newest first. Only people with the password can see this page.</p>
<p class="sub" style="margin:-10px 0 16px">🛠️ Software last updated <strong>${esc(STARTED_AT.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}</strong>${DEPLOY_NOTE ? ': ' + esc(DEPLOY_NOTE) : ''}</p>
<p style="margin:-6px 0 16px"><a class="btn primary" href="/app">Open the app</a> <span class="sub" style="display:inline">You can use DIY Inventory without a paid link while signed in here.</span></p>
${analytics.summaryHTML(esc)}
${certs.adminHTML()}
${adminSections.map(f => { try { return f(req); } catch (e) { console.error('admin section failed:', e.message); return ''; } }).join('')}
${messagesHTML()}
${drafts.draftsHTML()}
${activityHTML()}
${codesHTML(req)}
${agentsHTML(req)}
${NTFY_TOPIC ? `<div class="alerts">📱 Phone alerts: in the <strong>ntfy</strong> app, subscribe to <code>${esc(NTFY_TOPIC)}</code></div>` : ''}
<div class="upload"><label class="btn primary">Upload report PDFs<input type="file" accept="application/pdf,.pdf" multiple onchange="uploadPdfs(this)" hidden></label><span id="upStatus"></span></div>
${PERSISTENT ? '' : '<div class="warn">No storage volume is attached, so reports stored here are lost the next time the app is deployed. Attach a volume to this service in Railway.</div>'}
${reports.length || orphanRows ? `<input type="search" placeholder="Search by address, reference or name" oninput="const q=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.style.display=r.dataset.q.includes(q)?'':'none')">
<div class="card"><table><thead><tr><th>Received</th><th>Property</th><th>Signed by / sent</th><th>Contents</th><th></th></tr></thead><tbody>${orphanRows}${rows}</tbody></table></div>`
      : '<div class="card"><div class="empty">No reports yet. They appear here as soon as a tenant finishes one.</div></div>'}
<script>
function copyLink(btn, url){
  const done = () => { btn.textContent = 'Copied ✓'; setTimeout(() => btn.textContent = 'Copy link', 2000); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url)); else prompt('Copy this link:', url);
}
// A code just made: open the section and show it.
(function(){ const c = new URLSearchParams(location.search).get('code'), d = document.querySelector('.codes');
  if (location.hash === '#codes' || c) d.open = true;
  if (c) document.querySelectorAll('.codes li').forEach(li => { if (li.querySelector('code').textContent === c) li.classList.add('new'); });
  if (c || location.hash) history.replaceState(null, '', '/admin'); })();
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

module.exports = { mount, deviceName, REPORTS_DIR, isOwner: signedIn, canonicalCode, codeAccess, useCode, codeLogin, saveMessage, clip, clientIp, limiter, notifyOwner, addAdminSection };
