// Free landlord area: a public page (/landlords) and private accounts (/account) where a landlord keeps each
// property's certificates and tenancy: the EPC (looked up on the government register by postcode), Gas
// Safety and EICR dates and files, and the tenancy and deposit. A daily job emails reminders before
// anything expires. Stored as JSON under REPORTS_DIR/landlords/ (accounts/<id>.json, one per account with
// its properties; index.json maps emails to ids; files/<id>/ holds uploaded certificates, served only to
// their owner). The owner sees accounts and upcoming expiries on /admin ("Landlord accounts").
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const money = require('./landlords-money');   // rent, receipts, expenses and the tax-year summary

let DIR = '', ACC_DIR = '', FILE_DIR = '';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(d, null, 1)); fs.renameSync(t, f); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const line = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const text = (v, n) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = e => line(e, 120).toLowerCase();
const rid = n => crypto.randomBytes(n).toString('hex');
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const pounds = n => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/* ------------------------------------ dates ------------------------------------ */
// Dates are kept as YYYY-MM-DD (UK calendar days); "today" is the date in London.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s){
  s = String(s || '').trim(); if (!ISO.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return y > 1950 && y < 2200 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : '';
}
const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const days = (from, to) => Math.round((toUTC(to) - toUTC(from)) / 86400000);
const addDays = (s, n) => new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
function addMonths(s, n){
  const [y, m, d] = s.split('-').map(Number), t = m - 1 + n, ny = y + Math.floor(t / 12), nm = ((t % 12) + 12) % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return ny + '-' + String(nm + 1).padStart(2, '0') + '-' + String(Math.min(d, dim)).padStart(2, '0');
}
const todayLondon = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const londonHour = (d = new Date()) => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(d), 10);
const fmt = s => s ? new Date(toUTC(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
const fmtLong = s => new Date(toUTC(s)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const inDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? 'in ' + n + ' days' : plural(-n, 'day') + ' ago';

/* ----------------------------------- addresses ----------------------------------- */
const PC_RE = /^(GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/;
function normPostcode(v){ const t = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (t.length < 5 || t.length > 7) return ''; const p = t.slice(0, -3) + ' ' + t.slice(-3); return PC_RE.test(p) ? p : ''; }
// UK order, as the app does it: a number goes before the building name if there is one, otherwise before the road; "Flat 4" stands on its own.
function streetLine(a){
  const no = a.houseNo || '', b = a.building || '', r = a.road || '';
  if (!no) return [b, r].filter(Boolean).join(', ');
  if (/^\d+[A-Za-z]?(-\d+[A-Za-z]?)?$/.test(no)) return b ? [no + ' ' + b, r].filter(Boolean).join(', ') : (r ? no + ' ' + r : no);
  return [no, b, r].filter(Boolean).join(', ');
}
const fullAddress = a => [streetLine(a), a.town, a.postcode].filter(Boolean).join(', ');
const TYPES = ['Flat', 'Maisonette', 'Studio', 'Terraced house', 'Semi-detached house', 'Detached house', 'Bungalow', 'HMO or shared house', 'Other'];
const bedsText = b => b === 0 ? 'Studio' : b >= 6 ? '6 or more bedrooms' : plural(b, 'bedroom');

/* ----------------------------------- storage ----------------------------------- */
const accFile = id => path.join(ACC_DIR, id + '.json');
const ID_RE = /^[a-f0-9]{16}$/;
const readAcc = id => ID_RE.test(String(id)) ? readJson(accFile(id), null) : null;
const writeAcc = acc => writeJson(accFile(acc.id), acc);
const readIndex = () => readJson(path.join(DIR, 'index.json'), { byEmail: {} });
const writeIndex = d => writeJson(path.join(DIR, 'index.json'), d);
const readState = () => readJson(path.join(DIR, 'state.json'), {});
const writeState = d => writeJson(path.join(DIR, 'state.json'), d);
const accountIds = () => { try { return fs.readdirSync(ACC_DIR).filter(f => /^[a-f0-9]{16}\.json$/.test(f)).map(f => f.slice(0, 16)); } catch (e) { return []; } };
const allAccounts = () => accountIds().map(readAcc).filter(Boolean);
function deleteAccount(id){
  const acc = readAcc(id); if (!acc) return false;
  const idx = readIndex(); if (idx.byEmail[acc.email] === id) { delete idx.byEmail[acc.email]; writeIndex(idx); }
  try { fs.unlinkSync(accFile(id)); } catch (e) {}
  try { fs.rmSync(path.join(FILE_DIR, id), { recursive: true, force: true }); } catch (e) {}
  console.log('landlords: account deleted ' + id);
  return true;
}

/* ---------------------------------- passwords ---------------------------------- */
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(String(pw).normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? no(e) : ok(k)));
async function hashPassword(pw){ const salt = crypto.randomBytes(16); return { salt: salt.toString('hex'), hash: (await scrypt(pw, salt)).toString('hex') }; }
async function checkPassword(acc, pw){
  const k = await scrypt(pw, Buffer.from(acc ? acc.salt : '00'.repeat(16), 'hex'));   // the same work for an unknown email
  if (!acc) return false;
  const h = Buffer.from(acc.hash, 'hex');
  return k.length === h.length && crypto.timingSafeEqual(k, h);
}

/* ------------------------------------ email ------------------------------------ */
// Resend (resend.com), the same account as the report emails: RESEND_API_KEY, from REPORT_FROM_EMAIL.
let mailer = null;   // tests put a stub here
const emailOn = () => !!mailer || !!(process.env.RESEND_API_KEY || '').trim();
async function sendEmail(m){
  if (mailer) return mailer(m);
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return { ok: false, reason: 'not-configured' };
  const from = (process.env.REPORT_FROM_EMAIL || '').trim() || 'DIY Inventory <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: m.fromName ? `"${m.fromName.replace(/["<>\r\n\\]/g, '')}" <${(/<([^>]+)>/.exec(from) || [, from])[1].trim()}>` : from, to: m.to, subject: m.subject, html: m.html, text: m.text },
        m.replyTo ? { reply_to: m.replyTo } : {}, m.attachments ? { attachments: m.attachments } : {})) });
    if (!res.ok) { console.error('landlords: email failed: HTTP ' + res.status, (await res.text().catch(() => '')).slice(0, 300)); return { ok: false, reason: 'send-failed' }; }
    return { ok: true };
  } catch (e) { console.error('landlords: email failed:', e.message); return { ok: false, reason: 'send-failed' }; }
}
// A plain, readable email: one column, the site's ink and green, no images.
function emailHTML(paras, button, foot){
  const p = t => `<p style="margin:0 0 16px">${t}</p>`;
  return `<!doctype html><html><body style="margin:0;background:#F7F5F0;padding:24px 12px;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#17191C">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E1DDD3;border-radius:10px;padding:28px 26px">
<div style="font-weight:700;font-size:15px;margin:0 0 22px;color:#1F4B3A">DIY Inventory</div>
${paras.map(x => x.startsWith('<') ? x : p(x)).join('\n')}
${button ? `<p style="margin:22px 0 6px"><a href="${esc(button[1])}" style="display:inline-block;background:#1F4B3A;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">${esc(button[0])}</a></p>` : ''}
</div>
<p style="max-width:560px;margin:14px auto 0;color:#868B92;font-size:13px">${foot || ''}</p>
</body></html>`;
}

/* --------------------------------- certificates --------------------------------- */
const gasExpiry = g => g && g.date ? (g.expiresSet || addMonths(g.date, 12)) : '';
const eicrDue = e => e && e.date ? (e.dueSet || addMonths(e.date, 60)) : '';
const epcExpiry = e => e ? (e.expires || (e.lodged ? addMonths(e.lodged, 120) : '')) : '';
const LABEL = { gas: 'Gas Safety certificate', eicr: 'Electrical safety report (EICR)', epc: 'EPC', tenancy: 'Tenancy', deposit: 'Deposit protection' };
const SHORT = { gas: 'Gas Safety', eicr: 'EICR', epc: 'EPC', tenancy: 'Tenancy', deposit: 'Deposit' };
const CERT_STAGES = [60, 30, 14, 7, 0];
function certStatus(kind, p, t){
  const due = kind === 'gas' ? gasExpiry(p.gas) : kind === 'eicr' ? eicrDue(p.eicr) : epcExpiry(p.epc);
  if (!due) return { cls: 'none', text: 'Not added', due: '' };
  const d = days(t, due);
  if (d < 0) return { cls: 'exp', text: 'Expired ' + fmt(due), due, d };
  if (d === 0) return { cls: 'exp', text: 'Expires today', due, d };
  if (d <= 60) return { cls: 'due', text: 'Due in ' + plural(d, 'day'), due, d };
  if (kind === 'eicr' && p.eicr.result === 'unsatisfactory' && !p.eicr.remedialDate) return { cls: 'due', text: 'Unsatisfactory: remedial work to do', due, d };
  return { cls: 'ok', text: 'Valid until ' + fmt(due), due, d };
}
const depositDeadline = tn => tn && tn.start && tn.deposit > 0 && !tn.protectedOn ? addDays(tn.start, 30) : '';
function tenancyStatus(p, t){
  const tn = p.tenancy;
  if (!tn || !(tn.names || tn.start)) return { cls: 'none', text: 'No tenancy added' };
  if (tn.start && days(t, tn.start) > 0) return { cls: 'ok', text: 'Starts ' + fmt(tn.start) };
  if (tn.end && days(t, tn.end) >= 0) { const d = days(t, tn.end); return d <= 60 ? { cls: 'due', text: 'Ends in ' + plural(d, 'day') } : { cls: 'ok', text: 'Until ' + fmt(tn.end) }; }
  if (tn.periodic) return { cls: 'ok', text: 'Periodic' + (tn.end ? ' since ' + fmt(tn.end) : tn.start ? ' since ' + fmt(tn.start) : '') };
  if (tn.end) return { cls: 'exp', text: 'Ended ' + fmt(tn.end) };
  return { cls: 'ok', text: tn.start ? 'Since ' + fmt(tn.start) : 'Current' };
}
function depositStatus(p, t){
  const tn = p.tenancy;
  if (!tn || !(tn.deposit > 0)) return { cls: 'none', text: 'No deposit recorded' };
  if (tn.protectedOn) return { cls: 'ok', text: 'Protected' + (tn.scheme ? ' with ' + tn.scheme : '') };
  const dl = depositDeadline(tn);
  if (!dl) return { cls: 'due', text: 'Not protected yet' };
  const d = days(t, dl);
  return d < 0 ? { cls: 'exp', text: 'Not protected: 30 days passed ' + fmt(dl) } : { cls: 'due', text: 'Protect by ' + fmt(dl) };
}
// What the reminder job looks at, for one property: each with its date and the days before it to send.
function dueItems(p){
  const out = [];
  [['gas', gasExpiry(p.gas)], ['eicr', eicrDue(p.eicr)], ['epc', epcExpiry(p.epc)]].forEach(([kind, due]) => { if (due) out.push({ kind, due, stages: CERT_STAGES }); });
  const tn = p.tenancy;
  if (tn && tn.end && !tn.periodic) out.push({ kind: 'tenancy', due: tn.end, stages: [60] });
  const dl = depositDeadline(tn); if (dl) out.push({ kind: 'deposit', due: dl, stages: [14, 7, 0] });
  return out;
}
// The reminder due now: the nearest stage at or above the days left (so a date added late gets one reminder,
// not all of them). A missed "today" is caught up for 3 days.
function stageFor(stages, left){
  if (left < 0) return left >= -3 && stages.includes(0) ? 0 : null;
  const s = stages.filter(x => left <= x); return s.length ? Math.min.apply(null, s) : null;
}
function bookLink(base, kind, p){
  const q = new URLSearchParams({ svc: kind, postcode: p.address.postcode, address: [streetLine(p.address), p.address.town].filter(Boolean).join(', '), beds: String(p.beds) });
  return base + '/certificates?' + q.toString() + '#book';
}

