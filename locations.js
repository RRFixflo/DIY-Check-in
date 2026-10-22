// Location pages for search: /inventory-reports (all areas) and /inventory-reports/<slug> for UK cities, large
// towns and London boroughs. Each page is written for its place: the nation's own rules (deposit schemes and
// deadlines, tenancy wording, safety checks differ between England, Wales, Scotland and Northern Ireland), the
// nearest other areas, local questions and answers, and structured data (Service with areaServed, FAQPage,
// BreadcrumbList). The app works the same everywhere; nothing here claims a local office.
const PLACES = [
  // [slug, name, region, nation, lat, lon, kind]
  ['london', 'London', 'Greater London', 'england', 51.507, -0.128, 'city'],
  ['birmingham', 'Birmingham', 'West Midlands', 'england', 52.486, -1.890, 'city'],
  ['manchester', 'Manchester', 'Greater Manchester', 'england', 53.481, -2.242, 'city'],
  ['leeds', 'Leeds', 'West Yorkshire', 'england', 53.801, -1.549, 'city'],
  ['liverpool', 'Liverpool', 'Merseyside', 'england', 53.408, -2.992, 'city'],
  ['sheffield', 'Sheffield', 'South Yorkshire', 'england', 53.381, -1.470, 'city'],
  ['bristol', 'Bristol', 'South West England', 'england', 51.455, -2.588, 'city'],
  ['newcastle', 'Newcastle upon Tyne', 'Tyne and Wear', 'england', 54.978, -1.618, 'city'],
  ['nottingham', 'Nottingham', 'East Midlands', 'england', 52.954, -1.158, 'city'],
  ['leicester', 'Leicester', 'East Midlands', 'england', 52.637, -1.140, 'city'],
  ['coventry', 'Coventry', 'West Midlands', 'england', 52.407, -1.512, 'city'],
  ['bradford', 'Bradford', 'West Yorkshire', 'england', 53.796, -1.759, 'city'],
  ['southampton', 'Southampton', 'Hampshire', 'england', 50.909, -1.404, 'city'],
  ['portsmouth', 'Portsmouth', 'Hampshire', 'england', 50.819, -1.088, 'city'],
  ['brighton', 'Brighton and Hove', 'East Sussex', 'england', 50.822, -0.137, 'city'],
  ['reading', 'Reading', 'Berkshire', 'england', 51.454, -0.978, 'town'],
  ['oxford', 'Oxford', 'Oxfordshire', 'england', 51.752, -1.258, 'city'],
  ['cambridge', 'Cambridge', 'Cambridgeshire', 'england', 52.205, 0.122, 'city'],
  ['milton-keynes', 'Milton Keynes', 'Buckinghamshire', 'england', 52.041, -0.759, 'city'],
  ['norwich', 'Norwich', 'Norfolk', 'england', 52.630, 1.297, 'city'],
  ['york', 'York', 'North Yorkshire', 'england', 53.960, -1.087, 'city'],
  ['hull', 'Hull', 'East Yorkshire', 'england', 53.744, -0.332, 'city'],
  ['plymouth', 'Plymouth', 'Devon', 'england', 50.375, -4.143, 'city'],
  ['exeter', 'Exeter', 'Devon', 'england', 50.718, -3.534, 'city'],
  ['bath', 'Bath', 'Somerset', 'england', 51.381, -2.359, 'city'],
  ['stoke-on-trent', 'Stoke-on-Trent', 'Staffordshire', 'england', 53.003, -2.180, 'city'],
  ['derby', 'Derby', 'East Midlands', 'england', 52.922, -1.476, 'city'],
  ['wolverhampton', 'Wolverhampton', 'West Midlands', 'england', 52.587, -2.129, 'city'],
  ['sunderland', 'Sunderland', 'Tyne and Wear', 'england', 54.906, -1.381, 'city'],
  ['luton', 'Luton', 'Bedfordshire', 'england', 51.879, -0.418, 'town'],
  ['bournemouth', 'Bournemouth', 'Dorset', 'england', 50.720, -1.880, 'town'],
  ['canterbury', 'Canterbury', 'Kent', 'england', 51.280, 1.079, 'city'],
  ['cardiff', 'Cardiff', 'South Wales', 'wales', 51.481, -3.179, 'city'],
  ['swansea', 'Swansea', 'South Wales', 'wales', 51.621, -3.944, 'city'],
  ['newport', 'Newport', 'South Wales', 'wales', 51.588, -2.998, 'city'],
  ['edinburgh', 'Edinburgh', 'Lothian', 'scotland', 55.953, -3.188, 'city'],
  ['glasgow', 'Glasgow', 'Strathclyde', 'scotland', 55.864, -4.252, 'city'],
  ['aberdeen', 'Aberdeen', 'North East Scotland', 'scotland', 57.149, -2.094, 'city'],
  ['dundee', 'Dundee', 'Tayside', 'scotland', 56.462, -2.970, 'city'],
  ['belfast', 'Belfast', 'County Antrim', 'ni', 54.597, -5.930, 'city'],
  // London boroughs
  ['barking-and-dagenham', 'Barking and Dagenham', 'East London', 'england', 51.554, 0.134, 'borough'],
  ['barnet', 'Barnet', 'North London', 'england', 51.625, -0.152, 'borough'],
  ['bexley', 'Bexley', 'South East London', 'england', 51.441, 0.149, 'borough'],
  ['brent', 'Brent', 'North West London', 'england', 51.567, -0.271, 'borough'],
  ['bromley', 'Bromley', 'South East London', 'england', 51.406, 0.014, 'borough'],
  ['camden', 'Camden', 'North London', 'england', 51.529, -0.125, 'borough'],
  ['croydon', 'Croydon', 'South London', 'england', 51.372, -0.101, 'borough'],
  ['ealing', 'Ealing', 'West London', 'england', 51.513, -0.305, 'borough'],
  ['enfield', 'Enfield', 'North London', 'england', 51.652, -0.081, 'borough'],
  ['greenwich', 'Greenwich', 'South East London', 'england', 51.483, 0.006, 'borough'],
  ['hackney', 'Hackney', 'East London', 'england', 51.545, -0.055, 'borough'],
  ['hammersmith-and-fulham', 'Hammersmith and Fulham', 'West London', 'england', 51.493, -0.223, 'borough'],
  ['haringey', 'Haringey', 'North London', 'england', 51.590, -0.111, 'borough'],
  ['harrow', 'Harrow', 'North West London', 'england', 51.580, -0.334, 'borough'],
  ['havering', 'Havering', 'East London', 'england', 51.577, 0.212, 'borough'],
  ['hillingdon', 'Hillingdon', 'West London', 'england', 51.534, -0.476, 'borough'],
  ['hounslow', 'Hounslow', 'West London', 'england', 51.468, -0.361, 'borough'],
  ['islington', 'Islington', 'North London', 'england', 51.538, -0.103, 'borough'],
  ['kensington-and-chelsea', 'Kensington and Chelsea', 'West London', 'england', 51.499, -0.194, 'borough'],
  ['kingston-upon-thames', 'Kingston upon Thames', 'South West London', 'england', 51.412, -0.300, 'borough'],
  ['lambeth', 'Lambeth', 'South London', 'england', 51.460, -0.121, 'borough'],
  ['lewisham', 'Lewisham', 'South East London', 'england', 51.445, -0.021, 'borough'],
  ['merton', 'Merton', 'South West London', 'england', 51.410, -0.188, 'borough'],
  ['newham', 'Newham', 'East London', 'england', 51.525, 0.035, 'borough'],
  ['redbridge', 'Redbridge', 'East London', 'england', 51.559, 0.074, 'borough'],
  ['richmond-upon-thames', 'Richmond upon Thames', 'South West London', 'england', 51.461, -0.303, 'borough'],
  ['southwark', 'Southwark', 'South London', 'england', 51.503, -0.088, 'borough'],
  ['sutton', 'Sutton', 'South London', 'england', 51.361, -0.194, 'borough'],
  ['tower-hamlets', 'Tower Hamlets', 'East London', 'england', 51.520, -0.030, 'borough'],
  ['waltham-forest', 'Waltham Forest', 'East London', 'england', 51.588, -0.012, 'borough'],
  ['wandsworth', 'Wandsworth', 'South West London', 'england', 51.457, -0.193, 'borough'],
  ['westminster', 'Westminster', 'Central London', 'england', 51.497, -0.137, 'borough'],
  ['city-of-london', 'the City of London', 'Central London', 'england', 51.515, -0.093, 'borough'],
].map(([slug, name, region, nation, lat, lon, kind]) => ({ slug, name, region, nation, lat, lon, kind }));

