// Self check-in report server.
// Serves the single-file client in public/ and a small API:
//   GET  /api/status          what the server can do (AI assessment)
//   POST /api/assess          rate one photo of a checklist item (assessed and discarded)
//   POST /api/reports         receive a copy of a finished report PDF (see reports.js)
//   /admin                    the owner's private list of submitted reports (ADMIN_PASSWORD)
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const reports = require('./reports');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const ANTHROPIC_MODEL = (process.env.ANTHROPIC_MODEL || '').trim() || 'claude-opus-5-5';
// Current models take an effort level (low is plenty for one photo); the Opus/Fable/Sonnet 5.5 line also
// takes the server-side fallback, so a declined photo is retried on another model in the same call.
const AI_EFFORT = /^claude-(opus|sonnet|fable|haiku)-5/.test(ANTHROPIC_MODEL);
const AI_FALLBACK = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(ANTHROPIC_MODEL);

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
    model: anthropic ? ANTHROPIC_MODEL : '',
    reason: anthropic ? '' : 'ANTHROPIC_API_KEY is not set on the server'
  });
});

/* ----------------------------- /api/assess ----------------------------- */
const CONDITIONS = ['new', 'good', 'fair', 'poor'];
// Must match DEFECT_OPTIONS in public/index.html.
const DEFECTS = ['Scuffs', 'Scratches', 'Marks', 'Stains', 'Chips', 'Cracks', 'Holes', 'Dents', 'Fading', 'Worn', 'Loose', 'Broken', 'Missing parts', 'Damp / mould', 'Limescale', 'Rust'];
const CLEANLINESS = ['clean', 'needs', 'dirty'];

