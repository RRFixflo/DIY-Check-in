// Rent, receipts, expenses and the tax-year summary for the landlord dashboard (landlords.js mounts it).
// Everything is kept in the landlord's own account file (REPORTS_DIR/landlords/accounts/<id>.json):
//   p.tenancy.rentP / rentFreq / dueDay / rentStart / rentHist   the rent (pence) and when it's due
//   p.payments[]   rent received: { id, no (receipt number), date, amt (pence), method, note, period (due date or ''), sentAt, sentTo }
//   acc.expenses[] costs: { id, propId ('' = all properties / general), date, cat, supplier, desc, amt (pence), file }
//   acc.receiptSeq the last receipt number given out (one sequence per account)
// Money is always whole pence; £ only on the way out. Nothing here is tax advice and no tax is worked out.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/* ------------------------------------ dates ------------------------------------ */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s){
  s = String(s || '').trim(); if (!ISO.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return y > 1950 && y < 2200 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : '';
}
const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const days = (from, to) => Math.round((toUTC(to) - toUTC(from)) / 86400000);
const addDays = (s, n) => new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
const pad = n => String(n).padStart(2, '0');
// A day in a month, kept inside the month: the 31st in February is the 28th (or 29th).
function ymd(y, m0, d){ y += Math.floor(m0 / 12); m0 = ((m0 % 12) + 12) % 12; const dim = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); return y + '-' + pad(m0 + 1) + '-' + pad(Math.min(d, dim)); }
const fmt = s => s ? new Date(toUTC(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const fmtShort = s => s ? new Date(toUTC(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
const fmtIsoDay = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : '';
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/* ------------------------------------ money ------------------------------------ */
const MAX_P = 1000000000;   // £10 million, in pence
// "1,450", "£1450.5", "1450.50" → 145050. Anything else (negative, three decimals, words) → 0.
function parsePence(v){
  const s = String(v == null ? '' : v).replace(/[£,\s]/g, '');
  if (!/^\d{1,8}(\.\d{0,2})?$/.test(s)) return 0;
  const [a, b = ''] = s.split('.'), p = Number(a) * 100 + Number((b + '00').slice(0, 2));
  return p > 0 && p < MAX_P ? p : 0;
}
// £1,450 (or £1,450.50); full: always pence (receipts, totals).
function gbp(p, full){
  const n = Math.round(Number(p) || 0), a = Math.abs(n), pounds = Math.floor(a / 100).toLocaleString('en-GB'), pence = a % 100;
  return (n < 0 ? '−' : '') + '£' + pounds + (full || pence ? '.' + pad(pence) : '');
}
const plain = p => (Math.round(Number(p) || 0) / 100).toFixed(2);   // 1450.00, for CSV and form fields
const sum = (a, f) => a.reduce((n, x) => n + (f ? f(x) : x), 0);

/* ------------------------------------ rent ------------------------------------ */
const FREQ = [['month', 'Monthly', 'a month'], ['week', 'Weekly', 'a week'], ['4 weeks', 'Every 4 weeks', 'every 4 weeks'], ['quarter', 'Quarterly', 'a quarter'], ['year', 'Yearly', 'a year']];
const STEP = { week: { d: 7 }, '4 weeks': { d: 28 }, month: { m: 1 }, quarter: { m: 3 }, year: { m: 12 } };
const freqOf = tn => STEP[tn && tn.rentFreq] ? tn.rentFreq : 'month';
const perText = tn => (FREQ.find(f => f[0] === freqOf(tn)) || FREQ[0])[2];
const METHODS = [['bank', 'Bank transfer'], ['so', 'Standing order'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']];
const methodText = m => (METHODS.find(x => x[0] === m) || METHODS[4])[1];
const GRACE = 3;   // rent unpaid more than this many days after it was due is "late"

// The current rent in pence (older accounts kept pounds in tn.rent).
const rentPence = tn => !tn ? 0 : Number.isInteger(tn.rentP) ? tn.rentP : Math.round((Number(tn.rent) || 0) * 100);
// The rent for the period due on a date: the last change that started on or before it.
function rentOn(tn, due){
  const h = tn && Array.isArray(tn.rentHist) && tn.rentHist.length ? tn.rentHist : null;
  if (!h) return rentPence(tn);
  let p = h[0].p; for (const x of h) if (!x.from || x.from <= due) p = x.p; return p;
}
// A new rent amount. `from`: the first due date it applies to (earlier periods keep the old amount); none: every period.
function applyRent(old, next, newP, from){
  let hist = old && Array.isArray(old.rentHist) && old.rentHist.length ? old.rentHist.map(x => ({ from: x.from || '', p: x.p })) : (rentPence(old) > 0 ? [{ from: '', p: rentPence(old) }] : []);
  const latest = hist.length ? hist[hist.length - 1].p : 0;
  if (!newP) hist = [];
  else if (newP === latest && hist.length) { /* unchanged */ }
  else if (!from || !hist.length) hist = [{ from: '', p: newP }];
  else { hist = hist.filter(x => !x.from || x.from < from); hist.push({ from, p: newP }); }
  hist = hist.filter((x, i) => i === 0 || x.p !== hist[i - 1].p);
  next.rentHist = hist; next.rentP = newP || 0; next.rent = (newP || 0) / 100;
  return next;
}
// When rent falls due: from the first rent date, then every week / 4 weeks, or each month / quarter / year on
// the due day (the 29th–31st become the month's last day in shorter months, without drifting).
function plan(tn){
  if (!tn) return null;
  const amt = rentPence(tn), first = validDate(tn.rentStart) || validDate(tn.start);
  if (!(amt > 0) || !first) return null;
  const f = freqOf(tn), S = STEP[f], end = tn.end && !tn.periodic ? tn.end : '';
  let dueAt, dueDay = 0;
  if (S.d) dueAt = k => addDays(first, k * S.d);
  else {
    dueDay = tn.dueDay >= 1 && tn.dueDay <= 31 ? tn.dueDay : Number(first.slice(8));
    const y = Number(first.slice(0, 4)); let m = Number(first.slice(5, 7)) - 1;
    if (ymd(y, m, dueDay) < first) m++;
    dueAt = k => ymd(y, m + k * S.m, dueDay);
  }
  return { f, first, end, dueAt, dueDay };
}
// Every rent period from the first up to today, plus the next one (none past the end of a fixed term).
function schedule(tn, today, max = 3000){
  const pl = plan(tn); if (!pl) return [];
  const out = [];
  for (let k = 0; k < max; k++) {
    const due = pl.dueAt(k); if (pl.end && due > pl.end) break;
    let to = addDays(pl.dueAt(k + 1), -1); if (pl.end && to > pl.end) to = pl.end;
    out.push({ k, due, to, amt: rentOn(tn, due) });
    if (due > today) break;
  }
  return out;
}
// What's been paid for each period. A payment marked for a period counts there first; payments for no
// particular period, and anything paid over a period's rent, go to the oldest periods still owing.
function ledger(p, today, o = {}){
  const tn = p.tenancy, sch = schedule(tn, today);
  const pays = (p.payments || []).filter(x => !o.until || x.date <= o.until).slice().sort((a, b) => a.date.localeCompare(b.date) || (a.no || 0) - (b.no || 0));
  const byDue = new Map(sch.map(s => [s.due, s]));
  sch.forEach(s => { s.tagged = 0; s.paid = 0; s.pays = []; });
  let pool = 0;
  for (const x of pays) { const s = x.period && byDue.get(x.period); if (s) { s.tagged += x.amt; s.pays.push(x); } else pool += x.amt; }
  sch.forEach(s => { s.paid = Math.min(s.tagged, s.amt); pool += s.tagged - s.paid; });
  for (const s of sch) { if (pool <= 0) break; const need = s.amt - s.paid; if (need > 0) { const a = Math.min(need, pool); s.paid += a; pool -= a; } }
  sch.forEach(s => { s.left = s.amt - s.paid; s.future = s.due > today; s.late = s.left > 0 && !s.future && days(s.due, today) > GRACE; s.st = periodStatus(s, today); });
  const past = sch.filter(s => !s.future);
  let paidUpTo = ''; for (const s of sch) { if (s.left > 0) break; paidUpTo = s.to; }
  return { sch, pays, untied: pays.filter(x => !x.period || !byDue.has(x.period)), arrears: sum(past, s => s.left), overdue: sum(past.filter(s => s.late), s => s.left),
    credit: pool, paidUpTo, next: sch.find(s => s.future) || null, expected: sum(past, s => s.amt), received: sum(pays, x => x.amt), planned: !!sch.length };
}
function periodStatus(s, today){
  if (s.left <= 0) return { cls: 'ok', key: 'paid', text: 'Paid' };
  if (s.future) return s.paid > 0 ? { cls: 'none', key: 'part', text: 'Part paid: ' + gbp(s.left) + ' to pay' } : { cls: 'none', key: 'upcoming', text: 'Due ' + fmt(s.due) };
  const d = days(s.due, today);
  if (s.paid > 0) return { cls: s.late ? 'exp' : 'due', key: s.late ? 'late' : 'part', text: 'Part paid: ' + gbp(s.left) + ' to pay' };
  if (s.late) return { cls: 'exp', key: 'late', text: 'Late: ' + plural(d, 'day') };
  return { cls: 'due', key: 'due', text: d === 0 ? 'Due today' : 'Due ' + plural(d, 'day') + ' ago' };
}
// One line for the dashboard and the property's overview.
function rentStatus(p, today){
  const tn = p.tenancy;
  if (!plan(tn)) return { cls: 'none', text: rentPence(tn) > 0 ? 'Add the first rent date' : 'No rent added', sub: '' };
  const L = ledger(p, today);
  const sub = L.next ? 'Next due ' + fmtShort(L.next.due) : L.paidUpTo ? 'Paid up to ' + fmt(L.paidUpTo) : '';
  if (L.overdue > 0) return { cls: 'exp', text: gbp(L.overdue) + ' overdue', sub, L };
  if (L.arrears > 0) return { cls: 'due', text: gbp(L.arrears) + ' due', sub, L };
  return { cls: 'ok', text: 'Paid up', sub, L };
}
const periodText = s => fmt(s.due).replace(/ \d{4}$/, s.due.slice(0, 4) === s.to.slice(0, 4) ? '' : ' ' + s.due.slice(0, 4)) + ' – ' + fmt(s.to);
// The landlord's reminder email: rent more than GRACE days late, within the last 45 days (once per period).
function rentReminderItems(p, today){
  if (!plan(p.tenancy)) return [];
  return ledger(p, today).sch.filter(s => s.late && days(s.due, today) <= 45).map(s => ({ kind: 'rent', due: s.due, left: s.left, period: periodText(s) }));
}

/* ------------------------------------ tax years ------------------------------------ */
// The UK tax year runs from 6 April to 5 April. 2026 means 6 Apr 2026 – 5 Apr 2027.
const taxYearOf = d => { const y = Number(d.slice(0, 4)); return d >= y + '-04-06' ? y : y - 1; };
const tyRange = y => [y + '-04-06', (y + 1) + '-04-05'];
const tyLabel = y => y + '–' + String(y + 1).slice(2);
const inTY = (d, y) => { const [a, b] = tyRange(y); return d >= a && d <= b; };

/* ------------------------------------ expenses ------------------------------------ */
const CATS = [['repairs', 'Repairs and maintenance'], ['certs', 'Gas Safety, EICR and EPC certificates'], ['insurance', 'Insurance'], ['agent', 'Letting agent fees'],
  ['ground', 'Ground rent and service charges'], ['utilities', 'Utilities and council tax (while empty)'], ['legal', 'Legal and professional'], ['cleaning', 'Cleaning and gardening'],
  ['furnish', 'Furnishings replacement'], ['travel', 'Travel'], ['other', 'Other']];
const catText = c => (CATS.find(x => x[0] === c) || CATS[CATS.length - 1])[1];

function summary(acc, y){
  const props = acc.properties.slice().sort((a, b) => addrLine(a).localeCompare(addrLine(b), 'en', { numeric: true }));
  const exps = (acc.expenses || []).filter(e => inTY(e.date, y));
  const ids = new Set(props.map(p => p.id));
  const row = (label, p, list) => {
    const income = p ? sum((p.payments || []).filter(x => inTY(x.date, y)), x => x.amt) : 0;
    const byCat = {}; list.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amt; });
    const expenses = sum(list, e => e.amt);
    return { label, p, income, byCat, expenses, net: income - expenses, count: list.length };
  };
  const rows = props.map(p => row(addrLine(p), p, exps.filter(e => e.propId === p.id)));
  const general = row('All properties (general costs)', null, exps.filter(e => !e.propId || !ids.has(e.propId)));
  const all = rows.concat(general.count ? [general] : []);
  const byCat = {}; all.forEach(r => Object.keys(r.byCat).forEach(c => { byCat[c] = (byCat[c] || 0) + r.byCat[c]; }));
  const income = sum(all, r => r.income), expenses = sum(all, r => r.expenses);
  return { y, rows: all, total: { income, expenses, net: income - expenses, byCat } };
}
// Tax years with anything in them, and always this one.
function taxYears(acc, today){
  const set = new Set([taxYearOf(today)]);
  acc.properties.forEach(p => (p.payments || []).forEach(x => set.add(taxYearOf(x.date))));
  (acc.expenses || []).forEach(e => set.add(taxYearOf(e.date)));
  return [...set].sort((a, b) => b - a);
}
function streetOf(a){
  const no = a.houseNo || '', b = a.building || '', r = a.road || '';
  if (!no) return [b, r].filter(Boolean).join(', ');
  if (/^\d+[A-Za-z]?(-\d+[A-Za-z]?)?$/.test(no)) return b ? [no + ' ' + b, r].filter(Boolean).join(', ') : (r ? no + ' ' + r : no);
  return [no, b, r].filter(Boolean).join(', ');
}
const addrLine = p => streetOf(p.address);
const addrFull = p => [streetOf(p.address), p.address.town, p.address.postcode].filter(Boolean).join(', ');

/* ------------------------------------ CSV ------------------------------------ */
// Excel-friendly (BOM, CRLF). A cell that starts like a formula is quoted with a leading apostrophe.
function csv(rows){
  const cell = v => { let s = v == null ? '' : String(v); if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
function incomeCSV(acc, y){
  const rows = [['Date received', 'Property', 'Tenant(s)', 'Period from', 'Period to', 'Amount (GBP)', 'Paid by', 'Receipt no.', 'Note']];
  const list = [];
  acc.properties.forEach(p => { const L = ledger(p, horizon()), byDue = new Map(L.sch.map(s => [s.due, s]));
    (p.payments || []).filter(x => inTY(x.date, y)).forEach(x => { const s = x.period && byDue.get(x.period); list.push([x.date, addrFull(p), (p.tenancy && p.tenancy.names) || '', s ? s.due : '', s ? s.to : '', plain(x.amt), methodText(x.method), x.no ? receiptNo(x.no) : '', x.note || '']); }); });
  list.sort((a, b) => a[0].localeCompare(b[0]));
  return csv(rows.concat(list, [[], ['Total', '', '', '', '', plain(sum(list, r => Math.round(Number(r[5]) * 100)))]]));
}
function expensesCSV(acc, y){
  const byId = new Map(acc.properties.map(p => [p.id, p]));
  const list = (acc.expenses || []).filter(e => inTY(e.date, y)).sort((a, b) => a.date.localeCompare(b.date))
    .map(e => [e.date, byId.get(e.propId) ? addrFull(byId.get(e.propId)) : 'All properties (general)', catText(e.cat), e.supplier || '', e.desc || '', plain(e.amt), e.file ? 'Yes' : 'No']);
  return csv([['Date', 'Property', 'Category', 'Supplier', 'Description', 'Amount (GBP)', 'Receipt kept']].concat(list, [[], ['Total', '', '', '', '', plain(sum((acc.expenses || []).filter(e => inTY(e.date, y)), e => e.amt))]]));
}
function summaryCSV(acc, y){
  const s = summary(acc, y);
  const head = ['Property', 'Rent received (GBP)'].concat(CATS.map(c => c[1] + ' (GBP)'), ['Total expenses (GBP)', 'Net (GBP)']);
  const r = x => [x.label, plain(x.income)].concat(CATS.map(c => plain(x.byCat[c[0]] || 0)), [plain(x.expenses), plain(x.net)]);
  return csv([['Tax year ' + tyLabel(y) + ' (6 April ' + y + ' to 5 April ' + (y + 1) + ')'], ['A record to help with your Self Assessment. It isn’t tax advice. Rent is counted on the date received; costs on their date.'], [], head]
    .concat(s.rows.map(r), [r(Object.assign({ label: 'Total' }, s.total))]));
}

/* ------------------------------------ PDF ------------------------------------ */
// pdf-lib's standard fonts only know the Windows-1252 characters: anything else becomes its plain letter, or "?".
const LETTERS = { '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i', '\u2192': '->' };
const WIN = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfText = s => Array.from(String(s == null ? '' : s).replace(/−/g, '-').replace(/[\r\n\t]+/g, ' ')).map(c => {
  const n = c.charCodeAt(0); if ((n >= 32 && n < 127) || (n >= 160 && n <= 255) || WIN.includes(c)) return c;
  const b = (LETTERS[c] || c).normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); return /^[\x20-\x7e]+$/.test(b) ? b : '?'; }).join('');
const NAVY = rgb(27 / 255, 46 / 255, 75 / 255), INK = rgb(19 / 255, 33 / 255, 58 / 255), SOFT = rgb(74 / 255, 85 / 255, 104 / 255), FAINT = rgb(142 / 255, 138 / 255, 126 / 255),
  LINE = rgb(228 / 255, 217 / 255, 198 / 255), BEIGE = rgb(245 / 255, 239 / 255, 228 / 255), WARM = rgb(196 / 255, 154 / 255, 108 / 255);
async function pdfKit(){
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 48;
  const k = { doc, font, bold, W, H, M, page: null, y: 0 };
  k.add = () => { k.page = doc.addPage([W, H]); k.y = H - M; return k.page; };
  k.wrap = (s, f, size, width) => { const words = pdfText(s).split(' '), out = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) <= width || !cur) cur = t; else { out.push(cur); cur = w; } }
    if (cur) out.push(cur); return out.length ? out : ['']; };
  k.text = (s, x, y, o = {}) => { const f = o.bold ? bold : font, size = o.size || 10.5, t = pdfText(s); const w = f.widthOfTextAtSize(t, size);
    k.page.drawText(t, { x: o.right ? x - w : x, y, size, font: f, color: o.color || INK }); return w; };
  k.line = (y, x1 = M, x2 = W - M, c = LINE, t = 0.8) => k.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color: c });
  k.need = h => { if (k.y - h < M + 30) k.add(); };
  k.footer = () => {};
  return k;
}
// Far enough ahead to include any period a payment can be marked for (the next one is the latest).
const horizon = () => addDays(new Date().toISOString().slice(0, 10), 400);
const receiptNo = n => String(n).padStart(4, '0');
// What a receipt says (the same for the page, the email and the PDF).
function receiptData(acc, p, x){
  const L = ledger(p, x.date, { until: x.date }), full = ledger(p, horizon()), s = x.period && full.sch.find(q => q.due === x.period);
  const tn = p.tenancy || {};
  return { no: receiptNo(x.no || 0), landlord: (acc.settings && acc.settings.receiptName) || acc.name, landlordEmail: acc.email, tenants: tn.names || '', address: addrFull(p),
    period: s ? periodText(s) : '', periodRent: s ? s.amt : 0, amount: x.amt, date: x.date, method: methodText(x.method), note: x.note || '', balance: L.arrears, credit: L.credit };
}
function receiptRows(r){
  return [['Received from', r.tenants || 'The tenant'], ['Property', r.address], ['For', r.period ? 'Rent for ' + r.period : 'Rent'], ['Amount received', gbp(r.amount, true)],
    ['Date received', fmt(r.date)], ['Paid by', r.method], r.note ? ['Note', r.note] : null,
    ['Balance outstanding', r.balance > 0 ? gbp(r.balance, true) + ' (as at ' + fmt(r.date) + ')' : 'Nothing outstanding' + (r.credit > 0 ? ' (' + gbp(r.credit, true) + ' paid in advance)' : '')], ['Landlord', r.landlord]].filter(Boolean);
}
async function receiptPDF(r){
  const k = await pdfKit(), { W, M } = k; k.add();
  const pg = k.page;
  pg.drawRectangle({ x: 0, y: k.H - 8, width: W, height: 8, color: NAVY });
  k.text('RENT RECEIPT', M, k.y - 6, { bold: true, size: 11, color: WARM });
  k.text('No. ' + r.no, W - M, k.y - 6, { bold: true, size: 11, right: true, color: SOFT });
  k.y -= 46; k.text('Received with thanks', M, k.y, { bold: true, size: 26, color: NAVY });
  k.y -= 34; k.text(gbp(r.amount, true), M, k.y, { bold: true, size: 30 });
  k.y -= 20; k.text((r.period ? 'Rent for ' + r.period : 'Rent') + ', received ' + fmt(r.date), M, k.y, { size: 11.5, color: SOFT });
  k.y -= 30; k.line(k.y, M, W - M, INK, 1);
  const LW = 150;
  for (const [a, b] of receiptRows(r)) {
    const lines = k.wrap(b, a === 'Amount received' ? k.bold : k.font, 11.5, W - 2 * M - LW);
    const h = 14 * lines.length + 14;
    k.text(a, M, k.y - 18, { size: 10.5, color: FAINT });
    lines.forEach((l, i) => k.text(l, M + LW, k.y - 18 - i * 14, { size: 11.5, bold: a === 'Amount received' }));
    k.y -= h; k.line(k.y);
  }
  k.y -= 28;
  k.wrap('This receipt confirms that the landlord named above received the payment shown. Please keep it for your records.', k.font, 10, W - 2 * M).forEach(l => { k.text(l, M, k.y, { size: 10, color: SOFT }); k.y -= 14; });
  k.text('Made with the DIY Inventory landlord dashboard', M, M - 10, { size: 8.5, color: FAINT });
  k.text('Issued ' + fmt(new Date().toISOString().slice(0, 10)), W - M, M - 10, { size: 8.5, color: FAINT, right: true });
  k.doc.setTitle('Rent receipt ' + r.no); k.doc.setAuthor(pdfText(r.landlord)); k.doc.setCreator('DIY Inventory');
  return Buffer.from(await k.doc.save());
}
async function summaryPDF(acc, y){
  const s = summary(acc, y), k = await pdfKit(), { W, M } = k;
  k.footer = () => k.text('A record to help with your Self Assessment. It isn’t tax advice.  ·  DIY Inventory landlord dashboard', M, M - 10, { size: 8.5, color: FAINT });
  k.add(); k.page.drawRectangle({ x: 0, y: k.H - 8, width: W, height: 8, color: NAVY });
  k.text('RENT AND EXPENSES', M, k.y - 6, { bold: true, size: 11, color: WARM });
  k.y -= 40; k.text('Tax year ' + tyLabel(y), M, k.y, { bold: true, size: 26, color: NAVY });
  k.y -= 20; k.text('6 April ' + y + ' to 5 April ' + (y + 1) + '  ·  ' + ((acc.settings && acc.settings.receiptName) || acc.name), M, k.y, { size: 11.5, color: SOFT });
  k.y -= 34;
  const cols = [['Rent received', s.total.income], ['Expenses', s.total.expenses], ['Net (rent less expenses)', s.total.net]], cw = (W - 2 * M) / 3;
  k.page.drawRectangle({ x: M, y: k.y - 50, width: W - 2 * M, height: 62, color: BEIGE });
  cols.forEach(([l, v], i) => { k.text(l, M + 14 + i * cw, k.y - 8, { size: 9.5, color: SOFT }); k.text(gbp(v, true).replace('−', '-'), M + 14 + i * cw, k.y - 34, { bold: true, size: 17 }); });
  k.y -= 80;
  const block = r => {
    const items = CATS.filter(c => r.byCat[c[0]]).map(c => [c[1], r.byCat[c[0]]]);
    const title = r.p ? addrFull(r.p) : r.label, tl = k.wrap(title, k.bold, 12, W - 2 * M);
    k.need(18 * (items.length + 4) + 14 * tl.length);
    tl.forEach(l => { k.text(l, M, k.y, { bold: true, size: 12 }); k.y -= 15; });
    k.y -= 3; k.line(k.y, M, W - M, INK, 0.8); k.y -= 16;
    const rowL = (l, v, o = {}) => { k.text(l, M + (o.indent ? 12 : 0), k.y, { size: 10.5, color: o.indent ? SOFT : INK, bold: o.bold }); k.text(gbp(v, true).replace('−', '-'), W - M, k.y, { size: 10.5, right: true, bold: o.bold }); k.y -= 17; };
    if (r.p) rowL('Rent received', r.income);
    items.forEach(([l, v]) => rowL(l, v, { indent: true }));
    rowL('Total expenses', r.expenses);
    if (r.p) { k.line(k.y + 11); rowL('Net', r.net, { bold: true }); }
    k.y -= 14;
  };
  s.rows.forEach(block);
  if (!s.rows.length) { k.text('Nothing recorded for this tax year.', M, k.y, { color: SOFT }); k.y -= 20; }
  k.need(80); k.y -= 4;
  k.wrap('Rent is counted on the date it was received, and costs on their date. This is a record of what you entered on your dashboard, to help you or your accountant with your Self Assessment. It isn’t tax advice and it doesn’t work out any tax.', k.font, 9.5, W - 2 * M).forEach(l => { k.text(l, M, k.y, { size: 9.5, color: SOFT }); k.y -= 13; });
  const n = k.doc.getPageCount(); k.doc.getPages().forEach((pg, i) => { k.page = pg; k.footer(); k.text('Page ' + (i + 1) + ' of ' + n, W - M, M - 10, { size: 8.5, color: FAINT, right: true }); });
  k.doc.setTitle('Rent and expenses ' + tyLabel(y)); k.doc.setCreator('DIY Inventory');
  return Buffer.from(await k.doc.save());
}

