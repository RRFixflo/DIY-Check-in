// AI content factory for DIY Inventory — a small "marketing team" on /admin.
//
// An AI writer makes social posts and short-video (Reel / Short) scripts for the owner, into a review queue.
// The owner reads them, taps Copy, opens the platform and posts — or posts nothing. It NEVER posts by itself
// and needs no social-media accounts connected (that's "content factory" mode). A fresh batch is written
// automatically once a week; "Write 5 more now" writes on demand.
//
// Honest throughout, like the rest of the site: only £29.99 (or the typical clerk range £100–£250), never any
// other price, never VAT; "made to be used as evidence", never "wins/guarantees disputes" or "approved by";
// no other company named; no invented statistics. AI wording only when the AI is switched on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FACTS = `- DIY Inventory: do your own property inventory, check-in, check-out or interim inspection on a phone.
- £29.99 per finished report. Free to start (do the whole report first, pay to download). No subscription. No VAT.
- A guided photo checklist for every room; the date and time are burned into every photo; meters, keys, the front of the property; your signature and a declaration; a professional PDF built on the phone.
- Tenant sign-off: the other party checks and signs from a link, added to the report.
- Check-outs start from the check-in and list what has changed, side by side. Interim / mid-term inspections too.
- Made to be used as evidence in a deposit dispute (never "wins" or "guarantees" a dispute; never "approved/accepted by" any scheme).
- A typical inventory clerk charges £100–£250 and needs a diary appointment.
- Several properties: prepaid packs (10 for £249, 25 for £549, 50 for £999) work out cheaper. Landlords can pay once and send the tenant the link — the tenant never sees a price.
- Website: diyinventory.co.uk. Works in the phone browser, nothing to install.`;

const PLATFORMS = {
  tiktok: { name: 'TikTok', up: 'https://www.tiktok.com/upload' },
  instagram: { name: 'Instagram', up: 'https://www.instagram.com/create/' },
  youtube: { name: 'YouTube Shorts', up: 'https://www.youtube.com/upload' },
  linkedin: { name: 'LinkedIn', up: 'https://www.linkedin.com/feed/' },
};
const PLATS = Object.keys(PLATFORMS);

const BANNED = [
  [/\bVAT\b/i, 'mentions VAT'],
  [/guarantee|guaranteed/i, 'says guarantee'],
  [/(approved|accepted|endorsed|recognised|recognized|certified) by/i, 'claims approval by someone'],
  [/\bwin(s|ning)?\b[^.]{0,40}\bdisputes?\b|\bprove[sn]?\b/i, 'claims it wins disputes or proves something'],
  [/\b(studies|survey|research)\b[^.]{0,30}\b(show|found|suggest)/i, 'quotes studies'],
  [/\bcheapest\b|\bbest\b[^.]{0,20}\b(app|tool|market)|#1|number one/i, 'superlative claim'],
  [/openrent|rightmove|zoopla|goodlord|inventorybase|inventory hive|no letting go|imfuna|reapit|homelet|propertymark|\barla\b|spareroom|onthemarket|canva|hubspot/i, 'names another business'],
];
const AI_WORDS = /\bA\.?I\.?\b|artificial intelligence|automatically finds|machine learning/i;

function mount(app, ctx){
  const { REPORTS_DIR, ai, isOwner, notify, addAdminSection, PUBLIC_BASE, esc, aiEnabled } = ctx;
  const DIR = path.join(REPORTS_DIR, 'marketing'), FILE = path.join(DIR, 'queue.json');
  const TARGET = 5;   // pieces written per automatic weekly batch
  const readQ = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { items: [], log: [], lastBatchAt: 0 }; } };
  const writeQ = q => { try { fs.mkdirSync(DIR, { recursive: true }); const t = FILE + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(q)); fs.renameSync(t, FILE); } catch (e) { console.error('marketing write failed:', e.message); } };
  const logLine = (q, text) => { (q.log = q.log || []).push({ at: new Date().toISOString(), text }); if (q.log.length > 40) q.log = q.log.slice(-40); };
  const fmt = t => { try { return new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }); } catch (e) { return ''; } };
  const ownerOk = req => isOwner(req) && (() => { const o = String(req.get('origin') || req.get('referer') || ''); try { return !o || new URL(o).host === req.get('host'); } catch (x) { return false; } })();

  // Reject anything that breaks the site's honesty rules before it reaches the queue.
  function check(it){
    const why = [];
    if (!it || typeof it !== 'object') return ['not an object'];
    if (!['post', 'reel'].includes(it.kind)) why.push('bad kind');
    if (!PLATS.includes(it.platform)) why.push('bad platform');
    if (!it.caption || String(it.caption).trim().length < 10) why.push('empty caption');
    const text = [it.hook, it.caption, (it.hashtags || []).join(' '), it.script].filter(Boolean).join('  ');
    BANNED.forEach(([re, w]) => { if (re.test(text)) why.push(w); });
    if (!aiEnabled && AI_WORDS.test(text)) why.push('mentions AI while AI is off');
    const badPrice = [...text.matchAll(/£\s?\d[\d,]*(?:\.\d+)?/g)].map(m => m[0].replace(/\s/g, '')).find(x => !['£29.99', '£100', '£250'].includes(x));
    if (badPrice) why.push('a £ figure other than £29.99 / £100–£250 (' + badPrice + ')');
    if (/\b\d{1,3}%/.test(text) && !/\b33%/.test(text)) why.push('a made-up percentage');
    return why;
  }

  async function generate(n, hint){
    if (!ai) return [];
    const system = `You are the social-media content writer for DIY Inventory, a UK service for doing your own property inventory, check-in, check-out or inspection on a phone. You write short content that gets renters and landlords to the website. Plain, punchy British English, a strong scroll-stopping hook. Today is ${new Date().toISOString().slice(0, 10)}.

