// Tenant referencing, £20 per tenant paid by the landlord (tenants in England can't be charged: Tenant Fees Act).
// Self-contained so it can move to its own site later; for now it runs inside DIY Inventory and uses its landlord
// accounts (/account), card checkout (payments.js), email (Resend, via landlords.js), phone alerts and /admin.
//
//   /tenant-referencing                      the public page (what's checked, how it works, price)
//   /account/references…                     the landlord's references: start one, pay, progress, report (landlord.js)
//   /reference/apply/<token>                 the tenant's application (tenant.js)
//   /reference/r/<token>                     the employer's or previous landlord's reference form (tenant.js)
//
// The checks: identity and Right to Rent (evidence collected; the landlord records their own check), affordability
// (income ≥ 30 × monthly rent), employer reference, previous landlord reference, 3 years of addresses, a credit check
// through a provider (credit.js; or a credit report added by hand), and the tenant's consent and declaration. The
// outcome (assess.js) is a recommendation: Accepted / Accepted with a guarantor / Further checks needed.
// Data: REPORTS_DIR/referencing/ (store.js). Uploaded documents are deleted FILES_RETENTION_DAYS (default 180) after
// the application; unpaid references after 30 days.
const store = require('./store');
const { assess, pounds } = require('./assess');
const { tenantName } = require('./pdf');
const { esc, when, day } = require('./util');
const UI = require('../landlords-ui');
const staff = require('./staff');

