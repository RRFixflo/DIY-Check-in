// Self check-in report server.
// Serves the single-file client in public/ and a small API:
//   GET  /api/status          what the server can do (AI assessment)
//   POST /api/assess          rate one photo of a checklist item (assessed and discarded)
//   POST /api/reports         receive a copy of a finished report PDF (see reports.js)
//   /admin                    the owner's private list of submitted reports (ADMIN_PASSWORD)
const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const reports = require('./reports');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const ANTHROPIC_MODEL = (process.env.ANTHROPIC_MODEL || '').trim() || 'claude-haiku-4-5-20251001';

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

app.get(['/health', '/healthz'], (req, res) => res.json({ ok: true }));
app.get('/favicon.ico', (req, res) => res.type('png').sendFile(path.join(__dirname, 'public', 'icons', 'favicon-32.png')));
// Phones look for these at the root when a page doesn't name its icon.
app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => res.type('png').sendFile(path.join(__dirname, 'public', 'icons', 'apple-touch-icon.png')));

/* ----------------------------- /api/status ----------------------------- */
app.get('/api/status', (req, res) => {
  res.json({
    ai: !!anthropic,
    reason: anthropic ? '' : 'ANTHROPIC_API_KEY is not set on the server'
  });
});

/* ----------------------------- /api/assess ----------------------------- */
const CONDITIONS = ['new', 'good', 'fair', 'poor'];
// Must match DEFECT_OPTIONS in public/index.html.
const DEFECTS = ['Scuffs', 'Scratches', 'Marks', 'Stains', 'Chips', 'Cracks', 'Holes', 'Dents', 'Fading', 'Worn', 'Loose', 'Broken', 'Missing parts', 'Damp / mould', 'Limescale', 'Rust'];
const CLEANLINESS = ['clean', 'needs', 'dirty'];

const ASSESS_SYSTEM = [
  'You assess photographs taken by a tenant for a UK residential inventory and check-in report.',
  'You are told which checklist item and room the photo is meant to show.',
  'Reply with a single JSON object and nothing else, with exactly these keys:',
  '  "matches": true if the photo plausibly shows the named item, false if it clearly shows something else or is unusable,',
  '  "note": if matches is false, one short sentence telling the tenant what to retake, otherwise an empty string,',
  '  "condition": one of "new", "good", "fair", "poor",',
  '  "observation": one factual sentence describing the visible condition (marks, scuffs, stains, damage, wear), written for an inventory clerk,',
  '  "description": a short inventory description of the item itself: colour, material, type and visible features, comma separated, at most 12 words (e.g. "White painted timber door, chrome lever handle, door stop"),',
  '  "defects": an array of the defects clearly visible, using only these words: ' + DEFECTS.map(d => JSON.stringify(d)).join(', ') + '; use ["None"] if none are visible,',
  '  "cleanliness": "clean", "needs" (dust, smears or light dirt) or "dirty" (clearly dirty, grease, grime).',
  'Condition scale: new = unused, no marks; good = clean with only minimal wear; fair = noticeable wear, marks or minor damage; poor = significant damage, staining or disrepair.',
  'Describe only what is visible. Ignore the date and time stamp burned into the corner of the photo.'
].join('\n');

function parseDataUrl(dataUrl){
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  return m ? { mediaType: m[1], data: m[2] } : null;
}

function extractJson(text){
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

app.post('/api/assess', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'Condition assessment is not configured on this server.' });

  const { label, room, image } = req.body || {};
  const img = parseDataUrl(image);
  if (!img) return res.status(400).json({ error: 'Expected an image data URL.' });

  try {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system: ASSESS_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
          { type: 'text', text: `Room: ${String(room || 'Unknown').slice(0, 80)}\nChecklist item: ${String(label || 'Unknown').slice(0, 120)}` }
        ]
      }]
    });

    if (response.stop_reason === 'refusal') return res.status(422).json({ error: 'The photo could not be assessed.' });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const out = extractJson(text);
    if (!out) return res.status(502).json({ error: 'The assessment could not be read.' });

    res.json({
      matches: out.matches !== false,
      note: typeof out.note === 'string' ? out.note.slice(0, 300) : '',
      condition: CONDITIONS.includes(out.condition) ? out.condition : '',
      observation: typeof out.observation === 'string' ? out.observation.slice(0, 500) : '',
      description: typeof out.description === 'string' ? out.description.slice(0, 200) : '',
      defects: Array.isArray(out.defects) ? out.defects.filter(d => d === 'None' || DEFECTS.includes(d)) : [],
      cleanliness: CLEANLINESS.includes(out.cleanliness) ? out.cleanliness : ''
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Too many photos at once. Try again in a moment.' });
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('assess: ANTHROPIC_API_KEY was rejected');
      return res.status(503).json({ error: 'Condition assessment is misconfigured on the server.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('assess: API error', err.status, err.message);
      return res.status(502).json({ error: 'Assessment service error.' });
    }
    console.error('assess failed', err);
    res.status(500).json({ error: 'Assessment failed.' });
  }
});

