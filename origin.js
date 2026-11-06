'use strict';
// Where a lead came from. The website (site.js) and the app keep this tab's visit in sessionStorage['diy-visit']
// (no cookie): the first page, the site that sent the visitor, when they arrived, how many pages they've seen and the
// last few. Every form posted on the site gets it as a hidden `src_visit` field (JSON), and the app sends it with a
// finished report. Here it becomes `origin` on the lead: a plain-English source (Google Ads, Google search,
// ChatGPT, Facebook, an email, a microsite, typed in directly…), the campaign tags, the ad click id, the landing
// page, the page they acted on, pages seen, time from arrival, and the device.
//   of(req, body, extra)   → origin object (from the form's hidden fields, or extra.visit from the app)
//   html(o, esc)            → one line for /admin
//   label(o)                → the source in a few words, for counts

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const host = u => { try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
const params = land => { try { return new URL(land, 'https://x').searchParams; } catch (e) { return new URLSearchParams(); } };

const SEARCH = [[/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/duckduckgo\.com$/, 'DuckDuckGo'], [/(^|\.)yahoo\./, 'Yahoo'], [/ecosia\.org$/, 'Ecosia'], [/(^|\.)ask\.com$/, 'Ask'], [/(^|\.)aol\./, 'AOL'], [/yandex\./, 'Yandex'], [/baidu\.com$/, 'Baidu'], [/search\.brave\.com$/, 'Brave Search'], [/startpage\.com$/, 'Startpage']];
const AI = [[/chatgpt\.com$|chat\.openai\.com$|^openai\.com$/, 'ChatGPT'], [/perplexity\.ai$/, 'Perplexity'], [/claude\.ai$/, 'Claude'], [/gemini\.google\.com$|bard\.google\.com$/, 'Gemini'], [/copilot\.microsoft\.com$/, 'Copilot'], [/you\.com$/, 'You.com'], [/phind\.com$/, 'Phind'], [/meta\.ai$/, 'Meta AI'], [/deepseek\.com$/, 'DeepSeek'], [/grok\.com$/, 'Grok']];
const SOCIAL = [[/(^|\.)facebook\.com$|^fb\.com$|^fb\.me$/, 'Facebook'], [/instagram\.com$/, 'Instagram'], [/^t\.co$|(^|\.)twitter\.com$|^x\.com$/, 'X (Twitter)'], [/linkedin\.com$|^lnkd\.in$/, 'LinkedIn'], [/reddit\.com$/, 'Reddit'], [/tiktok\.com$/, 'TikTok'], [/youtube\.com$|^youtu\.be$/, 'YouTube'], [/whatsapp\.com$|^wa\.me$/, 'WhatsApp'], [/nextdoor\.co/, 'Nextdoor'], [/pinterest\./, 'Pinterest'], [/threads\.net$/, 'Threads'], [/messenger\.com$/, 'Messenger']];
const MAIL = /^mail\.google\.com$|outlook\.(live|office|office365)\.com$|^mail\.yahoo\.|^webmail\.|^mail\.aol\.com$|^mail\.proton\.me$|^icloud\.com$/;
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsearch|paid[_ -]?search|paid[_ -]?social|paidsocial|display|cpm|ads?|banner|sponsored)$/;
const find = (list, h) => (list.find(([re]) => re.test(h)) || [])[1] || '';

// Plain-English source: { channel, source, label }.
function classify(o){
  const u = o.utm || {}, us = String(u.source || '').toLowerCase(), um = String(u.medium || '').toLowerCase(), rh = host(o.referrer || '');
  const named = us && (find(SEARCH, us) || find(AI, us) || find(SOCIAL, us) || find(SEARCH, us + '.com') || find(AI, us + '.com') || find(SOCIAL, us + '.com'));
  if (o.microsite) return { channel: 'Microsite', source: o.microsite, label: 'Microsite ' + o.microsite };
  if (o.click === 'gclid' || o.click === 'gbraid' || o.click === 'wbraid') return { channel: 'Paid search', source: 'Google', label: 'Google Ads' };
  if (o.click === 'msclkid') return { channel: 'Paid search', source: 'Bing', label: 'Microsoft (Bing) Ads' };
  if (o.click === 'ttclid') return { channel: 'Paid social', source: 'TikTok', label: 'TikTok Ads' };
  if (o.click === 'li_fat_id') return { channel: 'Paid social', source: 'LinkedIn', label: 'LinkedIn Ads' };
  if (PAID_MEDIUM.test(um)) {
    const s = named || us || find(SEARCH, rh) || find(SOCIAL, rh) || rh || 'unknown';
    const social = find(SOCIAL, us) || find(SOCIAL, us + '.com') || find(SOCIAL, rh) || /social/.test(um);
    return { channel: social ? 'Paid social' : 'Paid search', source: s, label: s + ' ads' };
  }
  if (um === 'email' || um === 'newsletter' || MAIL.test(rh)) return { channel: 'Email', source: us || rh || 'email', label: 'Email' + (u.campaign ? ' (' + u.campaign + ')' : us ? ' (' + us + ')' : '') };
  const ai = find(AI, rh) || find(AI, us) || find(AI, us + '.com');
  if (ai) return { channel: 'AI assistant', source: ai, label: ai };
  const social = find(SOCIAL, rh) || (o.click === 'fbclid' ? 'Facebook' : '') || find(SOCIAL, us) || find(SOCIAL, us + '.com');
  if (social) return { channel: 'Social', source: social, label: social };
  const search = find(SEARCH, rh) || find(SEARCH, us) || find(SEARCH, us + '.com');
  if (search) return { channel: 'Search', source: search, label: search + ' search' };
  if (rh) return { channel: 'Referral', source: rh, label: rh };
  if (us) return { channel: 'Campaign', source: us, label: us + (um ? ' / ' + um : '') };
  if (o.landing) return { channel: 'Direct', source: 'direct', label: 'Direct' };
  return { channel: 'Unknown', source: '', label: 'Not recorded' };
}