// The rules that differ by nation. Kept general and factual; every page says to check current guidance.
const NATION = {
  england: { label: 'England', tenancy: 'assured shorthold tenancy (and, under the Renters’ Rights Act, periodic assured tenancies)', who: 'tenant',
    deposit: 'A tenancy deposit must be protected in a government-approved scheme (DPS, mydeposits or TDS) within 30 days of receiving it, and the tenant given the prescribed information.',
    disputes: 'At the end of the tenancy, the scheme’s free dispute service decides on the evidence, above all how the property was at check-in compared with check-out.',
    safety: 'Rented homes need a Gas Safety check every 12 months, an electrical safety inspection (EICR) at least every 5 years, and a valid EPC before they are let.' },
  wales: { label: 'Wales', tenancy: 'occupation contract under the Renting Homes (Wales) Act 2016', who: 'contract-holder',
    deposit: 'A deposit must be protected in an approved scheme (DPS, mydeposits or TDS) within 30 days of receiving it, with the prescribed information given to the contract-holder.',
    disputes: 'If you can’t agree on deductions, the scheme’s dispute service decides on the evidence, so a dated record of the condition at the start is what matters.',
    safety: 'Landlords must make sure the home is fit for human habitation, including an electrical safety check (EICR) at least every 5 years, an annual Gas Safety check and a valid EPC.' },
  scotland: { label: 'Scotland', tenancy: 'private residential tenancy', who: 'tenant',
    deposit: 'A deposit must be paid into an approved scheme (SafeDeposits Scotland, Letting Protection Service Scotland or mydeposits Scotland) within 30 working days of the tenancy starting.',
    disputes: 'The scheme’s free adjudication service decides disputed deductions on the evidence, so an inventory with dated photos at the start of the tenancy carries real weight.',
    safety: 'The repairing standard includes an electrical installation check (EICR) at least every 5 years, an annual Gas Safety check, working smoke and heat alarms, and a valid EPC.' },
  ni: { label: 'Northern Ireland', tenancy: 'private tenancy', who: 'tenant',
    deposit: 'A deposit must be protected in an approved scheme (such as TDS Northern Ireland or the Letting Protection Service Northern Ireland) within 28 days of receiving it, with the required information given to the tenant.',
    disputes: 'Disputed deductions can go to the scheme’s dispute resolution, which looks at the evidence of the condition at the start and end of the tenancy.',
    safety: 'Landlords need an annual Gas Safety check where there is gas, regular electrical safety checks, and a valid EPC when the property is let.' },
};

