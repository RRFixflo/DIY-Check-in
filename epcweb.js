// The government's public "Find an energy certificate" site, read by postcode: no key or sign-up needed.
// The same approach Fixflow uses: the search page lists every domestic certificate at the postcode with its
// address, current rating and "valid until" date. Used for the free postcode lookup (address.js) and the
// landlord dashboard's EPC search (landlords.js) when no EPC register API key is set.
const SITE = 'https://find-energy-certificate.service.gov.uk';
const searchUrl = pc => SITE + '/find-a-certificate/search-by-postcode?lang=en&property_type=domestic&postcode=' + encodeURIComponent(pc);
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const cache = new Map();

// Every certificate at the postcode: { address, reference, link, rating, expires (YYYY-MM-DD), expired }.
async function search(postcode, opts){
  const pc = String(postcode || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const hit = cache.get(pc);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.results;
  const base = (opts && opts.base) || process.env.EPC_WEB_BASE || SITE;   // EPC_WEB_BASE: tests only
  const r = await fetch(base + '/find-a-certificate/search-by-postcode?lang=en&property_type=domestic&postcode=' + encodeURIComponent(pc),
    { headers: { 'User-Agent': 'Mozilla/5.0 (DIY Inventory)', Accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
  if (r.status === 404) return [];
  if (!r.ok) { const e = new Error('register-' + r.status); e.status = r.status; throw e; }
  const html = await r.text(), results = [];
  const re = /<a[^>]+href="(\/energy-certificate\/[\d-]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+href="\/energy-certificate\/|<\/tbody>|$)/g;
  let x;
  while ((x = re.exec(html)) && results.length < 2000) {
    const rest = clean(x[3]);
    const d = /(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/i.exec(rest);
    const rating = /(?:^|\s)([A-G])(?:\s|$)/.exec(rest);
    results.push({ address: clean(x[2]), reference: x[1].split('/').pop(), link: SITE + x[1], rating: rating ? rating[1] : '',
      expires: d ? d[3] + '-' + String(MONTHS[d[2].toLowerCase()]).padStart(2, '0') + '-' + String(d[1]).padStart(2, '0') : '', expired: /expired/i.test(rest) });
  }
  cache.set(pc, { at: Date.now(), results }); if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return results;
}

// "Flat 2, 14 Albion Road, LONDON, N16 9PS" → address lines and post town, for address.js's splitter.
const PC_RE = /,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\s*$/i;
function lines(address){
  const toks = String(address).replace(PC_RE, '').split(',').map(s => s.trim()).filter(Boolean);
  let town = '';
  // The post town comes last, in capitals, with no number (a road would have a number or a street word).
  if (toks.length > 1 && /^[A-Z][A-Z' .-]+$/.test(toks[toks.length - 1]) && !/\d/.test(toks[toks.length - 1])) town = toks.pop();
  return { address1: toks.join(', '), posttown: town };
}

module.exports = { search, lines, searchUrl };
