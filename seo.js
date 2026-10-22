// SEO on autopilot.
// - Room checklist pages (/checklists, /checklists/<room>) are generated from the app's own checklists and
//   photo tips (ROOM_TYPE_ITEMS, TIP_RULES, photoTipFor in public/index.html), so they change when the app does.
// - Guides (/guides, /guides/<slug>) are written pages in views/guides/, listed in GUIDES below.
// - /sitemap.xml lists every public page, /robots.txt points to it, and every page carries structured data.
// - IndexNow: when the set of pages or their content changes (a deploy), the new list is sent to the search
//   engines that take IndexNow (Bing, Yandex, Seznam, Naver…) once, from the site's public address.
//   Google reads the sitemap: add the site once in Google Search Console (GOOGLE_SITE_VERIFICATION).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GUIDES = [
  { slug: 'how-to-do-a-check-in-inventory', title: 'How to do a check-in inventory yourself', desc: 'A step-by-step guide to doing your own property check-in inventory on your phone: what to photograph, how to record condition, and how to get it signed.', date: '2026-10-22' },
  { slug: 'how-to-photograph-a-rental-property', title: 'How to photograph a rental property for an inventory', desc: 'Practical tips for inventory photos that hold up later: light, angles, wide shots and close-ups, and the date and time on every photo.', date: '2026-10-22' },
  { slug: 'check-out-inspection-guide', title: 'Check-out inspections: comparing a property with the check-in', desc: 'How to do a check-out inspection, compare each item with the check-in report, and record what has changed fairly.', date: '2026-10-22' },
  { slug: 'mid-tenancy-inspection-checklist', title: 'Mid-tenancy inspection checklist for landlords', desc: 'What to check during a routine inspection: damp, leaks, safety alarms, appliances and wear, room by room.', date: '2026-10-22' },
  { slug: 'fair-wear-and-tear-vs-damage', title: 'Fair wear and tear vs damage: what’s the difference?', desc: 'How inventories usually tell normal wear from damage, with examples for carpets, walls, furniture and appliances. General information, not legal advice.', date: '2026-10-22' },
];
const ROOM_NAMES = { bedroom: 'Bedroom', bathroom: 'Bathroom', kitchen: 'Kitchen', living: 'Living room', hallway: 'Hallway and entrance', garden: 'Garden and outdoor space', utility: 'Utility room', wc: 'Separate WC', other: 'Any other room' };
const ROOM_SLUGS = { bedroom: 'bedroom', bathroom: 'bathroom', kitchen: 'kitchen', living: 'living-room', hallway: 'hallway', garden: 'garden', utility: 'utility-room', wc: 'wc', other: 'other-rooms' };

// The app's checklists and tips, read from public/index.html.
function appChecklists(root){
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const grab = re => { const m = re.exec(html); if (!m) throw new Error('seo: could not find ' + re); return m[0]; };
  const src = [grab(/const ROOM_TYPE_ITEMS = \{[\s\S]*?\n\};/), grab(/const TIP_RULES = \[[\s\S]*?\n\];/), grab(/function photoTipFor\(label\)\{[\s\S]*?\n\}/), grab(/const MIN_PHOTOS = \d+;/), grab(/const MAX_PHOTOS = \d+;/)].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn { ROOM_TYPE_ITEMS, photoTipFor, MIN_PHOTOS, MAX_PHOTOS };')();
}

