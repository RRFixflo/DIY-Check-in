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

/* ----------------------------- /api/postcode ----------------------------- */
const POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/;

function formatAddress(a){
  const lines = [a.sub_building_name, a.building_name, a.building_number && a.thoroughfare ? `${a.building_number} ${a.thoroughfare}` : (a.building_number || a.thoroughfare), a.line_3, a.locality, a.town_or_city]
    .map(s => (s || '').trim()).filter(Boolean);
  return lines.join(', ');
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
        if (addresses.length) return res.json({ postcode: data.postcode || pc, addresses });
      } else if (r.status !== 404) {
        console.error('getAddress.io returned', r.status);
      }
    }

    // Fallback: postcodes.io confirms the postcode exists and gives the area.
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
    if (r.status === 404) return res.status(404).json({ error: 'That postcode was not found.' });
    if (!r.ok) return res.status(502).json({ error: 'Address lookup is unavailable.' });
    const { result } = await r.json();
    res.json({
      postcode: result.postcode,
      ward: result.admin_ward || '',
      district: result.admin_district || '',
      addresses: []
    });
  } catch (err) {
    console.error('postcode lookup failed', err);
    res.status(502).json({ error: 'Address lookup is unavailable.' });
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
