// Self check-in report server.
// Serves the single-file client in public/ and a small API:
//   GET  /api/status          what the server can do (AI assessment, address lookup)
//   GET  /api/address/:pc     every address at a UK postcode (paid PAF provider; see address.js)
//   POST /api/assess          rate one photo of a checklist item (assessed and discarded)
//   POST /api/reports         receive a copy of a finished report PDF (see reports.js)
//   /admin                    the owner's private list of submitted reports (ADMIN_PASSWORD)
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const compression = require('compression');
const Anthropic = require('@anthropic-ai/sdk');
const reports = require('./reports');
// Dollar prices for US customers (cards are still charged £29.99 in pounds): fx.js.
const fx = require('./fx'); fx.start(reports.REPORTS_DIR);
const certs = require('./certs');
const address = require('./address');
const analytics = require('./analytics');
const payments = require('./payments');
const purchases = require('./purchases');

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
// Smaller pages load faster (Core Web Vitals); PDFs and photos are already compressed.
app.use(compression({ filter: (req, res) => !/^\/(p|ip)\//.test(req.path) && compression.filter(req, res) }));
app.use(express.json({ limit: '15mb' }));

app.get(['/health', '/healthz'], (req, res) => res.json({ ok: true }));
// One address for search engines: with PUBLIC_URL set (e.g. https://diyinventory.co.uk), the www. form of it
// (or the bare form, if PUBLIC_URL is the www. one) redirects there permanently.
{
  let pub = ''; try { pub = new URL((process.env.PUBLIC_URL || '').trim()).host.toLowerCase(); } catch (e) {}
  const twin = pub ? (pub.startsWith('www.') ? pub.slice(4) : 'www.' + pub) : '';
  if (twin) app.use((req, res, next) => String(req.headers.host || '').toLowerCase() === twin ? res.redirect(301, 'https://' + pub + req.originalUrl) : next());
}
// Visit and funnel counts for /admin/analytics (no cookies, no IP addresses kept): analytics.js.
analytics.mount(app, { REPORTS_DIR: reports.REPORTS_DIR, isOwner: reports.isOwner, codeAccess: reports.codeAccess, isPurchase: purchases.isToken, clientIp: reports.clientIp, limiter: reports.limiter, PUBLIC_BASE: process.env.PUBLIC_URL || '' });
app.get('/favicon.ico', (req, res) => res.type('png').sendFile(path.join(__dirname, 'public', 'icons', 'favicon-32.png')));
// Phones look for these at the root when a page doesn't name its icon.
app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => res.type('png').sendFile(path.join(__dirname, 'public', 'icons', 'apple-touch-icon.png')));

/* ----------------------------- /api/status ----------------------------- */
app.get('/api/status', (req, res) => {
  res.json({
    ai: !!anthropic,
    model: anthropic ? ANTHROPIC_MODEL : '',
    reason: anthropic ? '' : 'ANTHROPIC_API_KEY is not set on the server',
    address: address.configured(),
    usd: fx.usd(29.99)   // what £29.99 is in dollars today, shown to US customers (the card is charged in pounds)
  });
});

/* ----------------------------- /api/address ----------------------------- */
// Postcode → addresses, for the app's setup form and the certificates form. Open to everyone (the app is
// free to start); rate-limited per IP. See address.js.
address.mount(app, { limiter: reports.limiter, clientIp: reports.clientIp });

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

// A check-out (or inspection) started from an earlier report: the earlier photo of the same item is sent too, and
// the AI says what changed. Signs, not proof: the report says so, and the people involved decide.
const CHANGE_KINDS = ['none', 'damage', 'wear', 'cleaning', 'missing', 'better', 'unclear'];
const SEVERITY = ['none', 'minor', 'moderate', 'major'];
const COMPARE_SYSTEM = ASSESS_SYSTEM + '\n' + [
  'You are ALSO given an earlier photograph of the same item, from the earlier report (usually the check-in). The FIRST image is the earlier photo, the SECOND image is the new photo. Assess condition, description, defects and cleanliness from the NEW (second) photo only.',
  'Then compare the two photos and add one more key, "change", an object with exactly these keys:',
  '  "status": "same" (no visible difference), "worse", "better", or "unclear" (different angle, lighting or framing makes a fair comparison impossible),',
  '  "kind": the main kind of change, one of "none", "damage" (new marks, chips, cracks, holes, stains, breakage), "wear" (gradual wear from normal use: light scuffs, fading, worn carpet in walkways), "cleaning" (dirtier than before), "missing" (the item or part of it is no longer there), "better", "unclear",',
  '  "severity": "none", "minor", "moderate" or "major",',
  '  "summary": one factual sentence for the report saying exactly what is different and where (e.g. "New 3 cm chip on the worktop edge to the left of the sink; not visible at the check-in"), or "No visible change" ,',
  '  "new_defects": an array of the defects visible now that were NOT visible before, using only the defect words listed above; [] if none.',
  'Be careful and fair: only report a difference you can actually see in both photos. Differences in light, angle, zoom or photo quality are not changes. Do not judge who is responsible or what anything costs.'
].join('\n');

// Photos of the keys handed over (the owner: "for pictures of keys, analyse it yourself"): count every key, fob, card
// and remote and describe them for the report's keys line. Only what is visible; a guess is said to be one.
const KEYS_SYSTEM = [
  'You look at a photograph of keys being handed over at the start or end of a residential tenancy, for an inventory report.',
  'Reply with a single JSON object and nothing else, with exactly these keys:',
  '  "is_keys": true if the photo shows keys, fobs, access cards or remotes, false otherwise,',
  '  "note": if is_keys is false, or the keys overlap so they cannot be counted, one short sentence telling the person what to retake (e.g. "Spread the keys out so each one can be counted"), otherwise an empty string,',
  '  "total": the total number of separate keys, fobs, cards and remotes you can count (an integer),',
  '  "items": an array of { "type": short name such as "Yale-type cylinder key", "mortice key", "window key", "post box key", "communal door fob", "access card", "garage remote", "count": integer, "detail": colour, tag or label text if visible, else "" },',
  '  "description": one line for the report listing them, at most 20 words, e.g. "2 × Yale-type cylinder keys, 1 × mortice key, 1 × blue communal fob on a ring with a paper tag",',
  '  "uncertain": a short phrase if any count or type is a guess, else "".',
  'Count carefully: keys on one ring are separate keys; a key ring itself is not a key. Do not guess which door a key opens unless a tag or label says so. Ignore the date and time stamp burned into the corner of the photo.'
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

  const { label, room, image, earlier, kind } = req.body || {};
  const img = parseDataUrl(image);
  if (!img) return res.status(400).json({ error: 'Expected an image data URL.' });
  if (kind === 'keys') {
    try {
      const response = await anthropic.beta.messages.create({
        model: ANTHROPIC_MODEL, max_tokens: 16000,
        ...(AI_EFFORT ? { output_config: { effort: 'low' } } : {}),
        ...(AI_FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        system: KEYS_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }, { type: 'text', text: 'Count and describe the keys in this photo.' }] }]
      });
      if (response.stop_reason === 'refusal') return res.status(422).json({ error: 'The photo could not be assessed.' });
      const out = extractJson(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
      if (!out) return res.status(502).json({ error: 'The assessment could not be read.' });
      const items = Array.isArray(out.items) ? out.items.slice(0, 20).map(x => ({ type: String(x && x.type || '').slice(0, 60), count: Math.max(0, Math.min(99, parseInt(x && x.count, 10) || 0)), detail: String(x && x.detail || '').slice(0, 80) })).filter(x => x.type && x.count) : [];
      return res.json({ keys: {
        isKeys: out.is_keys !== false,
        note: typeof out.note === 'string' ? out.note.slice(0, 200) : '',
        total: Math.max(0, Math.min(999, parseInt(out.total, 10) || items.reduce((a, x) => a + x.count, 0))),
        items,
        description: typeof out.description === 'string' ? out.description.slice(0, 200) : '',
        uncertain: typeof out.uncertain === 'string' ? out.uncertain.slice(0, 120) : ''
      } });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Too many photos at once. Try again in a moment.' });
      console.error('assess keys failed', err && err.status, err && err.message);
      return res.status(502).json({ error: 'Assessment service error.' });
    }
  }
  // The earlier photo of the same item (check-out vs check-in), read from the earlier report's own files.
  let then = null;
  if (earlier && /^[a-f0-9]{32}$/i.test(String(earlier.key || '')) && /^\d{1,4}$/.test(String(earlier.n || ''))) {
    const f = reports.photoFile(String(earlier.key).toLowerCase(), String(earlier.n));
    if (f) try { const b = fs.readFileSync(f); if (b.length < 4.5 * 1024 * 1024) then = b.toString('base64'); } catch (e) {}
  }

  try {
    const response = await anthropic.beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      ...(AI_EFFORT ? { output_config: { effort: 'low' } } : {}),
      ...(AI_FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      system: then ? COMPARE_SYSTEM : ASSESS_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          ...(then ? [{ type: 'text', text: 'Earlier photo (from the earlier report' + (earlier.condition ? ', recorded then as ' + String(earlier.condition).slice(0, 10) : '') + '):' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: then } }, { type: 'text', text: 'New photo:' }] : []),
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
      cleanliness: CLEANLINESS.includes(out.cleanliness) ? out.cleanliness : '',
      ...(then ? { change: (c => ({
        status: ['same', 'worse', 'better', 'unclear'].includes(c.status) ? c.status : 'unclear',
        kind: CHANGE_KINDS.includes(c.kind) ? c.kind : 'unclear',
        severity: SEVERITY.includes(c.severity) ? c.severity : 'none',
        summary: typeof c.summary === 'string' ? c.summary.slice(0, 300) : '',
        newDefects: Array.isArray(c.new_defects) ? c.new_defects.filter(d => DEFECTS.includes(d)) : []
      }))(out.change && typeof out.change === 'object' ? out.change : {}) } : {})
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
// Free to start, pay at the end. A report is bought on our own page, /buy (purchases.js: card payment through
// payments.js), which gives a personal link (?access=RPT-…) good for one report. The token is kept in a cookie
// so the link only needs opening once. The owner's access code works too (reports.js). DIY_PAYWALL=off turns this off.
// Links sold before /buy existed were issued by another system; they are still checked there (LEGACY_ACCESS_URL),
// silently, so nobody who bought one is locked out. Nothing else is sent there.
const LEGACY_ACCESS_URL = (process.env.LEGACY_ACCESS_URL || process.env.FIXFLOW_URL || 'https://www.residentialrealtors.co.uk').trim().replace(/\/+$/, '');
const PAYWALL = (process.env.DIY_PAYWALL || 'on').trim().toLowerCase() !== 'off';
const BUY_URL = '/buy';
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
  const bought = purchases.access(token);  // a report bought on /buy
  if (bought) return bought;
  if (/^(DIY|FREE)-[A-Z0-9]{4}-[A-Z0-9]{4}$|^SHARED-/i.test(token)) return { valid: false, reason: 'unknown' };   // a deleted or mistyped access code
  const c = accessCache.get(token);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.r;
  try {
    const res = await fetch(LEGACY_ACCESS_URL + '/api/public/diy-access/' + encodeURIComponent(token), { signal: AbortSignal.timeout(8000) });
    const d = await res.json();
    const r = { valid: !!d.valid, reason: d.valid ? '' : (d.reason || 'unknown') };
    accessCache.set(token, { at: Date.now(), r }); if (accessCache.size > 5000) accessCache.clear();
    return r;
  } catch (e) {
    console.error('access check failed:', e.message);
    return c ? c.r : { valid: true, reason: '' };   // the old system unreachable: don't lock out someone with a link
  }
}
// An old link has been used for a report: the old system is told, so it can't be used for another one.
function markLegacyUsed(token){
  accessCache.delete(token);
  fetch(LEGACY_ACCESS_URL + '/api/public/diy-access/' + encodeURIComponent(token) + '/used', { method: 'POST', signal: AbortSignal.timeout(8000) }).catch(e => console.error('mark used failed:', e.message));
}
/* ------------------------------- website ------------------------------- */
// The public website: views/layout.html (header, menu, footer) around a page from views/pages/, styled
// by public/site.css. The home page is what everyone without access sees at "/" (the app is there for
// people with access); the other pages are open to everyone. A link or code that didn't work, or a sent
// message, adds a notice at the top.
const VIEWS = path.join(__dirname, 'views');
const LAYOUT = fs.readFileSync(path.join(VIEWS, 'layout.html'), 'utf8');
const CSS_V = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'public', 'site.css'))).update(fs.readFileSync(path.join(__dirname, 'public', 'site.js'))).digest('hex').slice(0, 10);
const DESC = 'Property inventories, check-in and check-out reports and inspections on your phone, with the PDF report ready instantly. Dated photos, tenant sign-off, side-by-side comparison. Free to start, £29.99 per report.';
const SITE = {
  home: { path: '/', title: 'DIY Inventory · Property inventories and inspections', og: 'DIY Inventory', desc: DESC },
  how: { path: '/how-it-works', file: 'how-it-works', title: 'How it works · DIY Inventory', desc: 'How to do check-ins, inspections and check-outs on your phone with DIY Inventory, step by step.' },
  pricing: { path: '/pricing', file: 'pricing', title: 'Pricing · DIY Inventory', desc: 'One report for £29.99: a check-in, check-out or inspection, done on your phone, with a professional PDF report.' },
  faq: { path: '/faq', file: 'faq', title: 'FAQ · DIY Inventory', desc: 'Answers to common questions about doing your own inventory report with DIY Inventory.' },
  contact: { path: '/contact', file: 'contact', title: 'Contact · DIY Inventory', desc: 'Get in touch with DIY Inventory.' },
  privacy: { path: '/privacy', file: 'privacy', title: 'Privacy · DIY Inventory', desc: 'What DIY Inventory keeps about you and why.' },
};
for (const [key, pg] of Object.entries(SITE)) pg.body = fs.readFileSync(path.join(VIEWS, 'pages', (pg.file || key) + '.html'), 'utf8');
const aiText = t => anthropic ? t.replace(/<!--NOAI-->[\s\S]*?<!--\/NOAI-->/g, '').replace(/<!--\/?AI-->/g, '') : t.replace(/<!--AI-->[\s\S]*?<!--\/AI-->/g, '').replace(/<!--\/?NOAI-->/g, '');
SITE.faq.jsonld = () => faqLd(aiText(SITE.faq.body));
SITE.home.jsonld = base => [{ '@type': 'SoftwareApplication', name: 'DIY Inventory', url: base + '/', applicationCategory: 'BusinessApplication', operatingSystem: 'Any (works in the phone’s web browser)',
  description: DESC, offers: { '@type': 'Offer', price: '29.99', priceCurrency: 'GBP', description: 'One report: £29.99, paid when the finished report is downloaded. Free to start.' }, publisher: { '@id': base + '/#org' } }].concat(faqLd(aiText(SITE.home.body)));
