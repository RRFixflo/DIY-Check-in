// A report PDF made on the server from a report's online backup (drafts.js), for when a phone finishes a
// report but its own PDF never arrives (the build failed on the phone, or the page was closed). It has what
// the backup has: the details, the front of the property, every room and item with its condition, details
// and photos (the date and time are already burned into each photo), meters, keys, notes and the signature.
// A4 landscape, pdf-lib, standard fonts (text is kept to characters they can show).
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const W = 841.89, H = 595.28, M = 36;
const NAVY = rgb(0.106, 0.18, 0.294), SOFT = rgb(0.35, 0.39, 0.45), LINE = rgb(0.85, 0.82, 0.76), PAPER = rgb(0.98, 0.965, 0.94);
const CONDITION = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor' };
const COND_COL = { new: rgb(0.13, 0.55, 0.42), good: rgb(0.2, 0.5, 0.25), fair: rgb(0.75, 0.5, 0.1), poor: rgb(0.72, 0.2, 0.15) };
const safe = t => String(t == null ? '' : t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/[^\x20-\x7E -ÿ•€]/g, '').trim();
const when = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }); };
const kindOf = t => /check-?in/i.test(t || '') ? 'Check-In' : /check-?out/i.test(t || '') ? 'Check-Out' : 'Inspection';

