// A focused landing page for paid search (Google Ads): one clear promise, one strong call to action, and the price
// said plainly. Deliberately kept OUT of the sitemap and set to noindex — its job is ads, not organic search, so it
// never competes with the organic pages. The campaign itself (keywords, ad copy, budget) is in marketing/google-ads.md.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FAQS = [
  ['How much does it cost?', 'It’s free to start. You do the whole report first and pay £29.99 only when you download the finished PDF. No subscription and no VAT.'],
  ['Do I need to download an app?', 'No. It runs in your phone’s web browser — open the link and go. You can add it to your home screen if you like.'],
  ['Will my landlord or agent accept it?', 'The report records every room with photos that carry the date and time inside the image, your signature and a declaration. Share it at the start of the tenancy so everyone has the same record. It’s made to be used as evidence in a deposit dispute.'],
  ['Can I use it for a check-out?', 'Yes. Start the check-out from your check-in and the report shows exactly what has changed, side by side. You can also do interim inspections.'],
  ['How many photos do I need?', 'At least 8 in every room, including one of each item, with no real upper limit — plus the meters, the keys and the front of the property.'],
  ['Can I send it to my tenant to do?', 'Yes. Pay once and send them the link: they do the walk-round on their phone, never see a price, and the finished report comes to you.'],
];

function mount(app, ctx){
  const CSS = require('./agentseo').CSS;
  const page = {
    path: '/inventory-app',
    title: 'DIY Inventory App: Your Own Check-In Report for £29.99',
    desc: 'Do your own property inventory, check-in, check-out or inspection on your phone. Guided photos with the date and time on every one, tenant sign-off and a professional PDF. Free to start, £29.99 to download.',
    kicker: 'Do it yourself',
    h1: 'Your own professional inventory report, done on your phone',
    lead: 'A guided check-in, check-out or inspection for your property — photographed room by room on your phone, signed, and turned into a professional PDF. Free to start; £29.99 to download, no subscription and no VAT.',
  };
  const body = `<div class="page-head"><div class="wrap"><span class="kicker">${page.kicker}</span><h1>${page.h1}</h1><p>${page.lead}</p>
<div class="cta" style="justify-content:center;display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="/app">Start free</a><a class="btn ghost" href="/example-report">See an example report</a></div>
<p class="sub" style="margin-top:10px">Free to start · £29.99 to download · no subscription · no VAT</p></div></div>
<section class="tight"><div class="wrap as-wrap">
<div class="card as-sec"><h2>Everything a clerk’s report has — without the clerk</h2><ul>
<li><b>A guided checklist for every room</b>: the app’s camera steps through each item, so nothing is missed.</li>
<li><b>The date and time burned into every photo</b> the moment you take it — not just in the file’s details.</li>
<li><b>Meters, keys and the front of the property</b>, each photographed and recorded.</li>
<li><b>Condition, marks and cleanliness</b> for each item<!--AI-->, suggested for you by AI after every photo<!--/AI-->.</li>
<li><b>Your signature and a declaration</b>, and a professional PDF built on your phone straight away.</li>
<li><b>Tenant sign-off on their phone</b>: they comment and sign from a link, added to the report.</li>
</ul></div>
<div class="card as-sec"><h2>Three steps</h2><ol>
<li><b>Walk round with your phone.</b> Photograph the front, then each room item by item. It saves as you go and backs up online.</li>
<li><b>Sign and finish.</b> Add your signature and confirm the declaration; the PDF is ready at once.</li>
<li><b>Pay £29.99 and download.</b> Save it, share it, or send your tenant a link to check and sign.</li>
</ol></div>
<div class="card as-sec"><h2>Built for the deposit conversation</h2><p>Deposit schemes decide disputes on evidence — above all, how the property was at check-in compared with check-out. Your report gives them exactly that: every room photographed with the date and time inside each photo, the condition of every item, the meters and keys, signed by you<!--AI-->, and a check-out that lists what has changed, found for you by AI<!--/AI-->. Made to be used as evidence.</p></div>
<div class="card as-sec as-cta"><h2>Start your report free</h2><p>Do the whole thing first. You only pay £29.99 when you download the finished PDF — no subscription, no VAT. Landlord with a tenant? <a href="/buy?for=tenant">Pay once and send them the link.</a> Several properties? <a href="/agents">Prepaid packs work out cheaper.</a></p>
<div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="/app">Start free</a><a class="btn ghost" href="/buy">Buy a report · £29.99</a></div></div>
<div class="as-sec"><h2>Questions</h2><div class="faq">${FAQS.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></div>
</div></section>`;

  const handler = (req, res) => res.type('html').send(ctx.renderPage({ key: '', path: page.path, title: page.title, desc: page.desc, og: 'Do your own inventory · £29.99', body,
    head: '<meta name="robots" content="noindex, follow"><style>' + CSS + '</style>',
    jsonld: base => [
      { '@type': 'Product', name: 'DIY Inventory report', description: page.desc, brand: { '@id': base + '/#org' }, offers: { '@type': 'Offer', price: '29.99', priceCurrency: 'GBP', availability: 'https://schema.org/InStock', url: base + '/buy', seller: { '@id': base + '/#org' } } },
      { '@type': 'FAQPage', mainEntity: FAQS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] }, req));
  app.get(['/inventory-app', '/inventory-app/', '/do-your-own-inventory', '/do-your-own-inventory/'], handler);
  return { paths: [] };   // NOT in the sitemap on purpose: this page is for paid ads, not organic search
}
module.exports = { mount };
