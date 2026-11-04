// Tenant referencing PDFs (A4 portrait, pdf-lib), in the website's navy and beige:
//   reportPdf(r)       the interim or final report: summary strip, outcome (identity, background, income = result), the
//                      property and the applicant, Right to Rent, verification of earnings, previous landlord, addresses,
//                      public information and credit, every check, documents and consent
//   applicationPdf(r)  the application form as the applicant sent it
//   consentPdf(r)      the consents and declaration they signed, with when and from where
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { assess, stage, headline, pounds } = require('./assess');
const { day, when } = require('./util');
const BRAND = 'DIY Inventory';

// Standard PDF fonts only cover Windows-1252: swap the characters they can't draw.
const safe = s => String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/×/g, 'x').replace(/[^\x20-\x7e\xa0-\xff£€]/g, '');
const C = { ink: rgb(.06, .11, .15), ink2: rgb(.24, .29, .34), mute: rgb(.48, .53, .58), line: rgb(.86, .87, .86), navy: rgb(.08, .14, .23), paper: rgb(.97, .955, .93), white: rgb(1, 1, 1), camel: rgb(.77, .6, .42),
  pass: rgb(.05, .55, .37), na: rgb(.05, .55, .37), warn: rgb(.85, .55, .05), fail: rgb(.76, .2, .12), pending: rgb(.55, .62, .69) };
const OUT = { accepted: 'pass', guarantor: 'warn', checks: 'fail', progress: 'pending', waiting: 'pending' };
const tenantName = r => { const a = r.application || {}; return [a.firstName, a.lastName].filter(Boolean).join(' ') || (r.tenant && r.tenant.name) || 'Applicant'; };
const refNo = r => 'RF-' + String(r.id).slice(-6).toUpperCase();
const gbp = p => '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A small layout engine shared by the three documents.
async function start(r, title){
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  doc.setTitle(safe(`${title}: ${tenantName(r)}, ${r.property.address}`)); doc.setProducer(BRAND); doc.setCreator(BRAND); doc.setAuthor(BRAND);
  const W = 595.28, H = 841.89, M = 44, CW = W - M * 2, L = { doc, font, bold, serif, W, H, M, CW, page: null, y: 0, n: 0 };
  L.wrap = (text, f, size, width) => { const words = safe(text).split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines.length ? lines : ['']; };
  L.newPage = () => { L.page = doc.addPage([W, H]); L.n++; L.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.paper }); L.y = H - M;
    L.page.drawText(safe(`${BRAND} · ${refNo(r)} · ${tenantName(r)}`), { x: M, y: 24, size: 7.5, font, color: C.mute });
    const pn = 'Page ' + L.n; L.page.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7.5), y: 24, size: 7.5, font, color: C.mute }); };
  L.need = h => { if (L.y - h < 50) L.newPage(); };
  L.text = (t, o = {}) => { const f = o.bold ? bold : o.serif ? serif : font, size = o.size || 10, lh = size * 1.4, lines = L.wrap(t, f, size, o.width || CW);
    L.need(lines.length * lh); lines.forEach(l => { const w = f.widthOfTextAtSize(l, size); L.page.drawText(l, { x: o.center ? (W - w) / 2 : (o.x || M), y: L.y - size, size, font: f, color: o.color || C.ink }); L.y -= lh; }); };
  L.h2 = t => { L.need(150); L.y -= 16; L.page.drawText(safe(t), { x: M, y: L.y - 15, size: 15, font: serif, color: C.navy }); L.y -= 24; };
  // A white card with a title bar and label/value rows (values right-aligned, bold), like the report's panels.
  L.card = (title, rows, o = {}) => {
    rows = rows.filter(([, v]) => v != null && v !== '');
    const x = o.x || M, w = o.w || CW, vw = w * .55, lines = rows.map(([k, v]) => L.wrap(String(v), bold, 9.5, vw - 16));
    const h = 30 + lines.reduce((s, ls) => s + ls.length * 13 + 10, 0) + 6;
    if (!o.noBreak) L.need(Math.min(h, 400));
    const top = L.y; L.page.drawRectangle({ x, y: top - h, width: w, height: h, color: C.white, borderColor: C.line, borderWidth: .7 });
    L.page.drawRectangle({ x, y: top - 26, width: w, height: 26, color: rgb(.955, .95, .94) });
    L.page.drawText(safe(title), { x: x + 12, y: top - 17, size: 10, font: bold, color: C.navy });
    let yy = top - 32;
    rows.forEach(([k, v], i) => { const ls = lines[i], hh = ls.length * 13 + 10;
      if (i) L.page.drawLine({ start: { x: x + 12, y: yy }, end: { x: x + w - 12, y: yy }, thickness: .4, color: C.line });
      L.page.drawText(safe(k), { x: x + 12, y: yy - 15, size: 9, font, color: C.mute });
      ls.forEach((l, j) => L.page.drawText(l, { x: x + w - 12 - bold.widthOfTextAtSize(l, 9.5), y: yy - 15 - j * 13, size: 9.5, font: bold, color: C.ink }));
      yy -= hh; });
    if (!o.keepY) L.y = top - h - 12; return h;
  };
  L.newPage();
  return L;
}
// The header every document starts with: brand, title, name, and "Guarantor for" if it is one.
function header(L, r, title){
  const { page, M, W, bold, serif, font } = L;
  page.drawRectangle({ x: 0, y: L.H - 8, width: W, height: 8, color: C.navy });
  page.drawText(BRAND, { x: M, y: L.H - 44, size: 13, font: bold, color: C.navy });
  page.drawText('Tenant referencing', { x: M, y: L.H - 58, size: 8.5, font, color: C.mute });
  L.y = L.H - 92;
  const t1 = safe(title + ' for '), size = 20; page.drawText(t1, { x: M, y: L.y - size, size, font: serif, color: C.navy });
  const nm = L.wrap(tenantName(r), font, size, L.CW - serif.widthOfTextAtSize(t1, size))[0]; page.drawText(nm, { x: M + serif.widthOfTextAtSize(t1, size), y: L.y - size, size, font, color: C.ink });
  L.y -= 30;
  if (r.role === 'guarantor') { const g = 'Guarantor for '; page.drawText(g, { x: M, y: L.y - 16, size: 16, font: serif, color: C.navy }); page.drawText(safe((r.guarantorFor || {}).name), { x: M + serif.widthOfTextAtSize(g, 16), y: L.y - 16, size: 16, font, color: C.ink }); L.y -= 28; }
  L.y -= 6;
}