/* ------------------------------------ EPC ------------------------------------ */
// The England & Wales EPC register (epc.opendatacommunities.org: register for a free key). The data is
// moving to a new government service (get-energy-performance-data.communities.gov.uk); EPC_API_BASE
// switches the address, and the reader below takes either service's field names.
function epcConf(){
  return { base: (process.env.EPC_API_BASE || 'https://epc.opendatacommunities.org/api/v1').trim().replace(/\/+$/, ''),
    email: (process.env.EPC_API_EMAIL || '').trim(), key: (process.env.EPC_API_KEY || '').trim(), token: (process.env.EPC_API_TOKEN || '').trim() };
}
const epcOn = () => { const c = epcConf(); return !!((c.email && c.key) || c.token); };
const FIND_EPC = pc => 'https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode=' + encodeURIComponent(pc);
const EPC_CERT = no => 'https://find-energy-certificate.service.gov.uk/energy-certificate/' + encodeURIComponent(no);
function epcRow(r){
  if (!r || typeof r !== 'object') return null;
  const g = (...ks) => { for (const k of ks) if (r[k] != null && r[k] !== '') return String(r[k]); return ''; };
  const address = g('address') || [g('address1', 'addressLine1'), g('address2', 'addressLine2'), g('address3', 'addressLine3'), g('posttown', 'postTown')].filter(Boolean).join(', ');
  const rating = g('current-energy-rating', 'currentEnergyEfficiencyBand', 'currentEnergyRating', 'currentEnergyBand').toUpperCase().slice(0, 1);
  const lodged = validDate(g('lodgement-date', 'registrationDate', 'lodgementDate', 'lodgement-datetime').slice(0, 10));
  if (!address || !/^[A-G]$/.test(rating) || !lodged) return null;
  const score = parseInt(g('current-energy-efficiency', 'currentEnergyEfficiencyRating', 'currentEnergyRating').replace(/\D/g, ''), 10);
  const certNo = line(g('certificate-number', 'certificateNumber', 'rrn'), 40);
  return { address: line(address, 200), postcode: line(g('postcode'), 10), rating, score: score >= 1 && score <= 150 ? score : null,
    potential: g('potential-energy-rating', 'potentialEnergyEfficiencyBand').toUpperCase().slice(0, 1), lodged,
    expires: validDate(g('expiryDate', 'expiry-date').slice(0, 10)) || addMonths(lodged, 120), certNo, lmk: line(g('lmk-key', 'lmkKey') || certNo, 80),
    type: line([g('property-type', 'propertyType'), g('built-form', 'builtForm')].filter(Boolean).join(', '), 60) };
}
async function epcLookup(postcode){
  const c = epcConf();
  if (!((c.email && c.key) || c.token)) return { ok: false, reason: 'not-configured', results: [] };
  const url = c.base + '/domestic/search?postcode=' + encodeURIComponent(postcode) + '&size=1000';
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: c.token ? 'Bearer ' + c.token : 'Basic ' + Buffer.from(c.email + ':' + c.key).toString('base64') }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) { console.error('landlords: the EPC register refused our credentials (HTTP ' + res.status + ' from ' + c.base + '). Check EPC_API_EMAIL and EPC_API_KEY.'); return { ok: false, reason: 'auth', results: [] }; }
    if (res.status === 404) return { ok: true, results: [], hidden: 0 };
    if (!res.ok) { console.error('landlords: EPC lookup failed: HTTP ' + res.status + ' from ' + c.base); return { ok: false, reason: 'http', results: [] }; }
    const body = (await res.text()).trim();
    if (!body) return { ok: true, results: [], hidden: 0 };   // the register answers an empty 200 when nothing matches
    const d = JSON.parse(body), rows = Array.isArray(d) ? d : d.rows || d.data || d.results || [];
    // One per address: the newest certificate. Older ones are superseded.
    const best = new Map(); let n = 0;
    rows.map(epcRow).filter(Boolean).forEach(r => { n++; const k = r.address.toLowerCase().replace(/[^a-z0-9]/g, ''); const o = best.get(k); if (!o || r.lodged > o.lodged) best.set(k, r); });
    const results = [...best.values()].sort((a, b) => a.address.localeCompare(b.address, 'en', { numeric: true })).slice(0, 200);
    return { ok: true, results, hidden: n - best.size };
  } catch (e) {
    console.error('landlords: EPC lookup failed (' + c.base + '): ' + e.message);
    return { ok: false, reason: 'network', results: [] };
  }
}
// Does a register address look like this property? (number, building and road all in it)
function looksLike(p, r){
  const a = r.address.toLowerCase(), want = [p.address.houseNo, p.address.building, p.address.road].filter(Boolean).map(s => s.toLowerCase().replace(/^flat\s+/, ''));
  return want.length > 0 && want.every(w => new RegExp('(^|[^a-z0-9])' + w.replace(/[^a-z0-9 ]/g, '').replace(/ +/g, '[^a-z0-9]+') + '($|[^a-z0-9])').test(a));
}
async function searchEpc(p){
  const r = await epcLookup(p.address.postcode);
  p.epcSearch = { at: new Date().toISOString(), postcode: p.address.postcode, ok: r.ok, reason: r.reason || '', hidden: r.hidden || 0,
    results: r.results.map(x => Object.assign(x, { match: looksLike(p, x) })).sort((a, b) => (b.match - a.match)), done: false };
}

/* ---------------------------------- multipart ---------------------------------- */
// Certificate uploads come as an ordinary form (no JavaScript needed): a small reader for multipart/form-data.
function parseMultipart(buf, type){
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type || '');
  if (!m || !Buffer.isBuffer(buf)) return null;
  const b = Buffer.from('--' + (m[1] || m[2])), fields = {}, files = {};
  let pos = buf.indexOf(b);
  while (pos !== -1) {
    pos += b.length;
    if (buf[pos] === 45 && buf[pos + 1] === 45) break;   // "--": the end
    const headEnd = buf.indexOf('\r\n\r\n', pos); if (headEnd < 0) break;
    const head = buf.slice(pos + 2, headEnd).toString('utf8'), next = buf.indexOf(b, headEnd + 4); if (next < 0) break;
    const body = buf.slice(headEnd + 4, next - 2), name = (/name="([^"]*)"/i.exec(head) || [])[1], fn = /filename="([^"]*)"/i.exec(head);
    if (name) { if (fn) { if (body.length) files[name] = { filename: fn[1], data: body }; } else fields[name] = body.toString('utf8'); }
    pos = next;
  }
  return { fields, files };
}
const MAX_FILE = 10 * 1024 * 1024;
function fileKind(buf){
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', type: 'application/pdf' };
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { ext: 'png', type: 'image/png' };
  return null;
}

/* ===================================== mount ===================================== */
function mount(app, ctx){
  DIR = path.join(ctx.REPORTS_DIR, 'landlords'); ACC_DIR = path.join(DIR, 'accounts'); FILE_DIR = path.join(DIR, 'files');
  fs.mkdirSync(ACC_DIR, { recursive: true }); fs.mkdirSync(FILE_DIR, { recursive: true });
  const { renderPage, clientIp, limiter, notify, isOwner, PUBLIC_BASE } = ctx;
  const CSS_V = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'public', 'account.css'))).digest('hex').slice(0, 10);
  const HEAD = `<link rel="stylesheet" href="/account.css?v=${CSS_V}">`;
  const signInTries = limiter(10, 15 * 60 * 1000), signUps = limiter(5, 60 * 60 * 1000), resets = limiter(5, 60 * 60 * 1000), lookups = limiter(60, 60 * 60 * 1000);
  let seenBase = '';
  const baseOf = req => { const host = String(req.headers.host || ''); const b = PUBLIC_BASE || ((/^(localhost|127\.|\[::1\])/.test(host) ? 'http://' : 'https://') + host); seenBase = b; return b; };
  const mailBase = () => PUBLIC_BASE || seenBase;

  /* ------------------------------ sessions ------------------------------ */
  let st = readState(); if (!st.secret) { st.secret = rid(32); writeState(st); }
  const SECRET = st.secret, DAYS = 180;
  const mac = v => crypto.createHmac('sha256', SECRET).update('landlord:' + v).digest('hex');
  const secure = req => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  function setSession(req, res, acc){
    const v = acc ? acc.id + '.' + (Date.now() + DAYS * 86400000) + '.' + (acc.sessionVer || 0) : '';
    res.append('Set-Cookie', `diy_landlord=${v ? v + '.' + mac(v) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${v ? DAYS * 86400 : 0}${secure(req) ? '; Secure' : ''}`);
  }
  function current(req){
    const m = /(?:^|;\s*)diy_landlord=([a-f0-9]{16})\.(\d{10,16})\.(\d{1,9})\.([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m || Number(m[2]) < Date.now()) return null;
    const a = Buffer.from(m[4]), b = Buffer.from(mac(m[1] + '.' + m[2] + '.' + m[3]));
    if (!crypto.timingSafeEqual(a, b)) return null;
    const acc = readAcc(m[1]);
    return acc && String(acc.sessionVer || 0) === m[3] ? acc : null;
  }
  // Every change must come from one of our own pages.
  function sameOrigin(req){ const o = req.headers.origin || req.headers.referer || ''; try { return new URL(o).host === req.headers.host; } catch (e) { return false; } }

  /* ------------------------------ pages ------------------------------ */
  const NOTES = { welcome: 'Your account is ready. Add your first property.', added: 'Property added.', saved: 'Saved.', deleted: 'Property deleted.', out: 'You’ve signed out.',
    pw: 'Your password has been changed.', settings: 'Settings saved.', epc: 'EPC saved.', cleared: 'Removed.', gone: 'Your account has been deleted.', sent: 'If there’s an account for that email, we’ve sent a link to reset the password. It works for one hour.' };
  function send(req, res, o){
    const notice = o.notice || (NOTES[req.query.m] ? { ok: true, text: NOTES[req.query.m] } : null);
    const html = renderPage({ key: o.key || 'account', path: o.path, title: o.title + ' · DIY Inventory', og: o.title, desc: o.desc || 'Your properties, certificates and tenancies on DIY Inventory.', body: o.body,
      head: HEAD + (o.index ? '' : '\n<meta name="robots" content="noindex, nofollow">'), jsonld: o.jsonld }, req, notice);
    if (!o.index) res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    res.status(o.status || 200).type('html').send(html);
  }
  const head = (kicker, h1, lead, actions, back) => `<div class="page-head acc-head"><div class="wrap">${back ? `<a class="back" href="${back[1]}">← ${esc(back[0])}</a>` : ''}<span class="kicker">${kicker}</span><h1>${h1}</h1>${lead ? `<p>${lead}</p>` : ''}${actions ? `<div class="acc-actions">${actions}</div>` : ''}</div></div>`;
  const inp = (label, name, value, o = {}) => `<label${o.cls ? ` class="${o.cls}"` : ''}>${o.opt ? `<b>${label} <span>(optional)</span></b>` : label}<input name="${name}" value="${esc(value == null ? '' : value)}" type="${o.type || 'text'}"${o.req ? ' required' : ''} maxlength="${o.max || 120}"${o.attrs || ''}>${o.hint ? `<small class="hint">${o.hint}</small>` : ''}</label>`;
  const sel = (label, name, opts, value, o = {}) => `<label>${o.opt ? `<b>${label} <span>(optional)</span></b>` : label}<select name="${name}">${opts.map(x => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`; }).join('')}</select></label>`;
  const area = (label, name, value, o = {}) => `<label><b>${label} <span>(optional)</span></b><textarea name="${name}" maxlength="${o.max || 2000}" rows="${o.rows || 3}">${esc(value || '')}</textarea></label>`;
  const hp = '<label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>';
  const stHTML = s => `<span class="st ${s.cls}"><i></i>${esc(s.text)}</span>`;
  const postBtn = (action, label, cls, confirmText) => `<form method="post" action="${action}" class="inline"${confirmText ? ` onsubmit="return confirm('${esc(confirmText)}')"` : ''}><button class="${cls || 'linkbtn'}">${label}</button></form>`;

  /* ------------------------------ /landlords ------------------------------ */
  const FAQ = [
    ['Is it really free?', 'Yes. The property dashboard and the reminders are free, for as many properties as you have. We also arrange certificates and inventory reports, but you don’t have to use them.'],
    ['How is the EPC found?', 'When you add a property we search the government’s EPC register for its postcode and show you the certificates there. You choose the right one and we keep its rating and expiry date. The register covers England and Wales; elsewhere you can enter the EPC yourself.'],
    ['When do the reminders arrive?', 'By email 60, 30, 14 and 7 days before a Gas Safety certificate, EICR or EPC expires, and on the day. You also get a reminder 60 days before a fixed-term tenancy ends, and while a deposit still needs protecting.'],
    ['Can I keep track of rent and expenses?', 'Yes. Add the rent and we list each rent period as paid, due or late. Mark rent as received in one tap and send your tenant a receipt by email, or download it as a PDF. Add costs such as repairs and certificates with their receipts, and download a summary for each tax year (6 April to 5 April) for your Self Assessment or your accountant. It’s a record, not tax advice.'],
    ['Who can see my information?', 'Only you, when signed in. Certificates and receipts you upload are shown only to your account. We don’t share your details, your figures or your tenants’ details with anyone.'],
  ];
  function landlordsPage(req){
    const acc = current(req);
    const cta = acc ? `<a class="btn primary" href="/account">Go to your properties</a>` : `<a class="btn primary" href="/account/sign-up">Create a free account</a><a class="arrow" href="/account/sign-in">Sign in</a>`;
    const rows = [
      ['Gas Safety certificate', 'Every 12 months', 'The date of the last check, the engineer, and the certificate itself. Reminders before the year is up.'],
      ['Electrical safety (EICR)', 'At least every 5 years', 'The inspection date, the result, any remedial work and the report. Reminders before the next one is due.'],
      ['EPC', 'Valid for 10 years', 'Found for you on the government register from the postcode: the rating, score and expiry date.'],
      ['Tenancy', 'Dates, rent and tenants', 'Who lives there, how to reach them, the rent and when the fixed term ends, with a reminder 60 days before.'],
      ['Deposit', 'Protected within 30 days', 'The amount, the scheme and the reference, and a reminder while it still needs protecting.'],
      ['Rent and receipts', 'Paid, due or late', 'Mark each rent payment as received in one tap, see what’s owed, and email your tenant a receipt.'],
      ['Expenses and tax year', '6 April to 5 April', 'Repairs, certificates, insurance and other costs, with their receipts. A summary for each tax year to download for your accountant.'],
    ].map(([h, s, p]) => `<div class="service track"><h3>${h}<small>${s}</small></h3><p>${p}</p></div>`).join('');
    const sample = `<div class="sample" aria-hidden="true"><div class="sample-cap">Example</div>${propRow({ id: '', address: { houseNo: '14', road: 'Elm Grove', town: 'Bristol', postcode: 'BS6 6AH' }, type: 'Terraced house', beds: 3,
      gas: { date: addMonths(todayLondon(), -11), }, eicr: { date: '2023-05-02', result: 'satisfactory' }, epc: { rating: 'D', score: 62, lodged: '2019-09-12' },
      tenancy: { names: 'A. Patel, R. Patel', start: '2025-09-01', end: addDays(todayLondon(), 150), rentP: 145000, rentFreq: 'month', dueDay: 1 }, payments: [{ id: 's', date: todayLondon(), amt: 145000 * 24, method: 'bank', period: '' }] }, todayLondon(), true)}</div>`;
    const body = head('For landlords · Free', 'Every property’s certificates and tenancy, in one place.',
      'A free dashboard for landlords. Add your properties and we find each one’s EPC on the government register, keep your Gas Safety and EICR dates and certificates, and email you before anything expires.', cta) + `
