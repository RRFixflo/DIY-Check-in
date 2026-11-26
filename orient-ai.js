'use strict';
// Which way up is a photo? (the owner: "you should put the right way round automatically"). Photos taken with the
// phone held sideways while its screen was locked to portrait come out sideways. A small copy of each photo is shown
// to Claude, a few at a time, which says how far it must be turned clockwise to be upright (0, 90, 180, 270) and
// whether it is sure. Only a sure answer is used. Needs ANTHROPIC_API_KEY; without it nothing is checked.
const jpeg = require('jpeg-js');

const MODEL = (process.env.ANTHROPIC_MODEL || '').trim() || 'claude-opus-5-5';
let client = null;
function ai(){
  if (client !== null) return client || null;
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) { client = false; return null; }
  const Anthropic = require('@anthropic-ai/sdk'); client = new Anthropic({ apiKey: key });
  return client;
}

// A copy at most `max` pixels on its longest side (box average), as JPEG; the pixels as stored, ignoring any EXIF turn.
function small(buf, max = 448){
  const src = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 }), W = src.width, H = src.height, d = src.data;
  const k = Math.max(1, Math.ceil(Math.max(W, H) / max)), w = Math.floor(W / k), h = Math.floor(H / k), out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const a = ((y * k + j) * W + x * k + i) * 4; r += d[a]; g += d[a + 1]; b += d[a + 2]; }
    const o = (y * w + x) * 4, n = k * k; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return jpeg.encode({ data: out, width: w, height: h }, 80).data;
}

const SYSTEM = 'You check whether photos taken during a property inventory (rooms, fittings, appliances, meters, keys, the outside of a house) are the right way up. ' +
  'For each photo, say how many degrees it must be turned clockwise to be upright: 0 if it is already upright, 90, 180 or 270. ' +
  'Judge from walls and door frames that should be vertical, floors at the bottom, ceilings and lights at the top, furniture standing on the floor, and any text. ' +
  'Photos taken looking straight down at a floor, a worktop or keys on a table have no clear up: answer 0. ' +
  'Set "sure" to true only when it is plain. Reply with JSON only: {"photos":[{"i":1,"turn":0,"sure":true}, ...]} with one entry per photo, in order.';

// bufs: JPEG buffers (up to 8). Returns [turn|null] in the same order (null = not sure or unreadable); throws on an API error.
async function turnsFor(bufs){
  const c = ai(); if (!c) return bufs.map(() => null);
  const content = [], idx = [];
  for (let n = 0; n < bufs.length; n++) {
    await new Promise(r => setImmediate(r));   // decoding is slow-ish: let the server answer requests in between
    let s; try { s = small(bufs[n]); } catch (e) { continue; }
    idx.push(n); content.push({ type: 'text', text: 'Photo ' + idx.length + ':' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: s.toString('base64') } });
  }
  const res = bufs.map(() => null);
  if (!idx.length) return res;
  content.push({ type: 'text', text: 'How far must each of these ' + idx.length + ' photos be turned clockwise to be upright?' });
  const r = await c.messages.create({ model: MODEL, max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content }],
    ...(/^claude-(opus|sonnet|fable|haiku)-5/.test(MODEL) ? { output_config: { effort: 'low' } } : {}) });
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
  for (const p of (out && Array.isArray(out.photos) ? out.photos : [])) {
    const n = idx[(parseInt(p && p.i, 10) || 0) - 1], t = parseInt(p && p.turn, 10);
    if (n != null && p.sure === true && [0, 90, 180, 270].includes(t)) res[n] = t;
  }
  return res;
}

module.exports = { turnsFor, small, enabled: () => !!ai(), _setClient: c => { client = c; } };
