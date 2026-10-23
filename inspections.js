// Contractor inspections (mid-term), for the owner only. On /admin the owner fills in the property address, the
// date and who is doing it, and gets a link (/inspect/<token>) to send to a contractor. The contractor opens it on
// a phone and takes as many photos as they like (no minimum, no maximum), with nothing to label: each photo has the
// date and time burned in on the phone, then is uploaded straight away. When they tap Finish, the photos are sorted
// by AI (Claude) into rooms and items with a condition and a note, and a mid-term inspection report is made (PDF,
// pdf-lib) for the owner on /admin. Without ANTHROPIC_API_KEY the report still comes out, with the photos in order.
//
// Stored in REPORTS_DIR/inspections/<id>/: job.json, full/<n>.jpg (up to 1600 px, for viewing), small/<n>.jpg
// (up to 900 px, for the AI and the PDF), report.pdf. The PDF's photos link to /ip/<viewKey>/<n>, which shows the
// full-size photo to anyone with the link (the random key is the access, like the reports' /p/ links).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { PDFDocument, StandardFonts, PDFString, rgb } = require('pdf-lib');

const ROOM_ORDER = ['Front of property', 'Outside', 'Hallway', 'Living room', 'Dining room', 'Kitchen', 'Utility', 'Bedroom', 'Bathroom', 'En-suite', 'WC', 'Landing', 'Stairs', 'Garden', 'Meters', 'Other'];
const CONCERNS = ['none', 'minor', 'action'];
const PRIORITY = ['urgent', 'soon', 'monitor'];
const COND_TEXT = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor' };
const BATCH = 6;

