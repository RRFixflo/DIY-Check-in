// Installs researched city facts into content/cities/<slug>.json.
// Usage: node tools/cities/install.js <file.json> [more.json…]  (each a JSON array, see BRIEF.md)
// Keeps only known fields, only cities the site has a page for, and only http(s) links.
const fs = require('fs'), path = require('path');
const { PLACES } = require('../../locations');
const out = path.join(__dirname, '..', '..', 'content', 'cities');
fs.mkdirSync(out, { recursive: true });
const known = new Set(PLACES.map(p => p.slug));
const url = u => /^https?:\/\/[^\s"<>]+$/.test(String(u || '')) ? String(u) : null;
const str = (v, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
let n = 0, skipped = [];
for (const f of process.argv.slice(2)) {
  let arr; try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(f + ': ' + e.message); continue; }
  for (const c of arr) {
    if (!c || !known.has(c.slug)) { skipped.push(c && c.slug); continue; }
    const rec = {
      name: str(c.name, 80),
      neighborhoods: (Array.isArray(c.neighborhoods) ? c.neighborhoods : []).map(h => h && str(h.name, 60) ? { name: str(h.name, 60), homes: str(h.homes, 160) } : null).filter(Boolean).slice(0, 8),
      housing: str(c.housing, 500),
      localRules: (Array.isArray(c.localRules) ? c.localRules : []).map(r => r && str(r.text, 400) ? { text: str(r.text, 400), source: url(r.source) } : null).filter(Boolean).slice(0, 5),
      tenantHelp: (Array.isArray(c.tenantHelp) ? c.tenantHelp : []).map(h => h && str(h.name, 120) && url(h.url) ? { name: str(h.name, 120), url: url(h.url), what: str(h.what, 120) } : null).filter(Boolean).slice(0, 3),
      climate: str(c.climate, 400),
      universities: (Array.isArray(c.universities) ? c.universities : []).map(u => str(u, 80)).filter(Boolean).slice(0, 4),
      fact: str(c.fact, 400),
      checked: 'November 2026',
    };
    fs.writeFileSync(path.join(out, c.slug + '.json'), JSON.stringify(rec, null, 1) + '\n'); n++;
  }
}
console.log('installed ' + n + ' cities' + (skipped.length ? '; skipped (unknown slug): ' + skipped.join(', ') : ''));