const PRICE_P = 2000, PRICE_TEXT = '£20';
const _v = {}, CSS_V = f => _v[f] || (_v[f] = require('crypto').createHash('sha1').update(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', f))).digest('hex').slice(0, 10));

function mount(app, ctx){
  store.init(ctx.REPORTS_DIR); staff.init(ctx.REPORTS_DIR);
  const H = Object.assign({}, ctx, { PRICE_P, PRICE_TEXT,
    base: req => (ctx.PUBLIC_BASE || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, ''),
    // A page in the website's layout; signed-in landlords get the dashboard's own header and footer.
    show(req, res, o){
      let html = ctx.renderPage({ key: 'referencing', path: o.path, title: o.title + ' · DIY Inventory', og: o.title, desc: o.desc || 'Tenant referencing for landlords: ' + PRICE_TEXT + ' per tenant.',
        body: `<div class="rf${o.wide ? ' rf-wide' : ''}">${o.body}</div>`, jsonld: o.jsonld,
        head: (o.acc ? `<link rel="stylesheet" href="/account.css?v=${CSS_V('account.css')}">\n` : '') + `<link rel="stylesheet" href="/referencing.css?v=${CSS_V('referencing.css')}">` + (o.index ? '' : '\n<meta name="robots" content="noindex, nofollow">') }, req, o.notice || null);
      if (o.staff && o.acc) html = UI.staffChrome(html, o.staff, o.acc); else if (o.acc) html = UI.appChrome(html, o.acc, o.path);
      if (!o.index) res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
      res.status(o.status || 200).type('html').send(html);
    },
    sameOrigin(req){ const o = req.headers.origin || req.headers.referer || ''; try { return new URL(o).host === req.headers.host; } catch (e) { return false; } },
  });

  /* ------------------------------ public page ------------------------------ */
  const FAQ = [
    ['Who pays?', `The landlord or letting agent, ${PRICE_TEXT} per tenant. In England tenants can’t be charged for referencing (Tenant Fees Act 2019).`],
    ['How long does it take?', 'The tenant usually applies the same day. The rest depends on how quickly their employer and previous landlord reply; you can see each one’s progress and send them a reminder.'],
    ['Do you check the Right to Rent?', 'We collect the tenant’s Home Office share code or passport and link you straight to the GOV.UK check. The check itself is your legal duty as the landlord, so you record it in the reference and it goes in the report.'],
    ['Is there a credit check?', 'Yes, with the tenant’s consent: CCJs, insolvency, defaults and the electoral roll, through a credit reference provider. A credit report the tenant already has can also be added.'],
    ['What does the report say?', 'Each check with its result, the references as given, address history, affordability and a recommendation: Accepted, Accepted with a guarantor, or Further checks needed. The decision stays with you.'],
    ['What about the tenant’s data?', 'The tenant consents before anything is checked. Documents are deleted 6 months after the reference; the report stays in your account. Nobody else sees it.'],
  ];
  app.get('/tenant-referencing', (req, res) => H.show(req, res, { path: '/tenant-referencing', index: true, title: 'Tenant referencing for landlords · ' + PRICE_TEXT,
    desc: `Reference a tenant online for ${PRICE_TEXT}: Right to Rent, affordability, employer and landlord references, credit check, and a clear report.`,
    jsonld: [{ '@type': 'Service', name: 'Tenant referencing', serviceType: 'Tenant referencing', areaServed: 'GB', offers: { '@type': 'Offer', price: (PRICE_P / 100).toFixed(2), priceCurrency: 'GBP' } },
      { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
    body: `<span class="kicker">Tenant referencing</span><h1 style="font-size:clamp(34px,5vw,52px);margin-top:8px">Know who you’re letting to.<br>${PRICE_TEXT} per tenant.</h1>
      <p style="font-size:19px;color:var(--ink-soft);max-width:36em;margin-top:16px">Send your tenant a link. They apply online, we contact their employer and previous landlord, run a credit check with their consent, and you get one clear report.</p>
      <p style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a class="btn primary" href="/account/references/new">Start a reference · ${PRICE_TEXT}</a><a class="btn ghost" href="#checks">What’s checked</a></p>
      <div class="rf-grid3" id="checks">
        <div class="card"><h2>Identity and Right to Rent</h2><p>Share code or passport collected, with a direct link to the GOV.UK check, and your check recorded.</p></div>
        <div class="card"><h2>Affordability</h2><p>Income against ${'30'} × the monthly rent, using the salary their employer confirms.</p></div>
        <div class="card"><h2>Employer reference</h2><p>Role, contract, probation and salary, confirmed by the employer online.</p></div>
        <div class="card"><h2>Previous landlord</h2><p>Rent paid on time, arrears, condition, and whether they’d rent to them again.</p></div>
        <div class="card"><h2>Credit check</h2><p>CCJs, insolvency, defaults and the electoral roll, with the tenant’s consent.</p></div>
        <div class="card"><h2>Address history</h2><p>Three years of addresses, with any gaps flagged.</p></div>
      </div>
      <div class="card" style="margin-top:28px"><h2>How it works</h2><ol class="rf-steps">
        <li><span><b>Start a reference</b> with the property, rent and the tenant’s email, and pay ${PRICE_TEXT} by card.</span></li>
        <li><span><b>The tenant applies</b> on their phone in about 10 minutes and consents to the checks.</span></li>
        <li><span><b>We contact their referees</b> by email; you can also send the links by WhatsApp.</span></li>
        <li><span><b>Read the report</b> in your dashboard and download the PDF.</span></li></ol></div>
      <div class="card"><h2>Questions</h2>${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
      <p class="sub" style="margin-top:22px">The report is a recommendation to help you decide; the decision is yours. Refusing a tenant because they receive benefits or have children is unlawful in England.</p>` }));

  staff.mount(app, H);
  require('./landlord').mount(app, H);
  require('./tenant').mount(app, H);

  /* ------------------------------ owner's /admin ------------------------------ */
  if (ctx.addAdminSection) ctx.addAdminSection(() => {
    const all = store.allRefs().sort((a, b) => b.createdAt.localeCompare(a.createdAt)), paid = all.filter(r => r.payment && r.payment.paidAt);
    const rows = all.slice(0, 50).map(r => { const o = assess(r);
      return `<li><div style="flex:1;min-width:0"><strong>${esc(tenantName(r))}</strong> <span class="pill">${r.status === 'awaiting_payment' ? 'Awaiting payment' : esc(o.label)}</span>
        <div class="sub">${esc(r.property.address)} · ${pounds(r.property.rentP / 100)}/month · landlord ${esc(r.landlordName || '')} ${esc(r.landlordEmail || '')} · ${esc(when(r.createdAt))}${r.payment && r.payment.paidAt ? ' · paid' : r.free ? ' · free' : ''}</div></div></li>`; }).join('');
    return `<details class="codes" id="references"><summary>🔎 Tenant references <span class="sub" style="display:inline">: ${all.length} in total, ${paid.length} paid (${pounds(paid.length * PRICE_P / 100)})</span></summary>
      ${rows ? '<ul>' + rows + '</ul>' : '<p class="sub">References landlords start at /account/references appear here.</p>'}
      <p class="sub">Credit checks: ${require('./credit').provider() ? '<b>' + esc(require('./credit').label()) + '</b>' : '<b>no provider connected</b> (landlords can add a credit report by hand)'}. Public page: <a href="/tenant-referencing">/tenant-referencing</a>.</p></details>`;
  });

  /* ------------------------------ keeping data tidy ------------------------------ */
  const tidy = () => {
    const now = Date.now(), keep = (+process.env.FILES_RETENTION_DAYS || 180) * 864e5;
    for (const r of store.allRefs()) {
      if (r.status === 'awaiting_payment' && now - Date.parse(r.createdAt) > 30 * 864e5) { store.deleteRef(r.id); continue; }
      const sub = r.application && r.application.submittedAt;
      if (sub && !r.filesDeletedAt && (r.files || []).length && now - Date.parse(sub) > keep) { store.deleteFiles(r.id); r.filesDeletedAt = new Date().toISOString(); store.event(r, 'Documents deleted (retention period ended)'); store.saveRef(r); }
    }
  };
  setTimeout(tidy, 60e3).unref(); setInterval(tidy, 6 * 3600e3).unref();
  return { paths: ['/tenant-referencing'] };
}
module.exports = { mount, PRICE_P, PRICE_TEXT };
