// Self check-in report server.
// Serves the single-file client in public/ and three small API endpoints:
//   GET  /api/status          what the server can do (AI assessment, address lookup)
//   POST /api/assess          rate one photo of a checklist item
//   GET  /api/postcode/:pc    validate a UK postcode and list addresses where possible
// Nothing is stored on the server. Photos are assessed and discarded.
const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const GETADDRESS_API_KEY = (process.env.GETADDRESS_API_KEY || '').trim();
const ANTHROPIC_MODEL = (process.env.ANTHROPIC_MODEL || '').trim() || 'claude-haiku-4-5-20251001';

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

app.get(['/health', '/healthz'], (req, res) => res.json({ ok: true }));

/* ----------------------------- /api/status ----------------------------- */
app.get('/api/status', (req, res) => {
  res.json({
    ai: !!anthropic,
    reason: anthropic ? '' : 'ANTHROPIC_API_KEY is not set on the server',
    addressLookup: GETADDRESS_API_KEY ? 'full' : 'postcode-only'
  });
});

/* ----------------------------- /api/assess ----------------------------- */
const CONDITIONS = ['new', 'good', 'fair', 'poor'];

const ASSESS_SYSTEM = [
  'You assess photographs taken by a tenant for a UK residential inventory and check-in report.',
  'You are told which checklist item and room the photo is meant to show.',
  'Reply with a single JSON object and nothing else, with exactly these keys:',
  '  "matches": true if the photo plausibly shows the named item, false if it clearly shows something else or is unusable,',
  '  "note": if matches is false, one short sentence telling the tenant what to retake, otherwise an empty string,',
  '  "condition": one of "new", "good", "fair", "poor",',
  '  "observation": one factual sentence describing the visible condition (marks, scuffs, stains, damage, wear), written for an inventory clerk.',
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
      max_tokens: 400,
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
      observation: typeof out.observation === 'string' ? out.observation.slice(0, 500) : ''
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

/* ----------------------------- address data helpers ----------------------------- */
const POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/;
const FULL_PC_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;
// OpenStreetMap data via Photon (free, no key) and postcodes.io (free, no key).
const PHOTON = 'https://photon.komoot.io';
const UK_BBOX = '-8.7,49.8,1.9,60.9';
const UA = { 'User-Agent': 'self-check-in-report (address lookup)' };

function tidyPostcode(pc){
  const s = String(pc || '').toUpperCase().replace(/\s+/g, '');
  return FULL_PC_RE.test(s) ? s.slice(0, -3) + ' ' + s.slice(-3) : '';
}

async function getJson(url, opts = {}){
  const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) { const e = new Error(`${url.split('?')[0]} returned ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

function photonLine(p){
  const street = p.street && p.housenumber ? `${p.housenumber} ${p.street}` : (p.street || '');
  const name = p.name && p.name !== p.street ? p.name : '';
  const parts = [name, street, p.locality || p.district, p.city].map(s => (s || '').trim()).filter(Boolean);
  return parts.filter((s, i) => parts.indexOf(s) === i).join(', ');
}

// Nearest postcode for each [lon, lat], one postcodes.io call for the lot. Missing entries come back ''.
async function nearestPostcodes(points){
  if (!points.length) return [];
  const data = await getJson('https://api.postcodes.io/postcodes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geolocations: points.map(([lon, lat]) => ({ longitude: lon, latitude: lat, radius: 500, limit: 1 })) })
  });
  return (data.result || []).map(x => (x && x.result && x.result[0] && tidyPostcode(x.result[0].postcode)) || '');
}

/* ----------------------------- /api/postcode ----------------------------- */
function formatAddress(a){
  const lines = [a.sub_building_name, a.building_name, a.building_number && a.thoroughfare ? `${a.building_number} ${a.thoroughfare}` : (a.building_number || a.thoroughfare), a.line_3, a.locality, a.town_or_city]
    .map(s => (s || '').trim()).filter(Boolean);
  return lines.join(', ');
}

// Street addresses near a postcode from OpenStreetMap. Addresses tagged with this exact postcode come
// first; untagged neighbours are included because OSM rarely tags UK addresses with a postcode.
async function osmAddressesNear(lat, lon, pc){
  const data = await getJson(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&radius=0.2&limit=50&lang=en`);
  const seen = new Set();
  const exact = [], near = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (!p.housenumber || !p.street) continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== 'GB') continue;
    const fpc = tidyPostcode(p.postcode);
    if (fpc && fpc !== pc) continue;
    const line = photonLine(p);
    const id = line.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    (fpc === pc ? exact : near).push({ line, street: p.street, num: p.housenumber });
  }
  const byStreetThenNumber = (a, b) => a.street.localeCompare(b.street) || (parseInt(a.num, 10) - parseInt(b.num, 10)) || a.num.localeCompare(b.num);
  return exact.sort(byStreetThenNumber).concat(near.sort(byStreetThenNumber)).slice(0, 40).map(a => `${a.line}, ${pc}`);
}