const ASSESS_SYSTEM = [
  'You assess photographs taken by a tenant, landlord or agent for a residential property inventory, check-in, check-out or inspection report. The property can be anywhere in the world.',
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
    const response = await anthropic.beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      ...(AI_EFFORT ? { output_config: { effort: 'low' } } : {}),
      ...(AI_FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
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
const freeAssess = (() => {
  const perIp = new Map(), DAY = 24 * 3600 * 1000, MAX_IP = 300, MAX_ALL = Math.max(0, parseInt(process.env.AI_FREE_DAILY, 10) || 3000);
  let all = { start: Date.now(), n: 0 };
  return { allow(req){
    const now = Date.now(), ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (now - all.start > DAY) all = { start: now, n: 0 };
    let h = perIp.get(ip); if (!h || now - h.start > DAY) { h = { start: now, n: 0 }; perIp.set(ip, h); if (perIp.size > 20000) perIp.clear(); }
    if (h.n >= MAX_IP || all.n >= MAX_ALL) return false;
    h.n++; all.n++; return true;
  } };
})();
// The access code is short, so wrong tries are limited: 10 per IP per 15 minutes.
const codeTries = (() => {
  const hits = new Map(), ip = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const fresh = h => h && Date.now() - h.start < 15 * 60 * 1000;
  return {
    blocked: req => { const h = hits.get(ip(req)); return fresh(h) && h.n >= 10; },
    wrong: req => { const k = ip(req), h = hits.get(k); if (fresh(h)) h.n++; else { hits.set(k, { start: Date.now(), n: 1 }); if (hits.size > 5000) hits.clear(); } },
  };
})();
const TOKEN_RE = /^[\w-]{12,40}$/;
const cookieToken = req => { const m = /(?:^|;\s*)diy_access=([\w-]{12,40})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; };
async function checkAccess(token){
  if (!TOKEN_RE.test(token || '')) return { valid: false, reason: 'none' };
  const own = reports.codeAccess(token);   // an access code from the owner's /admin page
  if (own) return own;
  if (/^(DIY|FREE)-[A-Z0-9]{4}-[A-Z0-9]{4}$|^SHARED-/i.test(token)) return { valid: false, reason: 'unknown' };   // a deleted or mistyped access code
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
/* ------------------------------- website ------------------------------- */
// The public website: views/layout.html (header, menu, footer) around a page from views/pages/, styled
// by public/site.css. The home page is what everyone without access sees at "/" (the app is there for
// people with access); the other pages are open to everyone. A link or code that didn't work, or a sent
// message, adds a notice at the top.
const VIEWS = path.join(__dirname, 'views');
const LAYOUT = fs.readFileSync(path.join(VIEWS, 'layout.html'), 'utf8');
const CSS_V = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'public', 'site.css'))).digest('hex').slice(0, 10);
const DESC = 'Property inventories, check-in and check-out reports and inspections on your phone. Dated photos, tenant sign-off, side-by-side comparison and PDF reports, for £30 + VAT per report.';
const SITE = {
  home: { path: '/', title: 'DIY Inventory · Property inventories and inspections', og: 'DIY Inventory', desc: DESC },
  how: { path: '/how-it-works', file: 'how-it-works', title: 'How it works · DIY Inventory', desc: 'How to do check-ins, inspections and check-outs on your phone with DIY Inventory, step by step.' },
  pricing: { path: '/pricing', file: 'pricing', title: 'Pricing · DIY Inventory', desc: 'One report for £30 + VAT: a check-in, check-out or inspection, done on your phone, with a professional PDF report.' },
  faq: { path: '/faq', file: 'faq', title: 'FAQ · DIY Inventory', desc: 'Answers to common questions about doing your own inventory report with DIY Inventory.' },
  contact: { path: '/contact', file: 'contact', title: 'Contact · DIY Inventory', desc: 'Get in touch with DIY Inventory.' },
  privacy: { path: '/privacy', file: 'privacy', title: 'Privacy · DIY Inventory', desc: 'What DIY Inventory keeps about you and why.' },
};
for (const [key, pg] of Object.entries(SITE)) pg.body = fs.readFileSync(path.join(VIEWS, 'pages', (pg.file || key) + '.html'), 'utf8');
const siteBase = req => { const host = String(req.headers.host || ''); return (/^(localhost|127\.|\[::1\])/.test(host) ? 'http://' : 'https://') + host; };
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function sitePage(key, req, notice){
  const pg = SITE[key];
  const fill = t => t.split('{{BUY_URL}}').join(escHtml(BUY_URL)).split('{{EXAMPLE_URL}}').join(escHtml(FIXFLOW_URL + '/diy-inventory'));
  let html = LAYOUT.replace('{{CONTENT}}', () => pg.body)
    .replace('{{NOTICE}}', () => notice ? '<div class="wrap"><div class="notice' + (notice.ok ? ' ok' : '') + '" role="' + (notice.ok ? 'status' : 'alert') + '">' + escHtml(notice.text) + '</div></div>' : '')
    .replace('{{AI_NOTE}}', () => anthropic ? '<p>While you take photos, each one may be sent to an AI service to suggest the item’s condition. It isn’t kept there.</p>' : '');
  for (const k of Object.keys(SITE)) html = html.split('{{ON_' + k + '}}').join(k === key ? ' on' : '');
  // AI wording only while the AI is switched on (ANTHROPIC_API_KEY), so the site never claims it otherwise.
  html = anthropic ? html.replace(/<!--NOAI-->[\s\S]*?<!--\/NOAI-->/g, '').replace(/<!--\/?AI-->/g, '') : html.replace(/<!--AI-->[\s\S]*?<!--\/AI-->/g, '').replace(/<!--\/?NOAI-->/g, '');
  return fill(html).replace('{{TITLE}}', escHtml(pg.title)).replace('{{OG_TITLE}}', escHtml(pg.og || pg.title))
    .split('{{DESCRIPTION}}').join(escHtml(pg.desc)).split('{{BASE}}').join(escHtml(siteBase(req))).split('{{PATH}}').join(pg.path).replace('{{CSS_V}}', CSS_V);
}
function paywallPage(reason, req){
  const msg = reason === 'used' ? 'This link has already been used for a report.' : reason === 'expired' ? 'This link has expired.' : reason === 'changed' ? 'The access code has changed. Please enter the new one.' : reason === 'tries' ? 'Too many wrong codes. Please wait 15 minutes and try again.' : reason === 'unknown' ? 'We don’t recognise that link or code.' : '';
  return sitePage('home', req, msg ? { text: msg } : null);
}
for (const [key, pg] of Object.entries(SITE)) if (key !== 'home') app.get([pg.path, pg.path + '/'], (req, res) => {
  const notice = key === 'contact' && req.query.sent ? { ok: true, text: 'Thanks, your message has been sent. We’ll get back to you soon.' } : null;
  res.type('html').send(sitePage(key, req, notice));
});
app.post('/contact', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
  const r = reports.saveMessage(req, req.body || {});
  if (r.ok) return res.redirect(303, '/contact?sent=1');
  res.status(r.status || 400).type('html').send(sitePage('contact', req, { text: r.error }));
});

// Link previews and search engines (WhatsApp, iMessage, Facebook, Slack, Google…): their robots fetch the
// link with no access, so they always get the landing page (HTTP 200, with its title, description and
// icon), whatever link was shared. Robots never count as an access-code login.
const PREVIEW_BOT = /facebookexternalhit|facebookcatalog|WhatsApp|Twitterbot|Slackbot|TelegramBot|LinkedInBot|Discordbot|Applebot|Pinterest|redditbot|Embedly|SkypeUriPreview|Googlebot|bingbot|vkShare|Iframely/i;
app.use((req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !PREVIEW_BOT.test(String(req.headers['user-agent'] || ''))) return next();
  if (/^\/(api|admin|p|icons|sign)(\/|$)/.test(req.path) || /\.(png|svg|ico|webmanifest|js|css|json|jpg|pdf)$/i.test(req.path)) return next();
  res.set('Cache-Control', 'public, max-age=3600').type('html').send(sitePage('home', req));
});