async function reportPdf(r){
  const o = assess(r), a = r.application || {}, fin = stage(r, o) === 'complete', title = fin ? 'Final report' : 'Interim report';
  const L = await start(r, title), { M, CW, W, font, bold } = L;
  header(L, r, title);
  // Summary strip
  const cols = [[fin ? 'Date completed' : 'Date', day(fin ? r.updatedAt : new Date())], ['Requested by', r.landlordName || ''], ['Our reference', refNo(r)], ['Product', r.role === 'guarantor' ? 'Guarantor reference' : 'Tenant reference'], ['Rent applied for', gbp(r.property.rentP)]];
  L.page.drawRectangle({ x: M, y: L.y - 54, width: CW, height: 54, color: C.white, borderColor: C.line, borderWidth: .7 });
  cols.forEach(([k, v], i) => { const cx = M + CW / cols.length * (i + .5), vv = L.wrap(v, font, 9.5, CW / cols.length - 8)[0];
    L.page.drawText(safe(k), { x: cx - bold.widthOfTextAtSize(safe(k), 8.5) / 2, y: L.y - 20, size: 8.5, font: bold, color: C.ink });
    if (i === 4) { const w = bold.widthOfTextAtSize(vv, 9.5) + 16; L.page.drawRectangle({ x: cx - w / 2, y: L.y - 45, width: w, height: 17, color: C.pass }); L.page.drawText(vv, { x: cx - w / 2 + 8, y: L.y - 40, size: 9.5, font: bold, color: C.white }); }
    else L.page.drawText(vv, { x: cx - font.widthOfTextAtSize(vv, 9.5) / 2, y: L.y - 40, size: 9.5, font, color: C.ink2 }); });
  L.y -= 70;
  // Outcome: three results = the recommendation
  const hl = headline(o), top = L.y, boxH = 150;
  L.page.drawRectangle({ x: 0, y: top - boxH, width: W, height: boxH, color: rgb(.9, .92, .93) });
  L.page.drawText('Outcome', { x: (W - L.serif.widthOfTextAtSize('Outcome', 17)) / 2, y: top - 26, size: 17, font: L.serif, color: C.navy });
  const mark = (cx, cy, rad, st) => { L.page.drawCircle({ x: cx, y: cy, size: rad, borderColor: C[st], borderWidth: 2.4, color: C.white });
    const t = { pass: 'OK', na: 'OK', warn: '!', fail: 'X', pending: '...' }[st], s = rad * .62; L.page.drawText(t, { x: cx - bold.widthOfTextAtSize(t, s) / 2, y: cy - s * .36, size: s, font: bold, color: C[st] }); };
  const slots = [0, 1, 2].map(i => M + 50 + i * 120), cy = top - 70;
  hl.forEach(([t, st], i) => { mark(slots[i], cy, 22, st); L.wrap(t, bold, 8.5, 110).forEach((l, j) => L.page.drawText(l, { x: slots[i] - bold.widthOfTextAtSize(l, 8.5) / 2, y: cy - 38 - j * 11, size: 8.5, font: bold, color: C.ink })); });
  L.page.drawText('=', { x: M + 400, y: cy - 10, size: 28, font: bold, color: C.ink });
  const v = OUT[o.outcome]; mark(M + 470, cy, 26, v);
  L.wrap(o.label, bold, 10, 120).forEach((l, j) => L.page.drawText(l, { x: M + 470 - bold.widthOfTextAtSize(l, 10) / 2, y: cy - 42 - j * 12, size: 10, font: bold, color: C.ink }));
  L.y = top - boxH;
  // Affordability band
  const band = `Yearly income ${pounds(o.afford.income)} ${o.afford.verified ? '(confirmed by the employer)' : '(as declared)'} = ${o.afford.ratio ? o.afford.ratio.toFixed(1) : '0'} x the monthly rent of ${pounds(r.property.rentP / 100)} (needs ${o.afford.multiple} x)`;
  L.page.drawRectangle({ x: M - 10, y: L.y - 40, width: CW + 20, height: 32, color: C.navy });
  const bl = L.wrap(band, bold, 10, CW)[0]; L.page.drawText(bl, { x: (W - bold.widthOfTextAtSize(bl, 10)) / 2, y: L.y - 28, size: 10, font: bold, color: C.white });
  L.y -= 58;
  // Property and applicant side by side
  const cur = (a.addresses || [])[0] || {}, half = (CW - 14) / 2, y0 = L.y;
  const h1 = L.card('Prospective property', [['Address', r.property.address], ['Tenancy start', r.property.start ? day(r.property.start) : ''], ['Term', r.property.term ? r.property.term + ' months' : ''],
    ['Total rent', gbp(r.property.totalRentP || r.property.rentP)], [r.role === 'guarantor' ? 'Rent guaranteed' : 'Rent share', gbp(r.property.rentP)]], { w: half, keepY: true, noBreak: true });
  L.y = y0;
  const h2 = L.card('Applicant', [['Name', tenantName(r)], ['Current address', cur.line], ['Postcode', cur.postcode], ['Date of birth', a.dob ? day(a.dob) : ''], ['Mobile', a.phone], ['Email', a.email]], { x: M + half + 14, w: half, keepY: true, noBreak: true });
  L.y = y0 - Math.max(h1, h2) - 12;
  L.text('This report is a recommendation to help you decide; the decision is yours. Refusing a tenant because they receive benefits or have children is unlawful in England.', { size: 8, color: C.mute });

  L.newPage();
  L.h2('Identity and Right to Rent');
  L.card('Right to Rent', [['Evidence given', a.rtr ? (a.rtr.route === 'sharecode' ? 'Home Office share code ' + (a.rtr.shareCode || '') : 'British or Irish passport' + ((r.files || []).some(f => f.kind === 'id') ? ' (photo uploaded)' : '')) : 'Not given yet'],
    ['Checked by the landlord', r.rtrChecked ? `${day(r.rtrChecked.date)}, ${r.rtrChecked.how}` : 'Not yet recorded']]);
  L.text('The landlord must check the Right to Rent before the tenancy starts (for a share code: gov.uk/view-right-to-rent) and keep a record.', { size: 8, color: C.mute });

  L.h2('Income and affordability');
  const emp = a.employment || {}, er = ((r.refs || {}).employer || {}).answers;
  L.card('Verification of earnings', [['Status', emp.status], ['Employer name', emp.employer], ['Confirmed job title', er ? (er.jobTitle || 'Not confirmed') : 'Not confirmed yet'], ['Position', er ? er.contract : ''],
    ['Employment start date', er && er.start ? day(er.start) : emp.startDate || ''], ['In probation', er ? er.probation : ''], ['Confirmed income', er && +er.salary ? gbp(+er.salary * 100) + ' a year' : ''],
    ['Declared income', +emp.salary ? gbp(+emp.salary * 100) + ' a year' : ''], ['Other income', a.otherIncome && +a.otherIncome.amount ? gbp(+a.otherIncome.amount * 100) + ' a year' + (a.otherIncome.source ? ' (' + a.otherIncome.source + ')' : '') : ''],
    ['Verified method', er ? 'Employer reference online from ' + [er.refName, er.refPosition].filter(Boolean).join(', ') : (r.files || []).some(f => f.kind === 'income') ? 'Documents uploaded' : 'Not verified']]);
  L.card('Affordability', [['Rent ' + (r.role === 'guarantor' ? 'guaranteed' : 'share'), pounds(r.property.rentP / 100) + ' a month'], ['Income needed (' + o.afford.multiple + ' x rent)', pounds(o.afford.need) + ' a year'],
    ['Income used', pounds(o.afford.income) + ' a year'], ['Income to rent', o.afford.ratio ? o.afford.ratio.toFixed(1) + ' x the monthly rent' : '']]);

  const lr = ((r.refs || {}).landlord || {}).answers;
  if (lr) { L.h2('Previous landlord'); L.card('Landlord reference', [['Given by', lr.refName], ['Received', when(r.refs.landlord.at)], ['Tenancy', [lr.from && day(lr.from), lr.to ? day(lr.to) : 'still renting'].filter(Boolean).join(' to ')],
    ['Rent', +lr.rent ? gbp(+lr.rent * 100) + ' a month' : ''], ['Rent paid on time', lr.paidOnTime], ['Arrears now', +lr.arrears ? gbp(+lr.arrears * 100) : 'None'], ['Condition of the property', lr.condition], ['Would rent to them again', lr.again], ['Comments', lr.comments]]); }

  L.h2(`Addresses (${(a.addresses || []).length})`);
  L.card('Address history', (a.addresses || []).map(x => [`${x.from || '?'} to ${x.to === 'current' || !x.to ? 'now' : x.to}`, `${(x.line || '').toUpperCase()}${x.postcode ? ', ' + x.postcode : ''}`]).concat([['Years covered', `${Math.floor(o.history.months / 12)} years ${o.history.months % 12} months${o.history.gaps.length ? ' (gaps: ' + o.history.gaps.join(', ') + ' months)' : ''}`]]));

  const cr = r.credit || {}, cs = cr.summary || {};
  L.h2(`Public information (${cs.ccjs || 0})`);
  L.text(cr.status && cr.status !== 'pending' ? `We found ${cs.ccjs || 0} CCJ${cs.ccjs === 1 ? '' : 's'} associated with this applicant${cs.ccjValue ? ' (' + pounds(cs.ccjValue) + ')' : ''}.` : 'The credit check has not been completed yet.', { color: C.ink2 });
  L.h2(`Bankruptcies and insolvencies (${cs.insolvency ? 1 : 0})`);
  L.text(cr.status && cr.status !== 'pending' ? (cs.insolvency ? 'A bankruptcy or insolvency is recorded.' : 'We found 0 bankruptcies and insolvencies associated with this applicant.') : 'The credit check has not been completed yet.', { color: C.ink2 });
  if (cr.status && cr.status !== 'pending') L.card('Credit', [['Defaults', cs.defaults != null ? String(cs.defaults) : ''], ['Electoral roll', cs.electoralRoll == null ? '' : cs.electoralRoll ? 'Registered' : 'Not registered'],
    ['Source', cr.provider === 'manual' ? 'Credit report added by hand' + (cr.addedBy ? ' (' + cr.addedBy + ')' : '') : cr.provider === 'sandbox' ? 'Sandbox: TEST DATA, not a real check' : cr.provider || ''], ['Checked', when(cr.at)], ['Reference', cr.providerRef]]);
  if (a.adverse && (a.adverse.ccj === 'yes' || a.adverse.bankrupt === 'yes')) L.text(`Declared by the applicant: ${[a.adverse.ccj === 'yes' && 'a CCJ', a.adverse.bankrupt === 'yes' && 'a bankruptcy or IVA'].filter(Boolean).join(' and ')}${a.adverse.details ? ': ' + a.adverse.details : ''}.`, { color: C.fail });

  L.h2('All checks');
  for (const it of o.items) {
    const lines = L.wrap(it.detail, font, 9, CW - 120); L.need(lines.length * 12 + 22);
    L.page.drawCircle({ x: M + 6, y: L.y - 8, size: 5.5, color: C[it.status] });
    L.page.drawText(safe(it.title), { x: M + 20, y: L.y - 11, size: 10, font: bold, color: C.ink });
    const tag = { pass: 'Passed', warn: 'Check', fail: 'Concern', pending: 'Waiting', na: 'Not needed' }[it.status];
    L.page.drawText(tag, { x: M + CW - bold.widthOfTextAtSize(tag, 9), y: L.y - 11, size: 9, font: bold, color: C[it.status] });
    lines.forEach((l, i) => L.page.drawText(l, { x: M + 20, y: L.y - 24 - i * 12, size: 9, font, color: C.ink2 }));
    L.y -= 22 + lines.length * 12 + 6;
  }
  L.h2('Documents and consent');
  L.card('Received', (r.files || []).map(f => [{ id: 'Identity', income: 'Income', credit: 'Credit report', other: 'Other' }[f.kind] || f.kind, `${f.name} (${day(f.at)})`])
    .concat([['Application sent', when(a.submittedAt)], ['Signed as', a.signature], ['Consented to checks', a.consents && a.consents.credit ? 'Yes, including a credit search' : ''], ['Declared the information true', a.consents && a.consents.declaration ? 'Yes' : '']]));
  L.y -= 6;
  L.text(`The information in this report was given by the applicant, their referees and, where shown, a credit reference provider. ${BRAND} cannot verify everything third parties tell us. This report is not conclusive evidence of anyone's suitability to rent, nor a guarantee that the applicant will keep to the tenancy; you make your own decision. Letting carries risk: consider insurance against rent arrears, damage and legal costs.`, { size: 7.5, color: C.mute });
  return Buffer.from(await L.doc.save());
}