/* ===================================== pages and routes ===================================== */
function mount(app, h){
  const { need, send, head, inp, sel, area, stHTML, esc, line, text, todayLondon, readAcc, writeAcc, prop, update, multipart, takeFile, FILE_DIR, emailOn, sendEmail, emailHTML,
    limiter, clientIp, urlenc, EMAIL_RE, rid, NOTES } = h;
  Object.assign(NOTES, { received: 'Rent marked as received.', already: 'That rent was already marked as received.', paydel: 'Payment deleted.', rent: 'Rent saved.',
    receipt: 'Receipt sent.', expense: 'Expense saved.', expdel: 'Expense deleted.' });
  const writes = limiter(600, 3600000), sends = limiter(20, 3600000), sendsIp = limiter(40, 3600000);
  const MAX_PAYS = 3000, MAX_EXP = 5000;
  const busy = (req, res) => { if (writes(req.acc.id)) return false; res.status(429).type('text/plain').send('Too many changes in a short time. Please wait a few minutes and try again.'); return true; };
  const hidden = o => Object.entries(o).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
  const postForm = (action, fields, label, cls, confirmText) => `<form method="post" action="${action}" class="inline"${confirmText ? ` onsubmit="return confirm('${esc(confirmText)}')"` : ''}>${hidden(fields)}<button class="${cls || 'linkbtn'}">${label}</button></form>`;
  const BACKS = { p: id => '/account/p/' + id, rent: id => '/account/p/' + id + '/rent' };
  const backTo = (b, id, m, hash) => (BACKS[b] || BACKS.p)(id) + '?m=' + m + (hash ? '#' + hash : '');
  const tenantEmails = tn => String((tn && tn.emails) || '').split(/[,;\s]+/).filter(e => EMAIL_RE.test(e)).slice(0, 5);
  const lastMethod = p => { const l = (p.payments || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]; return l ? l.method : 'bank'; };
  const payBase = (p, x) => '/account/p/' + p.id + '/rent/pay/' + x.id;

  /* ------------------------------ pieces ------------------------------ */
  function payLine(p, x, back){
    const sent = x.sentAt ? `<span class="pay-sent">Receipt sent ${esc(fmtIsoDay(x.sentAt))}</span>` : '';
    const canMail = emailOn() && tenantEmails(p.tenancy).length;
    return `<div class="pay" id="pay-${x.id}"><div class="pay-t"><b>${esc(gbp(x.amt))}</b> received ${esc(fmt(x.date))} · ${esc(methodText(x.method))}${x.note ? ' · ' + esc(x.note) : ''} ${sent}</div>
      <div class="pay-act">${canMail ? postForm(payBase(p, x) + '/receipt/send', { back }, x.sentAt ? 'Send receipt again' : 'Send receipt', 'linkbtn') : ''}<a href="${payBase(p, x)}/receipt">Receipt</a><a href="${payBase(p, x)}?back=${back}">Edit</a></div></div>`;
  }
  function quickBtn(p, s, back, t){
    return `<div class="rp-act">${postForm('/account/p/' + p.id + '/rent/receive', { period: s.due, date: t, method: lastMethod(p), quick: '1', back }, 'Mark as received', 'btn primary sm')}
      <a class="rp-other" href="/account/p/${p.id}/rent/receive?period=${s.due}&back=${back}">Different amount or date</a></div>`;
  }
  function periodRow(p, s, back, t){
    return `<li class="rp rp-${s.st.key}"><div class="rp-main"><div class="rp-top"><b>${esc(periodText(s))}</b><span class="rp-amt">${esc(gbp(s.amt))}</span></div>${stHTML(s.st)}
      ${s.pays.map(x => payLine(p, x, back)).join('')}</div>${s.left > 0 && (!s.future || s === s.nextOne) ? quickBtn(p, s, back, t) : ''}</li>`;
  }
  function rentFigs(p, L){
    const tn = p.tenancy, pl = plan(tn);
    const when = pl ? (pl.dueDay ? 'due on the ' + ord(pl.dueDay) + (pl.dueDay >= 29 ? ' (or the month’s last day)' : '') : 'due every ' + (pl.f === 'week' ? 'week' : '4 weeks') + ' from ' + fmt(pl.first)) : '';
    return `<div class="rent-figs">
      <div><span>Rent</span><b>${esc(gbp(rentPence(tn)))}</b><small>${esc(perText(tn))}${when ? ', ' + esc(when) : ''}</small></div>
      <div><span>Paid up to</span><b class="d">${L.paidUpTo ? esc(fmt(L.paidUpTo)) : '—'}</b><small>${L.credit > 0 ? esc(gbp(L.credit)) + ' paid in advance' : L.next ? 'Next due ' + esc(fmt(L.next.due)) : 'No more rent due'}</small></div>
      <div class="${L.overdue > 0 ? 'bad' : L.arrears > 0 ? 'warn' : ''}"><span>Owed now</span><b>${esc(gbp(L.arrears))}</b><small>${L.overdue > 0 ? esc(gbp(L.overdue)) + ' more than ' + GRACE + ' days late' : L.arrears > 0 ? 'Due in the last ' + GRACE + ' days' : 'Nothing owed'}</small></div>
    </div>`;
  }
  function rentTermsForm(p, back, open){
    const tn = p.tenancy || {}, t = todayLondon(), L = ledger(p, t), hasPays = (p.payments || []).length > 0;
    const days31 = [['', 'The same day as the first rent date']].concat(Array.from({ length: 31 }, (_, i) => [i + 1, i + 1 >= 29 ? ord(i + 1) + ' (or the month’s last day)' : ord(i + 1)]));
    const form = `<form class="form" method="post" action="/account/p/${p.id}/rent/terms">${hidden({ back })}
      <div class="row">${inp('Rent (£)', 'rent', rentPence(tn) ? plain(rentPence(tn)) : '', { req: true, max: 12, attrs: ' inputmode="decimal" placeholder="e.g. 1250"' })}${sel('How often', 'rentFreq', FREQ.map(f => [f[0], f[1]]), freqOf(tn))}</div>
      <div class="row">${inp('First rent date', 'rentStart', tn.rentStart || tn.start || '', { type: 'date', req: true, hint: 'Usually the day the tenancy started.' })}${sel('Due on (monthly, quarterly, yearly)', 'dueDay', days31, tn.dueDay || '')}</div>
      ${hasPays ? inp('A new amount applies from', 'from', L.next ? L.next.due : '', { type: 'date', opt: true, hint: 'If the rent has gone up or down: the first rent date at the new amount. Earlier rent keeps the old amount. Leave it blank to correct a mistake in every period.' }) : ''}
      <button class="btn primary sm">Save rent</button></form>`;
    return `<details class="edit"${open ? ' open' : ''}><summary>${rentPence(tn) ? 'Change the rent' : 'Add the rent'}</summary>${form}</details>`;
  }
  // The Rent section on the property page.
  function rentSection(p, t){
    const tn = p.tenancy, rs = rentStatus(p, t);
    const hasTenancy = !!(tn && (tn.names || tn.start));
    if (!hasTenancy && !(p.payments || []).length) return { st: rs, html: `<div class="acc-box"><p class="muted">Add the tenancy below first (the tenants and the start date). Then add the rent here to keep track of payments and send receipts.</p><a class="btn ghost sm" href="#tenancy">Add the tenancy</a></div>` };
    if (!plan(tn)) return { st: rs, html: `<div class="acc-box">${(p.payments || []).length ? `<p class="muted">${plural(p.payments.length, 'payment')} recorded. <a href="/account/p/${p.id}/rent">See them</a>.</p>` : ''}${rentTermsForm(p, 'p', true)}</div>` };
    const L = rs.L, sch = L.sch, nextOne = L.next; sch.forEach(s => { s.nextOne = nextOne; });
    // Show what needs doing: unpaid rent, the next period, and the last few paid ones.
    const recent = sch.slice().reverse(), owing = recent.filter(s => !s.future && s.left > 0);
    const show = (nextOne ? [nextOne] : []).concat(owing.slice(0, 6), recent.filter(s => !s.future && s.left <= 0).slice(0, owing.length ? 2 : 3)).sort((a, b) => b.due.localeCompare(a.due));
    const more = sch.length - show.length;
    return { st: rs, html: `<div class="acc-box rent-box">${rentFigs(p, L)}
      <ul class="rps">${show.map(s => periodRow(p, s, 'p', t)).join('')}</ul>
      ${L.untied.length ? `<p class="small">${plural(L.untied.length, 'payment')} not for a particular period, counted towards the oldest rent owed. <a href="/account/p/${p.id}/rent#other">See them</a>.</p>` : ''}
      <div class="acc-row"><a class="arrow" href="/account/p/${p.id}/rent">All rent and receipts${more > 0 ? ' (' + sch.length + ' periods)' : ''}</a><a class="linkbtn" href="/account/p/${p.id}/rent/receive?back=p">Record another payment</a></div>
      ${rentTermsForm(p, 'p', false)}</div>` };
  }
  // The Expenses section on the property page.
  function expenseSection(acc, p, t){
    const y = taxYearOf(t), list = (acc.expenses || []).filter(e => e.propId === p.id).sort((a, b) => b.date.localeCompare(a.date));
    const thisY = list.filter(e => inTY(e.date, y)), income = sum((p.payments || []).filter(x => inTY(x.date, y)), x => x.amt), spent = sum(thisY, e => e.amt);
    const st = thisY.length ? { cls: 'ok', text: gbp(spent) + ' this tax year' } : { cls: 'none', text: 'None this tax year' };
    return { st, html: `<div class="acc-box">
      <div class="ty-strip"><div><span>Rent received</span><b>${esc(gbp(income))}</b></div><div><span>Expenses</span><b>${esc(gbp(spent))}</b></div><div><span>Net</span><b>${esc(gbp(income - spent))}</b></div><small>This tax year, ${esc(tyLabel(y))} (6 April to 5 April)</small></div>
      <a class="btn primary sm" href="/account/expenses/new?p=${p.id}">Add an expense</a>
      ${list.length ? `<ul class="xps">${list.slice(0, 5).map(e => expRow(acc, e, false)).join('')}</ul>` : '<p class="muted">No expenses recorded yet. Add repairs, certificates, insurance, agent fees and other costs as they happen, with the receipt if you have it.</p>'}
      <div class="acc-row">${list.length ? `<a class="arrow" href="/account/expenses?p=${p.id}">All expenses for this property</a>` : ''}<a class="arrow" href="/account/money">Tax year summary</a></div></div>` };
  }
  function expRow(acc, e, showProp){
    const pr = e.propId && acc.properties.find(p => p.id === e.propId);
    return `<li class="xp"><div class="xp-main"><b>${esc(e.desc || e.supplier || catText(e.cat))}</b><small>${esc(fmt(e.date))} · ${esc(catText(e.cat))}${e.supplier && e.desc ? ' · ' + esc(e.supplier) : ''}${showProp ? ' · ' + esc(pr ? addrLine(pr) : 'All properties') : ''}${e.file ? ` · <a href="/account/files/${e.file.id}" target="_blank" rel="noopener">Receipt</a>` : ''}</small></div>
      <span class="xp-amt">${esc(gbp(e.amt))}</span><a class="xp-edit" href="/account/expenses/${e.id}" aria-label="Edit">Edit</a></li>`;
  }
  // The dashboard: one cell per property, and the tax-year strip.
  function dashCell(p, t){ const s = rentStatus(p, t); return `<div><dt>Rent</dt><dd>${stHTML(s)}${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</dd></div>`; }
  function dashStrip(acc, t){
    const y = taxYearOf(t), s = summary(acc, y);
    if (!acc.properties.length) return '';
    return `<div class="ty-dash"><div class="ty-dash-h"><b>This tax year</b><span>${esc(tyLabel(y))}</span></div>
      <div><span>Rent received</span><b>${esc(gbp(s.total.income))}</b></div><div><span>Expenses</span><b>${esc(gbp(s.total.expenses))}</b></div><div><span>Net</span><b>${esc(gbp(s.total.net))}</b></div>
      <a class="arrow" href="/account/money">Tax summary</a></div>`;
  }

  /* ------------------------------ rent terms ------------------------------ */
  app.post('/account/p/:id/rent/terms', need, urlenc, (req, res) => {
    if (busy(req, res)) return;
    const b = req.body || {}, p0 = prop(req.acc, req.params.id); if (!p0) return res.redirect(303, '/account');
    const rentP = parsePence(b.rent), first = validDate(b.rentStart), dd = parseInt(b.dueDay, 10), from = validDate(b.from);
    const freq = STEP[b.rentFreq] ? b.rentFreq : 'month';
    const err = !rentP ? 'Please enter the rent, for example 1250 or 1,250.00.' : !first ? 'Please enter the first rent date.' : '';
    if (err) return h.propertyPage(req, res, p0, { error: err, status: 400 });
    const p = update(req, p => {
      const old = p.tenancy || {}, tn = Object.assign({}, old, { rentFreq: freq, rentStart: first, dueDay: dd >= 1 && dd <= 31 && !STEP[freq].d ? dd : 0 });
      if (!old.start && !old.names) tn.start = first;
      applyRent(old, tn, rentP, (p.payments || []).length ? from : '');
      p.tenancy = tn;
    });
    if (!p) return res.redirect(303, '/account');
    res.redirect(303, backTo(b.back, p.id, 'rent', 'rent'));
  });

  /* ------------------------------ the rent page ------------------------------ */
  app.get('/account/p/:id/rent', need, (req, res) => {
    const p = prop(req.acc, req.params.id); if (!p) return res.redirect(303, '/account');
    const t = todayLondon(), L = ledger(p, t), a = p.address;
    L.sch.forEach(s => { s.nextOne = L.next; });
    const list = L.sch.slice().reverse(), first = list.slice(0, 24), rest = list.slice(24);
    const body = head(esc(addrLine(p)), 'Rent and receipts', plan(p.tenancy) ? esc(gbp(rentPence(p.tenancy)) + ' ' + perText(p.tenancy) + (p.tenancy.names ? ' · ' + p.tenancy.names : '')) : '',
      `<a class="btn primary" href="/account/p/${p.id}/rent/receive?back=rent">Record a payment</a>`, [addrLine(p), '/account/p/' + p.id + '#rent']) + `
<section class="tight"><div class="wrap narrow">
  ${plan(p.tenancy) ? rentFigs(p, L) : `<p class="acc-note">The rent isn’t set up yet. <a href="/account/p/${p.id}#rent">Add the rent</a> to see each period here.</p>`}
  ${!emailOn() ? '<p class="acc-note">Sending receipts by email isn’t switched on for this site yet. You can still open each receipt to download it as a PDF or print it.</p>' : !tenantEmails(p.tenancy).length && (p.payments || []).length ? `<p class="acc-note">To email receipts, <a href="/account/p/${p.id}#tenancy">add the tenant’s email address</a> to the tenancy. You can still download or print them.</p>` : ''}
  ${list.length ? `<ul class="rps">${first.map(s => periodRow(p, s, 'rent', t)).join('')}</ul>${rest.length ? `<details class="edit more"><summary>Earlier periods (${rest.length})</summary><ul class="rps">${rest.map(s => periodRow(p, s, 'rent', t)).join('')}</ul></details>` : ''}` : ''}
  <div class="acc-sub" id="other"><h2>Payments not for a particular period</h2><p class="muted">For example a catch-up payment. They count towards the oldest rent still owed.</p>
    ${L.untied.length ? L.untied.slice().reverse().map(x => payLine(p, x, 'rent')).join('') : '<p class="small">None.</p>'}
    <p><a class="btn ghost sm" href="/account/p/${p.id}/rent/receive?period=none&back=rent">Record a payment</a></p></div>
</div></section>`;
    send(req, res, { path: '/account/p/' + p.id + '/rent', title: 'Rent: ' + addrLine(p), body });
  });

  /* ------------------------------ record / edit a payment ------------------------------ */
  function payForm(req, res, p, o = {}){
    const t = todayLondon(), L = ledger(p, t), x = o.pay, v = o.values || {}, back = BACKS[req.query.back || v.back] ? (req.query.back || v.back) : 'p';
    const want = v.period != null ? v.period : x ? x.period || '' : req.query.period === 'none' ? '' : validDate(req.query.period) || (L.sch.find(s => !s.future && s.left > 0) || L.next || {}).due || '';
    const sp = L.sch.find(s => s.due === want);
    const periods = [['', 'Not for a particular period']].concat(L.sch.slice().reverse().slice(0, 120).map(s => [s.due, periodText(s) + (s.left <= 0 ? ' (paid)' : s.left < s.amt ? ' (' + gbp(s.left) + ' to pay)' : ' (' + gbp(s.amt) + ')')]));
    if (want && !periods.some(q => q[0] === want)) periods.push([want, fmt(want)]);
    const amt = v.amount != null ? v.amount : x ? plain(x.amt) : sp && sp.left > 0 ? plain(sp.left) : plan(p.tenancy) ? plain(rentPence(p.tenancy)) : '';
    const action = x ? payBase(p, x) : '/account/p/' + p.id + '/rent/receive';
    const body = head(esc(addrLine(p)), x ? 'Edit payment' : 'Record rent received', x ? 'Receipt no. ' + receiptNo(x.no) : esc((p.tenancy && p.tenancy.names) || ''), '', [x ? 'Rent and receipts' : addrLine(p), back === 'rent' ? '/account/p/' + p.id + '/rent' : '/account/p/' + p.id + '#rent']) + `
<section class="tight"><div class="wrap narrow"><form class="card form acc-form" method="post" action="${action}">${hidden({ back })}
  ${sel('For the rent period', 'period', periods, want)}
  <div class="row">${inp('Amount received (£)', 'amount', amt, { req: true, max: 12, attrs: ' inputmode="decimal"' })}${inp('Date received', 'date', v.date || (x ? x.date : t), { type: 'date', req: true })}</div>
  ${sel('Paid by', 'method', METHODS, v.method || (x ? x.method : lastMethod(p)))}
  ${inp('Note', 'note', v.note != null ? v.note : x ? x.note : '', { opt: true, max: 200, attrs: ' placeholder="e.g. paid in two parts"' })}
  <button class="btn primary">${x ? 'Save changes' : 'Mark as received'}</button>
  <p class="small">${x ? '' : 'You can send the tenant a receipt straight after.'}</p></form>
  ${x ? `<div class="acc-row danger-row">${postForm(payBase(p, x) + '/delete', { back }, 'Delete this payment', 'linkbtn danger', 'Delete this payment? Its receipt number won’t be used again.')}</div>` : ''}
</div></section>`;
    send(req, res, { path: action, title: x ? 'Edit payment' : 'Record rent received', body, status: o.status, notice: o.error ? { text: o.error } : null });
  }
  function readPay(b, p){
    const t = todayLondon(), L = ledger(p, t);
    const period = b.period && L.sch.some(s => s.due === b.period) ? b.period : '';
    const v = { period, amount: line(b.amount, 14), date: line(b.date, 10), method: METHODS.some(m => m[0] === b.method) ? b.method : 'other', note: line(b.note, 200), back: BACKS[b.back] ? b.back : 'p' };
    const amt = parsePence(v.amount), date = validDate(v.date);
    const error = !amt ? 'Please enter the amount received, for example 1250 or 1,250.00.' : !date ? 'Please enter the date it was received.' : date > addDays(t, 1) ? 'The date received can’t be in the future.' : '';
    return { v, amt, date, error, L };
  }
  app.get('/account/p/:id/rent/receive', need, (req, res) => { const p = prop(req.acc, req.params.id); if (!p) return res.redirect(303, '/account'); payForm(req, res, p); });
  app.post('/account/p/:id/rent/receive', need, urlenc, (req, res) => {
    if (busy(req, res)) return;
    const b = req.body || {}, p0 = prop(req.acc, req.params.id); if (!p0) return res.redirect(303, '/account');
    const r = readPay(b, p0);
    if (b.quick && r.v.period) {   // one tap: what's still owed for that period, today
      const s = r.L.sch.find(q => q.due === r.v.period);
      if (!s || s.left <= 0) return res.redirect(303, backTo(r.v.back, p0.id, 'already', 'rent'));
      r.amt = s.left; r.date = todayLondon(); r.error = '';
    }
    if (r.error) return payForm(req, res, p0, { values: r.v, error: r.error, status: 400 });
    if ((p0.payments || []).length >= MAX_PAYS) return payForm(req, res, p0, { values: r.v, error: 'This property has reached the limit of ' + MAX_PAYS + ' payments.', status: 400 });
    let id = '';
    const p = update(req, (p, acc) => {
      acc.receiptSeq = (acc.receiptSeq || 0) + 1; id = rid(8);
      (p.payments = p.payments || []).push({ id, no: acc.receiptSeq, date: r.date, amt: r.amt, method: r.v.method, note: r.v.note, period: r.v.period, createdAt: new Date().toISOString() });
    });
    if (!p) return res.redirect(303, '/account');
    res.redirect(303, backTo(r.v.back, p.id, 'received', 'pay-' + id));
  });
  const findPay = (p, pid) => p && (p.payments || []).find(x => x.id === String(pid));
  app.get('/account/p/:id/rent/pay/:pid', need, (req, res) => {
    const p = prop(req.acc, req.params.id), x = findPay(p, req.params.pid); if (!x) return res.redirect(303, p ? '/account/p/' + p.id + '#rent' : '/account');
    payForm(req, res, p, { pay: x });
  });
  app.post('/account/p/:id/rent/pay/:pid', need, urlenc, (req, res) => {
    if (busy(req, res)) return;
    const b = req.body || {}, p0 = prop(req.acc, req.params.id), x0 = findPay(p0, req.params.pid); if (!x0) return res.redirect(303, '/account');
    const r = readPay(b, p0);
    if (r.error) return payForm(req, res, p0, { pay: x0, values: r.v, error: r.error, status: 400 });
    const p = update(req, p => { const x = findPay(p, req.params.pid); if (x) Object.assign(x, { date: r.date, amt: r.amt, method: r.v.method, note: r.v.note, period: r.v.period, updatedAt: new Date().toISOString() }); });
    res.redirect(303, backTo(r.v.back, p.id, 'saved', 'pay-' + x0.id));
  });
  app.post('/account/p/:id/rent/pay/:pid/delete', need, urlenc, (req, res) => {
    if (busy(req, res)) return;
    const b = req.body || {};
    const p = update(req, p => { p.payments = (p.payments || []).filter(x => x.id !== String(req.params.pid)); });
    if (!p) return res.redirect(303, '/account');
    res.redirect(303, backTo(b.back, p.id, 'paydel', 'rent'));
  });

  /* ------------------------------ receipts ------------------------------ */
  function receiptHTML(r){
    return `<div class="receipt"><div class="rc-top"><span>Rent receipt</span><span>No. ${esc(r.no)}</span></div>
      <h2>Received with thanks</h2><p class="rc-amt">${esc(gbp(r.amount, true))}</p><p class="rc-for">${esc(r.period ? 'Rent for ' + r.period : 'Rent')}, received ${esc(fmt(r.date))}</p>
      <dl>${receiptRows(r).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <p class="rc-foot">This receipt confirms that the landlord named above received the payment shown. Please keep it for your records.</p></div>`;
  }
  app.get('/account/p/:id/rent/pay/:pid/receipt', need, (req, res) => {
    const p = prop(req.acc, req.params.id), x = findPay(p, req.params.pid); if (!x) return res.redirect(303, '/account');
    const r = receiptData(req.acc, p, x), to = tenantEmails(p.tenancy);
    const mail = !emailOn() ? '<p class="acc-note">Sending receipts by email isn’t switched on for this site yet. You can download the PDF or print this page and give it to your tenant.</p>'
      : !to.length ? `<p class="acc-note">There’s no email address for the tenant. <a href="/account/p/${p.id}#tenancy">Add it to the tenancy</a> to send receipts, or download the PDF.</p>`
      : `${postForm(payBase(p, x) + '/receipt/send', { back: 'receipt' }, x.sentAt ? 'Send to the tenant again' : 'Email to the tenant', 'btn primary')}`;
    const body = head(esc(addrLine(p)), 'Rent receipt', x.sentAt ? 'Sent to ' + esc(x.sentTo || 'the tenant') + ' on ' + esc(fmtIsoDay(x.sentAt)) : to.length && emailOn() ? 'Not sent yet. It will go to ' + esc(to.join(', ')) + '.' : '', '', ['Rent and receipts', '/account/p/' + p.id + '/rent#pay-' + x.id]) + `
<section class="tight"><div class="wrap narrow">${receiptHTML(r)}
  <div class="acc-row rc-actions no-print">${mail}<a class="btn ghost" href="${payBase(p, x)}/receipt.pdf">Download PDF</a><button type="button" class="btn ghost" onclick="window.print()">Print</button></div>
</div></section>`;
    send(req, res, { path: payBase(p, x) + '/receipt', title: 'Rent receipt ' + r.no, body });
  });
  app.get('/account/p/:id/rent/pay/:pid/receipt.pdf', need, async (req, res) => {
    const p = prop(req.acc, req.params.id), x = findPay(p, req.params.pid); if (!x) return res.status(404).type('text/plain').send('Receipt not found.');
    const r = receiptData(req.acc, p, x), pdf = await receiptPDF(r);
    res.set({ 'Content-Disposition': `${req.query.inline ? 'inline' : 'attachment'}; filename="Rent receipt ${r.no}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.type('pdf').send(pdf);
  });
  const nameOnly = s => String(s || '').replace(/["<>\r\n\\]/g, '').trim().slice(0, 60);
  const greet = names => { const n = String(names || '').split(/\s*(?:,|;|&|\band\b)\s*/).map(s => s.trim()).filter(Boolean); return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0] || 'there'; };
  function receiptEmail(r, to, pdf){
    const rows = receiptRows(r).map(([k, v]) => `<tr><td style="padding:9px 12px 9px 0;border-top:1px solid #E4D9C6;color:#8E8A7E;font-size:14px;vertical-align:top;width:40%">${esc(k)}</td><td style="padding:9px 0;border-top:1px solid #E4D9C6;font-weight:${k === 'Amount received' ? 700 : 500}">${esc(v)}</td></tr>`).join('');
    const html = emailHTML([`Hello ${esc(greet(r.tenants))},`, `Thank you for your payment. Here is your receipt for the rent below, sent by ${esc(r.landlord)}. A PDF copy is attached.`,
      `<div style="margin:6px 0 18px;padding:18px 18px 8px;background:#F5EFE4;border-radius:10px"><p style="margin:0 0 2px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8E8A7E;font-weight:700">Rent receipt · No. ${esc(r.no)}</p>
       <p style="margin:0 0 4px;font-size:15px;color:#4A5568">Received with thanks</p><p style="margin:0 0 14px;font-size:28px;font-weight:700;color:#13213A">${esc(gbp(r.amount, true))}</p>
       <table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table></div>`,
      `If anything here doesn’t look right, just reply to this email and it will go to ${esc(r.landlord)}.`], null,
      `Sent by ${esc(r.landlord)} with the DIY Inventory landlord dashboard. Please keep this receipt for your records.`);
    const txt = [`Hello ${greet(r.tenants)},`, '', `Thank you for your payment. Here is your receipt for the rent below, sent by ${r.landlord}. A PDF copy is attached.`, '',
      'RENT RECEIPT · No. ' + r.no, 'Received with thanks: ' + gbp(r.amount, true), ''].concat(receiptRows(r).map(([k, v]) => k + ': ' + v), ['', `If anything here doesn’t look right, reply to this email and it will go to ${r.landlord}.`]).join('\n');
    return { to, subject: `Rent receipt: ${gbp(r.amount, true)} received ${fmt(r.date)}, ${r.address.split(',')[0]}`, html, text: txt, replyTo: r.landlordEmail, fromName: nameOnly(r.landlord) + ' via DIY Inventory',
      attachments: [{ filename: 'Rent receipt ' + r.no + '.pdf', content: pdf.toString('base64') }] };
  }
  app.post('/account/p/:id/rent/pay/:pid/receipt/send', need, urlenc, async (req, res) => {
    const b = req.body || {}, p = prop(req.acc, req.params.id), x = findPay(p, req.params.pid); if (!x) return res.redirect(303, '/account');
    const back = b.back === 'receipt' ? payBase(p, x) + '/receipt' : (BACKS[b.back] || BACKS.p)(p.id);
    const fail = (text, status) => { res.status(status); return send(req, res, { path: back, title: 'Receipt not sent', status, notice: { text },
      body: head(esc(addrLine(p)), 'The receipt wasn’t sent', esc(text), `<a class="btn primary" href="${payBase(p, x)}/receipt">Open the receipt</a><a class="btn ghost" href="${back}">Back</a>`, ['Back', back]) }); };
    if (!emailOn()) return fail('Sending receipts by email isn’t switched on for this site yet. You can download the receipt as a PDF or print it instead.', 503);
    const to = tenantEmails(p.tenancy);
    if (!to.length) return fail('There’s no email address for the tenant. Add it to the tenancy first, or download the receipt as a PDF.', 400);
    if (!sends(req.acc.id) || !sendsIp(clientIp(req))) return fail('Too many receipts sent in the last hour. Please try again later.', 429);
    const r = receiptData(req.acc, p, x), m = receiptEmail(r, to, await receiptPDF(r));
    const out = await sendEmail(m);
    if (!out || !out.ok) return fail('The email couldn’t be sent just now. Please try again in a few minutes, or download the PDF.', 502);
    update(req, p => { const y = findPay(p, req.params.pid); if (y) { y.sentAt = new Date().toISOString(); y.sentTo = to.join(', '); } });
    res.redirect(303, back + '?m=receipt' + (b.back === 'receipt' ? '' : '#pay-' + x.id));
  });

  /* ------------------------------ expenses ------------------------------ */
  const findExp = (acc, eid) => (acc.expenses || []).find(e => e.id === String(eid));
  function expForm(req, res, o = {}){
    const acc = req.acc, e = o.exp, v = Object.assign({}, e ? { propId: e.propId, date: e.date, cat: e.cat, supplier: e.supplier, desc: e.desc, amount: plain(e.amt) } : { propId: acc.properties.some(p => p.id === req.query.p) ? req.query.p : '', date: todayLondon(), cat: 'repairs' }, o.values || {});
    const props = [['', 'All properties (a general cost)']].concat(acc.properties.slice().sort((a, b) => addrLine(a).localeCompare(addrLine(b), 'en', { numeric: true })).map(p => [p.id, addrLine(p) + ', ' + p.address.postcode]));
    const back = v.propId ? '/account/p/' + v.propId + '#expenses' : '/account/expenses';
    const action = e ? '/account/expenses/' + e.id : '/account/expenses';
    const body = head('Expenses', e ? 'Edit expense' : 'Add an expense', 'A cost for a property: repairs, certificates, insurance, fees and the like. Keep the receipt with it if you have one.', '', [v.propId ? 'Back to the property' : 'All expenses', back]) + `
<section class="tight"><div class="wrap narrow"><form class="card form acc-form" method="post" action="${action}" enctype="multipart/form-data">
  ${sel('Property', 'propId', props, v.propId)}
  <div class="row">${inp('Amount (£)', 'amount', v.amount, { req: true, max: 12, attrs: ' inputmode="decimal" placeholder="e.g. 85.00"' })}${inp('Date', 'date', v.date, { type: 'date', req: true })}</div>
  ${sel('What it was for', 'cat', CATS, v.cat)}
  ${inp('Description', 'desc', v.desc, { opt: true, max: 200, attrs: ' placeholder="e.g. New kitchen tap"' })}
  ${inp('Supplier', 'supplier', v.supplier, { opt: true, max: 100, attrs: ' placeholder="e.g. A. Smith Plumbing"' })}
  <label><b>Receipt or invoice <span>(optional: PDF, JPEG or PNG, up to 10 MB)</span></b><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"></label>
  ${e && e.file ? `<p class="small">Kept: <a href="/account/files/${e.file.id}" target="_blank" rel="noopener">${esc(e.file.name)}</a></p><label class="check"><input type="checkbox" name="removeFile" value="1"> Remove this file</label>` : ''}
  <button class="btn primary">${e ? 'Save changes' : 'Save expense'}</button></form>
  ${e ? `<div class="acc-row danger-row">${postForm('/account/expenses/' + e.id + '/delete', {}, 'Delete this expense', 'linkbtn danger', 'Delete this expense and its receipt file?')}</div>` : ''}
</div></section>`;
    send(req, res, { path: action, title: e ? 'Edit expense' : 'Add an expense', body, status: o.status, notice: o.error ? { text: o.error } : null });
  }
  function readExp(req){
    const b = req.body || {}, acc = req.acc;
    const v = { propId: acc.properties.some(p => p.id === b.propId) ? b.propId : '', date: line(b.date, 10), cat: CATS.some(c => c[0] === b.cat) ? b.cat : 'other', supplier: line(b.supplier, 100), desc: line(b.desc, 200), amount: line(b.amount, 14) };
    const amt = parsePence(v.amount), date = validDate(v.date);
    const error = req.formError || (!amt ? 'Please enter the amount, for example 85 or 85.00.' : !date ? 'Please enter the date of the cost.' : date > addDays(todayLondon(), 366) ? 'Please check the date.' : '');
    return { v, amt, date, error };
  }
  app.get('/account/expenses/new', need, (req, res) => expForm(req, res));
  app.post('/account/expenses', need, multipart, (req, res) => {
    if (busy(req, res)) return;
    const r = readExp(req);
    if (r.error) return expForm(req, res, { values: r.v, error: r.error, status: /large/.test(r.error) ? 413 : 400 });
    const acc = readAcc(req.acc.id); if (!acc) return res.redirect(303, '/account');
    if ((acc.expenses || []).length >= MAX_EXP) return expForm(req, res, { values: r.v, error: 'You’ve reached the limit of ' + MAX_EXP + ' expenses.', status: 400 });
    const f = takeFile(req, acc, null, 'receipt');
    if (f.error) return expForm(req, res, { values: r.v, error: f.error, status: /large/.test(f.error) ? 413 : 400 });
    (acc.expenses = acc.expenses || []).push({ id: rid(8), propId: r.v.propId, date: r.date, cat: r.v.cat, supplier: r.v.supplier, desc: r.v.desc, amt: r.amt, file: f.file || null, createdAt: new Date().toISOString() });
    writeAcc(acc);
    res.redirect(303, r.v.propId ? '/account/p/' + r.v.propId + '?m=expense#expenses' : '/account/expenses?m=expense');
  });
  app.get('/account/expenses/:eid', need, (req, res) => { const e = findExp(req.acc, req.params.eid); if (!e) return res.redirect(303, '/account/expenses'); expForm(req, res, { exp: e }); });
  app.post('/account/expenses/:eid', need, multipart, (req, res) => {
    if (busy(req, res)) return;
    const e0 = findExp(req.acc, req.params.eid); if (!e0) return res.redirect(303, '/account/expenses');
    const r = readExp(req);
    if (r.error) return expForm(req, res, { exp: e0, values: r.v, error: r.error, status: /large/.test(r.error) ? 413 : 400 });
    const acc = readAcc(req.acc.id), e = acc && findExp(acc, req.params.eid); if (!e) return res.redirect(303, '/account/expenses');
    const f = takeFile(req, acc, e.file, 'receipt');
    if (f.error) return expForm(req, res, { exp: e0, values: r.v, error: f.error, status: /large/.test(f.error) ? 413 : 400 });
    let file = f.file || e.file || null;
    if (!f.file && (req.body || {}).removeFile && e.file) { try { fs.unlinkSync(path.join(FILE_DIR, acc.id, e.file.id + '.' + e.file.ext)); } catch (err) {} file = null; }
    Object.assign(e, { propId: r.v.propId, date: r.date, cat: r.v.cat, supplier: r.v.supplier, desc: r.v.desc, amt: r.amt, file, updatedAt: new Date().toISOString() });
    writeAcc(acc);
    res.redirect(303, r.v.propId ? '/account/p/' + r.v.propId + '?m=expense#expenses' : '/account/expenses?m=expense');
  });
  app.post('/account/expenses/:eid/delete', need, urlenc, (req, res) => {
    if (busy(req, res)) return;
    const acc = readAcc(req.acc.id), e = acc && findExp(acc, req.params.eid); if (!e) return res.redirect(303, '/account/expenses');
    if (e.file) { try { fs.unlinkSync(path.join(FILE_DIR, acc.id, e.file.id + '.' + e.file.ext)); } catch (err) {} }
    acc.expenses = acc.expenses.filter(x => x.id !== e.id); writeAcc(acc);
    res.redirect(303, e.propId && acc.properties.some(p => p.id === e.propId) ? '/account/p/' + e.propId + '?m=expdel#expenses' : '/account/expenses?m=expdel');
  });
  app.get('/account/expenses', need, (req, res) => {
    const acc = req.acc, t = todayLondon(), years = taxYears(acc, t), y = years.includes(Number(req.query.y)) ? Number(req.query.y) : req.query.y === 'all' ? 'all' : taxYearOf(t);
    const pid = acc.properties.some(p => p.id === req.query.p) ? req.query.p : req.query.p === 'general' ? 'general' : '';
    const list = (acc.expenses || []).filter(e => (y === 'all' || inTY(e.date, y)) && (!pid || (pid === 'general' ? !e.propId : e.propId === pid))).sort((a, b) => b.date.localeCompare(a.date));
    const props = [['', 'All properties'], ['general', 'General costs only']].concat(acc.properties.map(p => [p.id, addrLine(p)]));
    const body = head('Expenses', 'Expenses', 'Costs for your properties. Choose a property or a tax year to narrow the list.', `<a class="btn primary" href="/account/expenses/new${pid && pid !== 'general' ? '?p=' + pid : ''}">Add an expense</a><a class="btn ghost" href="/account/money">Tax year summary</a>`, ['All properties', '/account']) + `
<section class="tight"><div class="wrap narrow">
  <form class="form filters" method="get" action="/account/expenses">${sel('Property', 'p', props, pid)}${sel('Tax year', 'y', years.map(x => [x, tyLabel(x)]).concat([['all', 'All years']]), y)}<button class="btn ghost sm">Show</button></form>
  <div class="xp-total"><span>${plural(list.length, 'expense')}${y === 'all' ? '' : ' in ' + tyLabel(y)}</span><b>${esc(gbp(sum(list, e => e.amt)))}</b></div>
  ${list.length ? `<ul class="xps">${list.map(e => expRow(acc, e, true)).join('')}</ul>` : '<p class="muted">No expenses here yet.</p>'}
</div></section>
<script>document.querySelectorAll('.filters select').forEach(s=>s.addEventListener('change',()=>s.form.submit()));</script>`;
    send(req, res, { path: '/account/expenses', title: 'Expenses', body });
  });

  /* ------------------------------ the tax-year summary ------------------------------ */
  const yearOf = (req, acc) => { const y = Number(req.params.y || req.query.y); return y >= 2000 && y <= 2100 ? y : taxYearOf(todayLondon()); };
  app.get('/account/money', need, (req, res) => {
    const acc = req.acc, t = todayLondon(), y = yearOf(req, acc), years = taxYears(acc, t); if (!years.includes(y)) years.push(y); years.sort((a, b) => b - a);
    const s = summary(acc, y), cats = CATS.filter(c => s.total.byCat[c[0]]);
    const sw = `<nav class="ty-switch" aria-label="Tax year"><a href="/account/money?y=${y - 1}" aria-label="Previous tax year">←</a><form method="get" action="/account/money">${sel('Tax year', 'y', years.map(x => [x, tyLabel(x)]), y)}</form><a href="/account/money?y=${y + 1}" aria-label="Next tax year">→</a></nav>`;
    const dl = `/account/money/${y}`;
    const body = head('Money and tax', 'Tax year ' + tyLabel(y), '6 April ' + y + ' to 5 April ' + (y + 1) + '. Rent received and expenses for each property.', '', ['All properties', '/account']) + `
<section class="tight"><div class="wrap narrow">
  ${sw}
  <div class="ty-big"><div><span>Rent received</span><b>${esc(gbp(s.total.income))}</b></div><div><span>Expenses</span><b>${esc(gbp(s.total.expenses))}</b></div><div><span>Net</span><b>${esc(gbp(s.total.net))}</b><small>rent less expenses</small></div></div>
  <p class="acc-note">A record to help with your Self Assessment. It isn’t tax advice. Rent is counted on the date you received it, and costs on their date. Check with HMRC’s guidance or an accountant what you can claim.</p>
  <h2 class="ty-h">By property</h2>
  ${s.rows.length ? `<div class="tbl"><table><thead><tr><th>Property</th><th>Rent received</th><th>Expenses</th><th>Net</th></tr></thead><tbody>${s.rows.map(r => `<tr><td>${r.p ? `<a href="/account/p/${r.p.id}">${esc(r.label)}</a>` : esc(r.label)}</td><td>${esc(gbp(r.income))}</td><td>${r.count ? `<a href="/account/expenses?y=${y}&p=${r.p ? r.p.id : 'general'}">${esc(gbp(r.expenses))}</a>` : esc(gbp(r.expenses))}</td><td>${esc(gbp(r.net))}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th>Total</th><th>${esc(gbp(s.total.income))}</th><th>${esc(gbp(s.total.expenses))}</th><th>${esc(gbp(s.total.net))}</th></tr></tfoot></table></div>` : '<p class="muted">No properties yet.</p>'}
  <h2 class="ty-h">Expenses by category</h2>
  ${cats.length ? `<div class="tbl"><table class="cats"><tbody>${cats.map(c => `<tr><td>${esc(c[1])}</td><td>${esc(gbp(s.total.byCat[c[0]]))}</td></tr>`).join('')}</tbody><tfoot><tr><th>Total</th><th>${esc(gbp(s.total.expenses))}</th></tr></tfoot></table></div>` : '<p class="muted">No expenses recorded in this tax year.</p>'}
  <div class="acc-sub dl"><h2>Download for my accountant</h2><p class="muted">Spreadsheets (CSV) open in Excel, Numbers or Google Sheets.</p>
    <div class="dl-list"><a class="btn primary sm" href="${dl}/summary.pdf">Summary (PDF)</a><a class="btn ghost sm" href="${dl}/summary.csv">Summary (CSV)</a><a class="btn ghost sm" href="${dl}/income.csv">Rent received (CSV)</a><a class="btn ghost sm" href="${dl}/expenses.csv">Expenses (CSV)</a></div></div>
</div></section>
<script>document.querySelectorAll('.ty-switch select').forEach(s=>s.addEventListener('change',()=>s.form.submit()));</script>`;
    send(req, res, { path: '/account/money', title: 'Tax year ' + tyLabel(y), body });
  });
  const dlName = (y, what, ext) => `DIY Inventory - ${what} - tax year ${tyLabel(y).replace('–', '-')}.${ext}`;
  const csvOut = (res, y, what, body) => { res.set({ 'Content-Disposition': `attachment; filename="${dlName(y, what, 'csv')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.type('text/csv; charset=utf-8').send(body); };
  app.get('/account/money/:y/income.csv', need, (req, res) => { const y = yearOf(req); csvOut(res, y, 'rent received', incomeCSV(req.acc, y)); });
  app.get('/account/money/:y/expenses.csv', need, (req, res) => { const y = yearOf(req); csvOut(res, y, 'expenses', expensesCSV(req.acc, y)); });
  app.get('/account/money/:y/summary.csv', need, (req, res) => { const y = yearOf(req); csvOut(res, y, 'summary', summaryCSV(req.acc, y)); });
  app.get('/account/money/:y/summary.pdf', need, async (req, res) => {
    const y = yearOf(req), pdf = await summaryPDF(req.acc, y);
    res.set({ 'Content-Disposition': `${req.query.inline ? 'inline' : 'attachment'}; filename="${dlName(y, 'rent and expenses', 'pdf')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.type('pdf').send(pdf);
  });

  return { rentSection, expenseSection, dashCell, dashStrip };
}

// For /admin: counts only, never amounts.
function adminCounts(accs){
  let rentProps = 0, payments = 0, receipts = 0, expenses = 0;
  accs.forEach(a => { (a.expenses || []).forEach(() => expenses++); a.properties.forEach(p => { if (plan(p.tenancy)) rentProps++; (p.payments || []).forEach(x => { payments++; if (x.sentAt) receipts++; }); }); });
  return { rentProps, payments, receipts, expenses };
}

module.exports = { mount, adminCounts, rentStatus, rentReminderItems, applyRent, parsePence, gbp, rentPence, freqOf, perText, FREQ, STEP, GRACE,
  _test: { plan, schedule, ledger, rentOn, applyRent, parsePence, gbp, taxYearOf, tyRange, tyLabel, summary, incomeCSV, expensesCSV, summaryCSV, csv, receiptData, receiptPDF, summaryPDF, pdfText, periodText, rentStatus, rentReminderItems } };