function mount(app, ctx){
  const { ROOT, REPORTS_DIR, renderPage, canonicalBase, PUBLIC_BASE, escHtml } = ctx;
  const C = appChecklists(ROOT);
  const guideBody = slug => fs.readFileSync(path.join(ROOT, 'views', 'guides', slug + '.html'), 'utf8');
  GUIDES.forEach(g => { g.body = guideBody(g.slug); });

  const crumbs = (base, list) => ({ '@type': 'BreadcrumbList', itemListElement: list.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + p })) });
  const cta = `<div class="final" style="padding-top:28px"><div class="wrap"><div class="card"><h2>Do it on your phone</h2><p>DIY Inventory gives every room its own photo checklist, stamps the date and time on every photo, and turns it into a professional PDF report. Free to start.</p><a class="btn" href="/app">Start free</a></div></div></div>`;
  const head = (kicker, title, lead, back) => `<div class="page-head"><div class="wrap">${back ? `<p style="margin:0 0 6px"><a href="${back[1]}">← ${back[0]}</a></p>` : ''}<span class="kicker">${kicker}</span><h1>${escHtml(title)}</h1><p>${lead}</p></div></div>`;

  /* ---------------------------- room checklists ---------------------------- */
  const types = Object.keys(C.ROOM_TYPE_ITEMS);
  const checklistPage = type => {
    const name = ROOM_NAMES[type] || type, items = C.ROOM_TYPE_ITEMS[type];
    const title = name === 'Any other room' ? 'Inventory checklist for any other room' : name + ' inventory checklist';
    const body = head('Room checklist', title, `What to photograph and record in ${name === 'Any other room' ? 'any other room' : 'the ' + name.toLowerCase()} for a check-in, check-out or inspection report, with a photo tip for each item.`, ['All room checklists', '/checklists']) +
      `<section class="tight"><div class="wrap"><div class="card prose">
        <ol class="checklist-list">${items.map(it => `<li><strong>${escHtml(it)}</strong><span>${escHtml(C.photoTipFor(it))}</span></li>`).join('')}</ol>
        <h2>For each item, record</h2>
        <ul><li>Its condition: new, good, fair or poor.</li><li>A short description: colour, material, type.</li><li>Any marks or damage, and how clean it is.</li><li>Whether it works, for doors, windows, appliances and fittings.</li></ul>
        <p>Take at least ${C.MIN_PHOTOS} photos in every room, and at least one of each item. A wide shot first, then close-ups of anything worn or damaged.</p>
        <h2>Other rooms</h2><p>${types.filter(t => t !== type).map(t => `<a href="/checklists/${ROOM_SLUGS[t]}">${escHtml(ROOM_NAMES[t])}</a>`).join(' · ')}</p>
      </div></div></section>` + cta;
    return { key: 'checklists', path: '/checklists/' + ROOM_SLUGS[type], title: title + ' · DIY Inventory', og: title, desc: `${title}: the ${items.length} items to photograph and record, with a photo tip for each. Free printable checklist for check-ins, check-outs and inspections.`, body,
      jsonld: base => [crumbs(base, [['Home', '/'], ['Room checklists', '/checklists'], [name, '/checklists/' + ROOM_SLUGS[type]]]),
        { '@type': 'ItemList', name: title, itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it, description: C.photoTipFor(it) })) }] };
  };
  const checklistIndex = () => ({ key: 'checklists', path: '/checklists', title: 'Room-by-room inventory checklists · DIY Inventory', og: 'Room-by-room inventory checklists', desc: 'Free room-by-room inventory checklists for check-ins, check-outs and inspections: what to photograph in every room, with photo tips.',
    body: head('Checklists', 'Room-by-room inventory checklists', 'What to photograph and record in every room, with a tip for each item. These are the same checklists the DIY Inventory app uses.') +
      `<section class="tight"><div class="wrap"><div class="features">${types.map(t => `<a class="card feature" style="text-decoration:none;color:inherit" href="/checklists/${ROOM_SLUGS[t]}"><h3>${escHtml(ROOM_NAMES[t])}</h3><p>${C.ROOM_TYPE_ITEMS[t].slice(0, 4).map(escHtml).join(', ')} and more</p></a>`).join('')}</div></div></section>` + cta,
    jsonld: base => [crumbs(base, [['Home', '/'], ['Room checklists', '/checklists']])] });

  /* --------------------------------- guides --------------------------------- */
  const guidePage = g => ({ key: 'guides', path: '/guides/' + g.slug, title: g.title + ' · DIY Inventory', og: g.title, desc: g.desc,
    body: head('Guide', g.title, escHtml(g.desc), ['All guides', '/guides']) + `<section class="tight"><div class="wrap"><article class="card prose">${g.body}<p class="updated">Updated ${new Date(g.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p></article></div></section>` + cta,
    jsonld: base => [crumbs(base, [['Home', '/'], ['Guides', '/guides'], [g.title, '/guides/' + g.slug]]),
      { '@type': 'Article', headline: g.title, description: g.desc, datePublished: g.date, dateModified: g.date, inLanguage: 'en', mainEntityOfPage: base + '/guides/' + g.slug, author: { '@id': base + '/#org' }, publisher: { '@id': base + '/#org' }, image: base + '/icons/icon-512.png' }] });
  const guideIndex = () => ({ key: 'guides', path: '/guides', title: 'Inventory and inspection guides · DIY Inventory', og: 'Inventory and inspection guides', desc: 'Practical guides to property inventories, check-ins, check-outs, inspections and inventory photos, for tenants, landlords and agents anywhere.',
    body: head('Guides', 'Inventory and inspection guides', 'Practical help for tenants, landlords and agents, wherever the property is.') +
      `<section class="tight"><div class="wrap"><div class="timeline">${GUIDES.map(g => `<a class="card" style="display:block;text-decoration:none;color:inherit" href="/guides/${g.slug}"><h3 style="margin:0 0 6px">${escHtml(g.title)}</h3><p style="margin:0;color:var(--ink-soft)">${escHtml(g.desc)}</p></a>`).join('')}
      <a class="card" style="display:block;text-decoration:none;color:inherit" href="/checklists"><h3 style="margin:0 0 6px">Room-by-room inventory checklists</h3><p style="margin:0;color:var(--ink-soft)">What to photograph in every room, with a tip for each item.</p></a></div></div></section>` + cta,
    jsonld: base => [crumbs(base, [['Home', '/'], ['Guides', '/guides']])] });

  const send = pg => (req, res) => res.type('html').send(renderPage(pg, req));
  app.get(['/checklists', '/checklists/'], send(checklistIndex()));
  types.forEach(t => app.get(['/checklists/' + ROOM_SLUGS[t], '/checklists/' + ROOM_SLUGS[t] + '/'], send(checklistPage(t))));
  app.get(['/guides', '/guides/'], send(guideIndex()));
  GUIDES.forEach(g => app.get(['/guides/' + g.slug, '/guides/' + g.slug + '/'], send(guidePage(g))));

  /* ------------------------- sitemap, robots, IndexNow ------------------------- */
  const sitePaths = ctx.sitePaths.concat(['/guides'], GUIDES.map(g => '/guides/' + g.slug), ['/checklists'], types.map(t => '/checklists/' + ROOM_SLUGS[t]));
  // A fingerprint of everything the pages are made from: it changes when a deploy changes them.
  const version = crypto.createHash('sha1').update(sitePaths.join('|')).update(fs.readFileSync(path.join(ROOT, 'views', 'layout.html')))
    .update(ctx.siteBodies.join('|')).update(GUIDES.map(g => g.body).join('|')).update(JSON.stringify(C.ROOM_TYPE_ITEMS)).digest('hex');
  const seoFile = path.join(REPORTS_DIR, 'seo.json');
  const readSeo = () => { try { return JSON.parse(fs.readFileSync(seoFile, 'utf8')); } catch (e) { return {}; } };
  const seo = readSeo();
  if (!/^[a-f0-9]{32}$/.test(seo.indexNowKey || '')) { seo.indexNowKey = crypto.randomBytes(16).toString('hex'); try { fs.writeFileSync(seoFile, JSON.stringify(seo)); } catch (e) {} }
  if (seo.version !== version) { seo.version = version; seo.modified = new Date().toISOString().slice(0, 10); try { fs.writeFileSync(seoFile, JSON.stringify(seo)); } catch (e) {} }
  const lastmod = seo.modified || new Date().toISOString().slice(0, 10);

  app.get('/sitemap.xml', (req, res) => {
    const base = canonicalBase(req);
    res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      sitePaths.map(p => `  <url><loc>${escHtml(base + p)}</loc><lastmod>${lastmod}</lastmod><changefreq>${p === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${p === '/' ? '1.0' : p.split('/').length > 2 ? '0.6' : '0.8'}</priority></url>`).join('\n') + '\n</urlset>\n');
  });
  // Search engines and AI assistants (ChatGPT, Claude, Perplexity, Gemini, Copilot…) are all welcome on the
  // public pages; private ones stay out. /llms.txt is a plain summary of the site for AI tools.
  const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'Googlebot', 'CCBot', 'Meta-ExternalAgent', 'Amazonbot', 'DuckAssistBot', 'MistralAI-User'];
  const PRIVATE = ['Disallow: /admin', 'Disallow: /api/', 'Disallow: /sign/', 'Disallow: /p/', 'Disallow: /app'];
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(['User-agent: *', 'Allow: /'].concat(PRIVATE, [''], AI_BOTS.map(b => 'User-agent: ' + b), ['Allow: /'], PRIVATE,
      ['', 'Sitemap: ' + canonicalBase(req) + '/sitemap.xml', '# A summary for AI assistants: ' + canonicalBase(req) + '/llms.txt', '']).join('\n'));
  });
  app.get(['/llms.txt', '/llms-full.txt'], (req, res) => {
    const base = canonicalBase(req), strip = t => String(t).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const faq = [...String(ctx.faqBody()).matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => '- **' + strip(m[1]) + '** ' + strip(m[2]));
    res.type('text/plain; charset=utf-8').send([
      '# DIY Inventory', '',
      '> Property inventories, check-in and check-out reports and inspections done on a phone, for landlords, letting agents and tenants anywhere in the world. Free to start; £30 + VAT per report, paid when the finished report is downloaded. The PDF report is ready instantly, the moment it is signed.', '',
      '## What it does',
      '- A photo checklist for every room; at least 8 photos per room, with the date and time burned into every photo.',
      ctx.aiOn() ? '- AI suggests each item’s condition, a short description, marks or damage and cleanliness from its photo; the person can change anything.' : '',
      '- The report is a professional PDF, ready instantly when signed: cover, room-by-room condition, meters, keys, signature and declaration, with every photo linked at full size.',
      '- Do it yourself as a landlord or agent, or send the tenant a link to do it. Either side can send the other a link to check, comment and sign.',
      '- Check-outs and mid-tenancy inspections start from the earlier report and compare the two: what changed, meter readings then and now, photos side by side.',
      '- Works in any phone browser, no app to install, in any country. Saved as you go, on the phone and backed up online.',
      '- UK landlords can also book a Gas Safety certificate (CP12), an electrical safety report (EICR) or an EPC at fixed prices: ' + base + '/certificates', '',
      '## Pages',
      '- [Home](' + base + '/)', '- [How it works](' + base + '/how-it-works)', '- [Pricing](' + base + '/pricing)', '- [FAQ](' + base + '/faq)', '- [Guides](' + base + '/guides)', '- [Room-by-room checklists](' + base + '/checklists)', '- [Gas Safety, EICR and EPC certificates for landlords](' + base + '/certificates)', '- [Start a report (free)](' + base + '/app)', '- [Contact](' + base + '/contact)', '',
      '## Guides'].concat(GUIDES.map(g => '- [' + g.title + '](' + base + '/guides/' + g.slug + '): ' + g.desc), ['', '## Questions and answers'], faq, ['', 'Reports are made to be used as evidence, including in deposit disputes (TDS, DPS, mydeposits): dated photos, both sides’ signatures, and check-out compared with check-in.', '']).filter(l => l !== '').join('\n').replace(/\n## /g, '\n\n## ').replace(/\n- \[Home/, '\n- [Home'));
  });
  app.get('/' + seo.indexNowKey + '.txt', (req, res) => res.type('text/plain').send(seo.indexNowKey));

  async function indexNow(){
    if (!PUBLIC_BASE || /localhost|127\.0\.0\.1/.test(PUBLIC_BASE)) return;
    const now = readSeo();
    if (now.submitted === version + '|' + PUBLIC_BASE) return;
    try {
      const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ host: new URL(PUBLIC_BASE).host, key: seo.indexNowKey, keyLocation: PUBLIC_BASE + '/' + seo.indexNowKey + '.txt', urlList: sitePaths.map(p => PUBLIC_BASE + p) }) });
      if (res.ok || res.status === 202) { now.submitted = version + '|' + PUBLIC_BASE; now.submittedAt = new Date().toISOString(); fs.writeFileSync(seoFile, JSON.stringify(Object.assign(readSeo(), now))); console.log('seo: ' + sitePaths.length + ' pages sent to IndexNow'); }
      else console.error('seo: IndexNow said HTTP ' + res.status);
    } catch (e) { console.error('seo: IndexNow failed:', e.message); }
  }
  setTimeout(indexNow, 90 * 1000).unref();
  setInterval(indexNow, 24 * 3600 * 1000).unref();   // tries again daily if it didn't go through

  return { paths: sitePaths };
}

module.exports = { mount, GUIDES };
