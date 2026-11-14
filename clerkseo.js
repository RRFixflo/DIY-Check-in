// Search pages for inventory companies and clerks, each for a different search, all leading to /inventory-companies
// (the app in their own brand for a monthly fee, "Get a price and a free trial"):
//   /inventory-software-for-inventory-clerks   clerk firms looking for inventory software
//   /white-label-inventory-app                 firms wanting their own branded app
//   /property-inventory-software               the head term: property inventory software / inventory report software
//   /check-out-report-software                 check-outs compared with the check-in
//   /property-inspection-app                   mid-term and periodic inspections
//   /start-an-inventory-clerk-business         people starting out as an inventory clerk
// Each has its own wording, a comparison or worked example, questions (FAQPage), SoftwareApplication + BreadcrumbList
// JSON-LD and links to the others. No price is published (each company is quoted); never name another company.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HUB = '/inventory-companies';

const PAGES = [
  {
    path: '/inventory-software-for-inventory-clerks', short: 'Inventory software for inventory clerks',
    title: 'Inventory Software for Inventory Clerks & Clerk Firms',
    desc: 'Inventory software for UK inventory clerks: a guided phone app, dated photos, check-out comparison and tenant sign-off, in your own brand for one monthly fee.',
    kicker: 'For inventory clerks', h1: 'Inventory software built around the walk-round',
    lead: 'Your clerks are paid for the visit, not the typing. DIY Inventory turns the walk-round into the report: a guided checklist for every room, an in-app camera that steps through each item, and a signed PDF ready before the clerk leaves the property. In your brand, for one monthly fee.',
    sections: [
      ['A clerk’s day, with and without it', '<div class="as-tw"><table><thead><tr><th></th><th>Notes, photos and typing up</th><th>DIY Inventory</th></tr></thead><tbody><tr><td>On site</td><td>Photos on one device, notes on another</td><td>Photos and notes together, item by item</td></tr><tr><td>Back at the office</td><td>Match photos to items, type the report</td><td>Nothing: the report is already made</td></tr><tr><td>Photo evidence</td><td>Date in the file’s details, easily lost</td><td>Date and time burned into every photo</td></tr><tr><td>Tenant sign-off</td><td>Print, chase, scan</td><td>A link: they comment and sign on their phone</td></tr><tr><td>Check-out</td><td>Open the check-in, compare by eye</td><td>Starts from the check-in, changes listed</td></tr></tbody></table></div>'],
      ['What your clerks get on their phone', '<ul><li><b>A checklist for every room</b>, with items they can add, remove or rename as they go.</li><li><b>An in-app camera</b> that stays open and moves through each item, then the room’s general views, with the next item named on the button.</li><li><b>Condition, description, marks, cleanliness and whether it works</b> for each item, plus quantities where they matter.</li><li><b>Meters, keys and alarms</b>, each with its own photos and readings.</li><li><b>Signature and declaration</b>, and the PDF built on the phone straight away.</li></ul>'],
      ['What the business gets', '<ul><li><b>Your brand</b> on the app, the reports and the emails, set up for you.</li><li><b>Every report backed up online</b> as it is made, so a lost phone loses nothing.</li><li><b>A dashboard of every report</b>, with PDFs to download and the sign-off status.</li><li><b>One monthly fee</b> for the team, with no charge per report on top.</li></ul>'],
    ],
    faqs: [
      ['Does it work offline?', 'The report is built and saved on the phone as the clerk works, so a weak signal doesn’t stop the walk-round. It is backed up online as soon as there is a connection.'],
      ['How many photos can a room have?', 'At least 8 per room and up to 25, with at least one photo of every item. Each photo in the PDF links to the full-size picture.'],
      ['Can clerks change the checklist?', 'Yes. Rooms and items can be added, removed or renamed on site, and items that aren’t at the property are left out of the report.'],
      ['How is it priced?', 'One monthly fee for your company, based on your team and how many reports you do. Ask for a price and a trial on the inventory companies page.'],
    ],
  },
  {
    path: '/white-label-inventory-app', short: 'White-label inventory app',
    title: 'White-Label Inventory App: Your Brand on Every Report',
    desc: 'A white-label property inventory app for inventory companies: your logo, colours and name on the app, the PDF reports and the emails, on your own web address.',
    kicker: 'White label', h1: 'A white-label inventory app, with your name on everything',
    lead: 'Your clients should see your company on every check-in, check-out and inspection, not a software supplier’s. We set DIY Inventory up in your brand: your logo, your colours and your name on the app your clerks use, on every PDF report and on the emails that go with them.',
    sections: [
      ['What carries your brand', '<ul><li><b>The app</b> your clerks open on their phones: your logo, colours and name.</li><li><b>Every PDF report</b>: the cover, the page headers and the sign-off page.</li><li><b>The emails</b> that send reports and sign-off links to tenants, landlords and agents.</li><li><b>Your own web address</b>, such as reports.yourcompany.co.uk, for the app and the report links.</li><li><b>Tenant self check-in links</b>, so even reports done without a visit come from you.</li></ul>'],
      ['Why white label beats building your own', '<div class="as-tw"><table><thead><tr><th></th><th>Building your own app</th><th>White label</th></tr></thead><tbody><tr><td>Time to start</td><td>Months of development</td><td>Set up for you</td></tr><tr><td>Cost</td><td>Developers, hosting, upkeep</td><td>One monthly fee</td></tr><tr><td>Updates</td><td>Yours to pay for</td><td>Included</td></tr><tr><td>Your brand</td><td>Yes</td><td>Yes</td></tr></tbody></table></div>'],
      ['How setting up works', '<ol><li><b>Tell us about your company</b> on the form: clerks, reports a month, what you use now.</li><li><b>Try it</b> on a real property.</li><li><b>Send your logo and colours</b>, and we set up your branded version and your web address.</li><li><b>Your clerks start</b>: they open it in the browser on their phones, nothing to install.</li></ol>'],
    ],
    faqs: [
      ['Will our clients see DIY Inventory anywhere?', 'The app, the reports and the emails are set up in your brand. Ask us on the form about anything specific you need hidden or changed.'],
      ['Can we use our own domain?', 'Yes, a web address on your own domain, such as reports.yourcompany.co.uk, can be set up for you.'],
      ['Can we change our colours later?', 'Yes. Send us the new logo or colours and we update them.'],
      ['Is there a contract?', 'It is a monthly fee. Ask us about the terms when we send your price.'],
    ],
  },
  {
    path: '/property-inventory-software', short: 'Property inventory software',
    title: 'Property Inventory Software for Check-Ins and Check-Outs',
    desc: 'Property inventory software for inventory companies: room-by-room checklists, dated photos, signed PDF reports and check-out comparisons, on any phone.',
    kicker: 'Inventory software', h1: 'Property inventory software that makes the report as you go',
    lead: 'An inventory report is only as good as the evidence in it and the time it took to make. DIY Inventory is phone-first inventory software: the clerk photographs and records each item in turn, and the report is built from that, with every photo dated and linked at full size.',
    sections: [
      ['Every kind of report', '<ul><li><b>Check-in inventories</b>: the condition of every room and item at the start, with meters, keys and alarms.</li><li><b>Check-outs</b>: started from the check-in, with changes listed and photos side by side.</li><li><b>Mid-term and renewal inspections</b>: a quicker walk-round between tenancies or during one.</li><li><b>Furnished and unfurnished lets</b>, HMOs and student houses: rooms and items as the property needs.</li></ul>'],
      ['What goes in the report', '<ul><li>A cover with the front of the property, the address and the condition of every item at a glance.</li><li>Every room as cards: photo, condition, description, marks, cleanliness and notes.</li><li>Meter readings with photos, keys with photos, and safety alarms.</li><li>The declaration and signatures, and an index of every photograph with its date and time.</li></ul><p>See a real one: <a href="/example-report">example report</a>.</p>'],
      ['Built for evidence', '<p>The date and time are drawn into every photo’s pixels when it is taken, not just stored in the file. Items marked not at the property are left out, so the report only shows what is there. Reports are made to be used as evidence, for example at the end of a tenancy.</p>'],
    ],
    faqs: [
      ['Is it an app to install?', 'No. It runs in the browser on any recent phone or tablet, so there is nothing to download or update.'],
      ['Can tenants do a report themselves?', 'Yes. You can send a tenant a link to do their own check-in or inspection, in your brand, and you receive the report.'],
      ['Who is it for?', 'Inventory companies and clerks (for a monthly fee, in their own brand), and letting agents and landlords (per report, in packs).'],
      ['Can we try it?', 'Yes. Ask on the inventory companies page and we’ll set you up to do a real report.'],
    ],
  },
  {
    path: '/check-out-report-software', short: 'Check-out report software',
    title: 'Check-Out Report Software: Compare With the Check-In',
    desc: 'Check-out report software for inventory clerks: start from the check-in, see how each item was, and list every change with photos side by side.',
    kicker: 'Check-outs', h1: 'Check-out reports that start from the check-in',
    lead: 'The slow part of a check-out is the comparison: finding each item in the check-in report and deciding what has changed. DIY Inventory starts the check-out from the check-in, shows the clerk how every item was, and lists the changes in the report.',
    sections: [
      ['How a check-out works', '<ol><li><b>Start from the earlier report</b>: rooms and items are copied over, so the clerk walks the same route.</li><li><b>Each item shows how it was</b>, with its condition and photo from the check-in.</li><li><b>The clerk records it now</b>: photo, condition, marks, cleanliness.</li><li><b>The report lists what changed</b>: worse or better condition, new marks, less clean, not working, meter readings then and now, with the check-in and check-out photos side by side.</li></ol>'],
      ['What the report shows', '<div class="as-tw"><table><thead><tr><th>Item</th><th>At the check-in</th><th>At the check-out</th></tr></thead><tbody><tr><td>Living room carpet</td><td>Good · clean</td><td>Fair · stain by the window</td></tr><tr><td>Kitchen worktops</td><td>Good</td><td>Good · unchanged</td></tr><tr><td>Electric meter</td><td>04512</td><td>06873</td></tr></tbody></table></div><p class="as-note">An illustration of the comparison, not a real property.</p>'],
      ['For the deposit conversation', '<p>Landlords, agents and tenants each want to see what changed and the photos that show it. The check-out report puts the changes first, most serious first, with the evidence beside them. It is made to be used as evidence; it doesn’t decide who is responsible.</p>'],
    ],
    faqs: [
      ['Does the check-in have to be done in DIY Inventory?', 'To compare item by item, yes: the check-out starts from a check-in made in the app. A check-out can still be done on its own without one.'],
      ['Are items that are gone shown?', 'Yes. An item the check-in recorded and the check-out marks as not there stays in the report, as now marked not applicable.'],
      ['Can the tenant sign the check-out?', 'Yes, from a sign-off link, with comments under any item.'],
      ['How is it priced for a clerk firm?', 'One monthly fee for your team, in your brand. Ask for a price on the inventory companies page.'],
    ],
  },
  {
    path: '/property-inspection-app', short: 'Property inspection app',
    title: 'Property Inspection App for Mid-Term Inspections',
    desc: 'A property inspection app for inventory companies: quick mid-term and renewal inspections, or send the tenant a link to do it without a visit, in your brand.',
    kicker: 'Inspections', h1: 'Mid-term inspections, with or without a visit',
    lead: 'Routine inspections are short, frequent and easy to put off. DIY Inventory makes them quick for a clerk on site, and adds a second option you can sell: the tenant does the inspection from a link on their phone, in your brand, and you review the report.',
    sections: [
      ['Two ways to inspect', '<div class="as-tw"><table><thead><tr><th></th><th>Clerk visit</th><th>Tenant by link</th></tr></thead><tbody><tr><td>Who walks round</td><td>Your clerk</td><td>The tenant, guided on their phone</td></tr><tr><td>Starts from</td><td>The check-in or last inspection</td><td>The check-in or last inspection</td></tr><tr><td>Photos dated</td><td>Yes</td><td>Yes</td></tr><tr><td>Your brand</td><td>Yes</td><td>Yes</td></tr><tr><td>Best for</td><td>Concerns, HMOs, end of fixed term</td><td>Routine checks between visits</td></tr></tbody></table></div>'],
      ['What an inspection records', '<ul><li>Every room against the earlier report, with what has changed.</li><li>Damp, leaks, damage, cleanliness and anything not working.</li><li>Meter readings, smoke and carbon monoxide alarms.</li><li>Notes for the landlord and the date and time on every photo.</li></ul>'],
      ['A service your clients will buy', '<p>Landlords and agents want regular inspections but not always the cost of a visit. A tenant self-inspection by link, sent and checked by you, gives them a lower-priced option under your name, alongside your clerk visits.</p>'],
    ],
    faqs: [
      ['Can inspections be scheduled?', 'After a check-in or inspection you can send the tenant the inspection link, and set a reminder every 3 or 6 months.'],
      ['Does the inspection compare with the check-in?', 'Yes, when it starts from the earlier report: each item shows how it was then.'],
      ['What if the tenant doesn’t finish?', 'The report is saved as they go and backed up online, so they can pick up where they left off.'],
      ['Is it included in the monthly fee?', 'Yes: check-ins, check-outs and inspections, by clerk or by link, are all included.'],
    ],
  },
  {
    path: '/start-an-inventory-clerk-business', short: 'Starting an inventory clerk business',
    title: 'How to Start an Inventory Clerk Business in the UK',
    desc: 'Starting out as an inventory clerk: the services to offer, typical prices, finding clients among letting agents and landlords, and the software to run it on.',
    kicker: 'Starting out', h1: 'How to start an inventory clerk business',
    lead: 'An inventory clerk records the condition of a rented home at the start and end of a tenancy, and in between. It is work you can start small, with a phone, a car and a few letting agents who trust you. This page is general information, not business or legal advice.',
    sections: [
      ['The services you can offer', '<ul><li><b>Check-in inventories</b>: the full record at the start of a tenancy.</li><li><b>Check-outs</b>: compared with the check-in, the basis of the deposit conversation.</li><li><b>Mid-term inspections</b>: shorter visits during the tenancy.</li><li><b>Tenant self check-ins</b>: a lower-priced service by link, which you send and check.</li></ul>'],
      ['What to charge', '<p>Typical clerk prices are about £100–£250 a report, depending on the size of the home, whether it is furnished, and the area. Many clerks price by number of bedrooms, with check-outs a little less than check-ins and inspections less again. Look at what is charged locally and price for the time each report really takes, including travel.</p>'],
      ['Finding clients', '<ol><li><b>Letting agents</b> are the steadiest source: smaller independents often have no clerk they rely on.</li><li><b>Portfolio landlords</b> who manage their own lets.</li><li><b>Block and property managers</b> with regular changeovers.</li><li><b>Your reports are your advert</b>: clear, quick and in your brand, they win the next job.</li></ol>'],
      ['What you need', '<ul><li>A recent phone with a good camera, and a torch.</li><li>Insurance suited to the work: ask an insurance adviser what cover you need.</li><li>A consistent way of working, room by room, so reports are comparable from check-in to check-out.</li><li>Software that turns the walk-round into the report, in your brand, so you aren’t typing in the evenings.</li></ul>'],
    ],
    faqs: [
      ['Do I need a qualification?', 'There is no single legal requirement in the UK. Training and a membership of an industry association can help win clients. Check what agents in your area expect.'],
      ['How long does a report take?', 'It depends on the property. With a phone app that builds the report as you go, the time is mostly the walk-round itself, with no typing up afterwards.'],
      ['Can I use my own brand from day one?', 'Yes. DIY Inventory can be set up in your brand for a monthly fee, so your first report already looks like your company.'],
      ['What about tenants doing their own?', 'Offer it as a service: send the link, check the report, and charge less than a visit.'],
    ],
  },
];

