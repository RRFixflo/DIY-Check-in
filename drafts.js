// Online backup of every report while it is being done, finished or not, so the owner always has a copy
// and nothing is lost if a phone is. The app sends its state as it changes (photos replaced by their ids)
// and each photo once (cloudSync() in public/index.html). Kept in REPORTS_DIR/drafts/<key>/ (state.json,
// photos/<id>.jpg), where key is the report's random draft key. The owner sees them on /admin under
// "Reports in progress", and gets a phone alert when one is finished but not yet paid for.
// Drafts not touched for 180 days are deleted; the folder is capped at DRAFTS_MAX_MB (default 2000).
const fs = require('fs');
const path = require('path');

const KEY_RE = /^[a-f0-9]{32}$/;
const PID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const KEEP_DAYS = 180;

function mount(app, ctx){
  const { REPORTS_DIR, esc, clip, clientIp, limiter, deviceName, notify, requireAdmin, sameOrigin, PUBLIC_URL } = ctx;
  const { buildFromBackup } = require('./backup-pdf');
  const DIR = path.join(REPORTS_DIR, 'drafts');
  fs.mkdirSync(DIR, { recursive: true });
  const MAX_BYTES = Math.max(100, parseInt(process.env.DRAFTS_MAX_MB, 10) || 2000) * 1024 * 1024;
  const saveLimit = limiter(900, 60 * 60 * 1000), photoLimit = limiter(900, 60 * 60 * 1000);
  const dirOf = key => path.join(DIR, key);
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  const writeJson = (f, d) => { fs.writeFileSync(f + '.tmp', JSON.stringify(d)); fs.renameSync(f + '.tmp', f); };

  // Disk use of all drafts, recounted now and then.
  let used = 0, countedAt = 0;
  function dirSize(d){ let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch (e) {} return n; }
  function usage(){ if (Date.now() - countedAt > 10 * 60 * 1000) { used = dirSize(DIR); countedAt = Date.now(); } return used; }
  function list(){
    let keys = []; try { keys = fs.readdirSync(DIR).filter(k => KEY_RE.test(k)); } catch (e) {}
    return keys.map(key => { const s = readJson(path.join(dirOf(key), 'state.json')); return s ? { key, s } : null; }).filter(Boolean)
      .sort((a, b) => String(b.s._savedAt).localeCompare(String(a.s._savedAt)));
  }
  // Old drafts go after 180 days, and the oldest finished ones first if the folder is over its cap.
  function sweep(){
    const now = Date.now();
    list().forEach(({ key, s }) => { if (now - new Date(s._savedAt || 0).getTime() > KEEP_DAYS * 86400000) fs.rmSync(dirOf(key), { recursive: true, force: true }); });
    countedAt = 0;
    if (usage() > MAX_BYTES) {
      const old = list().reverse();
      for (const { key, s } of old) { if (usage() <= MAX_BYTES * 0.9) break; if (s.submittedId || s.finalizedAt) { fs.rmSync(dirOf(key), { recursive: true, force: true }); countedAt = 0; } }
    }
  }
  setTimeout(sweep, 60 * 1000).unref();
  setInterval(sweep, 24 * 3600 * 1000).unref();

  // The app's state, photos replaced by ids.
  app.post('/api/drafts/:key', (req, res) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return res.status(404).json({ error: 'Unknown draft.' });
    if (!saveLimit(clientIp(req))) return res.status(429).json({ error: 'Too many saves.' });
    const s = (req.body || {}).state;
    if (!s || typeof s !== 'object' || !Array.isArray(s.rooms) || s.rooms.length > 60) return res.status(400).json({ error: 'Expected the report.' });
    const text = JSON.stringify(s);
    if (text.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Too large.' });
    fs.mkdirSync(path.join(dirOf(key), 'photos'), { recursive: true });
    const before = readJson(path.join(dirOf(key), 'state.json')) || {};
    s._createdAt = before._createdAt || new Date().toISOString();
    s._savedAt = new Date().toISOString();
    s._device = deviceName(req.headers['user-agent']);
    s._alerted = before._alerted || '';
    s._serverReportId = before._serverReportId || '';
    // Whether this phone has a paid link or code (the cookie travels with every backup), for a report made from it.
    if (ctx.hasAccess) s._access = ctx.hasAccess(req) || before._access || false;
    // The link or code itself (kept only here, on the server), so a report made from the backup still reaches the buyer or agent by email.
    if (ctx.accessToken) s._token = (ctx.hasAccess && ctx.hasAccess(req) && ctx.accessToken(req)) || before._token || '';
    if (ctx.isOwnerReq) s._byOwner = ctx.isOwnerReq(req) || before._byOwner || false;
    // Someone has started a report (the address is set and rooms are made): tell the owner once, with who let them in
    // (a purchase, an agent's tenant link, the access code, or nothing yet) and where they are. Not the owner's own.
    s._startAlerted = before._startAlerted || '';
    const m0 = s.meta || {};
    if (!s._startAlerted && m0.address && (s.rooms || []).length && !s._byOwner) {
      s._startAlerted = s._savedAt;
      let place = {}; try { place = require('./analytics').placeOf(req); } catch (e) {}
      const via = ctx.accessLabel ? ctx.accessLabel(s._token, false) : '';
      const where = [place.city, place.region, place.country].filter(Boolean).join(', ');
      notify({ title: 'Report started: ' + clip(m0.inspectionType || 'Check-In', 30), message: [clip(m0.address, 200), [m0.inspectorName ? 'by ' + clip(m0.inspectorName, 80) : '', s._device, where].filter(Boolean).join(' · '), via ? 'Using: ' + via : 'No link or code yet (will pay at the end)'].join('\n'),
        tags: ['pencil2'], click: PUBLIC_URL ? PUBLIC_URL + '/admin#drafts' : '' });
      console.log('report started: ' + key + ' (' + clip(m0.address, 80) + ')');
    }
    // Finished but not paid for: tell the owner once.
    if (s.finalizedAt && !s.submittedId && !s._access && !s._alerted) {
      s._alerted = s._savedAt;
      const m = s.meta || {};
      notify({ title: 'Report finished, not paid yet', message: [clip(m.address, 200) || 'No address', [m.inspectionType, m.inspectorName ? 'by ' + clip(m.inspectorName, 80) : ''].filter(Boolean).join(' ')].join('\n'), tags: ['hourglass'], click: PUBLIC_URL ? PUBLIC_URL + '/admin#drafts' : '' });
    }
    writeJson(path.join(dirOf(key), 'state.json'), s);
    res.json({ ok: true });
  });

  // Photos, a few at a time; each is sent once.
  app.post('/api/drafts/:key/photos', (req, res) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key) || !fs.existsSync(dirOf(key))) return res.status(404).json({ error: 'Unknown draft.' });
    if (!photoLimit(clientIp(req))) return res.status(429).json({ error: 'Too many uploads.' });
    if (usage() > MAX_BYTES) return res.status(507).json({ error: 'Backup storage is full.' });
    const dir = path.join(dirOf(key), 'photos');
    let count = 0; try { count = fs.readdirSync(dir).length; } catch (e) {}
    const saved = [];
    for (const p of (Array.isArray((req.body || {}).photos) ? req.body.photos : []).slice(0, 6)) {
      const id = String((p && p.id) || ''), m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String((p && p.dataUrl) || ''));
      if (!PID_RE.test(id) || !m || count >= 600) continue;
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length < 100 || buf.length > 12 * 1024 * 1024 || buf[0] !== 0xFF || buf[1] !== 0xD8) continue;
      const file = path.join(dir, id + '.jpg');
      if (!fs.existsSync(file)) { fs.writeFileSync(file, buf); used += buf.length; count++; }
      saved.push(id);
    }
    res.json({ ok: true, saved });
  });

  // The phone that made a report gets it back from here when its own copy is gone (storage cleared, the phone
  // tidied it away): the state without the server's own notes, then each photo. The random draft key is the access.
  const restoreLimit = limiter(2000, 60 * 60 * 1000);
  app.get('/api/drafts/:key', (req, res) => {
    const key = String(req.params.key);
    if (!restoreLimit(clientIp(req))) return res.status(429).json({ error: 'Too many requests.' });
    const s = KEY_RE.test(key) && readJson(path.join(dirOf(key), 'state.json'));
    if (!s) return res.status(404).json({ error: 'No backup.' });
    const out = {}; Object.keys(s).forEach(k => { if (k[0] !== '_') out[k] = s[k]; });
    let have = []; try { have = fs.readdirSync(path.join(dirOf(key), 'photos')).filter(f => /\.jpg$/.test(f)).map(f => f.slice(0, -4)); } catch (e) {}
    res.set('Cache-Control', 'no-store').json({ state: out, photos: have, serverReport: !!s._serverReportId });
  });
  app.get('/api/drafts/:key/photo/:id', (req, res) => {
    const key = String(req.params.key), id = String(req.params.id);
    if (!restoreLimit(clientIp(req))) return res.status(429).end();
    if (!KEY_RE.test(key) || !PID_RE.test(id)) return res.status(404).end();
    const file = path.join(dirOf(key), 'photos', id + '.jpg');
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set('Cache-Control', 'private, no-store').type('jpeg').sendFile(file);
  });

  /* ------------------------------ owner's view ------------------------------ */
  const CONDITION = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor' };
  const when = t => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—';
  function stats(s){
    let photos = 0, items = 0, done = 0;
    const count = arr => { photos += (arr || []).length; };
    (s.rooms || []).forEach(r => { (r.items || []).forEach(i => { if (!i.notApplicable) { items++; if ((i.photos || []).length) done++; } count(i.photos); }); count(r.extraPhotos); });
    const pr = s.property || {};
    count(pr.exterior && pr.exterior.photos); (pr.keys || []).forEach(k => count(k.photos)); Object.values(pr.meters || {}).forEach(m => count(m && m.photos));
    return { photos, items, done };
  }
  // Paid = the phone's paid copy arrived (submittedId), or the phone had a paid link, code or agent link (or the owner was
  // signed in) when it last backed up (_access): that's what pays, even if the phone's own upload then failed.
  const paidS = s => !!(s.submittedId || s._access);
  // What unlocked it, in words (a £30 purchase and who, an agent's tenant link, the access code, the owner).
  const via = s => ctx.accessLabel ? ctx.accessLabel(s._token, s._byOwner) : '';
  const status = s => s.submittedId ? ['sent', 'Finished and paid'] : s.finalizedAt && s._access ? ['sent', (/paid/.test(via(s)) ? 'Finished and paid' : 'Finished · access allowed') + (s._serverReportId ? ' · report made from the backup' : ' · PDF still arriving')] : s.finalizedAt ? ['wait', 'Finished, not paid yet'] : ['', 'In progress'];

  // The list on /admin.
  function draftsHTML(){
    const all = list();
    const rows = all.slice(0, 200).map(({ key, s }) => {
      const m = s.meta || {}, st = stats(s), [cls, label] = status(s);
      return `<li><div style="flex:1;min-width:0"><strong>${esc(m.address || 'No address yet')}</strong> <span class="pill ${cls}">${label}</span>
        <div class="sub">${esc([m.inspectionType, m.inspectorName ? 'by ' + m.inspectorName : '', s._device].filter(Boolean).join(' · '))}</div>
        <div class="sub">${(s.rooms || []).length} rooms · ${st.done}/${st.items} items photographed · ${st.photos} photos · last saved ${esc(when(s._savedAt))}</div>${s._access ? `<div class="sub">💳 ${esc(via(s) || 'Access allowed, but how isn’t recorded (backed up before this was tracked)')}</div>` : ''}</div>
        <div class="actions"><a class="btn" href="/admin/drafts/${key}" target="_blank" rel="noopener">View</a>
        ${s.submittedId || s._serverReportId ? '' : `<form method="post" action="/admin/drafts/${key}/make" onsubmit="this.querySelector('button').textContent='Making it…';return confirm('Make the report from this backup now and mark it as complete and paid?${s.finalizedAt ? '' : ' It hasn’t been finished on the phone yet: it will have what has been done so far.'}')"><button class="btn">Make the report now</button></form>`}
        <form method="post" action="/admin/drafts/${key}/delete" onsubmit="return confirm('Delete this backup? This cannot be undone.')"><button class="btn danger">Delete</button></form></div></li>`;
    }).join('');
    const waiting = all.filter(d => d.s.finalizedAt && !paidS(d.s)).length;
    return `<details class="codes" id="drafts"${waiting ? ' open' : ''}><summary>📝 Reports in progress <span class="sub" style="display:inline">— ${all.length ? all.length + ' backed up' + (waiting ? ', ' + waiting + ' finished but not paid' : '') : 'none yet'}</span></summary>
<p class="sub">Every report is backed up here as it’s being done, with its photos, whether it’s finished or not. Unfinished backups are deleted after ${KEEP_DAYS} days.</p>
${rows ? '<ul>' + rows + '</ul>' : ''}</details>`;
  }

  // One backup, readable and printable (Print → Save as PDF).
  app.get('/admin/drafts/:key', requireAdmin, (req, res) => {
    const key = String(req.params.key);
    const s = KEY_RE.test(key) && readJson(path.join(dirOf(key), 'state.json'));
    if (!s) return res.status(404).type('text/plain').send('Not found.');
    const m = s.meta || {}, pr = s.property || {}, st = stats(s), [, label] = status(s);
    const img = (list, alt) => (list || []).map(p => p && PID_RE.test(String(p.id)) ? `<a href="/admin/drafts/${key}/photo/${p.id}" target="_blank"><img loading="lazy" src="/admin/drafts/${key}/photo/${p.id}" alt="${esc(alt)}"></a>` : '').join('');
    const itemText = i => i.notApplicable ? 'Not applicable' + (i.naReason ? ': ' + i.naReason : '') : [CONDITION[i.condition] || 'Condition not set', (i.defects || []).filter(d => d !== 'None').join(', ').toLowerCase(), i.clean ? ({ clean: 'clean', needs: 'needs a clean', dirty: 'dirty' }[i.clean] || '') : '', i.working === 'no' ? 'not working' : '', i.desc || '', i.conditionNote ? 'note: ' + i.conditionNote : '', i.aiObservation ? 'AI: ' + i.aiObservation : ''].filter(Boolean).join(' · ');
    const rooms = (s.rooms || []).map(r => `<section><h2>${esc(r.name)}</h2>
      ${(r.items || []).map(i => `<div class="it"><b>${esc(i.label)}</b><span>${esc(itemText(i))}</span><div class="ph">${img(i.photos, i.label)}</div></div>`).join('')}
      ${(r.extraPhotos || []).length ? `<div class="it"><b>General views</b><div class="ph">${img(r.extraPhotos, 'General view')}</div></div>` : ''}
      ${r.notes ? `<p class="note">Notes: ${esc(r.notes)}</p>` : ''}</section>`).join('');
    const meters = Object.entries(pr.meters || {}).map(([k, v]) => v ? `<div class="it"><b>${esc(k)} meter</b><span>${v.na ? 'Not applicable' : esc([v.reading, v.serial ? 'serial ' + v.serial : '', v.location].filter(Boolean).join(' · ') || '—')}</span><div class="ph">${img(v.photos, k + ' meter')}</div></div>` : '').join('');
    const keys = (pr.keys || []).map(k => `<div class="it"><b>Keys</b><span>${esc([k.desc, k.action].filter(Boolean).join(' · ') || '—')}</span><div class="ph">${img(k.photos, 'Keys')}</div></div>`).join('');
    res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(m.address || 'Report in progress')}</title><style>
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0F172A; background: #F4F5FB; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 60px; } h1 { margin: 0 0 4px; font-size: 26px; } h2 { font-size: 19px; margin: 0 0 8px; }
  .sub { color: #475569; } .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #EEF0FF; color: #3730A3; font-weight: 700; font-size: 13px; }
  section, .head { background: #fff; border-radius: 16px; padding: 16px; margin: 14px 0; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  .it { display: grid; grid-template-columns: 180px 1fr; gap: 4px 14px; padding: 10px 0; border-top: 1px solid #E4E8EF; } .it:first-of-type { border-top: 0; }
  .it span { color: #475569; } .ph { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; } .ph img { width: 120px; height: 90px; object-fit: cover; border-radius: 8px; background: #E4E8EF; }
  .note { color: #475569; } button { font: inherit; font-weight: 600; padding: 9px 16px; border-radius: 999px; border: 1px solid #CDD4DF; background: #fff; cursor: pointer; }
  .sig { max-width: 260px; background: #fff; border: 1px solid #E4E8EF; border-radius: 8px; }
  @media (max-width: 640px) { .it { grid-template-columns: 1fr; } }
  @media print { body { background: #fff; } button { display: none; } section, .head { box-shadow: none; border: 1px solid #E4E8EF; break-inside: avoid-page; } }
</style></head><body><main>
<div class="head"><h1>${esc(m.address || 'No address yet')}</h1>
<div class="sub">${esc([m.inspectionType, m.inspectorName ? 'by ' + m.inspectorName : '', m.ref ? 'ref ' + m.ref : ''].filter(Boolean).join(' · '))}</div>
<p><span class="pill">${label}</span> · ${(s.rooms || []).length} rooms · ${st.done}/${st.items} items photographed · ${st.photos} photos · started ${esc(when(s._createdAt))} · last saved ${esc(when(s._savedAt))} · ${esc(s._device || '')}</p>
<button onclick="print()">Print or save as PDF</button></div>
${(pr.exterior && pr.exterior.photos || []).length ? `<section><h2>Front of the property</h2><div class="ph">${img(pr.exterior.photos, 'Front of the property')}</div></section>` : ''}
${rooms}
${meters || keys ? `<section><h2>Meters and keys</h2>${meters}${keys}</section>` : ''}
${s.signatureDataUrl && /^data:image\/(png|jpeg);base64,/.test(s.signatureDataUrl) ? `<section><h2>Signature</h2><img class="sig" src="${esc(s.signatureDataUrl)}" alt="Signature"><p class="sub">${esc(m.signedBy || m.inspectorName || '')}${s.finalizedAt ? ' · finished ' + esc(when(s.finalizedAt)) : ''}</p></section>` : ''}
</main></body></html>`);
  });
  app.get('/admin/drafts/:key/photo/:id', requireAdmin, (req, res) => {
    const key = String(req.params.key), id = String(req.params.id);
    if (!KEY_RE.test(key) || !PID_RE.test(id)) return res.status(404).end();
    const file = path.join(dirOf(key), 'photos', id + '.jpg');
    if (!fs.existsSync(file)) return res.status(404).type('text/plain').send('This photo hasn’t been backed up yet.');
    res.set('Cache-Control', 'private, max-age=86400').type('jpeg').sendFile(file);
  });
  app.post('/admin/drafts/:key/delete', requireAdmin, (req, res) => {
    const key = String(req.params.key);
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Delete from the reports page.');
    if (KEY_RE.test(key)) { fs.rmSync(dirOf(key), { recursive: true, force: true }); countedAt = 0; }
    res.redirect(303, '/admin#drafts');
  });

  // Finished on the phone, but its PDF never reached the server (the upload was cut off, or the build failed):
  // a few minutes on, the server makes the report from this backup, stores it like any other and sends it to
  // the owner (ctx.fromBackup). It waits until every photo has arrived, or 30 minutes after finishing at most.
  // A copy the phone sends later replaces it (storeReport()).
  // The report PDF from a backup, with every photo numbered and linked to /p/<photoKey>/<n> (full size), as on the
  // phone's own PDF. A backup without a photo key (older phones) is given one.
  async function buildFor(key, s){
    if (!/^[a-f0-9]{32}$/.test(String(s.photoKey || ''))) {
      s.photoKey = require('crypto').randomBytes(16).toString('hex');
      const now = readJson(path.join(dirOf(key), 'state.json')) || s; now.photoKey = s.photoKey; writeJson(path.join(dirOf(key), 'state.json'), now);
    }
    const photoFile = id => PID_RE.test(String(id)) ? path.join(dirOf(key), 'photos', String(id) + '.jpg') : '';
    // The app's own report builder, run on the server (render-backup.js), so it looks exactly like the phone's; the
    // simpler builder (backup-pdf.js) only if that fails.
    try {
      const r = await require('./render-backup').renderInChild(s, path.join(dirOf(key), 'photos'), ctx.PUBLIC_URL || 'http://localhost', path.join(ctx.REPORTS_DIR, 'render-tmp'));
      console.log('report built from its backup with the app’s own design: ' + key + ' (' + r.photos.length + ' photos)');
      return { pdf: r.pdf, photos: r.photos.filter(p => p.id), photoFile, design: 'app' };
    } catch (e) { console.error('the app’s design could not be used for backup ' + key + ', using the simple one: ' + e.message); }
    const out = { base: (ctx.PUBLIC_URL || '') + '/p/' + s.photoKey + '/' };
    const pdf = await buildFromBackup(s, photoFile, out);
    return { pdf, photos: out.photos, photoFile, design: 'simple' };
  }
  // The backup a stored report was made from (for Rebuild on /admin).
  const backupFor = reportId => list().find(({ s }) => s._serverReportId === reportId) || null;
  async function rebuild(reportId){ const b = backupFor(reportId); if (!b) return null; return Object.assign({ key: b.key, s: b.s }, await buildFor(b.key, b.s)); }
  const WAIT_MS = 5 * 60 * 1000, GIVE_UP_MS = 30 * 60 * 1000;
  let building = false;
  async function rescue(){
    if (building || !ctx.fromBackup) return;
    building = true;
    try {
      for (const { key, s } of list()) {
        if (!s.finalizedAt || s.submittedId || s._serverReportId || s._rescueFailed) continue;
        const age = Date.now() - new Date(s.finalizedAt).getTime();
        if (!(age > WAIT_MS) || age > 14 * 86400000) continue;
        if (ctx.alreadyStored && ctx.alreadyStored(s)) continue;
        const ids = []; (function walk(o){ if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id && PID_RE.test(String(o.id)) && 'ts' in o) ids.push(String(o.id)); Object.values(o).forEach(walk); } })([s.rooms, s.property]);
        const missing = ids.filter(id => !fs.existsSync(path.join(dirOf(key), 'photos', id + '.jpg'))).length;
        if (missing && age < GIVE_UP_MS) continue;
        try {
          const { pdf, photos, photoFile } = await buildFor(key, s);
          const id = await ctx.fromBackup(pdf, s, { missing, photos, photoFile });
          const now = readJson(path.join(dirOf(key), 'state.json')) || s;
          now._serverReportId = id || 'stored'; writeJson(path.join(dirOf(key), 'state.json'), now);
          console.log('report made from its backup: ' + key + ' → ' + id + (missing ? ' (' + missing + ' photos missing)' : ''));
        } catch (err) {
          console.error('report from backup failed: ' + key + ': ' + err.message);
          const now = readJson(path.join(dirOf(key), 'state.json')) || s; now._rescueFailed = new Date().toISOString(); writeJson(path.join(dirOf(key), 'state.json'), now);
        }
      }
    } finally { building = false; }
  }
  setTimeout(() => rescue().catch(() => {}), 60 * 1000).unref();
  setInterval(() => rescue().catch(() => {}), 2 * 60 * 1000).unref();

  // The owner makes the report from a backup at any time (finished or not), stored as complete and paid.
  async function makeNow(key){
    const s = readJson(path.join(dirOf(key), 'state.json'));
    if (!s) return null;
    if (s._serverReportId && s._serverReportId !== 'stored') return s._serverReportId;
    const s2 = Object.assign({}, s, { finalizedAt: s.finalizedAt || new Date().toISOString() });
    const { pdf, photos, photoFile } = await buildFor(key, s2);
    const id = await ctx.fromBackup(pdf, s2, { photos, photoFile, paid: true, byOwner: true });
    const now = readJson(path.join(dirOf(key), 'state.json')) || s; now._serverReportId = id || 'stored'; if (s2.photoKey) now.photoKey = s2.photoKey; writeJson(path.join(dirOf(key), 'state.json'), now);
    console.log('report made from its backup by the owner: ' + key + ' → ' + id);
    return id;
  }
  if (ctx.requireAdmin) app.post('/admin/drafts/:key/make', ctx.requireAdmin, async (req, res) => {
    if (ctx.sameOrigin && !ctx.sameOrigin(req)) return res.status(403).type('text/plain').send('Make it from the admin page.');
    const key = String(req.params.key); if (!KEY_RE.test(key)) return res.status(404).type('text/plain').send('Unknown backup.');
    try { const id = await makeNow(key); if (!id) return res.status(404).type('text/plain').send('Unknown backup.'); res.redirect(303, '/admin#reports'); }
    catch (e) { console.error('make from backup failed: ' + e.message); res.status(500).type('text/plain').send('It could not be made: ' + e.message); }
  });

  // Finished on the phone but with no stored report (not paid, or the upload never arrived): listed with the reports.
  const finishedOnly = () => list().filter(({ s }) => s.finalizedAt && !s.submittedId);
  const findBackup = fn => list().find(fn) || null;
  return { draftsHTML, finishedOnly, rebuild, backupFor, makeNow, buildFor, findBackup, all: list };
}

module.exports = { mount };
