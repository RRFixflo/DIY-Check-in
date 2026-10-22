// UK postcode → the addresses at that postcode: Royal Mail's list from a paid provider, or the free EPC register.
// The key stays on the server.
//   IDEAL_POSTCODES_KEY  Ideal Postcodes (preferred): one call lists every address with its parts.
//   GETADDRESS_API_KEY   getAddress.io: Autocomplete lists the addresses (labels + ids), /get/:id gives the parts.
//   GET /api/address/:postcode   { ok, provider, postcode, addresses: [{ id, label, houseNo?, building?, road?, town?, postcode? }] }
//   GET /api/address/item/:id    { ok, provider, address: { id, label, houseNo, building, road, town, postcode } }
// Without a key: { ok: false, reason: 'not-configured' }, and the forms show plain address fields.
// ADDRESS_API_BASE (tests only) points both providers at a local mock server.
const clean = v => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
const IDEAL_KEY = clean(process.env.IDEAL_POSTCODES_KEY);
const GA_KEY = clean(process.env.GETADDRESS_API_KEY);
// The EPC register (England & Wales, free: the same EPC_API_EMAIL / EPC_API_KEY as the landlord dashboard)
// lists every home at a postcode that has had an EPC since 2008: nearly every rented home, since one is needed
// to let it. It is used when there's no Ideal Postcodes key; getAddress.io, if set, fills in when it finds none.
const EPC_BASE = clean(process.env.EPC_API_BASE).replace(/\/+$/, '') || 'https://epc.opendatacommunities.org/api/v1';
const EPC_AUTH = clean(process.env.EPC_API_TOKEN) ? 'Bearer ' + clean(process.env.EPC_API_TOKEN)
  : clean(process.env.EPC_API_EMAIL) && clean(process.env.EPC_API_KEY) ? 'Basic ' + Buffer.from(clean(process.env.EPC_API_EMAIL) + ':' + clean(process.env.EPC_API_KEY)).toString('base64') : '';
const CHAIN = [IDEAL_KEY && 'ideal-postcodes', EPC_AUTH && 'epc', GA_KEY && 'getaddress'].filter(Boolean);
const PROVIDER = CHAIN[0] || '';
const TEST_BASE = clean(process.env.ADDRESS_API_BASE).replace(/\/+$/, '');
const IDEAL_BASE = TEST_BASE || 'https://api.ideal-postcodes.co.uk';
const GA_BASE = TEST_BASE || 'https://api.getaddress.io';
const TIMEOUT = 8000, DAY = 24 * 3600 * 1000;

const FULL_PC_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
function tidyPostcode(pc){
  const s = String(pc || '').toUpperCase().replace(/\s+/g, '');
  return FULL_PC_RE.test(s) ? s.slice(0, -3) + ' ' + s.slice(-3) : '';
}

