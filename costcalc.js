// A free, interactive "what does an inventory clerk cost?" estimator. A genuine link magnet and a high-intent
// landing page: people searching the cost of a clerk get a quick typical estimate, then see they can do the same
// themselves for £29.99. It is a TOOL, not more prose — distinct from the /inventory-clerk page and the cost guide,
// so it adds a page worth linking to rather than a near-duplicate. Indexed and in the sitemap.
// All the sums run in the browser; the figures are typical market ranges, said plainly to be an estimate, not a quote,
// and no other company is ever named.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FAQS = [
  ['How much does an inventory clerk cost in the UK?', 'Typically £100–£250 for a full inventory and check-in, depending on the size of the property, whether it’s furnished, and the area — London and the South East are at the higher end. A check-out is usually a little less, and an interim inspection less again. The calculator above gives a typical range for your property. Prices vary by company, so treat it as an estimate, not a quote.'],
  ['What makes an inventory cost more?', 'Mainly the number of rooms, whether the property is furnished (more to record), and the area. Add-ons like a fast turnaround or meter reads can also push the price up.'],
  ['Is a check-out cheaper than a check-in?', 'Usually, yes — a check-out compares the property against the check-in rather than recording it from scratch, so a clerk often charges a bit less. Doing it yourself, a check-out starts from your own check-in and lists what has changed.'],
  ['Can I just do the inventory myself?', 'Yes. DIY Inventory guides you room by room on your phone: a photo of every item with the date and time inside the image, meters, keys, your signature and a professional PDF — made to be used as evidence in a deposit dispute. It’s free to start and £29.99 to download, with no subscription and no VAT.'],
  ['How much do I save doing it myself?', 'For one property it’s typically £70–£220 a report. If you let several, prepaid packs bring the cost per report down further — see the packs on the letting-agents page.'],
];