const siteBase = req => { const host = String(req.headers.host || ''); return (/^(localhost|127\.|\[::1\])/.test(host) ? 'http://' : 'https://') + host; };
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// The site's public address: PUBLIC_URL (e.g. your own domain), else Railway's, else this request's host.
const PUBLIC_BASE = (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '')).trim().replace(/\/+$/, '');
const canonicalBase = req => PUBLIC_BASE || siteBase(req);
const VERIFY = [['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION], ['msvalidate.01', process.env.BING_SITE_VERIFICATION]]
  .filter(([, v]) => v && String(v).trim()).map(([n, v]) => '<meta name="' + n + '" content="' + escHtml(String(v).trim()) + '">').join('\n');
// Structured data for search engines, on every page: who we are, plus anything the page adds (pg.jsonld).
function jsonLd(pg, base){
  const org = { '@type': 'Organization', '@id': base + '/#org', name: 'DIY Inventory', url: base + '/', logo: base + '/icons/icon-512.png' };
  const site = { '@type': 'WebSite', '@id': base + '/#site', name: 'DIY Inventory', url: base + '/', publisher: { '@id': base + '/#org' }, inLanguage: 'en' };
  const extra = typeof pg.jsonld === 'function' ? pg.jsonld(base) : (pg.jsonld || []);
  return '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@graph': [org, site].concat(extra) }).replace(/</g, '\\u003c') + '</script>';
}
// Questions and answers in a page's <details> blocks, as FAQPage structured data.
function faqLd(body){
  const qs = [...body.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => ({ q: m[1].replace(/<[^>]+>/g, '').trim(), a: m[2].replace(/<[^>]+>/g, '').trim() }));
  return qs.length ? [{ '@type': 'FAQPage', mainEntity: qs.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) }] : [];
}
function renderPage(pg, req, notice){
  const key = pg.key;
  // The home page's house photo follows the visitor's country (Cloudflare's header; ?country= to preview): a British brick house
  // in the UK, Cobh's houses in Ireland, an American house in the US and Canada, a modern home in Australia / NZ, a villa in the UAE and Gulf, a neutral house elsewhere. No header (robots, local): the UK one.
  const cc = String((req.query && req.query.country) || req.headers['cf-ipcountry'] || 'GB').toUpperCase();
  const heroImg = /^(GB|UK|JE|GG|IM)$/.test(cc) ? 'uk' : cc === 'IE' ? 'ie' : /^(US|CA)$/.test(cc) ? 'us' : /^(AU|NZ)$/.test(cc) ? 'au' : /^(AE|SA|QA|KW|BH|OM)$/.test(cc) ? 'ae' : 'world';
  const fill = t => t.split('{{HERO_IMG}}').join('/img/hero-home-' + heroImg + '.webp').replace(/\{\{PRICE_(gas|eicr|epc)\}\}/g, (m, g) => certs.priceText(g)).split('{{BUY_URL}}').join(escHtml(BUY_URL)).split('{{EXAMPLE_URL}}').join('/example-report').split('{{USD}}').join(fx.usd(29.99));
  // Visitors in the US (Cloudflare's country header) are pointed to the US pages, on every page that isn't already one.
  const usVisitor = !notice && pg.lang !== 'en-US' && String(req.headers['cf-ipcountry'] || '').toUpperCase() === 'US' && !/^\/(account|buy|app)/.test(pg.path || '');
  // People in the US see the price in dollars too (“$39 (£29.99)”); the card is still charged £29.99. Not robots, so pages are indexed in pounds.
  const body = !pg.noUsd && pg.lang !== 'en-US' && fx.usVisitor(req) ? pg.body.replace(/£29\.99(?![\d])/g, fx.usd(29.99) + ' (£29.99)') : pg.body;
  let html = LAYOUT.replace('{{CONTENT}}', () => body)
    .replace('{{NOTICE}}', () => notice ? '<div class="wrap"><div class="notice' + (notice.ok ? ' ok' : '') + '" role="' + (notice.ok ? 'status' : 'alert') + '">' + escHtml(notice.text) + '</div></div>'
      : usVisitor ? '<div class="wrap"><div class="notice ok" role="status">In the US? <a href="/us">Move-in and move-out inspections in all 50 states</a>, with your state’s security deposit law.</div></div>' : '')
    .replace('{{AI_NOTE}}', () => anthropic ? '<p>While you take photos, each one may be sent to an AI service to suggest the item’s condition. It isn’t kept there.</p>' : '');
  for (const k of Object.keys(SITE).concat(['guides', 'checklists', 'certificates', 'landlords', 'account', 'floorplan', 'locations', 'templates', 'report', 'agents', 'buy'])) html = html.split('{{ON_' + k + '}}').join(k === key ? ' on' : '');
  // AI wording only while the AI is switched on (ANTHROPIC_API_KEY), so the site never claims it otherwise.
  html = anthropic ? html.replace(/<!--NOAI-->[\s\S]*?<!--\/NOAI-->/g, '').replace(/<!--\/?AI-->/g, '') : html.replace(/<!--AI-->[\s\S]*?<!--\/AI-->/g, '').replace(/<!--\/?NOAI-->/g, '');
  const base = canonicalBase(req), inAcc = require('./landlords').signedIn(req);   // signed-in landlords see "My dashboard"
  // Functions as replacements, so a "$" in a title (e.g. a landlord's own address) is taken literally. pg.head: a page's own <head> extras.
  if (pg.lang) html = html.replace('<html lang="en-GB">', '<html lang="' + pg.lang + '">');
  return fill(html).replace('{{TITLE}}', () => escHtml(pg.title)).replace('{{OG_TITLE}}', () => escHtml(pg.og || pg.title))
    .replace('{{HEAD_EXTRA}}', () => VERIFY + '\n' + jsonLd(pg, base) + (pg.head ? '\n' + pg.head : ''))
    .split('{{ACCOUNT_LINK_TEXT}}').join(inAcc ? 'My dashboard' : 'Sign in').split('{{ACCOUNT_MENU_TEXT}}').join(inAcc ? 'My landlord dashboard' : 'Sign in (landlords)')
    .split('{{DESCRIPTION}}').join(escHtml(pg.desc)).split('{{BASE}}').join(escHtml(base)).split('{{PATH}}').join(pg.path).split('{{CSS_V}}').join(CSS_V).split('{{USD}}').join(fx.usd(29.99));
}
function sitePage(key, req, notice){ return renderPage(Object.assign({ key }, SITE[key]), req, notice); }
function paywallPage(reason, req){
  const msg = reason === 'used' ? 'This link has already been used for a report.' : reason === 'expired' ? 'This link has expired.' : reason === 'changed' ? 'The access code has changed. Please enter the new one.' : reason === 'tries' ? 'Too many wrong codes. Please wait 15 minutes and try again.' : reason === 'unknown' ? 'We don’t recognise that link or code.' : reason === 'removed' ? 'This link is no longer active. Please ask for a new one.' : reason === 'spent' ? 'All the prepaid reports on this link have been used. Please ask whoever sent it to top it up.' : '';
  return sitePage('home', req, msg ? { text: msg } : null);
}
for (const [key, pg] of Object.entries(SITE)) if (key !== 'home') app.get([pg.path, pg.path + '/'], (req, res) => {
  const notice = key === 'contact' && req.query.sent ? { ok: true, text: 'Thanks, your message has been sent. We’ll get back to you soon.' } : null;
  res.type('html').send(sitePage(key, req, notice));
});
// The example report: a real report made by the app, with real photographs (public/example/).
app.get(['/example-report', '/example-report.pdf'], (req, res) => {
  res.set({ 'Content-Disposition': 'inline; filename="DIY Inventory - example check-in report.pdf"', 'Cache-Control': 'public, max-age=86400' });
  res.type('pdf').sendFile(path.join(__dirname, 'public', 'example', 'example-report.pdf'));
});
// Landlord certificates (Gas Safety, EICR, EPC), booked on /certificates: certs.js.
// Location pages for search (UK cities, towns and London boroughs): locations.js.
const locMount = require('./locations').mount(app, { renderPage, escHtml, REPORTS_DIR: reports.REPORTS_DIR }), locationPaths = locMount.paths;
const certPaths = certs.mountPublic(app, { REPORTS_DIR: reports.REPORTS_DIR, renderPage, esc: escHtml, clip: reports.clip, clientIp: reports.clientIp,
  limiter: reports.limiter, notify: reports.notifyOwner, PUBLIC_BASE, track: analytics.track, deviceName: reports.deviceName }).paths;
