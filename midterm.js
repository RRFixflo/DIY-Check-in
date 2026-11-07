// Mid-term inspections (the owner: "a campaign for using it as a midterm inspection too").
//  - /mid-term-inspection (UK) and /us/routine-inspection (US): what a mid-term (mid-tenancy, routine) inspection is,
//    why the tenant doing it from a link is the easy way (no visit, no notice period to arrange, photos dated and
//    compared with the check-in), how often, what to look at, the price, FAQs (FAQPage, Service, BreadcrumbList).
//  - Reminders: after a check-in or an inspection, the finished screen offers "Remind me every 3 or 6 months"
//    (POST /api/midterm-reminder { key, email, months, address, us }). Kept in REPORTS_DIR/midterm-reminders.json;
//    checked hourly; when one is due an email (Resend) carries the ready link /app?from=<key>&start=inspection,
//    which opens a mid-term inspection based on that report (for the landlord, or forwarded to the tenant), and the
//    next one is set months later. Every email has a one-click stop link (/mid-term-inspection/stop/<id>-<token>).
//    /admin → "🔁 Mid-term reminders" lists them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function mount(app, ctx){
  const { REPORTS_DIR, renderPage, esc, clientIp, limiter, notify, PUBLIC_BASE, addAdminSection, canonicalBase } = ctx;
  const FILE = path.join(REPORTS_DIR, 'midterm-reminders.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { list: [] }; } };
  const write = d => { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(d)); fs.renameSync(t, FILE); };
  const crumbs = (base, list) => ({ '@type': 'BreadcrumbList', itemListElement: list.map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) });
  const faqLd = faqs => ({ '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  const faqHtml = faqs => `<div class="faq">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
  const steps = s => `<div class="steps four">${s.map(([h, p], i) => `<div class="card step"><div class="n">${i + 1}</div><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div>`;
  const cta = (a, b) => `<p style="text-align:center;margin:26px 0 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn primary" href="/app?start=inspection">${esc(a)}</a><a class="btn ghost" href="${b[1]}">${esc(b[0])}</a></p>`;

  /* ---------------------------------------------------------------- UK page */
  function ukPage(){
    const faqs = [
      ['What is a mid-term inspection?', 'A check on the property part-way through a tenancy, usually every 3 to 6 months: the condition of every room, anything that needs repairing, damp or mould, smoke and carbon monoxide alarms, and whether the home is being looked after. It is compared with the check-in inventory, so any change is easy to see.'],
      ['How often should a landlord do a mid-term inspection?', 'Most landlords and agents inspect every 3 to 6 months, and more often in the first year or in shared houses. Some landlord insurance policies and some council licence conditions expect regular inspections, so check yours.'],
      ['Do I have to give the tenant notice?', 'In England, a landlord must give at least 24 hours’ written notice to inspect, at a reasonable time, and the tenant can ask for another time. When the tenant does the inspection themselves from a link, there is no visit to arrange: they do it when it suits them.'],
      ['Can the tenant do the mid-term inspection?', 'Yes. Send them a link: they photograph each room on their phone as the app walks them through it, every photo has the date and time burned in, and you get the PDF report, compared with the check-in. Many tenants prefer it to a visit.'],
      ['What should a mid-term inspection check?', 'Every room’s condition against the check-in, signs of damp, mould or leaks, the boiler and any visible pipework, smoke and carbon monoxide alarms (press the test button), windows and locks, appliances, the garden, and the meter readings. Our mid-tenancy inspection checklist lists the lot.'],
      ['How much does it cost?', 'Each inspection is £30 with DIY Inventory, whatever the size of the property. An inventory clerk or agent usually charges much more for every visit.'],
      ['Does it help at check-out?', 'Yes. Each inspection is a dated record part-way through the tenancy. If damage is found at check-out, the inspections show when it appeared and whether it was reported, which is the evidence a deposit scheme’s adjudicator weighs.'],
    ];
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Mid-term inspections</span><h1>Mid-term property inspections, without the visit</h1><p>Send your tenant a link. They photograph every room on their phone, the date and time burned into each photo, and you get a PDF report compared with the check-in, the same day. £30 an inspection, no clerk and no appointment.</p>${cta('Start a mid-term inspection', ['See an example report', '/example-report'])}</div></div>
<section class="tight"><div class="wrap"><div class="two">
  <div class="card"><h3>Landlords and agents</h3><ul>
    <li>No trip to the property and no 24 hours’ notice to arrange: the tenant does it when it suits them.</li>
    <li>Spot damp, mould, leaks and damage early, while they’re cheap to fix, and with dated photos.</li>
    <li>Each inspection is compared with the check-in, so what has changed is listed for you, photos side by side.</li>
    <li>A record every few months that helps at check-out, and shows you inspect regularly if your insurer or licence asks.</li>
  </ul></div>
  <div class="card"><h3>Tenants</h3><ul>
    <li>No stranger walking round your home: you do it yourself, in your own time.</li>
    <li>Report repairs with dated photos, so there’s a record of when you told the landlord.</li>
    <li>Show the home is being looked after, which protects your deposit at the end.</li>
  </ul></div>
</div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">How it works</span><h2>A mid-term inspection in four steps</h2></div>
  ${steps([['Start from the check-in', 'Open the check-in report and choose “Start a check-out or inspection”, or send the tenant the link to do it.'], ['Photograph every room', 'The rooms and checklists from the check-in are already there. Each photo is dated and timed.'], ['See what changed', 'Every item is compared with the check-in: worse, better or the same, with photos side by side.'], ['Sign and keep it', 'The PDF is ready the moment it’s signed. Set a reminder for the next one in 3 or 6 months.']])}
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="card">
  <h2 style="margin-top:0">Never forget the next one</h2>
  <p>When you finish a check-in or an inspection, ask for a reminder every 3 or 6 months. The email has a ready link that starts the next inspection from the last report: open it yourself, or forward it to your tenant. One click stops the reminders.</p>
  <p style="margin:0">What to look for: <a href="/guides/mid-tenancy-inspection-checklist">mid-tenancy inspection checklist</a> · Prefer paper? <a href="/inspection-report-template">free inspection report template</a> <!--AI-->· At the end of the tenancy: <a href="/check-out-comparison">check-out compared with the check-in by AI</a><!--/AI--></p>
</div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>Mid-term inspections: questions and answers</h2></div>
  ${faqHtml(faqs)}
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Inspect this month</h2><p>Start from your check-in report, or send your tenant the link. It’s free until you download the report.</p><a class="btn" href="/app?start=inspection">Start a mid-term inspection</a></div></div></div>`;
    return { key: 'midterm', path: '/mid-term-inspection', title: 'Mid-Term Property Inspection: Tenant Does It From a Link · £30',
      og: 'Mid-term property inspections, without the visit', desc: 'Mid-term (mid-tenancy) inspections for £30: send your tenant a link, they photograph every room, and you get a dated PDF compared with the check-in.', body,
      jsonld: base => [{ '@type': 'Service', name: 'Mid-term property inspection report', serviceType: 'Mid-tenancy property inspection', provider: { '@id': base + '/#org' }, areaServed: { '@type': 'Country', name: 'United Kingdom' },
        offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } }, faqLd(faqs), crumbs(base, [['Home', '/'], ['Mid-term inspections', '/mid-term-inspection']])] };
  }

  /* ---------------------------------------------------------------- US page */
  function usPage(){
    const faqs = [
      ['What is a routine rental inspection?', 'A check on a rental home during the lease, usually every 3 to 6 months: every room’s condition, leaks, mold, smoke and carbon monoxide detectors, the HVAC filter, appliances and the yard. It is compared with the move-in inspection, so anything that has changed is easy to see.'],
      ['How often can a landlord inspect a rental?', 'Most landlords and property managers inspect every 3 to 6 months. Most states require reasonable notice before a landlord enters, often 24 hours (some states set 48 hours or more), so check your state’s rules and your lease.'],
      ['Can the tenant do the inspection themselves?', 'Yes. Send them a link: they photograph each room on their phone as the app walks them through it, the date and time are burned into every photo, and you get a PDF report compared with the move-in inspection. No visit and no entry notice needed.'],
      ['What should a mid-lease inspection check?', 'Every room against the move-in report, leaks under sinks and around toilets, signs of mold, the water heater and furnace area, the HVAC filter, smoke and CO detectors (press test), windows, doors and locks, appliances, the yard and gutters, and the meter readings.'],
      ['How much does it cost?', 'Each inspection is {{USD}} (charged as £30 by card; your bank converts it), whatever the size of the home. No subscription.'],
      ['Does it help with the security deposit at move-out?', 'Yes. Dated inspections during the lease show when damage appeared and whether it was reported, the evidence a small claims court looks at if deductions are disputed.'],
    ];
    const body = `<div class="page-head"><div class="wrap"><p style="margin:0 0 6px"><a href="/us">← United States</a></p><span class="kicker">Routine inspections</span><h1>Routine rental inspections, without the visit</h1><p>Send your tenant a link. They photograph every room on their phone, the date and time burned into each photo, and you get a PDF report compared with the move-in inspection. {{USD}} an inspection, no inspector and no entry notice.</p>${cta('Start a routine inspection', ['Move-in inspection checklist', '/us/move-in-checklist'])}</div></div>
<section class="tight"><div class="wrap"><div class="two">
  <div class="card"><h3>Landlords and property managers</h3><ul>
    <li>No drive-out and no entry notice: the tenant does it when it suits them.</li>
    <li>Catch leaks, mold and damage early, while repairs are cheap, with dated photos.</li>
    <li>Each inspection is compared with the move-in report, so changes are listed for you, photos side by side.</li>
    <li>A record every few months that backs up any security deposit deduction at move-out.</li>
  </ul></div>
  <div class="card"><h3>Renters</h3><ul>
    <li>Nobody walking through your home: do it yourself, on your schedule.</li>
    <li>Report repairs with dated photos, so there’s a record of when you told the landlord.</li>
    <li>Show the home is cared for, which protects your security deposit.</li>
  </ul></div>
</div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">How it works</span><h2>A routine inspection in four steps</h2></div>
  ${steps([['Start from move-in', 'Open the move-in report and choose “Start a move-out inspection or inspection”, or send your tenant the link.'], ['Photograph every room', 'The rooms and checklists from move-in are already there. Every photo is dated and timed.'], ['See what changed', 'Each item is compared with move-in: worse, better or the same, photos side by side.'], ['Sign and keep it', 'The PDF is ready instantly. Set a reminder for the next one in 3 or 6 months.']])}
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="card">
  <h2 style="margin-top:0">Never miss the next one</h2>
  <p>When you finish a move-in or routine inspection, ask for a reminder every 3 or 6 months. The email carries a ready link that starts the next inspection from the last report: open it yourself or forward it to your tenant. One click stops the reminders.</p>
  <p style="margin:0">Your state’s rules: <a href="/us">security deposit law for all 50 states</a></p>
</div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>Routine inspections: questions and answers</h2></div>
  ${faqHtml(faqs)}
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Inspect this month</h2><p>Start from your move-in report, or send your tenant the link. It’s free until you download the report.</p><a class="btn" href="/app?start=inspection">Start a routine inspection</a></div></div></div>`;
    return { key: 'midterm', lang: 'en-US', path: '/us/routine-inspection', title: 'Routine Rental Inspection App: Tenant Does It From a Link',
      og: 'Routine rental inspections, without the visit', desc: 'Routine (mid-lease) rental inspections: send your tenant a link, they photograph every room, and you get a dated PDF compared with move-in. Free to start.', body,
      jsonld: base => [{ '@type': 'Service', name: 'Routine rental inspection report', serviceType: 'Mid-lease rental inspection', provider: { '@id': base + '/#org' }, areaServed: { '@type': 'Country', name: 'United States' },
        offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } }, faqLd(faqs), crumbs(base, [['Home', '/'], ['United States', '/us'], ['Routine inspections', '/us/routine-inspection']])] };
  }

  const pages = [ukPage(), usPage()];
  pages.forEach(pg => app.get([pg.path, pg.path + '/'], (req, res) => res.type('html').send(renderPage(pg, req))));
  app.get(['/midterm-inspection', '/mid-tenancy-inspection', '/midterm'], (req, res) => res.redirect(301, '/mid-term-inspection'));

  /* ---------------------------------------------------------------- reminders */
  const remLimit = limiter(10, 24 * 3600 * 1000);
  const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
  app.post('/api/midterm-reminder', require('express').json({ limit: '4kb' }), (req, res) => {
    const b = req.body || {};
    const key = String(b.key || '').toLowerCase(), email = String(b.email || '').trim().slice(0, 120), months = Number(b.months);
    if (!/^[a-f0-9]{32}$/.test(key) || !EMAIL.test(email) || ![3, 6].includes(months)) return res.status(400).json({ ok: false, error: 'invalid' });
    if (!remLimit(clientIp(req))) return res.status(429).json({ ok: false, error: 'busy' });
    const d = read();
    let r = d.list.find(x => x.key === key && x.email.toLowerCase() === email.toLowerCase() && !x.stoppedAt);
    const due = new Date(Date.now() + months * 30.44 * 86400000).toISOString();
    if (r) Object.assign(r, { months, dueAt: due });
    else { r = { id: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(16).toString('hex'), key, email, months, address: String(b.address || '').slice(0, 200), us: !!b.us, createdAt: new Date().toISOString(), dueAt: due, sent: 0 }; d.list.push(r); }
    d.list = d.list.slice(-5000);
    write(d);
    notify && notify('🔁 Mid-term reminder set', (r.address || 'A property') + ': every ' + months + ' months, to ' + email.replace(/(.).*(@.*)/, '$1…$2'));
    res.json({ ok: true, dueAt: r.dueAt });
  });
  app.get('/mid-term-inspection/stop/:t', (req, res) => {
    const m = /^([a-f0-9]{12})-([a-f0-9]{32})$/.exec(req.params.t), d = read(), r = m && d.list.find(x => x.id === m[1] && x.token === m[2]);
    if (r && !r.stoppedAt) { r.stoppedAt = new Date().toISOString(); write(d); }
    res.set('X-Robots-Tag', 'noindex').type('html').send(renderPage({ key: 'midterm', path: '/mid-term-inspection', title: 'Reminders stopped · DIY Inventory', desc: 'Inspection reminders stopped.',
      body: `<div class="page-head"><div class="wrap"><h1>${r ? 'Reminders stopped' : 'Link not recognised'}</h1><p>${r ? 'You won’t get any more inspection reminders for ' + esc(r.address || 'this property') + '.' : 'This link isn’t valid. If you keep getting reminders, reply to one and we’ll stop them.'}</p></div></div>` }, req));
  });

  async function sendDue(){
    const KEY = process.env.RESEND_API_KEY;
    if (!KEY) return;
    const FROM = process.env.REPORT_FROM_EMAIL || 'DIY Inventory <onboarding@resend.dev>', base = PUBLIC_BASE || '';
    if (!base) return;
    const d = read(), now = Date.now(); let changed = false;
    for (const r of d.list.filter(x => !x.stoppedAt && Date.parse(x.dueAt) <= now).slice(0, 50)) {
      const link = base + '/app?from=' + r.key + '&start=inspection', stop = base + '/mid-term-inspection/stop/' + r.id + '-' + r.token;
      const what = r.us ? 'routine inspection' : 'mid-term inspection', place = r.address || 'your property';
      const text = [
        'It’s time for the ' + what + ' at ' + place + '.', '',
        'Start it from the last report: the rooms and checklists are ready, and every item is compared with last time.',
        'Do it yourself, or forward this email to your tenant so they can do it on their phone, with no visit needed:', '', link, '',
        'Every photo is dated and timed, and the report is ready the moment it’s signed.', '',
        'Next reminder: in ' + r.months + ' months. Stop these reminders: ' + stop, '', 'DIY Inventory',
      ].join('\n');
      try {
        const resp = await fetch((process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
          headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [r.email], subject: 'Time for the ' + what + ': ' + place, text, headers: { 'List-Unsubscribe': '<' + stop + '>' } }) });
        if (!resp.ok) { console.error('midterm reminder: HTTP ' + resp.status + ' ' + (await resp.text().catch(() => '')).slice(0, 200)); continue; }
        r.sent = (r.sent || 0) + 1; r.lastSentAt = new Date().toISOString(); r.dueAt = new Date(now + r.months * 30.44 * 86400000).toISOString(); changed = true;
        console.log('midterm reminder sent: ' + r.id);
      } catch (e) { console.error('midterm reminder:', e.message); }
    }
    if (changed) write(d);
  }
  if (!/^(off|0|false)$/i.test(process.env.MIDTERM_REMINDERS || '')) { setTimeout(sendDue, 90 * 1000).unref(); setInterval(sendDue, 3600 * 1000).unref(); }

  addAdminSection && addAdminSection(() => {
    const d = read(), live = d.list.filter(x => !x.stoppedAt);
    return `<details id="midterm"><summary>🔁 Mid-term reminders (${live.length} active)</summary><p class="sub">Customers who asked to be reminded to inspect every 3 or 6 months. Each email carries a link that starts the next inspection from their last report.</p>${live.length ? '<ul>' + live.slice(-100).reverse().map(r => `<li>${esc(r.address || '—')} · every ${r.months} months · ${esc(r.email)} · next ${esc(String(r.dueAt).slice(0, 10))}${r.sent ? ' · ' + r.sent + ' sent' : ''}</li>`).join('') + '</ul>' : '<p>None yet.</p>'}</details>`;
  });

  return { paths: pages.map(p => p.path) };
}

module.exports = { mount };