function mount(app, ctx){
  const CSS = require('./agentseo').CSS;
  const page = {
    key: '', path: '/inventory-cost-calculator',
    title: 'Inventory Cost Calculator: What an Inventory Clerk Charges',
    desc: 'Free inventory cost calculator. Get a typical price for an inventory clerk by property size, furnishing and area — and see what it costs to do your own report for £29.99.',
    og: 'What does an inventory clerk cost? Free calculator',
  };
  const extraCss = `
  .cc-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 4px 0 18px; }
  .cc-form label { display: block; font-size: 13px; font-weight: 700; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
  .cc-form select, .cc-form input { width: 100%; padding: 12px 12px; border: 0; border-radius: 12px; background: var(--bg); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); font: inherit; }
  .cc-out { border-radius: 16px; padding: 20px; background: var(--bg); box-shadow: inset 0 0 0 1px var(--line); }
  .cc-big { font-size: clamp(28px, 7vw, 40px); font-weight: 800; line-height: 1.1; margin: 2px 0 2px; }
  .cc-sub { color: var(--ink-soft); margin: 0 0 14px; }
  .cc-vs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0 4px; }
  .cc-vs > div { border-radius: 14px; padding: 14px; text-align: center; }
  .cc-clerk { background: #FBEEE7; } .cc-diy { background: var(--good-soft); }
  .cc-vs .n { font-size: 24px; font-weight: 800; display: block; } .cc-vs .l { font-size: 13px; color: var(--ink-soft); }
  .cc-save { font-weight: 700; margin: 10px 0 0; }
  .cc-note { font-size: 13px; color: var(--ink-faint); margin: 12px 0 0; }
  @media (prefers-color-scheme: dark) { .cc-clerk { background: rgba(180,80,40,.18); } }`;

  const body = `<div class="page-head"><div class="wrap"><span class="kicker">Free tool</span>
<h1>What does an inventory clerk cost?</h1>
<p>Get a typical price for a professional inventory, check-in, check-out or inspection — then see what it costs to do the same yourself. Change the property below and the estimate updates.</p></div></div>
<section class="tight"><div class="wrap as-wrap">
<div class="card as-sec"><h2>Estimate your inventory cost</h2>
<div class="cc-form">
  <div><label for="cc-type">Report</label><select id="cc-type"><option value="inventory">Inventory &amp; check-in</option><option value="checkout">Check-out</option><option value="inspection">Interim inspection</option></select></div>
  <div><label for="cc-beds">Bedrooms</label><select id="cc-beds"><option value="0">Studio</option><option value="1">1 bedroom</option><option value="2" selected>2 bedrooms</option><option value="3">3 bedrooms</option><option value="4">4 bedrooms</option><option value="5">5+ bedrooms</option></select></div>
  <div><label for="cc-furn">Furnishing</label><select id="cc-furn"><option value="unfurnished">Unfurnished / part</option><option value="furnished" selected>Furnished</option></select></div>
  <div><label for="cc-area">Area</label><select id="cc-area"><option value="london">London</option><option value="se">South East</option><option value="uk" selected>Rest of the UK</option></select></div>
  <div><label for="cc-n">Reports a year</label><input id="cc-n" type="number" min="1" max="200" value="1" inputmode="numeric"></div>
</div>
<div class="cc-out" id="cc-out" aria-live="polite"></div>
<p class="cc-note">A typical market range, not a quote — real clerk prices vary by company and area. Doing it yourself is £29.99 a report (free to start, no subscription, no VAT).</p>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><a class="btn primary" href="/app">Do your own · start free</a><a class="btn ghost" href="/example-report">See an example report</a></div>
</div>

<div class="card as-sec"><h2>Clerk or do it yourself — what you get</h2><ul>
<li><b>A clerk</b> visits, records the property and sends a PDF — typically £100–£250 for an inventory and check-in, and a diary booking to arrange.</li>
<li><b>Doing it yourself</b> on DIY Inventory: a guided photo checklist for every room, the date and time burned into each photo, meters, keys, tenant sign-off and a professional PDF the moment it’s signed — £29.99, no subscription, no VAT.</li>
<li><b>Check-outs</b> start from your check-in and list exactly what has changed, side by side<!--AI-->, found for you by AI<!--/AI--> — made to be used as deposit evidence.</li>
<li><b>Several properties?</b> <a href="/agents">Prepaid packs</a> bring it under £20 a report. <b>Send it to your tenant?</b> <a href="/buy?for=tenant">Pay once and send them the link</a> — they never see a price.</li>
</ul></div>

<div class="as-sec"><h2>Questions</h2><div class="faq">${FAQS.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}</div></div>
</div></section>
<script>
(function(){
  var g=function(id){return document.getElementById(id);};
  var out=g('cc-out'), ids=['cc-type','cc-beds','cc-furn','cc-area','cc-n'];
  var gbp=function(x){return '£'+Math.round(x).toLocaleString('en-GB');};
  var r5=function(x){return Math.round(x/5)*5;};
  function calc(){
    var type=g('cc-type').value, beds=+g('cc-beds').value, furn=g('cc-furn').value, area=g('cc-area').value;
    var n=Math.max(1,Math.min(200,parseInt(g('cc-n').value,10)||1));
    var region = area==='london'?1.3 : area==='se'?1.15 : 1;
    var mid;
    if(type==='inspection'){ mid=(48+12*beds)*region; }
    else { var byBeds=[55,65,85,110,140,175]; mid=byBeds[Math.min(beds,5)]; if(furn==='furnished') mid*=1.35; mid*=region; if(type==='checkout') mid*=0.78; }
    var lo=r5(mid*0.82), hi=r5(mid*1.18), clerkMid=(lo+hi)/2, diy=29.99;
    var perSave=Math.max(0, clerkMid-diy), label=type==='checkout'?'check-out':type==='inspection'?'interim inspection':'inventory & check-in';
    var yr = n>1 ? '<p class="cc-save">Over '+n+' reports a year that’s about '+gbp(perSave*n)+' saved doing them yourself'+(n>=10?' — and <a href="/agents">prepaid packs</a> save even more.':'.')+'</p>' : '';
    out.innerHTML =
      '<div class="cc-sub">Typical clerk cost for a '+(beds===0?'studio':beds+' bed')+' '+(type==='inspection'?'':(furn==='furnished'?'furnished ':'unfurnished '))+label+(area==='uk'?'':' in '+(area==='london'?'London':'the South East'))+':</div>'+
      '<div class="cc-big">'+gbp(lo)+'–'+gbp(hi)+'</div>'+
      '<div class="cc-vs"><div class="cc-clerk"><span class="n">'+gbp(clerkMid)+'</span><span class="l">typical clerk</span></div>'+
      '<div class="cc-diy"><span class="n">£29.99</span><span class="l">do it yourself</span></div></div>'+
      '<p class="cc-save">You’d save about '+gbp(perSave)+' doing this one yourself.</p>'+yr;
  }
  ids.forEach(function(id){ var el=g(id); el.addEventListener('input',calc); el.addEventListener('change',calc); });
  calc();
})();
</script>`;

  const handler = (req, res) => res.type('html').send(ctx.renderPage(Object.assign({}, page, { body,
    head: '<style>' + CSS + extraCss + '</style>',
    jsonld: base => [
      { '@type': 'WebApplication', name: 'Inventory cost calculator', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: base + page.path, offers: { '@type': 'Offer', price: '0', priceCurrency: 'GBP' }, provider: { '@id': base + '/#org' } },
      { '@type': 'FAQPage', mainEntity: FAQS.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') } })) },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' }, { '@type': 'ListItem', position: 2, name: 'Inventory cost calculator', item: base + page.path }] }] }), req));
  app.get([page.path, page.path + '/'], handler);
  return { paths: [page.path] };
}
module.exports = { mount };
