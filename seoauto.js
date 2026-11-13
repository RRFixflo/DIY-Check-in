// SEO on autopilot, aimed at bulk buyers: letting agents and landlords with several properties.
//
// 1. A new guide every week (category "For letting agents and landlords"), written by Claude from the
//    topics below and the site's own facts, checked in code before it goes live: allowed HTML only, links only
//    to pages that exist, at least one link to /agents, prices only the site's own (or the typical clerk range),
//    no VAT, no AI claims, no "guarantee" / "approved by" / "wins disputes", no other business named, 700–1,800
//    words, and no more than 15% of its 5-word phrases shared with any other guide. One retry with the reasons;
//    otherwise the topic is tried again next week (twice at most). Stored in REPORTS_DIR/seo-auto/guides/,
//    added to /guides, the sitemap, llms.txt and IndexNow at once (seo.js addGuide). SEO_AUTO=off stops it.
// 2. Titles and descriptions tuned from Google Search Console, dormant until GSC_SERVICE_ACCOUNT is set (the
//    service account's JSON key; add its email as a user of the Search Console property). Weekly, up to 4 pages
//    sitting at position 4–20 with 30+ impressions in 28 days get a new title and description written for the
//    searches they already appear for. 28 days later: worse by 1.5 places or more with no more clicks → the old
//    wording comes back; otherwise kept. Overrides live in REPORTS_DIR/seo-auto/titles.json (renderPage hook).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CAT = 'For letting agents and landlords';
const TOPICS = [
  ['inventory-costs-for-portfolio-landlords', 'What inventories cost a landlord with several properties over a year, and how to plan for them'],
  ['tenant-self-check-in-for-letting-agents', 'How a letting agency runs tenant self check-ins: sending the link, chasing, checking the report, storing it'],
  ['inventories-across-a-property-portfolio', 'Keeping inventories consistent across a portfolio: one standard, one process, every report in one place'],
  ['check-out-reports-at-scale', 'Handling many check-outs at the end of tenancies: timing, comparing with the check-in, the deposit conversation'],
  ['student-let-inventories-for-landlords', 'Inventories for student lets with several properties: the summer changeover, shared houses, room-by-room detail'],
  ['tenancy-changeover-checklist-for-agents', 'Same-week changeovers: check-out of the old tenant, check-in of the new one, what to photograph and record'],
  ['mid-term-inspections-for-portfolios', 'Routine mid-tenancy inspections across many properties without visiting each one'],
  ['reducing-deposit-disputes-for-letting-agents', 'How a good check-in record reduces deposit disputes for agents and landlords'],
  ['remote-landlords-inventories-without-visiting', 'Landlords who live far from their properties: getting a dated inventory without travelling'],
  ['inventory-standards-for-letting-agents', 'What a good inventory report contains: the standard an agency should expect from every report'],
  ['renters-rights-act-and-inventories-for-agents', 'What the Renters’ Rights Act in England means for check-ins, inspections and evidence, for agents (dated, general information)'],
  ['budgeting-inventories-for-a-lettings-business', 'Budgeting inventories in a lettings business: per-tenancy cost, who pays, prepaid packs'],
  ['onboarding-landlord-clients-inventory-process', 'Onboarding a new landlord client: getting an inventory in place for an existing tenancy'],
  ['hmo-portfolio-inventories', 'Inventories for landlords with several HMOs: rooms, shared areas, furniture lists, frequent changeovers'],
  ['inventory-record-keeping-for-landlords', 'Keeping inventory records for many tenancies: naming, storing, finding the right report years later'],
  ['new-build-lets-inventory-guide', 'Inventories for new-build lets: snagging versus inventory, recording new condition properly'],
  ['what-tenants-should-photograph-guide-for-agents', 'A checklist agents can give tenants doing their own check-in: what to photograph in each room'],
  ['furnished-portfolio-inventories', 'Furnished lets across several properties: recording furniture and contents without hours of typing'],
  ['lettings-only-agents-inventories', 'Tenant-find (let-only) agents: offering landlords an inventory without a clerk visit'],
  ['inventories-for-property-management-companies', 'Property management companies: one process for inventories, inspections and check-outs'],
  ['meter-readings-and-keys-at-scale', 'Recording meter readings and keys at every move-in and move-out across many properties'],
  ['prepaid-inventory-packs-explained', 'How prepaid inventory packs work for agents and landlords, and when they make sense'],
  ['inventory-clerk-or-self-check-in-cost-comparison', 'Clerk visits versus tenant self check-in for a portfolio: time, cost, evidence quality'],
  ['september-rush-inventories-for-agents', 'Peak-season moves (summer and September): getting every check-in done on time'],
];

