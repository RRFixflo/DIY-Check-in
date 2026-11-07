// The United States: /us (the hub), /us/<state> for every state and D.C., and /us/move-in-checklist.
// Written in American English for renters and landlords alike: renters for peace of mind and to get their
// security deposit back, landlords for evidence behind any deduction. Each state page carries that state's
// security deposit rules (content/us-states.json: researched November 2026 from public summaries of each
// statute; re-check yearly), its cities that have their own page (locations.js), nearby states, FAQs and
// structured data (Service with areaServed, FAQPage, BreadcrumbList). The app is the same everywhere: a US
// address makes it speak American English (move-in inspection, lease, ZIP code; see usText() in public/index.html).
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'us-states.json'), 'utf8'));
const STATES = DATA.states;
const CHECKED = 'November 2026';
const PRICE = '{{USD}} per report (charged as £30 by card; your bank converts it)';   // {{USD}}: today's rate, filled in by renderPage()
const BASE = '/us';

const R = d => d * Math.PI / 180;
const dist = (a, b) => { const x = R(b.lon - a.lon) * Math.cos(R((a.lat + b.lat) / 2)), y = R(b.lat - a.lat); return Math.sqrt(x * x + y * y); };
const nearby = (s, n) => STATES.filter(q => q !== s).map(q => [q, dist(s, q)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(x => x[0]);
const lower = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
const noDot = t => String(t || '').replace(/\.$/, '');

// What to photograph, room by room (the app's own checklist, in American English).
const CHECKLIST = [
  ['Outside and entry', ['Front of the property (the first photo of every report)', 'Front door, inside and out, with locks', 'Mailbox and doorbell', 'Porch, steps and walkways', 'Yard, fences and gates']],
  ['Living room', ['Walls and ceiling', 'Floors or carpet', 'Windows, screens and blinds', 'Light fixtures, switches and outlets', 'Heating and cooling vents, thermostat']],
  ['Kitchen', ['Stove, cooktop and oven (inside too)', 'Refrigerator and freezer', 'Dishwasher and microwave', 'Countertops and cabinets', 'Sink, faucet and garbage disposal', 'Range hood or exhaust fan']],
  ['Bedrooms', ['Walls, ceiling and floor', 'Closet, doors and shelves', 'Windows and blinds', 'Outlets and light fixtures']],
  ['Bathrooms', ['Toilet', 'Tub or shower, tiles and grout', 'Sink, faucet and vanity', 'Mirror and medicine cabinet', 'Exhaust fan', 'Any signs of mold or leaks']],
  ['Laundry, utilities and safety', ['Washer and dryer', 'Water heater and furnace', 'Smoke and carbon monoxide detectors', 'Electric, gas and water meter readings', 'Every key, fob and garage opener handed over']],
];

function mount(app, { renderPage, escHtml, PLACES }){
  const e = escHtml;
  const cities = s => (PLACES || []).filter(p => p.nation === 'us' && p.region === s.name).sort((a, b) => a.name.localeCompare(b.name));
  const crumbs = (base, list) => ({ '@type': 'BreadcrumbList', itemListElement: list.map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) });
  const faqLd = faqs => ({ '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  const faqHtml = faqs => `<div class="faq">${faqs.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div>`;
  const offer = { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP', description: 'One report, paid when the finished report is downloaded. Free to start. Charged in pounds (£30); your bank converts it to dollars.' };

  const twoSides = where => `<div class="two">
    <div class="card"><h3>Renters: peace of mind, and your deposit back</h3><ul>
      <li>Record exactly how the ${where ? 'place in ' + e(where) : 'place'} looked the day you got the keys, before a single box comes in.</li>
      <li>Every photo has the date and time burned into the picture, so nobody can say it was taken later.</li>
      <li>Send your landlord or property manager a link to the report, so they have it in writing.</li>
      <li>At move-out, compare room by room and show what was already there: normal wear and tear can’t come out of your deposit.</li>
    </ul></div>
    <div class="card"><h3>Landlords: evidence behind every deduction</h3><ul>
      <li>A full move-in and move-out inspection for every unit, the same way every time, without paying an inspector per visit.</li>
      <li>Send your tenant a link and they do it themselves, then sign it, or do it yourself before they move in.</li>
      <li>The move-out inspection starts from the move-in one and shows what changed, with photos side by side.</li>
      <li>Back up an itemized list of deductions with dated photos, if the deposit is ever disputed or goes to small claims court.</li>
    </ul></div>
  </div>`;

  const steps = `<div class="steps four">
    <div class="card step"><div class="n">1</div><h3>Add the property</h3><p>Choose United States, enter the address, and pick the rooms. Each room gets its own photo checklist.</p></div>
    <div class="card step"><div class="n">2</div><h3>Photograph every room</h3><p>The camera walks you through each item and stamps the date and time on every photo. Meters and keys too.</p></div>
    <div class="card step"><div class="n">3</div><h3>Sign, and it’s ready</h3><p>Sign on the screen and the PDF report is made instantly. Send the other side a link to check and sign it.</p></div>
    <div class="card step"><div class="n">4</div><h3>Compare at move-out</h3><p>Start the move-out inspection from the move-in one and see exactly what changed, with photos side by side.</p></div>
  </div>`;

  const cta = `<p style="text-align:center;margin:26px 0 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn primary" href="/app">Start free</a><a class="btn ghost" href="/example-report">See an example report</a></p>`;

  function rulesTable(s){
    const rows = [
      ['Maximum security deposit', s.cap],
      ['Deadline to return it', s.returnDays],
      ['What the landlord must give', s.itemize],
      ['Move-in checklist or inspection', s.moveIn],
      ['Interest on the deposit', s.interest],
      ['The law', s.statute],
    ].filter(r => r[1]);
    return `<dl style="margin:0">${rows.map(([k, v], i) => `<div style="padding:12px 0;${i ? 'border-top:1px solid var(--line, rgba(0,0,0,.1));' : ''}"><dt style="font-weight:700;margin:0 0 4px">${e(k)}</dt><dd style="margin:0">${e(v)}</dd></div>`).join('')}</dl>
    ${s.notes ? `<p style="margin:6px 0 0">${e(s.notes)}</p>` : ''}
    <p class="sub" style="margin:10px 0 0;font-size:13.5px">Checked ${CHECKED}. General information, not legal advice. Laws change and some cities add their own rules, so check the current statute or ask a local attorney or tenant rights organization.</p>`;
  }

  function statePage(s){
    const name = s.name, dc = s.code === 'dc', inName = dc ? 'Washington, D.C.' : name;
    const cs = cities(s), near = nearby(s, 6);
    const required = s.moveIn && !/^No statewide/i.test(s.moveIn);
    const faqs = [
      s.returnDays ? ['How long does a landlord have to return a security deposit in ' + inName + '?', 'Within ' + lower(noDot(s.returnDays).replace(/^within /i, '')) + '.' + (s.itemize ? ' ' + s.itemize.replace(/\.?$/, '.') : '') + ' Laws change, so check the current statute (' + (s.statute || 'your state’s landlord-tenant law') + ').'] : null,
      s.cap ? ['How much can a landlord charge for a security deposit in ' + inName + '?', (/^No statewide/i.test(s.cap) ? 'There is no statewide limit on the amount' : 'The limit is ' + lower(noDot(s.cap))) + '. Some cities have their own rules.'] : null,
      ['Is a move-in inspection checklist required in ' + inName + '?', required ? s.moveIn.replace(/\.?$/, '.') + ' DIY Inventory gives you that record room by room, with dated photos and signatures.' : 'There is no statewide requirement, but a move-in checklist with dated photos, signed by both sides, is the best evidence there is if the deposit is ever disputed. DIY Inventory makes one on your phone.'],
      ['Can a renter do their own move-in inspection?', 'Yes. You don’t need the landlord’s permission to record the condition of your own home. Do it before you unpack, then send the report to your landlord or property manager so they have a copy, and ask them to sign it. It protects your deposit when you move out.'],
      ['Can a landlord deduct for normal wear and tear?', 'Generally no. Deductions are for unpaid rent and for damage beyond normal wear and tear, such as holes in walls, broken fixtures or heavy stains, not faded paint or worn carpet from everyday living. Dated photos from move-in are how you tell the two apart.'],
      ['How much does a move-in inspection report cost?', 'With DIY Inventory it’s ' + PRICE + ', whatever the size of the home: a move-in inspection, a move-out inspection or a routine inspection during the lease. It’s free to start, and you only pay when the finished report is downloaded. No subscription.'],
    ].filter(Boolean);
    const title = name + ' Move-In Inspection Checklist & Deposit Law (2026)';
    const seoTitle = (title.length <= 62 ? title : name + ' Move-In Checklist & Deposit Law (2026)');
    const lead = 'For renters and landlords in ' + inName + ': record the condition of the home on your phone at move-in and move-out, with dated photos of every room, signed by both sides. ' + (s.returnDays ? 'In ' + inName + ', the deposit must be returned within ' + lower(noDot(s.returnDays).replace(/^within /i, '')) + '.' : '');
    const body = `<div class="page-head"><div class="wrap"><p style="margin:0 0 6px"><a href="${BASE}">← All states</a></p><span class="kicker">${e(name)} · United States</span><h1>${e(name)} move-in and move-out inspection checklist</h1><p>${e(lead)}</p>${cta}</div></div>
<section class="tight"><div class="wrap">${twoSides(inName)}</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">The rules</span><h2>${e(name)} security deposit law, in plain English</h2><p>What the law says about the deposit, and why a move-in record matters.</p></div>
  <div class="card">${rulesTable(s)}</div>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">How it works</span><h2>Your ${e(inName)} move-in inspection in four steps</h2><p>Everything happens in your phone’s web browser. Nothing to install.</p></div>
  ${steps}
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Checklist</span><h2>What to photograph at move-in</h2><p>The app walks you through all of this, room by room. <a href="${BASE}/move-in-checklist">See the full checklist</a>.</p></div>
  <div class="two">${CHECKLIST.slice(0, 4).map(([room, items]) => `<div class="card"><h3>${e(room)}</h3><ul>${items.map(i => `<li>${e(i)}</li>`).join('')}</ul></div>`).join('')}</div>
</div></section>
${cs.length ? `<section style="padding-top:0"><div class="wrap"><div class="sec-head"><span class="kicker">Cities</span><h2>Move-in inspections in ${e(name)} cities</h2></div>
  <p style="text-align:center;line-height:2.2">${cs.map(p => `<a class="btn ghost sm" style="margin:0 4px" href="/inventory-reports/${p.slug}">${e(p.name)}</a>`).join('')}</p></div></section>` : ''}
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>${e(name)} move-in inspections and deposits: questions and answers</h2></div>
  ${faqHtml(faqs)}
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Nearby</span><h2>Nearby states</h2></div>
  <p style="text-align:center;line-height:2.2">${near.map(q => `<a class="btn ghost sm" style="margin:0 4px" href="${BASE}/${q.slug}">${e(q.name)}</a>`).join('')}<a class="btn ghost sm" style="margin:0 4px" href="${BASE}">All states</a></p>
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Ready when you get the keys</h2><p>Start your ${e(inName)} move-in inspection today, on your phone. It’s free until you download it.</p><a class="btn" href="/app">Start free</a></div></div></div>`;
    const short = s.returnDays && (/^[^,(]*?\b(days?|months?)\b/i.exec(s.returnDays) || [])[0];
    let desc = name + ' security deposit law' + (short ? ' (returned within ' + lower(short.replace(/^within /i, '')) + ')' : '') + ' and a move-in inspection app for renters and landlords: dated photos, signed report. Free to start.';
    if (desc.length > 160) desc = desc.replace(' and a move-in inspection app for renters and landlords', ', and a move-in inspection app for renters and landlords').replace(', signed report', '');
    return { key: 'locations', lang: 'en-US', path: BASE + '/' + s.slug, title: seoTitle, og: name + ' move-in inspection checklist and security deposit law', desc, body,
      jsonld: base => [
        { '@type': 'Service', name: 'Move-in and move-out inspection reports in ' + inName, serviceType: 'Rental move-in and move-out inspection report', provider: { '@id': base + '/#org' },
          areaServed: { '@type': 'State', name: inName, containedInPlace: { '@type': 'Country', name: 'United States' } }, audience: [{ '@type': 'Audience', audienceType: 'Renters' }, { '@type': 'Audience', audienceType: 'Landlords and property managers' }], offers: offer },
        faqLd(faqs),
        crumbs(base, [['Home', '/'], ['United States', BASE], [name, BASE + '/' + s.slug]]),
      ] };
  }

  function hub(){
    const faqs = [
      ['What is a move-in inspection?', 'A record of the condition of a rental home on the day the renter moves in: every room and item, with photos, signed by the renter and the landlord. At move-out it is compared with a move-out inspection to decide what, if anything, comes out of the security deposit.'],
      ['Who should do it, the renter or the landlord?', 'Either, or both. Renters do it for peace of mind and to protect their deposit; landlords do it to back up any deduction. With DIY Inventory, whoever does it can send the other a link to check, comment and sign.'],
      ['Does it work in every state?', 'Yes. DIY Inventory runs in any phone’s web browser, in all 50 states and Washington, D.C. Choose United States when you add the property: the address, dates and wording follow US style (move-in inspection, lease, ZIP code).'],
      ['How much does it cost?', 'It’s ' + PRICE + '. Free to start, and you only pay when the finished report is downloaded. No subscription, no app to install.'],
      ['Will it hold up if the deposit is disputed?', 'Courts and mediators look at evidence. Your report gives you dated photos of every room, each item’s condition, meter readings and keys, signed by both sides, with the move-out inspection compared item by item against the move-in one.'],
      ['What can a landlord deduct from a security deposit?', 'Usually unpaid rent and the cost of repairing damage beyond normal wear and tear. Each state sets the deadline to return the deposit and what the landlord must send with it; see your state below.'],
    ];
    const shortCap = c => { if (!c) return 'check the statute'; if (/^No statewide/i.test(c)) return 'no statewide limit'; const t = noDot(c).replace(/ \(.*$/, '').replace(/,.*$/, '').replace(/;.*$/, ''); return lower(t) + (t !== noDot(c) ? ' (see details)' : ''); };
    const shortDays = d => { const m = d && /^[^,(]*?\b(days?|months?)\b/i.exec(d); return m ? lower(m[0].replace(/^within /i, '')) : 'check the statute'; };
    const rows = STATES.map(s => `<a class="card" style="display:block;padding:14px 16px;text-decoration:none;color:inherit" href="${BASE}/${s.slug}"><strong style="display:block;margin:0 0 4px">${e(s.name)}</strong><span style="display:block;font-size:14px;color:var(--ink-soft)">Maximum deposit: ${e(shortCap(s.cap))}</span><span style="display:block;font-size:14px;color:var(--ink-soft)">Returned within ${e(shortDays(s.returnDays))}</span></a>`).join('');
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">United States · all 50 states and D.C.</span><h1>The move-in and move-out inspection app for renters and landlords</h1><p>Record the condition of a rental home on your phone at move-in, during the lease and at move-out: a photo checklist for every room, the date and time on every photo, and a signed PDF report the moment you finish. ${e(PRICE)}. Free to start.</p>${cta}</div></div>
<section class="tight"><div class="wrap">${twoSides('')}</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">How it works</span><h2>A move-in inspection in four steps</h2><p>Everything happens in your phone’s web browser, in any state. Nothing to install.</p></div>
  ${steps}
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Your state</span><h2>Security deposit rules in every state</h2><p>Pick your state for its deposit law, what to photograph, and answers to common questions. Checked ${CHECKED}; general information, not legal advice.</p></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${rows}</div>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Free checklist</span><h2>Not sure what to photograph?</h2><p>Our <a href="${BASE}/move-in-checklist">move-in inspection checklist</a> lists every room and item, the same list the app walks you through.</p></div>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>Move-in inspections: questions and answers</h2></div>
  ${faqHtml(faqs)}
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Ready when you get the keys</h2><p>Start your move-in inspection today, on your phone. It’s free until you download it.</p><a class="btn" href="/app">Start free</a></div></div></div>`;
    return { key: 'locations', lang: 'en-US', path: BASE, title: 'Move-In Inspection App for Renters & Landlords, All 50 States',
      og: 'The move-in and move-out inspection app for renters and landlords', desc: 'Do your own move-in and move-out inspection on your phone: dated photos of every room, signed PDF report. Security deposit rules for all 50 states. Free to start.', body,
      jsonld: base => [
        { '@type': 'Service', name: 'Move-in and move-out inspection reports', serviceType: 'Rental move-in and move-out inspection report', provider: { '@id': base + '/#org' }, areaServed: { '@type': 'Country', name: 'United States' }, offers: offer },
        faqLd(faqs), crumbs(base, [['Home', '/'], ['United States', BASE]]),
        { '@type': 'ItemList', name: 'Security deposit rules by state', itemListElement: STATES.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.name, url: base + BASE + '/' + s.slug })) },
      ] };
  }

  function checklistPage(){
    const faqs = [
      ['When should I do the move-in inspection?', 'On move-in day, before you unpack, or as soon as you get the keys. Many states expect it within the first days of the lease; the sooner it is done, the less room there is for argument about when a mark appeared.'],
      ['Should the landlord be there?', 'It helps, but it isn’t necessary. Do it yourself with dated photos, then send the landlord or property manager the report to check and sign. If they don’t sign, you still have dated proof that you sent it.'],
      ['What should I write down?', 'For each item: its condition (new, good, fair or poor), any marks or damage, whether it works, and how clean it is. Photograph it wide, then close up on any damage.'],
      ['Is there a printable version?', 'This page prints cleanly from your browser. For dated photos and a signed report, use the app on your phone: it walks through the same checklist.'],
    ];
    const body = `<div class="page-head"><div class="wrap"><p style="margin:0 0 6px"><a href="${BASE}">← United States</a></p><span class="kicker">Free checklist</span><h1>Move-in inspection checklist for renters and landlords</h1><p>Every room and item to check and photograph when you move into a rental home, and again at move-out. The same list the DIY Inventory app walks you through, with the date and time stamped on every photo.</p>${cta}</div></div>
<section class="tight"><div class="wrap"><div class="two">
${CHECKLIST.map(([room, items]) => `<div class="card"><h2 style="font-size:1.25rem;margin:0 0 8px">${e(room)}</h2><ul>${items.map(i => `<li>${e(i)}</li>`).join('')}</ul></div>`).join('\n')}
</div></div></section>
<section style="padding-top:0"><div class="wrap"><div class="card"><h2 style="margin-top:0">Tips that win deposit disputes</h2><ul>
  <li>Take a wide photo of each wall and the floor, then close-ups of every mark, chip or stain.</li>
  <li>Test everything: faucets, burners, appliances, lights, outlets, windows, locks, smoke and CO detectors.</li>
  <li>Photograph meter readings and every key you are given.</li>
  <li>Get the report signed by both sides, or at least sent to the other side, within the first few days.</li>
  <li>Keep it until the deposit is back. At move-out, do the same again and compare.</li>
</ul></div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>Move-in checklist: questions and answers</h2></div>
  ${faqHtml(faqs)}
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="sec-head"><span class="kicker">Your state</span><h2>Security deposit rules by state</h2></div>
  <p style="text-align:center;line-height:2.2">${STATES.map(s => `<a class="btn ghost sm" style="margin:0 4px" href="${BASE}/${s.slug}">${e(s.name)}</a>`).join('')}</p></div></section>`;
    return { key: 'locations', lang: 'en-US', path: BASE + '/move-in-checklist', title: 'Move-In Inspection Checklist for Renters & Landlords (Free)',
      og: 'Move-in inspection checklist for renters and landlords', desc: 'A free, room-by-room move-in inspection checklist for rental homes: what to check and photograph to protect the security deposit, for renters and landlords.', body,
      jsonld: base => [faqLd(faqs), crumbs(base, [['Home', '/'], ['United States', BASE], ['Move-in checklist', BASE + '/move-in-checklist']]),
        { '@type': 'HowTo', name: 'How to do a move-in inspection', step: CHECKLIST.map(([room, items], i) => ({ '@type': 'HowToStep', position: i + 1, name: room, text: items.join('; ') + '.' })) }] };
  }

  const send = pg => (req, res) => res.type('html').send(renderPage(pg, req));
  const pages = [hub(), checklistPage()].concat(STATES.map(statePage));
  pages.forEach(pg => app.get([pg.path, pg.path + '/'], send(pg)));
  // Short and common forms: /usa, /us/tx, /us/new_york.
  app.get(['/usa', '/united-states'], (req, res) => res.redirect(301, BASE));
  app.get(BASE + '/:x', (req, res, next) => {
    const x = String(req.params.x).toLowerCase(), s = STATES.find(q => q.code === x || q.slug === x.replace(/[_ ]+/g, '-'));
    if (s && x !== s.slug) return res.redirect(301, BASE + '/' + s.slug);
    next();
  });
  return { paths: pages.map(p => p.path), bodies: pages.map(p => p.body), states: STATES };
}

module.exports = { mount, STATES };