async function applicationPdf(r){
  const a = r.application || {}, L = await start(r, 'Application form');
  header(L, r, 'Application form');
  const emp = a.employment || {}, pl = a.prevLandlord || {}, g = a.guarantor || {}, oi = a.otherIncome || {};
  L.card('The property', [['Address', r.property.address], [r.role === 'guarantor' ? 'Rent guaranteed' : 'Rent share', gbp(r.property.rentP) + ' a month'], ['Applied', when(a.submittedAt)], ['Reference', refNo(r)]]);
  L.card('About the applicant', [['First name', a.firstName], ['Last name', a.lastName], ['Date of birth', a.dob ? day(a.dob) : ''], ['Email', a.email], ['Mobile', a.phone]]);
  L.card('Addresses (last 3 years)', (a.addresses || []).map((x, i) => [i ? 'Previous address' : 'Current address', `${x.line || ''}${x.postcode ? ', ' + x.postcode : ''} (${x.from || '?'} to ${x.to === 'current' ? 'now' : x.to || '?'}; ${x.status || ''})`]));
  L.card('Work and income', [['Status', emp.status], [emp.status === 'self-employed' ? 'Business' : 'Employer', emp.employer], ['Job title', emp.jobTitle], ['Yearly income', +emp.salary ? gbp(+emp.salary * 100) : ''], ['Started', emp.startDate],
    ['Employer contact', [emp.refName, emp.refEmail, emp.refPhone].filter(Boolean).join(', ')], ['Other income', +oi.amount ? gbp(+oi.amount * 100) + ' a year' + (oi.source ? ' (' + oi.source + ')' : '') : '']]);
  L.card('Current or previous landlord', pl.has === 'yes' ? [['Name', pl.name], ['Email', pl.email], ['Phone', pl.phone], ['Monthly rent', +pl.rent ? gbp(+pl.rent * 100) : '']] : [['Rents now or in the last 3 years', pl.has === 'no' ? 'No' : 'Not answered']]);
  L.card('Right to Rent', [['Evidence', a.rtr ? (a.rtr.route === 'sharecode' ? 'Share code ' + a.rtr.shareCode : 'British or Irish passport') : '']]);
  L.card('Credit history (declared)', [['Ever had a CCJ', (a.adverse || {}).ccj], ['Ever bankrupt or an IVA', (a.adverse || {}).bankrupt], ['Details', (a.adverse || {}).details]]);
  if (r.role !== 'guarantor') L.card('Guarantor offered', g.name ? [['Name', g.name], ['Email', g.email], ['Phone', g.phone]] : [['Guarantor', 'None']]);
  L.card('Documents uploaded', (r.files || []).filter(f => ['id', 'income'].includes(f.kind)).map(f => [f.kind === 'id' ? 'Identity' : 'Income', f.name]).concat((r.files || []).length ? [] : [['Documents', 'None']]));
  return Buffer.from(await L.doc.save());
}