const R = d => d * Math.PI / 180;
const dist = (a, b) => { const x = R(b.lon - a.lon) * Math.cos(R((a.lat + b.lat) / 2)), y = R(b.lat - a.lat); return Math.sqrt(x * x + y * y) * 6371; };
const nearest = (p, n) => PLACES.filter(q => q !== p && (p.kind === 'borough' ? true : q.kind !== 'borough' || q.slug === 'london')).map(q => [q, dist(p, q)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(x => x[0]);

function mount(app, { renderPage, escHtml }){
  const e = escHtml;
  const BASE_PATH = '/inventory-reports';
  const where = p => p.kind === 'borough' ? (p.slug === 'city-of-london' ? 'the City of London' : p.name + ', London') : p.name;

  function page(p){
    const N = NATION[p.nation], near = nearest(p, 6), w = where(p);
    const title = 'DIY inventory and check-in reports in ' + p.name.replace(/^the /, '');
    const faqs = [
      ['How much does an inventory report cost in ' + w + '?', 'With DIY Inventory it’s £30 per report, whatever the size of the property: a check-in, a check-out or an inspection. It’s free to start, and you pay when the finished report is downloaded. An inventory clerk typically charges several hundred pounds for each visit.'],
      ['Do I need an inventory clerk in ' + w + '?', 'No. You can do the inventory yourself on your phone, or send your ' + N.who + ' a link to do it. The app gives every room a photo checklist, stamps the date and time on every photo, and both sides sign the report.'],
      ['Will the report help with a deposit dispute in ' + N.label + '?', N.disputes + ' Your report gives you that evidence: dated photos of every room, the condition of every item, meter readings and keys, signed by both sides.'],
      ['Can I book a Gas Safety certificate, EICR or EPC in ' + w + '?', 'You can request one on our landlord services page at a fixed price. We’ll check we cover the area and confirm a date with you.'],
    ];
    const body = `<div class="page-head"><div class="wrap"><p style="margin:0 0 6px"><a href="${BASE_PATH}">← All areas</a></p><span class="kicker">${e(p.region)} · ${e(N.label)}</span><h1>${e(title)}</h1><p>Check-in and check-out reports and mid-tenancy inspections for landlords, letting agents and tenants in ${e(w)}, done on your phone. Dated photos, every item’s condition, signed by both sides, and the PDF ready the moment it’s signed. £30 per report.</p></div></div>
<section class="tight"><div class="wrap">
  <div class="two">
    <div class="card"><h3>Why do it yourself in ${e(p.name.replace(/^the /, ''))}?</h3><ul>
      <li>No appointment to wait for: do it whenever you have the keys, before the ${e(N.who)} moves in or with them there.</li>
      <li>£30 a report instead of a clerk’s fee for every check-in, inspection and check-out.</li>
      <li>The report is ready instantly, so it can be sent and signed on move-in day.</li>
      <li>Check-outs and inspections start from the last report and show what has changed, side by side.</li>
    </ul></div>
    <div class="card"><h3>Renting in ${e(N.label)}: the basics</h3><ul>
      <li>Most lets are a ${e(N.tenancy)}.</li>
      <li>${e(N.deposit)}</li>
      <li>${e(N.safety)}</li>
    </ul><p class="sub" style="margin:10px 0 0;font-size:13.5px">General information, not legal advice. Check the current guidance for ${e(N.label)}.</p></div>
  </div>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">How it works</span><h2>Your ${e(p.name.replace(/^the /, ''))} inventory in four steps</h2><p>Everything happens in your phone’s browser. Nothing to install.</p></div>
  <div class="steps four">
    <div class="card step"><div class="n">1</div><h3>Set up the property</h3><p>Type the postcode, pick the address, and choose the rooms. Each room gets its own photo checklist.</p></div>
    <div class="card step"><div class="n">2</div><h3>Photograph every room</h3><p>The camera steps through each item and stamps the date and time on every photo. Meters and keys too.</p></div>
    <div class="card step"><div class="n">3</div><h3>Sign, and it’s ready</h3><p>Sign on the screen and the PDF report is made straight away. Send the ${e(N.who)} a link to check and sign it.</p></div>
    <div class="card step"><div class="n">4</div><h3>Compare at check-out</h3><p>Start the check-out from the check-in and see exactly what has changed, with photos side by side.</p></div>
  </div>
  <p style="text-align:center;margin:26px 0 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn primary" href="/app">Start free</a><a class="btn ghost" href="/example-report">See an example report</a></p>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>Inventories in ${e(p.name.replace(/^the /, ''))}: questions and answers</h2></div>
  <div class="faq">${faqs.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Nearby</span><h2>Also covering</h2></div>
  <p style="text-align:center;line-height:2.2">${near.map(q => `<a class="btn ghost sm" style="margin:0 4px" href="${BASE_PATH}/${q.slug}">${e(q.name.replace(/^the /, ''))}</a>`).join('')}<a class="btn ghost sm" style="margin:0 4px" href="${BASE_PATH}">All areas</a></p>
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Ready when you have the keys</h2><p>Start your ${e(p.name.replace(/^the /, ''))} inventory today, on your phone. It’s free until you download it.</p><a class="btn" href="/app">Start free</a></div></div></div>`;
    return { key: 'locations', path: BASE_PATH + '/' + p.slug, title: title + ' · £30 · DIY Inventory', og: title,
      desc: 'Do your own inventory, check-in or check-out report in ' + w + ' on your phone: dated photos, every item’s condition, signed by both sides, ready instantly. £30 per report, free to start.', body,
      jsonld: base => [
        { '@type': 'Service', name: 'Inventory and check-in reports in ' + p.name.replace(/^the /, ''), serviceType: 'Property inventory report', provider: { '@id': base + '/#org' },
          areaServed: { '@type': p.kind === 'borough' ? 'AdministrativeArea' : 'City', name: p.name.replace(/^the /, ''), containedInPlace: { '@type': 'Country', name: 'United Kingdom' } },
          offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } },
        { '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        { '@type': 'BreadcrumbList', itemListElement: [['Home', '/'], ['Areas', BASE_PATH], [p.name.replace(/^the /, ''), BASE_PATH + '/' + p.slug]].map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) },
      ] };
  }

  function index(){
    const group = (title, list) => `<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 10px">${e(title)}</h3><p style="margin:0;line-height:2.2">${list.map(p => `<a class="btn ghost sm" style="margin:0 6px 0 0" href="${BASE_PATH}/${p.slug}">${e(p.name.replace(/^the /, ''))}</a>`).join('')}</p></div>`;
    const by = k => PLACES.filter(k).sort((a, b) => a.name.replace(/^the /, '').localeCompare(b.name.replace(/^the /, '')));
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Across the UK</span><h1>Inventory and check-in reports, wherever you let</h1><p>DIY Inventory works anywhere: do the check-in, inspections and check-out on your phone, for £30 a report. Pick your area for local information.</p></div></div>
<section class="tight"><div class="wrap">
${group('London boroughs', by(p => p.kind === 'borough'))}
${group('England', by(p => p.nation === 'england' && p.kind !== 'borough'))}
${group('Wales', by(p => p.nation === 'wales'))}
${group('Scotland', by(p => p.nation === 'scotland'))}
${group('Northern Ireland', by(p => p.nation === 'ni'))}
<p class="sub" style="text-align:center">Not listed? It works the same everywhere in the UK, and in other countries too. <a href="/app">Start free</a>.</p>
</div></section>`;
    return { key: 'locations', path: BASE_PATH, title: 'Inventory and check-in reports across the UK · DIY Inventory', og: 'Inventory reports across the UK',
      desc: 'Do your own inventory, check-in and check-out reports anywhere in the UK, on your phone. £30 per report. Pick your city or London borough.', body,
      jsonld: base => [{ '@type': 'BreadcrumbList', itemListElement: [['Home', '/'], ['Areas', BASE_PATH]].map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) }] };
  }

  const send = pg => (req, res) => res.type('html').send(renderPage(pg, req));
  app.get([BASE_PATH, BASE_PATH + '/'], send(index()));
  PLACES.forEach(p => app.get([BASE_PATH + '/' + p.slug, BASE_PATH + '/' + p.slug + '/'], send(page(p))));
  return { paths: [BASE_PATH].concat(PLACES.map(p => BASE_PATH + '/' + p.slug)) };
}

module.exports = { mount, PLACES };