<section class="tight"><div class="wrap">${sample}</div></section>
<section><div class="wrap">
  <div class="sec-head"><span class="kicker">What it keeps</span><h2>The dates that matter, for every property.</h2><p>Add as many properties as you like. Each one shows at a glance what’s valid, what’s due and what’s missing.</p></div>
  <div class="services">${rows}</div>
</div></section>
<section><div class="wrap">
  <div class="sec-head"><span class="kicker">How it works</span><h2>Ten minutes, then it looks after itself.</h2><p>Nothing to install. It works on your phone or your computer.</p></div>
  <div class="steps">
    <div class="step"><div class="n">01</div><h3>Add a property</h3><p>The address, the type and the number of bedrooms. Add the tenancy if it’s let.</p></div>
    <div class="step"><div class="n">02</div><h3>We find the EPC</h3><p>We search the register by postcode. You pick the right certificate. Add your Gas Safety and EICR dates and upload the certificates.</p></div>
    <div class="step"><div class="n">03</div><h3>Reminders by email</h3><p>60, 30, 14 and 7 days before anything expires, with a link to book the renewal if you’d like us to arrange it.</p></div>
  </div>
</div></section>
<section><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>About the landlord dashboard.</h2><p>Anything else? <a href="/contact">Send us a message</a>.</p></div>
  <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