async function buildFromBackup(s, photoFile){
  const doc = await PDFDocument.create();
  const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold), T = await doc.embedFont(StandardFonts.TimesRomanBold);
  const m = s.meta || {}, pr = s.property || {};
  const cache = new Map();
  const photo = async p => {
    const id = p && p.id; if (!id) return null;
    if (!cache.has(id)) { let img = null; try { const f = photoFile(id); if (f && fs.existsSync(f)) img = await doc.embedJpg(fs.readFileSync(f)); } catch (e) {} cache.set(id, img); }
    return cache.get(id);
  };
  let page, y;
  const newPage = () => { page = doc.addPage([W, H]); page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER }); y = H - M;
    page.drawText(safe(kindOf(m.inspectionType) + ' - ' + (m.address || '')).slice(0, 120), { x: M, y: 18, size: 7.5, font: F, color: SOFT });
    page.drawText('Page ' + doc.getPageCount(), { x: W - M - 40, y: 18, size: 7.5, font: F, color: SOFT }); };
  const wrap = (text, font, size, width) => {
    const words = safe(text).split(/\s+/).filter(Boolean), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > width && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const text = (t, x, size, font, color, width) => { for (const l of wrap(t, font, size, width || W - 2 * M)) { if (y < M + size) newPage(); page.drawText(l, { x, y: y - size, size, font, color: color || NAVY }); y -= size + 3; } };
  const fit = (img, x, top, bw, bh) => { const r = Math.min(bw / img.width, bh / img.height), w = img.width * r, h = img.height * r; page.drawImage(img, { x: x + (bw - w) / 2, y: top - bh + (bh - h) / 2, width: w, height: h }); };
  const heading = t => { if (y < M + 60) newPage(); y -= 6; page.drawText(safe(t), { x: M, y: y - 18, size: 18, font: T, color: NAVY }); y -= 26; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE }); y -= 10; };

  /* cover */
  newPage();
  page.drawText(safe(kindOf(m.inspectionType) + ' report').toUpperCase(), { x: M, y: y - 10, size: 9, font: B, color: SOFT }); y -= 24;
  const half = W / 2 - M;
  for (const l of wrap(m.address || 'No address', T, 26, half - 10)) { page.drawText(l, { x: M, y: y - 26, size: 26, font: T, color: NAVY }); y -= 32; }
  y -= 8;
  [['Report type', m.inspectionType], ['Reference', m.ref], ['Carried out by', m.inspectorName], ['Signed by', m.signedBy || m.inspectorName], ['Started', when(m.createdAt || s._createdAt)], ['Finished', when(s.finalizedAt)], ['Move-in date', m.moveInDateTime ? when(m.moveInDateTime) : ''], ['Managing agent', m.managingAgent]]
    .filter(([, v]) => v).forEach(([k, v]) => { page.drawText(safe(k), { x: M, y: y - 10, size: 9, font: F, color: SOFT }); page.drawText(safe(v).slice(0, 70), { x: M + 110, y: y - 10, size: 10, font: B, color: NAVY }); y -= 17; });
  const front = await photo(((pr.exterior || {}).photos || [])[0]);
  if (front) fit(front, W / 2, H - M, half, H - 2 * M - 60);
  y -= 10;
  text('This copy of the report was made from its online backup, because the PDF made on the phone did not arrive. It has the same details, conditions and photos; the date and time on each photo were burned in when it was taken.', M, 8.5, F, SOFT, half - 10);

  /* rooms: every item as a card, two to a row */
  const cardW = (W - 2 * M - 16) / 2, cardH = 150, phW = 150;
  for (const r of s.rooms || []) {
    newPage(); heading(r.name || 'Room');
    const items = (r.items || []);
    for (let i = 0; i < items.length; i += 2) {
      if (y - cardH < M + 20) { newPage(); heading((r.name || 'Room') + ' (continued)'); }
      for (let k = 0; k < 2 && i + k < items.length; k++) {
        const it = items[i + k], x = M + k * (cardW + 16), top = y;
        page.drawRectangle({ x, y: top - cardH, width: cardW, height: cardH, color: rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.6 });
        const img = await photo((it.photos || [])[0]);
        if (img) fit(img, x + 6, top - 6, phW, cardH - 12);
        else page.drawText(it.notApplicable ? 'Not applicable' : 'No photo', { x: x + 40, y: top - cardH / 2, size: 9, font: F, color: SOFT });
        const tx = x + phW + 16, tw = cardW - phW - 24; let ty = top - 8;
        for (const l of wrap(it.label || 'Item', B, 10.5, tw).slice(0, 2)) { page.drawText(l, { x: tx, y: ty - 10.5, size: 10.5, font: B, color: NAVY }); ty -= 14; }
        const cond = it.notApplicable ? 'Not applicable' : CONDITION[it.condition] || 'Condition not recorded';
        page.drawText(safe(cond), { x: tx, y: ty - 10, size: 10, font: B, color: COND_COL[it.condition] || SOFT }); ty -= 16;
        const details = it.notApplicable ? [it.naReason] : [it.desc, (it.defects || []).filter(d => d !== 'None').join(', '), it.clean ? ({ clean: 'Clean', needs: 'Needs a clean', dirty: 'Dirty' }[it.clean] || '') : '', it.working === 'no' ? 'Not working' : it.working === 'yes' ? 'Working' : '', it.qty ? 'Quantity: ' + it.qty : '', it.conditionNote ? 'Note: ' + it.conditionNote : ''];
        for (const l of wrap(details.filter(Boolean).join(' · '), F, 8.5, tw).slice(0, 8)) { page.drawText(l, { x: tx, y: ty - 8.5, size: 8.5, font: F, color: SOFT }); ty -= 11; }
        const more = (it.photos || []).length - 1;
        if (more > 0) page.drawText('+ ' + more + ' more photo' + (more === 1 ? '' : 's') + ' (end of this room)', { x: tx, y: top - cardH + 8, size: 7.5, font: F, color: SOFT });
      }
      y -= cardH + 12;
    }
    // Every other photo of the room (extra item photos and general views), four to a row.
    const rest = [];
    items.forEach(it => (it.photos || []).slice(1).forEach(p => rest.push([p, it.label])));
    (r.extraPhotos || []).forEach(p => rest.push([p, 'General view']));
    if (rest.length) {
      const tw = (W - 2 * M - 30) / 4, th = 120;
      if (y < M + th + 70) { newPage(); heading((r.name || 'Room') + ': more photos'); } else { text('More photos', M, 11, B); y -= 4; }
      for (let i = 0; i < rest.length; i += 4) {
        if (y - th - 14 < M + 20) newPage();
        for (let k = 0; k < 4 && i + k < rest.length; k++) {
          const [p, label] = rest[i + k], img = await photo(p), x = M + k * (tw + 10);
          if (img) fit(img, x, y, tw, th);
          page.drawText(safe(label).slice(0, 40), { x, y: y - th - 10, size: 7.5, font: F, color: SOFT });
        }
        y -= th + 20;
      }
    }
    if (r.notes) { y -= 4; text('Notes: ' + r.notes, M, 9, F, SOFT); }
  }

  /* meters and keys */
  const meters = Object.entries(pr.meters || {}).filter(([, v]) => v), keys = pr.keys || [];
  if (meters.length || keys.length) {
    newPage(); heading('Meters and keys');
    for (const [k, v] of meters) {
      if (y < M + 130) newPage();
      text(k.charAt(0).toUpperCase() + k.slice(1) + ' meter: ' + (v.na ? 'not applicable' : [v.reading ? 'reading ' + v.reading : '', v.serial ? 'serial ' + v.serial : '', v.location].filter(Boolean).join(' · ') || 'no reading'), M, 11, B);
      const img = await photo((v.photos || [])[0]); if (img) { fit(img, M, y - 2, 200, 110); y -= 118; }
    }
    for (const kk of keys) {
      if (y < M + 130) newPage();
      text('Keys: ' + ([kk.desc, kk.action].filter(Boolean).join(' · ') || 'not described'), M, 11, B);
      const img = await photo((kk.photos || [])[0]); if (img) { fit(img, M, y - 2, 200, 110); y -= 118; }
    }
  }

  /* declaration and signature */
  newPage(); heading('Declaration and signature');
  text('The person below confirmed in the app that this report is a true and honest record of the property\'s condition on the date shown, and signed it on the phone.', M, 10, F, NAVY);
  y -= 6;
  text('Signed by ' + (m.signedBy || m.inspectorName || '-') + (s.finalizedAt ? ' on ' + when(s.finalizedAt) : ''), M, 11, B);
  const sig = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(s.signatureDataUrl || ''));
  if (sig) { try { const img = sig[1] === 'png' ? await doc.embedPng(Buffer.from(sig[2], 'base64')) : await doc.embedJpg(Buffer.from(sig[2], 'base64')); fit(img, M, y - 6, 260, 110); y -= 120; } catch (e) {} }
  doc.setTitle(safe(kindOf(m.inspectionType) + ' - ' + (m.address || ''))); doc.setProducer('DIY Inventory');
  return Buffer.from(await doc.save());
}

module.exports = { buildFromBackup };