// Free landlord area: /landlords, and accounts at /account with properties, certificates, tenancy and reminders: landlords.js.
const landlordPaths = require('./landlords').mount(app, { REPORTS_DIR: reports.REPORTS_DIR, renderPage, clientIp: reports.clientIp, limiter: reports.limiter,
  notify: reports.notifyOwner, isOwner: reports.isOwner, addAdminSection: reports.addAdminSection, PUBLIC_BASE }).paths;
// Floor plans (£9.55): /floor-plan, the drawing tool /floor-plan/create, and paying by card (SumUp or Stripe): payments.js.
// Buying a report (£29.99) on our own page, /buy, with the same card checkout: purchases.js.
const buyPaths = purchases.mount(app, { REPORTS_DIR: reports.REPORTS_DIR, renderPage, clientIp: reports.clientIp, limiter: reports.limiter, notify: reports.notifyOwner,
  track: analytics.track, canonicalBase: siteBase, PUBLIC_BASE, addAdminSection: reports.addAdminSection, addAgentCredits: reports.addAgentCredits, agentByToken: reports.agentByToken, agentDashKey: reports.agentDashKey, agentsAll: reports.agentsAll }).paths;
// For letting agents and landlords with several properties: /agents (packs, calculator, enquiry form): agents.js.
const agentPaths = require('./agents').mount(app, { REPORTS_DIR: reports.REPORTS_DIR, renderPage, clientIp: reports.clientIp, limiter: reports.limiter, notify: reports.notifyOwner,
  isOwner: reports.isOwner, PUBLIC_BASE, addAdminSection: reports.addAdminSection }).paths;
