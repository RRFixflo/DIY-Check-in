#!/usr/bin/env node
// Layout check ("the layout bot"): opens the site's main pages and the admin at phone, tablet, laptop and desktop
// widths and reports anything a person would see as broken: the page scrolling sideways, buttons or links cut off
// by their box, table columns squeezed to a word wide, text overlapping. Run against a local server with test data:
//   ADMIN_PASSWORD=x node tools/layout-check.js http://localhost:8080 [--admin x] [--out report.json]
// Exits 1 when it finds problems. Screenshots of each problem go to tools/layout-shots/ (not committed).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const base = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : ''; };
const adminPw = arg('--admin') || process.env.ADMIN_PASSWORD || '';
const WIDTHS = [360, 390, 768, 1024, 1280, 1440];
const PUBLIC = ['/', '/how-it-works', '/pricing', '/faq', '/contact', '/privacy', '/buy', '/my-report', '/agents', '/inventory-companies',
  '/landlords', '/certificates', '/property-report', '/guides', '/checklists', '/inventory-template', '/inventory-clerk', '/floor-plan', '/us', '/app'];
const ADMIN = ['/admin', '/admin#reports', '/admin#sales', '/admin#enquiries', '/admin#progress', '/admin#landlords', '/admin#access', '/admin/analytics'];
const shots = path.join(__dirname, 'layout-shots'); fs.mkdirSync(shots, { recursive: true });

// Runs in the page: returns the problems a person would notice.
function inspect(){
  const out = [], W = document.documentElement.clientWidth, vis = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
  const name = el => { const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40); return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (t ? ' "' + t + '"' : ''); };
  if (document.documentElement.scrollWidth > W + 2) out.push({ kind: 'page scrolls sideways', detail: document.documentElement.scrollWidth + 'px wide in a ' + W + 'px window' });
  // Controls cut off by a box that hides overflow (or by the window).
  document.querySelectorAll('a.btn, button, .btn, input:not([type=hidden]), select, textarea, summary').forEach(el => {
    if (!vis(el) || el.closest('[hidden], [aria-hidden="true"], .hp') || (el.closest('details:not([open])') && !el.closest('summary')) || el.tabIndex < 0) return;   // robot traps (honeypots) are hidden on purpose
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p); if (!/(hidden|clip)/.test(s.overflowX + s.overflow)) continue;
      if (/(auto|scroll)/.test(s.overflowX)) break;   // a scrolling box is fine
      const q = p.getBoundingClientRect();
      if (r.right > q.right + 2 || r.left < q.left - 2) { out.push({ kind: 'cut off', detail: name(el) + ' inside ' + name(p) }); }
      break;
    }
    if (r.right > W + 2 && !el.closest('[style*="-9999"]')) out.push({ kind: 'off screen', detail: name(el) });
  });
  // Table cells squeezed so text breaks a word per line.
  document.querySelectorAll('td, th').forEach(td => {
    if (!vis(td)) return; const r = td.getBoundingClientRect(), t = (td.innerText || '').trim();
    if (t.length > 12 && r.width < 70 && r.height > 120) out.push({ kind: 'squeezed column', detail: Math.round(r.width) + 'px wide, ' + Math.round(r.height) + 'px tall: "' + t.slice(0, 30) + '"' });
  });
  // Buttons overlapping each other.
  const shut = el => { const d = el.closest('details:not([open])'); return !!d && !el.closest('summary'); };   // inside a closed drop-down: not on screen
  const pinned = el => { for (let p = el; p; p = p.parentElement) if (/fixed|sticky/.test(getComputedStyle(p).position)) return true; return false; };   // a bar pinned to the screen passes over content as you scroll: that's fine
  const bs = [...document.querySelectorAll('a.btn, button.btn')].filter(b => vis(b) && !pinned(b) && !shut(b)).slice(0, 300).map(b => [b, b.getBoundingClientRect()]);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i][1], b = bs[j][1];
    if (bs[i][0].contains(bs[j][0]) || bs[j][0].contains(bs[i][0])) continue;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 6 && oy > 6) { const cx = Math.max(a.left, b.left) + ox / 2, cy = Math.max(a.top, b.top) + oy / 2; if (cy < 0 || cy > innerHeight) { window.scrollTo(0, cy + scrollY - innerHeight / 2); } }
    if (ox > 6 && oy > 6 && (() => { const A = bs[i][0].getBoundingClientRect(), B = bs[j][0].getBoundingClientRect(), x = Math.max(A.left, B.left) + ox / 2, y = Math.max(A.top, B.top) + oy / 2, hit = document.elementFromPoint(x, y); return hit && (bs[i][0].contains(hit) || bs[j][0].contains(hit)); })()) out.push({ kind: 'overlapping buttons', detail: name(bs[i][0]) + ' and ' + name(bs[j][0]) }); }
  const seen = new Set(); return out.filter(x => { const k = x.kind + x.detail; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25);
}

(async () => {
  const browser = await chromium.launch(), found = [];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', extraHTTPHeaders: { 'X-Layout-Check': '1' } });
    const page = await ctx.newPage();
    if (adminPw) await page.request.post(base + '/admin/login', { form: { password: adminPw }, headers: { Origin: base } }).catch(() => {});
    for (const p of PUBLIC.concat(adminPw ? ADMIN : [])) {
      try {
        await page.goto(base + p, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(400);
        const probs = await page.evaluate(inspect);
        if (probs.length) {
          const file = path.join(shots, (p.replace(/[^a-z0-9]+/gi, '_') || 'home') + '-' + w + '.png');
          await page.screenshot({ path: file, fullPage: true }).catch(() => {});
          found.push({ page: p, width: w, problems: probs, screenshot: path.relative(process.cwd(), file) });
        }
      } catch (e) { found.push({ page: p, width: w, problems: [{ kind: 'did not load', detail: e.message.split('\n')[0] }] }); }
    }
    await ctx.close();
  }
  await browser.close();
  const out = arg('--out'); if (out) fs.writeFileSync(out, JSON.stringify(found, null, 2));
  if (!found.length) { console.log('Layout check: no problems on ' + (PUBLIC.length + (adminPw ? ADMIN.length : 0)) + ' pages at ' + WIDTHS.join(', ') + 'px.'); return; }
  found.forEach(f => { console.log('\n' + f.page + ' at ' + f.width + 'px' + (f.screenshot ? ' (' + f.screenshot + ')' : '')); f.problems.forEach(x => console.log('  - ' + x.kind + ': ' + x.detail)); });
  console.log('\nLayout check: ' + found.length + ' page/width combinations with problems.'); process.exitCode = 1;
})();
