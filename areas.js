// Local hubs for England's council areas (London boroughs, metropolitan boroughs, unitaries and districts):
// /inventory-reports/<area> and three pages under it (landlords, tenants, neighbourhoods). The list of areas is
// content/area-list.json (ONS local authority districts: name, type, county, region, Land Registry district name,
// centre); each area's page appears once it has researched facts in content/areas/<slug>.json (council and licensing pages, ONS rents, UK HPI prices,
// Census 2021 renting share, council tax, postcode districts, neighbourhoods and their homes, check-in tips) and,
// when the Land Registry answers, sales in the last 12 months by property type (fetched in the background once a
// month, cached in REPORTS_DIR/area-sales.json). A fact that couldn't be verified is null and simply not shown.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'content', 'areas');
const LIST = path.join(__dirname, 'content', 'area-list.json');
const load = () => { const out = {}; try { fs.readdirSync(DIR).filter(f => f.endsWith('.json')).forEach(f => { try { const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); if (d && d.slug) out[d.slug] = d; } catch (e) { console.error('areas: bad ' + f + ': ' + e.message); } }); } catch (e) {} return out; };
const PTYPE = { detached: 'Detached', 'semi-detached': 'Semi-detached', terraced: 'Terraced', 'flat-maisonette': 'Flat or maisonette', otherPropertyType: 'Other' };
const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
const SUBS = [['landlords', 'Landlords'], ['tenants', 'Tenants'], ['neighbourhoods', 'Neighbourhoods and postcodes']];

