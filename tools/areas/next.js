// Usage: node tools/areas/next.js [N] [work folder]. Prints the next N England areas that still need research (not yet publishable), as "slug|name (type, county)".
const fs = require('fs'), path = require('path');
const path2 = require('path'), R = path2.join(__dirname, '..', '..'), N = +(process.argv[2] || 30), W = process.argv[3] || '';
const list = require(R + '/content/area-list.json').filter(a => a.type !== 'london borough');
const solid = d => [d.rent && d.rent.text, d.price && d.price.text, d.privateRentedShare && d.privateRentedShare.text, d.councilTax && d.councilTax.text, d.licensing && (d.licensing.selective || d.licensing.additional)].filter(Boolean).length >= 2;
const tried = (() => { try { return JSON.parse(fs.readFileSync(__dirname + '/tried.json', 'utf8')); } catch (e) { return {}; } })();
const todo = list.filter(a => { const f = R + '/content/areas/' + a.slug + '.json'; if (!fs.existsSync(f)) return true; return !solid(JSON.parse(fs.readFileSync(f, 'utf8'))) && (tried[a.slug] || 0) < 2; });
// With a work folder, copy each existing file there so the researcher can fill its nulls in place.
if (W) { fs.mkdirSync(W, { recursive: true }); todo.slice(0, N).forEach(a => { const f = R + '/content/areas/' + a.slug + '.json'; if (fs.existsSync(f)) fs.copyFileSync(f, W + '/' + a.slug + '.json'); }); }
console.log('remaining ' + todo.length);
console.log(todo.slice(0, N).map(a => a.slug + '|' + a.name + ' (' + a.type + ', ' + (a.county || a.region) + ')' + (fs.existsSync(R + '/content/areas/' + a.slug + '.json') ? ' [file exists: fill the nulls]' : '')).join('; '));
