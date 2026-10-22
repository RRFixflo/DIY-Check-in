// Landlord certificates: Gas Safety (CP12), electrical (EICR) and EPC, booked on /certificates. A booking is
// a request: it's stored (REPORTS_DIR/bookings.json, the last 1000), the owner gets a phone alert, and it's
// listed on /admin, where the owner also sets the prices (REPORTS_DIR/cert-prices.json). The owner then
// confirms the date and takes payment. Nothing here talks to any other system.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const SERVICES = [
  { id: 'gas', group: 'gas', name: 'Gas Safety certificate (CP12)', short: 'Gas Safety', desc: 'Annual gas safety check of the boiler and gas appliances by a Gas Safe registered engineer.', price: 70 },
  { id: 'eicr_s', group: 'eicr', name: 'Electrical safety (EICR), studio to 2 bedrooms', short: 'EICR', desc: 'Electrical Installation Condition Report by a qualified electrician.', price: 120, beds: [0, 2] },
  { id: 'eicr_m', group: 'eicr', name: 'Electrical safety (EICR), 3 to 4 bedrooms', short: 'EICR', desc: 'Electrical Installation Condition Report by a qualified electrician.', price: 120, beds: [3, 4] },
  { id: 'eicr_l', group: 'eicr', name: 'Electrical safety (EICR), 5 or more bedrooms', short: 'EICR', desc: 'Electrical Installation Condition Report by a qualified electrician.', price: 150, beds: [5, 99] },
  { id: 'epc', group: 'epc', name: 'EPC (Energy Performance Certificate)', short: 'EPC', desc: 'Survey by an accredited energy assessor, lodged on the government register and valid for 10 years.', price: 120 },
];
const VAT = 0.2;
const money = n => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