function mount(app, { renderPage, escHtml: e, PLACES, BASE_PATH, REPORTS_DIR }){
  const D = load();
  let master = []; try { master = JSON.parse(fs.readFileSync(LIST, 'utf8')); } catch (e) {}
  const old = {}; PLACES.forEach(p => { old[p.slug] = p; });
  // An area that already had a page keeps its short name ("Hull", "Bath"); its official name is shown too.
  // Only areas with enough verified local facts get a hub (otherwise the page would be thin): at least two of
  // rent, price, renting share, council tax and licensing.
  const solid = d => [d.rent && d.rent.text, d.price && d.price.text, d.privateRentedShare && d.privateRentedShare.text, d.councilTax && d.councilTax.text, d.licensing && (d.licensing.selective || d.licensing.additional)].filter(Boolean).length >= 2;
  const list = master.filter(a => D[a.slug] && solid(D[a.slug])).map(a => Object.assign({}, a, { official: a.name, name: old[a.slug] ? old[a.slug].name : a.name, london: a.type === 'london borough' }));
  const byslug = {}; list.forEach(a => { byslug[a.slug] = a; });
  if (!list.length) return { slugs: [], paths: [], areas: [] };
  const R = d => d * Math.PI / 180, dist = (a, b) => Math.hypot(R(b.lon - a.lon) * Math.cos(R((a.lat + b.lat) / 2)), R(b.lat - a.lat));
  const nearOf = a => { const named = (D[a.slug].nearby || []).filter(s => byslug[s]); return named.length ? named : list.filter(b => b !== a && a.lat != null && b.lat != null).sort((x, y) => dist(a, x) - dist(a, y)).slice(0, 6).map(b => b.slug); };

  /* ------------------- sales in the last 12 months (Land Registry) ------------------- */
  const salesFile = REPORTS_DIR ? path.join(REPORTS_DIR, 'area-sales.json') : '';
  let SALES = {}; try { SALES = JSON.parse(fs.readFileSync(salesFile, 'utf8')); } catch (e) {}
  async function districtSales(name){
    const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const q = `PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?ptype (COUNT(?tx) AS ?n) (AVG(?amount) AS ?avg) WHERE {
  ?addr lrcommon:district "${name}" .
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ; lrppi:propertyType ?ptype .
  FILTER (?date >= "${since}"^^xsd:date)
} GROUP BY ?ptype`;
    const base = (process.env.PR_LR_BASE || 'https://landregistry.data.gov.uk').replace(/\/+$/, '');
    const r = await fetch(base + '/landregistry/query', { method: 'POST', headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DIY Inventory (diyinventory.co.uk)' },
      body: 'query=' + encodeURIComponent(q), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(), v = (b, k) => b[k] ? b[k].value : '';
    const types = ((d.results || {}).bindings || []).map(b => ({ type: PTYPE[v(b, 'ptype').split('/').pop()] || 'Other', n: parseInt(v(b, 'n'), 10) || 0, avg: Math.round(parseFloat(v(b, 'avg')) || 0) })).filter(t => t.n > 0).sort((a, b) => b.n - a.n);
    if (!types.length) throw new Error('no sales');
    const n = types.reduce((s, t) => s + t.n, 0);
    return { since, n, avg: Math.round(types.reduce((s, t) => s + t.avg * t.n, 0) / n), types, at: new Date().toISOString() };
  }
  async function refreshSales(){
    for (const p of list) {
      const old = SALES[p.slug];
      if (old && Date.now() - new Date(old.at).getTime() < 30 * 86400000) continue;
      try { SALES[p.slug] = await districtSales(p.lr || p.official.toUpperCase()); fs.writeFileSync(salesFile, JSON.stringify(SALES)); }
      catch (err) { console.error('areas: sales for ' + p.name + ' failed: ' + err.message); }
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  if (salesFile && !process.env.BOROUGH_SALES_OFF) { setTimeout(() => refreshSales().catch(() => {}), 120 * 1000).unref(); setInterval(() => refreshSales().catch(() => {}), 24 * 3600 * 1000).unref(); }

  /* ------------------------------------ pieces ------------------------------------ */
  const place = p => p.slug === 'city-of-london' ? 'the City of London' : p.name;
  const kind = p => p.london ? 'London borough' : [p.official !== p.name ? p.official : '', p.type === 'district' ? (p.county || p.region) : p.region].filter(Boolean).join(' · ');
  const Place = p => p.name.replace(/^the /, '');
  const url = (p, sub) => BASE_PATH + '/' + p.slug + (sub ? '/' + sub : '');
  const src = (o, label) => o && o.source ? ` <a class="src" href="${e(o.source)}" rel="nofollow noopener" target="_blank">${e(label || 'Source')}</a>` : '';
  const big = t => { const m = /£[\d,.]+(?:\s?(?:m|k))?|\d+(?:\.\d+)?%/.exec(t || ''); return m ? m[0] : ''; };
  const tile = (label, o) => o && o.text ? `<div class="af"><span class="l">${e(label)}</span>${big(o.text) ? `<b>${e(big(o.text))}</b>` : ''}<span class="t">${e(o.text)}${src(o)}</span></div>` : '';
  const facts = (p, d, s) => {
    const salesTile = s ? `<div class="af"><span class="l">Homes sold, last 12 months</span><b>${s.n.toLocaleString('en-GB')}</b><span class="t">Average price paid ${e(gbp(s.avg))} (HM Land Registry)</span></div>` : '';
    const lic = d.licensing && (d.licensing.selective || d.licensing.additional) ? `<div class="af"><span class="l">Landlord licensing</span><b>${/borough-wide|district-wide|city-wide|citywide|whole (borough|district|city|area)|all wards/i.test(d.licensing.selective || '') ? (p.london ? 'Borough-wide' : 'Whole area') : /none|no selective|not have|doesn’t have|does not/i.test(d.licensing.selective || '') ? (d.licensing.additional && !/none|no additional/i.test(d.licensing.additional) ? 'HMOs' : 'None') : 'Some areas'}</b><span class="t"><a href="${url(p, 'landlords')}#licensing">What it means for you</a></span></div>` : '';
    const tiles = [tile('Average rent', d.rent), tile('Average house price', d.price), salesTile, tile('Households renting privately', d.privateRentedShare), tile('Council tax', d.councilTax), lic].filter(Boolean);
    return tiles.length ? `<div class="area-facts">${tiles.join('')}</div>` : '';
  };
  const salesTable = (p, s) => s ? `<div class="card prose" style="margin-top:18px"><h2>Homes sold in ${e(place(p))} in the last 12 months</h2>
    <table><thead><tr><th>Type</th><th>Sales</th><th>Average price</th></tr></thead><tbody>${s.types.map(t => `<tr><td>${e(t.type)}</td><td>${t.n.toLocaleString('en-GB')}</td><td>${e(gbp(t.avg))}</td></tr>`).join('')}</tbody></table>
    <p class="sub" style="font-size:13.5px">HM Land Registry Price Paid Data since ${e(new Date(s.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}, updated monthly. Look up any address in the <a href="/property-report">free property report</a>.</p></div>` : '';
  const subnav = (p, on) => `<nav class="area-nav" aria-label="${e(Place(p))}"><a${on === '' ? ' class="on"' : ''} href="${url(p)}">Overview</a>${SUBS.map(([k, l]) => `<a${on === k ? ' class="on"' : ''} href="${url(p, k)}">${e(l)}</a>`).join('')}</nav>`;
  const head = (p, kicker, h1, lead, on) => `<div class="page-head"><div class="wrap"><p style="margin:0 0 6px"><a href="${BASE_PATH}">← All areas</a>${on ? ` · <a href="${url(p)}">${e(Place(p))}</a>` : ''}</p><span class="kicker">${e(kicker)}</span><h1>${e(h1)}</h1><p>${lead}</p>${subnav(p, on)}</div></div>`;
  const near = (p, d, sub) => { const n = nearOf(p).map(s => byslug[s]).filter(Boolean); return n.length ? `<section style="padding-top:0"><div class="wrap"><div class="sec-head"><span class="kicker">Nearby</span><h2>${p.london ? 'Neighbouring boroughs' : 'Nearby areas'}</h2></div><p style="text-align:center;line-height:2.2">${n.map(q => `<a class="btn ghost sm" style="margin:0 4px" href="${url(q, sub)}">${e(Place(q))}</a>`).join('')}<a class="btn ghost sm" style="margin:0 4px" href="${BASE_PATH}">All areas</a></p></div></section>` : ''; };
  const faqHtml = (title, qs) => `<section style="padding-top:0"><div class="wrap"><div class="sec-head"><span class="kicker">Questions</span><h2>${e(title)}</h2></div><div class="faq">${qs.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div></div></section>`;
  const final = (p, text) => `<div class="final"><div class="wrap"><div class="card"><h2>Ready when you have the keys</h2><p>${e(text)}</p><a class="btn" href="/app">Start free</a></div></div></div>`;
  const tips = (p, d) => d.checkinTips && d.checkinTips.length ? `<div class="card"><h3>What to check at a ${e(Place(p))} check-in</h3><ul>${d.checkinTips.map(t => `<li>${e(t)}</li>`).join('')}</ul></div>` : '';
  const licText = d => [d.licensing && d.licensing.selective ? ['Selective licensing', d.licensing.selective] : null, d.licensing && d.licensing.additional ? ['Additional HMO licensing', d.licensing.additional] : null, d.licensing && d.licensing.fee ? ['Fees', d.licensing.fee] : null].filter(Boolean);
  const ld = (p, sub, title, qs, extra) => base => [
    { '@type': 'BreadcrumbList', itemListElement: [['Home', '/'], ['Areas', BASE_PATH], [Place(p), url(p)]].concat(sub ? [[title, url(p, sub)]] : []).map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) },
    { '@type': 'FAQPage', mainEntity: qs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }].concat(extra ? extra(base) : []);
  const pg = (p, sub, title, desc, body, jsonld) => ({ key: 'locations', path: url(p, sub), title: title + ' · DIY Inventory', og: title, desc, body, jsonld });

  /* ------------------------------------ the hub ------------------------------------ */
  function hub(p){
    const d = D[p.slug], s = SALES[p.slug], w = place(p), P = Place(p);
    const qs = [
      ['How much does an inventory clerk cost in ' + P + '?', 'Clerks usually charge per visit, more for bigger or furnished homes, so a check-in and a check-out together often come to a few hundred pounds. With DIY Inventory each report is £30, whatever the size, and you can do it as soon as you have the keys.'],
      d.rent && d.rent.text ? ['What is the average rent in ' + P + '?', d.rent.text + '. Rents vary a lot by street and type of home; the free property report shows sold prices, the EPC and more for any ' + P + ' postcode.'] : null,
      licText(d).length ? ['Do landlords need a licence in ' + P + '?', licText(d).map(x => x[0] + ': ' + x[1]).join(' ') + ' Check the council’s own page before letting, as schemes change.'] : null,
      ['Can I do my own check-in inventory in ' + P + '?', 'Yes. Landlords, agents and tenants can do it on a phone: a photo checklist for every room, the date and time stamped on every photo, every item’s condition, and both sides sign. The PDF is ready the moment it’s signed.'],
      ['Will a DIY inventory stand up in a deposit dispute?', 'Deposit schemes (DPS, TDS, mydeposits) decide on the evidence, above all the condition at check-in compared with check-out. Dated photos of every room, signed by both sides, are exactly that evidence.'],
    ].filter(Boolean);
    const body = head(p, kind(p) + ((d.postcodes || []).length ? ' · ' + d.postcodes.slice(0, 6).join(', ') : ''), 'Inventory and check-in reports in ' + P, e(d.housing || ''), '') + `
<section class="tight"><div class="wrap">${facts(p, d, s)}${salesTable(p, s)}</div></section>
<section class="tight"><div class="wrap"><div class="two">
  ${tips(p, d)}
  <div class="card"><h3>Do it yourself in ${e(P)}</h3><ul>
    <li>No clerk to book: do it whenever you have the keys, before the tenant moves in or with them there.</li>
    <li>£30 a report instead of a clerk’s fee for every check-in, inspection and check-out.</li>
    <li>The check-out starts from the check-in and shows what has changed, photos side by side.</li>
    <li>Prefer paper? Use the <a href="/inventory-template">free inventory template</a>.</li>
  </ul><p style="margin:14px 0 0"><a class="btn primary sm" href="/app">Start free</a> <a class="btn ghost sm" href="/example-report">Example report</a></p></div>
</div></div></section>
${d.neighbourhoods && d.neighbourhoods.length ? `<section style="padding-top:0"><div class="wrap"><div class="sec-head"><span class="kicker">Neighbourhoods</span><h2>Areas of ${e(P)}</h2></div><p style="text-align:center;line-height:2.2">${d.neighbourhoods.map((n, i) => `<a class="btn ghost sm" style="margin:0 4px" href="${url(p, 'neighbourhoods')}#n${i + 1}">${e(n.name)}</a>`).join('')}</p></div></section>` : ''}
<section style="padding-top:0"><div class="wrap"><div class="features">
  <a class="card feature" style="text-decoration:none;color:inherit" href="${url(p, 'landlords')}"><h3>Letting in ${e(P)}</h3><p>Licensing, safety certificates, deposits and the local figures, for landlords.</p></a>
  <a class="card feature" style="text-decoration:none;color:inherit" href="${url(p, 'tenants')}"><h3>Renting in ${e(P)}</h3><p>Your check-in, getting your deposit back, and where to get help locally.</p></a>
  <a class="card feature" style="text-decoration:none;color:inherit" href="/property-report"><h3>Free property report</h3><p>EPC, sold prices, crime, flood risk and rental yield for any ${e(P)} postcode.</p></a>
</div></div></section>
${faqHtml('Inventories in ' + P + ': questions', qs)}${near(p, d, '')}${final(p, 'Start your ' + P + ' inventory today, on your phone. It’s free until you download it.')}`;
    return pg(p, '', 'Inventory clerk in ' + P + '? Do your own inventory for £30', 'Inventories, check-ins and check-outs in ' + w + ', done on your phone for £30. Local rents, sold prices, landlord licensing and what to check in ' + P + ' homes.', body,
      ld(p, '', '', qs, base => [{ '@type': 'Service', name: 'Inventory and check-in reports in ' + P, serviceType: 'Property inventory and inspection report', provider: { '@id': base + '/#org' }, areaServed: { '@type': 'AdministrativeArea', name: p.official.replace(/^the /, ''), containedInPlace: p.london ? { '@type': 'City', name: 'London' } : { '@type': 'AdministrativeArea', name: p.county || p.region } }, offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } }]));
  }

  /* --------------------------------- for landlords --------------------------------- */
  function landlords(p){
    const d = D[p.slug], s = SALES[p.slug], P = Place(p), lt = licText(d), c = d.council || {};
    const qs = [
      lt.length ? ['Is there selective licensing in ' + P + '?', (d.licensing.selective || 'Check with the council.') + ' Check the council’s page before letting: schemes are renewed and changed every few years.'] : null,
      ['What certificates does a landlord need in ' + P + '?', 'A Gas Safety certificate every 12 months (where there is gas), an electrical safety report (EICR) at least every 5 years, and a valid EPC rated E or above, plus working smoke alarms on every storey and carbon monoxide alarms by fixed combustion appliances.'],
      ['How long do I have to protect a deposit?', '30 days from receiving it, in the DPS, TDS or mydeposits, with the prescribed information given to the tenant in the same 30 days.'],
      ['Do I need an inventory as a landlord in ' + P + '?', 'It isn’t a legal requirement, but without a signed check-in record it is very hard to claim anything from the deposit at the end. With DIY Inventory you can do it yourself for £30, or send your tenant a link to do it.'],
    ].filter(Boolean);
    const body = head(p, 'For landlords', 'Letting a property in ' + P + ': a landlord’s guide', 'Licensing, certificates, deposits and the local figures for landlords letting in ' + e(place(p)) + '.', 'landlords') + `
<section class="tight"><div class="wrap">${facts(p, d, s)}</div></section>
<section class="tight"><div class="wrap"><div class="card prose" id="licensing">
  <p><em>General information as at ${e((d.licensing && d.licensing.checked) || 'October 2026')}, not legal advice. Always check the council’s current scheme before letting.</em></p>
  <h2>Landlord licensing in ${e(P)}</h2>
  ${lt.length ? `<ul>${lt.map(([k, v]) => `<li><strong>${e(k)}:</strong> ${e(v)}</li>`).join('')}</ul>` : `<p>We couldn’t confirm the current scheme. Check with ${e(c.name || 'the council')}.</p>`}
  <p>Separately, every large HMO (5 or more people forming 2 or more households) needs a mandatory HMO licence anywhere in England.${d.licensing && d.licensing.source ? ` Source: <a href="${e(d.licensing.source)}" rel="nofollow noopener" target="_blank">${e(c.name || 'the council')}</a>.` : ''}</p>
  ${c.privateRentingUrl ? `<p><a href="${e(c.privateRentingUrl)}" rel="nofollow noopener" target="_blank">${e(c.name || 'The council')}: private renting and licensing</a></p>` : ''}
  <h2>Safety certificates</h2>
  <ul><li><strong>Gas Safety (CP12):</strong> every 12 months, by a Gas Safe registered engineer.</li><li><strong>EICR:</strong> at least every 5 years, by a qualified electrician.</li><li><strong>EPC:</strong> rated E or above, valid for 10 years.</li><li><strong>Alarms:</strong> a smoke alarm on every storey, and a carbon monoxide alarm in rooms with a fixed combustion appliance (not gas cookers).</li></ul>
  ${p.london ? `<p><a href="/certificates">Book a Gas Safety certificate, EICR or EPC in ${e(P)}</a> at a fixed price, and keep track of expiry dates in the <a href="/landlords">free landlord dashboard</a>.</p>` : `<p>Keep track of every certificate’s expiry date, with reminders, in the <a href="/landlords">free landlord dashboard</a>.</p>`}
  <h2>Deposits and the inventory</h2>
  <p>Protect the deposit in the DPS, TDS or mydeposits within 30 days. At the end, the scheme decides any dispute on the evidence, above all the check-in compared with the check-out, so the inventory is what protects you.</p>
  ${d.checkinTips && d.checkinTips.length ? `<h2>What to record in ${e(P)} homes</h2><ul>${d.checkinTips.map(t => `<li>${e(t)}</li>`).join('')}</ul>` : ''}
  <p><a class="btn primary" href="/app">Start your inventory free</a></p>
</div>${salesTable(p, s)}</div></section>
${faqHtml('Letting in ' + P + ': questions', qs)}${near(p, d, 'landlords')}${final(p, 'Do your ' + P + ' check-in yourself, on your phone, for £30.')}`;
    return pg(p, 'landlords', 'Letting in ' + P + ': licensing, certificates and inventories', 'A landlord’s guide to letting in ' + place(p) + ': selective and HMO licensing, safety certificates, deposits, local rents and prices, and doing your own inventory.', body, ld(p, 'landlords', 'Landlords', qs));
  }

  /* ---------------------------------- for tenants ---------------------------------- */
  function tenants(p){
    const d = D[p.slug], P = Place(p), c = d.council || {};
    const qs = [
      ['What should I check when I move into a rented home in ' + P + '?', 'Photograph every room and item before you unpack, with the date on each photo: walls, floors, windows, appliances, meters and keys. Note anything worn or damaged and get the landlord or agent to agree it in writing.'],
      ['How do I get my deposit back?', 'Leave the home as you found it, allowing for fair wear and tear, and compare it with the check-in record. If you disagree with deductions, the deposit scheme’s free dispute service decides on the evidence.'],
      d.tenantHelp ? ['Where can renters in ' + P + ' get help?', d.tenantHelp] : null,
      ['Can a tenant do the check-in inventory?', 'Yes. With DIY Inventory a tenant can do it on their phone and send the landlord a link to check and sign it, so both sides have the same dated record.'],
    ].filter(Boolean);
    const body = head(p, 'For tenants', 'Renting in ' + P + ': check-in and getting your deposit back', 'What to check when you move in, how to protect your deposit, and where renters in ' + e(place(p)) + ' can get help.', 'tenants') + `
<section class="tight"><div class="wrap"><div class="card prose">
  ${d.housing ? `<h2>Homes to rent in ${e(P)}</h2><p>${e(d.housing)}</p>` : ''}
  ${d.rent && d.rent.text ? `<p><strong>Average rent:</strong> ${e(d.rent.text)}.${src(d.rent)}</p>` : ''}
  <h2>On moving-in day</h2>
  <ol><li>Before unpacking, photograph every room: a wide shot, then each item, with the date and time on every photo.</li><li>Photograph the meters (gas, electricity, water) and write down the readings.</li><li>Count the keys and fobs, and test the smoke and carbon monoxide alarms.</li><li>Note anything worn, marked or not working, and send it to the landlord or agent within a few days.</li></ol>
  ${d.checkinTips && d.checkinTips.length ? `<h2>Things to look at in ${e(P)} homes</h2><ul>${d.checkinTips.map(t => `<li>${e(t)}</li>`).join('')}</ul>` : ''}
  <h2>Your deposit</h2>
  <p>Your landlord must protect your deposit in the DPS, TDS or mydeposits within 30 days and tell you which. At the end, deductions can only be for damage beyond <a href="/guides/fair-wear-and-tear-vs-damage">fair wear and tear</a>, cleaning back to the check-in standard, or rent owed. A dated check-in record is your best protection.</p>
  ${d.tenantHelp ? `<h2>Help from the council</h2><p>${e(d.tenantHelp)}${c.privateRentingUrl ? ` <a href="${e(c.privateRentingUrl)}" rel="nofollow noopener" target="_blank">${e(c.name || 'The council')}: private renting</a>.` : ''}</p>` : ''}
  <p><a class="btn primary" href="/app">Do your check-in free</a> <a class="btn ghost" href="/guides/moving-in-checklist-for-tenants">Moving-in checklist</a></p>
</div></div></section>
${faqHtml('Renting in ' + P + ': questions', qs)}${near(p, d, 'tenants')}${final(p, 'Record your ' + P + ' home’s condition today, on your phone.')}`;
    return pg(p, 'tenants', 'Renting in ' + P + ': your check-in and deposit', 'Moving into a rented home in ' + place(p) + '? What to check and photograph at check-in, how to get your deposit back, and where to get help locally.', body, ld(p, 'tenants', 'Tenants', qs));
  }

  /* --------------------------- neighbourhoods and postcodes --------------------------- */
  function hoods(p){
    const d = D[p.slug], P = Place(p), n = d.neighbourhoods || [];
    const qs = [
      (d.postcodes || []).length ? ['Which postcodes are in ' + P + '?', P + ' covers all or part of these postcode districts: ' + d.postcodes.join(', ') + '. Some districts cross into neighbouring areas.'] : null,
      ['Can I get a report for one postcode?', 'Yes. The free property report shows the EPC, sold prices nearby, crime, flood risk and a rental yield calculator for any UK postcode.'],
    ].filter(Boolean);
    const body = head(p, 'Neighbourhoods', P + ': neighbourhoods, postcodes and homes', 'The areas of ' + e(place(p)) + ', their postcodes and the kind of homes you’ll find, with what to record at check-in.', 'neighbourhoods') + `
<section class="tight"><div class="wrap"><div class="card prose">
  ${(d.postcodes || []).length ? `<p><strong>Postcode districts:</strong> ${d.postcodes.map(e).join(', ')}</p>` : ''}
  ${n.map((x, i) => `<h2 id="n${i + 1}">${e(x.name)}${x.postcodes ? ` <span style="font-weight:600;color:var(--ink-faint);font-size:16px">${e(x.postcodes)}</span>` : ''}</h2><p>${e(x.housing || '')}</p>`).join('')}
  <h2>Check any postcode</h2>
  <form action="/property-report" method="get" style="display:flex;gap:8px;flex-wrap:wrap"><input name="postcode" placeholder="Postcode, e.g. ${e(((d.postcodes || [])[0] || 'SE1') + ' 1AA')}" style="flex:1;min-width:180px;font-size:16px;padding:12px;border-radius:12px;border:1px solid var(--line)" autocomplete="postal-code"><button class="btn primary" type="submit">Free property report</button></form>
</div></div></section>
${faqHtml(P + ' postcodes: questions', qs)}${near(p, d, 'neighbourhoods')}${final(p, 'Whichever part of ' + P + ', do your inventory on your phone.')}`;
    return pg(p, 'neighbourhoods', P + ' neighbourhoods and postcodes: homes and what to check', 'The neighbourhoods of ' + place(p) + ' (' + (d.postcodes || []).slice(0, 5).join(', ') + '), the kind of homes in each, and what to record at check-in and check-out.', body,
      ld(p, 'neighbourhoods', 'Neighbourhoods', qs, base => n.length ? [{ '@type': 'ItemList', name: 'Neighbourhoods of ' + P, itemListElement: n.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, url: base + url(p, 'neighbourhoods') + '#n' + (i + 1) })) }] : []));
  }

  // Rendered per request, so the monthly sales figures appear without a restart.
  const send = make => (req, res) => res.type('html').send(renderPage(make(), req));
  list.forEach(p => {
    app.get([url(p), url(p) + '/'], send(() => hub(p)));
    app.get([url(p, 'landlords'), url(p, 'landlords') + '/'], send(() => landlords(p)));
    app.get([url(p, 'tenants'), url(p, 'tenants') + '/'], send(() => tenants(p)));
    app.get([url(p, 'neighbourhoods'), url(p, 'neighbourhoods') + '/'], send(() => hoods(p)));
  });
  return { slugs: list.map(p => p.slug), areas: list, paths: [].concat(...list.map(p => [url(p), url(p, 'landlords'), url(p, 'tenants'), url(p, 'neighbourhoods')])), bodies: list.map(p => JSON.stringify(D[p.slug])) };
}

module.exports = { mount };
