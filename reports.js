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

function mount(app){
  /* ---------- tenant side: send a copy of the finished report ---------- */
  app.post('/api/reports', express.raw({ type: 'application/pdf', limit: MAX_PDF }), (req, res) => {
    if (!uploadAllowed(clientIp(req))) return res.status(429).json({ error: 'Too many reports sent from here. Try again later.' });
    const pdf = req.body;
    if (!Buffer.isBuffer(pdf) || pdf.length < 1000 || pdf.slice(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'Expected the report PDF.' });

    let m = {};
    try { m = JSON.parse(decodeURIComponent(String(req.headers['x-report-meta'] || '%7B%7D'))); } catch (e) { m = {}; }
    const meta = {
      address: clip(m.address, 200), inspectionType: clip(m.inspectionType, 40), ref: clip(m.ref, 40),
      inspectorName: clip(m.inspectorName, 120), signedBy: clip(m.signedBy, 120), createdAt: clip(m.createdAt, 40),
      finalizedAt: clip(m.finalizedAt, 40), rooms: Math.max(0, Math.min(99, parseInt(m.rooms, 10) || 0)),
      photos: Math.max(0, Math.min(9999, parseInt(m.photos, 10) || 0)), fileName: clip(m.fileName, 200).replace(/[\\/"]/g, '-')
    };
    // The same finished report (reference + finish time) is only ever stored once.
    const key = crypto.createHash('sha256').update(meta.ref + '|' + meta.finalizedAt).digest('hex').slice(0, 12);
    const existing = listReports().find(r => r.key === key && meta.finalizedAt);
    if (existing) return res.json({ id: existing.id, duplicate: true });

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const id = `${stamp}-${key}`;
    const record = Object.assign({ id, key, size: pdf.length, receivedAt: new Date().toISOString() }, meta);
    try {
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.pdf'), pdf);
      fs.writeFileSync(path.join(REPORTS_DIR, id + '.json'), JSON.stringify(record, null, 2));
    } catch (err) {
      console.error('report save failed', err);
      return res.status(500).json({ error: 'The report could not be saved.' });
    }
    console.log(`report stored: ${id} (${meta.ref}, ${meta.address}, ${Math.round(pdf.length / 1024)} KB)`);
    res.status(201).json({ id });
  });

  /* ---------- owner side: /admin, behind ADMIN_PASSWORD ---------- */
  function requireAdmin(req, res, next){
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (!ADMIN_PASSWORD) return res.status(503).type('text/plain').send('Reports are locked. Set ADMIN_PASSWORD in Railway → Variables to open this page.');
    const ip = clientIp(req);
    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : null;
    const a = crypto.createHash('sha256').update(String(given)).digest(), b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (given !== null && crypto.timingSafeEqual(a, b)) return next();
    if (given !== null && !loginFailures(ip)) return res.status(429).type('text/plain').send('Too many attempts. Try again in 15 minutes.');
    res.set('WWW-Authenticate', 'Basic realm="Check-in reports", charset="UTF-8"');
    res.status(401).type('text/plain').send('Password required.');
  }
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
        <td><strong>${esc(r.address || '—')}</strong><div class="sub">${esc(r.inspectionType)} · ${esc(r.ref)}</div></td>
        <td>${esc(r.signedBy || r.inspectorName || '—')}</td>
        <td class="num">${r.rooms} rooms · ${r.photos} photos<div class="sub">${(r.size / 1048576).toFixed(1)} MB</div></td>
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
  .empty { padding: 40px 16px; text-align:center; color: var(--soft); }
  @media (max-width: 720px) { thead { display:none; } tr { display:block; border-bottom:1px solid var(--line); padding:8px 0; } td { display:block; border:none; padding:4px 14px; } }
</style></head><body><main>
<h1>Submitted reports</h1>
<p class="lead">${reports.length} report${reports.length === 1 ? '' : 's'}, newest first. Only people with the password can see this page.</p>
${PERSISTENT ? '' : '<div class="warn">No storage volume is attached, so reports stored here are lost the next time the app is deployed. Attach a volume to this service in Railway.</div>'}
${reports.length ? `<input type="search" placeholder="Search by address, reference or name" oninput="const q=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.style.display=r.dataset.q.includes(q)?'':'none')">
<div class="card"><table><thead><tr><th>Received</th><th>Property</th><th>Signed by</th><th>Contents</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="card"><div class="empty">No reports yet. They appear here as soon as a tenant finishes one.</div></div>'}
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
