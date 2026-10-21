// Tenant sign-off. Whoever made a report (often the landlord) sends the other party the link
// /sign/<photoKey>. That page shows the report room by room with its photos; they can comment on any
// item, then agree and sign with a finger. The signature, name, comments and time are kept beside the
// report (sign.json), and a "Tenant acknowledgement" page is added to a copy of the PDF (<id>.signed.pdf,
// made with pdf-lib). The random key is the access, as for the photo links. Once signed, it can't be changed.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const CONDITION = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor' };
const CLEAN = { clean: 'Clean', needs: 'Needs a clean', dirty: 'Dirty' };

function mount(app, ctx){
  const { REPORTS_DIR, photoDir, findByKey, readMeta, esc, clip, clientIp, limiter, deviceName, notify, PUBLIC_URL } = ctx;
  const KEY_RE = /^[a-f0-9]{32}$/;
  const signLimit = limiter(20, 60 * 60 * 1000);
  const signedPdf = id => path.join(REPORTS_DIR, id + '.signed.pdf');
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  function lookup(key){
    key = String(key || '').toLowerCase();
    if (!KEY_RE.test(key)) return null;
    const id = findByKey(key), r = id && readMeta(id);
    if (!r) return null;
    return { key, id, r, data: readJson(path.join(photoDir(id), 'data.json')), sign: readJson(path.join(photoDir(id), 'sign.json')) };
  }
  const kindOf = t => /check-?out/i.test(t || '') ? 'Check-Out' : /inspection/i.test(t || '') ? 'Inspection' : 'Check-In';
  function itemText(i){
    if (i.notApplicable) return 'Not applicable' + (i.naReason ? ': ' + i.naReason : '');
    const marks = (i.defects || []).filter(d => d !== 'None');
    return [CONDITION[i.condition] ? CONDITION[i.condition] + ' condition' : 'Condition not recorded',
      marks.length ? 'marks: ' + marks.join(', ').toLowerCase() : (i.defects || []).includes('None') ? 'no marks' : '',
      CLEAN[i.clean] ? CLEAN[i.clean].toLowerCase() : '', i.working === 'no' ? 'not working' : i.working === 'yes' ? 'working' : '',
      i.desc ? i.desc : '', i.conditionNote ? 'note: ' + i.conditionNote : ''].filter(Boolean).join(' · ');
  }
  const when = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '';

  function page(title, body){
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><link rel="icon" href="/icons/favicon-32.png"><link rel="stylesheet" href="/site.css">
<style>
  main.sign { max-width: 820px; margin: 0 auto; padding: 24px 16px 60px; }
  .sign h1 { font-size: clamp(26px, 5vw, 36px); margin: 8px 0 6px; line-height: 1.15; }
  .sign .lead { color: var(--ink-soft); margin: 0 0 18px; }
  .sign .card { margin-bottom: 14px; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px 18px; margin: 0; }
  .facts dt { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-faint); }
  .facts dd { margin: 0; font-weight: 600; }
  .room h2 { font-size: 20px; margin: 0 0 6px; }
  .it { border-top: 1px solid var(--line); padding: 12px 0; }
  .it:first-of-type { border-top: 0; }
  .it b { display: block; } .it .t { color: var(--ink-soft); font-size: 14.5px; }
  .ph { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .ph img { width: 76px; height: 76px; object-fit: cover; border-radius: 10px; background: var(--line); }
  .it details summary { cursor: pointer; color: var(--accent); font-weight: 600; font-size: 14px; margin-top: 6px; list-style: none; }
  .it details summary::-webkit-details-marker { display: none; }
  .it textarea, .form textarea { width: 100%; min-height: 70px; margin-top: 6px; padding: 10px 12px; border: 0; border-radius: 12px; background: var(--bg); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); font: inherit; }
  .padwrap { position: relative; border: 2px dashed var(--line); border-radius: 14px; background: #fff; overflow: hidden; margin-top: 8px; }
  .padwrap::after { content: "Sign here"; position: absolute; left: 16px; bottom: 34px; right: 16px; border-top: 1px solid #CBD5E1; padding-top: 4px; font-size: 12px; color: #94A3B8; pointer-events: none; }
  .pad { width: 100%; height: 200px; touch-action: none; display: block; }
  .sigrow { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .choice { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: var(--bg); margin-bottom: 8px; cursor: pointer; }
  .err { color: #B42318; font-weight: 600; margin-top: 10px; }
  .ok { background: var(--good-soft); color: var(--good); border-radius: 14px; padding: 14px 16px; font-weight: 600; }
  .muted { color: var(--ink-faint); font-size: 14px; }
</style></head><body>
<header class="top"><div class="wrap"><span class="brand"><img src="/icons/icon-192.png" alt="" width="32" height="32">DIY Inventory</span></div></header>
<main class="sign">${body}</main></body></html>`;
  }

  // The report, for the other party to check and sign.
  app.get('/sign/:key', (req, res) => {
    const L = lookup(req.params.key);
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'same-origin');
    if (!L || !L.data) return res.status(404).type('html').send(page('Report not found', '<h1>Report not found</h1><p class="lead">Check the link you were sent. If it still doesn’t work, ask whoever sent it for a new one.</p>'));
    const { key, r, data, sign } = L;
    const kind = kindOf(data.type || r.inspectionType);
    const base = '/p/' + key + '/';
    const photos = list => (list || []).length ? `<div class="ph">${list.slice(0, 6).map(n => `<a href="${base}${n}" target="_blank" rel="noopener"><img loading="lazy" src="${base}${n}.jpg" alt=""></a>`).join('')}</div>` : '';
    const facts = `<dl class="facts"><div><dt>Property</dt><dd>${esc(data.address || r.address)}</dd></div><div><dt>Report</dt><dd>${esc(kind)}</dd></div>
      <div><dt>Date</dt><dd>${esc(when(data.createdAt || r.createdAt))}</dd></div><div><dt>Done by</dt><dd>${esc(data.signedBy || data.inspectorName || r.signedBy || '—')}</dd></div>
      <div><dt>Reference</dt><dd>${esc(data.ref || r.ref || '—')}</dd></div></dl>
      <p style="margin:14px 0 0"><a class="btn ghost sm" href="/sign/${key}/report.pdf" target="_blank" rel="noopener">Open the full PDF report</a></p>`;
    const rooms = (data.rooms || []).map((room, ri) => `<div class="card room"><h2>${esc(room.name)}</h2>
      ${(room.items || []).map((it, ii) => `<div class="it"><b>${esc(it.label)}</b><div class="t">${esc(itemText(it))}</div>${photos(it.photos)}
        ${sign ? '' : `<details><summary>+ Comment on this</summary><textarea data-room="${esc(room.name)}" data-item="${esc(it.label)}" maxlength="600" placeholder="What doesn’t match? e.g. the stain on the carpet was already there"></textarea></details>`}</div>`).join('')}
      ${(room.extra || []).length ? `<div class="it"><b>General views</b>${photos(room.extra)}</div>` : ''}</div>`).join('');
    const meters = Object.entries(data.meters || {}).filter(([, m]) => m && (m.reading || m.na)).map(([k, m]) => `<div class="it"><b>${esc(k[0].toUpperCase() + k.slice(1))} meter</b><div class="t">${m.na ? 'Not applicable' : esc(m.reading)}</div>${photos(m.photos)}</div>`).join('');
    const keys = (data.keys || []).filter(k => k.desc).map(k => `<div class="it"><b>Keys</b><div class="t">${esc(k.desc)}${k.action ? ' · ' + esc(k.action) : ''}</div>${photos(k.photos)}</div>`).join('');
    const extras = meters || keys ? `<div class="card room"><h2>Meters and keys</h2>${meters}${keys}</div>` : '';
    if (sign){
      return res.type('html').send(page('Report signed', `<span class="kicker" style="color:var(--accent);font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em">${esc(kind)} report</span>
        <h1>${esc(data.address || r.address)}</h1>
        <div class="ok">✓ Signed by ${esc(sign.name)} on ${esc(when(sign.at))}${sign.agree === 'comments' ? ', with comments' : ''}.</div>
        ${sign.comments && sign.comments.length ? `<div class="card" style="margin-top:14px"><b>Comments</b>${sign.comments.map(c => `<div class="it"><b>${esc(c.room)} · ${esc(c.item)}</b><div class="t">${esc(c.text)}</div></div>`).join('')}</div>` : ''}
        ${sign.general ? `<div class="card" style="margin-top:14px"><b>General comments</b><div class="t">${esc(sign.general)}</div></div>` : ''}
        <p style="margin-top:14px"><a class="btn primary" href="/sign/${key}/signed.pdf" target="_blank" rel="noopener">Download the signed report</a></p>
        <div class="card" style="margin-top:18px">${facts}</div>`));
    }
    res.type('html').send(page('Check and sign this report', `<span class="kicker" style="color:var(--accent);font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em">${esc(kind)} report · please check and sign</span>
      <h1>${esc(data.address || r.address)}</h1>
      <p class="lead">You’ve been asked to check this report and sign it. Look through each room. If anything doesn’t match what you see, tap <b>Comment on this</b> under it. Then sign at the bottom.</p>
      <div class="card">${facts}</div>
      ${rooms}${extras}
      <form class="card form" id="signForm" onsubmit="return false">
        <h2 style="margin:0 0 10px;font-size:22px">Sign the report</h2>
        <label class="choice"><input type="radio" name="agree" value="yes" checked> <span>I agree this report is an accurate record of the property.</span></label>
        <label class="choice"><input type="radio" name="agree" value="comments"> <span>I agree, except for my comments.</span></label>
        <label>Any other comments <span>(optional)</span><textarea id="general" maxlength="2000"></textarea></label>
        <label>Your full name<input id="name" required maxlength="120" autocomplete="name"></label>
        <div><div class="sigrow"><b>Sign with your finger</b><button type="button" class="btn ghost sm" id="clearSig">Clear</button></div>
        <div class="padwrap"><canvas class="pad" id="pad"></canvas></div></div>
        <p class="muted">By signing you confirm you have checked this report. Your name, signature, comments and the time are added to the report.</p>
        <button type="button" class="btn primary" id="submitBtn">Sign the report</button>
        <div class="err" id="err" role="alert"></div>
      </form>
      <script>
      (function(){
        const pad = document.getElementById('pad'), g = pad.getContext('2d'); let drawn = false, down = false;
        function size(){ const r = pad.getBoundingClientRect(), d = window.devicePixelRatio || 1; pad.width = r.width * d; pad.height = r.height * d; g.setTransform(d, 0, 0, d, 0, 0); g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111827'; g.fillStyle = '#fff'; g.fillRect(0, 0, r.width, r.height); drawn = false; }
        size(); window.addEventListener('orientationchange', () => setTimeout(size, 300));
        const pt = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        pad.addEventListener('pointerdown', e => { down = true; pad.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); });
        pad.addEventListener('pointermove', e => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); drawn = true; });
        ['pointerup', 'pointercancel'].forEach(t => pad.addEventListener(t, () => { down = false; }));
        document.getElementById('clearSig').onclick = size;
        const btn = document.getElementById('submitBtn'), err = document.getElementById('err');
        btn.onclick = async () => {
          err.textContent = '';
          const name = document.getElementById('name').value.trim();
          const comments = [...document.querySelectorAll('textarea[data-item]')].map(t => ({ room: t.dataset.room, item: t.dataset.item, text: t.value.trim() })).filter(c => c.text);
          let agree = document.querySelector('input[name=agree]:checked').value;
          if (comments.length && agree === 'yes') agree = 'comments';
          if (!name) { err.textContent = 'Please type your full name.'; return; }
          if (!drawn) { err.textContent = 'Please sign in the box.'; return; }
          btn.disabled = true; btn.textContent = 'Signing…';
          try {
            const res = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, agree, comments, general: document.getElementById('general').value.trim(), signature: pad.toDataURL('image/png') }) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'It could not be signed. Please try again.');
            location.reload();
          } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Sign the report'; }
        };
      })();
      </script>`));
  });

  // The report PDF (the signed copy once there is one).
  app.get(['/sign/:key/report.pdf', '/sign/:key/signed.pdf'], (req, res) => {
    const L = lookup(req.params.key);
    if (!L) return res.status(404).type('text/plain').send('Report not found.');
    const signedFile = signedPdf(L.id);
    const file = fs.existsSync(signedFile) ? signedFile : path.join(REPORTS_DIR, L.id + '.pdf');
    if (!fs.existsSync(file)) return res.status(404).type('text/plain').send('Report not found.');
    const name = String(L.r.fileName || 'report.pdf').replace(/\.pdf$/i, '') + (file === signedFile ? ' - signed' : '') + '.pdf';
    res.set('Cache-Control', 'no-store').type('application/pdf').set('Content-Disposition', 'inline; filename="' + name.replace(/["\\]/g, '') + '"');
    fs.createReadStream(file).pipe(res);
  });

  // Status for the app's finished screen.
  app.get('/api/sign/:key', (req, res) => {
    const L = lookup(req.params.key);
    if (!L) return res.status(404).json({ error: 'Report not found.' });
    const s = L.sign;
    res.set('Cache-Control', 'no-store').json(s ? { signed: true, name: s.name, at: s.at, agree: s.agree, comments: (s.comments || []).length + (s.general ? 1 : 0), pdf: '/sign/' + L.key + '/signed.pdf' } : { signed: false, ready: !!L.data });
  });

  app.post('/sign/:key', express.json({ limit: '2mb' }), async (req, res) => {
    if (!signLimit(clientIp(req))) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    const L = lookup(req.params.key);
    if (!L || !L.data) return res.status(404).json({ error: 'Report not found.' });
    if (L.sign) return res.status(409).json({ error: 'This report has already been signed.' });
    const b = req.body || {};
    const name = clip(b.name, 120);
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.signature || ''));
    if (!name) return res.status(400).json({ error: 'Please type your full name.' });
    if (!m || m[1].length < 200) return res.status(400).json({ error: 'Please sign in the box.' });
    const sig = Buffer.from(m[1], 'base64');
    if (sig.length > 1.5 * 1024 * 1024 || sig.slice(1, 4).toString() !== 'PNG') return res.status(400).json({ error: 'The signature could not be read. Please try again.' });
    const comments = (Array.isArray(b.comments) ? b.comments : []).slice(0, 200).map(c => ({ room: clip(c && c.room, 80), item: clip(c && c.item, 120), text: String((c && c.text) || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 600) })).filter(c => c.text);
    const general = String(b.general || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 2000);
    const sign = { name, agree: b.agree === 'comments' || comments.length ? 'comments' : 'yes', comments, general, at: new Date().toISOString(), device: deviceName(req.headers['user-agent']) };
    try {
      fs.writeFileSync(signedPdf(L.id), await signedCopy(path.join(REPORTS_DIR, L.id + '.pdf'), L, sign, sig));
    } catch (e) {
      console.error('signed copy failed', e);
      return res.status(500).json({ error: 'It could not be signed just now. Please try again.' });
    }
    fs.writeFileSync(path.join(photoDir(L.id), 'sign.json'), JSON.stringify(Object.assign({}, sign, { signature: 'data:image/png;base64,' + m[1] })));
    const meta = Object.assign({}, L.r, { tenantSignedAt: sign.at, tenantSignedBy: sign.name, tenantAgree: sign.agree });
    fs.writeFileSync(path.join(REPORTS_DIR, L.id + '.json'), JSON.stringify(meta, null, 2));
    console.log('report signed by the tenant: ' + L.id);
    notify({ title: 'Report signed by ' + name, message: [L.data.address || L.r.address, kindOf(L.data.type) + (sign.agree === 'comments' ? ' · with ' + (comments.length + (general ? 1 : 0)) + ' comment(s)' : ' · agreed')].join('\n'), tags: ['writing_hand'], click: PUBLIC_URL ? PUBLIC_URL + '/admin' : '' });
    res.json({ ok: true });
  });

  // A copy of the PDF with a "Tenant acknowledgement" page at the end (A4 landscape, like the report).
  async function signedCopy(file, L, sign, sigPng){
    const doc = await PDFDocument.load(fs.readFileSync(file));
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const safe = (t, f) => String(t || '').replace(/[\r\n\t]+/g, ' ').split('').map(ch => { try { f.encodeText(ch); return ch; } catch (e) { return ch === '→' ? '->' : '?'; } }).join('');
    const W = 841.89, H = 595.28, M = 34, ink = rgb(0.055, 0.075, 0.19), soft = rgb(0.29, 0.32, 0.45), accent = rgb(0.31, 0.27, 0.9), line = rgb(0.89, 0.9, 0.94);
    let pg, y;
    const newPage = () => {
      pg = doc.addPage([W, H]); y = H - M;
      pg.drawRectangle({ x: M, y: y - 26, width: 4, height: 22, color: accent });
      pg.drawText('Tenant acknowledgement', { x: M + 14, y: y - 20, size: 18, font: bold, color: ink });
      pg.drawText(safe('DIY Inventory  ·  ' + (L.data.address || L.r.address), font), { x: M, y: 20, size: 8, font, color: soft });
      y -= 50;
    };
    const wrap = (t, f, size, width) => {
      const words = safe(t, f).split(' '), out = []; let cur = '';
      words.forEach(w => { const next = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(next, size) > width && cur){ out.push(cur); cur = w; } else cur = next; });
      if (cur) out.push(cur);
      return out;
    };
    const para = (t, f, size, color, gap) => { wrap(t, f, size, W - 2 * M).forEach(l => { if (y < M + 30) newPage(); pg.drawText(l, { x: M, y, size, font: f, color }); y -= size * 1.45; }); y -= gap || 0; };
    newPage();
    const kind = kindOf(L.data.type);
    para('This page was added when the report was signed through its sign-off link. The report pages before it are unchanged.', font, 9.5, soft, 8);
    [['Property', L.data.address || L.r.address], ['Report', kind + (L.data.ref ? '  ·  ref ' + L.data.ref : '')], ['Signed by', sign.name],
     ['Signed on', new Date(sign.at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })],
     ['Agreement', sign.agree === 'comments' ? 'Agrees that the report is an accurate record, except for the comments below.' : 'Agrees that the report is an accurate record of the property.']]
      .forEach(([k, v]) => { pg.drawText(safe(k.toUpperCase(), bold), { x: M, y, size: 8, font: bold, color: soft }); const ls = wrap(v, font, 10.5, W - 2 * M - 120); ls.forEach((l, i) => pg.drawText(l, { x: M + 120, y: y - i * 14, size: 10.5, font, color: ink })); y -= Math.max(1, ls.length) * 14 + 6; });
    y -= 4;
    const img = await doc.embedPng(sigPng);
    const sw = 220, sh = Math.min(90, sw * img.height / img.width);
    if (y - sh < M + 30) newPage();
    pg.drawText('SIGNATURE', { x: M, y, size: 8, font: bold, color: soft });
    pg.drawImage(img, { x: M + 120, y: y - sh + 8, width: sh * img.width / img.height, height: sh });
    y -= sh + 6;
    pg.drawLine({ start: { x: M + 120, y }, end: { x: M + 120 + sw, y }, thickness: 0.6, color: line });
    y -= 26;
    if (sign.comments.length || sign.general){
      if (y < M + 80) newPage();
      pg.drawText('COMMENTS', { x: M, y, size: 9, font: bold, color: accent }); y -= 18;
      sign.comments.forEach(c => { para(c.room + '  ·  ' + c.item, bold, 9.5, ink, 0); para(c.text, font, 9.5, soft, 6); });
      if (sign.general){ para('General comments', bold, 9.5, ink, 0); para(sign.general, font, 9.5, soft, 6); }
    } else para('No comments were added.', font, 9.5, soft, 0);
    return Buffer.from(await doc.save());
  }

  return { signedPdf };
}

module.exports = { mount };
