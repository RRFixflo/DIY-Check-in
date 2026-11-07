// Prices in dollars for US customers. Cards are still charged in pounds (SumUp only takes the account's own
// currency, GBP); the dollar figure is what £30 is worth today, so Americans see a price they understand.
// The rate (GBP → USD) comes from the European Central Bank's daily reference rates via frankfurter.app,
// refreshed every 12 hours and kept in REPORTS_DIR/fx.json, so a restart or an outage keeps the last rate.
const fs = require('fs');
const path = require('path');

const FALLBACK = 1.30;
let file = '', rate = FALLBACK, at = '';

function load(dir){
  file = path.join(dir, 'fx.json');
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d.rate > 0.5 && d.rate < 3) { rate = d.rate; at = d.at || ''; } } catch (e) {}
}
async function refresh(){
  try {
    const r = await fetch(process.env.FX_API_BASE || 'https://api.frankfurter.app/latest?from=GBP&to=USD', { signal: AbortSignal.timeout(10000) });
    const d = await r.json(), v = d && d.rates && Number(d.rates.USD);
    if (!(v > 0.5 && v < 3)) throw new Error('unexpected answer ' + JSON.stringify(d).slice(0, 120));
    rate = v; at = new Date().toISOString();
    if (file) fs.writeFileSync(file, JSON.stringify({ rate, at, date: d.date }));
  } catch (e) { console.error('fx: GBP to USD rate not updated (' + e.message + '), using ' + rate); }
}
function start(dir){
  load(dir);
  refresh();
  setInterval(refresh, 12 * 3600 * 1000).unref();
}
// £30 → "$39" (whole dollars, rounded to the nearest).
const usd = gbp => '$' + Math.round(gbp * rate);

// A person in the US (Cloudflare's country header, or ?cur=usd from a US report in the app); never robots,
// so search engines index the pages in pounds as they are.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|inspectiontool|lighthouse|headless|curl|wget|python|axios|node-fetch/i;
function usVisitor(req){
  if (BOT.test(String(req.headers['user-agent'] || ''))) return false;
  return String(req.query && req.query.cur || '').toLowerCase() === 'usd' || String(req.headers['cf-ipcountry'] || '').toUpperCase() === 'US';
}

module.exports = { start, usd, usVisitor, rate: () => rate, updated: () => at };
