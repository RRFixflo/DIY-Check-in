// Turning a stored photo without re-compressing it: the JPEG gets an EXIF Orientation tag (1 upright, 6 a quarter
// turn clockwise, 3 half a turn, 8 a quarter turn anticlockwise), which browsers follow when they show it.
// Code that draws the pixels itself (pdf-lib in backup-pdf.js) reads it with getOrientation() and turns the
// picture as it draws. Photos from the app are canvas JPEGs with no EXIF of their own, so any EXIF block is
// replaced by a minimal one holding just the orientation.

const TURN = { 1: 0, 6: 90, 3: 180, 8: 270 };   // orientation → degrees clockwise to show it upright
const BY_TURN = { 0: 1, 90: 6, 180: 3, 270: 8 };

function segments(buf){
  // [{ marker, start, end }] for the segments before the image data, or null if this isn't a JPEG we can read.
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  const out = []; let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xFF) {
    const marker = buf[i + 1];
    if (marker === 0xDA || marker === 0xD9) break;           // start of scan / end of image
    const len = buf.readUInt16BE(i + 2);
    out.push({ marker, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return out;
}
function isExif(buf, s){ return s.marker === 0xE1 && buf.slice(s.start + 4, s.start + 10).toString('binary') === 'Exif\0\0'; }

function getOrientation(buf){
  const segs = segments(buf); if (!segs) return 1;
  const s = segs.find(x => isExif(buf, x)); if (!s) return 1;
  try {
    const t = s.start + 10, le = buf.slice(t, t + 2).toString('binary') === 'II';
    const u16 = o => le ? buf.readUInt16LE(o) : buf.readUInt16BE(o), u32 = o => le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    const ifd = t + u32(t + 4), n = u16(ifd);
    for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) { const v = u16(e + 8); return TURN[v] != null ? v : 1; } }
  } catch (e) {}
  return 1;
}

function setOrientation(buf, o){
  const segs = segments(buf); if (!segs) return buf;
  // A little-endian TIFF block with one IFD entry: Orientation (0x0112), SHORT, count 1.
  const tiff = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, o & 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xFF, 0xE1, (body.length + 2) >> 8, (body.length + 2) & 0xFF]), body]);
  const parts = [buf.slice(0, 2)]; let at = 2, placed = false;
  for (const s of segs) {
    if (isExif(buf, s)) { parts.push(buf.slice(at, s.start)); at = s.end; continue; }   // drop any old EXIF block
    if (!placed && s.marker !== 0xE0) { parts.push(buf.slice(at, s.start), app1); at = s.start; placed = true; }   // after JFIF (APP0)
  }
  if (!placed) { const last = segs.length ? segs[segs.length - 1].end : 2; parts.push(buf.slice(at, Math.max(at, last)), app1); at = Math.max(at, last); }
  parts.push(buf.slice(at));
  return Buffer.concat(parts);
}

// A quarter turn clockwise (or anticlockwise with dir = -1) from how the photo shows now.
function turn(buf, dir){
  const now = TURN[getOrientation(buf)] || 0, next = ((now + (dir < 0 ? 270 : 90)) % 360);
  return setOrientation(buf, BY_TURN[next]);
}

// The picture's pixels turned upright (for code that ignores EXIF, like jsPDF in render-backup.js): decoded,
// turned and saved again at quality 90. A photo already upright, or one that can't be read, comes back as it was.
function upright(buf){
  const t = TURN[getOrientation(buf)] || 0; if (!t) return buf;
  try {
    const jpeg = require('jpeg-js');
    const src = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 }), W = src.width, H = src.height, d = src.data;
    const side = t !== 180, w = side ? H : W, h = side ? W : H, out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let nx, ny;
      if (t === 90) { nx = H - 1 - y; ny = x; } else if (t === 180) { nx = W - 1 - x; ny = H - 1 - y; } else { nx = y; ny = W - 1 - x; }
      const a = (y * W + x) * 4, b = (ny * w + nx) * 4;
      out[b] = d[a]; out[b + 1] = d[a + 1]; out[b + 2] = d[a + 2]; out[b + 3] = 255;
    }
    return jpeg.encode({ data: out, width: w, height: h }, 90).data;
  } catch (e) { return buf; }
}