Facts (use only these; invent no statistics, studies, prices, laws or company names):
${FACTS}

Angles to draw from (vary them): the deposit is decided on evidence (dated check-in vs check-out); cost vs an inventory clerk (£100–£250 vs £29.99); how-to (what to photograph at check-in); the tenant's side (protect your deposit); the landlord's side (a defensible check-in, or send the tenant the link); myth vs fact; a quick checklist.

Output only a JSON object: {"items":[ ITEM, ... ]} with exactly ${n} items. Each ITEM:
{"kind":"post" or "reel","platform":"tiktok"/"instagram"/"youtube"/"linkedin","hook":"the first line that stops the scroll","caption":"the caption or video description, 25–60 words, no hashtag list inside it","hashtags":["uklandlord","renting", up to 6, lowercase, no # sign],"script":"ONLY for kind reel: a 25–45 second script — HOOK line, then 3–5 quick beats each with a short on-screen caption, then a close naming diyinventory.co.uk; plain text, one beat per line"}

Rules:
- About half "reel", half "post". Vary platform and angle across the items; make them clearly different from each other.
- Pounds: only £29.99, or "£100–£250" for a typical clerk. Never any other amount. Never mention VAT.
- Never say it wins/guarantees a dispute or is approved/accepted by anyone — say "made to be used as evidence". Never name another company, app or website (a deposit scheme may be called "the deposit scheme").
- No invented statistics or percentages. No clickbait that the content doesn't deliver.
- Mention diyinventory.co.uk once in each caption/script.
${aiEnabled ? '- You may say it can find the changes between the check-in and check-out for you.' : '- Do not mention AI, automation, or finding changes automatically.'}${hint ? '\n- ' + hint : ''}`;
    const extra = Object.assign({}, ai.extra); if (extra.output_config) extra.output_config = { effort: 'low' };
    const r = await ai.client.beta.messages.create({ model: ai.model, max_tokens: 6000, ...extra, system, messages: [{ role: 'user', content: 'Write ' + n + ' pieces now. Make every one different.' }] });
    const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const o = ai.extractJson(text) || {};
    const raw = Array.isArray(o) ? o : (o.items || []);
    const out = [];
    for (const it of raw){
      if (!it || typeof it !== 'object') continue;
      const item = { kind: it.kind === 'reel' ? 'reel' : 'post', platform: PLATS.includes(it.platform) ? it.platform : 'instagram',
        hook: String(it.hook || '').trim().slice(0, 200), caption: String(it.caption || '').trim().slice(0, 600),
        script: it.script ? String(it.script).trim().slice(0, 1600) : '',
        hashtags: (Array.isArray(it.hashtags) ? it.hashtags : []).map(h => String(h).replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean).slice(0, 6) };
      if (item.kind === 'reel' && !item.script) continue;
      if (!check(item).length) out.push(item);
    }
    return out;
  }

  let busy = false;
  async function writeBatch(n){
    if (busy) return { ok: false, why: 'busy' };
    if (!ai) return { ok: false, why: 'AI is off (ANTHROPIC_API_KEY)' };
    busy = true;
    const q = readQ();
    try {
      const made = await generate(n || TARGET);
      if (!made.length) { logLine(q, 'wrote nothing that passed the checks'); return { ok: false, why: 'nothing passed the checks' }; }
      const now = Date.now();
      made.forEach((m, i) => q.items.unshift(Object.assign({ id: crypto.randomBytes(8).toString('hex'), at: new Date(now + i).toISOString(), status: 'todo' }, m)));
      // Keep the list from growing without end: drop the oldest posted items beyond 200.
      if (q.items.length > 200){ const posted = q.items.filter(x => x.status === 'posted'); const drop = new Set(posted.slice(200 - q.items.filter(x => x.status !== 'posted').length).map(x => x.id)); q.items = q.items.filter(x => !drop.has(x.id)); }
      q.lastBatchAt = new Date().toISOString();
      logLine(q, 'wrote ' + made.length + ' new piece' + (made.length === 1 ? '' : 's'));
      if (notify) notify({ title: made.length + ' new posts ready to share', message: made.map(m => '· ' + PLATFORMS[m.platform].name + ': ' + m.hook).slice(0, 5).join('\n'), tags: ['loudspeaker'], click: (PUBLIC_BASE || '') + '/admin#marketing' });
      return { ok: true, n: made.length };
    } catch (e) { logLine(q, 'writing failed: ' + e.message); return { ok: false, why: e.message }; }
    finally { writeQ(q); busy = false; }
  }

  // Weekly automatic batch (MARKETING_AUTO=off stops it), plus a first run a few minutes after start if the
  // queue has never been written.
  async function tick(){
    if (process.env.MARKETING_AUTO === 'off' || !ai) return;
    const q = readQ();
    if (Date.now() - Date.parse(q.lastBatchAt || 0) >= 7 * 864e5) await writeBatch(TARGET);
  }
  setTimeout(() => tick().catch(() => {}), 5 * 60 * 1000).unref();
  setInterval(() => tick().catch(() => {}), 6 * 3600 * 1000).unref();

  const form = require('express').urlencoded({ extended: false, limit: '8kb' });
  app.post('/admin/marketing/write', form, async (req, res) => { if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.'); await writeBatch(TARGET); res.redirect(303, '/admin#marketing'); });
  app.post('/admin/marketing/:id/posted', form, (req, res) => { if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.'); const q = readQ(); const it = q.items.find(x => x.id === req.params.id); if (it){ it.status = it.status === 'posted' ? 'todo' : 'posted'; it.postedAt = it.status === 'posted' ? new Date().toISOString() : ''; writeQ(q); } res.redirect(303, '/admin#marketing'); });
  app.post('/admin/marketing/:id/delete', form, (req, res) => { if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.'); const q = readQ(); q.items = q.items.filter(x => x.id !== req.params.id); writeQ(q); res.redirect(303, '/admin#marketing'); });
  app.post('/admin/marketing/:id/rewrite', form, async (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.');
    const q = readQ(), it = q.items.find(x => x.id === req.params.id);
    if (it && ai){ try { const made = await generate(1, 'Write exactly one ' + it.kind + ' for ' + PLATFORMS[it.platform].name + ', on a fresh angle.'); if (made[0]){ Object.assign(it, made[0], { status: 'todo', postedAt: '' }); const q2 = readQ(); const i2 = q2.items.find(x => x.id === it.id); if (i2) Object.assign(i2, it); writeQ(q2); } } catch (e) {} }
    res.redirect(303, '/admin#marketing');
  });

  if (addAdminSection) addAdminSection(req => {
    const q = readQ();
    const todo = q.items.filter(x => x.status !== 'posted'), posted = q.items.filter(x => x.status === 'posted');
    const weekAgo = Date.now() - 7 * 864e5, postedWeek = posted.filter(x => Date.parse(x.postedAt || 0) > weekAgo).length;
    const tile = (n, l) => `<div style="flex:1;min-width:120px;background:var(--bg);border-radius:12px;padding:10px 12px"><div style="font-size:22px;font-weight:800">${n}</div><div class="sub">${l}</div></div>`;
    const copyJs = "var t=this.closest('.mi-item').querySelector('textarea');t.focus();t.select();try{navigator.clipboard.writeText(t.value)}catch(e){document.execCommand('copy')}var b=this;b.textContent='\\u2713 Copied';setTimeout(function(){b.textContent='\\uD83D\\uDCCB Copy'},1500);return false";
    const card = it => { const P = PLATFORMS[it.platform] || PLATFORMS.instagram;
      const full = [it.hook, it.kind === 'reel' ? '\n' + it.script : '', '\n' + it.caption, it.hashtags && it.hashtags.length ? '\n' + it.hashtags.map(h => '#' + h).join(' ') : ''].filter(Boolean).join('\n').trim();
      const rows = Math.min(16, Math.max(5, Math.ceil(full.length / 54)));
      return `<div class="mi-item" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0${it.status === 'posted' ? ';opacity:.6' : ''}">
        <div style="margin-bottom:6px"><span class="pill">${esc(P.name)}</span> <span class="pill">${it.kind === 'reel' ? '🎬 short video' : '📝 post'}</span> <b>${esc(it.hook || '')}</b></div>
        <textarea readonly rows="${rows}" style="width:100%;font:inherit;padding:10px;border-radius:10px;border:0;box-shadow:inset 0 0 0 1px var(--line);background:var(--bg);color:var(--ink);resize:vertical" onclick="this.select()">${esc(full)}</textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="btn" type="button" onclick="${esc(copyJs)}">📋 Copy</button>
          <a class="btn" href="${esc(P.up)}" target="_blank" rel="noopener">Open ${esc(P.name)} ↗</a>
          <form method="post" action="/admin/marketing/${esc(it.id)}/posted" style="display:inline"><button class="btn">${it.status === 'posted' ? '↩ Not posted' : '✓ Mark posted'}</button></form>
          <form method="post" action="/admin/marketing/${esc(it.id)}/rewrite" style="display:inline"><button class="btn"${ai ? '' : ' disabled'}>↻ Rewrite</button></form>
          <form method="post" action="/admin/marketing/${esc(it.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this one?')"><button class="btn danger">✕</button></form>
        </div></div>`; };
    const fresh = todo.length ? ' open' : '';
    return `<details id="marketing"${fresh}><summary>📣 Marketing — your AI content team ${todo.length ? '(' + todo.length + ' ready to post)' : ''}</summary>
      <p class="sub">An AI writer makes social posts and short-video scripts for you every week. Read them, tap <b>Copy</b>, open the app and post. It never posts by itself — you stay in control.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">${tile(q.items.length, 'Written')}${tile(todo.length, 'Ready to post')}${tile(postedWeek, 'Posted this week')}${tile(TARGET + '/wk', 'Written automatically')}</div>
      <form method="post" action="/admin/marketing/write" style="margin:6px 0 10px"><button class="btn primary" ${ai ? '' : 'disabled'}>✍️ Write ${TARGET} more now</button>${ai ? '' : ' <span class="sub">Set ANTHROPIC_API_KEY in Railway to switch the writer on.</span>'}</form>
      ${todo.length ? '<h3 style="margin:14px 0 6px">Ready to post</h3>' + todo.map(card).join('') : '<p class="sub">Nothing waiting. The writer adds a fresh batch each week, or press “Write 5 more now”.</p>'}
      ${posted.length ? `<details style="margin-top:12px"><summary class="btn" style="display:inline-block">✓ Posted (${posted.length})</summary>${posted.slice(0, 40).map(card).join('')}</details>` : ''}
      ${(q.log || []).length ? '<h3 style="margin:16px 0 6px">Recent activity</h3><ul>' + q.log.slice(-8).reverse().map(l => `<li><div class="sub">${esc(fmt(l.at))} · ${esc(l.text)}</div></li>`).join('') + '</ul>' : ''}</details>`;
  });

  return { writeBatch, check };
}
module.exports = { mount };