let DIR = '';
const pricesFile = () => path.join(DIR, 'cert-prices.json');
const bookingsFile = () => path.join(DIR, 'bookings.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, d) => { fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(f + '.tmp', f); };
function services(){ const p = readJson(pricesFile(), {}); return SERVICES.map(s => Object.assign({}, s, { price: typeof p[s.id] === 'number' ? p[s.id] : s.price })); }
const eicrFor = (list, beds) => list.find(s => s.group === 'eicr' && beds >= s.beds[0] && beds <= s.beds[1]) || list.find(s => s.id === 'eicr_s');
function priceOf(id){ const s = services().find(x => x.id === id); return s ? s.price : null; }
// "£70", or the lowest EICR price for 'eicr': for {{PRICE_…}} on the website's pages.
function priceText(group){ return money(Math.min.apply(null, services().filter(s => s.group === group).map(s => s.price))); }

/* ------------------------------- public page ------------------------------- */
function mountPublic(app, ctx){
  DIR = ctx.REPORTS_DIR;
  const { renderPage, esc, clip, clientIp, limiter, notify, PUBLIC_BASE } = ctx;
  const bookLimit = limiter(6, 60 * 60 * 1000);
  const ic = p => `<div class="ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg></div>`;
  const ICON = { gas: '<path d="M12 2c1 3 4 5 4 9a4 4 0 1 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z"/>', eicr: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', epc: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/><path d="M9 20v-5h6v5"/>' };

  function page(req, notice){
    const list = services(), gas = list.find(s => s.id === 'gas'), epc = list.find(s => s.id === 'epc'), eicrs = list.filter(s => s.group === 'eicr');
    const eLow = Math.min.apply(null, eicrs.map(s => s.price));
    const cards = [
      ['gas', 'Gas Safety certificate', 'CP12', money(gas.price), gas.desc, ['Boiler, hob and every gas appliance checked', 'Certificate emailed to you', 'A legal requirement every 12 months for rented homes in the UK']],
      ['eicr', 'Electrical safety (EICR)', 'Electrical Installation Condition Report', 'From ' + money(eLow), eicrs[0].desc, eicrs.map(s => s.name.replace('Electrical safety (EICR), ', '').replace(/^./, c => c.toUpperCase()) + ': ' + money(s.price) + ' + VAT').concat(['Required at least every 5 years for rented homes in England'])],
      ['epc', 'EPC', 'Energy Performance Certificate', money(epc.price), epc.desc, ['Assessor visit and energy rating', 'Valid for 10 years', 'Needed before you advertise to rent or sell']],
    ].map(([k, t, sub, price, desc, pts]) => `<div class="card feature cert-card">${ic(ICON[k])}<h3>${t}</h3><p class="cert-sub">${sub}</p><div class="cert-price">${price} <small>+ VAT</small></div><p>${esc(desc)}</p><ul>${pts.map(x => '<li>' + esc(x) + '</li>').join('')}</ul><a class="btn ghost sm" href="#book" data-pick="${k}">Book ${k === 'eicr' ? 'an EICR' : 'a ' + (k === 'gas' ? 'Gas Safety check' : 'EPC')}</a></div>`).join('');
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Landlord services</span><h1>Gas Safety, EICR and EPC certificates, arranged for you.</h1><p>As well as inventory reports, DIY Inventory arranges the safety certificates every rented home needs. Choose what you need, tell us about the property, and we book a qualified Gas Safe engineer, electrician or energy assessor. You get the certificate by email. Fixed prices, nothing to pay online.</p></div></div>
<section class="tight"><div class="wrap"><div class="cert-intro">${cards}</div></div></section>
<section id="book" style="padding-top:8px"><div class="wrap">
  <div class="sec-head"><span class="kicker">Book</span><h2>Book your certificates.</h2><p>Nothing to pay now. We’ll confirm the date with you, and send payment details.</p></div>
  <form class="card form cert-form" method="post" action="/certificates#book">
    <fieldset class="cert-pick"><legend>What do you need?</legend>
      <label class="pick"><input type="checkbox" name="svc" value="gas"><span><b>Gas Safety (CP12)</b><em>${money(gas.price)} + VAT</em></span></label>
      <label class="pick"><input type="checkbox" name="svc" value="eicr"><span><b>Electrical safety (EICR)</b><em>from ${money(eLow)} + VAT</em></span></label>
      <label class="pick"><input type="checkbox" name="svc" value="epc"><span><b>EPC</b><em>${money(epc.price)} + VAT</em></span></label>
    </fieldset>
    <div class="row">
      <label>Bedrooms<select name="beds">${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${n === 2 ? ' selected' : ''}>${n === 0 ? 'Studio' : n === 6 ? '6 or more' : n}</option>`).join('')}</select></label>
      <label>Postcode<input name="postcode" required maxlength="12" autocomplete="postal-code" autocapitalize="characters"></label>
    </div>
    <label>Property address<input name="address" required maxlength="200" autocomplete="street-address"></label>
    <div class="row">
      <label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>
      <label>Phone<input name="phone" type="tel" required maxlength="30" autocomplete="tel"></label>
    </div>
    <label>Email<input name="email" type="email" required maxlength="120" autocomplete="email"></label>
    <div class="row">
      <label><b>Preferred dates <span>(optional)</span></b><input name="when" maxlength="120" placeholder="e.g. any weekday next week"></label>
      <label>Who will let us in?<select name="access"><option>Me (the landlord)</option><option>The tenant</option><option>An agent</option><option>Key safe / collect keys</option></select></label>
    </div>
    <label><b>Notes <span>(optional)</span></b><textarea name="notes" maxlength="1500" placeholder="Tenant’s name and phone, parking, boiler location…"></textarea></label>
    <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
    <div class="cert-total" aria-live="polite"><span>Total</span><strong id="certTotal">£0</strong><small id="certVat">Choose what you need</small></div>
    <button class="btn primary">Request booking</button>
    <p class="sub" style="margin:0">We’ll check we cover your area and confirm a date with you. Prices are per property and include the visit.</p>
  </form>
</div></section>
<script>
(function(){
  var P = ${JSON.stringify(Object.fromEntries(list.map(s => [s.id, s.price])))}, f = document.querySelector('.cert-form');
  function eicr(b){ b = +b; return b >= 5 ? 'eicr_l' : b >= 3 ? 'eicr_m' : 'eicr_s'; }
  function fmt(n){ return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function total(){ var sub = 0; f.querySelectorAll('[name=svc]:checked').forEach(function(x){ sub += x.value === 'eicr' ? P[eicr(f.beds.value)] : P[x.value]; });
    var vat = Math.round(sub * ${VAT} * 100) / 100; document.getElementById('certTotal').textContent = fmt(sub + vat);
    document.getElementById('certVat').textContent = sub ? fmt(sub) + ' + ' + fmt(vat) + ' VAT' : 'Choose what you need'; }
  f.addEventListener('change', total); total();
  document.querySelectorAll('[data-pick]').forEach(function(a){ a.addEventListener('click', function(){ var c = f.querySelector('[name=svc][value=' + a.getAttribute('data-pick') + ']'); if (c) { c.checked = true; total(); } }); });
})();
</script>`;
    return renderPage({ key: 'certificates', path: '/certificates', title: 'Landlord services: Gas Safety, EICR & EPC certificates · DIY Inventory', og: 'Landlord services: Gas Safety, EICR and EPC certificates',
      desc: 'Book a Gas Safety certificate (' + money(gas.price) + ' + VAT), electrical safety EICR (from ' + money(eLow) + ' + VAT) or EPC (' + money(epc.price) + ' + VAT) for your rental property.', body,
      jsonld: base => list.filter(s => s.id !== 'eicr_m' && s.id !== 'eicr_l').map(s => ({ '@type': 'Service', name: s.group === 'eicr' ? 'Electrical safety certificate (EICR)' : s.name, description: s.desc, serviceType: s.short, provider: { '@id': base + '/#org' }, areaServed: 'GB',
        offers: { '@type': 'Offer', price: (s.group === 'eicr' ? eLow : s.price).toFixed(2), priceCurrency: 'GBP', priceSpecification: { '@type': 'UnitPriceSpecification', price: (s.group === 'eicr' ? eLow : s.price).toFixed(2), priceCurrency: 'GBP', valueAddedTaxIncluded: false } } })) }, req, notice);
  }

  app.get(['/certificates', '/certificates/'], (req, res) => res.type('html').send(page(req, req.query.booked ? { ok: true, text: 'Thanks, your booking request has been sent. We’ll be in touch to confirm the date.' } : null)));
  app.post('/certificates', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
    const b = req.body || {};
    if (clip(b.website, 200)) return res.redirect(303, '/certificates?booked=1#book');   // robots
    const fail = (msg, code) => res.status(code || 400).type('html').send(page(req, { text: msg }));
    const picks = [].concat(b.svc || []).filter(x => ['gas', 'eicr', 'epc'].includes(x));
    const beds = Math.max(0, Math.min(99, parseInt(b.beds, 10) || 0));
    const m = { name: clip(b.name, 80), email: clip(b.email, 120), phone: clip(b.phone, 30), address: clip(b.address, 200), postcode: clip(b.postcode, 12).toUpperCase(), when: clip(b.when, 120), access: clip(b.access, 40), notes: String(b.notes || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 1500) };
    if (!picks.length) return fail('Please choose at least one certificate.');
    if (!m.name || !m.phone || !m.address || !m.postcode) return fail('Please fill in your name, phone number, and the property’s address and postcode.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) return fail('Please enter a valid email address.');
    if (!bookLimit(clientIp(req))) return fail('Too many booking requests from here. Please try again later, or use the contact form.', 429);
    const list = services();
    const items = picks.map(k => k === 'eicr' ? eicrFor(list, beds) : list.find(s => s.id === k)).map(s => ({ id: s.id, name: s.name, price: s.price }));
    const sub = Math.round(items.reduce((a, i) => a + i.price, 0) * 100) / 100, vat = Math.round(sub * VAT * 100) / 100;
    const booking = Object.assign({ id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), at: new Date().toISOString(), status: 'new', beds, items, subtotal: sub, vat, total: Math.round((sub + vat) * 100) / 100 }, m);
    const all = readJson(bookingsFile(), []); all.push(booking); writeJson(bookingsFile(), all.slice(-1000));
    console.log('certificate booking: ' + booking.id + ' ' + items.map(i => i.id).join('+'));
    notify({ title: 'New certificate booking: ' + items.map(i => i.id === 'gas' ? 'Gas Safety' : i.id === 'epc' ? 'EPC' : 'EICR').join(' + '), message: [m.address + ', ' + m.postcode, m.name + ' · ' + m.phone, money(booking.total) + ' inc VAT' + (m.when ? ' · ' + m.when : '')].join('\n'), tags: ['calendar'], click: PUBLIC_BASE ? PUBLIC_BASE + '/admin#bookings' : '' });
    res.redirect(303, '/certificates?booked=1#book');
  });
  return { paths: ['/certificates'] };
}

/* ------------------------------- owner's side ------------------------------- */
function mountAdmin(app, ctx){
  DIR = ctx.REPORTS_DIR;
  const { esc, requireAdmin, sameOrigin } = ctx;
  const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const STATUS = { new: ['New', 'wait'], confirmed: ['Confirmed', ''], done: ['Done', 'sent'], cancelled: ['Cancelled', ''] };
  function adminHTML(){
    const list = readJson(bookingsFile(), []).slice().reverse(), open = list.filter(b => b.status === 'new').length;
    const rows = list.slice(0, 200).map(b => `<li><div style="flex:1;min-width:0"><strong>${esc(b.items.map(i => i.name).join(' + '))}</strong> <span class="pill ${(STATUS[b.status] || STATUS.new)[1]}">${(STATUS[b.status] || STATUS.new)[0]}</span>
      <div class="sub">${esc(b.address)}, ${esc(b.postcode)} · ${b.beds === 0 ? 'studio' : b.beds + ' bed'} · <b>${money(b.total)}</b> inc VAT (${money(b.subtotal)} + ${money(b.vat)})</div>
      <div class="sub">${esc(b.name)} · <a href="tel:${esc(String(b.phone).replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a> · <a href="mailto:${esc(b.email)}">${esc(b.email)}</a> · access: ${esc(b.access || '—')}${b.when ? ' · wants: ' + esc(b.when) : ''} · ${esc(when(b.at))}</div>
      ${b.notes ? `<div class="msg">${esc(b.notes)}</div>` : ''}</div>
      <div class="actions"><form method="post" action="/admin/bookings/${esc(b.id)}"><select name="status" onchange="this.form.submit()">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}"${k === b.status ? ' selected' : ''}>${l}</option>`).join('')}</select></form></div></li>`).join('');
    const prices = services();
    return `${open ? `<a class="news" href="#bookings" onclick="document.getElementById('bookings').open=true">📅 ${open} new certificate booking${open === 1 ? '' : 's'}</a>` : ''}<details class="codes" id="bookings"${open ? ' open' : ''}><summary>📅 Certificate bookings <span class="sub" style="display:inline">— ${list.length ? list.length + ' in total' + (open ? ', ' + open + ' new' : '') : 'none yet'}</span></summary>
${rows ? '<ul>' + rows + '</ul>' : '<p class="sub">Bookings from the Certificates page appear here.</p>'}
<form method="post" action="/admin/cert-prices" class="newcode" style="margin-top:14px;flex-wrap:wrap">${prices.map(s => `<label class="sub" style="display:grid;gap:4px">${esc(s.name.replace('Electrical safety (EICR), ', 'EICR ').replace(' certificate (CP12)', ''))} £<input name="${s.id}" value="${s.price}" inputmode="decimal" style="max-width:110px"></label>`).join('')}<button class="btn">Save prices (+ VAT)</button></form></details>`;
  }
  app.post('/admin/bookings/:id', requireAdmin, express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Change bookings from the reports page.');
    const all = readJson(bookingsFile(), []), b = all.find(x => x.id === String(req.params.id));
    if (b && STATUS[req.body.status]) { b.status = req.body.status; writeJson(bookingsFile(), all); }
    res.redirect(303, '/admin#bookings');
  });
  app.post('/admin/cert-prices', requireAdmin, express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    if (!sameOrigin(req)) return res.status(403).type('text/plain').send('Change prices from the reports page.');
    const p = {};
    SERVICES.forEach(s => { const n = Math.round(parseFloat(String((req.body || {})[s.id] || '').replace(/[£,\s]/g, '')) * 100) / 100; if (n >= 0 && n < 100000) p[s.id] = n; });
    writeJson(pricesFile(), p);
    res.redirect(303, '/admin#bookings');
  });
  return { adminHTML };
}

module.exports = { mountPublic, mountAdmin, priceOf, priceText };
