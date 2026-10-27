// Usage: node tools/areas/install.js <work folder> <slug>... Copies researched area files from the scratchpad into content/areas (cleaned), marks them tried, prints what's publishable.
const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..', '..'), S = process.argv[2], T = __dirname;
const list = require(R + '/content/area-list.json'), slugs = new Set(list.map(a => a.slug));
const solid = d => [d.rent && d.rent.text, d.price && d.price.text, d.privateRentedShare && d.privateRentedShare.text, d.councilTax && d.councilTax.text, d.licensing && (d.licensing.selective || d.licensing.additional)].filter(Boolean).length >= 2;
const tried = (() => { try { return JSON.parse(fs.readFileSync(T + '/tried.json', 'utf8')); } catch (e) { return {}; } })();
const only = process.argv.slice(3); let pub = [], held = [];
for (const slug of only) {
  const f = S + '/' + slug + '.json'; if (!slugs.has(slug) || !fs.existsSync(f)) { console.log('missing', slug); continue; }
  let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log('bad json', slug); continue; }
  d.slug = slug;
  for (const k of ['rent', 'price']) if (d[k] && d[k].text && /\b20(1\d|2[0-4])\b/.test(d[k].text) && !/202[5-6]/.test(d[k].text)) d[k] = { text: null, source: null };
  if (d.nearby) d.nearby = d.nearby.filter(s => slugs.has(s));
  if (/VAT|—/.test(JSON.stringify(d))) console.log('check text', slug);
  fs.writeFileSync(R + '/content/areas/' + slug + '.json', JSON.stringify(d, null, 2) + '\n');
  tried[slug] = (tried[slug] || 0) + 1; (solid(d) ? pub : held).push(slug);
}
fs.writeFileSync(T + '/tried.json', JSON.stringify(tried));
console.log('publishable ' + pub.length + ': ' + pub.join(' ')); console.log('still thin ' + held.length + ': ' + held.join(' '));