// Search pages for bulk buyers (inventory software for letting agents, landlords' app, tenant self check-in): agentseo.js.
const agentSeo = require('./agentseo').mount(app, { renderPage });
// Each tenant link's private dashboard, /agent/<key>: agentdash.js.
require('./agentdash').mount(app, { reports, renderPage, clientIp: reports.clientIp, limiter: reports.limiter, PUBLIC_BASE, canonicalBase: siteBase });
const floorplanPaths = payments.mount(app, { REPORTS_DIR: reports.REPORTS_DIR, renderPage, isOwner: reports.isOwner, codeAccess: reports.codeAccess, clientIp: reports.clientIp,
  limiter: reports.limiter, notify: reports.notifyOwner, track: analytics.track, canonicalBase: siteBase, PUBLIC_BASE, addAdminSection: reports.addAdminSection }).paths;
// Free landlord property report (EPC, sold prices, crime, flood, council, checklist; leads for the owner): propreport.js.
const reportPaths = require('./propreport').mount(app, { REPORTS_DIR: reports.REPORTS_DIR, renderPage, esc: escHtml, clientIp: reports.clientIp, limiter: reports.limiter,
  notify: reports.notifyOwner, addAdminSection: reports.addAdminSection, isOwner: reports.isOwner, PUBLIC_BASE, track: analytics.track }).paths;
