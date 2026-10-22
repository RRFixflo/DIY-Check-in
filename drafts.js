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
    // Finished but not paid for: tell the owner once.
    if (s.finalizedAt && !s.submittedId && !s._alerted) {
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
  const status = s => s.submittedId ? ['sent', 'Finished and paid'] : s.finalizedAt ? ['wait', 'Finished, not paid yet'] : ['', 'In progress'];

  // The list on /admin.
  function draftsHTML(){
    const all = list();
    const rows = all.slice(0, 200).map(({ key, s }) => {
      const m = s.meta || {}, st = stats(s), [cls, label] = status(s);
      return `<li><div style="flex:1;min-width:0"><strong>${esc(m.address || 'No address yet')}</strong> <span class="pill ${cls}">${label}</span>
        <div class="sub">${esc([m.inspectionType, m.inspectorName ? 'by ' + m.inspectorName : '', s._device].filter(Boolean).join(' · '))}</div>
        <div class="sub">${(s.rooms || []).length} rooms · ${st.done}/${st.items} items photographed · ${st.photos} photos · last saved ${esc(when(s._savedAt))}</div></div>
        <div class="actions"><a class="btn" href="/admin/drafts/${key}" target="_blank" rel="noopener">View</a>
        <form method="post" action="/admin/drafts/${key}/delete" onsubmit="return confirm('Delete this backup? This cannot be undone.')"><button class="btn danger">Delete</button></form></div></li>`;
    }).join('');
    const waiting = all.filter(d => d.s.finalizedAt && !d.s.submittedId).length;
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

  return { draftsHTML };
}

module.exports = { mount };