/* ----------------------------- paid access ----------------------------- */
// The app is for people who have paid for a report (or been given a link by the office). Each
// person has a personal link (?access=TOKEN) from Residential Realtors; Fixflow says whether it's
// valid. The token is kept in a cookie so the link only needs opening once. DIY_PAYWALL=off turns this off.
const FIXFLOW_URL = (process.env.FIXFLOW_URL || 'https://www.residentialrealtors.co.uk').trim().replace(/\/+$/, '');
const PAYWALL = (process.env.DIY_PAYWALL || 'on').trim().toLowerCase() !== 'off';
const BUY_URL = FIXFLOW_URL + '/book-certificate?service=diy';
const accessCache = new Map();
const TOKEN_RE = /^[\w-]{12,40}$/;
const cookieToken = req => { const m = /(?:^|;\s*)diy_access=([\w-]{12,40})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; };
async function checkAccess(token){
  if (!TOKEN_RE.test(token || '')) return { valid: false, reason: 'none' };
  const c = accessCache.get(token);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.r;
  try {
    const res = await fetch(FIXFLOW_URL + '/api/public/diy-access/' + encodeURIComponent(token), { signal: AbortSignal.timeout(8000) });
    const d = await res.json();
    const r = { valid: !!d.valid, reason: d.valid ? '' : (d.reason || 'unknown') };
    accessCache.set(token, { at: Date.now(), r }); if (accessCache.size > 5000) accessCache.clear();
    return r;
  } catch (e) {
    console.error('access check failed:', e.message);
    return c ? c.r : { valid: true, reason: '' };   // Fixflow unreachable: don't lock out someone with a link
  }
}
function markUsed(token){
  accessCache.delete(token);
  fetch(FIXFLOW_URL + '/api/public/diy-access/' + encodeURIComponent(token) + '/used', { method: 'POST', signal: AbortSignal.timeout(8000) }).catch(e => console.error('mark used failed:', e.message));
}
// A copy of every finished report goes to Residential Realtors' Fixflow, which emails the person a download link.
function sendToFixflow(token, req){
  const pdf = req.body; if (!Buffer.isBuffer(pdf)) return;
  fetch(FIXFLOW_URL + '/api/public/diy-report/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Report-Meta': String(req.headers['x-report-meta'] || '').slice(0, 4000) }, body: pdf, signal: AbortSignal.timeout(60000) })
    .then(r => { if (!r.ok) console.error('report copy to Fixflow failed: HTTP ' + r.status); }).catch(e => console.error('report copy to Fixflow failed:', e.message));
}
function paywallPage(reason){
  const msg = reason === 'used' ? 'This link has already been used for a report.' : reason === 'expired' ? 'This link has expired.' : reason === 'unknown' ? 'We don’t recognise that link.' : 'You need a personal access link to use DIY Check-In.';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIY Check-In</title><link rel="icon" href="/icons/favicon-32.png">' +
    '<style>body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f6fb;color:#101828;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}.c{max-width:440px;background:#fff;border-radius:22px;padding:30px;box-shadow:0 30px 60px -40px rgba(16,24,40,.45);text-align:center}h1{margin:10px 0 6px;font-size:1.5rem}p{color:#475467;margin:0 0 14px}a.b{display:block;padding:14px 18px;border-radius:999px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-weight:800;text-decoration:none;margin:18px 0 10px}a.l{color:#4f46e5;font-weight:700}small{color:#667085}</style></head><body><main class="c">' +
    '<img src="/icons/icon-192.png" alt="" width="64" height="64"><h1>DIY Check-In</h1><p>' + msg + '</p><p>Do your own room-by-room inventory on your phone and get a dated, professional report.</p>' +
    '<a class="b" href="' + BUY_URL + '">Buy a report — £30 + VAT</a><small>Already paid? Open the link in your confirmation email.<br><a class="l" href="' + FIXFLOW_URL + '/diy-inventory">See an example report</a></small></main></body></html>';
}
if (PAYWALL) {
  // New reports and photo assessment need a valid link.
  app.use(['/api/assess', '/api/reports'], async (req, res, next) => {
    if (req.method !== 'POST' || (req.path !== '/' && req.baseUrl === '/api/reports')) return next();
    if (reports.isOwner(req)) return next(); // the owner (signed in to /admin) needs no paid link
    const token = cookieToken(req), a = await checkAccess(token);
    if (!a.valid) return res.status(402).json({ error: a.reason === 'used' ? 'This access link has already been used for a report.' : 'You need a paid access link to use DIY Check-In.', buy: BUY_URL });
    if (req.baseUrl === '/api/reports') res.on('finish', () => { if (res.statusCode === 201) { sendToFixflow(token, req); markUsed(token); } });
    next();
  });
  // The app itself: open it with a valid link; a link that has made its report still opens (to see and send it).
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' || /^\/(api|admin|p|icons)(\/|$)/.test(req.path) || /\.(png|svg|ico|webmanifest|js|css|json)$/i.test(req.path)) return next();
    if (reports.isOwner(req)) return next(); // the owner (signed in to /admin) needs no paid link
    const q = TOKEN_RE.test(String(req.query.access || '')) ? String(req.query.access) : '', token = q || cookieToken(req);
    const a = await checkAccess(token);
    if (!(a.valid || (a.reason === 'used' && token === cookieToken(req)))) return res.status(402).type('html').send(paywallPage(q || token ? a.reason : 'none'));
    if (q) { res.setHeader('Set-Cookie', 'diy_access=' + q + '; Path=/; Max-Age=' + 200 * 86400 + '; HttpOnly; Secure; SameSite=Lax'); return res.redirect(302, req.path); }
    next();
  });
}

reports.mount(app);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ----------------------------- client ----------------------------- */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { index: 'index.html' }));
app.use((req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Check-in report app listening on port ${PORT} (AI ${anthropic ? 'on, ' + ANTHROPIC_MODEL : 'off'})`);
});