// Mid-term inspections by a contractor, for the owner: a link from /admin, photos sorted into rooms by AI, a PDF report: inspections.js.
require('./inspections').mount(app, { REPORTS_DIR: reports.REPORTS_DIR, isOwner: reports.isOwner, notify: reports.notifyOwner, clientIp: reports.clientIp, limiter: reports.limiter,
  addAdminSection: reports.addAdminSection, PUBLIC_BASE, ai: anthropic ? { client: anthropic, model: ANTHROPIC_MODEL, Anthropic, DEFECTS, CLEANLINESS, extractJson,
    extra: { ...(AI_EFFORT ? { output_config: { effort: 'low' } } : {}), ...(AI_FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}) } } : null });
// Mid-term (routine) inspections: /mid-term-inspection, /us/routine-inspection, and reminders every 3 or 6 months: midterm.js.
const midtermPaths = require('./midterm').mount(app, { REPORTS_DIR: reports.REPORTS_DIR, renderPage, esc: escHtml, clientIp: reports.clientIp, limiter: reports.limiter,
  notify: reports.notifyOwner, PUBLIC_BASE, addAdminSection: reports.addAdminSection }).paths;
// Check-in vs check-out compared by AI (campaign pages /check-out-comparison, /us/move-out-comparison): compare.js.
const comparePaths = require('./compare').mount(app, { renderPage, esc: escHtml, aiOn: () => !!anthropic }).paths;
// Guides, room checklists (made from the app's own checklists), sitemap, robots.txt and IndexNow: seo.js.
require('./seo').mount(app, { ROOT: __dirname, REPORTS_DIR: reports.REPORTS_DIR, renderPage, canonicalBase, PUBLIC_BASE, escHtml,
  sitePaths: Object.values(SITE).map(pg => pg.path).concat(certPaths, landlordPaths, buyPaths, agentPaths, agentSeo.paths, floorplanPaths, locationPaths, reportPaths, midtermPaths, anthropic ? comparePaths : []), siteBodies: Object.values(SITE).map(pg => pg.body).concat(locMount.bodies),
  faqBody: () => aiText(SITE.faq.body), aiOn: () => !!anthropic });

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
  if (req.path !== '/' && !/^\/app\/?$/.test(req.path)) return next();   // anything else is a real page or a 404
  res.set('Cache-Control', 'public, max-age=3600').type('html').send(sitePage('home', req));
});

