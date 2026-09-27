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
// Email to Residential Realtors when a tenant taps "Send" (via Resend, resend.com). Without
// RESEND_API_KEY the report is still marked as sent and waits on /admin.
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const REPORT_TO_EMAIL = (process.env.REPORT_TO_EMAIL || '').trim() || 'jayk@residentialrealtors.co.uk';
const REPORT_FROM_EMAIL = (process.env.REPORT_FROM_EMAIL || '').trim() || 'Check-in Reports <onboarding@resend.dev>';
const PUBLIC_URL = (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '')).replace(/\/+$/, '');
const MAX_ATTACH = 28 * 1024 * 1024; // Resend allows 40 MB per email after base64; larger PDFs go as a link to /admin

fs.mkdirSync(REPORTS_DIR, { recursive: true });

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

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

function readMeta(id){
  try { return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, id + '.json'), 'utf8')); } catch (e) { return null; }
}
function listReports(){
  return fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json')).map(f => readMeta(f.slice(0, -5))).filter(Boolean)
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

async function emailReport(r){
  if (!RESEND_API_KEY) return { ok: false, reason: 'not-configured' };
  const pdfPath = path.join(REPORTS_DIR, r.id + '.pdf');
  const attach = r.size <= MAX_ATTACH;
  const link = PUBLIC_URL ? PUBLIC_URL + '/admin/reports/' + r.id + '.pdf' : '';
  const text = [
    'A tenant has sent their ' + (r.inspectionType || 'check-in') + ' report.', '',
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

function mount(app){
  /* ---------- tenant side: send a copy of the finished report ---------- */
  // Saves one report PDF with its details. Returns [httpStatus, jsonBody].
  function storeReport(pdf, m, source){
    if (!Buffer.isBuffer(pdf) || pdf.length < 1000 || pdf.slice(0, 5).toString() !== '%PDF-') return [400, { error: 'Expected the report PDF.' }];
    const meta = {
      address: clip(m.address, 200), inspectionType: clip(m.inspectionType, 40), ref: clip(m.ref, 40),
      inspectorName: clip(m.inspectorName, 120), signedBy: clip(m.signedBy, 120), createdAt: clip(m.createdAt, 40),
      finalizedAt: clip(m.finalizedAt, 40), rooms: Math.max(0, Math.min(99, parseInt(m.rooms, 10) || 0)),
      photos: Math.max(0, Math.min(9999, parseInt(m.photos, 10) || 0)), fileName: clip(m.fileName, 200).replace(/[\\/"]/g, '-'),
      source
    };
    // The same report is only ever stored once: by reference + finish time from the app, by file contents when uploaded.
    const basis = meta.finalizedAt ? meta.ref + '|' + meta.finalizedAt : 'file|' + crypto.createHash('sha256').update(pdf).digest('hex');
    const key = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 12);
    const existing = listReports().find(r => r.key === key);
    if (existing) return [200, { id: existing.id, duplicate: true }];

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const id = `${stamp}-${key}`;
    const record = Object.assign({ id, key, size: pdf.length, receivedAt: new Date().toISOString() }, meta);
    try {
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.pdf'), pdf);
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(record, null, 2));
    } catch (err) {
      console.error('report save failed', err);
      return [500, { error: 'The report could not be saved.' }];
    }
    console.log(`report stored (${source}): ${id} (${meta.ref}, ${meta.address}, ${Math.round(pdf.length / 1024)} KB)`);
    return [201, { id }];
  }
  function metaHeader(req){
    try { return JSON.parse(decodeURIComponent(String(req.headers['x-report-meta'] || '%7B%7D'))) || {}; } catch (e) { return {}; }
  }

  /* ---------- tenant side: send a copy of the finished report ---------- */
  app.post('/api/reports', express.raw({ type: 'application/pdf', limit: MAX_PDF }), (req, res) => {
    if (!uploadAllowed(clientIp(req))) return res.status(429).json({ error: 'Too many reports sent from here. Try again later.' });
    const [status, body] = storeReport(req.body, metaHeader(req), 'app');
    res.status(status).json(body);
  });

  // The tenant taps "Send to Residential Realtors": the stored report is marked as sent and emailed.
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

  /* ---------- owner side: /admin, behind ADMIN_PASSWORD ---------- */
  // Sign-in: a form, then a signed cookie that keeps the owner signed in on that device for a year
  // (until they sign out, or ADMIN_PASSWORD changes, which signs every device out).
  const SESSION_DAYS = 365;
  const signingKey = crypto.createHash('sha256').update('diy-admin-session:' + ADMIN_PASSWORD).digest();
  const sign = exp => crypto.createHmac('sha256', signingKey).update('admin:' + exp).digest('hex');
  const makeToken = () => { const exp = Date.now() + SESSION_DAYS * 86400000; return exp + '.' + sign(exp); };
  function signedIn(req){
    if (!ADMIN_PASSWORD) return false;
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)diy_admin=([^;]+)/);
    const [exp, mac] = (m ? decodeURIComponent(m[1]) : '').split('.');
    if (!exp || !mac || !(Number(exp) > Date.now())) return false;
    const a = Buffer.from(mac), b = Buffer.from(sign(exp));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const secure = req => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  function setSession(req, res, token, maxAge){
    // Lax, so links to a report (e.g. from the email) open straight away; changes still need the same origin.
    res.set('Set-Cookie', `diy_admin=${token}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);
  }
  const safeNext = v => (typeof v === 'string' && /^\/admin(\/[\w.\-\/]*)?(\?download=1)?$/.test(v)) ? v : '/admin';
  function loginPage(res, status, next, msg){
    res.status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Reports sign in</title><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
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
    if (signedIn(req)) return next();
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

  app.get('/admin', requireAdmin, (req, res) => {
    const reports = listReports();
    const rows = reports.map(r => `
      <tr data-q="${esc((r.address + ' ' + r.ref + ' ' + r.inspectorName + ' ' + r.inspectionType).toLowerCase())}">
        <td>${esc(new Date(r.receivedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }))}</td>
        <td><strong>${esc(r.address || '—')}</strong><div class="sub">${esc([r.inspectionType, r.ref, r.source === 'uploaded' ? 'added from a PDF' : ''].filter(Boolean).join(' · '))}</div></td>
        <td>${esc(r.signedBy || r.inspectorName || '—')}<div class="sub">${r.source === 'uploaded' ? '' : r.sentAt ? '<span class="pill sent">Sent ' + esc(new Date(r.sentAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })) + (r.emailedAt ? ' · emailed' : '') + '</span>' : '<span class="pill">Not sent by tenant yet</span>'}</div></td>
        <td class="num">${r.rooms ? r.rooms + ' rooms · ' + r.photos + ' photos' : '—'}<div class="sub">${(r.size / 1048576).toFixed(1)} MB</div></td>
        <td class="actions">
          <a class="btn" href="/admin/reports/${r.id}.pdf" target="_blank" rel="noopener">View</a>
          <a class="btn" href="/admin/reports/${r.id}.pdf?download=1">Download</a>
          <form method="post" action="/admin/reports/${r.id}/delete" onsubmit="return confirm('Delete the report for ${esc(String(r.address).replace(/'/g, ''))}? This cannot be undone.')"><button class="btn danger">Delete</button></form>
        </td>
      </tr>`).join('');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Submitted reports</title>
<style>
  :root { --ink:#0F172A; --soft:#475569; --line:#E4E8EF; --bg:#F3F5F9; --accent:#3257C8; --danger:#B42318; }
  * { box-sizing: border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 28px 16px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.02em; } .lead { color: var(--soft); margin: 0 0 18px; }
  .warn { background:#FDF3E1; color:#8A5A16; padding:12px 14px; border-radius:10px; margin-bottom:16px; font-size:14px; }
  input[type=search] { width:100%; max-width:420px; padding:11px 13px; border:1px solid #CDD4DF; border-radius:10px; font-size:15px; margin-bottom:14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:16px; overflow:hidden; box-shadow:0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06); }
  table { width:100%; border-collapse:collapse; } th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:#8A96A8; padding:12px 14px; border-bottom:1px solid var(--line); }
  td { padding:13px 14px; border-bottom:1px solid var(--line); vertical-align:top; } tr:last-child td { border-bottom:none; }
  .sub { color:var(--soft); font-size:12.5px; margin-top:2px; } .num { white-space:nowrap; }
  .actions { white-space:nowrap; } .actions form { display:inline; }
  .btn { display:inline-block; font:inherit; font-size:13px; font-weight:600; padding:7px 11px; border-radius:8px; border:1px solid #CDD4DF; background:#fff; color:var(--ink); text-decoration:none; cursor:pointer; margin:2px 4px 2px 0; }
  .btn:hover { border-color: var(--accent); color: var(--accent); } .btn.danger { color: var(--danger); } .btn.danger:hover { border-color: var(--danger); }
  .upload { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px; } #upStatus { font-size:14px; color:var(--soft); }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; padding:10px 14px; font-size:14px; } .btn.primary:hover { color:#fff; opacity:.92; }
  .empty { padding: 40px 16px; text-align:center; color: var(--soft); }
  .pill { display:inline-block; margin-top:4px; font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:999px; background:#F1F3F7; color:var(--soft); } .pill.sent { background:#E7F6EC; color:#15803D; }
  @media (max-width: 720px) { thead { display:none; } tr { display:block; border-bottom:1px solid var(--line); padding:8px 0; } td { display:block; border:none; padding:4px 14px; } }
</style></head><body><main>
<h1>Submitted reports</h1>
<form method="post" action="/admin/logout" style="float:right;margin-top:4px"><button class="btn">Sign out</button></form>
<p class="lead">${reports.length} report${reports.length === 1 ? '' : 's'}, newest first. Only people with the password can see this page.</p>
<div class="upload"><label class="btn primary">Upload report PDFs<input type="file" accept="application/pdf,.pdf" multiple onchange="uploadPdfs(this)" hidden></label><span id="upStatus"></span></div>
${RESEND_API_KEY ? '' : '<div class="warn">Reports sent by tenants appear here. To also get each one by email, add RESEND_API_KEY (and REPORT_FROM_EMAIL) in Railway → Variables.</div>'}
${PERSISTENT ? '' : '<div class="warn">No storage volume is attached, so reports stored here are lost the next time the app is deployed. Attach a volume to this service in Railway.</div>'}
${reports.length ? `<input type="search" placeholder="Search by address, reference or name" oninput="const q=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.style.display=r.dataset.q.includes(q)?'':'none')">
<div class="card"><table><thead><tr><th>Received</th><th>Property</th><th>Signed by / sent</th><th>Contents</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="card"><div class="empty">No reports yet. They appear here as soon as a tenant finishes one.</div></div>'}
<script>
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
    for (const ext of ['.pdf', '.json']) { try { fs.unlinkSync(path.join(REPORTS_DIR, id + ext)); } catch (e) {} }
    console.log('report deleted: ' + id);
    res.redirect(303, '/admin');
  });

  console.log(`reports: stored in ${REPORTS_DIR}${PERSISTENT ? '' : ' (NOT persistent: no volume attached)'}, admin ${ADMIN_PASSWORD ? 'enabled' : 'locked (ADMIN_PASSWORD not set)'}`);
}

module.exports = { mount };