app.get('/api/postcode/:pc', async (req, res) => {
  const pc = String(req.params.pc || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!POSTCODE_RE.test(pc)) return res.status(400).json({ error: 'Enter a full UK postcode, e.g. SE16 4JU.' });

  try {
    if (GETADDRESS_API_KEY) {
      const url = `https://api.getAddress.io/find/${encodeURIComponent(pc)}?expand=true&api-key=${encodeURIComponent(GETADDRESS_API_KEY)}`;
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        const addresses = (data.addresses || []).map(a => formatAddress(a) + ', ' + (data.postcode || pc)).filter(Boolean);
        if (addresses.length) return res.json({ postcode: data.postcode || pc, addresses, source: 'getaddress' });
      } else if (r.status !== 404) {
        console.error('getAddress.io returned', r.status);
      }
    }

    // Free route: postcodes.io confirms the postcode and gives its position, then OpenStreetMap lists nearby addresses.
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, { signal: AbortSignal.timeout(5000) });
    if (r.status === 404) return res.status(404).json({ error: 'That postcode was not found.' });
    if (!r.ok) return res.status(502).json({ error: 'Address lookup is unavailable.' });
    const { result } = await r.json();
    let addresses = [];
    if (result.latitude != null && result.longitude != null) {
      try { addresses = await osmAddressesNear(result.latitude, result.longitude, result.postcode); }
      catch (err) { console.error('osm addresses near', result.postcode, 'failed:', err.message); }
    }
    console.log(`postcode ${result.postcode}: ${addresses.length} OpenStreetMap addresses`);
    res.json({
      postcode: result.postcode,
      ward: result.admin_ward || '',
      district: result.admin_district || '',
      addresses,
      source: addresses.length ? 'openstreetmap' : ''
    });
  } catch (err) {
    console.error('postcode lookup failed', err.name === 'TimeoutError' ? 'timeout' : err);
    res.status(502).json({ error: 'Address lookup is unavailable.' });
  }
});

/* ----------------------------- /api/address-search ----------------------------- */
// Address suggestions as the tenant types, from OpenStreetMap via Photon. UK only. Results without a
// postcode (most UK OSM data) get the nearest postcode to their position from postcodes.io.
const searchCache = new Map();

app.get('/api/address-search', async (req, res) => {
  const q = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (q.length < 3) return res.json({ results: [] });

  const key = q.toLowerCase();
  if (searchCache.has(key)) return res.json({ results: searchCache.get(key) });

  try {
    const data = await getJson(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&bbox=${UK_BBOX}`);
    const candidates = [];
    for (const f of data.features || []) {
      const p = f.properties || {};
      if (p.countrycode && p.countrycode.toUpperCase() !== 'GB') continue;
      if (['country', 'state', 'county', 'city', 'district'].includes(p.type)) continue;
      const line = photonLine(p);
      const coords = f.geometry && f.geometry.coordinates;
      if (!line) continue;
      candidates.push({ line, postcode: tidyPostcode(p.postcode), coords: Array.isArray(coords) ? coords : null });
    }

    const missing = candidates.filter(c => !c.postcode && c.coords);
    let filled = 0;
    if (missing.length) {
      try {
        const pcs = await nearestPostcodes(missing.map(c => c.coords));
        missing.forEach((c, i) => { if (pcs[i]) { c.postcode = pcs[i]; filled++; } });
      } catch (err) { console.error('nearest postcodes failed:', err.message); }
    }

    const seen = new Set();
    const results = [];
    for (const c of candidates) {
      if (!c.postcode) continue;
      const id = (c.line + '|' + c.postcode).toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({ line: c.line, postcode: c.postcode });
      if (results.length === 6) break;
    }
    console.log(`address search "${q}": ${(data.features || []).length} OSM matches, ${candidates.length} usable, ${filled} postcodes from position, ${results.length} returned`);
    if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(key, results);
    res.json({ results });
  } catch (err) {
    console.error('address search failed:', err.name === 'TimeoutError' ? 'timeout' : err.message);
    res.status(502).json({ error: 'Address search is unavailable.' });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ----------------------------- client ----------------------------- */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { index: 'index.html' }));
app.use((req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Check-in report app listening on port ${PORT} (AI ${anthropic ? 'on, ' + ANTHROPIC_MODEL : 'off'}, address lookup ${GETADDRESS_API_KEY ? 'full' : 'postcode-only'})`);
});