if (PAYWALL) {
  // New reports need a valid link. AI condition suggestions are part of the free start too, within limits
  // (per person per day, and for the whole site per day: AI_FREE_DAILY, default 3000 photos).
  app.use(['/api/assess', '/api/reports'], async (req, res, next) => {
    if (req.method !== 'POST' || (req.path !== '/' && req.baseUrl === '/api/reports')) return next();
    if (reports.isOwner(req)) return next(); // the owner (signed in to /admin) needs no paid link
    // An edited copy of a report already paid for replaces it in place: no new payment, nothing marked used.
    if (req.baseUrl === '/api/reports') { let m = {}; try { m = JSON.parse(decodeURIComponent(String(req.headers['x-report-meta'] || ''))); } catch (e) {} if (reports.editAllowed(m)) return next(); }
    const token = cookieToken(req), a = await checkAccess(token);
    if (!a.valid && req.baseUrl === '/api/assess') {
      if (!freeAssess.allow(req)) return res.status(429).json({ error: 'Automatic suggestions are busy right now. Choose the condition yourself.' });
      return next();
    }
    // A finished report that isn't paid for yet is still sent to the owner (stored as not paid; unlocks nothing).
    if (!a.valid && req.baseUrl === '/api/reports' && req.headers['x-report-unpaid'] === '1') return next();
    if (!a.valid) return res.status(402).json({ error: a.reason === 'used' ? 'This access link has already been used for a report.' : 'You need a paid access link to use DIY Inventory.', buy: BUY_URL });
    if (req.baseUrl === '/api/reports') res.on('finish', () => {
      let m = {}; try { m = JSON.parse(decodeURIComponent(String(req.headers['x-report-meta'] || ''))); } catch (e) {}
      // A purchase is spent by its report even when the phone's PDF replaces one made from the backup (200); marking is once only.
      if (res.statusCode === 200 && purchases.isToken(token)) { purchases.markUsed(token, m.address); return; }
      if (res.statusCode !== 201) return;
      if (reports.codeAccess(token)) { reports.useCode(token, m.address, req); return; }
      if (purchases.isToken(token)) { purchases.markUsed(token, m.address); return; }
      markLegacyUsed(token);
    });
    next();
  });
  // "/" is always the website's home page, for everyone. The app is at /app: free to start (payment is
  // asked for when the report is finished: /api/access). A paid link (/?access=TOKEN) or code sets the
  // cookie and goes on to /app.
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' || /^\/(api|admin|p|icons|img|sign|report)(\/|$)/.test(req.path) || /\.(png|svg|ico|webmanifest|js|css|json|jpg|webp|pdf)$/i.test(req.path)) return next();
    const isRoot = req.path === '/';
    if (isRoot && req.query.from && !req.query.access) return res.redirect(302, '/app?from=' + encodeURIComponent(String(req.query.from).slice(0, 64)) + (req.query.start === 'inspection' ? '&start=inspection' : ''));   // "start from this report" links (and mid-term inspection links)
    // A tenant's check-in link goes straight to a check-in; an agency can add the property (&address=…) to fill it in.
    // A tenant's check-out link (&start=checkout, from the agency's moving-out email) opens a check-out the same way.
    const startK = ['checkin', 'checkout', 'inspection'].includes(req.query.start) ? req.query.start : '';
    const addrQ = startK && typeof req.query.address === 'string' && req.query.address.trim() ? '&address=' + encodeURIComponent(req.query.address.replace(/\s+/g, ' ').trim().slice(0, 200)) : '';
    const fromQ = startK && /^[a-f0-9]{32}$/i.test(String(req.query.from || '')) ? '&from=' + String(req.query.from).toLowerCase() : '';   // a mid-term link based on an earlier report
    const startQ = startK ? '?start=' + startK + addrQ + fromQ : '';
    if (reports.isOwner(req)) return isRoot ? (req.query.access ? res.redirect(302, '/app' + startQ) : res.type('html').send(sitePage('home', req))) : next(); // the owner (signed in to /admin) needs no paid link
    const isApp = /^\/app\/?$/.test(req.path);
    if (isApp && !req.query.access) return next();
    const raw = String(req.query.access || '').trim();
    if (!isRoot && !isApp && !raw) return next();   // other addresses: their own page, or a 404
    if (raw && codeTries.blocked(req)) return res.status(429).type('html').send(paywallPage('tries', req));
    const q = reports.canonicalCode(raw) || (TOKEN_RE.test(raw) ? raw : ''), token = q || cookieToken(req);
    if (raw && !q) { codeTries.wrong(req); return res.status(402).type('html').send(paywallPage('unknown', req)); }
    const a = await checkAccess(token);
    if (!(a.valid || (a.reason === 'used' && token === cookieToken(req)))) {
      if (!q && isApp) return next();
      const why = q || token ? a.reason : 'none'; return res.status(why === 'none' ? 200 : 402).type('html').send(paywallPage(why, req)); }
    if (q && reports.codeAccess(q) && q !== cookieToken(req)) reports.codeLogin(req, q);   // tell the owner on /admin
    if (q) { res.setHeader('Set-Cookie', 'diy_access=' + q + '; Path=/; Max-Age=' + 200 * 86400 + '; HttpOnly; Secure; SameSite=Lax'); return res.redirect(302, isRoot ? '/app' + startQ : req.path); }
    if (isRoot) return res.type('html').send(sitePage('home', req));
    next();
  });
}

