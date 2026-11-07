// Official renting figures for every US city page, from the U.S. Census Bureau's American Community Survey
// (5-year estimates, the latest year the API has): population, how many homes are rented, median rent and
// rent by bedrooms, rent as a share of income, the median year homes were built, and the kinds of buildings
// renters live in. Fetched by the live server (one request per state, a second apart), refreshed every 30 days,
// kept in REPORTS_DIR/us-census.json so a restart or an outage keeps the last figures. CENSUS_API_KEY optional;
// CENSUS_API_BASE for tests; US_CENSUS_OFF=1 stops it.
const fs = require('fs');
const path = require('path');

const FIPS = { al: '01', ak: '02', az: '04', ar: '05', ca: '06', co: '08', ct: '09', de: '10', dc: '11', fl: '12', ga: '13', hi: '15', id: '16', il: '17', in: '18', ia: '19', ks: '20', ky: '21', la: '22', me: '23', md: '24', ma: '25', mi: '26', mn: '27', ms: '28', mo: '29', mt: '30', ne: '31', nv: '32', nh: '33', nj: '34', nm: '35', ny: '36', nc: '37', nd: '38', oh: '39', ok: '40', or: '41', pa: '42', ri: '44', sc: '45', sd: '46', tn: '47', tx: '48', ut: '49', vt: '50', va: '51', wa: '53', wv: '54', wi: '55', wy: '56' };
// B25032: tenure by units in structure; the renter-occupied half is _013 (total) to _023.
const VARS = { pop: 'B01003_001E', occ: 'B25003_001E', rented: 'B25003_003E', medRent: 'B25064_001E', r0: 'B25031_002E', r1: 'B25031_003E', r2: 'B25031_004E', r3: 'B25031_005E',
  burden: 'B25071_001E', built: 'B25035_001E', value: 'B25077_001E',
  rt: 'B25032_013E', rDet: 'B25032_014E', rAtt: 'B25032_015E', r2u: 'B25032_016E', r34: 'B25032_017E', r59: 'B25032_018E', r1019: 'B25032_019E', r2049: 'B25032_020E', r50: 'B25032_021E', rMob: 'B25032_022E', rBoat: 'B25032_023E' };

let file = '', data = { year: 0, at: '', cities: {} }, lastFail = 0;
const norm = s => String(s || '').toLowerCase().replace(/\./g, '').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();
// "Nashville-Davidson metropolitan government (balance), Tennessee" → "nashville-davidson"
function placeName(full){
  let n = norm(String(full).replace(/,[^,]*$/, '')).replace(/\s*\(balance\)$/, '');
  n = n.replace(/\s+(city|town|village|municipality|cdp|borough|metropolitan government|consolidated government|urban county|unified government|metro government|city and borough)$/, '');
  return n.replace(/^urban /, '');
}
function matches(censusName, ours){
  const c = placeName(censusName), o = norm(ours).replace(/,.*$/, '');
  return c === o || c.split(/[-\/]/)[0] === o || c.replace(/ city$/, '') === o;
}
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

function shape(row){
  const v = {}; Object.keys(VARS).forEach(k => { v[k] = num(row[k]); });
  const out = { pop: v.pop, rentedPct: v.occ && v.rented != null ? Math.round(v.rented / v.occ * 100) : null, medRent: v.medRent, r0: v.r0, r1: v.r1, r2: v.r2, r3: v.r3,
    burden: v.burden, built: v.built && v.built > 1800 ? v.built : null, value: v.value };
  // Kinds of buildings renters live in, only when the parts add up (a check that the table numbering is right).
  const parts = ['rDet', 'rAtt', 'r2u', 'r34', 'r59', 'r1019', 'r2049', 'r50', 'rMob', 'rBoat'].map(k => v[k] || 0), sum = parts.reduce((a, b) => a + b, 0);
  if (v.rt && Math.abs(sum - v.rt) <= v.rt * 0.02 && v.rented && Math.abs(v.rt - v.rented) <= v.rented * 0.02) {
    const pc = x => Math.round(x / v.rt * 100);
    out.homes = { houses: pc(v.rDet + v.rAtt), small: pc(v.r2u + v.r34 + v.r59 + v.r1019), large: pc(v.r2049 + v.r50), mobile: pc(v.rMob) };
  }
  return out;
}