const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'br']);
const UNIT_PRICES = [29.99, 19.98, 21.96, 24.90, 249, 549, 999, 100, 120, 150, 180, 200, 250];
const BANNED = [
  [/\bVAT\b/i, 'mentions VAT'], [/\bA\.?I\.?\b|artificial intelligence|machine learning|algorithm/i, 'mentions AI'],
  [/guarantee/i, 'says guarantee'], [/(approved|accepted|endorsed|recognised|recognized|certified) by/i, 'claims approval by someone'],
  [/\bwin(s|ning)?\b[^.]{0,40}\bdisputes?\b|\bprove[sn]?\b/i, 'claims it wins disputes or proves something'],
  [/\b(studies|survey|research)\b[^.]{0,30}\b(show|found|suggest)/i, 'quotes studies'], [/\bcheapest\b|\bbest in\b|#1|number one/i, 'superlative claim'],
  [/openrent|rightmove|zoopla|goodlord|inventorybase|inventory hive|no letting go|imfuna|reapit|alto\b|arthur online|fixflo|homelet|propertymark|arla|spareroom|onthemarket/i, 'names another business'],
  [/\b(we|our) (clerks?|team) (visit|will visit|come)/i, 'promises visits'],
];
const STOP = new Set('a an and the of for to in on at with your you is are how what do does inventory inventories uk'.split(' '));

function mount(app, ctx){
  const { REPORTS_DIR, ai, seo, notify, isOwner, addAdminSection, PUBLIC_BASE } = ctx;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const DIR = path.join(REPORTS_DIR, 'seo-auto'), GDIR = path.join(DIR, 'guides');
  try { fs.mkdirSync(GDIR, { recursive: true }); } catch (e) {}
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJ = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, f); };
  const stFile = path.join(DIR, 'state.json'), tFile = path.join(DIR, 'titles.json');
  const state = () => readJ(stFile, { tried: {}, log: [] });
  const saveState = s => { s.log = (s.log || []).slice(-60); writeJ(stFile, s); };
  const logLine = (s, text) => { (s.log = s.log || []).push({ at: new Date().toISOString(), text }); console.log('seo autopilot: ' + text); };
  const off = () => /^(off|0|false|no)$/i.test(String(process.env.SEO_AUTO || ''));
  const londonHour = () => Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/London' }));

  /* ------------------------------- guides ------------------------------- */
  const autoGuides = () => fs.readdirSync(GDIR).filter(f => f.endsWith('.json')).map(f => readJ(path.join(GDIR, f), null)).filter(Boolean)
    .sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
  const asGuide = g => ({ slug: g.slug, cat: CAT, title: g.title, desc: g.desc, date: g.date, body: g.body, auto: true });
  autoGuides().filter(g => !g.hidden).forEach(g => seo.addGuide(asGuide(g), true));
  seo.refresh();

  const textOf = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const shingles = t => { const w = textOf(t).toLowerCase().replace(/[^a-z0-9£ ]/g, ' ').split(/\s+/).filter(Boolean), s = new Set(); for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' ')); return s; };
  const known = () => new Set(seo.paths.concat(['/', '/app', '/agents#packs', '/agents#talk', '/pricing', '/example-report', '/how-it-works', '/faq', '/contact']));
  const priceOk = v => UNIT_PRICES.some(p => { const n = v / p; return Math.abs(n - Math.round(n)) < 0.005 && Math.round(n) >= 1 && Math.round(n) <= 500; });

  function check(o){
    const why = [];
    if (!o || typeof o !== 'object') return ['no JSON'];
    const title = String(o.title || '').trim(), desc = String(o.desc || '').trim(), body = String(o.body || '').trim();
    if (title.length < 30 || title.length > 70) why.push('title must be 30–70 characters (was ' + title.length + ')');
    if (desc.length < 110 || desc.length > 165) why.push('description must be 110–165 characters (was ' + desc.length + ')');
    for (const m of body.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)){
      const tag = m[1].toLowerCase(), attrs = m[2].trim();
      if (!ALLOWED_TAGS.has(tag)) { why.push('tag <' + tag + '> is not allowed'); continue; }
      if (attrs && !(tag === 'a' && /^href="[^"]+"$/.test(attrs))) why.push('attributes are only allowed as href on <a> (found <' + tag + ' ' + attrs.slice(0, 40) + '>)');
    }
    const links = [...body.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]), ok = known();
    links.forEach(h => { if (!ok.has(h)) why.push('link ' + h + ' is not a page on the site'); });
    if (!links.some(h => /^\/agents/.test(h))) why.push('must link to /agents');
    const words = textOf(body).split(' ').length;
    if (words < 700 || words > 1800) why.push('body must be 700–1,800 words (was ' + words + ')');
    if (!/<h2>Questions<\/h2>/.test(body)) why.push('must end with <h2>Questions</h2>');
    const qs = (body.split('<h2>Questions</h2>')[1] || '').match(/<details><summary>[^<]+<\/summary><p>[\s\S]*?<\/p><\/details>/g) || [];
    if (qs.length < 3) why.push('needs at least 3 questions as <details><summary>…</summary><p>…</p></details>');
    const all = title + ' ' + desc + ' ' + textOf(body);
    BANNED.forEach(([re, w]) => { const m = re.exec(all); if (m) why.push(w + ' ("' + m[0] + '")'); });
    for (const m of all.matchAll(/£\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g)){ const v = Number(m[1].replace(/,/g, '')); if (!priceOk(v)) why.push('£' + m[1] + ' is not one of the site’s prices (or a count of them)'); }
    for (const m of all.matchAll(/([0-9]+(?:\.[0-9]+)?)\s?(%|per ?cent)/gi)) if (!/^(33|30)$/.test(m[1])) why.push(m[0] + ': no percentages except the 33% saving on packs');
    const mine = shingles(body);
    if (mine.size) for (const g of seo.guides()) {
      const theirs = shingles(g.body || ''); let n = 0; mine.forEach(x => { if (theirs.has(x)) n++; });
      if (n / mine.size > 0.15) why.push('shares ' + Math.round(100 * n / mine.size) + '% of its phrases with the guide “' + g.title + '”');
    }
    return [...new Set(why)].slice(0, 25);
  }

  const FACTS = `DIY Inventory (diyinventory.co.uk) lets the tenant, landlord or agent do a property inventory, check-in, check-out or inspection on a phone, in the browser, with no app to install.
- A guided photo checklist for every room; at least 8 photos per room and at least one of each item; the date and time are burned into every photo.
- Condition, description, marks, cleanliness and whether things work are recorded per item; meters (gas, electric, water) with readings and photos; keys with photos.
- The person signs and confirms a declaration; the PDF report is ready the moment it is signed, with every photo linked at full size.
- Either side can send the other a link to check, comment and sign the report.
- Check-outs and mid-tenancy inspections can start from the earlier report, so each item shows how it was then and what changed; the report lists the changes.
- A check-in must be done within 7 days of moving in.
- Price: £29.99 per report, paid when the finished report is downloaded; free to start; no subscription.
- For letting agents and landlords with several properties: prepaid packs — 10 reports for £249 (£24.90 each), 25 for £549 (£21.96 each), 50 for £999 (£19.98 each, a third less than £29.99, about 33% off). Bigger volumes by arrangement (Talk to us on /agents). Reports never expire. Topping up with the same email adds to the same link.
- A pack comes with one tenant link to send to every tenant (by email, WhatsApp or text): each tenant does their own check-in or check-out, at no charge to them. The agent or landlord gets each report by email.
- Every pack has a private agent dashboard: reports left, every report made with the link (download the PDF, view online, copy the sign-off link), reports still in progress, a CSV download.
- Typical inventory clerk prices are £100–£250 a report, more for bigger or furnished homes (say "typically").
- Reports are made to be used as evidence, for example in a deposit dispute; never say they win disputes or are accepted or approved by any scheme, court or body.
- Free templates (PDF and Word) at /inventory-template, /check-out-report-template, /inspection-report-template; room checklists at /checklists; an example report at /example-report.`;

  async function write(topic, feedback){
    const pages = known(), guides = seo.guides().map(g => '/guides/' + g.slug + ' — ' + g.title);
    const system = `You write practical guides for the website of DIY Inventory, a UK service for property inventories done on a phone. Readers are letting agents and landlords with several properties. Write in plain British English, warm and direct, short paragraphs, specific and useful, never salesy filler. Today is ${new Date().toISOString().slice(0, 10)}.

Facts you may use (use no other facts about the product, and invent no statistics, studies, quotes, prices, laws or company names):
${FACTS}

Rules:
- Output only a JSON object: {"title": "...", "desc": "...", "body": "..."}.
- title: 30–70 characters, a natural search phrase; no brand name needed. desc: 110–165 characters.
- body: HTML using only p, h2, h3, ul, ol, li, strong, em, a, table/thead/tbody/tr/th/td, details, summary. No attributes except href on a. No h1, no images, no classes, no inline styles.
- 900–1,500 words. Open with a short paragraph that answers the question straight away. Use h2 sections. Include a practical checklist or table where it helps.
- Link to 3–8 of these pages with relative links (exact paths only): ${[...pages].filter(p => /^\/($|guides|checklists|agents|inventory-(template|clerk|software|app)|check-out-report-template|inspection-report-template|tenant-self-check-in|mid-term-inspection|check-out-comparison|how-it-works|pricing|faq|example-report|landlords$|app$)/.test(p)).join(', ')}.
- Link to /agents (or /agents#packs) at least once, naturally, where the packs or the tenant link help the reader. Mention once that landlords with several properties pay less per report with a pack.
- Pounds: only £29.99, £249, £549, £999, £24.90, £21.96, £19.98, the typical clerk range £100–£250, or a count times one of those (e.g. 12 reports × £29.99 = £359.88). Percentages: only "about 33%" for the 50-pack saving. Never mention VAT.
- Never mention AI or automation. Never say guarantee, approved/accepted by, wins disputes, proves, best, cheapest. Never name another company, product or website (deposit schemes may be called "the deposit scheme").
- If you mention law, say it is general information for England as at ${new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })}, not legal advice, and keep to well-established rules.
- End with <h2>Questions</h2> and 3–5 questions, each exactly <details><summary>Question?</summary><p>Answer.</p></details>.
- Say something different from the existing guides: ${guides.join('; ')}.`;
    const user = 'Topic: ' + topic[1] + '\nURL will be /guides/' + topic[0] + (feedback ? '\n\nYour previous draft was rejected for these reasons; fix every one:\n- ' + feedback.join('\n- ') : '');
    const extra = Object.assign({}, ai.extra); if (extra.output_config) extra.output_config = { effort: 'medium' };
    const r = await ai.client.beta.messages.create({ model: ai.model, max_tokens: 16000, ...extra, system, messages: [{ role: 'user', content: user }] });
    const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return ai.extractJson(text);
  }

  let busy = false;
  async function publishNext(force){
    if (busy || !ai) return { ok: false, why: ai ? 'busy' : 'AI is off (ANTHROPIC_API_KEY)' };
    busy = true;
    const s = state();
    try {
      const done = new Set(autoGuides().map(g => g.slug).concat(seo.guides().map(g => g.slug)));
      const topic = TOPICS.find(t => !done.has(t[0]) && (s.tried[t[0]] || 0) < 2);
      if (!topic) { logLine(s, 'every topic has been written'); return { ok: false, why: 'no topics left' }; }
      s.tried[topic[0]] = (s.tried[topic[0]] || 0) + 1;
      let out = await write(topic), why = check(out);
      if (why.length) { logLine(s, topic[0] + ': first draft rejected — ' + why.slice(0, 4).join('; ')); out = await write(topic, why); why = check(out); }
      if (why.length) { logLine(s, topic[0] + ': not published — ' + why.slice(0, 4).join('; ')); s.lastTryAt = new Date().toISOString(); return { ok: false, why: why.join('; ') }; }
      const g = { slug: topic[0], topic: topic[1], title: out.title.trim(), desc: out.desc.trim(), body: out.body.trim(), date: new Date().toISOString().slice(0, 10), publishedAt: new Date().toISOString(), model: ai.model };
      writeJ(path.join(GDIR, g.slug + '.json'), g);
      seo.addGuide(asGuide(g));
      s.lastPublishAt = g.publishedAt; logLine(s, 'published /guides/' + g.slug + ' — ' + g.title + (force ? ' (by hand)' : ''));
      if (notify) notify({ title: 'New guide published', message: g.title + '\n' + (PUBLIC_BASE || '') + '/guides/' + g.slug, tags: ['memo'], click: (PUBLIC_BASE || '') + '/guides/' + g.slug });
      return { ok: true, slug: g.slug };
    } catch (e) { logLine(s, 'writing failed: ' + e.message); return { ok: false, why: e.message }; }
    finally { saveState(s); busy = false; }
  }
  async function guideTick(){
    if (off() || !ai) return;
    const s = state(), last = Date.parse(s.lastPublishAt || 0), lastTry = Date.parse(s.lastTryAt || 0);
    if (Date.now() - last < 7 * 864e5 || Date.now() - lastTry < 3 * 864e5 || londonHour() < 9) return;
    await publishNext(false);
  }

  /* --------------------------- Search Console tuner --------------------------- */
  const gscKey = () => { try { const k = JSON.parse(process.env.GSC_SERVICE_ACCOUNT || ''); return k.client_email && k.private_key ? k : null; } catch (e) { return null; } };
  const siteHost = () => { try { return new URL(PUBLIC_BASE).host.replace(/^www\./, ''); } catch (e) { return ''; } };
  const gscSite = () => process.env.GSC_SITE || (siteHost() ? 'sc-domain:' + siteHost() : '');
  let tok = null;
  async function gscToken(){
    if (tok && tok.exp > Date.now() + 60000) return tok.value;
    const k = gscKey(), now = Math.floor(Date.now() / 1000), b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const jwt = unsigned + '.' + crypto.createSign('RSA-SHA256').update(unsigned).sign(k.private_key).toString('base64url');
    const r = await fetch(process.env.GSC_TOKEN_URL || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error('Search Console sign-in failed: ' + (j.error_description || j.error || 'HTTP ' + r.status));
    tok = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; return tok.value;
  }
  const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  async function gscRows(start, end, filterPage){
    const body = { startDate: start, endDate: end, dimensions: ['page', 'query'], rowLimit: 25000 };
    if (filterPage) body.dimensionFilterGroups = [{ filters: [{ dimension: 'page', operator: 'equals', expression: filterPage }] }];
    const r = await fetch((process.env.GSC_API_BASE || 'https://www.googleapis.com/webmasters/v3') + '/sites/' + encodeURIComponent(gscSite()) + '/searchAnalytics/query', { method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: 'Bearer ' + await gscToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Search Console query failed: ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
    return (j.rows || []).map(x => ({ page: x.keys[0], query: x.keys[1], clicks: x.clicks, impr: x.impressions, pos: x.position }));
  }
  const pathOf = u => { try { const x = new URL(u); return x.host.replace(/^www\./, '') === siteHost() ? x.pathname.replace(/\/+$/, '') || '/' : null; } catch (e) { return null; } };
  const summary = (rows, terms) => { const r = terms ? rows.filter(x => terms.includes(x.query)) : rows; const impr = r.reduce((a, x) => a + x.impr, 0);
    return { impr, clicks: r.reduce((a, x) => a + x.clicks, 0), pos: impr ? Math.round(10 * r.reduce((a, x) => a + x.pos * x.impr, 0) / impr) / 10 : null }; };
  async function livePage(p){
    const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + p, { headers: { 'User-Agent': 'seo-autopilot (internal)', Host: siteHost() || 'localhost' }, signal: AbortSignal.timeout(15000) });
    const h = await r.text(), dec = t => String(t || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return { status: r.status, title: dec((/<title>([\s\S]*?)<\/title>/.exec(h) || [])[1]).trim(), desc: dec((/<meta name="description" content="([^"]*)"/.exec(h) || [])[1]),
      text: textOf(h.replace(/<(script|style|header|footer|nav)[\s\S]*?<\/\1>/g, ' ')).slice(0, 5000) };
  }
  const titles = () => readJ(tFile, { pages: {} });
  let tcache = null, tcacheAt = 0;
  // renderPage calls this for every page: the tuned title/description replaces the page's own while it is live.
  function override(pg){
    if (!pg || !pg.path) return pg;
    if (!tcache || Date.now() - tcacheAt > 60000) { tcache = titles().pages; tcacheAt = Date.now(); }
    const t = tcache[pg.path];
    return t && (t.status === 'live' || t.status === 'kept') ? Object.assign({}, pg, { title: t.title, desc: t.desc }) : pg;
  }
  async function tuneTick(force){
    if (!gscKey() || !ai || (off() && !force)) return { ok: false, why: !gscKey() ? 'GSC_SERVICE_ACCOUNT is not set' : 'off' };
    const T = titles(), s = state(), now = Date.now(); let changed = 0;
    try {
      // 1) Judge changes made 28+ days ago.
      for (const [p, t] of Object.entries(T.pages)) {
        if (t.status !== 'live' || now - Date.parse(t.at) < 28 * 864e5) continue;
        const rows = (await gscRows(day(26), day(2))).filter(x => pathOf(x.page) === p);
        const after = summary(rows, t.terms); t.after = after; t.judgedAt = new Date().toISOString();
        if (after.pos != null && t.before.pos != null && after.pos - t.before.pos >= 1.5 && after.clicks <= t.before.clicks) { t.status = 'reverted'; logLine(s, 'reverted ' + p + ' (position ' + t.before.pos + ' → ' + after.pos + ')'); }
        else { t.status = 'kept'; logLine(s, 'kept the new title on ' + p + ' (position ' + t.before.pos + ' → ' + (after.pos == null ? '—' : after.pos) + ')'); }
        changed++;
      }
      // 2) New changes, once a week.
      if (force || now - Date.parse(s.lastTuneAt || 0) > 7 * 864e5) {
        s.lastTuneAt = new Date().toISOString();
        const rows = await gscRows(day(30), day(2)), byPage = {};
        rows.forEach(x => { const p = pathOf(x.page); if (p && seo.paths.includes(p)) (byPage[p] = byPage[p] || []).push(x); });
        const cands = Object.entries(byPage).map(([p, r]) => ({ p, r, sum: summary(r) }))
          .filter(c => c.sum.impr >= 30 && c.sum.pos >= 4 && c.sum.pos <= 20 && !(T.pages[c.p] && now - Date.parse(T.pages[c.p].at) < (T.pages[c.p].status === 'reverted' ? 120 : 90) * 864e5))
          .sort((a, b) => b.sum.impr - a.sum.impr).slice(0, 4);
        for (const c of cands) {
          const live = await livePage(c.p); if (live.status !== 200 || !live.title) continue;
          const terms = c.r.slice().sort((a, b) => b.impr - a.impr).slice(0, 8).map(x => x.query);
          const sys = `You improve the Google title and meta description of one page on diyinventory.co.uk (UK property inventories on a phone; £29.99 a report; prepaid packs for agents and landlords with several properties). Output only JSON {"title": "...", "desc": "..."}. Title 25–62 characters, description 110–160 characters. Match what searchers want from the searches listed; keep the page's meaning; facts only from the page text. Use only £ figures that appear in the page text. Never mention VAT or AI; no "best", "cheapest", "guarantee", "#1"; no other company names.`;
          const msg = `Page: ${c.p}\nCurrent title: ${live.title}\nCurrent description: ${live.desc}\nSearches it appears for (most shown first): ${terms.join(' | ')}\nAverage position: ${c.sum.pos}\nPage text:\n${live.text}`;
          const r = await ai.client.beta.messages.create({ model: ai.model, max_tokens: 4000, ...ai.extra, system: sys, messages: [{ role: 'user', content: msg }] });
          const o = ai.extractJson((r.content || []).filter(b => b.type === 'text').map(b => b.text).join('')) || {};
          const title = String(o.title || '').trim(), desc = String(o.desc || '').trim(), both = title + ' ' + desc;
          const stems = terms.slice(0, 3).join(' ').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP.has(w));
          const bad = title.length < 25 || title.length > 62 ? 'title length ' + title.length : desc.length < 110 || desc.length > 160 ? 'description length ' + desc.length
            : (BANNED.find(([re]) => re.test(both)) || [])[1] || ([...both.matchAll(/£\s?[0-9][0-9,]*(?:\.[0-9]+)?/g)].map(m => m[0].replace(/\s/, '')).find(x => !live.text.includes(x)) ? 'a £ figure not on the page' : '')
            || (!stems.some(w => title.toLowerCase().includes(w)) ? 'title has none of the search words' : '');
          if (bad) { logLine(s, 'new title for ' + c.p + ' not used (' + bad + ')'); continue; }
          T.pages[c.p] = { title, desc, oldTitle: live.title, oldDesc: live.desc, at: new Date().toISOString(), terms, before: summary(c.r, terms), status: 'live' };
          writeJ(tFile, T); tcache = null;
          const check2 = await livePage(c.p).catch(() => null);
          if (!check2 || check2.title !== title) { T.pages[c.p].status = 'unsupported'; logLine(s, c.p + ': the page doesn’t use the shared title, left as it was'); }
          else { logLine(s, 'new title on ' + c.p + ': ' + title); changed++; }
        }
      }
      writeJ(tFile, T); tcache = null; saveState(s);
      if (changed && notify) notify({ title: 'SEO autopilot: titles', message: (s.log || []).slice(-changed).map(l => l.text).join('\n'), tags: ['mag'], click: (PUBLIC_BASE || '') + '/admin#seoauto' });
      return { ok: true, changed };
    } catch (e) { logLine(s, 'Search Console: ' + e.message); saveState(s); return { ok: false, why: e.message }; }
  }

  setTimeout(() => { guideTick().catch(() => {}); tuneTick().catch(() => {}); }, 4 * 60 * 1000).unref();
  setInterval(() => { guideTick().catch(() => {}); tuneTick().catch(() => {}); }, 6 * 3600 * 1000).unref();

  /* --------------------------------- admin --------------------------------- */
  const ownerOk = req => isOwner(req) && (() => { const o = String(req.get('origin') || req.get('referer') || ''); try { return !o || new URL(o).host === req.get('host'); } catch (x) { return false; } })();
  const form = require('express').urlencoded({ extended: false, limit: '4kb' });
  app.post('/admin/seo-auto/run', form, (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Sign in on /admin first.');
    const what = String(req.body.what || 'guide');
    (what === 'titles' ? tuneTick(true) : publishNext(true)).catch(() => {});
    res.redirect(303, '/admin?seo=working#seoauto');
  });
  app.post('/admin/seo-auto/guide/:slug', form, (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Sign in on /admin first.');
    const f = path.join(GDIR, String(req.params.slug).replace(/[^a-z0-9-]/g, '') + '.json'), g = readJ(f, null);
    if (g) {
      const hide = req.body.action === 'hide'; g.hidden = hide; writeJ(f, g);
      if (hide) seo.removeGuide(g.slug); else seo.addGuide(asGuide(g));
    }
    res.redirect(303, '/admin#seoauto');
  });
  app.post('/admin/seo-auto/title', form, (req, res) => {
    if (!ownerOk(req)) return res.status(403).type('text/plain').send('Sign in on /admin first.');
    const T = titles(), t = T.pages[String(req.body.path || '')];
    if (t && (t.status === 'live' || t.status === 'kept')) { t.status = 'undone'; t.undoneAt = new Date().toISOString(); writeJ(tFile, T); tcache = null; }
    res.redirect(303, '/admin#seoauto');
  });
  if (addAdminSection) addAdminSection(req => {
    const s = state(), gs = autoGuides().slice().reverse(), T = titles().pages, fmt = t => t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const left = TOPICS.filter(t => !gs.some(g => g.slug === t[0]) && (s.tried[t[0]] || 0) < 2).length;
    const next = s.lastPublishAt ? fmt(Date.parse(s.lastPublishAt) + 7 * 864e5) : 'within a few hours';
    const rows = gs.map(g => `<li><div style="flex:1;min-width:0"><a href="/guides/${esc(g.slug)}" target="_blank" rel="noopener"><strong>${esc(g.title)}</strong></a> ${g.hidden ? '<span class="pill">Taken down</span>' : ''}<div class="sub">${esc(fmt(g.publishedAt))} · /guides/${esc(g.slug)}</div></div>
      <form method="post" action="/admin/seo-auto/guide/${esc(g.slug)}"><button class="btn" name="action" value="${g.hidden ? 'show' : 'hide'}">${g.hidden ? 'Put back' : 'Take down'}</button></form></li>`).join('');
    const trows = Object.entries(T).reverse().map(([p, t]) => `<li><div style="flex:1;min-width:0"><strong>${esc(p)}</strong> <span class="pill">${esc({ live: 'Live, judged after 28 days', kept: 'Kept', reverted: 'Old wording back', undone: 'Undone', unsupported: 'Page not supported' }[t.status] || t.status)}</span>
      <div class="sub">New: ${esc(t.title)}<br>Was: ${esc(t.oldTitle)}<br>Position ${t.before && t.before.pos != null ? t.before.pos : '—'}${t.after ? ' → ' + (t.after.pos == null ? '—' : t.after.pos) : ''} · ${esc(fmt(t.at))}</div></div>
      ${t.status === 'live' || t.status === 'kept' ? `<form method="post" action="/admin/seo-auto/title"><input type="hidden" name="path" value="${esc(p)}"><button class="btn">Undo</button></form>` : ''}</li>`).join('');
    const gsc = gscKey();
    return `<details class="codes" id="seoauto"><summary>🚀 SEO autopilot <span class="sub" style="display:inline">— ${gs.filter(g => !g.hidden).length} guide${gs.length === 1 ? '' : 's'} published${off() ? ' · switched off (SEO_AUTO)' : ''}</span></summary>
<p class="sub" style="margin-top:12px">${ai ? '' : '<strong>AI is off (no ANTHROPIC_API_KEY), so no guides are written.</strong> '}A new guide for letting agents and landlords with several properties is written and published each week, checked before it goes live (prices, links, no VAT, no claims), and sent to the search engines. Next one: ${esc(next)}. Topics left: ${left}. ${req.query && req.query.seo === 'working' ? '<strong>Working on it — refresh in a minute or two.</strong>' : ''}</p>
<form method="post" action="/admin/seo-auto/run" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" name="what" value="guide"${ai ? '' : ' disabled'}>Write the next guide now</button>${gsc ? '<button class="btn" name="what" value="titles">Tune titles from Search Console now</button>' : ''}</form>
${rows ? '<ul>' + rows + '</ul>' : ''}
<h3 style="margin:18px 0 6px">Titles tuned from Google Search Console</h3>
${gsc ? `<p class="sub">Connected (${esc(gscSite())}). Each week up to 4 pages that sit on Google’s page 1–2 get a title written for the searches they already appear for; after 28 days a change that did worse is undone by itself.</p>${trows ? '<ul>' + trows + '</ul>' : '<p class="sub">No changes yet.</p>'}`
  : `<p class="sub">Not connected. In Google Cloud make a service account with a JSON key, add its email as a user (Restricted) of the Search Console property, then paste the whole key into Railway as <code>GSC_SERVICE_ACCOUNT</code>. Optional <code>GSC_SITE</code> (default <code>sc-domain:${esc(siteHost() || 'your domain')}</code>).</p>`}
${(s.log || []).length ? '<h3 style="margin:18px 0 6px">Recent activity</h3><ul>' + s.log.slice(-10).reverse().map(l => `<li><div class="sub">${esc(fmt(l.at))} · ${esc(l.text)}</div></li>`).join('') + '</ul>' : ''}</details>`;
  });

  return { override, publishNext, tuneTick, check, TOPICS };
}

module.exports = { mount, TOPICS };
