'use strict';
// The owner's inbox for every email sent to any @diyinventory.co.uk address (the owner: "all emails that come in…
// there should be an inbox on my platform"). Cloudflare Email Routing (catch-all) hands each email to a small
// Email Worker (cloudflare/inbox-worker.js), which posts the raw message here with the shared key INBOX_KEY.
//   POST /api/inbound-email          raw email (message/rfc822), header X-Inbox-Key; 503 without INBOX_KEY
//   /admin → Enquiries → 📥 Inbox    the list (unread first marked), opened at /admin/inbox/:id
//   /admin/inbox/:id                 read it, attachments, the formatted version, reply (Resend), delete
// Stored in REPORTS_DIR/inbox/<id>/: mail.json, raw.eml, a/<n> (attachments). Kept: the last 3000.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), express = require('express');

const MAX = 3000;
const ID_RE = /^[a-f0-9]{20}$/;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

function mount(app, ctx){
  const DIR = path.join(ctx.REPORTS_DIR, 'inbox');
  fs.mkdirSync(DIR, { recursive: true });
  const KEY = (process.env.INBOX_KEY || '').trim();
  const DOMAIN = (process.env.INBOX_DOMAIN || 'diyinventory.co.uk').toLowerCase();
  const RESEND = (process.env.RESEND_API_KEY || '').trim();
  const FROM_DEFAULT = (process.env.REPORT_FROM_EMAIL || '').trim() || 'DIY Inventory <onboarding@resend.dev>';
  const isOwner = req => ctx.isOwner(req);
  const need = (req, res, next) => isOwner(req) ? next() : res.redirect(302, '/admin');
  const sameOrigin = req => { try { return new URL(req.headers.origin || req.headers.referer || '').host === req.headers.host; } catch (e) { return false; } };
  const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

  const file = id => path.join(DIR, id, 'mail.json');
  const read = id => { try { return ID_RE.test(id) ? JSON.parse(fs.readFileSync(file(id), 'utf8')) : null; } catch (e) { return null; } };
  const write = m => { const f = file(m.id), t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(m)); fs.renameSync(t, f); };
  let cache = null;
  function all(){
    if (cache) return cache;
    const out = [];
    for (const id of fs.readdirSync(DIR)) { const m = read(id); if (m) out.push(m); }
    cache = out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return cache;
  }
  const changed = () => { cache = null; };

  /* ---------- receiving ---------- */
  app.post('/api/inbound-email', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
    if (!KEY) return res.status(503).json({ error: 'not-configured' });
    const k = String(req.headers['x-inbox-key'] || '');
    if (k.length !== KEY.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(KEY))) return res.status(401).json({ error: 'key' });
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || raw.length < 20) return res.status(400).json({ error: 'empty' });
    let p;
    try { p = await require('mailparser').simpleParser(raw, { skipImageLinks: true }); }
    catch (e) { console.error('inbox: could not read an email: ' + e.message); return res.status(400).json({ error: 'parse' }); }
    const msgId = String(p.messageId || '').slice(0, 300);
    if (msgId && all().some(m => m.messageId === msgId)) return res.json({ ok: true, duplicate: true });
    const addrs = v => (v ? [].concat(v) : []).flatMap(x => x.value || []).map(a => ({ name: String(a.name || '').slice(0, 120), address: String(a.address || '').toLowerCase().slice(0, 200) })).filter(a => a.address);
    const envTo = String(req.headers['x-inbox-to'] || '').toLowerCase().slice(0, 200), envFrom = String(req.headers['x-inbox-from'] || '').toLowerCase().slice(0, 200);
    const id = crypto.randomBytes(10).toString('hex'), dir = path.join(DIR, id);
    fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'raw.eml'), raw);
    const atts = (p.attachments || []).filter(a => a.content && a.contentDisposition !== 'inline' || (a.content && !a.cid)).slice(0, 40).map((a, n) => {
      fs.writeFileSync(path.join(dir, 'a', String(n)), a.content);
      return { n, name: String(a.filename || 'attachment-' + (n + 1)).replace(/[\r\n"\\/]/g, '_').slice(0, 150), type: String(a.contentType || 'application/octet-stream').slice(0, 100), size: a.size || a.content.length };
    });
    const from = addrs(p.from)[0] || { name: '', address: envFrom };
    const m = { id, at: new Date().toISOString(), date: p.date ? new Date(p.date).toISOString() : null, messageId: msgId, references: String(p.references ? [].concat(p.references).join(' ') : '').slice(0, 2000),
      from, replyTo: addrs(p.replyTo)[0] || null, to: addrs(p.to), cc: addrs(p.cc), envTo,
      subject: String(p.subject || '(no subject)').slice(0, 300), text: String(p.text || (p.html ? String(p.html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ') : '')).slice(0, 200000),
      hasHtml: !!p.html, attachments: atts, read: false, replies: [] };
    if (p.html) fs.writeFileSync(path.join(dir, 'body.html'), String(p.html).slice(0, 2000000));
    write(m); changed();
    // Keep the newest MAX.
    const list = all(); list.slice(MAX).forEach(x => { try { fs.rmSync(path.join(DIR, x.id), { recursive: true, force: true }); } catch (e) {} }); if (list.length > MAX) changed();
    console.log('inbox: email to ' + (m.envTo || (m.to[0] || {}).address || '?') + ' from ' + from.address.replace(/^(.).*@/, '$1…@') + (atts.length ? ' (' + atts.length + ' attachments)' : ''));
    if (ctx.notify) try { ctx.notify({ title: '📥 Email: ' + (from.name || from.address) + ' — ' + m.subject, message: (m.text || '').replace(/\s+/g, ' ').slice(0, 300), tags: ['incoming_envelope'], click: (ctx.PUBLIC_URL || '') + '/admin/inbox/' + id }); } catch (e) {}
    res.json({ ok: true, id });
  });

  /* ---------- admin list (Enquiries → 📥 Inbox) ---------- */
  if (ctx.addAdminSection) ctx.addAdminSection(() => {
    const list = all(), unread = list.filter(m => !m.read).length;
    const rows = list.slice(0, 150).map(m => `<li class="ibx${m.read ? '' : ' un'}"><a href="/admin/inbox/${m.id}" style="display:block;flex:1;min-width:0;text-decoration:none;color:inherit">
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><strong style="overflow-wrap:anywhere">${m.read ? '' : '● '}${esc(m.from.name || m.from.address)}</strong><span class="sub" style="margin:0">${esc(when(m.at))}</span></div>
      <div style="overflow-wrap:anywhere;${m.read ? '' : 'font-weight:700'}">${esc(m.subject)}${m.attachments.length ? ' 📎' : ''}${m.replies && m.replies.length ? ' <span class="pill sent">Replied</span>' : ''}</div>
      <div class="sub" style="overflow-wrap:anywhere">To ${esc(m.envTo || (m.to[0] || {}).address || '')} · ${esc((m.text || '').replace(/\s+/g, ' ').slice(0, 140))}</div></a></li>`).join('');
    const setup = KEY ? '' : `<div class="warn" style="margin-top:12px">Not switched on yet: set <b>INBOX_KEY</b> in Railway and set up Cloudflare Email Routing (steps below).</div>`;
    return `<details class="codes" id="inbox"${unread ? ' open' : ''}><summary>📥 Inbox <span class="sub" style="display:inline">— ${list.length ? list.length + ' email' + (list.length === 1 ? '' : 's') + (unread ? ' · ' + unread + ' unread' : '') : 'no emails yet'}</span></summary>
${setup}<p class="sub" style="margin-top:12px">Every email sent to any address @${esc(DOMAIN)} lands here. Tap one to read it and reply.</p>
${rows ? '<ul style="list-style:none;padding:0;margin:0">' + rows + '</ul>' : ''}
<details style="margin-top:10px"><summary class="sub" style="cursor:pointer">How it's set up</summary><ol class="sub" style="line-height:1.6">
<li>Railway → Variables: <b>INBOX_KEY</b> = a long random password (40+ letters and numbers).</li>
<li>Cloudflare → diyinventory.co.uk → Email → Email Routing → Get started (it adds the MX and SPF records).</li>
<li>Workers &amp; Pages → Create → Worker, paste <code>cloudflare/inbox-worker.js</code> from the code, Deploy; Settings → Variables: <b>INBOX_KEY</b> (Secret, same value), optional <b>FORWARD_TO</b> = your Gmail (it must first be a verified destination address in Email Routing).</li>
<li>Email Routing → Routing rules → Catch-all address → Action “Send to a Worker” → this worker → Save.</li></ol></details></details>`;
  });

  /* ---------- reading one ---------- */
  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Inbox</title>
<style>:root{--ink:#13203A;--soft:#5B677C;--line:#E6E9F0;--navy:#1B2A4A}*{box-sizing:border-box}body{margin:0;background:#F5F6F9;color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:22px 16px 60px}a{color:var(--navy)}.card{background:#fff;border-radius:16px;box-shadow:0 0 0 1px var(--line);padding:16px 18px;margin:12px 0;min-width:0;overflow-wrap:anywhere}
h1{font-size:22px;margin:6px 0 4px;letter-spacing:-.01em;overflow-wrap:anywhere}.sub{color:var(--soft);font-size:13px}.body{white-space:pre-wrap;font-size:15px}
.btn{display:inline-block;font:inherit;font-size:14px;font-weight:600;padding:8px 14px;border-radius:999px;border:1px solid #CDD4DF;background:#fff;color:var(--ink);text-decoration:none;cursor:pointer;margin:2px 4px 2px 0}.btn.primary{background:var(--navy);border-color:var(--navy);color:#fff}.btn.danger{color:#B42318}
input,textarea{display:block;width:100%;font:inherit;padding:9px 11px;border:1px solid #CDD4DF;border-radius:10px;margin:4px 0 10px;background:#fff;color:var(--ink);font-weight:400}label{font-size:13px;font-weight:600;color:var(--soft)}
iframe{width:100%;height:70vh;border:1px solid var(--line);border-radius:12px;background:#fff}.ok{background:#E8F5EC;color:#14532D;padding:10px 14px;border-radius:10px}.bad{background:#FDECEC;color:#7A1F1F;padding:10px 14px;border-radius:10px}
ul.att{list-style:none;padding:0;margin:6px 0 0;display:flex;flex-wrap:wrap;gap:8px}</style></head><body><main><a href="/admin#inbox">← Inbox</a>${body}</main></body></html>`;
  const addrTxt = a => a ? (a.name ? a.name + ' <' + a.address + '>' : a.address) : '';
  // Reply from the address they wrote to, when it's one of ours; else the usual sender.
  const fromFor = m => { const ours = [m.envTo].concat((m.to || []).map(a => a.address), (m.cc || []).map(a => a.address)).find(a => a && a.endsWith('@' + DOMAIN));
    return ours ? 'DIY Inventory <' + ours + '>' : FROM_DEFAULT; };

  app.get('/admin/inbox/:id', need, (req, res) => {
    const m = read(String(req.params.id)); if (!m) return res.status(404).type('html').send(page('Not found', '<div class="card">That email isn’t here any more.</div>'));
    if (!m.read) { m.read = true; write(m); changed(); }
    const to = m.replyTo || m.from, base = '/admin/inbox/' + m.id, n = req.query;
    const quoted = '\n\n\nOn ' + when(m.date || m.at) + ', ' + addrTxt(m.from) + ' wrote:\n' + (m.text || '').split('\n').slice(0, 60).map(l => '> ' + l).join('\n');
    const body = `${n.sent ? '<div class="ok" style="margin-top:12px">✓ Reply sent to ' + esc(n.sent) + '</div>' : ''}${n.err ? '<div class="bad" style="margin-top:12px">The reply didn’t go: ' + esc(n.err) + '</div>' : ''}
<div class="card"><h1>${esc(m.subject)}</h1>
<div class="sub"><b>From</b> ${esc(addrTxt(m.from))}<br><b>To</b> ${esc((m.to || []).map(addrTxt).join(', ') || m.envTo)}${m.cc && m.cc.length ? '<br><b>Cc</b> ' + esc(m.cc.map(addrTxt).join(', ')) : ''}<br>${esc(when(m.date || m.at))}</div>
${m.attachments.length ? '<ul class="att">' + m.attachments.map(a => `<li><a class="btn" href="${base}/a/${a.n}">📎 ${esc(a.name)} <span class="sub">${Math.max(1, Math.round(a.size / 1024))} KB</span></a></li>`).join('') + '</ul>' : ''}</div>
<div class="card"><div class="body">${esc(m.text || '(no text)')}</div>${m.hasHtml ? `<details style="margin-top:10px"><summary class="sub" style="cursor:pointer">Show the formatted version</summary><iframe sandbox src="${base}/html" title="Formatted email"></iframe></details>` : ''}</div>
${(m.replies || []).map(r => `<div class="card"><div class="sub">↩ You replied ${esc(when(r.at))} to ${esc(r.to)} from ${esc(r.from)}</div><div class="body" style="margin-top:6px">${esc(r.text)}</div></div>`).join('')}
<div class="card" id="reply"><h2 style="font-size:17px;margin:0 0 8px">Reply</h2>${RESEND ? `<form method="post" action="${base}/reply">
<label>To<input name="to" type="email" required value="${esc(to.address)}"></label>
<label>Subject<input name="subject" maxlength="250" value="${esc(/^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject)}"></label>
<label>Message<textarea name="text" rows="12" required maxlength="20000">Hi ${esc(String(to.name || '').split(/\s+/)[0] || 'there')},\n${esc(quoted)}</textarea></label>
<div class="sub" style="margin-bottom:10px">Sent from ${esc(fromFor(m))}. Their reply comes back to this inbox.</div>
<button class="btn primary">Send reply</button></form>` : '<p class="sub">Replies need RESEND_API_KEY. <a class="btn" href="mailto:' + esc(to.address) + '?subject=' + encodeURIComponent('Re: ' + m.subject) + '">Reply from my email app</a></p>'}</div>
<form method="post" action="${base}/delete" onsubmit="return confirm('Delete this email?')"><button class="btn danger">Delete this email</button></form>
<form method="post" action="${base}/unread" style="display:inline"><button class="btn">Mark as unread</button></form>`;
    res.set('Cache-Control', 'no-store').type('html').send(page(m.subject, body));
  });
  // The formatted version, in a sandboxed frame: no scripts, no forms, no remote images (tracking pixels).
  app.get('/admin/inbox/:id/html', need, (req, res) => {
    const m = read(String(req.params.id)); if (!m) return res.status(404).end();
    let h = ''; try { h = fs.readFileSync(path.join(DIR, m.id, 'body.html'), 'utf8'); } catch (e) {}
    res.set({ 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }).type('html').send(h);
  });
  app.get('/admin/inbox/:id/a/:n', need, (req, res) => {
    const m = read(String(req.params.id)), a = m && m.attachments.find(x => String(x.n) === String(req.params.n));
    if (!a) return res.status(404).end();
    res.set({ 'Content-Disposition': 'attachment; filename="' + a.name + '"', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' }).type(a.type).sendFile(path.join(DIR, m.id, 'a', String(a.n)));
  });
  app.post('/admin/inbox/:id/unread', need, (req, res) => { if (!sameOrigin(req)) return res.status(403).end(); const m = read(String(req.params.id)); if (m) { m.read = false; write(m); changed(); } res.redirect(303, '/admin#inbox'); });
  app.post('/admin/inbox/:id/delete', need, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).end();
    const id = String(req.params.id); if (ID_RE.test(id)) { try { fs.rmSync(path.join(DIR, id), { recursive: true, force: true }); } catch (e) {} changed(); }
    res.redirect(303, '/admin#inbox');
  });
  app.post('/admin/inbox/:id/reply', need, express.urlencoded({ extended: false, limit: '100kb' }), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).end();
    const m = read(String(req.params.id)); if (!m) return res.status(404).end();
    const b = req.body || {}, to = String(b.to || '').trim().toLowerCase(), text = String(b.text || '').replace(/\r\n/g, '\n').slice(0, 20000), subject = String(b.subject || 'Re: ' + m.subject).replace(/[\r\n]/g, ' ').slice(0, 250);
    const back = q => res.redirect(303, '/admin/inbox/' + m.id + '?' + q + '#reply');
    if (!EMAIL_RE.test(to)) return back('err=' + encodeURIComponent('Check the email address.'));
    if (!text.trim()) return back('err=' + encodeURIComponent('Write a message first.'));
    if (!RESEND) return back('err=' + encodeURIComponent('Email isn’t switched on (RESEND_API_KEY).'));
    const from = fromFor(m), headers = {};
    if (m.messageId) { headers['In-Reply-To'] = m.messageId; headers['References'] = (m.references ? m.references + ' ' : '') + m.messageId; }
    try {
      const r = await fetch((process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', { method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text, headers }) });
      if (!r.ok) { const t = (await r.text().catch(() => '')).slice(0, 300); let msg = ''; try { msg = JSON.parse(t).message; } catch (e) {} console.error('inbox reply failed: HTTP ' + r.status, t); return back('err=' + encodeURIComponent(msg || 'HTTP ' + r.status)); }
    } catch (e) { return back('err=' + encodeURIComponent(e.message)); }
    const now = read(m.id) || m; now.replies = (now.replies || []).concat([{ at: new Date().toISOString(), to, from, subject, text }]).slice(-50); write(now); changed();
    back('sent=' + encodeURIComponent(to));
  });

  return { unread: () => all().filter(m => !m.read).length };
}

module.exports = { mount };