async function getJson(url){
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'DIYInventory/1.0 (+https://diyinventory.co.uk)', Accept: 'application/json' } });
  const t = await r.text();
  if (!r.ok) { const e = new Error('HTTP ' + r.status + ': ' + t.replace(/\s+/g, ' ').slice(0, 160)); e.status = r.status; throw e; }
  try { return JSON.parse(t); } catch (err) { throw new Error('not JSON (HTTP ' + r.status + '): ' + t.replace(/\s+/g, ' ').slice(0, 160)); }
}
async function refresh(places){
  const base = (process.env.CENSUS_API_BASE || 'https://api.census.gov/data').replace(/\/+$/, ''), key = process.env.CENSUS_API_KEY ? '&key=' + encodeURIComponent(process.env.CENSUS_API_KEY) : '';
  const want = Object.keys(VARS).map(k => VARS[k]).join(',');
  const byState = {};
  places.forEach(p => { const fips = FIPS[p.code]; if (fips) (byState[fips] = byState[fips] || []).push(p); });
  // The newest year the API has (a 5-year release comes out each December).
  let year = 0;
  for (let y = new Date().getFullYear() - 1; y >= new Date().getFullYear() - 5 && !year; y--) {
    try { await getJson(`${base}/${y}/acs/acs5?get=NAME,B01003_001E&for=state:11${key}`); year = y; } catch (e) { console.error('us census: ACS ' + y + ' not available: ' + e.message); }
  }
  if (!year) { console.error('us census: no ACS 5-year data found (tries again in an hour)'); lastFail = Date.now(); return; }
  const cities = {}; let found = 0, missing = [];
  for (const [fips, list] of Object.entries(byState)) {
    try {
      const rows = await getJson(`${base}/${year}/acs/acs5?get=NAME,${want}&for=place:*&in=state:${fips}${key}`);
      const head = rows[0], recs = rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i]; }); return o; });
      const named = recs.map(o => { const x = { NAME: o.NAME }; Object.keys(VARS).forEach(k => { x[k] = o[VARS[k]]; }); return x; });
      for (const p of list) {
        const hits = named.filter(r => matches(r.NAME, p.name)).sort((a, b) => (num(b.pop) || 0) - (num(a.pop) || 0));
        if (hits.length) { cities[p.slug] = Object.assign({ place: hits[0].NAME }, shape(hits[0])); found++; } else missing.push(p.name + ', ' + p.code.toUpperCase());
      }
    } catch (e) { console.error('us census: state ' + fips + ' failed: ' + e.message); list.forEach(p => { if (data.cities[p.slug]) cities[p.slug] = data.cities[p.slug]; }); }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!found) return;
  data = { year, at: new Date().toISOString(), cities };
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) {}
  console.log('us census: ACS ' + (year - 4) + '–' + year + ' figures for ' + found + ' cities' + (missing.length ? '; not matched: ' + missing.join('; ') : ''));
}

// places: [{ slug, name, code }] (code = the state's postal code, lower case).
function start(dir, places){
  file = path.join(dir, 'us-census.json');
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d && d.cities) data = d; } catch (e) {}
  if (/^(1|on|true)$/i.test(process.env.US_CENSUS_OFF || '')) return;
  const due = () => Date.now() - lastFail > 3600 * 1000 && (!data.at || Date.now() - Date.parse(data.at) > 30 * 86400000 || places.some(p => !data.cities[p.slug]) && Date.now() - Date.parse(data.at) > 86400000);
  const run = () => { if (due()) refresh(places).catch(e => { lastFail = Date.now(); console.error('us census:', e.message); }); };
  setTimeout(run, Number(process.env.US_CENSUS_DELAY_MS) || 60 * 1000).unref();
  setInterval(run, 3600 * 1000).unref();   // hourly check; it only fetches when due
}
const get = slug => data.cities[slug] ? Object.assign({ year: data.year }, data.cities[slug]) : null;

module.exports = { start, get, _test: { placeName, matches, shape } };