</div></section>
<section class="final"><img src="/img/living.webp" alt="" loading="lazy" width="1000" height="667"><div class="wrap"><h2>Add your first property.</h2><p>It’s free, and it takes a few minutes.</p><a class="btn" href="${acc ? '/account' : '/account/sign-up'}">${acc ? 'Go to your properties' : 'Create a free account'}</a></div></section>`;
    return body;
  }
  app.get(['/landlords', '/landlords/'], (req, res) => send(req, res, { key: 'landlords', path: '/landlords', index: true, title: 'Free landlord dashboard: certificates, EPC and tenancy reminders',
    desc: 'A free dashboard for landlords: keep every property’s Gas Safety, EICR and EPC in one place, find the EPC automatically, record the tenancy and deposit, and get email reminders before anything expires.',
    body: landlordsPage(req), jsonld: base => [{ '@type': 'Service', name: 'Landlord property dashboard', description: 'Free dashboard for landlords: certificates, EPC lookup, tenancy and deposit records, and email reminders before Gas Safety, EICR and EPC expire.', provider: { '@id': base + '/#org' }, areaServed: 'GB', url: base + '/landlords',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' } }, { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] }));

  /* ------------------------------ sign up / in / out ------------------------------ */
  const safeNext = v => typeof v === 'string' && /^\/account(\/[\w\-\/]*)?$/.test(v) ? v : '/account';
  const urlenc = express.urlencoded({ extended: false, limit: '32kb' });
  function authPage(req, res, kind, o = {}){
    const v = o.values || {};
    const forms = {
      'sign-up': ['Create your free account', 'Keep every property’s certificates and tenancy in one place, with reminders before anything expires.', `
        ${inp('Your name', 'name', v.name, { req: true, max: 80, attrs: ' autocomplete="name"' })}
        ${inp('Email', 'email', v.email, { type: 'email', req: true, attrs: ' autocomplete="email"' })}
        ${inp('Password', 'password', '', { type: 'password', req: true, max: 200, attrs: ' minlength="8" autocomplete="new-password"', hint: 'At least 8 characters.' })}
        ${hp}<button class="btn primary">Create account</button>
        <p class="small">Already have an account? <a href="/account/sign-in">Sign in</a>. We keep your details to run your dashboard and send your reminders: see <a href="/privacy#landlords">privacy</a>.</p>`],
      'sign-in': ['Sign in', 'Your properties, certificates and tenancies.', `
        <input type="hidden" name="next" value="${esc(safeNext(o.next || req.query.next))}">
        ${inp('Email', 'email', v.email, { type: 'email', req: true, attrs: ' autocomplete="email"' })}
        ${inp('Password', 'password', '', { type: 'password', req: true, max: 200, attrs: ' autocomplete="current-password"' })}
        <button class="btn primary">Sign in</button>
        <p class="small"><a href="/account/reset">Forgotten your password?</a> · New here? <a href="/account/sign-up">Create a free account</a></p>`],
      reset: ['Reset your password', emailOn() ? 'Enter your account’s email and we’ll send you a link to choose a new password.' : 'Password reset by email isn’t available at the moment.', emailOn() ? `
        ${inp('Email', 'email', v.email, { type: 'email', req: true, attrs: ' autocomplete="email"' })}
        <button class="btn primary">Send the link</button>
        <p class="small"><a href="/account/sign-in">Back to sign in</a></p>` : `<p>Please <a href="/contact">contact us</a> from the email address on your account and we’ll help you back in.</p><p class="small"><a href="/account/sign-in">Back to sign in</a></p>`],
    };
    const [h, lead, inner] = forms[kind];
    const isForm = kind !== 'reset' || emailOn();
    send(req, res, { path: '/account/' + kind, title: h, status: o.status, notice: o.error ? { text: o.error } : null, body: `<div class="wrap auth">
      <span class="kicker">${kind === 'reset' ? 'Account' : 'Landlord dashboard · Free'}</span><h1>${h}</h1><p class="lead">${lead}</p>
      ${isForm ? `<form class="card form" method="post" action="/account/${kind}">${inner}</form>` : `<div class="card">${inner}</div>`}</div>` });
  }
  app.get('/account/sign-up', (req, res) => current(req) ? res.redirect(303, '/account') : authPage(req, res, 'sign-up'));
  app.get('/account/sign-in', (req, res) => current(req) ? res.redirect(303, safeNext(req.query.next)) : authPage(req, res, 'sign-in'));
  app.post('/account/sign-up', urlenc, async (req, res) => {
    const b = req.body || {}, values = { name: line(b.name, 80), email: normEmail(b.email) };
    const fail = (error, status) => authPage(req, res, 'sign-up', { values, error, status: status || 400 });
    if (!sameOrigin(req)) return fail('Please create your account from this page.', 403);
    if (line(b.website, 200)) return res.redirect(303, '/account/sign-in');   // robots
    if (!values.name) return fail('Please enter your name.');
    if (!EMAIL_RE.test(values.email)) return fail('Please enter a valid email address.');
    const pw = String(b.password || '');
    if (pw.length < 8) return fail('Please choose a password of at least 8 characters.');
    if (pw.length > 200) return fail('That password is too long.');
    if (!signUps(clientIp(req))) return fail('Too many new accounts from here. Please try again in an hour.', 429);
    if (readIndex().byEmail[values.email]) return fail('There’s already an account with that email. Sign in, or reset the password.', 409);
    const h = await hashPassword(pw);
    const idx = readIndex(); if (idx.byEmail[values.email]) return fail('There’s already an account with that email. Sign in, or reset the password.', 409);
    const acc = { id: rid(8), name: values.name, email: values.email, salt: h.salt, hash: h.hash, createdAt: new Date().toISOString(), sessionVer: 0,
      settings: { reminders: true, ccEmail: '' }, properties: [], sent: {} };
    writeAcc(acc); idx.byEmail[acc.email] = acc.id; writeIndex(idx);
    console.log('landlords: new account ' + acc.id);
    notify({ title: 'New landlord account', message: acc.name + ' · ' + acc.email, tags: ['house'], click: PUBLIC_BASE ? PUBLIC_BASE + '/admin#landlords' : '' });
    setSession(req, res, acc);
    res.redirect(303, '/account?m=welcome');
  });
  app.post('/account/sign-in', urlenc, async (req, res) => {
    const b = req.body || {}, email = normEmail(b.email), next = safeNext(b.next);
    const fail = (error, status) => authPage(req, res, 'sign-in', { values: { email }, next, error, status: status || 401 });
    if (!sameOrigin(req)) return fail('Please sign in from this page.', 403);
    // Every attempt counts (10 per IP per 15 minutes), so a blocked guesser can't tell when a guess was right.
    if (!signInTries(clientIp(req))) return fail('Too many attempts. Please wait 15 minutes and try again.', 429);
    const acc = readAcc(readIndex().byEmail[email]);
    if (!(await checkPassword(acc, String(b.password || '').slice(0, 200)))) return fail('That email and password don’t match an account.');
    acc.lastSignInAt = new Date().toISOString(); writeAcc(acc);
    setSession(req, res, acc);
    res.redirect(303, next);
  });
  app.post('/account/sign-out', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Please sign out from your account page.');
    setSession(req, res, null); res.redirect(303, '/account/sign-in?m=out');
  });

  /* ------------------------------ password reset ------------------------------ */
  app.get('/account/reset', (req, res) => authPage(req, res, 'reset'));
  app.post('/account/reset', urlenc, async (req, res) => {
    const email = normEmail((req.body || {}).email);
    if (!sameOrigin(req)) return authPage(req, res, 'reset', { values: { email }, error: 'Please use this page to reset your password.', status: 403 });
    if (!emailOn()) return authPage(req, res, 'reset');
    if (!EMAIL_RE.test(email)) return authPage(req, res, 'reset', { values: { email }, error: 'Please enter a valid email address.', status: 400 });
    if (!resets(clientIp(req))) return authPage(req, res, 'reset', { values: { email }, error: 'Too many requests from here. Please try again in an hour.', status: 429 });
    const acc = readAcc(readIndex().byEmail[email]);
    if (acc) {
      const tok = rid(24);
      acc.reset = { hash: crypto.createHash('sha256').update(tok).digest('hex'), exp: Date.now() + 3600000 }; writeAcc(acc);
      const link = baseOf(req) + '/account/reset/' + acc.id + '-' + tok;
      const r = await sendEmail({ to: [acc.email], subject: 'Reset your DIY Inventory password',
        text: `Hello ${acc.name},\n\nTo choose a new password for your DIY Inventory landlord account, open this link within the next hour:\n\n${link}\n\nIf you didn’t ask for this, you can ignore this email. Your password won’t change.`,
        html: emailHTML([`Hello ${esc(acc.name)},`, 'To choose a new password for your DIY Inventory landlord account, use the button below within the next hour. The link works once.'], ['Choose a new password', link], 'If you didn’t ask for this, you can ignore this email. Your password won’t change.') });
      if (!r.ok) console.error('landlords: reset email not sent (' + r.reason + ')');
    }
    res.redirect(303, '/account/sign-in?m=sent');
  });
  function resetAccount(param){
    const m = /^([a-f0-9]{16})-([a-f0-9]{48})$/.exec(String(param || '')); if (!m) return null;
    const acc = readAcc(m[1]); if (!acc || !acc.reset || acc.reset.exp < Date.now()) return null;
    const a = Buffer.from(crypto.createHash('sha256').update(m[2]).digest('hex')), b = Buffer.from(acc.reset.hash);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? acc : null;
  }
  function newPasswordPage(req, res, error, status){
    const ok = !!resetAccount(req.params.token);
    send(req, res, { path: '/account/reset', title: 'Choose a new password', status: status || (ok ? 200 : 410), notice: error ? { text: error } : null, body: `<div class="wrap auth"><span class="kicker">Account</span><h1>Choose a new password</h1>
      ${ok ? `<form class="card form" method="post" action="/account/reset/${esc(req.params.token)}">${inp('New password', 'password', '', { type: 'password', req: true, max: 200, attrs: ' minlength="8" autocomplete="new-password"', hint: 'At least 8 characters.' })}<button class="btn primary">Save and sign in</button></form>`
        : `<div class="card"><p>This link has expired or has already been used. Links work once, for one hour.</p><p><a class="btn ghost sm" href="/account/reset">Send a new link</a></p></div>`}</div>` });
  }
  app.get('/account/reset/:token', (req, res) => newPasswordPage(req, res));
  app.post('/account/reset/:token', urlenc, async (req, res) => {
    if (!sameOrigin(req)) return newPasswordPage(req, res, 'Please use the link in the email.', 403);
    const pw = String((req.body || {}).password || '');
    if (pw.length < 8 || pw.length > 200) return newPasswordPage(req, res, 'Please choose a password of at least 8 characters.', 400);
    if (!resetAccount(req.params.token)) return newPasswordPage(req, res);
    const h = await hashPassword(pw), acc = resetAccount(req.params.token);
    if (!acc) return newPasswordPage(req, res);
    Object.assign(acc, { salt: h.salt, hash: h.hash, sessionVer: (acc.sessionVer || 0) + 1, reset: null }); writeAcc(acc);
    setSession(req, res, acc); res.redirect(303, '/account?m=pw');
  });

  /* ------------------------------ signed-in pages ------------------------------ */
  app.use('/account', (req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' }); next(); });
  function need(req, res, next){
    const acc = current(req);
    if (!acc) return req.method === 'GET' ? res.redirect(303, '/account/sign-in?next=' + encodeURIComponent(safeNext(req.path === '/' ? '/account' : '/account' + req.path.replace(/^\/account/, '')))) : res.status(401).type('text/plain').send('Signed out. Please sign in again.');
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).type('text/plain').send('Please make changes from your account pages.');
    req.acc = acc; next();
  }
  const prop = (acc, id) => acc.properties.find(p => p.id === String(id));

  // One row of the dashboard (and the example on /landlords).
  function propRow(p, t, sample){
    const tn = p.tenancy || {}, ts = tenancyStatus(p, t), dep = depositStatus(p, t);
    const tSub = [tn.names, money.rentPence(tn) > 0 ? money.gbp(money.rentPence(tn)) + ' ' + money.perText(tn) : ''].filter(Boolean).join(' · ');
    const cell = (k, s, sub, more) => `<div><dt>${SHORT[k]}</dt><dd>${stHTML(s)}${more || ''}${sub ? `<small>${esc(sub)}</small>` : ''}</dd></div>`;
    const href = sample ? '' : ` href="/account/p/${p.id}"`;
    return `<article class="prop">
      <a class="prop-addr"${href}><h3>${esc(streetLine(p.address))}</h3><span>${esc([p.address.town, p.address.postcode].filter(Boolean).join(' '))} · ${esc(p.type)} · ${esc(bedsText(p.beds))}</span></a>
      <dl class="prop-st">${cell('gas', certStatus('gas', p, t))}${cell('eicr', certStatus('eicr', p, t))}${cell('epc', certStatus('epc', p, t), p.epc && p.epc.rating ? 'Rating ' + p.epc.rating + (p.epc.score ? ' (' + p.epc.score + ')' : '') : '')}${cell('tenancy', ts, tSub, dep.cls === 'due' || dep.cls === 'exp' ? stHTML({ cls: dep.cls, text: dep.cls === 'exp' ? 'Deposit not protected' : dep.text.replace(/^Protect by/, 'Protect deposit by').replace(/^Not protected yet/, 'Deposit not protected yet') }) : '')}${M.dashCell(p, t)}</dl>
      ${sample ? '<span class="prop-go">Open</span>' : `<a class="prop-go" href="/account/p/${p.id}" aria-label="Open ${esc(streetLine(p.address))}">Open</a>`}</article>`;
  }

  app.get(['/account', '/account/'], need, (req, res) => {
    const acc = req.acc, t = todayLondon(), list = acc.properties.slice().sort((a, b) => streetLine(a.address).localeCompare(streetLine(b.address), 'en', { numeric: true }));
    const all = list.flatMap(p => ['gas', 'eicr', 'epc'].map(k => Object.assign({ k, p }, certStatus(k, p, t))).concat([Object.assign({ k: 'deposit', p }, depositStatus(p, t))]));
    const exp = all.filter(x => x.cls === 'exp').length, due = all.filter(x => x.cls === 'due').length, missing = all.filter(x => x.cls === 'none' && x.k !== 'deposit').length;
    const next = all.filter(x => x.due && x.d >= 0).sort((a, b) => a.d - b.d)[0];
    const actions = `<a class="btn primary" href="/account/properties/new">Add a property</a>${list.length ? '<a class="btn ghost" href="/account/expenses/new">Add an expense</a><a class="btn ghost" href="/account/money">Money and tax</a>' : ''}<a class="btn ghost" href="/account/settings">Settings</a>${postBtn('/account/sign-out', 'Sign out')}`;
    const mailNote = !emailOn() ? `<p class="acc-note">Email reminders aren’t switched on for this site yet, so none will be sent for now. Your dates are still tracked here.</p>`
      : acc.settings.reminders === false ? `<p class="acc-note">Email reminders are off. <a href="/account/settings">Turn them on in Settings</a>.</p>` : '';
    const body = head('Signed in as ' + esc(acc.name), 'Your properties', list.length ? 'Each property’s certificates, tenancy and rent at a glance. Open one to update it or mark rent as received.' : '', actions) + `
<section class="tight"><div class="wrap">${mailNote}
${list.length ? `<div class="acc-figs">
  <div><b>${list.length}</b><span>${list.length === 1 ? 'property' : 'properties'}</span></div>
  <div><b>${exp + due}</b><span>${exp ? exp + ' expired, ' + due + ' due within 60 days' : 'due within 60 days'}</span></div>
  <div><b>${missing}</b><span>certificate${missing === 1 ? '' : 's'} not added</span></div>
  <div>${next ? `<b class="date">${esc(fmt(next.due))}</b><span>next: ${esc(SHORT[next.k])}, ${esc(streetLine(next.p.address))}</span>` : `<b class="date">—</b><span>nothing coming up</span>`}</div>
</div>
${M.dashStrip(acc, t)}
<div class="props">${list.map(p => propRow(p, t)).join('')}</div>`
  : `<div class="card acc-empty"><h2>Add your first property</h2><p>Enter the address and we’ll look up its EPC on the government register. Then add the Gas Safety and EICR dates, and the tenancy if it’s let. We’ll email you before anything expires.</p>
     <ul class="ruled"><li><b>Gas Safety</b>every 12 months</li><li><b>EICR</b>at least every 5 years</li><li><b>EPC</b>valid for 10 years, found for you</li></ul>
     <a class="btn primary" href="/account/properties/new">Add a property</a></div>`}