// Free to start, pay at the end: whether this browser may download and send a finished report, and
// unlocking it with the report link from /buy (or its token, or an access code) pasted in the app.
app.get('/api/access', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!PAYWALL || reports.isOwner(req)) return res.json({ access: true, buy: BUY_URL, owner: reports.isOwner(req) });
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
    return res.status(402).json({ error: a.reason === 'used' ? 'That link has already been used for another report.' : a.reason === 'expired' ? 'That link has expired.' : a.reason === 'changed' ? 'That access code has changed.' : a.reason === 'removed' ? 'That link is no longer active.' : a.reason === 'spent' ? 'All the prepaid reports on that link have been used.' : 'We don’t recognise that link or code. Check it and try again.' });
  }
  if (reports.codeAccess(q) && q !== cookieToken(req)) reports.codeLogin(req, q);
  res.setHeader('Set-Cookie', 'diy_access=' + q + '; Path=/; Max-Age=' + 200 * 86400 + '; HttpOnly; Secure; SameSite=Lax');
  res.json({ ok: true });
});

reports.mount(app);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ----------------------------- client ----------------------------- */
const PUBLIC = path.join(__dirname, 'public');
// The app's page is for people, not search results (its address, /app, is also kept out in robots.txt).
app.use(express.static(PUBLIC, { index: 'index.html', setHeaders: (res, file) => {
  if (file === path.join(PUBLIC, 'index.html')) res.set('X-Robots-Tag', 'noindex');
  else if (/\.(jpe?g|png|webp|svg|woff2?)$/i.test(file)) res.set('Cache-Control', 'public, max-age=604800');   // pictures: a week (faster repeat visits)
} }));
// The app at /app (and / when the paywall is off); any other address is a real 404, so search engines
// don't index made-up addresses as copies of the app.
const NOT_FOUND = { key: '', path: '/404', title: 'Page not found · DIY Inventory', og: 'Page not found', desc: 'This page doesn’t exist. Try our guides, free templates and checklists, or start a report.', head: '<meta name="robots" content="noindex">',
  body: `<div class="page-head"><div class="wrap"><span class="kicker">404</span><h1>We can’t find that page</h1><p>The link may be old or mistyped. These might help:</p></div></div>
  <section class="tight"><div class="wrap"><div class="card prose"><ul>
    <li><a href="/app">Start an inventory, check-in or check-out (free to start)</a></li>
    <li><a href="/guides">Guides for landlords and tenants</a></li>
    <li><a href="/inventory-template">Free inventory template (PDF and Word)</a></li>
    <li><a href="/checklists">Room-by-room checklists</a></li>
    <li><a href="/property-report">Free property report for any UK postcode</a></li>
    <li><a href="/landlords">Free landlord dashboard</a></li>
    <li><a href="/pricing">Pricing</a> · <a href="/faq">FAQ</a> · <a href="/contact">Contact</a></li>
  </ul><p><a class="btn" href="/">Go to the home page</a></p></div></div></section>` };
app.use((req, res) => {
  if (req.path === '/' || /^\/app(\/|$)/.test(req.path)) { res.set('X-Robots-Tag', 'noindex'); return res.sendFile(path.join(PUBLIC, 'index.html')); }
  if ((req.method === 'GET' || req.method === 'HEAD') && req.accepts('html')) return res.status(404).type('html').send(renderPage(NOT_FOUND, req));
  res.status(404).type('text').send('Not found');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Check-in report app listening on port ${PORT} (AI ${anthropic ? 'on, ' + ANTHROPIC_MODEL : 'off'}, address lookup ${address.provider() || 'off'})`);
});