const DEVICE = ua => {
  ua = String(ua || '');
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /EdgA?\/|EdgiOS/.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return br ? dev + ' · ' + br : dev;
};

// From a posted form (src_visit JSON, or the older src_land / src_ref / src_prev fields) or from extra.visit (the app).
function of(req, body, extra){
  body = body || {}; extra = extra || {};
  let v = extra.visit || null;
  if (!v && body.src_visit) { try { v = JSON.parse(String(body.src_visit).slice(0, 4000)); } catch (e) { v = null; } }
  v = v && typeof v === 'object' ? v : {};
  const land = clip(v.land || body.src_land, 400), ref = clip(v.ref || body.src_ref, 400);
  const q = params(land), u = {};
  ['source', 'medium', 'campaign', 'term', 'content'].forEach(k => { const x = clip(q.get('utm_' + k), 80); if (x) u[k] = x; });
  const click = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'li_fat_id'].find(k => q.get(k)) || '';
  const trail = Array.isArray(v.trail) ? v.trail.slice(-8).map(p => clip(p, 200)).filter(Boolean) : [];
  const here = clip(v.here || body.src_here, 300) || (req && req.headers && req.headers.referer ? (() => { try { const x = new URL(req.headers.referer); return x.pathname + x.search; } catch (e) { return ''; } })() : '');
  const at = Number(v.at) || 0, secs = at && at < Date.now() ? Math.round((Date.now() - at) / 1000) : 0;
  const o = { referrer: ref, landing: land, here, trail, pages: Math.max(0, Math.min(9999, parseInt(v.pages, 10) || trail.length || 0)), secs: secs < 30 * 86400 ? secs : 0,
    utm: Object.keys(u).length ? u : undefined, click, microsite: clip(extra.microsite, 120), device: DEVICE(req && req.headers && req.headers['user-agent']) };
  const c = classify(o);
  Object.assign(o, { channel: c.channel, source: c.source, label: c.label, at: new Date().toISOString() });
  Object.keys(o).forEach(k => { if (o[k] === '' || o[k] === 0 || o[k] === undefined || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; });
  return o;
}
const label = o => (o && o.label) || 'Not recorded';

const dur = s => s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days';
const path = u => { try { const x = new URL(u, 'https://x'); return x.pathname + x.search; } catch (e) { return String(u || ''); } };
// One line for /admin: the source in bold, then the details.
function html(o, esc){
  if (!o) return '<div class="sub">📍 Source not recorded (before sources were tracked)</div>';
  const bits = ['<b>' + esc(label(o)) + '</b>'];
  if (o.utm && o.utm.campaign) bits.push('campaign “' + esc(o.utm.campaign) + '”' + (o.utm.term ? ', keyword “' + esc(o.utm.term) + '”' : ''));
  else if (o.utm && o.utm.term) bits.push('keyword “' + esc(o.utm.term) + '”');
  if (o.referrer && o.channel !== 'Direct') bits.push('from <a href="' + esc(o.referrer) + '" target="_blank" rel="noopener noreferrer">' + esc(o.referrer.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)) + '</a>');
  if (o.landing) bits.push('landed on ' + esc(path(o.landing)));
  if (o.here && path(o.here) !== path(o.landing || '')) bits.push('acted on ' + esc(path(o.here)));
  if (o.pages) bits.push(o.pages + ' page' + (o.pages === 1 ? '' : 's'));
  if (o.secs) bits.push(dur(o.secs) + ' after arriving');
  if (o.device) bits.push(esc(o.device));
  const trail = (o.trail || []).length > 1 ? ' title="Pages: ' + esc(o.trail.map(path).join(' → ')) + '"' : '';
  return '<div class="sub origin"' + trail + '>📍 ' + bits.join(' · ') + '</div>';
}

module.exports = { of, html, label, classify };
