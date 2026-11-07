// Check-in vs check-out compared automatically (the owner: "Someone doesn't have to individually look through the
// report to find the difference between the check-in and check-out report. Our AI system will do that").
//  - /check-out-comparison (UK) and /us/move-out-comparison (US): the campaign pages. A check-out (move-out)
//    started from the check-in has each item's new photo sent with its check-in photo to /api/assess (server.js,
//    COMPARE_SYSTEM); the AI says what changed (possible damage, wear and tear, cleaning, missing), how much, and
//    where, and the report's "Changes since the check-in" section opens with a "Checked by AI" summary.
//  - Only shown while the AI is switched on (ANTHROPIC_API_KEY): otherwise the pages send people to how it works,
//    so the site never claims AI that isn't running.
function mount(app, ctx){
  const { renderPage, esc, aiOn } = ctx;
  const crumbs = (base, list) => ({ '@type': 'BreadcrumbList', itemListElement: list.map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) });
  const faqLd = faqs => ({ '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  const faqHtml = faqs => `<div class="faq">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
  const steps = s => `<div class="steps four">${s.map(([h, p], i) => `<div class="card step"><div class="n">${i + 1}</div><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div>`;
  const cta = (a, b) => `<p style="text-align:center;margin:26px 0 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn primary" href="/app?start=checkout">${esc(a)}</a><a class="btn ghost" href="${b[1]}">${esc(b[0])}</a></p>`;
  // A small worked example of what the report shows (made-up flat, clearly labelled).
  const sample = (thenW, rows) => `<div class="card" style="overflow-x:auto"><p style="margin:0 0 10px;font-size:13px;color:var(--muted,#667)"><b>Example</b> · what the “Changes since the ${esc(thenW)}” page looks like</p>
<div style="border-left:4px solid var(--accent,#1B2E4B);background:rgba(27,46,75,.06);padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:14px"><b style="font-size:11px;letter-spacing:.08em">CHECKED BY AI</b><br>Compared automatically: 42 items compared; found 2 possible damage, 1 wear and tear, 1 needs cleaning; 37 unchanged. These are what the photos show, not a decision on who is responsible.</div>
<table style="width:100%;border-collapse:collapse;font-size:14px;min-width:520px"><thead><tr style="text-align:left;color:var(--muted,#667);font-size:12px"><th style="padding:6px 8px">Room</th><th style="padding:6px 8px">Item</th><th style="padding:6px 8px">What changed</th></tr></thead><tbody>
${rows.map(([r, i, t, wear]) => `<tr style="border-top:1px solid rgba(0,0,0,.08)"><td style="padding:8px">${esc(r)}</td><td style="padding:8px;font-weight:600">${esc(i)}</td><td style="padding:8px;color:${wear ? '#8a5a12' : '#a83e26'};font-weight:600">${esc(t)}</td></tr>`).join('')}
</tbody></table><p style="margin:10px 0 0;font-size:13px">Then a page of photos side by side for each one: the ${esc(thenW)} on the left, now on the right.</p></div>`;

  function ukPage(){
    const faqs = [
      ['How does the automatic comparison work?', 'Start the check-out from the check-in report. The rooms and items are already there. As you photograph each item, our AI puts your new photo beside the check-in photo of the same item and says what has changed: possible damage, wear and tear, needs cleaning, or missing, how serious it looks, and exactly where. The report lists every change for you, with the two photos side by side.'],
      ['Do I still need to read through both reports?', 'No. The “Changes since the check-in” page lists every item that changed, the most serious first, with a one-line description of each and the photos side by side. Everything that didn’t change is counted, not listed, so you only look at what matters.'],
      ['Does the AI decide what the tenant pays for?', 'No. It says what the photos show, and whether a difference looks like damage or ordinary wear and tear. Who is responsible, and what is fair to deduct, is for the landlord and tenant to agree, or the deposit scheme’s adjudicator if they can’t. The report says so.'],
      ['What if the photos were taken from a different angle?', 'The AI only reports a difference it can see in both photos. Changes in light, angle or zoom aren’t counted as damage; if a fair comparison isn’t possible it says “couldn’t compare”, so you know to look yourself.'],
      ['Does it work if the check-in was done by an inventory clerk?', 'The automatic comparison needs the check-in done with DIY Inventory, so each item has its own dated photo to compare against. If your check-in was on paper or from a clerk, do your next inspection or check-in with DIY Inventory and every report after it is compared for you.'],
      ['Can the tenant do the check-out?', 'Yes. Send them the check-out link: they photograph each room, and the comparison runs as they go. Tenants like seeing that nothing new was found before they hand the keys back.'],
      ['How much does it cost?', 'The check-out report is £30, the comparison included, whatever the size of the property. No subscription, free until you download it.'],
    ];
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Check-in vs check-out, compared by AI</span><h1>Every change since the check-in, found for you</h1><p>No more reading two reports side by side. Start the check-out from the check-in and our AI compares every item, photo against photo, then lists what has changed: damage, wear and tear, cleaning and anything missing, with both photos side by side. £30 a check-out.</p>${cta('Start a check-out', ['See an example report', '/example-report'])}</div></div>
<section class="tight"><div class="wrap"><div class="two">
  <div class="card"><h3>Landlords and agents</h3><ul>
    <li>No hour spent flicking between the check-in and the check-out: the changes are listed for you, the most serious first.</li>
    <li>Each one described in plain words, where it is and how serious, with the check-in photo beside today’s.</li>
    <li>The evidence a deposit deduction needs, in one place, ready to send to the tenant or the deposit scheme.</li>
    <li>Damage told apart from ordinary wear and tear, so you only raise what’s fair.</li>
  </ul></div>
  <div class="card"><h3>Tenants</h3><ul>
    <li>See for yourself what has changed since you moved in, before you hand the keys back.</li>
    <li>Wear and tear is shown as wear and tear, not damage.</li>
    <li>“No change” is on the record too: the best answer to a deduction you don’t agree with.</li>
  </ul></div>
</div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">What you get</span><h2>The changes, not the whole report</h2></div>
  ${sample('check-in', [['Kitchen', 'Worktops', 'Possible damage (moderate): new 3 cm chip on the edge, left of the sink'], ['Living room', 'Walls', 'Possible damage (minor): picture hooks and filler holes above the sofa'], ['Bedroom 1', 'Carpet', 'Wear and tear (minor): light flattening in the walkway by the door', true], ['Bathroom', 'Bath', 'Needs cleaning: limescale round the taps']])}
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">How it works</span><h2>Compared automatically, in four steps</h2></div>
  ${steps([['Start from the check-in', 'Open the check-in and choose “Start a check-out or inspection”, or send the tenant the check-out link.'], ['Photograph every room', 'The rooms and items from the check-in are already there, each with its check-in photo.'], ['The AI compares as you go', 'Each new photo is checked against the check-in photo of the same item. Any change shows straight away.'], ['One page of changes', 'The report opens with every change, the most serious first, and the photos side by side.']])}
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>Automatic check-out comparison: questions and answers</h2></div>
  ${faqHtml(faqs)}
  <p style="margin:18px 0 0;font-size:14px">Also: <a href="/mid-term-inspection">mid-term inspections, compared with the check-in</a> · <a href="/guides">guides for landlords and tenants</a></p>
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Let the AI find the changes</h2><p>Start the check-out from your check-in report. Free until you download it.</p><a class="btn" href="/app?start=checkout">Start a check-out</a></div></div></div>`;
    return { key: 'compare', path: '/check-out-comparison', title: 'Check-In vs Check-Out Compared by AI: Every Change Found',
      og: 'Every change since the check-in, found for you', desc: 'Our AI compares every check-out photo with the check-in photo of the same item and lists the changes: damage, wear and tear, cleaning, missing. £30.', body,
      jsonld: base => [{ '@type': 'Service', name: 'Check-out report with automatic check-in comparison', serviceType: 'Check-out inventory report', provider: { '@id': base + '/#org' }, areaServed: { '@type': 'Country', name: 'United Kingdom' },
        offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } }, faqLd(faqs), crumbs(base, [['Home', '/'], ['Check-out comparison', '/check-out-comparison']])] };
  }

  function usPage(){
    const faqs = [
      ['How does the automatic comparison work?', 'Start the move-out inspection from the move-in report. As you photograph each item, our AI puts your new photo beside the move-in photo of the same item and says what changed: possible damage, normal wear and tear, needs cleaning, or missing, how serious it looks, and where. The report lists every change for you, photos side by side.'],
      ['Does it decide what comes out of the security deposit?', 'No. It says what the photos show, and whether a difference looks like damage or normal wear and tear (which most states don’t allow landlords to deduct for). What is deducted is for the landlord and tenant, or a small claims court if they disagree.'],
      ['What if the photos were taken from a different angle?', 'Only differences visible in both photos are reported. Light, angle and zoom aren’t counted as damage; if a fair comparison isn’t possible it says “couldn’t compare.”'],
      ['How much does it cost?', 'The move-out report is {{USD}} (charged as £30 by card; your bank converts it), the comparison included. No subscription.'],
    ];
    const body = `<div class="page-head"><div class="wrap"><p style="margin:0 0 6px"><a href="/us">← United States</a></p><span class="kicker">Move-in vs move-out, compared by AI</span><h1>Every change since move-in, found for you</h1><p>Start the move-out inspection from the move-in report and our AI compares every item, photo against photo, then lists what changed: damage, normal wear and tear, cleaning and anything missing, with both photos side by side. {{USD}} a move-out report.</p>${cta('Start a move-out inspection', ['Move-in inspection checklist', '/us/move-in-checklist'])}</div></div>
<section class="tight"><div class="wrap"><div class="two">
  <div class="card"><h3>Landlords and property managers</h3><ul>
    <li>No comparing two reports page by page: the changes are listed, the most serious first.</li>
    <li>Damage told apart from normal wear and tear, so deductions hold up.</li>
    <li>The itemized evidence most states expect with a security deposit deduction, photos included.</li>
  </ul></div>
  <div class="card"><h3>Renters</h3><ul>
    <li>See what changed since move-in before you hand back the keys.</li>
    <li>Normal wear and tear is shown as wear and tear, not damage.</li>
    <li>“No change” on the record protects your security deposit.</li>
  </ul></div>
</div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">What you get</span><h2>The changes, not the whole report</h2></div>
  ${sample('move-in', [['Kitchen', 'Countertops', 'Possible damage (moderate): new 1 in chip on the edge, left of the sink'], ['Living room', 'Walls', 'Possible damage (minor): nail holes above the couch'], ['Bedroom 1', 'Carpet', 'Wear and tear (minor): light flattening in the walkway', true], ['Bathroom', 'Tub', 'Needs cleaning: soap scum and hard water marks']])}
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>Automatic move-out comparison: questions and answers</h2></div>
  ${faqHtml(faqs)}
  <p style="margin:18px 0 0;font-size:14px">Your state’s rules: <a href="/us">security deposit law for all 50 states</a> · <a href="/us/routine-inspection">routine inspections</a></p>
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Let the AI find the changes</h2><p>Start the move-out from your move-in report. Free until you download it.</p><a class="btn" href="/app?start=checkout">Start a move-out inspection</a></div></div></div>`;
    return { key: 'compare', lang: 'en-US', path: '/us/move-out-comparison', title: 'Move-In vs Move-Out Inspection Compared by AI',
      og: 'Every change since move-in, found for you', desc: 'Our AI compares every move-out photo with the move-in photo of the same item and lists the changes: damage, normal wear and tear, cleaning, missing.', body,
      jsonld: base => [{ '@type': 'Service', name: 'Move-out inspection with automatic move-in comparison', serviceType: 'Move-out inspection report', provider: { '@id': base + '/#org' }, areaServed: { '@type': 'Country', name: 'United States' },
        offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } }, faqLd(faqs), crumbs(base, [['Home', '/'], ['United States', '/us'], ['Move-out comparison', '/us/move-out-comparison']])] };
  }

  const pages = [ukPage(), usPage()];
  pages.forEach(pg => app.get([pg.path, pg.path + '/'], (req, res) => aiOn() ? res.type('html').send(renderPage(pg, req)) : res.redirect(302, '/how-it-works')));
  app.get(['/checkout-comparison', '/check-in-check-out-comparison', '/ai-comparison'], (req, res) => res.redirect(301, '/check-out-comparison'));
  return { paths: pages.map(p => p.path) };
}

module.exports = { mount };
