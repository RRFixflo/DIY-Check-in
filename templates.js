// Free inventory templates and the "inventory clerk" page, for people searching for either.
// - /inventory-template, /check-out-report-template, /inspection-report-template: a page each, with a free
//   printable PDF (pdf-lib, A4 portrait) and an editable Word version (HTML saved as .doc, which Word opens),
//   made from the app's own room checklists, so they follow the app. Each ends with a line about doing it on
//   a phone instead.
// - /inventory-clerk: what an inventory clerk does, what it costs, and doing it yourself for £30.
// Mounted from seo.js, which adds the pages to the sitemap and llms.txt.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ROOMS = [['hallway', 'Hallway and entrance'], ['living', 'Living room'], ['kitchen', 'Kitchen'], ['bedroom', 'Bedroom'], ['bathroom', 'Bathroom'], ['wc', 'Separate WC'], ['utility', 'Utility room'], ['garden', 'Garden and outdoor space']];
const KINDS = {
  inventory: { file: 'inventory-template', page: '/inventory-template', name: 'Inventory and check-in report', short: 'Inventory template',
    cols: ['Item', 'Description (colour, material, type)', 'Condition', 'Clean?', 'Notes / photo no.'], widths: [0.24, 0.3, 0.12, 0.09, 0.25] },
  checkout: { file: 'check-out-report-template', page: '/check-out-report-template', name: 'Check-out report', short: 'Check-out report template',
    cols: ['Item', 'At check-in', 'At check-out', 'Clean?', 'Changes / damage / photo no.'], widths: [0.24, 0.16, 0.16, 0.09, 0.35] },
  inspection: { file: 'inspection-report-template', page: '/inspection-report-template', name: 'Mid-term inspection report', short: 'Inspection report template',
    cols: ['Item', 'Condition', 'Clean?', 'Issue? (damp, leak, damage)', 'Action needed / photo no.'], widths: [0.24, 0.12, 0.09, 0.25, 0.3] },
};
const SITE = 'diyinventory.co.uk';