function mount(app, ctx){
  const { REPORTS_DIR, isOwner, notify, clientIp, limiter, addAdminSection, PUBLIC_BASE, ai } = ctx;
  const DIR = path.join(REPORTS_DIR, 'inspections');
  fs.mkdirSync(DIR, { recursive: true });

  /* ------------------------------------------------------------------ storage */
  const ID_RE = /^[a-f0-9]{12}$/, TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
  const jobDir = id => path.join(DIR, id);
  const jobFile = id => path.join(jobDir(id), 'job.json');
  function readJob(id){ if (!ID_RE.test(String(id))) return null; try { return JSON.parse(fs.readFileSync(jobFile(id), 'utf8')); } catch (e) { return null; } }
  function writeJob(j){ const f = jobFile(j.id), tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(j)); fs.renameSync(tmp, f); }
  function allJobs(){ let ids = []; try { ids = fs.readdirSync(DIR).filter(d => ID_RE.test(d)); } catch (e) {} return ids.map(readJob).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  const byToken = t => TOKEN_RE.test(String(t)) ? allJobs().find(j => j.token === t) || null : null;
  const byView = k => TOKEN_RE.test(String(k)) ? allJobs().find(j => j.viewKey === k) || null : null;
  const rand = n => crypto.randomBytes(n).toString('base64url').slice(0, 24);
  const photoPath = (j, size, n) => path.join(jobDir(j.id), size, n + '.jpg');

  /* ------------------------------------------------------------------ helpers */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const line = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s)) ? s : '';
  const fmtDate = s => s ? new Date(s + (s.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : '';
  const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '';
  const base = req => PUBLIC_BASE || (req.protocol + '://' + req.headers.host);
  const linkFor = (req, j) => base(req) + '/inspect/' + j.token;
  function sameOrigin(req){ const o = req.headers.origin || req.headers.referer || ''; try { return new URL(o).host === req.headers.host; } catch (e) { return false; } }
  const NOSTORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' };
  const owner = (req, res) => { res.set(NOSTORE); if (isOwner(req)) return true; res.redirect(303, '/admin'); return false; };
  const statusText = j => ({ open: j.photos.length ? 'In progress · ' + j.photos.length + ' photo' + (j.photos.length === 1 ? '' : 's') : 'Link sent, not started', submitted: 'Sent by the inspector, sorting photos…', processing: 'Sorting photos and writing the report…', ready: 'Report ready', failed: 'Sorting failed' })[j.status] || j.status;
  const jpeg = buf => Buffer.isBuffer(buf) && buf.length > 100 && buf[0] === 0xFF && buf[1] === 0xD8;
  const fromDataUrl = s => { const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(s || '')); return m ? Buffer.from(m[1], 'base64') : null; };

  /* ------------------------------------------------------------------ owner: create, view, manage */
  const urlenc = express.urlencoded({ extended: false, limit: '16kb' });
  app.post('/admin/inspections', urlenc, (req, res) => {
    if (!owner(req, res)) return;
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Create inspections from the admin page.');
    const b = req.body || {}, address = line(b.address, 200), date = validDate(b.date), inspector = line(b.inspector, 100);
    if (!address) return res.status(400).type('text/plain').send('Please enter the property address.');
    const j = { id: crypto.randomBytes(6).toString('hex'), token: rand(18), viewKey: rand(18), address, date, inspector, createdAt: new Date().toISOString(), status: 'open', photos: [], seq: 0, notes: '' };
    fs.mkdirSync(path.join(jobDir(j.id), 'full'), { recursive: true }); fs.mkdirSync(path.join(jobDir(j.id), 'small'), { recursive: true });
    writeJob(j);
    res.redirect(303, '/admin/inspections/' + j.id + '?new=1');
  });

  app.get('/admin/inspections/:id', (req, res) => {
    if (!owner(req, res)) return;
    const j = readJob(req.params.id); if (!j) return res.status(404).type('text/plain').send('Inspection not found.');
    const link = linkFor(req, j), msg = `Hi${j.inspector ? ' ' + j.inspector.split(' ')[0] : ''}, here is the link for the mid-term inspection at ${j.address}${j.date ? ' on ' + fmtDate(j.date) : ''}. Open it on your phone and take photos of everything; no need to label them: ${link}`;
    const rooms = groupRooms(j);
    const gallery = j.status === 'ready' ? rooms.map(r => `<h3>${esc(r.name)} <small>${r.photos.length} photo${r.photos.length === 1 ? '' : 's'}</small></h3><div class="grid">${r.photos.map(p => `<figure><a href="/admin/inspections/${j.id}/photo/${p.n}?full=1" target="_blank"><img loading="lazy" src="/admin/inspections/${j.id}/photo/${p.n}" alt=""></a><figcaption><b>${p.n}. ${esc(p.ai && p.ai.item || 'Photo')}</b>${p.ai && p.ai.condition ? ` <span class="pill c-${esc(p.ai.condition)}">${esc(COND_TEXT[p.ai.condition])}</span>` : ''}${p.ai && p.ai.concern === 'action' ? ' <span class="pill c-poor">Action</span>' : ''}<br>${esc(p.ai && p.ai.observation || '')}</figcaption></figure>`).join('')}</div>`).join('')
      : j.photos.length ? `<div class="grid">${j.photos.map(p => `<figure><a href="/admin/inspections/${j.id}/photo/${p.n}?full=1" target="_blank"><img loading="lazy" src="/admin/inspections/${j.id}/photo/${p.n}" alt=""></a><figcaption>${p.n}. ${esc(fmtTime(p.takenAt))}</figcaption></figure>`).join('')}</div>` : '<p class="sub">No photos yet.</p>';
    const actions = j.summary && j.summary.actions && j.summary.actions.length ? '<h2>Things to look at</h2><ul class="acts">' + j.summary.actions.map(a => `<li><span class="pill p-${esc(a.priority)}">${esc(a.priority === 'urgent' ? 'Urgent' : a.priority === 'soon' ? 'Soon' : 'Keep an eye on')}</span> <b>${esc(a.room)}${a.item ? ' · ' + esc(a.item) : ''}</b>: ${esc(a.text)}</li>`).join('') + '</ul>' : '';
    const post = (act, label, cls, confirm) => `<form method="post" action="/admin/inspections/${j.id}/${act}"${confirm ? ` onsubmit="return confirm('${confirm}')"` : ''}><button class="btn ${cls || ''}">${label}</button></form>`;
    res.type('html').send(shell(`Inspection · ${j.address}`, `
<a class="back" href="/admin#inspections">← Back to the admin page</a>
<p class="kicker">Mid-term inspection</p><h1>${esc(j.address)}</h1>
<p class="sub">${j.date ? esc(fmtDate(j.date)) + ' · ' : ''}${j.inspector ? 'Inspector: ' + esc(j.inspector) + ' · ' : ''}<b>${esc(statusText(j))}</b>${j.submittedAt ? ' · sent ' + esc(fmtTime(j.submittedAt)) : ''}</p>
${req.query.new && j.status === 'open' && !j.photos.length ? '<p class="ok">Link created. Send it to the inspector.</p>' : ''}
<div class="card"><h2>Link for the inspector</h2>
<div class="copy"><input id="lnk" readonly value="${esc(link)}" onclick="this.select()"><button class="btn primary" type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('lnk').value).then(()=>{this.textContent='Copied ✓'})">Copy</button></div>
<div class="row"><a class="btn" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="sms:?&body=${encodeURIComponent(msg)}">Text message</a><a class="btn" href="mailto:?subject=${encodeURIComponent('Mid-term inspection: ' + j.address)}&body=${encodeURIComponent(msg)}">Email</a><a class="btn" href="/inspect/${esc(j.token)}" target="_blank">Open the link</a></div>
${j.status !== 'open' ? '<p class="sub">The inspector has finished, so the link now only shows a thank-you page. Reopen it to let them add more photos.</p>' : ''}</div>
${j.status === 'ready' ? `<div class="row"><a class="btn primary" href="/admin/inspections/${j.id}/report.pdf" target="_blank">📄 View the report (PDF)</a><a class="btn" href="/admin/inspections/${j.id}/report.pdf?download=1">Download</a></div>` : ''}
${j.status === 'failed' ? `<p class="err">${esc(j.error || 'The photos could not be sorted.')} Try “Sort the photos again”.</p>` : ''}
${['submitted', 'processing'].includes(j.status) ? '<p class="ok">Sorting the photos and writing the report. This page refreshes by itself.</p><meta http-equiv="refresh" content="8">' : ''}
${j.summary && j.summary.overview ? '<h2>Summary</h2><p>' + esc(j.summary.overview) + '</p>' : ''}${j.notes ? '<h2>Inspector’s notes</h2><p class="pre">' + esc(j.notes) + '</p>' : ''}
${actions}
<h2>Photos</h2>${gallery}
<div class="row" style="margin-top:28px">${j.photos.length && !['submitted', 'processing'].includes(j.status) ? post('process', j.status === 'ready' ? 'Sort the photos again' : 'Sort the photos and make the report now', '', j.status === 'ready' ? 'Sort every photo again and remake the report?' : '') : ''}${j.status !== 'open' ? post('reopen', 'Reopen the link') : ''}${post('delete', 'Delete', 'danger', 'Delete this inspection with all its photos? This cannot be undone.')}</div>`));
  });

  app.get('/admin/inspections/:id/photo/:n', (req, res) => {
    if (!owner(req, res)) return;
    const j = readJob(req.params.id), n = parseInt(req.params.n, 10);
    if (!j || !j.photos.some(p => p.n === n)) return res.status(404).end();
    res.type('jpeg').sendFile(photoPath(j, req.query.full ? 'full' : 'small', n), err => { if (err && !res.headersSent) res.status(404).end(); });
  });
  app.get('/admin/inspections/:id/report.pdf', (req, res) => {
    if (!owner(req, res)) return;
    const j = readJob(req.params.id); if (!j || j.status !== 'ready') return res.status(404).type('text/plain').send('The report is not ready yet.');
    const name = ('Inspection - ' + j.address + (j.date ? ' - ' + j.date : '')).replace(/[^\w ,.'()-]+/g, ' ').slice(0, 150) + '.pdf';
    res.set('Content-Disposition', (req.query.download ? 'attachment' : 'inline') + '; filename="' + name + '"');
    res.type('pdf').sendFile(path.join(jobDir(j.id), 'report.pdf'), err => { if (err && !res.headersSent) res.status(404).type('text/plain').send('The report is not ready yet.'); });
  });
  app.post('/admin/inspections/:id/:act', urlenc, (req, res) => {
    if (!owner(req, res)) return;
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Use the admin page.');
    const j = readJob(req.params.id); if (!j) return res.status(404).type('text/plain').send('Inspection not found.');
    const act = req.params.act;
    if (act === 'delete') { fs.rmSync(jobDir(j.id), { recursive: true, force: true }); return res.redirect(303, '/admin#inspections'); }
    if (act === 'reopen') { j.status = 'open'; writeJob(j); }
    else if (act === 'process' && j.photos.length && !['submitted', 'processing'].includes(j.status)) { j.status = 'submitted'; j.submittedAt = j.submittedAt || new Date().toISOString(); writeJob(j); queue(j.id); }
    res.redirect(303, '/admin/inspections/' + j.id);
  });

  addAdminSection(() => {
    const jobs = allJobs(), today = new Date().toISOString().slice(0, 10);
    const rows = jobs.slice(0, 200).map(j => `<li><div style="flex:1;min-width:0"><strong><a href="/admin/inspections/${j.id}">${esc(j.address)}</a></strong> <span class="pill${j.status === 'ready' ? '' : ' wait'}">${esc(statusText(j))}</span>
      <div class="sub">${j.date ? esc(fmtDate(j.date)) + ' · ' : ''}${j.inspector ? esc(j.inspector) + ' · ' : ''}created ${esc(fmtTime(j.createdAt))}</div></div>
      <div class="actions"><a class="btn" href="/admin/inspections/${j.id}">Open</a>${j.status === 'ready' ? `<a class="btn" href="/admin/inspections/${j.id}/report.pdf" target="_blank">Report</a>` : ''}</div></li>`).join('');
    const ready = jobs.filter(j => j.status === 'ready').length;
    return `<details class="codes" id="inspections"><summary>🔧 Contractor inspections <span class="sub" style="display:inline">— ${jobs.length ? jobs.length + ' (' + ready + ' report' + (ready === 1 ? '' : 's') + ' ready)' : 'none yet'}</span></summary>
<p class="sub" style="margin-top:12px">Send a contractor a link to do a mid-term inspection for you. They take photos of everything on their phone, with nothing to label; the photos are sorted into rooms automatically and you get a report here.</p>
<form method="post" action="/admin/inspections" class="insp-new" style="display:grid;gap:10px;max-width:560px;margin:14px 0">
<label>Property address<br><input name="address" required maxlength="200" placeholder="e.g. Flat 2, 14 Albion Road, London SW1A 1AA" style="width:100%"></label>
<label>Date of the inspection<br><input name="date" type="date" value="${today}"></label>
<label>Who is doing it<br><input name="inspector" maxlength="100" placeholder="e.g. Dave Smith, DS Maintenance" style="width:100%"></label>
<div><button class="btn primary">Create the link</button></div></form>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  });

  /* ------------------------------------------------------------------ the inspector's page */
  const upLimit = limiter(3000, 60 * 60 * 1000), pageLimit = limiter(300, 60 * 60 * 1000);
  app.get('/inspect/:token', (req, res) => {
    res.set(NOSTORE);
    if (!pageLimit(clientIp(req))) return res.status(429).type('text/plain').send('Too many requests. Try again later.');
    const j = byToken(req.params.token);
    if (!j) return res.status(404).type('html').send(shell('Link not found', '<h1>This link isn’t valid</h1><p>Please check you have the whole link, or ask for a new one.</p>', true));
    if (j.status !== 'open') return res.type('html').send(shell('Inspection sent', `<p class="kicker">Mid-term inspection</p><h1>Thank you</h1><p>The inspection of <b>${esc(j.address)}</b> has been sent, with ${j.photos.length} photo${j.photos.length === 1 ? '' : 's'}. You can close this page.</p>`, true));
    res.type('html').send(shell('Mid-term inspection · ' + j.address, inspectorPage(j), true));
  });
  app.post('/inspect/:token/photo', (req, res) => {
    res.set(NOSTORE);
    if (!upLimit(clientIp(req))) return res.status(429).json({ error: 'Too many photos at once. Wait a moment.' });
    const j = byToken(req.params.token);
    if (!j) return res.status(404).json({ error: 'This link isn’t valid.' });
    if (j.status !== 'open') return res.status(409).json({ error: 'This inspection has already been sent.' });
    const b = req.body || {}, full = fromDataUrl(b.full), small = fromDataUrl(b.small);
    if (!jpeg(full) || !jpeg(small) || full.length > 6e6 || small.length > 2e6) return res.status(400).json({ error: 'That photo could not be read.' });
    const id = line(b.id, 40);
    const dup = id && j.photos.find(p => p.cid === id); if (dup) return res.json({ ok: true, n: dup.n });
    // Numbered in the order they arrive; the AI sorts by the time they were taken.
    const fresh = readJob(j.id); const n = (fresh.seq || 0) + 1;
    fs.writeFileSync(photoPath(fresh, 'full', n), full); fs.writeFileSync(photoPath(fresh, 'small', n), small);
    const taken = Date.parse(b.takenAt); fresh.seq = n;
    fresh.photos.push({ n, cid: id, takenAt: new Date(isFinite(taken) && Math.abs(taken - Date.now()) < 400 * 864e5 ? taken : Date.now()).toISOString(), uploadedAt: new Date().toISOString() });
    if (!fresh.startedAt) fresh.startedAt = new Date().toISOString();
    writeJob(fresh);
    res.json({ ok: true, n });
  });
  app.post('/inspect/:token/photo/:n/delete', (req, res) => {
    res.set(NOSTORE);
    const j = byToken(req.params.token), n = parseInt(req.params.n, 10);
    if (!j || j.status !== 'open') return res.status(409).json({ error: 'This inspection has already been sent.' });
    j.photos = j.photos.filter(p => p.n !== n); writeJob(j);
    ['full', 'small'].forEach(s => fs.rm(photoPath(j, s, n), () => {}));
    res.json({ ok: true });
  });
  app.get('/inspect/:token/thumb/:n', (req, res) => {
    const j = byToken(req.params.token), n = parseInt(req.params.n, 10);
    if (!j || !j.photos.some(p => p.n === n)) return res.status(404).end();
    res.set({ 'Cache-Control': 'private, max-age=86400' }).type('jpeg').sendFile(photoPath(j, 'small', n), err => { if (err && !res.headersSent) res.status(404).end(); });
  });
  app.post('/inspect/:token/finish', (req, res) => {
    res.set(NOSTORE);
    const j = byToken(req.params.token);
    if (!j) return res.status(404).json({ error: 'This link isn’t valid.' });
    if (j.status !== 'open') return res.json({ ok: true });
    if (!j.photos.length) return res.status(400).json({ error: 'Please take at least one photo first.' });
    const b = req.body || {};
    j.notes = String(b.notes || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, 3000);
    j.status = 'submitted'; j.submittedAt = new Date().toISOString(); writeJob(j);
    notify({ title: 'Inspection photos received', message: j.address + ' · ' + j.photos.length + ' photos' + (j.inspector ? ' · ' + j.inspector : ''), tags: ['camera'], click: PUBLIC_BASE ? PUBLIC_BASE + '/admin/inspections/' + j.id : '' });
    queue(j.id);
    res.json({ ok: true });
  });

  // Full-size photos linked from the PDF.
  app.get('/ip/:key/:n', (req, res) => {
    const j = byView(req.params.key), m = /^(\d+)(\.jpg)?$/.exec(req.params.n), n = m ? parseInt(m[1], 10) : 0, p = j && j.photos.find(x => x.n === n);
    res.set({ 'X-Robots-Tag': 'noindex, nofollow' });
    if (!p) return res.status(404).type('text/plain').send('Photo not found.');
    if (m[2]) return res.set('Cache-Control', 'private, max-age=86400').type('jpeg').sendFile(photoPath(j, 'full', n), err => { if (err && !res.headersSent) res.status(404).end(); });
    res.type('html').send(shell('Photo ' + n, `<p class="kicker">${esc(j.address)}</p><h1>${n}. ${esc((p.ai && p.ai.room ? p.ai.room + ' · ' : '') + (p.ai && p.ai.item || 'Photo'))}</h1><p class="sub">Taken ${esc(fmtTime(p.takenAt))}</p><img src="/ip/${esc(j.viewKey)}/${n}.jpg" alt="" style="width:100%;height:auto;border-radius:12px">${p.ai && p.ai.observation ? '<p>' + esc(p.ai.observation) + '</p>' : ''}`, true));
  });

  /* ------------------------------------------------------------------ sorting with AI, then the PDF */
  const pending = []; let running = false;
  function queue(id){ if (!pending.includes(id)) pending.push(id); if (!running) next(); }
  async function next(){
    const id = pending.shift(); if (!id) { running = false; return; }
    running = true;
    try { await processJob(id); } catch (e) { console.error('inspection ' + id + ' failed:', e && e.message); const j = readJob(id); if (j) { j.status = 'failed'; j.error = 'The photos could not be sorted (' + String(e && e.message || e).slice(0, 120) + ').'; writeJob(j); } }
    next();
  }
  // Picks up any inspection that was being sorted when the server restarted.
  setTimeout(() => allJobs().filter(j => ['submitted', 'processing'].includes(j.status)).forEach(j => queue(j.id)), 5000);

  async function processJob(id){
    let j = readJob(id); if (!j) return;
    j.status = 'processing'; j.error = ''; writeJob(j);
    const photos = j.photos.slice().sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.n - b.n);
    const tags = new Map();
    if (ai && ai.client) {
      let rooms = [], last = '';
      for (let i = 0; i < photos.length; i += BATCH) {
        const batch = photos.slice(i, i + BATCH);
        const out = await withRetry(() => classify(j, batch, rooms, last));
        batch.forEach((p, k) => {
          const r = (out && out[k]) || {};
          const t = { room: line(r.room, 40) || last || 'Other', item: line(r.item, 60) || 'General view', condition: COND_TEXT[r.condition] ? r.condition : '', observation: line(r.observation, 400),
            defects: Array.isArray(r.defects) ? r.defects.filter(d => ai.DEFECTS.includes(d)).slice(0, 6) : [], cleanliness: ai.CLEANLINESS.includes(r.cleanliness) ? r.cleanliness : '',
            concern: CONCERNS.includes(r.concern) ? r.concern : 'none', concernText: line(r.concern_text, 300) };
          tags.set(p.n, t); last = t.room; if (!rooms.includes(t.room)) rooms.push(t.room);
        });
      }
    }
    j = readJob(id); if (!j) return;
    j.photos.forEach(p => { p.ai = tags.get(p.n) || null; });
    j.summary = ai && ai.client ? await withRetry(() => summarise(j)).catch(e => { console.error('inspection summary failed:', e.message); return null; }) : null;
    j.rooms = groupRooms(j).map(r => r.name);
    const pdf = await buildPdf(j);
    fs.writeFileSync(path.join(jobDir(j.id), 'report.pdf'), pdf);
    j.status = 'ready'; j.readyAt = new Date().toISOString(); j.model = ai && ai.client ? ai.model : ''; writeJob(j);
    notify({ title: 'Inspection report ready', message: j.address + ' · ' + j.photos.length + ' photos' + (j.summary && j.summary.actions && j.summary.actions.length ? ' · ' + j.summary.actions.length + ' thing(s) to look at' : ''), tags: ['clipboard'], click: PUBLIC_BASE ? PUBLIC_BASE + '/admin/inspections/' + j.id : '' });
  }
  async function withRetry(fn){
    for (let k = 0; ; k++) {
      try { return await fn(); }
      catch (e) {
        const retry = ai.Anthropic && (e instanceof ai.Anthropic.RateLimitError || e instanceof ai.Anthropic.InternalServerError || e instanceof ai.Anthropic.APIConnectionError);
        if (!retry || k >= 4) throw e;
        await new Promise(r => setTimeout(r, 4000 * (k + 1)));
      }
    }
  }
  async function ask(content, system){
    const response = await ai.client.beta.messages.create({ model: ai.model, max_tokens: 16000, ...ai.extra, system, messages: [{ role: 'user', content }] });
    if (response.stop_reason === 'refusal') return null;
    return ai.extractJson(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  }
  const SORT_SYSTEM = `You sort the photos of a UK residential property inspection (a mid-term inspection while a tenant lives there). A contractor walked through the property taking photos in order, without labelling them. For each photo decide which room it shows and what it shows, and assess its condition as a property inventory clerk would.
Rooms: use plain names such as ${ROOM_ORDER.filter(r => r !== 'Bedroom').join(', ')}, and Bedroom 1, Bedroom 2… (number bedrooms in the order they are first seen; a photo of the same bedroom as before keeps its number: match decor, flooring and furniture). Photos are in the order taken, so a photo is usually in the same room as the one before unless it clearly shows a different room. Meters, fuse boards and boilers go in the room they are in if it is clear, otherwise "Meters".
Item: what the photo is of, e.g. "Oven", "Kitchen sink and taps", "Window", "Carpet", "Walls", "Ceiling", "Door", "Radiator", "Smoke alarm", "Toilet", "Shower", "Bath", "Garden fence", "General view".
Condition: new, good, fair or poor. Observation: one or two factual sentences of what can be seen (marks, damage, cleanliness, damp or mould, anything not working), without guessing what can't be seen.
Defects: any of ${ai ? ai.DEFECTS.join(', ') : ''}, or [] for none. Cleanliness: clean, needs (needs a clean) or dirty.
Concern: "none", "minor" (worth noting) or "action" (the landlord should do something: damp or mould, leaks, damage, safety such as a missing smoke alarm or exposed wiring, signs of a tenancy breach); concern_text says what, briefly.
Reply with JSON only: {"photos":[{"i":1,"room":"…","item":"…","condition":"good","observation":"…","defects":[],"cleanliness":"clean","concern":"none","concern_text":""}, …]} with one entry per photo, in the order given.`;
  async function classify(j, batch, rooms, last){
    const content = [];
    batch.forEach((p, k) => {
      content.push({ type: 'text', text: 'Photo ' + (k + 1) + ' (taken ' + fmtTime(p.takenAt) + '):' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(photoPath(j, 'small', p.n)).toString('base64') } });
    });
    content.push({ type: 'text', text: `Property: ${j.address}\nRooms seen so far: ${rooms.length ? rooms.join(', ') : 'none yet (this is the start of the walk-through)'}\nThe photo just before these was in: ${last || 'none'}\nSort these ${batch.length} photos.` });
    const out = await ask(content, SORT_SYSTEM);
    const list = out && Array.isArray(out.photos) ? out.photos : [];
    return batch.map((p, k) => list.find(x => Number(x.i) === k + 1) || list[k] || null);
  }
  async function summarise(j){
    const lines = groupRooms(j).map(r => r.name + ':\n' + r.photos.map(p => `- ${p.ai.item}: ${p.ai.condition || '?'}; ${p.ai.observation}${p.ai.concern !== 'none' ? ' [' + p.ai.concern + ': ' + p.ai.concernText + ']' : ''}`).join('\n')).join('\n\n');
    const out = await ask([{ type: 'text', text: `Mid-term inspection of ${j.address}${j.date ? ' on ' + fmtDate(j.date) : ''}.${j.notes ? '\nThe inspector’s notes: ' + j.notes : ''}\n\nWhat each photo shows:\n${lines}` }],
      'You write the summary of a UK residential mid-term inspection for the landlord, from the photo notes given. Be factual and brief; plain British English; no legal advice. Reply with JSON only: {"overview":"3 to 5 sentences: overall condition and cleanliness, how the tenant is looking after the property, and the main issues","actions":[{"room":"…","item":"…","text":"what to do, one sentence","priority":"urgent|soon|monitor"}]}. Actions only for things the landlord should do or watch (damp, mould, leaks, damage, safety, breaches); [] if none. Urgent = safety or causing damage now.');
    if (!out) return null;
    return { overview: line(out.overview, 1500), actions: (Array.isArray(out.actions) ? out.actions : []).slice(0, 30).map(a => ({ room: line(a.room, 40), item: line(a.item, 60), text: line(a.text, 300), priority: PRIORITY.includes(a.priority) ? a.priority : 'monitor' })).filter(a => a.text) };
  }
  function groupRooms(j){
    const ordered = j.photos.slice().sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.n - b.n), map = new Map();
    ordered.forEach(p => { const name = p.ai && p.ai.room || 'Photos'; if (!map.has(name)) map.set(name, []); map.get(name).push(p); });
    const rank = name => { const k = ROOM_ORDER.findIndex(r => name.toLowerCase().startsWith(r.toLowerCase())); return k < 0 ? ROOM_ORDER.length - 1 : k; };
    return [...map.entries()].map(([name, photos], i) => ({ name, photos, i })).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'en', { numeric: true }) || a.i - b.i);
  }

  /* ------------------------------------------------------------------ the PDF (A4 landscape) */
  async function buildPdf(j){
    const doc = await PDFDocument.create();
    doc.setTitle('Inspection – ' + j.address); doc.setAuthor('DIY Inventory'); doc.setCreator('DIY Inventory');
    const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold), T = await doc.embedFont(StandardFonts.TimesRomanBold);
    const W = 841.89, H = 595.28, M = 36, c = a => rgb(a[0] / 255, a[1] / 255, a[2] / 255);
    const C = { ink: c([19, 33, 58]), navy: c([27, 46, 75]), soft: c([90, 100, 117]), line: c([228, 217, 198]), paper: c([245, 239, 228]), camel: c([196, 154, 108]), white: rgb(1, 1, 1) };
    const COND = { new: c([46, 125, 90]), good: c([60, 140, 80]), fair: c([200, 140, 40]), poor: c([190, 60, 50]) };
    const PRI = { urgent: c([190, 60, 50]), soon: c([200, 140, 40]), monitor: c([90, 100, 117]) };
    // Helvetica in pdf-lib only has WinAnsi characters.
    const safe = s => String(s == null ? '' : s).normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    const wrap = (text, font, size, width, max) => {
      const words = safe(text).split(/\s+/).filter(Boolean), out = []; let cur = '';
      for (const w of words) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) <= width) cur = t; else { if (cur) out.push(cur); cur = w; } }
      if (cur) out.push(cur);
      if (max && out.length > max) { const keep = out.slice(0, max); let l = keep[max - 1]; while (l && font.widthOfTextAtSize(l + '...', size) > width) l = l.slice(0, -1); keep[max - 1] = l + '...'; return keep; }
      return out;
    };
    const text = (pg, s, x, y, font, size, color) => pg.drawText(safe(s), { x, y, font, size, color: color || C.ink });
    const pages = [];
    const newPage = () => { const pg = doc.addPage([W, H]); pg.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.white }); pages.push(pg); return pg; };
    const imgCache = new Map();
    const img = async n => { if (!imgCache.has(n)) { try { imgCache.set(n, await doc.embedJpg(fs.readFileSync(photoPath(j, 'small', n)))); } catch (e) { imgCache.set(n, null); } } return imgCache.get(n); };
    const link = (pg, n, x, y, w, h) => {
      const url = (PUBLIC_BASE || '') + '/ip/' + j.viewKey + '/' + n; if (!PUBLIC_BASE) return;
      pg.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } })));
    };
    const fitted = async (pg, n, x, y, w, h) => {
      const im = await img(n); pg.drawRectangle({ x, y, width: w, height: h, color: C.paper });
      if (!im) return;
      const s = Math.min(w / im.width, h / im.height), dw = im.width * s, dh = im.height * s;
      pg.drawImage(im, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh }); link(pg, n, x, y, w, h);
    };
    const pill = (pg, label, x, y, color) => { const w = B.widthOfTextAtSize(safe(label), 7.5) + 10; pg.drawRectangle({ x, y: y - 3, width: w, height: 12, color }); text(pg, label, x + 5, y, B, 7.5, C.white); return w; };
    const rooms = groupRooms(j), photos = rooms.flatMap(r => r.photos);
    const counts = { new: 0, good: 0, fair: 0, poor: 0 }; photos.forEach(p => { if (p.ai && counts[p.ai.condition] != null) counts[p.ai.condition]++; });

    // Cover
    let pg = newPage();
    pg.drawRectangle({ x: 0, y: 0, width: W * 0.46, height: H, color: C.paper });
    text(pg, 'MID-TERM INSPECTION', M, H - 60, B, 10, C.camel);
    let y = H - 100;
    wrap(j.address, T, 30, W * 0.46 - 2 * M, 4).forEach(l => { text(pg, l, M, y, T, 30, C.ink); y -= 34; });
    y -= 10;
    [['Date', fmtDate(j.date) || fmtDate((j.submittedAt || j.createdAt).slice(0, 10))], ['Inspected by', j.inspector || 'Not given'], ['Photos', String(photos.length)], ['Rooms and areas', String(rooms.length)]].forEach(([k, v]) => {
      text(pg, k.toUpperCase(), M, y, B, 7.5, C.soft); text(pg, v, M, y - 14, F, 12, C.ink); y -= 36;
    });
    if (photos.some(p => p.ai && p.ai.condition)) {
      text(pg, 'CONDITION OF WHAT WAS PHOTOGRAPHED', M, y, B, 7.5, C.soft); y -= 18;
      let x = M; ['new', 'good', 'fair', 'poor'].forEach(k => { if (counts[k]) { x += pill(pg, COND_TEXT[k] + ' ' + counts[k], x, y, COND[k]) + 6; } }); y -= 26;
    }
    text(pg, 'Made with DIY Inventory. Photos have the date and time they were taken on them; tap a photo for the full-size picture.', M, 40, F, 7.5, C.soft);
    const front = (rooms.find(r => /^front|^outside/i.test(r.name)) || rooms[0] || { photos: [] }).photos[0];
    if (front) await fitted(pg, front.n, W * 0.46 + 24, 150, W * 0.54 - 24 - M, H - 150 - M);
    if (j.summary && j.summary.overview) { let yy = 126; text(pg, 'SUMMARY', W * 0.46 + 24, yy, B, 7.5, C.soft); yy -= 14; wrap(j.summary.overview, F, 9.5, W * 0.54 - 24 - M, 8).forEach(l => { text(pg, l, W * 0.46 + 24, yy, F, 9.5, C.ink); yy -= 12.5; }); }

    const header = (pg, title, sub) => {
      pg.drawRectangle({ x: M, y: H - 58, width: 4, height: 24, color: C.navy });
      text(pg, title, M + 14, H - 52, T, 20, C.ink); if (sub) text(pg, sub, M + 14 + T.widthOfTextAtSize(safe(title), 20) + 12, H - 50, F, 9, C.soft);
      pg.drawLine({ start: { x: M, y: H - 68 }, end: { x: W - M, y: H - 68 }, thickness: 0.5, color: C.line });
    };
    // Things to look at, and the inspector's notes
    const acts = j.summary && j.summary.actions || [], flagged = photos.filter(p => p.ai && p.ai.concern === 'action');
    if (acts.length || j.notes || flagged.length) {
      pg = newPage(); header(pg, 'Things to look at', acts.length ? acts.length + ' item' + (acts.length === 1 ? '' : 's') : ''); y = H - 96;
      const need = h => { if (y - h < 50) { pg = newPage(); header(pg, 'Things to look at', 'continued'); y = H - 96; } };
      for (const a of acts) {
        const ls = wrap(a.text, F, 10, W - 2 * M - 230, 3); need(14 * ls.length + 10);
        pill(pg, a.priority === 'urgent' ? 'Urgent' : a.priority === 'soon' ? 'Soon' : 'Keep an eye on', M, y, PRI[a.priority]);
        text(pg, a.room + (a.item ? ' - ' + a.item : ''), M + 90, y, B, 10, C.ink);
        ls.forEach((l, k) => text(pg, l, M + 230, y - k * 13, F, 10, C.ink)); y -= 13 * ls.length + 10;
      }
      if (j.notes) { need(40); y -= 8; text(pg, "INSPECTOR'S NOTES", M, y, B, 7.5, C.soft); y -= 14; for (const l of wrap(j.notes.replace(/\n+/g, ' '), F, 10, W - 2 * M, 12)) { need(14); text(pg, l, M, y, F, 10, C.ink); y -= 13; } }
      if (flagged.length) {
        need(150); y -= 10; text(pg, 'PHOTOS OF THESE', M, y, B, 7.5, C.soft); y -= 12;
        let x = M; const tw = 120, th = 90;
        for (const p of flagged.slice(0, 24)) {
          if (x + tw > W - M) { x = M; y -= th + 30; need(th + 30); }
          await fitted(pg, p.n, x, y - th, tw, th); text(pg, p.n + '. ' + (p.ai.room || ''), x, y - th - 11, B, 7.5, C.ink); x += tw + 10;
        }
      }
    }
    // Each room: cards three to a row, two rows a page.
    const cw = (W - 2 * M - 2 * 16) / 3, ph = 150, ch = ph + 62;
    for (const r of rooms) {
      for (let k = 0; k < r.photos.length; k += 6) {
        pg = newPage(); header(pg, r.name, r.photos.length + ' photo' + (r.photos.length === 1 ? '' : 's') + (k ? ' - continued' : ''));
        const chunk = r.photos.slice(k, k + 6);
        for (let i = 0; i < chunk.length; i++) {
          const p = chunk[i], col = i % 3, row = Math.floor(i / 3), x = M + col * (cw + 16), top = H - 84 - row * (ch + 14);
          await fitted(pg, p.n, x, top - ph, cw, ph);
          let yy = top - ph - 14;
          text(pg, p.n + '. ' + (p.ai && p.ai.item || 'Photo'), x, yy, B, 9.5, C.ink);
          if (p.ai && p.ai.condition) pill(pg, COND_TEXT[p.ai.condition], x + cw - B.widthOfTextAtSize(COND_TEXT[p.ai.condition], 7.5) - 10, yy, COND[p.ai.condition]);
          yy -= 12;
          const extra = [p.ai && p.ai.defects && p.ai.defects.length ? 'Marks: ' + p.ai.defects.join(', ') + '.' : '', p.ai && p.ai.cleanliness === 'needs' ? 'Needs a clean.' : p.ai && p.ai.cleanliness === 'dirty' ? 'Dirty.' : ''].filter(Boolean).join(' ');
          wrap(((p.ai && p.ai.observation) || '') + (extra ? ' ' + extra : ''), F, 8, cw, 3).forEach(l => { text(pg, l, x, yy, F, 8, C.soft); yy -= 10; });
          text(pg, 'Taken ' + fmtTime(p.takenAt), x, top - ch + 2, F, 6.5, C.soft);
        }
      }
    }
    // Footer on every page
    pages.forEach((p, i) => { p.drawLine({ start: { x: M, y: 26 }, end: { x: W - M, y: 26 }, thickness: 0.4, color: C.line }); text(p, 'DIY Inventory  ·  Mid-term inspection  ·  ' + j.address, M, 14, F, 7, C.soft); const s = 'Page ' + (i + 1) + ' of ' + pages.length; text(p, s, W - M - F.widthOfTextAtSize(s, 7), 14, F, 7, C.soft); });
    return Buffer.from(await doc.save());
  }

  /* ------------------------------------------------------------------ pages */
  function shell(title, body, publicPage){
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#1B2E4B"><title>${esc(title)}</title><link rel="icon" href="/icons/favicon-32.png">
<style>:root{color-scheme:light dark;--bg:#F5EFE4;--card:#fff;--ink:#13213A;--soft:#5A6475;--line:#E4D9C6;--navy:#1B2E4B;--camel:#C49A6C;--btn:#EFE6D7}@media(prefers-color-scheme:dark){:root{--bg:#0F1A2D;--card:#16233B;--ink:#F1EADF;--soft:#B9B2A5;--line:#2A3B5A;--navy:#3A5A8C;--btn:#22334F}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,system-ui,Segoe UI,Helvetica,Arial,sans-serif}main{max-width:${publicPage ? 640 : 1100}px;margin:0 auto;padding:20px 16px 80px}a{color:inherit}
h1{margin:4px 0 6px;font-size:26px;line-height:1.2}h2{font-size:18px;margin:26px 0 8px}h3{margin:22px 0 8px;font-size:16px}h3 small{color:var(--soft);font-weight:400}.kicker{margin:10px 0 0;color:var(--camel);font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.sub{color:var(--soft)}.pre{white-space:pre-wrap}
.card{background:var(--card);border-radius:16px;padding:16px;margin:16px 0;border:1px solid var(--line)}.row{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.row form{margin:0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:10px 18px;border-radius:999px;border:0;background:var(--btn);color:var(--ink);font:600 15px/1.2 inherit;text-decoration:none;cursor:pointer}.btn.primary{background:var(--navy);color:#fff}.btn.danger{color:#B3261E}.btn:disabled{opacity:.5}.btn.big{width:100%;min-height:58px;font-size:18px}
.copy{display:flex;gap:8px}.copy input{flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:14px monospace}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(${publicPage ? 96 : 210}px,1fr));gap:10px}figure{margin:0;background:var(--card);border-radius:12px;overflow:hidden;border:1px solid var(--line);position:relative}figure img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--line)}figcaption{padding:8px 10px;font-size:13px;color:var(--soft)}figcaption b{color:var(--ink)}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:700;background:#E8EEF7;color:#1B2E4B}.c-new,.c-good{background:#DCF2E3;color:#145A2E}.c-fair,.p-soon{background:#FCEFD3;color:#7A4B00}.c-poor,.p-urgent{background:#FBE0DD;color:#8A1C12}.p-monitor{background:#ECE7DE;color:#5A5348}
.ok{background:#DCF2E3;color:#145A2E;padding:10px 14px;border-radius:12px}.err{background:#FBE0DD;color:#8A1C12;padding:10px 14px;border-radius:12px}.back{font-size:14px}.acts{padding-left:18px}.acts li{margin:6px 0}
.brand{display:flex;align-items:center;gap:10px;font-weight:800}.brand img{width:32px;height:32px;border-radius:9px}textarea{width:100%;min-height:90px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}
.thumb .x{position:absolute;top:4px;right:4px;width:28px;height:28px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:16px;line-height:28px;cursor:pointer}.thumb.up img{opacity:.45}.thumb .st{position:absolute;left:6px;bottom:6px;font-size:11px;background:rgba(0,0,0,.55);color:#fff;border-radius:6px;padding:1px 6px}
.status{position:sticky;bottom:0;background:var(--bg);padding:12px 0 calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line);margin-top:20px}.hide{display:none}</style></head><body><main>
${publicPage ? '<div class="brand"><img src="/icons/icon-192.png" alt="">DIY Inventory</div>' : ''}${body}</main></body></html>`;
  }

  function inspectorPage(j){
    const list = j.photos.map(p => p.n);
    return `<p class="kicker">Mid-term inspection</p><h1>${esc(j.address)}</h1>
<p class="sub">${j.date ? esc(fmtDate(j.date)) : ''}${j.inspector ? (j.date ? ' · ' : '') + 'Inspector: ' + esc(j.inspector) : ''}</p>
<div class="card"><b>How to do it</b><p style="margin:6px 0 0">Walk through the property and photograph everything. Start with the front of the property, then go room by room: each room from the doorway, then the walls, floor, ceiling, windows and doors, kitchen appliances, sink and worktops, bathroom fittings, radiators and boiler, meters, smoke alarms, the garden, and anything damaged, dirty, damp or not working. <b>You don’t need to label anything</b>: the photos are sorted into rooms automatically. Each photo is sent as soon as it’s taken.</p></div>
<label class="btn primary big" for="cam">📷 Take photos</label><input id="cam" class="hide" type="file" accept="image/*" capture="environment" multiple>
<div class="row"><label class="btn" for="gal" style="flex:1">🖼 Add photos from the gallery</label><input id="gal" class="hide" type="file" accept="image/*" multiple></div>
<p class="sub" id="count"></p><div class="grid" id="grid"></div>
<h2>Anything to report? <span class="sub" style="font-weight:400">(optional)</span></h2><textarea id="notes" maxlength="3000" placeholder="e.g. Tenant mentioned the bathroom extractor fan is noisy."></textarea>
<div class="status"><p class="sub" id="state" style="margin:0 0 8px"></p><button class="btn primary big" id="finish" disabled>Finish and send</button></div>
<script>
(function(){
var T=${JSON.stringify(j.token)},sent=${JSON.stringify(list)},queue=[],busy=0,grid=document.getElementById('grid'),cnt=document.getElementById('count'),st=document.getElementById('state'),fin=document.getElementById('finish'),notes=document.getElementById('notes');
try{notes.value=localStorage.getItem('insp-notes-'+T)||''}catch(e){}
notes.addEventListener('input',function(){try{localStorage.setItem('insp-notes-'+T,notes.value)}catch(e){}});
function upd(){var w=queue.length+busy;cnt.textContent=sent.length?sent.length+' photo'+(sent.length==1?'':'s')+' sent':'No photos yet.';st.textContent=w?'Sending '+w+' photo'+(w==1?'':'s')+'… keep this page open.':(sent.length?'All photos sent. Tap Finish when you have photographed everything.':'Take your first photo: the front of the property.');fin.disabled=!!w||!sent.length}
function tile(src,n){var f=document.createElement('figure');f.className='thumb';var i=document.createElement('img');i.src=src;f.appendChild(i);if(n)addX(f,n);grid.insertBefore(f,grid.firstChild);return f}
function addX(f,n){var b=document.createElement('button');b.className='x';b.type='button';b.textContent='×';b.setAttribute('aria-label','Remove photo');b.onclick=function(){if(!confirm('Remove this photo?'))return;fetch('/inspect/'+T+'/photo/'+n+'/delete',{method:'POST'}).then(function(r){if(r.ok){f.remove();sent=sent.filter(function(x){return x!==n});upd()}})};f.appendChild(b)}
sent.forEach(function(n){tile('/inspect/'+T+'/thumb/'+n,n)});
function load(file){return new Promise(function(ok,no){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){ok(im)};im.onerror=function(){URL.revokeObjectURL(u);no(new Error('read'))};im.src=u})}
function stamp(im,max,when){var s=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight)),w=Math.round(im.naturalWidth*s),h=Math.round(im.naturalHeight*s),c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.drawImage(im,0,0,w,h);
var t=when.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}),fs=Math.max(12,Math.round(w/38));x.font='600 '+fs+'px -apple-system,system-ui,Helvetica,Arial,sans-serif';var tw=x.measureText(t).width,p=Math.round(fs*.5);
x.fillStyle='rgba(0,0,0,.6)';x.fillRect(w-tw-p*3,h-fs-p*3,tw+p*2,fs+p*2);x.fillStyle='#fff';x.textBaseline='top';x.fillText(t,w-tw-p*2,h-fs-p*2);return c.toDataURL('image/jpeg',max>1000?.82:.78)}
function add(files){[].slice.call(files).forEach(function(file){if(!/^image\\//.test(file.type)&&!/\\.(jpe?g|png|heic|heif|webp)$/i.test(file.name))return;var id=Date.now().toString(36)+Math.random().toString(36).slice(2,8),when=new Date(file.lastModified&&Math.abs(Date.now()-file.lastModified)<3e10?file.lastModified:Date.now()),f=tile(URL.createObjectURL(file));f.classList.add('up');var s=document.createElement('span');s.className='st';s.textContent='Sending…';f.appendChild(s);queue.push({file:file,id:id,when:when,f:f,s:s,tries:0})});upd();pump()}
function pump(){while(busy<2&&queue.length){(function(q){busy++;upd();(q.body?Promise.resolve(q.body):load(q.file).then(function(im){q.body=JSON.stringify({id:q.id,takenAt:q.when.toISOString(),full:stamp(im,1600,q.when),small:stamp(im,900,q.when)});return q.body})).then(function(body){return fetch('/inspect/'+T+'/photo',{method:'POST',headers:{'Content-Type':'application/json'},body:body}).then(function(r){return r.json().then(function(d){if(!r.ok)throw Object.assign(new Error(d.error||'Upload failed'),{status:r.status});return d})})}).then(function(d){q.f.classList.remove('up');q.s.remove();sent.push(d.n);addX(q.f,d.n);q.body=null;busy--;upd();pump()}).catch(function(e){busy--;if(e.status===409){alert(e.message);location.reload();return}if(e.message==='read'){q.s.textContent='Could not read';q.f.classList.remove('up');upd();pump();return}q.tries++;q.s.textContent='Waiting for signal…';queue.push(q);upd();setTimeout(pump,Math.min(30000,2000*q.tries))})})(queue.shift())}}
document.getElementById('cam').onchange=function(){add(this.files);this.value=''};document.getElementById('gal').onchange=function(){add(this.files);this.value=''};
window.addEventListener('beforeunload',function(e){if(queue.length+busy){e.preventDefault();e.returnValue=''}});
window.addEventListener('online',pump);
fin.onclick=function(){if(!confirm('Send the inspection now? You won\\'t be able to add more photos after this.'))return;fin.disabled=true;fin.textContent='Sending…';fetch('/inspect/'+T+'/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:notes.value})}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'Could not send');try{localStorage.removeItem('insp-notes-'+T)}catch(e){}location.reload()})}).catch(function(e){alert(e.message+' Please try again.');fin.textContent='Finish and send';upd()})};
upd();
})();
</script>`;
  }

  return { paths: [] };
}

module.exports = { mount };