async function consentPdf(r){
  const a = r.application || {}, c = a.consents || {}, L = await start(r, 'Signed consent');
  header(L, r, 'Signed consent');
  L.text(`For the tenancy of ${r.property.address}, applied for through ${BRAND} on behalf of ${r.landlordName || 'the landlord or agent'}.`, { color: C.ink2 }); L.y -= 8;
  const tick = (on, t) => { const lines = L.wrap(t, L.font, 10, L.CW - 30); L.need(lines.length * 14 + 10);
    L.page.drawRectangle({ x: L.M, y: L.y - 14, width: 12, height: 12, borderColor: C.navy, borderWidth: 1, color: C.white });
    if (on) L.page.drawText('X', { x: L.M + 2.5, y: L.y - 12, size: 10, font: L.bold, color: C.navy });
    lines.forEach((l, i) => L.page.drawText(l, { x: L.M + 22, y: L.y - 12 - i * 14, size: 10, font: L.font, color: C.ink })); L.y -= lines.length * 14 + 12; };
  tick(c.credit, 'I agree to a credit search being made to check my identity and credit history. It leaves a "soft" footprint that other lenders cannot see.');
  tick(c.data, `I agree to ${BRAND} contacting my referees and sharing this application and its results with ${r.landlordName || 'the landlord'} for this tenancy.`);
  tick(c.declaration, 'The information I have given is true and complete. I understand that giving false information may mean my application is refused.');
  L.y -= 10;
  L.card('Signed', [['Name typed as signature', a.signature], ['Date and time', when(a.submittedAt)], ['From internet address', a.ip], ['Applicant', tenantName(r)], ['Email', a.email], ['Reference', refNo(r)]]);
  return Buffer.from(await L.doc.save());
}
module.exports = { reportPdf, applicationPdf, consentPdf, tenantName, refNo };