// The app burns the date and time into every photo as a dark box in the bottom-right corner (stampPhoto() in
// public/index.html). Turning a photo would leave that stamp running up one side, so turnWithStamp() turns the pixels
// and moves the stamp: the box is found, cut out, the strip it sat in is trimmed off, the picture is turned, and the
// same box (same text, still the right way up) goes back in the new bottom-right corner, as the app places it.
// No EXIF in the result. A photo with no stamp found is just turned.
const dark = (d, i) => d[i] < 70 && d[i + 1] < 70 && d[i + 2] < 70;
function findStamp(d, W, H){
  const font = Math.max(11, Math.round(H * 0.030)), boxH = font + 2 * Math.round(font * 0.34);
  const right = W - 1 - Math.round(W * 0.012), bottom = H - 1 - Math.round(H * 0.015);
  // A row just inside the top of the box (padding, no text), found by trying rows near where the app puts it.
  for (let dy = -Math.round(boxH * 0.4); dy <= Math.round(boxH * 0.4); dy++) {
    const yTop = bottom - boxH + 1 + dy, y = yTop + 3;
    if (y < 0 || y >= H) continue;
    let x = right - 2; if (!dark(d, (y * W + x) * 4)) continue;
    let miss = 0, left = x;
    for (; x >= 0; x--) { if (dark(d, (y * W + x) * 4)) { left = x; miss = 0; } else if (++miss > 4) break; }
    const bw = right - left + 1;
    if (bw < font * 4 || bw > W * 0.9) continue;
    // Its top and bottom, down the left padding (no text there).
    const cx = left + 2; let top = y, bot = y;
    while (top > 0 && dark(d, ((top - 1) * W + cx) * 4)) top--;
    while (bot < H - 1 && dark(d, ((bot + 1) * W + cx) * 4)) bot++;
    const bh = bot - top + 1;
    if (bh < boxH * 0.6 || bh > boxH * 1.6) continue;
    // Most of the box must be dark (the text is a small part of it).
    let n = 0, k = 0; for (let yy = top; yy <= bot; yy += 2) for (let xx = left; xx <= right; xx += 3) { n++; if (dark(d, (yy * W + xx) * 4)) k++; }
    if (k / n < 0.6) continue;
    return { x: left, y: top, w: right - left + 1, h: bh };
  }
  return null;
}
function turnWithStamp(buf, deg){
  deg = ((deg % 360) + 360) % 360;
  try {
    const jpeg = require('jpeg-js');
    const src = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 }); let W = src.width, H = src.height; const d = src.data;
    const box = findStamp(d, W, H);
    let patch = null;
    if (box) {
      patch = Buffer.alloc(box.w * box.h * 4);
      for (let y = 0; y < box.h; y++) patch.set(d.subarray(((box.y + y) * W + box.x) * 4, ((box.y + y) * W + box.x + box.w) * 4), y * box.w * 4);
      H = Math.max(1, box.y - 1);   // trim the strip the stamp sat in
    }
    const side = deg === 90 || deg === 270, w = side ? H : W, h = side ? W : H, out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let nx = x, ny = y;
      if (deg === 90) { nx = H - 1 - y; ny = x; } else if (deg === 180) { nx = W - 1 - x; ny = H - 1 - y; } else if (deg === 270) { nx = y; ny = W - 1 - x; }
      const a = (y * W + x) * 4, b = (ny * w + nx) * 4;
      out[b] = d[a]; out[b + 1] = d[a + 1]; out[b + 2] = d[a + 2]; out[b + 3] = 255;
    }
    if (patch && box.w < w && box.h < h) {
      const px = w - box.w - Math.round(w * 0.012), py = h - box.h - Math.round(h * 0.015);
      for (let y = 0; y < box.h; y++) patch.copy(out, ((py + y) * w + px) * 4, y * box.w * 4, (y + 1) * box.w * 4);
    }
    return jpeg.encode({ data: out, width: w, height: h }, 90).data;
  } catch (e) { return null; }
}
// The photo upright with its stamp at the bottom: an EXIF turn (from an earlier version) is applied to the pixels,
// plus `extra` degrees clockwise. Returns null when nothing needs doing or it can't be read.
function makeUpright(buf, extra){
  const total = ((TURN[getOrientation(buf)] || 0) + (extra || 0)) % 360;
  if (!total) return getOrientation(buf) === 1 ? null : setOrientation(buf, 1);
  return turnWithStamp(buf, total);
}

module.exports = { getOrientation, setOrientation, turn, upright, turnWithStamp, makeUpright, findStamp, TURN, BY_TURN };