</div></section>`;
    send(req, res, { path: '/account', title: 'Your properties', body });
  });

  /* ------------------------------ add / edit a property ------------------------------ */
  function detailsFields(v){
    return `<div class="row">${inp('Flat or house number', 'houseNo', v.houseNo, { opt: true, max: 40, attrs: ' placeholder="e.g. 12 or Flat 4"' })}${inp('Building name', 'building', v.building, { opt: true, max: 80 })}</div>
      ${inp('Road', 'road', v.road, { max: 100, attrs: ' autocomplete="address-line1"' })}
      <div class="row">${inp('Town or city', 'town', v.town, { req: true, max: 60, attrs: ' autocomplete="address-level2"' })}${inp('Postcode', 'postcode', v.postcode, { req: true, max: 10, attrs: ' autocomplete="postal-code" autocapitalize="characters"' })}</div>
      <div class="row">${sel('Property type', 'type', TYPES, v.type || 'Flat')}${sel('Bedrooms', 'beds', [0, 1, 2, 3, 4, 5, 6].map(n => [n, n === 0 ? 'Studio' : n === 6 ? '6 or more' : String(n)]), v.beds == null ? 2 : v.beds)}</div>
      ${area('Notes', 'notes', v.notes, { max: 2000 })}`;
  }
  function readDetails(b){
    const a = { houseNo: line(b.houseNo, 40), building: line(b.building, 80), road: line(b.road, 100), town: line(b.town, 60), postcode: normPostcode(b.postcode) };
    const v = Object.assign({}, a, { postcodeRaw: line(b.postcode, 12), type: TYPES.includes(b.type) ? b.type : 'Other', beds: Math.max(0, Math.min(6, parseInt(b.beds, 10) || 0)), notes: text(b.notes, 2000) });
    const error = !a.postcode ? 'Please enter a valid UK postcode, for example SW1A 1AA.' : !(a.road || a.building) ? 'Please enter the road or the building name.' : !a.town ? 'Please enter the town or city.' : '';
    return { a, v, error };
  }
  function newPage(req, res, values, error, status){
    const v = values || {};
    send(req, res, { path: '/account/properties/new', title: 'Add a property', status, notice: error ? { text: error } : null,
      body: head('Your properties', 'Add a property', 'Enter the address. We’ll search the EPC register for its postcode straight away.', '', ['All properties', '/account']) +
      `<section class="tight"><div class="wrap"><form class="card form acc-form" method="post" action="/account/properties">${detailsFields(Object.assign({}, v, { postcode: v.postcodeRaw || v.postcode }))}<button class="btn primary">Add property</button></form></div></section>` });
  }
  app.get('/account/properties/new', need, (req, res) => newPage(req, res));
  app.post('/account/properties', need, urlenc, async (req, res) => {
    const { a, v, error } = readDetails(req.body || {});
    if (error) return newPage(req, res, v, error, 400);
    if (req.acc.properties.length >= 200) return newPage(req, res, v, 'You can keep up to 200 properties in one account. Please contact us for more.', 400);
    const p = { id: rid(6), createdAt: new Date().toISOString(), address: a, type: v.type, beds: v.beds, notes: v.notes };
    if (lookups(clientIp(req))) await searchEpc(p);
    const acc = readAcc(req.acc.id); acc.properties.push(p); writeAcc(acc);
    res.redirect(303, '/account/p/' + p.id + '?m=added#epc');
  });

  /* ------------------------------ the property page ------------------------------ */
  function fileLink(f){ return f ? `<a href="/account/files/${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a> <span class="sub">${f.type === 'application/pdf' ? 'PDF' : f.type === 'image/png' ? 'PNG' : 'JPEG'}, ${f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB'}</span>` : '<span class="sub">No file uploaded</span>'; }
  const kv = rows => `<dl class="kv">${rows.filter(r => r && r[1]).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const fileInput = (f) => `<label><b>Certificate <span>(optional: PDF, JPEG or PNG, up to 10 MB)</span></b><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"></label>${f ? `<label class="check"><input type="checkbox" name="removeFile" value="1"> Remove the uploaded file (${esc(f.name)})</label>` : ''}`;
  const editBox = (has, label, form) => has ? `<details class="edit"><summary>${label}</summary>${form}</details>` : form;
  const epcBadge = r => `<span class="epc-badge b-${esc(r)}" aria-label="Rating ${esc(r)}">${esc(r)}</span>`;

  function epcSection(p, t, o){
    const e = p.epc, s = p.epcSearch, pc = p.address.postcode;
    let found = '';
    if (s && !s.done) {
      if (s.ok && s.results.length) found = `<div class="epc-found"><p><b>${plural(s.results.length, 'certificate')} on the register for ${esc(s.postcode)}.</b> Choose the one for this property.${s.hidden ? ' Older certificates for the same addresses are left out.' : ''}</p>
        <ul class="epc-res">${s.results.map((r, i) => `<li${r.match ? ' class="match"' : ''}>${epcBadge(r.rating)}<div><b>${esc(r.address)}</b><small>${r.match ? '<em>Looks like this property</em> · ' : ''}Rating ${esc(r.rating)}${r.score ? ' (' + r.score + ')' : ''} · lodged ${esc(fmt(r.lodged))} · ${days(t, r.expires) < 0 ? 'expired ' : 'valid until '}${esc(fmt(r.expires))}</small></div>
          <form method="post" action="/account/p/${p.id}/epc/pick"><input type="hidden" name="i" value="${i}"><input type="hidden" name="lmk" value="${esc(r.lmk)}"><button class="btn ghost sm">This one</button></form></li>`).join('')}</ul>
        <p class="small">Not listed? <a href="${esc(FIND_EPC(pc))}" target="_blank" rel="noopener">Search the register yourself</a> and enter it below.</p></div>`;
      else if (s.ok) found = `<p class="acc-note">No certificates were found on the EPC register for ${esc(s.postcode)}. The property may not have one yet, or it may be listed under a different postcode. <a href="${esc(FIND_EPC(pc))}" target="_blank" rel="noopener">Search the register yourself</a>, enter it by hand below, or <a href="${esc(bookLink('', 'epc', p))}">book an EPC</a>.</p>`;
      else found = `<p class="acc-note">${s.reason === 'not-configured' ? 'The automatic EPC search isn’t switched on yet.' : 'The EPC register couldn’t be reached just now.'} You can <a href="${esc(FIND_EPC(pc))}" target="_blank" rel="noopener">find the certificate on the register by postcode</a> and enter its details below.</p>`;
    }
    const m = Object.assign({}, e && e.source === 'manual' ? e : {}, o || {});
    const manual = `<form class="form" method="post" action="/account/p/${p.id}/epc/manual">
      <div class="row">${sel('Rating', 'rating', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], m.rating || 'D')}${inp('Score', 'score', m.score, { opt: true, max: 3, attrs: ' inputmode="numeric" placeholder="e.g. 68"' })}</div>
      ${inp('Certificate number', 'certNo', m.certNo, { opt: true, max: 40, attrs: ' placeholder="e.g. 1234-5678-9012-3456-7890"' })}
      <div class="row">${inp('Date lodged', 'lodged', m.lodged, { type: 'date', opt: true })}${inp('Valid until', 'expires', m.expiresSet || '', { type: 'date', opt: true, hint: 'Leave blank for 10 years after the date lodged.' })}</div>
      <button class="btn primary sm">Save EPC</button></form>`;
    const has = !!e;
    return `<div class="acc-box">
      ${has ? `<div class="epc-cur">${epcBadge(e.rating)}<div>${kv([['Rating', esc(e.rating) + (e.score ? ' (' + e.score + ')' : '') + (e.potential ? ' · potential ' + esc(e.potential) : '')], ['Address', esc(e.address || '')], ['Certificate', e.certNo ? `<a href="${esc(EPC_CERT(e.certNo))}" target="_blank" rel="noopener">${esc(e.certNo)}</a>` : ''], ['Lodged', esc(fmt(e.lodged))], ['Valid until', esc(fmt(epcExpiry(e)))], ['Source', e.source === 'register' ? 'Found on the EPC register' : 'Entered by hand']])}</div></div>` : ''}
      ${found}
      <div class="acc-row">${postBtn(`/account/p/${p.id}/epc/search`, s ? 'Search the register again' : 'Search the EPC register', 'btn ghost sm')}${has ? postBtn(`/account/p/${p.id}/clear/epc`, 'Remove EPC', 'linkbtn danger', 'Remove this EPC from the property?') : ''}</div>
      <details class="edit"${o ? ' open' : ''}><summary>Enter the EPC by hand</summary>${manual}</details>
    </div>`;
  }
  function gasSection(p, o){
    const g = p.gas, v = Object.assign({}, g || {}, o || {});
    const form = `<form class="form" method="post" action="/account/p/${p.id}/gas" enctype="multipart/form-data">
      <div class="row">${inp('Date of the check', 'date', v.date, { type: 'date', req: true })}${inp('Valid until', 'expires', v.expiresSet, { type: 'date', opt: true, hint: 'Leave blank for 12 months after the check.' })}</div>
      <div class="row">${inp('Engineer or company', 'engineer', v.engineer, { opt: true, max: 100 })}${inp('Gas Safe registration number', 'gasSafeNo', v.gasSafeNo, { opt: true, max: 20, attrs: ' inputmode="numeric"' })}</div>
      ${fileInput(g && g.file)}<button class="btn primary sm">Save Gas Safety</button></form>`;
    return `<div class="acc-box">${g ? kv([['Last check', esc(fmt(g.date))], ['Valid until', esc(fmt(gasExpiry(g)))], ['Engineer', esc(g.engineer || '')], ['Gas Safe no.', esc(g.gasSafeNo || '')], ['Certificate', fileLink(g.file)]]) : ''}
      ${editBox(!!g, 'Update, or add the new certificate', form)}${g ? `<div class="acc-row">${postBtn(`/account/p/${p.id}/clear/gas`, 'Remove Gas Safety record', 'linkbtn danger', 'Remove the Gas Safety record and its file?')}</div>` : ''}</div>`;
  }
  function eicrSection(p, o){
    const e = p.eicr, v = Object.assign({}, e || {}, o || {});
    const form = `<form class="form" method="post" action="/account/p/${p.id}/eicr" enctype="multipart/form-data">
      <div class="row">${inp('Date of the inspection', 'date', v.date, { type: 'date', req: true })}${inp('Next inspection due', 'due', v.dueSet, { type: 'date', opt: true, hint: 'Leave blank for 5 years after the inspection.' })}</div>
      <div class="row">${sel('Result', 'result', [['satisfactory', 'Satisfactory'], ['unsatisfactory', 'Unsatisfactory']], v.result || 'satisfactory')}${inp('Remedial work completed', 'remedialDate', v.remedialDate, { type: 'date', opt: true, hint: 'If the result was unsatisfactory.' })}</div>
      ${inp('Electrician or company', 'engineer', v.engineer, { opt: true, max: 100 })}
      ${fileInput(e && e.file)}<button class="btn primary sm">Save EICR</button></form>`;
    return `<div class="acc-box">${e ? kv([['Inspected', esc(fmt(e.date))], ['Next due', esc(fmt(eicrDue(e)))], ['Result', e.result === 'unsatisfactory' ? 'Unsatisfactory' + (e.remedialDate ? ', remedial work completed ' + esc(fmt(e.remedialDate)) : ', remedial work not recorded yet') : 'Satisfactory'], ['Electrician', esc(e.engineer || '')], ['Report', fileLink(e.file)]]) : ''}
      ${editBox(!!e, 'Update, or add the new report', form)}${e ? `<div class="acc-row">${postBtn(`/account/p/${p.id}/clear/eicr`, 'Remove EICR record', 'linkbtn danger', 'Remove the EICR record and its file?')}</div>` : ''}</div>`;
  }
  const FREQ = [['month', 'a month'], ['week', 'a week'], ['4 weeks', 'every 4 weeks'], ['quarter', 'a quarter'], ['year', 'a year']];
  const SCHEMES = ['DPS', 'TDS', 'mydeposits', 'Other'];
  function tenancySection(p, o){
    const tn = p.tenancy, v = Object.assign({}, tn || {}, o || {}), has = !!(tn && (tn.names || tn.start));
    const form = `<form class="form" method="post" action="/account/p/${p.id}/tenancy">
      ${inp('Tenant name(s)', 'names', v.names, { max: 200, attrs: ' placeholder="e.g. Sam Jones, Alex Jones"' })}
      <div class="row">${inp('Email(s)', 'emails', v.emails, { opt: true, max: 200 })}${inp('Phone(s)', 'phones', v.phones, { opt: true, max: 100, attrs: ' inputmode="tel"' })}</div>
      <div class="row">${inp('Start date', 'start', v.start, { type: 'date' })}${inp('End of the fixed term', 'end', v.end, { type: 'date', opt: true })}</div>
      <label class="check"><input type="checkbox" name="periodic" value="1"${v.periodic ? ' checked' : ''}> Periodic (rolling, with no fixed end date, or continuing after the fixed term)</label>
      <div class="row">${inp('Rent (£)', 'rent', money.rentPence(v) ? (money.rentPence(v) / 100).toFixed(2).replace(/\.00$/, '') : '', { opt: true, max: 12, attrs: ' inputmode="decimal"' })}${sel('How often', 'rentFreq', FREQ, v.rentFreq || 'month')}</div>
      <div class="row">${inp('Deposit (£)', 'deposit', v.deposit || '', { opt: true, max: 10, attrs: ' inputmode="decimal"' })}${sel('Deposit scheme', 'scheme', [['', 'Choose…']].concat(SCHEMES), v.scheme || '', { opt: true })}</div>
      <div class="row">${inp('Date protected', 'protectedOn', v.protectedOn, { type: 'date', opt: true })}${inp('Protection reference', 'depositRef', v.depositRef, { opt: true, max: 60 })}</div>
      ${area('Notes', 'notes', v.notes, { max: 2000 })}
      <button class="btn primary sm">Save tenancy</button></form>`;
    const rent = tn && money.rentPence(tn) > 0 ? money.gbp(money.rentPence(tn)) + ' ' + money.perText(tn) + ' <a href="#rent">(rent and receipts)</a>' : '';
    return `<div class="acc-box">${has ? kv([['Tenants', esc(tn.names || '')], ['Email', esc(tn.emails || '')], ['Phone', esc(tn.phones || '')], ['Start', esc(fmt(tn.start))], ['Fixed term ends', tn.end ? esc(fmt(tn.end)) : ''], ['Periodic', tn.periodic ? 'Yes' : ''], ['Rent', rent],
      ['Deposit', tn.deposit > 0 ? esc(pounds(tn.deposit)) + (tn.scheme ? ' · ' + esc(tn.scheme) : '') + (tn.protectedOn ? ' · protected ' + esc(fmt(tn.protectedOn)) : '') + (tn.depositRef ? ' · ref ' + esc(tn.depositRef) : '') : ''], ['Notes', tn.notes ? '<span class="pre">' + esc(tn.notes) + '</span>' : '']]) : ''}
      ${editBox(has, 'Update the tenancy', form)}${has ? `<div class="acc-row">${postBtn(`/account/p/${p.id}/clear/tenancy`, 'Remove tenancy', 'linkbtn danger', 'Remove the tenancy details?')}</div>` : ''}</div>`;
  }
  function propertyPage(req, res, p, o = {}){
    const t = todayLondon(), base = '', a = p.address, sec = o.section, ov = o.values;
    const book = k => `<a class="arrow" href="${esc(bookLink(base, k, p))}">Book ${k === 'gas' ? 'a Gas Safety check' : k === 'eicr' ? 'an EICR' : 'an EPC'}</a>`;
    const block = (id, title, s, note, content, extra) => `<div class="acc-sec" id="${id}"><div class="acc-sec-h"><h2>${title}</h2>${stHTML(s)}<p>${note}</p>${extra || ''}</div><div class="acc-sec-b">${content}</div></div>`;
    const ds = depositStatus(p, t), rent = M.rentSection(p, t), acc = readAcc(req.acc.id) || req.acc, exps = M.expenseSection(acc, p, t);
    const body = head(esc([a.town, a.postcode].filter(Boolean).join(' · ')), esc(streetLine(a)), esc(p.type + ' · ' + bedsText(p.beds)),
      `<a class="btn primary sm" href="#rent">Rent</a><a class="btn ghost sm" href="/account/expenses/new?p=${p.id}">Add an expense</a><a class="btn ghost sm" href="/app">Do a check-in or inspection</a><a class="btn ghost sm" href="#details">Edit details</a>`, ['All properties', '/account']) + `
<section class="tight"><div class="wrap">
  <ul class="ov">${[['rent', 'Rent', rent.st], ['epc', 'EPC', certStatus('epc', p, t)], ['gas', 'Gas Safety', certStatus('gas', p, t)], ['eicr', 'EICR', certStatus('eicr', p, t)], ['tenancy', 'Tenancy', tenancyStatus(p, t)], ['tenancy', 'Deposit', ds]]
    .map(([id, l, s]) => `<li><a href="#${id}"><b>${l}</b>${stHTML(s)}</a></li>`).join('')}</ul>
  ${block('rent', 'Rent', rent.st, 'Each rent period, paid or still due. Tap <b>Mark as received</b> when the rent comes in, then send your tenant a receipt.', rent.html)}
  ${block('expenses', 'Expenses', exps.st, 'Costs for this property, such as repairs, certificates and insurance, with their receipts. Together with the rent, they make up your tax-year summary.', exps.html)}
  ${block('epc', 'EPC', certStatus('epc', p, t), 'An Energy Performance Certificate is valid for 10 years. You need a valid one before you let the property to a new tenant.', epcSection(p, t, sec === 'epc' ? ov : null), book('epc'))}
  ${block('gas', 'Gas Safety', certStatus('gas', p, t), 'A Gas Safe registered engineer must check every gas appliance every 12 months, and the tenant must have a copy of the certificate.', gasSection(p, sec === 'gas' ? ov : null), book('gas'))}
  ${block('eicr', 'Electrical safety (EICR)', certStatus('eicr', p, t), 'In England the electrics must be inspected at least every 5 years, and any remedial work done within 28 days.', eicrSection(p, sec === 'eicr' ? ov : null), book('eicr'))}
  ${block('tenancy', 'Tenancy', tenancyStatus(p, t), 'Who lives here and on what terms. In England and Wales a deposit must be protected within 30 days of receiving it.', tenancySection(p, sec === 'tenancy' ? ov : null), `<div class="st-extra"><span class="sub">Deposit</span> ${stHTML(ds)}</div><a class="arrow" href="/app">Do a check-in or check-out</a>`)}
  <div class="acc-sec" id="details"><div class="acc-sec-h"><h2>Property details</h2><p>The address, type and bedrooms. Changing the postcode searches the EPC register again.</p></div>
    <div class="acc-sec-b"><div class="acc-box"><form class="form" method="post" action="/account/p/${p.id}/details">${detailsFields(Object.assign({}, a, { type: p.type, beds: p.beds, notes: p.notes }, sec === 'details' ? ov : {}))}<button class="btn primary sm">Save details</button></form>
    <div class="acc-row">${postBtn(`/account/p/${p.id}/delete`, 'Delete this property', 'linkbtn danger', 'Delete this property, with its certificates, tenancy, rent payments and expenses? This cannot be undone.')}</div></div></div></div>
</div></section>`;
    send(req, res, { path: '/account/p/' + p.id, title: streetLine(a), body, status: o.status, notice: o.error ? { text: o.error } : null });
  }
  app.get('/account/p/:id', need, (req, res) => { const p = prop(req.acc, req.params.id); if (!p) return res.redirect(303, '/account'); propertyPage(req, res, p); });

  // Load the account fresh, change one property, save.
  function update(req, fn){ const acc = readAcc(req.acc.id), p = acc && prop(acc, req.params.id); if (!p) return null; const r = fn(p, acc); p.updatedAt = new Date().toISOString(); writeAcc(acc); return r === undefined ? p : r; }
  const done = (res, p, hash, m) => res.redirect(303, '/account/p/' + p.id + '?m=' + (m || 'saved') + '#' + hash);
  const gone = res => res.redirect(303, '/account');

  app.post('/account/p/:id/details', need, urlenc, async (req, res) => {
    const p0 = prop(req.acc, req.params.id); if (!p0) return gone(res);
    const { a, v, error } = readDetails(req.body || {});
    if (error) return propertyPage(req, res, p0, { section: 'details', values: Object.assign({}, v, { postcode: v.postcodeRaw }), error, status: 400 });
    const moved = a.postcode !== p0.address.postcode;
    const tmp = Object.assign({}, p0, { address: a });
    if (moved && lookups(clientIp(req))) await searchEpc(tmp);
    const p = update(req, p => { p.address = a; p.type = v.type; p.beds = v.beds; p.notes = v.notes; if (moved && tmp.epcSearch) p.epcSearch = tmp.epcSearch; });
    p ? done(res, p, moved ? 'epc' : 'details') : gone(res);
  });
  app.post('/account/p/:id/delete', need, (req, res) => {
    const acc = readAcc(req.acc.id), p = prop(acc, req.params.id); if (!p) return gone(res);
    const exps = (acc.expenses || []).filter(e => e.propId === p.id);
    [p.gas && p.gas.file, p.eicr && p.eicr.file].concat(exps.map(e => e.file)).filter(Boolean).forEach(f => { try { fs.unlinkSync(path.join(FILE_DIR, acc.id, f.id + '.' + f.ext)); } catch (e) {} });
    acc.properties = acc.properties.filter(x => x.id !== p.id); acc.expenses = (acc.expenses || []).filter(e => e.propId !== p.id); writeAcc(acc);
    res.redirect(303, '/account?m=deleted');
  });
  app.post('/account/p/:id/clear/:what', need, (req, res) => {
    const what = String(req.params.what); if (!['epc', 'gas', 'eicr', 'tenancy'].includes(what)) return gone(res);
    const p = update(req, (p, acc) => { const f = p[what] && p[what].file; if (f) { try { fs.unlinkSync(path.join(FILE_DIR, acc.id, f.id + '.' + f.ext)); } catch (e) {} } delete p[what]; if (what === 'epc' && p.epcSearch) p.epcSearch.done = false; });
    p ? done(res, p, what, 'cleared') : gone(res);
  });

  /* EPC */
  app.post('/account/p/:id/epc/search', need, async (req, res) => {
    const p0 = prop(req.acc, req.params.id); if (!p0) return gone(res);
    if (!lookups(clientIp(req))) return propertyPage(req, res, p0, { error: 'Too many searches from here. Please try again later.', status: 429 });
    const tmp = JSON.parse(JSON.stringify(p0)); await searchEpc(tmp);
    const p = update(req, p => { p.epcSearch = tmp.epcSearch; }); p ? done(res, p, 'epc', 'x') : gone(res);
  });
  app.post('/account/p/:id/epc/pick', need, urlenc, (req, res) => {
    const b = req.body || {};
    const p = update(req, p => {
      const s = p.epcSearch, r = s && s.results[parseInt(b.i, 10)];
      if (!r || r.lmk !== String(b.lmk || '')) return false;
      p.epc = { source: 'register', rating: r.rating, score: r.score, potential: r.potential, certNo: r.certNo, lmk: r.lmk, address: r.address, lodged: r.lodged, expires: r.expires, savedAt: new Date().toISOString() };
      s.done = true;
    });
    if (p === null) return gone(res);
    const pp = prop(readAcc(req.acc.id), req.params.id);
    p === false ? propertyPage(req, res, pp, { error: 'That certificate is no longer in the list. Please search again.', status: 400 }) : done(res, pp, 'epc', 'epc');
  });
  app.post('/account/p/:id/epc/manual', need, urlenc, (req, res) => {
    const b = req.body || {}, p0 = prop(req.acc, req.params.id); if (!p0) return gone(res);
    const v = { rating: /^[A-G]$/.test(b.rating) ? b.rating : '', score: line(b.score, 3).replace(/\D/g, ''), certNo: line(b.certNo, 40), lodged: validDate(b.lodged), expiresSet: validDate(b.expires) };
    if (!v.rating) return propertyPage(req, res, p0, { section: 'epc', values: v, error: 'Please choose the EPC rating.', status: 400 });
    if (!v.lodged && !v.expiresSet) return propertyPage(req, res, p0, { section: 'epc', values: v, error: 'Please enter the date it was lodged or the date it’s valid until.', status: 400 });
    const score = parseInt(v.score, 10);
    const p = update(req, p => { p.epc = { source: 'manual', rating: v.rating, score: score >= 1 && score <= 150 ? score : null, certNo: v.certNo, lodged: v.lodged, expiresSet: v.expiresSet, expires: v.expiresSet || addMonths(v.lodged, 120), savedAt: new Date().toISOString() }; if (p.epcSearch) p.epcSearch.done = true; });
    p ? done(res, p, 'epc', 'epc') : gone(res);
  });

  /* Gas Safety and EICR, with an optional certificate file */
  const raw = express.raw({ type: 'multipart/form-data', limit: MAX_FILE + 256 * 1024 });
  const multipart = (req, res, next) => raw(req, res, err => {
    if (err) { req.formError = err.type === 'entity.too.large' ? 'That file is too large. Files can be up to 10 MB.' : 'The form could not be read. Please try again.'; req.body = {}; return next(); }
    const r = parseMultipart(req.body, req.headers['content-type']);
    if (!r) { req.formError = 'The form could not be read. Please try again.'; req.body = {}; return next(); }
    req.body = r.fields; req.files = r.files; next();
  });
  function takeFile(req, acc, old, what = 'certificate'){
    const f = req.files && req.files.file;
    if (!f) return { keep: true };
    if (f.data.length > MAX_FILE) return { error: 'That file is too large. Files can be up to 10 MB.' };
    const k = fileKind(f.data);
    if (!k) return { error: 'Please upload the ' + what + ' as a PDF, JPEG or PNG.' };
    const id = rid(12), dir = path.join(FILE_DIR, acc.id);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, id + '.' + k.ext), f.data);
    if (old) { try { fs.unlinkSync(path.join(dir, old.id + '.' + old.ext)); } catch (e) {} }
    return { file: { id, ext: k.ext, type: k.type, size: f.data.length, name: line(path.basename(f.filename).replace(/[^\w .,()&'-]/g, '-'), 120) || what + '.' + k.ext, at: new Date().toISOString() } };
  }
  function certPost(kind){
    return (req, res) => {
      const b = req.body || {}, p0 = prop(req.acc, req.params.id); if (!p0) return gone(res);
      const v = kind === 'gas' ? { date: validDate(b.date), expiresSet: validDate(b.expires), engineer: line(b.engineer, 100), gasSafeNo: line(b.gasSafeNo, 20) }
        : { date: validDate(b.date), dueSet: validDate(b.due), result: b.result === 'unsatisfactory' ? 'unsatisfactory' : 'satisfactory', remedialDate: validDate(b.remedialDate), engineer: line(b.engineer, 100) };
      const err = req.formError || (!v.date ? 'Please enter the date of the ' + (kind === 'gas' ? 'check.' : 'inspection.') : (v.expiresSet || v.dueSet) && (v.expiresSet || v.dueSet) <= v.date ? 'The expiry date must be after the date of the ' + (kind === 'gas' ? 'check.' : 'inspection.') : v.date > addDays(todayLondon(), 1) ? 'The date of the ' + (kind === 'gas' ? 'check' : 'inspection') + ' can’t be in the future.' : '');
      if (err) return propertyPage(req, res, p0, { section: kind, values: v, error: err, status: req.formError && /large/.test(req.formError) ? 413 : 400 });
      let fileErr = '';
      const p = update(req, (p, acc) => {
        const old = p[kind] && p[kind].file, f = takeFile(req, acc, old);
        if (f.error) { fileErr = f.error; return; }
        let file = f.file || old || null;
        if (!f.file && b.removeFile && old) { try { fs.unlinkSync(path.join(FILE_DIR, acc.id, old.id + '.' + old.ext)); } catch (e) {} file = null; }
        p[kind] = Object.assign(v, { file, savedAt: new Date().toISOString() });
      });
      if (!p) return gone(res);
      if (fileErr) return propertyPage(req, res, prop(readAcc(req.acc.id), req.params.id), { section: kind, values: v, error: fileErr, status: /large/.test(fileErr) ? 413 : 400 });
      done(res, p, kind);
    };
  }
  app.post('/account/p/:id/gas', need, multipart, certPost('gas'));
  app.post('/account/p/:id/eicr', need, multipart, certPost('eicr'));

  /* Tenancy */
  const amount = v => { const n = Math.round(parseFloat(String(v || '').replace(/[£,\s]/g, '')) * 100) / 100; return n > 0 && n < 10000000 ? n : 0; };
  app.post('/account/p/:id/tenancy', need, urlenc, (req, res) => {
    const b = req.body || {}, p0 = prop(req.acc, req.params.id); if (!p0) return gone(res);
    const v = { names: line(b.names, 200), emails: line(b.emails, 200), phones: line(b.phones, 100), start: validDate(b.start), end: validDate(b.end), periodic: !!b.periodic, rentFreq: FREQ.some(f => f[0] === b.rentFreq) ? b.rentFreq : 'month',
      rentP: money.parsePence(b.rent), deposit: amount(b.deposit), scheme: SCHEMES.includes(b.scheme) ? b.scheme : '', protectedOn: validDate(b.protectedOn), depositRef: line(b.depositRef, 60), notes: text(b.notes, 2000) };
    const err = !v.names && !v.start ? 'Please enter the tenant’s name or the start date.' : v.end && v.start && v.end <= v.start ? 'The end of the fixed term must be after the start date.' : v.emails && !v.emails.split(/[,;\s]+/).filter(Boolean).every(e => EMAIL_RE.test(e)) ? 'Please check the tenant email addresses.' : '';
    if (err) return propertyPage(req, res, p0, { section: 'tenancy', values: v, error: err, status: 400 });
    const p = update(req, p => {
      const old = p.tenancy || {}, rentP = money.parsePence(b.rent);
      // The rent's schedule (first rent date, due day, earlier amounts) is set in the Rent section; keep it.
      ['rentStart', 'dueDay', 'rentHist', 'rentP', 'rent'].forEach(k => { if (old[k] !== undefined) v[k] = old[k]; });
      if (money.STEP[v.rentFreq].d) v.dueDay = 0;
      const next = (p.payments || []).length ? (money._test.ledger(Object.assign({}, p, { tenancy: Object.assign({}, old, v) }), todayLondon()).next || {}).due || '' : '';
      money.applyRent(old, v, rentP, next);
      p.tenancy = Object.assign(v, { savedAt: new Date().toISOString() });
    });
    p ? done(res, p, 'tenancy') : gone(res);
  });

  /* Uploaded certificates: only to the account they belong to */
  app.get('/account/files/:fid', need, (req, res) => {
    const fid = String(req.params.fid), acc = req.acc;
    const f = acc.properties.flatMap(p => [p.gas && p.gas.file, p.eicr && p.eicr.file]).concat((acc.expenses || []).map(e => e.file)).find(x => x && x.id === fid);
    if (!f || !/^[a-f0-9]{24}$/.test(fid)) return res.status(404).type('text/plain').send('File not found.');
    res.set({ 'Content-Disposition': `inline; filename="${f.name.replace(/["\\]/g, '')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.type(f.type).sendFile(path.join(FILE_DIR, acc.id, f.id + '.' + f.ext), err => { if (err && !res.headersSent) res.status(404).type('text/plain').send('File not found.'); });
  });

  /* ------------------------------ rent, receipts, expenses, tax year ------------------------------ */
  const M = money.mount(app, { need, send, head, inp, sel, area, stHTML, esc, line, text, todayLondon, readAcc, writeAcc, prop, update, multipart, takeFile, FILE_DIR, emailOn, sendEmail, emailHTML,
    limiter, clientIp, urlenc, EMAIL_RE, rid, NOTES, propertyPage });

  /* ------------------------------ settings ------------------------------ */
  function settingsPage(req, res, error, status){
    const acc = req.acc, s = acc.settings || {};
    send(req, res, { path: '/account/settings', title: 'Settings', status, notice: error ? { text: error } : null, body: head('Account', 'Settings', esc(acc.email), '', ['All properties', '/account']) + `
<section class="tight"><div class="wrap">
  <div class="acc-sec"><div class="acc-sec-h"><h2>Reminders</h2><p>We email you 60, 30, 14 and 7 days before a certificate expires, and on the day; 60 days before a fixed-term tenancy ends; and while a deposit still needs protecting.</p></div>
    <div class="acc-sec-b"><div class="acc-box"><form class="form" method="post" action="/account/settings">
      ${inp('Your name', 'name', acc.name, { req: true, max: 80 })}
      <label class="check"><input type="checkbox" name="reminders" value="1"${s.reminders !== false ? ' checked' : ''}> Email me reminders</label>
      ${inp('Also send reminders to', 'ccEmail', s.ccEmail, { type: 'email', opt: true, hint: 'For example your letting agent or a partner.' })}
      <label class="check"><input type="checkbox" name="rentReminders" value="1"${s.rentReminders ? ' checked' : ''}> Email me when rent is more than ${money.GRACE} days late and not marked as received (once for each rent period; only to you, never to the tenant)</label>
      ${inp('Your name on rent receipts', 'receiptName', s.receiptName, { opt: true, max: 80, hint: 'Leave blank to use your name above. For example a company name.' })}
      ${emailOn() ? '' : '<p class="acc-note">Email reminders aren’t switched on for this site yet.</p>'}
      <button class="btn primary sm">Save settings</button></form></div></div></div>
  <div class="acc-sec" id="password"><div class="acc-sec-h"><h2>Password</h2><p>Changing your password signs you out on your other devices.</p></div>
    <div class="acc-sec-b"><div class="acc-box"><form class="form" method="post" action="/account/password">
      ${inp('Current password', 'current', '', { type: 'password', req: true, max: 200, attrs: ' autocomplete="current-password"' })}
      ${inp('New password', 'password', '', { type: 'password', req: true, max: 200, attrs: ' minlength="8" autocomplete="new-password"', hint: 'At least 8 characters.' })}
      <button class="btn primary sm">Change password</button></form></div></div></div>
  <div class="acc-sec" id="delete"><div class="acc-sec-h"><h2>Delete account</h2><p>Deletes your account, every property, every certificate and receipt you’ve uploaded, and your rent and expense records. This can’t be undone. Download your tax-year summaries first if you need them.</p></div>
    <div class="acc-sec-b"><div class="acc-box"><form class="form" method="post" action="/account/delete" onsubmit="return confirm('Delete your account and everything in it?')">
      ${inp('Your password', 'password', '', { type: 'password', req: true, max: 200, attrs: ' autocomplete="current-password"' })}
      <button class="btn danger sm">Delete my account</button></form></div></div></div>
</div></section>` });
  }
  app.get('/account/settings', need, (req, res) => settingsPage(req, res));
  app.post('/account/settings', need, urlenc, (req, res) => {
    const b = req.body || {}, name = line(b.name, 80), cc = normEmail(b.ccEmail);
    if (!name) return settingsPage(req, res, 'Please enter your name.', 400);
    if (cc && !EMAIL_RE.test(cc)) return settingsPage(req, res, 'Please check the extra email address.', 400);
    const acc = readAcc(req.acc.id); acc.name = name; acc.settings = { reminders: !!b.reminders, ccEmail: cc === acc.email ? '' : cc, rentReminders: !!b.rentReminders, receiptName: line(b.receiptName, 80) }; writeAcc(acc);
    res.redirect(303, '/account/settings?m=settings');
  });
  app.post('/account/password', need, urlenc, async (req, res) => {
    const b = req.body || {}, pw = String(b.password || '');
    if (!signInTries(clientIp(req))) return settingsPage(req, res, 'Too many attempts. Please wait 15 minutes.', 429);
    if (!(await checkPassword(req.acc, String(b.current || '').slice(0, 200)))) return settingsPage(req, res, 'Your current password isn’t right.', 401);
    if (pw.length < 8 || pw.length > 200) return settingsPage(req, res, 'Please choose a new password of at least 8 characters.', 400);
    const h = await hashPassword(pw), acc = readAcc(req.acc.id);
    Object.assign(acc, { salt: h.salt, hash: h.hash, sessionVer: (acc.sessionVer || 0) + 1 }); writeAcc(acc);
    setSession(req, res, acc); res.redirect(303, '/account/settings?m=pw');
  });
  app.post('/account/delete', need, urlenc, async (req, res) => {
    if (!signInTries(clientIp(req))) return settingsPage(req, res, 'Too many attempts. Please wait 15 minutes.', 429);
    if (!(await checkPassword(req.acc, String((req.body || {}).password || '').slice(0, 200)))) return settingsPage(req, res, 'That password isn’t right, so nothing was deleted.', 401);
    deleteAccount(req.acc.id); setSession(req, res, null);
    res.redirect(303, '/landlords?m=gone');
  });

  /* ------------------------------ reminders ------------------------------ */
  async function runReminders(o = {}){
    const t = o.today || todayLondon(), sendMail = o.send || sendEmail, base = o.base || mailBase();
    if (!o.send && !emailOn()) { console.log('landlords: reminders skipped (RESEND_API_KEY is not set)'); return { skipped: true, sent: 0, emails: 0 }; }
    let sent = 0, emails = 0, failed = 0;
    for (const id of accountIds()) {
      const acc = readAcc(id); if (!acc) continue;
      const certsOn = !(acc.settings && acc.settings.reminders === false), rentOn = !!(acc.settings && acc.settings.rentReminders);
      if (!certsOn && !rentOn) continue;
      const due = [];
      for (const p of acc.properties) {
        if (certsOn) for (const it of dueItems(p)) {
          const left = days(t, it.due), stage = stageFor(it.stages, left); if (stage === null) continue;
          const key = p.id + ':' + it.kind + ':' + it.due + ':' + stage;
          if (!(acc.sent || {})[key]) due.push({ p, it, left, key });
        }
        // Rent more than a few days late: once per rent period (off unless the landlord turns it on).
        if (rentOn) for (const it of money.rentReminderItems(p, t)) {
          const key = p.id + ':rent:' + it.due + ':late';
          if (!(acc.sent || {})[key]) due.push({ p, it, left: days(t, it.due), key });
        }
      }
      if (!due.length) continue;
      due.sort((a, b) => a.left - b.left);
      const m = reminderEmail(acc, due, base);
      const to = [acc.email].concat(acc.settings && acc.settings.ccEmail ? [acc.settings.ccEmail] : []);
      const r = await sendMail(Object.assign({ to }, m));
      if (r && r.ok) {
        const fresh = readAcc(id); if (!fresh) continue;
        fresh.sent = fresh.sent || {}; due.forEach(x => { fresh.sent[x.key] = new Date().toISOString(); });
        const keys = Object.keys(fresh.sent); if (keys.length > 1000) keys.sort((a, b) => fresh.sent[a].localeCompare(fresh.sent[b])).slice(0, keys.length - 1000).forEach(k => delete fresh.sent[k]);
        writeAcc(fresh); sent += due.length; emails++;
      } else failed++;
    }
    console.log('landlords: reminders for ' + t + ': ' + plural(sent, 'reminder') + ' in ' + plural(emails, 'email') + (failed ? ', ' + failed + ' failed' : ''));
    return { sent, emails, failed };
  }
  function reminderEmail(acc, due, base){
    const what = x => {
      const a = fullAddress(x.p.address), d = fmtLong(x.it.due), l = x.left;
      switch (x.it.kind) {
        case 'tenancy': return { h: 'The tenancy ends ' + inDays(l), p: `The fixed term at ${a} ends on ${d}. If you’d like to renew it, or plan the check-out, now is a good time.`, link: ['Do the check-out', base + '/app'] };
        case 'rent': return { h: 'Rent overdue: ' + money.gbp(x.it.left, true), p: `The rent for ${x.it.period} at ${a} was due on ${d} and ${money.gbp(x.it.left, true)} isn’t marked as received yet. If it has been paid, mark it as received on your dashboard so it’s up to date.`, link: ['Mark it as received', base + '/account/p/' + x.p.id + '#rent'] };
        case 'deposit': return { h: 'Protect the deposit' + (l < 0 ? ': the deadline has passed' : ' ' + (l === 0 ? 'today' : 'by ' + fmt(x.it.due))), p: `The deposit of ${pounds(x.p.tenancy.deposit)} for ${a} isn’t recorded as protected yet. In England and Wales it must be protected within 30 days of receiving it, which for this tenancy is ${d}. If it’s already protected, add the date on your dashboard.`, link: ['Update the tenancy', base + '/account/p/' + x.p.id + '#tenancy'] };
        default: {
          const name = LABEL[x.it.kind], lower = { gas: 'Gas Safety certificate', eicr: 'electrical safety report (EICR)', epc: 'EPC' }[x.it.kind];
          return { h: name + (l < 0 ? ' expired ' + inDays(l) : l === 0 ? ' expires today' : ' expires ' + inDays(l)), p: `The ${lower} for ${a} ${l < 0 ? 'expired' : 'expires'} on ${d}.`, link: ['Book ' + (x.it.kind === 'gas' ? 'a Gas Safety check' : x.it.kind === 'eicr' ? 'an EICR' : 'an EPC'), bookLink(base, x.it.kind, x.p)] };
        }
      }
    };
    const items = due.map(x => Object.assign({ x }, what(x)));
    const subject = items.length === 1 ? items[0].h + ': ' + streetLine(due[0].p.address) : plural(items.length, 'reminder') + ' for your properties';
    const html = emailHTML([`Hello ${esc(acc.name)},`, items.length === 1 ? 'A reminder from your DIY Inventory property dashboard.' : 'Reminders from your DIY Inventory property dashboard.']
      .concat(items.map(i => `<div style="border-top:1px solid #E1DDD3;padding:16px 0 4px"><p style="margin:0 0 6px;font-weight:700">${esc(i.h)}</p><p style="margin:0 0 10px;color:#4E535A">${esc(i.p)}</p><p style="margin:0 0 12px"><a href="${esc(i.link[1])}" style="color:#1F4B3A;font-weight:600">${esc(i.link[0])} →</a></p></div>`))
      .concat([`<p style="margin:12px 0 0;color:#4E535A">See all your properties: <a href="${esc(base + '/account')}" style="color:#1F4B3A">${esc(base.replace(/^https?:\/\//, '') + '/account')}</a></p>`]), null,
      `You get these emails because reminders are on for your DIY Inventory landlord account. <a href="${esc(base + '/account/settings')}" style="color:#868B92">Turn them off</a>.`);
    const txt = [`Hello ${acc.name},`, '', items.length === 1 ? 'A reminder from your DIY Inventory property dashboard.' : 'Reminders from your DIY Inventory property dashboard.', '']
      .concat(items.flatMap(i => [i.h, i.p, i.link[0] + ': ' + i.link[1], ''])).concat(['All your properties: ' + base + '/account', 'Turn reminders off: ' + base + '/account/settings']).join('\n');
    return { subject, html, text: txt };
  }
  // Once a day, in the morning (London time): checked every hour, and shortly after start-up.
  function tick(){
    const t = todayLondon(), s = readState();
    if (s.lastRun === t || londonHour() < 7 || !emailOn()) return;
    s.lastRun = t; writeState(s);
    runReminders().then(r => { if (r.sent) notify({ title: 'Landlord reminders sent', message: plural(r.sent, 'reminder') + ' to ' + plural(r.emails, 'landlord') + (r.failed ? ' (' + r.failed + ' failed)' : ''), tags: ['bell'] }); })
      .catch(e => console.error('landlords: reminder run failed:', e.message));
  }
  if ((process.env.LANDLORD_REMINDERS || 'on').trim().toLowerCase() !== 'off') { setTimeout(tick, 45000).unref(); setInterval(tick, 3600000).unref(); }

  /* ------------------------------ the owner's /admin ------------------------------ */
  function adminHTML(){
    const accs = allAccounts().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), t = todayLondon();
    const s = readState(), seen = s.adminSeenAt || '', fresh = accs.filter(a => a.createdAt > seen).length;
    if (accs.length) { s.adminSeenAt = new Date().toISOString(); writeState(s); }
    const nProps = accs.reduce((n, a) => n + a.properties.length, 0), mc = money.adminCounts(accs);
    const day = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
    const up = [], missing = { gas: 0, eicr: 0, epc: 0 };
    accs.forEach(a => a.properties.forEach(p => {
      ['gas', 'eicr', 'epc'].forEach(k => { const st = certStatus(k, p, t); if (st.cls === 'none') missing[k]++; else if (st.d <= 90 && st.d >= -90) up.push({ a, p, k, st }); });
    }));
    up.sort((x, y) => x.st.d - y.st.d);
    const upRows = up.slice(0, 100).map(({ a, p, k, st }) => `<li><div style="flex:1;min-width:0"><strong>${esc(SHORT[k])} · ${esc(fullAddress(p.address))}</strong> <span class="pill${st.d < 0 ? ' wait' : ''}">${st.d < 0 ? 'Expired ' + esc(fmt(st.due)) : 'Due ' + esc(fmt(st.due)) + ' · ' + esc(inDays(st.d))}</span>
      <div class="sub">${esc(p.type)} · ${esc(bedsText(p.beds))} · ${esc(a.name)} · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></div></div></li>`).join('');
    const accRows = accs.slice(0, 300).map(a => `<li${a.createdAt > seen ? ' class="isnew"' : ''}><div style="flex:1;min-width:0"><strong>${esc(a.name)}</strong>${a.createdAt > seen ? ' <span class="pill new">New</span>' : ''}
      <div class="sub"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a> · joined ${esc(day(a.createdAt))} · ${plural(a.properties.length, 'property').replace('propertys', 'properties')}${a.properties.length ? ': ' + esc(a.properties.slice(0, 3).map(p => streetLine(p.address) + ', ' + p.address.postcode).join('; ')) + (a.properties.length > 3 ? '…' : '') : ''} · reminders ${a.settings && a.settings.reminders === false ? 'off' : 'on'}</div></div>
      <div class="actions"><form method="post" action="/admin/landlords/${esc(a.id)}/delete" onsubmit="return confirm('Delete the account of ${esc(a.name.replace(/'/g, ''))} with all its properties and files? This cannot be undone.')"><button class="btn danger">Delete</button></form></div></li>`).join('');
    const banner = fresh ? `<a class="news" href="#landlords" onclick="document.getElementById('landlords').open=true">🏠 ${plural(fresh, 'new landlord sign-up')} since your last visit</a>` : '';
    return banner + `<details class="codes" id="landlords"${fresh ? ' open' : ''}><summary>🏠 Landlord accounts <span class="sub" style="display:inline">— ${accs.length ? plural(accs.length, 'account') + ', ' + nProps + ' propert' + (nProps === 1 ? 'y' : 'ies') + (up.length ? ', ' + up.length + ' certificate' + (up.length === 1 ? '' : 's') + ' due within 90 days' : '') : 'none yet'}</span></summary>
${accs.length ? `<p class="sub" style="margin-top:12px">Certificates expired or due in the next 90 days (leads for bookings). Not added yet: ${missing.gas} Gas Safety, ${missing.eicr} EICR, ${missing.epc} EPC.${emailOn() ? '' : ' Reminder emails are off until RESEND_API_KEY is set.'}${epcOn() ? '' : ' The automatic EPC search is off until EPC_API_EMAIL and EPC_API_KEY are set.'}</p>
${upRows ? '<ul>' + upRows + '</ul>' : '<p class="sub">Nothing due in the next 90 days.</p>'}
<p class="sub" style="margin-top:14px">Rent and expenses (counts only): ${(mc.rentProps + ' propert' + (mc.rentProps === 1 ? 'y' : 'ies'))} with rent set up, ${plural(mc.payments, 'rent payment')} recorded, ${plural(mc.receipts, 'receipt')} emailed, ${plural(mc.expenses, 'expense')} recorded.</p>
<p class="sub" style="margin-top:14px">Accounts, newest first:</p><ul>${accRows}</ul>` : '<p class="sub">Landlords who create a free account on the Landlords page appear here, with their properties’ certificate dates.</p>'}</details>`;
  }
  app.post('/admin/landlords/:id/delete', urlenc, (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!isOwner(req)) return res.status(401).type('text/plain').send('Sign in to /admin first.');
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Delete accounts from the reports page.');
    deleteAccount(String(req.params.id));
    res.redirect(303, '/admin#landlords');
  });
  if (ctx.addAdminSection) ctx.addAdminSection(adminHTML);

  console.log('landlords: accounts in ' + DIR + ' · EPC search ' + (epcOn() ? 'on (' + epcConf().base + ')' : 'off (EPC_API_EMAIL / EPC_API_KEY not set)') + ' · reminder emails ' + (emailOn() ? 'on' : 'off (RESEND_API_KEY not set)'));
  Object.assign(module.exports, { runReminders, adminHTML });   // for tests and scripts
  return { paths: ['/landlords'], runReminders, adminHTML };
}

module.exports = { mount, setMailer: fn => { mailer = fn; }, _test: { certStatus, tenancyStatus, depositStatus, dueItems, stageFor, addMonths, normPostcode, streetLine, parseMultipart, epcRow, days } };
