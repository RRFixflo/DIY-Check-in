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

  // Voiceover with ElevenLabs (the reel's Creative Studio → Voiceover). Needs ELEVENLABS_API_KEY in Railway;
  // ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL optionally pick a voice / model. Turns a reel's narration into an MP3.
  const VDIR = path.join(DIR, 'voice'), voiceFile = id => path.join(VDIR, id + '.mp3');
  const elevenKey = () => (process.env.ELEVENLABS_API_KEY || '').trim();
  // The spoken words only: drop on-screen-caption labels and bracketed stage directions from a script.
  const narrationOf = it => (it.voiceover || '').trim() ||
    String(it.script || '').split('\n').map(l => l.replace(/^\s*(hook|beat\s*\d*|scene\s*\d*|step\s*\d*|on[- ]?screen|text|caption|cta|close|outro|visual)\s*[:\-–—]\s*/i, '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim()).filter(Boolean).join(' ').slice(0, 1200) ||
    (it.caption || '');
  async function tts(text){
    const key = elevenKey();
    if (!key) return { ok: false, why: 'no-key' };
    const voice = (process.env.ELEVENLABS_VOICE_ID || '').trim() || '21m00Tcm4TlvDq8ikWAM';   // "Rachel", a clear public voice
    const model = (process.env.ELEVENLABS_MODEL || '').trim() || 'eleven_multilingual_v2';
    const base = (process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/+$/, '');
    try {
      const r = await fetch(base + '/v1/text-to-speech/' + encodeURIComponent(voice), { method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: String(text || '').slice(0, 2500), model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
      if (!r.ok) { const msg = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200); console.error('elevenlabs tts: HTTP ' + r.status + ' ' + msg); return { ok: false, why: r.status === 401 ? 'the API key was refused' : 'HTTP ' + r.status }; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 500) return { ok: false, why: 'empty audio' };
      return { ok: true, buf };
    } catch (e) { console.error('elevenlabs tts error:', e.message); return { ok: false, why: e.message }; }
  }

  // Reject anything that breaks the site's honesty rules before it reaches the queue.
  function check(it){
    const why = [];
    if (!it || typeof it !== 'object') return ['not an object'];
    if (!['post', 'reel'].includes(it.kind)) why.push('bad kind');
    if (!PLATS.includes(it.platform)) why.push('bad platform');
    if (!it.caption || String(it.caption).trim().length < 10) why.push('empty caption');
    const text = [it.hook, it.caption, (it.hashtags || []).join(' '), it.script, it.voiceover].filter(Boolean).join('  ');
    BANNED.forEach(([re, w]) => { if (re.test(text)) why.push(w); });
    if (!aiEnabled && AI_WORDS.test(text)) why.push('mentions AI while AI is off');
    const badPrice = [...text.matchAll(/£\s?\d[\d,]*(?:\.\d+)?/g)].map(m => m[0].replace(/\s/g, '')).find(x => !['£29.99', '£100', '£250'].includes(x));
    if (badPrice) why.push('a £ figure other than £29.99 / £100–£250 (' + badPrice + ')');
    if (/\b\d{1,3}%/.test(text) && !/\b33%/.test(text)) why.push('a made-up percentage');
    return why;
  }

  async function generate(n, hint, rules){
    if (!ai) return [];
    const system = `You are the social-media content writer for DIY Inventory, a UK service for doing your own property inventory, check-in, check-out or inspection on a phone. You write short content that gets renters and landlords to the website. Plain, punchy British English, a strong scroll-stopping hook. Today is ${new Date().toISOString().slice(0, 10)}.

Facts (use only these; invent no statistics, studies, prices, laws or company names):
${FACTS}${rules ? '\n\nThe owner’s notes on voice and what to emphasise right now — follow these as long as they don’t break the fixed rules below:\n' + rules : ''}

Angles to draw from (vary them): the deposit is decided on evidence (dated check-in vs check-out); cost vs an inventory clerk (£100–£250 vs £29.99); how-to (what to photograph at check-in); the tenant's side (protect your deposit); the landlord's side (a defensible check-in, or send the tenant the link); myth vs fact; a quick checklist.

Output only a JSON object: {"items":[ ITEM, ... ]} with exactly ${n} items. Each ITEM:
{"kind":"post" or "reel","platform":"tiktok"/"instagram"/"youtube"/"linkedin","hook":"the first line that stops the scroll","caption":"the caption or video description, 25–60 words, no hashtag list inside it","hashtags":["uklandlord","renting", up to 6, lowercase, no # sign],"script":"ONLY for kind reel: a 25–45 second script — HOOK line, then 3–5 quick beats each with a short on-screen caption, then a close naming diyinventory.co.uk; plain text, one beat per line","voiceover":"ONLY for kind reel: the spoken narration a voice reads aloud — 40–70 words of natural flowing sentences, no on-screen-caption labels or scene markers, names diyinventory.co.uk once"}

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
        voiceover: it.voiceover ? String(it.voiceover).trim().slice(0, 700) : '',
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
      const made = await generate(n || TARGET, '', q.rules);
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

  // "What you see every morning": one phone alert a day (after 07:00 London) with what's waiting for you to post.
  const londonDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const londonHour = () => parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, hour: '2-digit' }), 10) || 0;
  function briefTick(){
    if (process.env.MARKETING_AUTO === 'off' || !notify || londonHour() < 7) return;
    const q = readQ();
    if (q.lastBriefDay === londonDay()) return;
    q.lastBriefDay = londonDay(); writeQ(q);
    const ready = q.items.filter(x => x.status !== 'posted').length;
    if (!ready) return;
    const postedWeek = q.items.filter(x => x.status === 'posted' && Date.parse(x.postedAt || 0) > Date.now() - 7 * 864e5).length;
    notify({ title: '☕ Marketing brief — ' + ready + ' post' + (ready === 1 ? '' : 's') + ' ready to share', message: ['Waiting on you: ' + ready + ' to post', 'Posted this week: ' + postedWeek, 'Open /admin → Marketing to share today’s.'].join('\n'), tags: ['coffee'], click: (PUBLIC_BASE || '') + '/admin#marketing' });
  }
  setTimeout(() => briefTick(), 6 * 60 * 1000).unref();
  setInterval(() => briefTick(), 60 * 60 * 1000).unref();

  const form = require('express').urlencoded({ extended: false, limit: '8kb' });
  app.post('/admin/marketing/write', form, async (req, res) => { if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.'); await writeBatch(TARGET); res.redirect(303, '/admin#marketing'); });
  app.post('/admin/marketing/rules', form, (req, res) => { if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.'); const q = readQ(); q.rules = String((req.body || {}).rules || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 1500); writeQ(q); res.redirect(303, '/admin#marketing'); });
  app.post('/admin/marketing/:id/voice', form, async (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.');
    const q = readQ(), it = q.items.find(x => x.id === req.params.id);
    if (it){ const out = await tts(narrationOf(it));
      if (out.ok){ try { fs.mkdirSync(VDIR, { recursive: true }); fs.writeFileSync(voiceFile(it.id), out.buf); it.voice = true; it.voiceErr = ''; } catch (e) { it.voiceErr = 'could not save the audio'; } }
      else it.voiceErr = out.why === 'no-key' ? 'Add ELEVENLABS_API_KEY in Railway → Variables to switch voiceovers on.' : 'Voiceover failed: ' + out.why;
      writeQ(q); }
    res.redirect(303, '/admin#marketing');
  });
  app.get('/admin/marketing/:id/voice.mp3', (req, res) => {
    if (!isOwner(req)) return res.status(403).type('text/plain').send('Not allowed.');
    const id = String(req.params.id);
    if (!/^[a-f0-9]{16}$/.test(id) || !fs.existsSync(voiceFile(id))) return res.status(404).type('text/plain').send('No voiceover.');
    res.set('Cache-Control', 'private, no-store').type('audio/mpeg');
    if (req.query.dl) res.set('Content-Disposition', 'attachment; filename="voiceover-' + id + '.mp3"');
    fs.createReadStream(voiceFile(id)).pipe(res);
  });
  app.post('/admin/marketing/:id/posted', form, (req, res) => { if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.'); const q = readQ(); const it = q.items.find(x => x.id === req.params.id); if (it){ it.status = it.status === 'posted' ? 'todo' : 'posted'; it.postedAt = it.status === 'posted' ? new Date().toISOString() : ''; writeQ(q); } res.redirect(303, '/admin#marketing'); });
  app.post('/admin/marketing/:id/delete', form, (req, res) => { if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.'); const q = readQ(); q.items = q.items.filter(x => x.id !== req.params.id); if (/^[a-f0-9]{16}$/.test(req.params.id)) { try { fs.unlinkSync(voiceFile(req.params.id)); } catch (e) {} } writeQ(q); res.redirect(303, '/admin#marketing'); });
  app.post('/admin/marketing/:id/rewrite', form, async (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Not allowed.');
    const q = readQ(), it = q.items.find(x => x.id === req.params.id);
    if (it && ai){ try { const made = await generate(1, 'Write exactly one ' + it.kind + ' for ' + PLATFORMS[it.platform].name + ', on a fresh angle.', q.rules); if (made[0]){ Object.assign(it, made[0], { status: 'todo', postedAt: '', voice: false, voiceErr: '' }); if (/^[a-f0-9]{16}$/.test(it.id)) { try { fs.unlinkSync(voiceFile(it.id)); } catch (e) {} } const q2 = readQ(); const i2 = q2.items.find(x => x.id === it.id); if (i2) Object.assign(i2, it); writeQ(q2); } } catch (e) {} }
    res.redirect(303, '/admin#marketing');
  });

  if (addAdminSection) addAdminSection(req => {
    const q = readQ();
    const elevenOn = !!elevenKey();
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
        </div>${it.kind === 'reel' && elevenOn ? `<div style="margin-top:8px">${it.voice ? `<audio controls preload="none" src="/admin/marketing/${esc(it.id)}/voice.mp3" style="max-width:100%;vertical-align:middle"></audio> <a class="btn" href="/admin/marketing/${esc(it.id)}/voice.mp3?dl=1">⬇ Download voiceover</a> <form method="post" action="/admin/marketing/${esc(it.id)}/voice" style="display:inline"><button class="btn">🔊 Remake</button></form>` : `<form method="post" action="/admin/marketing/${esc(it.id)}/voice" style="display:inline"><button class="btn">🔊 Make AI voiceover</button></form>`}${it.voiceErr ? ` <span class="sub" style="color:#B42318">${esc(it.voiceErr)}</span>` : ''}</div>` : ''}</div>`; };
    const fresh = todo.length ? ' open' : '';
    return `<details id="marketing"${fresh}><summary>📣 Marketing — your AI content team ${todo.length ? '(' + todo.length + ' ready to post)' : ''}</summary>
      <p class="sub">An AI writer makes social posts and short-video scripts for you every week. Read them, tap <b>Copy</b>, open the app and post. It never posts by itself — you stay in control.</p>
      <p class="sub">🔊 Voiceover: ${elevenOn ? 'ElevenLabs is on ✓ — tap <b>Make AI voiceover</b> under any short-video script to get an MP3.' : 'off — add <code>ELEVENLABS_API_KEY</code> in Railway → Variables to turn reel scripts into AI voiceovers.'}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">${tile(q.items.length, 'Written')}${tile(todo.length, 'Ready to post')}${tile(postedWeek, 'Posted this week')}${tile(TARGET + '/wk', 'Written automatically')}</div>
      <form method="post" action="/admin/marketing/write" style="margin:6px 0 10px"><button class="btn primary" ${ai ? '' : 'disabled'}>✍️ Write ${TARGET} more now</button>${ai ? '' : ' <span class="sub">Set ANTHROPIC_API_KEY in Railway to switch the writer on.</span>'}</form>
      <details${q.rules ? '' : ''} style="margin:0 0 12px"><summary class="btn" style="display:inline-block">✏️ Your voice &amp; rules${q.rules ? ' ✓' : ''}</summary>
        <p class="sub" style="margin:8px 0 6px">Set this once. The writer follows it on top of the fixed rules (always £29.99, no VAT, honest claims, no company named). Say your tone, what to push right now, and anything to avoid — e.g. “Friendly and plain. Lead with deposit worries. Push the £29.99 vs a clerk. Mention tenants can do it from a link.”</p>
        <form method="post" action="/admin/marketing/rules"><textarea name="rules" rows="5" maxlength="1500" style="width:100%;font:inherit;padding:10px;border-radius:10px;border:0;box-shadow:inset 0 0 0 1px var(--line);background:var(--bg);color:var(--ink);resize:vertical" placeholder="Your tone, what to emphasise, what to avoid…">${esc(q.rules || '')}</textarea><div style="margin-top:6px"><button class="btn primary">Save</button></div></form></details>
      ${todo.length ? '<h3 style="margin:14px 0 6px">Ready to post</h3>' + todo.map(card).join('') : '<p class="sub">Nothing waiting. The writer adds a fresh batch each week, or press “Write 5 more now”.</p>'}
      ${posted.length ? `<details style="margin-top:12px"><summary class="btn" style="display:inline-block">✓ Posted (${posted.length})</summary>${posted.slice(0, 40).map(card).join('')}</details>` : ''}
      ${(q.log || []).length ? '<h3 style="margin:16px 0 6px">Recent activity</h3><ul>' + q.log.slice(-8).reverse().map(l => `<li><div class="sub">${esc(fmt(l.at))} · ${esc(l.text)}</div></li>`).join('') + '</ul>' : ''}</details>`;
  });

  return { writeBatch, check };
}
module.exports = { mount };