if (PAYWALL) {
  // New reports need a valid link. AI condition suggestions are part of the free start too, within limits
  // (per person per day, and for the whole site per day: AI_FREE_DAILY, default 3000 photos).
  app.use(['/api/assess', '/api/reports'], async (req, res, next) => {
    if (req.method !== 'POST' || (req.path !== '/' && req.baseUrl === '/api/reports')) return next();
    if (reports.isOwner(req)) return next(); // the owner (signed in to /admin) needs no paid link
    const token = cookieToken(req), a = await checkAccess(token);
    if (!a.valid && req.baseUrl === '/api/assess') {
      if (!freeAssess.allow(req)) return res.status(429).json({ error: 'Automatic suggestions are busy right now. Choose the condition yourself.' });
      return next();
    }
    if (!a.valid) return res.status(402).json({ error: a.reason === 'used' ? 'This access link has already been used for a report.' : 'You need a paid access link to use DIY Inventory.', buy: BUY_URL });
    if (req.baseUrl === '/api/reports') res.on('finish', () => {
      if (res.statusCode !== 201) return;
      if (reports.codeAccess(token)) { let m = {}; try { m = JSON.parse(decodeURIComponent(String(req.headers['x-report-meta'] || ''))); } catch (e) {} reports.useCode(token, m.address, req); return; }
      sendToFixflow(token, req); markUsed(token);
    });
    next();
  });
  // The app is free to start at /app (payment is asked for when the report is finished: /api/access).
  // "/" is the app for people with a valid link (a link that has made its report still opens, to see
  // and send it), and the website for everyone else.
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' || /^\/(api|admin|p|icons|sign)(\/|$)/.test(req.path) || /\.(png|svg|ico|webmanifest|js|css|json)$/i.test(req.path)) return next();
    if (reports.isOwner(req)) return next(); // the owner (signed in to /admin) needs no paid link
    const isApp = /^\/app\/?$/.test(req.path);
    if (isApp && !req.query.access) return next();
    const raw = String(req.query.access || '').trim();
    if (raw && codeTries.blocked(req)) return res.status(429).type('html').send(paywallPage('tries', req));
    const q = reports.canonicalCode(raw) || (TOKEN_RE.test(raw) ? raw : ''), token = q || cookieToken(req);
    if (raw && !q) { codeTries.wrong(req); return res.status(402).type('html').send(paywallPage('unknown', req)); }
    const a = await checkAccess(token);
    if (!(a.valid || (a.reason === 'used' && token === cookieToken(req)))) {
      if (!q && req.path === '/' && req.query.from) return res.redirect(302, '/app?from=' + encodeURIComponent(String(req.query.from).slice(0, 64)));   // "start from this report" links
      if (!q && isApp) return next();
      const why = q || token ? a.reason : 'none'; return res.status(why === 'none' ? 200 : 402).type('html').send(paywallPage(why, req)); }
    if (q && reports.codeAccess(q) && q !== cookieToken(req)) reports.codeLogin(req, q);   // tell the owner on /admin
    if (q) { res.setHeader('Set-Cookie', 'diy_access=' + q + '; Path=/; Max-Age=' + 200 * 86400 + '; HttpOnly; Secure; SameSite=Lax'); return res.redirect(302, req.path); }
    next();
  });
}

// Free to start, pay at the end: whether this browser may download and send a finished report, and
// unlocking it with the link from the payment email (or its token, or an access code) pasted in the app.
app.get('/api/access', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!PAYWALL || reports.isOwner(req)) return res.json({ access: true, buy: BUY_URL });
  const a = await checkAccess(cookieToken(req));
  res.json({ access: !!a.valid, reason: a.valid ? '' : a.reason, buy: BUY_URL });
});
app.post('/api/access', async (req, res) => {
  if (!PAYWALL) return res.json({ ok: true });
  if (codeTries.blocked(req)) return res.status(429).json({ error: 'Too many wrong codes. Please wait 15 minutes and try again.' });
  let raw = String((req.body || {}).code || '').trim().slice(0, 400);
  const m = /[?&]access=([^&#\s]+)/.exec(raw);
  if (m) { try { raw = decodeURIComponent(m[1]); } catch (e) { raw = m[1]; } }
  const q = reports.canonicalCode(raw) || (TOKEN_RE.test(raw) ? raw : '');
  if (!q) { codeTries.wrong(req); return res.status(400).json({ error: 'We don’t recognise that link or code. Check it and try again.' }); }
  const a = await checkAccess(q);
  if (!a.valid) {
    if (a.reason !== 'used') codeTries.wrong(req);
    return res.status(402).json({ error: a.reason === 'used' ? 'That link has already been used for another report.' : a.reason === 'expired' ? 'That link has expired.' : a.reason === 'changed' ? 'That access code has changed.' : 'We don’t recognise that link or code. Check it and try again.' });
  }
  if (reports.codeAccess(q) && q !== cookieToken(req)) reports.codeLogin(req, q);
  res.setHeader('Set-Cookie', 'diy_access=' + q + '; Path=/; Max-Age=' + 200 * 86400 + '; HttpOnly; Secure; SameSite=Lax');
  res.json({ ok: true });
});

reports.mount(app);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ----------------------------- client ----------------------------- */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { index: 'index.html' }));
app.use((req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Check-in report app listening on port ${PORT} (AI ${anthropic ? 'on, ' + ANTHROPIC_MODEL : 'off'})`);
});
