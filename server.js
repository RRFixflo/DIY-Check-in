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
const GETADDRESS_API_KEY = (process.env.GETADDRESS_API_KEY || '').trim().replace(/^["']+|["']+$/g, '').trim();
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
// Free fallbacks: postcodes.io (postcode check) and OpenStreetMap via Overpass (streets).
const UA = { 'User-Agent': 'self-check-in-report (address lookup)' };

function tidyPostcode(pc){
  const s = String(pc || '').toUpperCase().replace(/\s+/g, '');
  return FULL_PC_RE.test(s) ? s.slice(0, -3) + ' ' + s.slice(-3) : '';
}

async function getJson(url, opts = {}){
  const { timeout = 5000, ...rest } = opts;
  const r = await fetch(url, { ...rest, headers: { ...UA, ...(rest.headers || {}) }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) { const e = new Error(`${url.split('?')[0]} returned ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

/* ----------------------------- /api/postcode ----------------------------- */
function formatAddress(a){
  const lines = [a.sub_building_name, a.building_name, a.building_number && a.thoroughfare ? `${a.building_number} ${a.thoroughfare}` : (a.building_number || a.thoroughfare), a.line_3, a.locality, a.town_or_city]
    .map(s => (s || '').trim()).filter(Boolean);
  return lines.join(', ');
}

// Addresses and streets near a postcode from OpenStreetMap, via Overpass (both public mirrors are asked
// at once and the first answer wins). Only houses tagged with this exact postcode are listed: untagged
// neighbours are often in a different postcode, and a wrong address must not reach a signed report.
// OSM tags few UK houses with a postcode, so the streets around the postcode are returned for
// "pick your street, then type the number".
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const STREET_TYPES = new Set(['residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'living_street', 'pedestrian', 'trunk', 'road']);
const postcodeCache = new Map();

async function overpass(query){
  const body = 'data=' + encodeURIComponent(query);
  return Promise.any(OVERPASS.map(url => getJson(url, { method: 'POST', timeout: 9000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })));
}

async function osmNearPostcode(lat, lon, pc){
  if (postcodeCache.has(pc)) return postcodeCache.get(pc);
  const query = `[out:json][timeout:8];(nwr(around:150,${lat},${lon})["addr:housenumber"];way(around:120,${lat},${lon})["highway"]["name"];);out tags center 400;`;
  let data;
  try { data = await overpass(query); }
  catch (err) {
    console.error(`overpass failed for ${pc}:`, (err.errors || [err]).map(e => e.name === 'TimeoutError' ? 'timeout' : e.message).join('; '));
    return { addresses: [], streets: [] };
  }

  const seen = new Set();
  const exact = [], near = [], streetNames = new Set();
  let otherPostcode = 0, noStreet = 0;
  for (const e of data.elements || []) {
    const t = e.tags || {};
    if (t.highway) { if (STREET_TYPES.has(t.highway)) streetNames.add(t.name); continue; }
    const num = t['addr:housenumber'], street = t['addr:street'] || t['addr:place'];
    if (!num || !street) { noStreet++; continue; }
    const apc = tidyPostcode(t['addr:postcode']);
    if (apc && apc !== pc) { otherPostcode++; continue; }
    const line = [t['addr:housename'], `${num} ${street}`, t['addr:city']].map(x => (x || '').trim()).filter(Boolean).join(', ');
    if (seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    (apc === pc ? exact : near).push({ line, street, num: String(num) });
  }
  const byStreetThenNumber = (x, y) => x.street.localeCompare(y.street) || ((parseInt(x.num, 10) || 0) - (parseInt(y.num, 10) || 0)) || x.num.localeCompare(y.num);
  const addresses = exact.sort(byStreetThenNumber).slice(0, 40).map(x => `${x.line}, ${pc}`);
  const streets = [...streetNames].sort().slice(0, 12).map(n => `${n}, ${pc}`);
  console.log(`postcode ${pc}: ${exact.length} addresses tagged with it (listed), ${near.length} untagged nearby and ${otherPostcode} with other postcodes (not listed), ${noStreet} without street; ${streets.length} streets`);
  const result = { addresses, streets };
  if (postcodeCache.size > 1000) postcodeCache.delete(postcodeCache.keys().next().value);
  postcodeCache.set(pc, result);
  return result;
}

/* getAddress.io (Royal Mail PAF), used when GETADDRESS_API_KEY is set. The key stays on the server. */
const GA = 'https://api.getAddress.io';
const GA_TEMPLATE = '{formatted_address}{postcode,, }{postcode}';
const gaKey = () => 'api-key=' + encodeURIComponent(GETADDRESS_API_KEY);

// Every address at a postcode: Autocomplete with the postcode as the term and all=true (1 look-up).
// The older Find endpoint is tried if Autocomplete fails, for accounts that still have it.
const gaPostcodeUrls = pc => [
  `${GA}/autocomplete/${encodeURIComponent(pc)}?${gaKey()}&all=true&show-postcode=true&template=${encodeURIComponent(GA_TEMPLATE)}`,
  `${GA}/autocomplete/${encodeURIComponent(pc)}?${gaKey()}&all=true`
];
async function getAddressPostcode(pc){
  for (const url of gaPostcodeUrls(pc)) {
    try {
      const data = await getJson(url, { timeout: 6000 });
      const addresses = (data.suggestions || []).map(x => String(x.address || '').trim()).filter(Boolean)
        .map(a => tidyPostcode((a.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*$/i) || [])[1]) ? a : `${a}, ${pc}`);
      if (addresses.length) return addresses;
    } catch (err) { console.error('getAddress autocomplete failed:', err.message); }
  }
  try {
    const data = await getJson(`${GA}/find/${encodeURIComponent(pc)}?expand=true&${gaKey()}`, { timeout: 6000 });
    return (data.addresses || []).map(a => formatAddress(a) + ', ' + (data.postcode || pc));
  } catch (err) { if (err.status !== 404) console.error('getAddress find failed:', err.message); }
  return [];
}

app.get('/api/postcode/:pc', async (req, res) => {
  const pc = String(req.params.pc || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!POSTCODE_RE.test(pc)) return res.status(400).json({ error: 'Enter a full UK postcode, e.g. SE16 4JU.' });

  try {
    if (GETADDRESS_API_KEY) {
      const tidy = tidyPostcode(pc);
      const addresses = await getAddressPostcode(tidy);
      console.log(`postcode ${tidy}: ${addresses.length} getAddress.io addresses`);
      if (addresses.length) return res.json({ postcode: tidy, addresses, streets: [], source: 'getaddress' });
    }

    // Free route: postcodes.io confirms the postcode and gives its position, then OpenStreetMap lists nearby addresses.
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, { signal: AbortSignal.timeout(5000) });
    if (r.status === 404) return res.status(404).json({ error: 'That postcode was not found.' });
    if (!r.ok) return res.status(502).json({ error: 'Address lookup is unavailable.' });
    const { result } = await r.json();
    const osm = result.latitude != null && result.longitude != null
      ? await osmNearPostcode(result.latitude, result.longitude, result.postcode)
      : { addresses: [], streets: [] };
    res.json({
      postcode: result.postcode,
      ward: result.admin_ward || '',
      district: result.admin_district || '',
      addresses: osm.addresses,
      streets: osm.streets,
      source: osm.addresses.length || osm.streets.length ? 'openstreetmap' : ''
    });
  } catch (err) {
    console.error('postcode lookup failed', err.name === 'TimeoutError' ? 'timeout' : err);
    res.status(502).json({ error: 'Address lookup is unavailable.' });
  }
});

/* ----------------------------- /api/diag/address ----------------------------- */
// Shows what getAddress.io returns for a postcode, to diagnose the lookup without server logs.
// Never includes the key. Costs up to 2 look-ups, so it only runs when opened.
app.get('/api/diag/address', async (req, res) => {
  const pc = tidyPostcode(req.query.pc || 'SE1 6AD') || 'SE1 6AD';
  const out = { key_set: !!GETADDRESS_API_KEY, key_length: GETADDRESS_API_KEY.length, postcode: pc, attempts: [] };
  if (!GETADDRESS_API_KEY) return res.json(out);
  // Each variant is tried in turn (the partial-address search costs no look-ups), so the first working form shows up.
  const tries = gaPostcodeUrls(pc).map(url => ({ url, name: '/autocomplete/{postcode}' + (url.includes('template=') ? ' all=true + template' : ' all=true') }))
    .concat([
      { url: `${GA}/autocomplete/${encodeURIComponent(pc)}?${gaKey()}`, name: '/autocomplete/{postcode} (no options)' },
      { url: `${GA}/autocomplete/${encodeURIComponent('10 Downing Street')}?${gaKey()}`, name: '/autocomplete/10 Downing Street (free search)' },
      { url: `${GA}/autocomplete/${encodeURIComponent(pc)}?${gaKey()}`, name: 'POST /autocomplete/{postcode} {all:true}', method: 'POST', body: JSON.stringify({ all: true }) },
      { url: `${GA}/find/${encodeURIComponent(pc)}?${gaKey()}`, name: '/find/{postcode}' }
    ]);
  out.key_starts = GETADDRESS_API_KEY.slice(0, 2);
  out.server_region = process.env.RAILWAY_REPLICA_REGION || '';
  for (const { url, name, method, body: reqBody } of tries) {
    try {
      const r = await fetch(url, { method: method || 'GET', headers: { ...UA, ...(reqBody ? { 'Content-Type': 'application/json' } : {}) }, body: reqBody, signal: AbortSignal.timeout(6000) });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch (e) { body = null; }
      const list = body && (body.suggestions || body.addresses);
      out.attempts.push({ call: name, http_status: r.status, results: Array.isArray(list) ? list.length : null,
        sample: Array.isArray(list) ? list.slice(0, 3).map(x => x.address || x) : undefined,
        message: r.ok ? undefined : (body && (body.Message || body.message)) || text.slice(0, 200) });

    } catch (err) {
      out.attempts.push({ call: name, error: err.name === 'TimeoutError' ? 'timeout' : err.message });
    }
  }
  res.json(out);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ----------------------------- client ----------------------------- */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { index: 'index.html' }));
app.use((req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Check-in report app listening on port ${PORT} (AI ${anthropic ? 'on, ' + ANTHROPIC_MODEL : 'off'}, address lookup ${GETADDRESS_API_KEY ? 'full' : 'postcode-only'})`);
});
