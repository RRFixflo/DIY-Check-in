// The agent dashboard: a private page per tenant link, /agent/<dashKey>, for letting agents and landlords with several
// properties. It shows the reports left on a prepaid pack, the tenant link to send (copy, WhatsApp, email, text),
// every report made with the link (address, type, who did it, signed or not, view online, download the PDF), reports
// still in progress, and a CSV of them all. No password: the long random key in the address is the access (like the
// report links), sent to the agent with their pack, in every report email and from /admin; /agent/lost emails it again.
//
//   GET  /agent/:key                  the dashboard (noindex, no-store, no referrer)
//   GET  /agent/:key/r/:id.pdf        a report's PDF (the signed copy once there is one), only reports of this link
//   GET  /agent/:key/reports.csv      every report, for a spreadsheet
//   GET  /agent/lost, POST /agent/lost  "Lost your dashboard link?": emailed to the link's email if it matches (5 an hour per IP)
const express = require('express');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY_RE = /^[\w-]{24}$/;
const PRIVATE = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store' };

function mount(app, ctx){
  const R = ctx.reports;
  const base = req => (ctx.PUBLIC_BASE || ctx.canonicalBase(req)).replace(/\/+$/, '');
  const byKey = k => KEY_RE.test(String(k || '')) ? R.agentsAll().find(a => a.dashKey === k) || null : null;
  const day = t => t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '';
  const when = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '';
  const lostLimit = ctx.limiter(5, 60 * 60 * 1000);

  function dashboard(req, a){
    const link = base(req) + '/?access=' + a.token + '&start=checkin';
    const reps = R.agentReports(a), drafts = R.agentDrafts(a);
    const left = a.credits != null ? Math.max(0, Number(a.credits) - (a.uses || 0)) : null;
    const signed = reps.filter(r => r.tenantSignedAt).length;
    const msg = 'Here’s the link to do your property inventory report (check-in or check-out) on your phone. It’s already paid for: open it on the phone you’ll take the photos with.';
    const share = { wa: 'https://wa.me/?text=' + encodeURIComponent(msg + '\n' + link), sms: 'sms:?&body=' + encodeURIComponent(msg + ' ' + link),
      mail: 'mailto:?subject=' + encodeURIComponent('Your inventory report link') + '&body=' + encodeURIComponent(msg + '\n\n' + link + '\n') };
    const topUp = '/agents?' + new URLSearchParams({ email: a.email || '', name: a.name || '' }).toString() + '#packs';
    const rows = reps.map(r => {
      const paid = !(r.unpaid && !r.paidAt), dl = '/agent/' + a.dashKey + '/r/' + r.id + '.pdf';
      return `<li class="ad-r" data-q="${esc((r.address + ' ' + r.inspectionType + ' ' + (r.signedBy || r.inspectorName || '') + ' ' + r.ref).toLowerCase())}">
        <div class="ad-main"><b>${esc(r.address || 'Address not given')}</b>
          <div class="ad-meta"><span class="ad-type">${esc(r.inspectionType || 'Report')}</span> ${esc(day(r.finalizedAt || r.receivedAt))} · by ${esc(r.signedBy || r.inspectorName || '—')} · ${r.rooms || 0} rooms, ${r.photos || 0} photos · ref ${esc(r.ref || '')}</div>
          <div class="ad-meta">${r.tenantSignedAt ? '<span class="ad-ok">✍️ Signed by ' + esc(r.tenantSignedBy || 'the tenant') + (r.tenantAgree === 'comments' ? ', with comments' : '') + ' · ' + esc(day(r.tenantSignedAt)) + '</span>' : '<span class="ad-wait">Not signed by the other party yet</span>'}${paid ? '' : ' · <span class="ad-wait">Not paid for yet</span>'}</div></div>
        <div class="ad-act">${paid ? `<a class="btn primary sm" href="${dl}?download=1">⬇ PDF</a>${r.photoKey ? `<a class="btn ghost sm" href="/report/${esc(r.photoKey)}" target="_blank" rel="noopener">View online</a>` : ''}${r.photoKey && !r.tenantSignedAt ? `<button class="btn ghost sm" type="button" data-copy="${esc(base(req) + '/sign/' + r.photoKey)}">Copy sign-off link</button>` : ''}` : ''}</div></li>`;
    }).join('');
    const prog = drafts.map(({ s }) => { const m = s.meta || {}, photos = (s.rooms || []).reduce((n, rm) => n + (rm.items || []).reduce((k, it) => k + ((it.photos || []).length), 0) + ((rm.generalPhotos || []).length), 0);
      return `<li class="ad-r"><div class="ad-main"><b>${esc(m.address || 'Address not given yet')}</b><div class="ad-meta"><span class="ad-type">${esc(m.inspectionType || 'Report')}</span> started ${esc(day(s._createdAt))} · last saved ${esc(when(s._savedAt))} · ${(s.rooms || []).length} rooms · ${photos} photos${m.inspectorName ? ' · by ' + esc(m.inspectorName) : ''}</div>
        <div class="ad-meta">${s.finalizedAt ? '<span class="ad-wait">Finished on the phone, being sent</span>' : '<span class="ad-wait">In progress</span>'}</div></div></li>`; }).join('');
    const body = `<div class="page-head ad-head"><div class="wrap"><span class="kicker">Agent dashboard</span><h1>${esc(a.name)}</h1>
<p>Every report made with your tenant link, in one place. Bookmark this page: it’s private to you.</p></div></div>
<section class="tight"><div class="wrap">
  <div class="ad-tiles">
    <div class="card"><span>Reports left</span><b>${left == null ? 'Unlimited' : left}</b>${left != null ? `<a href="${esc(topUp)}">Top up</a>` : ''}</div>
    <div class="card"><span>Reports made</span><b>${reps.length}</b></div>
    <div class="card"><span>In progress</span><b>${drafts.length}</b></div>
    <div class="card"><span>Signed by the other party</span><b>${signed}</b></div>
  </div>
  ${left === 0 ? `<div class="notice" role="alert">All your prepaid reports have been used, so tenants opening your link are asked to come back later. <a href="${esc(topUp)}">Top up now</a> and the reports are added to this same link.</div>` : left != null && left <= 2 ? `<div class="notice">Only ${left} report${left === 1 ? '' : 's'} left. <a href="${esc(topUp)}">Top up</a> so your tenants aren’t held up.</div>` : ''}
  <div class="card ad-link">
    <h2>Your tenant link</h2>
    <p class="buy-small">Send the same link to every tenant moving in or out. They do the report on their phone, never see a price, and it appears here when they finish. You can also open it on your own phone and do one yourself.</p>
    <div class="buy-copy"><input id="adLink" readonly value="${esc(link)}" aria-label="Your tenant link" onclick="this.select()"><button type="button" class="btn primary" data-copy="${esc(link)}">Copy</button></div>
    <div class="buy-share"><a class="btn ghost" href="${esc(share.wa)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn ghost" href="${esc(share.mail)}">Email</a><a class="btn ghost" href="${esc(share.sms)}">Text message</a><a class="btn ghost" href="/app?start=checkin">Do one myself</a></div>
  </div>
  ${prog ? `<div class="card ad-list"><h2>In progress <span class="sub">${drafts.length}</span></h2><ul>${prog}</ul></div>` : ''}
  <div class="card ad-list">
    <div class="ad-lh"><h2>Reports <span class="sub">${reps.length}</span></h2>${reps.length ? `<input id="adQ" type="search" placeholder="Search address, type, tenant or ref" aria-label="Search reports"><a class="btn ghost sm" href="/agent/${esc(a.dashKey)}/reports.csv">Download list (CSV)</a>` : ''}</div>
    ${rows ? `<ul id="adRows">${rows}</ul><p class="buy-small" id="adNone" hidden>No reports match.</p>` : '<p class="buy-small">No reports yet. When a tenant finishes one from your link, it appears here and is emailed to ' + (a.email ? esc(a.email) : 'you') + '.</p>'}
  </div>
  <p class="buy-small" style="text-align:center;margin-top:18px">Questions or a bigger volume? <a href="/agents#talk">Talk to us</a>. Keep this page’s address private: anyone with it can see these reports.</p>
</div></section>
<script>(function(){[].forEach.call(document.querySelectorAll('[data-copy]'),function(b){b.addEventListener('click',function(){var v=b.getAttribute('data-copy'),t=b.textContent,d=function(){b.textContent='Copied';setTimeout(function(){b.textContent=t},1800)};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(v).then(d,function(){prompt('Copy this link:',v)});else prompt('Copy this link:',v)})});
var q=document.getElementById('adQ');if(q)q.addEventListener('input',function(){var v=q.value.toLowerCase().trim(),n=0;[].forEach.call(document.querySelectorAll('#adRows .ad-r'),function(li){var ok=!v||li.getAttribute('data-q').indexOf(v)>-1;li.hidden=!ok;if(ok)n++});document.getElementById('adNone').hidden=n>0})})();</script>`;
    return ctx.renderPage({ key: 'agents', path: '/agent', title: a.name + ' · Agent dashboard · DIY Inventory', desc: 'Your DIY Inventory reports.', body,
      head: '<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><style>' + CSS + '</style>', jsonld: [] }, req);
  }

  function lostPage(req, o){
    o = o || {};
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Agent dashboard</span><h1>Lost your dashboard link?</h1><p>Type the email address your pack or tenant link is under and we’ll email you the link to your dashboard.</p></div></div>
<section class="tight"><div class="wrap" style="max-width:560px">${o.sent ? '<div class="card"><h2>Check your inbox</h2><p>If that email has a dashboard with us, the link is on its way. Nothing arrived? <a href="/contact">Contact us</a>.</p></div>' : `<form class="card form" method="post" action="/agent/lost"><label><b>Email</b><input name="email" type="email" required maxlength="120" autocomplete="email"></label><button class="btn primary">Email me my dashboard link</button></form>`}</div></section>`;
    return ctx.renderPage({ key: 'agents', path: '/agent/lost', title: 'Lost your dashboard link? · DIY Inventory', desc: 'Get the link to your DIY Inventory agent dashboard.', body,
      head: '<meta name="robots" content="noindex, follow">', jsonld: [] }, req, o.notice);
  }

  app.get('/agent', (req, res) => res.redirect(302, '/agent/lost'));
  app.post('/agent/lost', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).type('html').send(lostPage(req, { notice: { text: 'Please check the email address.' } }));
    if (!lostLimit(ctx.clientIp(req))) return res.status(429).type('html').send(lostPage(req, { notice: { text: 'Too many tries from here. Please try again later.' } }));
    const mine = R.agentsAll().filter(a => String(a.email || '').toLowerCase() === email);
    const key = process.env.RESEND_API_KEY;
    if (mine.length && key) {
      const text = ['Hello,', '', 'Here’s the link to your DIY Inventory dashboard' + (mine.length > 1 ? 's' : '') + ':', ''].concat(mine.map(a => a.name + ': ' + base(req) + '/agent/' + R.agentDashKey(a.id)), ['', 'Bookmark it: it shows every report made with your tenant link.', '', 'DIY Inventory']).join('\n');
      fetch((process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.REPORT_FROM_EMAIL || 'DIY Inventory <onboarding@resend.dev>', to: [email], subject: 'Your DIY Inventory dashboard link', text }) })
        .then(r => { if (!r.ok) console.error('dashboard link email failed: HTTP ' + r.status); }).catch(e => console.error('dashboard link email failed:', e.message));
      console.log('agent dashboard: link emailed (' + mine.length + ')');
    }
    res.redirect(303, '/agent/lost?sent=1');
  });
  app.get('/agent/lost', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(lostPage(req, { sent: !!req.query.sent })));

  app.get('/agent/:key', (req, res) => {
    res.set(PRIVATE);
    const a = byKey(req.params.key);
    if (!a) return res.status(404).type('html').send(lostPage(req, { notice: { text: 'That dashboard link isn’t right, or the link has been removed. Type your email and we’ll send you the right one.' } }));
    res.type('html').send(dashboard(req, a));
  });
  app.get('/agent/:key/r/:id.pdf', (req, res) => {
    res.set(PRIVATE);
    const a = byKey(req.params.key); if (!a) return res.status(404).type('text/plain').send('Not found.');
    const r = R.agentReports(a).find(x => x.id === String(req.params.id)), f = R.reportFileOf(r);
    if (!f) return res.status(404).type('text/plain').send('Not found, or not paid for yet.');
    const name = String(r.fileName || 'report.pdf').replace(/\.pdf$/i, '').replace(/["\\\r\n]/g, '') + (f.signed ? ' - signed' : '') + '.pdf';
    res.type('application/pdf').set('Content-Disposition', (req.query.download ? 'attachment' : 'inline') + '; filename="' + name + '"');
    require('fs').createReadStream(f.file).pipe(res);
  });
  app.get('/agent/:key/reports.csv', (req, res) => {
    res.set(PRIVATE);
    const a = byKey(req.params.key); if (!a) return res.status(404).type('text/plain').send('Not found.');
    const cell = v => { let t = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const lines = [['Finished', 'Address', 'Type', 'Done by', 'Reference', 'Rooms', 'Photos', 'Signed by other party', 'Signed on', 'View online']].concat(R.agentReports(a).map(r =>
      [day(r.finalizedAt || r.receivedAt), r.address, r.inspectionType, r.signedBy || r.inspectorName, r.ref, r.rooms, r.photos, r.tenantSignedBy || '', day(r.tenantSignedAt), r.photoKey && !(r.unpaid && !r.paidAt) ? base(req) + '/report/' + r.photoKey : '']));
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="DIY Inventory reports - ' + String(a.name).replace(/[^\w &-]/g, '') + '.csv"').send('﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n'));
  });
}

const CSS = `.buy-small { color: var(--ink-faint); font-size: 14px; margin: 0; }
.buy-copy { display: flex; gap: 8px; margin: 12px 0 4px; }
.buy-copy input { flex: 1; min-width: 0; padding: 13px 16px; border: 0; border-radius: 14px; background: var(--bg); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); font: inherit; font-size: 14.5px; font-weight: 600; }
.buy-share { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; } .buy-share .btn { flex: 1 1 130px; padding: 12px 16px; }
.ad-head { padding-bottom: 28px; }
.ad-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.ad-tiles .card { padding: 18px 20px; } .ad-tiles span { display: block; color: var(--ink-faint); font-size: 13.5px; font-weight: 600; }
.ad-tiles b { font-size: 32px; letter-spacing: -.03em; } .ad-tiles a { display: block; font-size: 14px; font-weight: 600; margin-top: 2px; }
.ad-link, .ad-list { margin-bottom: 16px; } .ad-link h2, .ad-list h2 { margin: 0 0 8px; font-size: 21px; } .ad-list h2 .sub { color: var(--ink-faint); font-weight: 600; font-size: 16px; }
.ad-lh { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; } .ad-lh h2 { margin-right: auto; }
.ad-lh input { padding: 10px 14px; border: 0; border-radius: 999px; background: var(--bg); box-shadow: inset 0 0 0 1px var(--line); font: inherit; min-width: 240px; color: var(--ink); }
.ad-list ul { list-style: none; margin: 10px 0 0; padding: 0; }
.ad-r { display: flex; gap: 14px; align-items: center; padding: 14px 0; border-top: 1px solid var(--line); }
.ad-main { flex: 1; min-width: 0; } .ad-main b { overflow-wrap: anywhere; }
.ad-meta { color: var(--ink-soft); font-size: 13.5px; margin-top: 3px; overflow-wrap: anywhere; }
.ad-type { display: inline-block; background: var(--soft); color: var(--accent); font-weight: 700; font-size: 12px; padding: 2px 9px; border-radius: 999px; margin-right: 4px; }
.ad-ok { color: var(--good); font-weight: 600; } .ad-wait { color: #9a6700; font-weight: 600; }
.ad-act { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.btn.sm { padding: 8px 14px; font-size: 13.5px; }
@media (max-width: 820px) { .ad-tiles { grid-template-columns: 1fr 1fr; } .ad-r { flex-direction: column; align-items: stretch; } .ad-act { justify-content: flex-start; } .ad-lh input { min-width: 0; flex: 1 1 100%; } }`;

module.exports = { mount };