function mount(app, { C, renderPage, escHtml, head, crumbs, PUBLIC_BASE }){
  const e = escHtml;
  const items = type => (C.ROOM_TYPE_ITEMS[type] || []).map(i => i.replace(/\s*\([^)]*\)\s*$/, '').trim() || i);   // "Front door (photographed from inside and out)" → "Front door"
  const base = () => (PUBLIC_BASE || 'https://' + SITE);

  /* ------------------------------------------------------------------ the printable PDF */
  const cache = new Map();
  async function pdf(kind){
    if (cache.has(kind)) return cache.get(kind);
    const K = KINDS[kind], doc = await PDFDocument.create();
    doc.setTitle(K.name + ' template'); doc.setAuthor('DIY Inventory'); doc.setCreator('DIY Inventory · ' + SITE);
    const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold), T = await doc.embedFont(StandardFonts.TimesRomanBold);
    const W = 595.28, H = 841.89, M = 36, navy = rgb(27 / 255, 46 / 255, 75 / 255), soft = rgb(90 / 255, 100 / 255, 117 / 255), line = rgb(0.78, 0.74, 0.67), paper = rgb(245 / 255, 239 / 255, 228 / 255), camel = rgb(196 / 255, 154 / 255, 108 / 255);
    const safe = s => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    const fit = (s, font, size, w) => { s = safe(s); while (s && font.widthOfTextAtSize(s, size) > w) s = s.slice(0, -1); return s; };
    let pg, y; const pages = [];
    const newPage = () => { pg = doc.addPage([W, H]); pages.push(pg); y = H - M; };
    const text = (s, x, yy, font, size, color) => pg.drawText(safe(s), { x, y: yy, font, size, color: color || navy });
    const need = h => { if (y - h < 60) newPage(); };
    const heading = s => { need(40); y -= 8; pg.drawRectangle({ x: M, y: y - 16, width: 3, height: 18, color: navy }); text(s, M + 10, y - 12, T, 15); y -= 28; };
    const fields = (list, cols) => {   // label + a line to write on, in 1 or 2 columns
      const cw = (W - 2 * M - (cols - 1) * 16) / cols;
      for (let i = 0; i < list.length; i += cols) {
        need(30);
        list.slice(i, i + cols).forEach((l, k) => { const x = M + k * (cw + 16); text(l.toUpperCase(), x, y - 9, B, 7, soft); pg.drawLine({ start: { x, y: y - 26 }, end: { x: x + cw, y: y - 26 }, thickness: 0.6, color: line }); });
        y -= 34;
      }
    };
    const table = (cols, widths, rows, rowH) => {
      const tw = W - 2 * M, xs = []; let x = M; widths.forEach(w => { xs.push(x); x += w * tw; }); xs.push(M + tw);
      const headRow = () => { need(22 + rowH); pg.drawRectangle({ x: M, y: y - 18, width: tw, height: 18, color: paper }); cols.forEach((c, i) => text(fit(c, B, 7.5, xs[i + 1] - xs[i] - 6), xs[i] + 3, y - 12, B, 7.5)); y -= 18; };
      headRow();
      rows.forEach(r => {
        if (y - rowH < 60) { newPage(); headRow(); }
        pg.drawLine({ start: { x: M, y: y - rowH }, end: { x: M + tw, y: y - rowH }, thickness: 0.5, color: line });
        xs.forEach(xx => pg.drawLine({ start: { x: xx, y }, end: { x: xx, y: y - rowH }, thickness: 0.5, color: line }));
        r.forEach((c, i) => c && text(fit(c, i ? F : B, 8, xs[i + 1] - xs[i] - 6), xs[i] + 3, y - 12, i ? F : B, 8, i ? soft : navy));
        y -= rowH;
      });
      y -= 10;
    };
    newPage();
    text('FREE TEMPLATE', M, y - 10, B, 8, camel);
    text(K.name, M, y - 36, T, 24); y -= 52;
    text('Fill in one row per item. Condition: N = new, G = good, F = fair, P = poor. Number your photos and write the number in the last column.', M, y - 8, F, 8.5, soft); y -= 22;
    heading('Property and tenancy');
    fields(['Property address', 'Postcode', kind === 'checkout' ? 'Check-out date' : kind === 'inspection' ? 'Inspection date' : 'Check-in date', 'Tenancy start date', 'Landlord / agent', 'Tenant(s)', 'Inspected by', 'Furnished / part / unfurnished'], 2);
    heading('Meter readings');
    table(['Meter', 'Serial number', 'Reading', 'Location', 'Photo no.'], [0.16, 0.26, 0.2, 0.22, 0.16], [['Electricity'], ['Gas'], ['Water']].map(r => r.concat(['', '', '', ''])), 22);
    heading('Keys');
    table(['Key / fob / remote', 'Quantity', kind === 'checkout' ? 'Returned?' : 'Given to', 'Photo no.'], [0.4, 0.15, 0.25, 0.2], Array.from({ length: 4 }, () => ['', '', '', '']), 22);
    heading('Smoke and carbon monoxide alarms');
    table(['Location', 'Type (smoke / CO / heat)', 'Tested and working?', 'Photo no.'], [0.34, 0.24, 0.22, 0.2], Array.from({ length: 3 }, () => ['', '', '', '']), 22);
    heading('Outside and front of the property');
    table(K.cols, K.widths, ['Front of property', 'Front door (outside)', 'Windows (outside)', 'Bins and bin store', ''].map(i => [i, '', '', '', '']), 22);
    for (const [type, label] of ROOMS) {
      const list = items(type); if (!list.length) continue;
      heading(label + (type === 'bedroom' || type === 'bathroom' ? ' (copy this page for each one)' : ''));
      table(K.cols, K.widths, list.concat(['General view', '']).map(i => [i, '', '', '', '']), 22);
      fields(['Overall condition and cleanliness of the room'], 1);
    }
    heading('Declaration');
    need(150);
    const decl = kind === 'checkout' ? 'We agree this report is a fair record of the property at the end of the tenancy, compared with the check-in report.' : kind === 'inspection' ? 'This report records the condition of the property on the date of the inspection.' : 'We agree this inventory is a fair record of the property and its contents at the start of the tenancy. The tenant has 7 days to add comments in writing.';
    text(decl, M, y - 8, F, 8.5, soft); y -= 26;
    fields(['Landlord / agent: name', 'Signature and date', 'Tenant: name', 'Signature and date'], 2);
    pages.forEach((p, i) => {
      const s1 = 'Free template from DIY Inventory. Or do it on your phone, with dated photos and the PDF report ready when signed: ' + SITE;
      p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: line });
      p.drawText(safe(s1).slice(0, 150), { x: M, y: 28, font: F, size: 7, color: soft });
      const n = 'Page ' + (i + 1) + ' of ' + pages.length; p.drawText(n, { x: W - M - F.widthOfTextAtSize(n, 7), y: 16, font: F, size: 7, color: soft });
    });
    const out = Buffer.from(await doc.save()); cache.set(kind, out); return out;
  }

  /* ------------------------------------------------------------------ the editable Word version */
  function word(kind){
    const K = KINDS[kind];
    const tbl = (cols, rows) => `<table><tr>${cols.map(c => `<th>${e(c)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? '' : ' class="i"'}>${e(c) || '&nbsp;'}</td>`).join('')}</tr>`).join('')}</table>`;
    const blank = (cols, n, first) => Array.from({ length: n }, (_, i) => [first ? first[i] || '' : ''].concat(cols.slice(1).map(() => '')));
    const rooms = ROOMS.filter(([t]) => items(t).length).map(([t, label]) => `<h2>${e(label)}</h2>${tbl(K.cols, items(t).concat(['General view', '']).map(i => [i].concat(K.cols.slice(1).map(() => ''))))}<p class="f">Overall condition and cleanliness: ______________________________________________</p>`).join('');
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${e(K.name)} template</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page{size:21cm 29.7cm;margin:1.6cm}body{font-family:Arial,sans-serif;font-size:10pt;color:#13213A}h1{font-family:Georgia,serif;font-size:22pt;margin:0 0 4pt}h2{font-family:Georgia,serif;font-size:13pt;margin:14pt 0 4pt;border-left:3pt solid #1B2E4B;padding-left:6pt}table{border-collapse:collapse;width:100%;margin:0 0 6pt}th{background:#F5EFE4;text-align:left;font-size:8.5pt;padding:4pt;border:0.5pt solid #C7BCAA}td{border:0.5pt solid #C7BCAA;padding:4pt;height:16pt;font-size:9pt}td.i{font-weight:bold}.k{color:#C49A6C;font-weight:bold;font-size:8pt;letter-spacing:1pt}.f{color:#5A6475;font-size:9pt}.foot{color:#5A6475;font-size:8pt;margin-top:18pt}</style></head><body>
<p class="k">FREE TEMPLATE</p><h1>${e(K.name)}</h1><p class="f">Fill in one row per item. Condition: N = new, G = good, F = fair, P = poor. Number your photos and write the number in the last column.</p>
<h2>Property and tenancy</h2>${tbl(['Detail', 'Answer'], ['Property address', 'Postcode', kind === 'checkout' ? 'Check-out date' : kind === 'inspection' ? 'Inspection date' : 'Check-in date', 'Tenancy start date', 'Landlord / agent', 'Tenant(s)', 'Inspected by', 'Furnished / part / unfurnished'].map(l => [l, '']))}
<h2>Meter readings</h2>${tbl(['Meter', 'Serial number', 'Reading', 'Location', 'Photo no.'], blank([0, 1, 2, 3, 4], 3, ['Electricity', 'Gas', 'Water']))}
<h2>Keys</h2>${tbl(['Key / fob / remote', 'Quantity', kind === 'checkout' ? 'Returned?' : 'Given to', 'Photo no.'], blank([0, 1, 2, 3], 4))}
<h2>Smoke and carbon monoxide alarms</h2>${tbl(['Location', 'Type (smoke / CO / heat)', 'Tested and working?', 'Photo no.'], blank([0, 1, 2, 3], 3))}
<h2>Outside and front of the property</h2>${tbl(K.cols, ['Front of property', 'Front door (outside)', 'Windows (outside)', 'Bins and bin store', ''].map(i => [i].concat(K.cols.slice(1).map(() => ''))))}
${rooms}
<h2>Declaration</h2><p class="f">${kind === 'checkout' ? 'We agree this report is a fair record of the property at the end of the tenancy, compared with the check-in report.' : kind === 'inspection' ? 'This report records the condition of the property on the date of the inspection.' : 'We agree this inventory is a fair record of the property and its contents at the start of the tenancy. The tenant has 7 days to add comments in writing.'}</p>
${tbl(['', 'Name', 'Signature', 'Date'], [['Landlord / agent', '', '', ''], ['Tenant', '', '', '']])}
<p class="foot">Free template from DIY Inventory. Or do it on your phone, with dated photos and the PDF report ready the moment it's signed: <a href="${e(base())}">${SITE}</a></p></body></html>`;
  }

  Object.keys(KINDS).forEach(kind => {
    const K = KINDS[kind];
    app.get('/templates/' + K.file + '.pdf', async (req, res) => {
      try { const b = await pdf(kind); res.set({ 'Content-Disposition': (req.query.download ? 'attachment' : 'inline') + '; filename="' + K.name + ' template - DIY Inventory.pdf"', 'Cache-Control': 'public, max-age=86400' }).type('pdf').send(b); }
      catch (err) { console.error('template pdf failed:', err.message); res.status(500).type('text/plain').send('Sorry, the template could not be made. Please try again.'); }
    });
    app.get('/templates/' + K.file + '.doc', (req, res) => {
      res.set({ 'Content-Disposition': 'attachment; filename="' + K.name + ' template - DIY Inventory.doc"', 'Cache-Control': 'public, max-age=86400' }).type('application/msword').send(word(kind));
    });
  });

  /* ------------------------------------------------------------------ the pages */
  const dl = kind => { const K = KINDS[kind]; return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0"><a class="btn primary" href="/templates/${K.file}.pdf?download=1">⬇ Download PDF (printable)</a><a class="btn ghost" href="/templates/${K.file}.doc">⬇ Download Word (editable)</a><a class="btn ghost" href="/templates/${K.file}.pdf" target="_blank" rel="noopener">Preview</a></div>`; };
  const vsApp = `<div class="card" style="margin-top:18px"><h2 style="margin-top:0">Quicker: do it on your phone instead</h2><p>A paper template works, but photos and notes end up in different places. DIY Inventory does the same job on your phone: every room gets its own checklist, the camera steps through each item and stamps the date and time on every photo, and the finished PDF report (with every photo in it) is ready the moment it’s signed. The tenant can check and sign it from a link.</p><p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="/app">Start free</a><a class="btn ghost" href="/example-report">See an example report</a></p><p class="sub" style="margin:0">Free to start, £30 when you download the finished report. No subscription.</p></div>`;
  const roomList = `<h2>What’s in it</h2><ul><li>Property and tenancy details, meter readings, keys, and smoke and carbon monoxide alarms.</li><li>Outside and the front of the property.</li>${ROOMS.filter(([t]) => items(t).length).map(([t, label]) => `<li><a href="/checklists/${t === 'living' ? 'living-room' : t === 'utility' ? 'utility-room' : t}">${e(label)}</a>: ${e(items(t).slice(0, 5).join(', '))} and ${Math.max(0, items(t).length - 5)} more.</li>`).join('')}<li>A declaration and signatures for both sides.</li></ul>`;
  const others = kind => `<h2>Other free templates</h2><p>${Object.keys(KINDS).filter(k => k !== kind).map(k => `<a href="${KINDS[k].page}">${e(KINDS[k].short)}</a>`).join(' · ')} · <a href="/checklists">Room-by-room checklists</a> · <a href="/inventory-clerk">Inventory clerk or do it yourself?</a></p>`;
  const faqBlock = faqs => `<h2>Questions</h2><div class="faq">${faqs.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div>`;
  const faqLd = faqs => ({ '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  const docLd = (b, kind, title, desc) => ({ '@type': 'DigitalDocument', name: KINDS[kind].name + ' template', description: desc, url: b + KINDS[kind].page, encodingFormat: ['application/pdf', 'application/msword'], isAccessibleForFree: true, inLanguage: 'en-GB', publisher: { '@id': b + '/#org' },
    hasPart: [{ '@type': 'MediaObject', contentUrl: b + '/templates/' + KINDS[kind].file + '.pdf', encodingFormat: 'application/pdf' }, { '@type': 'MediaObject', contentUrl: b + '/templates/' + KINDS[kind].file + '.doc', encodingFormat: 'application/msword' }] });

  const pages = [];
  // The main one: "inventory template", "property inventory template", "inventory template word / pdf", "check-in inventory template".
  {
    const faqs = [
      ['Is the inventory template really free?', 'Yes. Download the PDF or Word version and use it as often as you like, for any property. No sign-up.'],
      ['Can I edit the template in Word?', 'Yes. The Word version opens in Microsoft Word, Google Docs (upload it, then open with Docs) and Pages. Add or remove rows and rooms as you need.'],
      ['What should a property inventory include?', 'The address and tenancy details, meter readings, keys, smoke and carbon monoxide alarms, and every room item by item: what it is, its condition, how clean it is, and any marks or damage, with dated photos. Both sides sign it.'],
      ['Is a template enough for a deposit dispute?', 'A signed inventory with clear, dated photos of every room is the evidence deposit schemes look at. A paper template is fine if the photos are taken and kept with it; the app does that for you, with the date and time on every photo and everything in one PDF. General information, not legal advice.'],
      ['Do I need an inventory clerk?', 'No. Landlords, agents and tenants can do the inventory themselves. What matters is that it is thorough, photographed, dated and signed by both sides.'],
    ];
    const title = 'Free inventory template (PDF and Word)';
    const desc = 'Free property inventory template for landlords, agents and tenants: a room-by-room check-in inventory with meters, keys, alarms and signatures. Download as a printable PDF or an editable Word document.';
    pages.push({ key: 'templates', path: '/inventory-template', title: title + ' · DIY Inventory', og: title, desc,
      body: head('Free download', 'Free inventory template', 'A complete room-by-room property inventory and check-in template for landlords, letting agents and tenants. Printable PDF or editable Word, free, no sign-up.') +
        `<section class="tight"><div class="wrap"><div class="card prose">${dl('inventory')}<p>Use it at the start of a tenancy to record the condition of the property and everything in it. It’s made from the same room checklists our app uses, so nothing important is missed.</p>${roomList}
        <h2>How to fill it in</h2><ol><li>Do it just before the tenant moves in, with the property clean and empty of your own things.</li><li>Go room by room in the order you walk round: outside, hallway, living room, kitchen, bedrooms, bathrooms.</li><li>For each item, write what it is (colour, material, type), its condition (new, good, fair or poor) and whether it’s clean. Note every mark, chip or stain.</li><li>Take a wide photo of each room from the door and a photo of every item, plus close-ups of any damage. Number them and write the number in the last column.</li><li>Read the meters, list the keys, and test the alarms.</li><li>Both sides sign and date it. Give the tenant a copy and 7 days to add comments.</li></ol>
        ${faqBlock(faqs)}${others('inventory')}</div>${vsApp}</div></section>`,
      jsonld: b => [crumbs(b, [['Home', '/'], ['Free inventory template', '/inventory-template']]), docLd(b, 'inventory', title, desc), faqLd(faqs)] });
  }
  {
    const faqs = [
      ['What is a check-out report?', 'A record of the property’s condition when the tenant leaves, item by item, compared with the check-in inventory. It is what any deduction from the deposit is based on.'],
      ['How do I compare check-out with check-in?', 'Put the check-in condition next to the check-out condition for every item, and note what has changed beyond fair wear and tear, with photos. The app does this for you, with the two sets of photos side by side.'],
      ['Is the check-out template free?', 'Yes, as a printable PDF and an editable Word document, with no sign-up.'],
    ];
    const title = 'Free check-out report template (PDF and Word)';
    const desc = 'Free check-out report template: compare every item with the check-in inventory, record changes and damage, meters and keys returned. Printable PDF or editable Word.';
    pages.push({ key: 'templates', path: '/check-out-report-template', title: title + ' · DIY Inventory', og: title, desc,
      body: head('Free download', 'Free check-out report template', 'Record the property at the end of the tenancy, with the check-in condition beside the check-out condition for every item. Printable PDF or editable Word.', ['Inventory template', '/inventory-template']) +
        `<section class="tight"><div class="wrap"><div class="card prose">${dl('checkout')}<p>For each item there are columns for its condition at check-in and at check-out, and for what has changed. Meter readings and keys returned are at the front, and both sides sign at the end.</p>${roomList}
        <h2>Fair wear and tear</h2><p>Normal wear from everyday living isn’t damage. Read <a href="/guides/fair-wear-and-tear-vs-damage">fair wear and tear vs damage</a> and <a href="/guides/check-out-inspection-guide">how to do a check-out inspection</a>.</p>
        ${faqBlock(faqs)}${others('checkout')}</div>${vsApp}</div></section>`,
      jsonld: b => [crumbs(b, [['Home', '/'], ['Free inventory template', '/inventory-template'], ['Check-out report template', '/check-out-report-template']]), docLd(b, 'checkout', title, desc), faqLd(faqs)] });
  }
  {
    const faqs = [
      ['How often should a landlord inspect a rented property?', 'Many landlords inspect every 3 to 6 months, with proper notice to the tenant (at least 24 hours in England). Check the tenancy agreement.'],
      ['What should a mid-term inspection check?', 'Damp and mould, leaks, smoke and carbon monoxide alarms, appliances, signs of damage or unauthorised occupants or pets, and the garden, room by room.'],
      ['Can someone else do the inspection for me?', 'Yes. You can send a contractor or the tenant a link from the app; their photos are sorted into rooms and turned into a report.'],
    ];
    const title = 'Free property inspection report template (PDF and Word)';
    const desc = 'Free mid-term property inspection template for landlords: room by room, with columns for issues such as damp, leaks and damage, and actions needed. Printable PDF or editable Word.';
    pages.push({ key: 'templates', path: '/inspection-report-template', title: title + ' · DIY Inventory', og: title, desc,
      body: head('Free download', 'Free property inspection template', 'A room-by-room mid-term (routine) inspection report for landlords, with columns for issues and actions. Printable PDF or editable Word.', ['Inventory template', '/inventory-template']) +
        `<section class="tight"><div class="wrap"><div class="card prose">${dl('inspection')}<p>Use it for routine inspections during the tenancy. Each item has columns for condition, cleanliness, any issue (damp, a leak, damage) and the action needed.</p>${roomList}
        <p>See also the <a href="/guides/mid-tenancy-inspection-checklist">mid-tenancy inspection checklist</a>.</p>
        ${faqBlock(faqs)}${others('inspection')}</div>${vsApp}</div></section>`,
      jsonld: b => [crumbs(b, [['Home', '/'], ['Free inventory template', '/inventory-template'], ['Inspection report template', '/inspection-report-template']]), docLd(b, 'inspection', title, desc), faqLd(faqs)] });
  }
  // "inventory clerk", "inventory clerk near me", "inventory clerk cost", "do I need an inventory clerk".
  {
    const faqs = [
      ['What does an inventory clerk do?', 'An inventory clerk visits the property and records its condition and contents room by room, with photos, at check-in, at check-out and sometimes during the tenancy. They then write it up as a report for the landlord or agent.'],
      ['How much does an inventory clerk cost?', 'Clerks usually charge for each visit, with the price going up with the size of the property and whether it is furnished, so a check-in and a check-out for a family home can cost a few hundred pounds together. With DIY Inventory each report is £30, whatever the size of the property.'],
      ['Do I need an inventory clerk, or can I do the inventory myself?', 'There is no rule that it must be done by a clerk. A landlord, agent or tenant can do it, as long as it is thorough, photographed, dated and signed by both sides, which is what the app is built for.'],
      ['Is a DIY inventory accepted for deposit disputes?', 'Deposit schemes look at the evidence: a detailed, signed check-in report with clear, dated photos, compared with the check-out. A DIY report made with the app gives you exactly that. General information, not legal advice.'],
      ['Can my tenant do the check-in for me?', 'Yes. Send them a link and they do the check-in on their phone; you get the finished report, and each side can check and sign it.'],
      ['I still want an inventory clerk near me. Can you help?', 'We don’t send clerks. If you would rather not do it yourself, the app lets you send the tenant or a contractor a link to do it for you, and you still get a full report.'],
    ];
    const title = 'Inventory clerk: what they do, what it costs, and the £30 alternative';
    const desc = 'Looking for an inventory clerk? What a clerk does, what it usually costs, and how landlords, agents and tenants now do the check-in, check-out and inspection themselves on a phone for £30 a report.';
    pages.push({ key: 'templates', path: '/inventory-clerk', title: 'Inventory clerk? Do your own inventory for £30 · DIY Inventory', og: title, desc,
      body: head('Inventory clerk', 'Looking for an inventory clerk?', 'Do the check-in, check-out or inspection yourself on your phone instead, for £30 a report, or send your tenant a link to do it. Same thorough report, ready the moment it’s signed.') +
        `<section class="tight"><div class="wrap"><div class="card prose">
        <h2>Inventory clerk or DIY Inventory?</h2>
        <table class="cmp"><tr><th></th><th>Inventory clerk</th><th>DIY Inventory</th></tr>
        <tr><td>Price</td><td>Per visit, more for bigger or furnished homes</td><td><b>£30 a report</b>, any size</td></tr>
        <tr><td>When</td><td>When a clerk is free to visit</td><td><b>Whenever you have the keys</b>, today</td></tr>
        <tr><td>Report ready</td><td>Usually days later</td><td><b>The moment it’s signed</b></td></tr>
        <tr><td>Photos</td><td>Taken by the clerk</td><td>Every item, <b>date and time stamped</b>, at least 8 per room</td></tr>
        <tr><td>Check-out</td><td>Another visit and fee</td><td>Starts from the check-in and <b>shows what changed</b>, photos side by side</td></tr>
        <tr><td>Signed by</td><td>Usually just the clerk</td><td><b>Both sides</b>, the tenant from a link</td></tr></table>
        <h2>How it works</h2><ol><li>Open the app on your phone and enter the address. Each room gets its own photo checklist.</li><li>The camera steps through every item, stamps the date and time on each photo<!--AI-->, and AI suggests the condition<!--/AI-->.</li><li>Read the meters, list the keys, test the alarms.</li><li>Sign, and the PDF report is ready. Send the tenant a link to check and sign it too.</li></ol>
        <p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="/app">Start free</a><a class="btn ghost" href="/example-report">See an example report</a><a class="btn ghost" href="/inventory-template">Free inventory template</a></p>
        ${faqBlock(faqs)}
        <h2>In your area</h2><p>Inventory reports in <a href="/inventory-reports/london">London</a>, <a href="/inventory-reports/manchester">Manchester</a>, <a href="/inventory-reports/birmingham">Birmingham</a>, <a href="/inventory-reports/leeds">Leeds</a>, <a href="/inventory-reports/bristol">Bristol</a> and <a href="/inventory-reports">every other area</a>.</p>
        </div></div></section>`,
      jsonld: b => [crumbs(b, [['Home', '/'], ['Inventory clerk', '/inventory-clerk']]), faqLd(faqs),
        { '@type': 'Service', name: 'Do-it-yourself property inventory (instead of an inventory clerk)', serviceType: 'Property inventory, check-in and check-out reports', provider: { '@id': b + '/#org' }, areaServed: 'Worldwide', offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } }] });
  }

  const css = '<style>.cmp{width:100%;border-collapse:collapse;margin:8px 0 16px}.cmp th,.cmp td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line,#E4D9C6);vertical-align:top}.cmp th{font-size:14px}.cmp td:first-child{font-weight:700;width:22%}@media(max-width:560px){.cmp td,.cmp th{padding:8px 6px;font-size:14px}}</style>';
  pages.forEach(pg => { pg.head = css; app.get([pg.path, pg.path + '/'], (req, res) => res.type('html').send(renderPage(pg, req))); });
  return {
    paths: pages.map(p => p.path),
    bodies: pages.map(p => p.body),
    llms: b => pages.map(p => '- [' + p.og + '](' + b + p.path + '): ' + p.desc),
  };
}

module.exports = { mount, KINDS };