// PAF towns come in capitals ("LONDON", "STOKE-ON-TRENT"): shown as "London", "Stoke-on-Trent".
const SMALL = new Set(['on', 'upon', 'under', 'in', 'by', 'the', 'and', 'of', 'le', 'en', 'cum', 'de', 'sur']);
function titleTown(s){
  s = String(s || '').trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/(\s+|-)/).map((w, i) => (i > 0 && SMALL.has(w)) || !/[a-z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1)).join('')
    .replace(/\b(Mc|O')([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

// PAF parts → the app's fields, so that the app's streetLineFrom() reads them back in UK order:
//   Flat 4 / 12 High Street        → houseNo "Flat 4", road "12 High Street"           → "Flat 4, 12 High Street"
//   Flat 4 / Brownlow House / 50 George Row → houseNo "Flat 4", building "Brownlow House", road "50 George Row"
//   3 / Dudley Court / Harper Road → houseNo "3", building "Dudley Court", road "Harper Road" → "3 Dudley Court, Harper Road"
//   Rose Cottage / Mill Lane       → building "Rose Cottage", road "Mill Lane"         → "Rose Cottage, Mill Lane"
//   12 / High Street               → houseNo "12", road "High Street"                  → "12 High Street"
const NUM_RE = /^\d+[A-Z]?(\s*[-–]\s*\d+[A-Z]?)?$/i;
const FLAT_RE = /^(flat|apartment|apt|unit|studio|room|maisonette)\b/i;
function normalise(a){
  const t = k => String(a[k] == null ? '' : a[k]).trim();
  let sub = t('sub_building_name') || t('sub_building_number'), bname = t('building_name'), num = t('building_number');
  const org = t('organisation_name');
  let road = [t('dependant_thoroughfare') || t('dependent_thoroughfare'), t('thoroughfare')].filter(Boolean).join(', ');
  if (bname && !num && NUM_RE.test(bname)) { num = bname; bname = ''; }     // "12A" is a number, not a name
  let houseNo = '', building = '';
  if (sub) {
    if (FLAT_RE.test(sub)) houseNo = sub;
    else if (NUM_RE.test(sub)) houseNo = bname ? sub : 'Flat ' + sub;       // "3" of Dudley Court → "3 Dudley Court"
    else bname = [sub, bname].filter(Boolean).join(', ');                  // "Ground Floor Flat", "Annexe"…
    building = bname;
    if (num) road = road ? num + ' ' + road : num;
  } else if (bname) {
    const m = /^(\d+[A-Z]?)\s+(\D.*)$/i.exec(bname);                        // "3 Dudley Court"
    if (m && !num) { houseNo = m[1]; building = m[2]; }
    else { building = bname; if (num) road = road ? num + ' ' + road : num; }
  } else {
    houseNo = num;
  }
  if (org) {
    // "Acme Ltd, 10 High Street": the number stays with the road, not before the company name.
    if (!building && houseNo && !FLAT_RE.test(houseNo)) { road = road ? houseNo + ' ' + road : houseNo; houseNo = ''; }
    building = [org, building].filter(Boolean).join(', ');
  }
  if (!road && !building && houseNo) { road = houseNo; houseNo = ''; }
  const town = [t('dependant_locality') || t('dependent_locality') || t('locality'), t('post_town') || t('town_or_city')].filter(Boolean).map(titleTown)
    .filter((x, i, all) => all.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(', ');
  return { houseNo, building, road, town, postcode: tidyPostcode(t('postcode')) };
}
// An EPC register address ("Flat 2", "14 Albion Road", "Stoke Newington") split into the app's fields: the
// street line is the first part that looks like a street (else the last part), parts after it are the
// locality, and parts before it are the flat and the building.
const STREET_RE = /\b(road|street|lane|avenue|close|way|drive|gardens|grove|place|terrace|crescent|hill|rise|walk|square|row|mews|view|parade|green|park|vale|wharf|embankment|broadway|boulevard|approach|circus|gate|yard|quay|chase|croft|fields|meadows?|bank|esplanade|promenade|passage|alley|hollow|dale|wood|cottages)\b\.?$/i;
function tidyCase(t){ return /[a-z]/.test(t) ? t : t.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(\d+)([A-Z])\b/gi, (m, n, l) => n + l.toUpperCase()); }
function epcParts(row){
  const g = (...ks) => { for (const k of ks) if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim(); return ''; };
  const toks = [g('address1', 'addressLine1'), g('address2', 'addressLine2'), g('address3', 'addressLine3')].filter(Boolean)
    .flatMap(x => x.split(',')).map(x => tidyCase(x.trim())).filter(Boolean);
  if (!toks.length) return null;
  let ri = toks.findIndex(t => STREET_RE.test(t.replace(/^\d+[A-Z]?(\s*-\s*\d+[A-Z]?)?\s+/i, '')) && !FLAT_RE.test(t));
  if (ri < 0) ri = toks.length - 1;
  const pre = toks.slice(0, ri), locality = toks.slice(ri + 1);
  let houseNo = '', building = '', road = toks[ri];
  const bits = [];
  pre.forEach(t => {
    if (FLAT_RE.test(t) && !houseNo) houseNo = t;
    else if (NUM_RE.test(t) && !houseNo) houseNo = t;   // "12A" before the road, or "5" before "Dudley Court"
    else { const m = /^(\d+[A-Z]?)\s+(\D.*)$/i.exec(t); if (m && !houseNo) { houseNo = m[1]; bits.push(m[2]); } else bits.push(t); }
  });
  building = bits.join(', ');
  const m = /^(\d+[A-Z]?(?:\s*-\s*\d+[A-Z]?)?)\s+(\D.*)$/i.exec(road);
  if (m && !houseNo && !building) { houseNo = m[1]; road = m[2]; }
  if (FLAT_RE.test(road)) { houseNo = houseNo || road; road = ''; }
  const town = locality.concat(g('posttown', 'postTown') ? [titleTown(g('posttown', 'postTown'))] : []).filter((x, i, all) => all.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(', ');
  return { houseNo, building, road, town, postcode: tidyPostcode(g('postcode')), label: toks.slice(0, ri + 1).join(', ') + (town ? ', ' + town : ''), uprn: g('uprn'), lodged: g('lodgement-date', 'lodgementDate', 'registrationDate') };
}
function labelOf(a, parts){
  const lines = [a.line_1, a.line_2, a.line_3, a.line_4].map(x => String(x || '').trim()).filter(Boolean);
  return lines.concat(parts.town ? [parts.town] : []).join(', ');
}

async function call(provider, url){
  let r;
  try { r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) }); }
  catch (e) {
    const why = e.name === 'TimeoutError' ? 'timeout after ' + TIMEOUT / 1000 + 's' : e.message;
    console.error(`address lookup (${provider}) failed: ${why}`);
    const err = new Error(why); err.status = 0; throw err;
  }
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch (e) {}
  if (!r.ok) {
    const msg = (body && (body.message || body.Message)) || text.slice(0, 200);
    // Never the URL: it carries the key.
    if (r.status !== 404) console.error(`address lookup (${provider}) HTTP ${r.status}: ${msg}${body && body.code ? ' (code ' + body.code + ')' : ''}`);
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return body || {};
}

const providers = {
  epc: {
    async postcode(pc){
      let r;
      try { r = await fetch(`${EPC_BASE}/domestic/search?postcode=${encodeURIComponent(pc)}&size=1000`, { headers: { Accept: 'application/json', Authorization: EPC_AUTH }, signal: AbortSignal.timeout(TIMEOUT) }); }
      catch (e) { console.error('address lookup (epc) failed: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message)); const err = new Error(e.message); err.status = 0; throw err; }
      if (r.status === 404) return [];
      if (!r.ok) { console.error('address lookup (epc) HTTP ' + r.status + (r.status === 401 || r.status === 403 ? ': check EPC_API_EMAIL and EPC_API_KEY' : '')); const err = new Error('http'); err.status = r.status; throw err; }
      const text = (await r.text()).trim();
      if (!text) return [];   // the register answers an empty 200 when nothing matches
      let d; try { d = JSON.parse(text); } catch (e) { return []; }
      const rows = Array.isArray(d) ? d : d.rows || d.data || d.results || [];
      // One entry per home (several certificates over the years): by UPRN, else by the address itself.
      const best = new Map();
      rows.map(epcParts).filter(Boolean).forEach(a => { const k = a.uprn || a.label.toLowerCase().replace(/[^a-z0-9]/g, ''); const o = best.get(k); if (!o || a.lodged > o.lodged) best.set(k, a); });
      return [...best.values()].sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
        .map((a, i) => ({ id: 'epc-' + (a.uprn || i), label: a.label, houseNo: a.houseNo, building: a.building, road: a.road, town: a.town, postcode: a.postcode || pc }));
    },
    async item(){ const e = new Error('not used'); e.status = 404; throw e; },
  },
  'ideal-postcodes': {
    async postcode(pc){
      try {
        const d = await call('ideal-postcodes', `${IDEAL_BASE}/v1/postcodes/${encodeURIComponent(pc)}?api_key=${encodeURIComponent(IDEAL_KEY)}`);
        return (d.result || []).map(a => { const p = normalise(a); return Object.assign({ id: String(a.udprn || a.id || ''), label: labelOf(a, p) }, p); });
      } catch (e) { if (e.status === 404) return []; throw e; }
    },
    async item(id){
      if (!/^\d{1,12}$/.test(id)) { const e = new Error('bad id'); e.status = 404; throw e; }
      const d = await call('ideal-postcodes', `${IDEAL_BASE}/v1/udprn/${encodeURIComponent(id)}?api_key=${encodeURIComponent(IDEAL_KEY)}`);
      const a = d.result || {}; const p = normalise(a);
      return Object.assign({ id, label: labelOf(a, p) }, p);
    },
  },
  getaddress: {
    async postcode(pc){
      try {
        const d = await call('getaddress', `${GA_BASE}/autocomplete/${encodeURIComponent(pc)}?api-key=${encodeURIComponent(GA_KEY)}&all=true`);
        return (d.suggestions || []).map(s => ({ id: String(s.id || ''), label: String(s.address || '').trim() })).filter(s => s.id && s.label);
      } catch (e) { if (e.status === 404) return []; throw e; }
    },
    async item(id){
      const a = await call('getaddress', `${GA_BASE}/get/${encodeURIComponent(id)}?api-key=${encodeURIComponent(GA_KEY)}`);
      const p = normalise(a);
      return Object.assign({ id, label: labelOf(a, p) || (a.formatted_address || []).filter(Boolean).join(', ') }, p);
    },
  },
};

// Results are kept for a day (lookups cost money); at most 2000 postcodes and 5000 picked addresses.
function cache(max){
  const m = new Map();
  return {
    get(k){ const v = m.get(k); if (v && Date.now() - v.at < DAY) return v.data; if (v) m.delete(k); return null; },
    set(k, data){ m.set(k, { at: Date.now(), data }); if (m.size > max) m.delete(m.keys().next().value); },
  };
}

function mount(app, { limiter, clientIp }){
  const pcCache = cache(2000), itemCache = cache(5000);
  const pcLimit = limiter(40, 3600 * 1000), itemLimit = limiter(60, 3600 * 1000);
  const fail = (res, status, reason) => res.status(status).json({ ok: false, provider: PROVIDER, reason });

  app.get('/api/address/item/:id', async (req, res) => {
    if (!PROVIDER) return fail(res, 503, 'not-configured');
    const id = String(req.params.id || '');
    if (!/^[\w=+\-:.]{1,300}$/.test(id)) return fail(res, 400, 'invalid');
    const hit = itemCache.get(id);
    if (hit) return res.json({ ok: true, provider: PROVIDER, address: hit });
    if (!itemLimit(clientIp(req))) return fail(res, 429, 'busy');
    const via = /^\d{1,12}$/.test(id) && IDEAL_KEY ? 'ideal-postcodes' : GA_KEY ? 'getaddress' : PROVIDER;
    try {
      const address = await providers[via].item(id);
      itemCache.set(id, address);
      res.json({ ok: true, provider: PROVIDER, address });
    } catch (e) { fail(res, e.status === 404 ? 404 : 502, e.status === 404 ? 'not-found' : 'unavailable'); }
  });

  app.get('/api/address/:postcode', async (req, res) => {
    if (!PROVIDER) return fail(res, 503, 'not-configured');
    const pc = tidyPostcode(req.params.postcode);
    if (!pc) return fail(res, 400, 'invalid');
    const hit = pcCache.get(pc);
    if (hit) return res.json({ ok: true, provider: PROVIDER, postcode: pc, addresses: hit });
    if (!pcLimit(clientIp(req))) return fail(res, 429, 'busy');
    // Each provider in turn until one finds addresses (e.g. the free EPC register, then getAddress.io).
    let addresses = [], used = PROVIDER, failed = 0;
    for (const prov of CHAIN) {
      try { addresses = await providers[prov].postcode(pc); used = prov; } catch (e) { failed++; continue; }
      if (addresses.length) break;
    }
    if (failed === CHAIN.length) return fail(res, 502, 'unavailable');
    console.log(`address lookup (${used}) ${pc}: ${addresses.length} addresses`);
    if (addresses.length) pcCache.set(pc, addresses);
    res.json({ ok: true, provider: used, postcode: pc, addresses });
  });
}

module.exports = { mount, configured: () => !!PROVIDER, provider: () => PROVIDER, normalise, tidyPostcode, epcParts };
