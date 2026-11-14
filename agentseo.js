// Search pages for bulk buyers, each for a different searcher, all leading to /agents (packs, dashboard, "Talk to us"):
//   /inventory-software-for-letting-agents   agencies looking for inventory software or an app
//   /inventory-app-for-landlords             landlords with several properties
//   /tenant-self-check-in                    agents and landlords who want tenants to do their own check-in / check-out
// Each has its own wording, a comparison or worked example, questions (FAQPage) and links to the others.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAGES = [
  {
    path: '/inventory-software-for-letting-agents', short: 'Inventory software for letting agents',
    title: 'Inventory Software for Letting Agents · from £19.98 a report',
    desc: 'Inventory software for UK letting agents: tenants do check-ins and check-outs on their phones from one link, you get signed PDF reports and a dashboard. No subscription.',
    kicker: 'For letting agencies', h1: 'Inventory software for letting agents, without the subscription',
    lead: 'Most inventory software is built for a clerk with a tablet and a monthly fee. DIY Inventory is built for the tenant’s own phone: you send one link, they do the walk-round, and you get a report with dated photos and signatures for every tenancy. You pay per report, in prepaid packs.',
    sections: [
      ['What your branch actually does', '<ol><li><b>Send the tenant link</b> with the move-in pack or the check-out reminder. One link for every tenant, by email, WhatsApp or text.</li><li><b>The tenant photographs every room</b> on a guided checklist: each item, meters, keys and smoke alarms, with the date and time burned into every photo.</li><li><b>They sign, and the report arrives</b> by email and on your agent dashboard, ready to file with the tenancy. Send the sign-off link to the landlord or the other tenant if you want both sides on it.</li><li><b>At the end of the tenancy</b> the check-out starts from the check-in, so every item is compared with how it was.</li></ol>'],
      ['Compared with a clerk and with clerk software', '<div class="as-tw"><table><thead><tr><th></th><th>Inventory clerk</th><th>Clerk software</th><th>DIY Inventory</th></tr></thead><tbody><tr><td>Who visits</td><td>A clerk, booked in</td><td>Your staff</td><td>No one: the tenant does it</td></tr><tr><td>Cost</td><td>Typically £100–£250 a report</td><td>Monthly licence + staff time</td><td>From £19.98 a report, prepaid</td></tr><tr><td>Waiting for a slot</td><td>Yes</td><td>Yes (staff diary)</td><td>No: the tenant does it on move-in day</td></tr><tr><td>Dated photos</td><td>Usually</td><td>Usually</td><td>Date and time burned into every photo</td></tr><tr><td>Check-out compared with check-in</td><td>Separate visit</td><td>Depends</td><td>Built in, item by item</td></tr><tr><td>All reports in one place</td><td>Emails and attachments</td><td>Yes</td><td>Agent dashboard + emailed PDFs</td></tr></tbody></table></div><p class="as-note">Clerk prices vary by area and property size; they are typical figures, not a quote.</p>'],
      ['Built for how agencies work', '<ul><li><b>One link per branch or per landlord</b>, so each one has its own dashboard and count.</li><li><b>Reports don’t expire</b>, so a quiet month costs nothing.</li><li><b>No logins for tenants</b>: they open the link and start. Nothing to install.</li><li><b>Every report is backed up online</b> as it’s done, so nothing is lost if a tenant’s phone is.</li><li><b>Larger volumes</b>: a price for your volume, from about £17 a report, and a monthly invoice if you prefer.</li></ul>'],
    ],
    faqs: [
      ['Is it a subscription?', 'No. You buy prepaid packs of 10, 25 or 50 reports, or we agree a price for larger volumes. There is no monthly fee and the reports don’t expire.'],
      ['Do our staff need training?', 'No. Your staff only send a link. Tenants are guided room by room on their phone, and the report is made for them.'],
      ['Can we see every report in one place?', 'Yes. Each link has its own agent dashboard: every report with its address, type, date and who did it, whether it has been signed by the other party, reports still in progress, and PDFs to download.'],
      ['Will landlords accept a tenant-made report?', 'It is a full record with dated photos of every item, meter readings, keys and signatures, and the other party can check it and sign it from a link. Whether it is used in a dispute is for the parties and the deposit scheme, but it is made to be used as evidence.'],
      ['Can we do some reports ourselves?', 'Yes. Open the same link on a staff phone and do the walk-round; it counts as one report from your pack.'],
    ],
  },
  {
    path: '/inventory-app-for-landlords', short: 'Inventory app for landlords with several properties',
    title: 'Inventory App for Landlords with Several Properties',
    desc: 'An inventory app for landlords with a portfolio: tenants do the check-in and check-out on their phone, you get a signed report for every property. Packs from £19.98 a report.',
    kicker: 'For portfolio landlords', h1: 'An inventory app for landlords with more than one property',
    lead: 'If you let a handful of homes yourself, booking a clerk for every check-in and check-out adds up fast, and doing them all in person takes days. With DIY Inventory your tenant does the walk-round on their phone from your link, and you keep a signed, dated report for every property.',
    sections: [
      ['A worked example: six properties', '<p>Six flats with tenancies turning over every year or so means around six check-ins and six check-outs a year, plus a mid-term inspection if you do them.</p><div class="as-tw"><table><thead><tr><th></th><th>Clerk at £150</th><th>DIY Inventory</th></tr></thead><tbody><tr><td>12 reports a year</td><td>£1,800</td><td>£249 for a 10-pack + 2 single reports (£59.98) = £308.98</td></tr><tr><td>18 reports a year (with inspections)</td><td>£2,700</td><td>£549 for a 25-pack, with 7 left for next year</td></tr></tbody></table></div><p class="as-note">Your own clerk’s price may be higher or lower; use the calculator on the <a href="/agents">agents and landlords page</a> with your own figures.</p>'],
      ['What you get for every property', '<ul><li>Every room photographed item by item, with the date and time burned into the photos</li><li>Gas, electric and water meter readings with photos, keys counted, smoke and carbon monoxide alarms</li><li>The tenant’s signature, and yours (or theirs) on the sign-off page</li><li>At the end of the tenancy, the check-out compared with the check-in, item by item</li><li>Your dashboard with every report, and each PDF emailed to you</li></ul>'],
      ['Running it from your phone', '<p>You don’t need to be there. Send the link the day before the tenancy starts, and the report is in your inbox when they finish. Mid-term, send the same link for an inspection instead of visiting. Want to do one yourself? Open the link on your own phone.</p><p>Already use our free <a href="/landlords">landlord dashboard</a> for rent and certificates? The inventory reports sit alongside it, from your tenant link.</p>'],
    ],
    faqs: [
      ['How many properties do I need for a pack to be worth it?', 'A 10-pack (£249) works out at £24.90 a report, against £29.99 bought one at a time. If you have three or more properties turning over, or do inspections, a pack usually pays for itself in the first year.'],
      ['Do the reports run out at the end of the year?', 'No. Prepaid reports stay on your link until you use them.'],
      ['Can I use one link for all my properties?', 'Yes. Send the same link to every tenant. Each report is made for the address the tenant gives, and they all appear on your one dashboard.'],
      ['Is a report made by the tenant fair to me as the landlord?', 'Every photo is dated, every item is recorded, and you can check the report and add your own signature and comments from the sign-off link. If something is missing, ask the tenant to add it before you sign.'],
    ],
  },
  {
    path: '/tenant-self-check-in', short: 'Tenant self check-in inventories',
    title: 'Tenant Self Check-In Inventory App for Agents & Landlords',
    desc: 'Let tenants do their own check-in inventory and check-out on their phone from your link: guided photos, meters, keys and signatures, with every report on your dashboard.',
    kicker: 'Self check-in', h1: 'Let tenants do their own check-in inventory',
    lead: 'Self check-in inventories are now common: the tenant records the property on move-in day, on their own phone, instead of waiting for a clerk. Done badly it’s a few blurry photos in an email. Done with DIY Inventory it’s a full, guided report with dated photos, meter readings, keys and signatures, in the same format every time.',
    sections: [
      ['Why tenants doing it themselves works', '<ul><li><b>It happens on move-in day</b>, when the property is empty and the condition is fresh, not a week later when a clerk is free.</li><li><b>The tenant has every reason to be thorough</b>: anything they don’t record could be put down to them at check-out.</li><li><b>The app makes it complete</b>: it won’t let a room be finished without a photo of every item and at least 8 photos, and the front of the property comes first.</li><li><b>You still check it</b>: the report comes to you, and you (or the landlord) can sign it with comments from a link.</li></ul>'],
      ['What stops a self check-in being challenged', '<ul><li>The date and time are burned into the photo itself, not just stored with the file.</li><li>Photos are taken in the app, item by item, so every part of the room is covered.</li><li>The tenant confirms an honesty declaration and signs before the report is made.</li><li>The report is backed up online as it’s done, and both sides can have a signed copy.</li></ul><p>For the check-out, the tenant (or you) starts from the check-in report, so every item is compared with how it was. That’s what makes deposit conversations short.</p>'],
      ['Setting it up for your tenants', '<ol><li>Buy a pack, or <a href="/agents#talk">talk to us</a> about larger volumes.</li><li>Add your tenant link to your move-in emails or welcome pack.</li><li>Watch reports arrive on your agent dashboard; chase anyone still in progress.</li></ol>'],
    ],
    faqs: [
      ['What if the tenant doesn’t do it?', 'Your dashboard shows reports in progress and finished ones, so you can see who hasn’t started or finished and remind them. Nothing is used from your pack until a report is finished.'],
      ['How long does it take a tenant?', 'Usually 30 to 60 minutes for a one or two bedroom flat, longer for a house. They can stop and carry on later: it’s saved on their phone and online as they go.'],
      ['Can tenants do the check-out too?', 'Yes, from the same link. They choose Check-Out, start from the check-in report, and each item is compared with how it was.'],
      ['Do tenants pay anything?', 'No. Your prepaid pack covers it, and the tenant never sees a price.'],
    ],
  },
];