function mount(app, ctx){
  const CSS = require('./agentseo').CSS;
  for (const pg of PAGES) {
    const others = PAGES.filter(o => o !== pg);
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">${esc(pg.kicker)}</span><h1>${esc(pg.h1)}</h1><p>${esc(pg.lead)}</p>
<div class="cta" style="justify-content:center;display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="${HUB}#talk">Get a price and a free trial</a><a class="btn ghost" href="/example-report">See an example report</a></div></div></div>
<section class="tight"><div class="wrap as-wrap">
${pg.sections.map(([h, html]) => `<div class="card as-sec"><h2>${esc(h)}</h2>${html}</div>`).join('\n')}
<div class="card as-sec as-cta"><h2>Your own inventory app, in your brand</h2><p>Your logo, colours and name on the app, every report and the emails, on your own web address. One monthly fee for your team, no charge per report, and a trial on a real property first.</p>
<div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="${HUB}#talk">Get a monthly price</a><a class="btn ghost" href="${HUB}">For inventory companies</a></div></div>
<div class="as-sec"><h2>Questions</h2><div class="faq">${pg.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></div>
<div class="as-sec as-rel"><h2>Related</h2><ul>${others.map(o => `<li><a href="${o.path}">${esc(o.short)}</a></li>`).join('')}<li><a href="${HUB}">DIY Inventory for inventory companies</a></li><li><a href="/inventory-template">Free inventory template (PDF and Word)</a></li><li><a href="/checklists">Room-by-room inventory checklists</a></li></ul></div>
</div></section>`;
    app.get([pg.path, pg.path + '/'], (req, res) => res.type('html').send(ctx.renderPage({ key: 'clerks', path: pg.path, title: pg.title + ' · DIY Inventory', desc: pg.desc, og: pg.short, body,
      head: '<style>' + CSS + '</style>',
      jsonld: base => [
        { '@type': 'SoftwareApplication', name: 'DIY Inventory for inventory companies', applicationCategory: 'BusinessApplication', operatingSystem: 'iOS, Android, web browser', url: base + HUB, description: pg.desc, publisher: { '@id': base + '/#org' } },
        { '@type': 'FAQPage', mainEntity: pg.faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' }, { '@type': 'ListItem', position: 2, name: 'For inventory companies', item: base + HUB }, { '@type': 'ListItem', position: 3, name: pg.short, item: base + pg.path }] }] }, req)));
  }
  return { paths: PAGES.map(p => p.path), llms: base => PAGES.map(p => '- [' + p.short + '](' + base + p.path + '): ' + p.desc) };
}

module.exports = { mount, PAGES };