function mount(app, ctx){
  const per = (() => { const P = require('./purchases').PACKS, k = Object.keys(P).map(Number).sort((a, b) => b - a)[0]; return (P[k] / k).toFixed(2); })();
  for (const pg of PAGES) {
    const others = PAGES.filter(o => o !== pg);
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">${esc(pg.kicker)}</span><h1>${esc(pg.h1)}</h1><p>${esc(pg.lead)}</p>
<div class="cta" style="justify-content:center;display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="/agents#packs">See the packs · from £${per} a report</a><a class="btn ghost" href="/agents#talk">Talk to us</a></div></div></div>
<section class="tight"><div class="wrap as-wrap">
${pg.sections.map(([h, html]) => `<div class="card as-sec"><h2>${esc(h)}</h2>${html}</div>`).join('\n')}
<div class="card as-sec as-cta"><h2>Prepaid packs, and a dashboard for every report</h2><p>10 reports £249 · 25 reports £549 · 50 reports £999. The reports don’t expire, and every pack comes with your own agent dashboard. More than 50 a year, or several branches? We’ll agree a price for your volume.</p>
<div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="/agents#packs">Buy a pack</a><a class="btn ghost" href="/agents#talk">Talk to us</a><a class="btn ghost" href="/example-report">See an example report</a></div></div>
<div class="as-sec"><h2>Questions</h2><div class="faq">${pg.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></div>
<div class="as-sec as-rel"><h2>Related</h2><ul>${others.map(o => `<li><a href="${o.path}">${esc(o.short)}</a></li>`).join('')}<li><a href="/agents">DIY Inventory for agents and landlords: packs and dashboard</a></li><li><a href="/inventory-clerk">Inventory clerk, or do it yourself?</a></li><li><a href="/guides/inventories-for-letting-agents">Guide: how letting agents can cut the cost of inventories</a></li></ul></div>
</div></section>`;
    app.get(pg.path, (req, res) => res.type('html').send(ctx.renderPage({ key: 'agents', path: pg.path, title: pg.title + ' · DIY Inventory', desc: pg.desc, og: pg.short, body,
      head: '<style>' + CSS + '</style>',
      jsonld: base => [
        { '@type': 'Service', name: pg.short, serviceType: 'Property inventory reports', provider: { '@id': base + '/#org' }, areaServed: 'GB', url: base + pg.path,
          offers: { '@type': 'AggregateOffer', priceCurrency: 'GBP', lowPrice: per, highPrice: '29.99', url: base + '/agents#packs' } },
        { '@type': 'FAQPage', mainEntity: pg.faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' }, { '@type': 'ListItem', position: 2, name: 'For agents and landlords', item: base + '/agents' }, { '@type': 'ListItem', position: 3, name: pg.short, item: base + pg.path }] }] }, req)));
  }
  return { paths: PAGES.map(p => p.path), llms: base => PAGES.map(p => '- [' + p.short + '](' + base + p.path + '): ' + p.desc) };
}

const CSS = `.as-wrap { max-width: 880px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; } .as-sec { min-width: 0; }
.as-sec h2 { margin: 0 0 12px; font-size: clamp(22px, 2.6vw, 28px); line-height: 1.2; } .as-sec p, .as-sec li { color: var(--ink-soft); }
.as-sec ol, .as-sec ul { padding-left: 20px; display: grid; gap: 8px; margin: 0; } .as-sec li b { color: var(--ink); }
.as-tw { overflow-x: auto; margin: 4px 0; } .as-tw table { width: 100%; border-collapse: collapse; font-size: 14.5px; min-width: 520px; }
.as-tw th, .as-tw td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; } .as-tw th { font-size: 13px; color: var(--ink-faint); }
.as-tw td:last-child, .as-tw th:last-child { background: var(--soft); font-weight: 600; color: var(--ink); }
.as-note { font-size: 13px; color: var(--ink-faint) !important; margin: 8px 0 0; }
.as-cta { background: var(--soft); box-shadow: none; } .as-rel ul { list-style: none; padding: 0; } .as-rel a { font-weight: 600; }`;

module.exports = { mount, PAGES, CSS };
