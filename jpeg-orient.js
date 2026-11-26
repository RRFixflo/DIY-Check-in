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

module.exports = { getOrientation, setOrientation, turn, upright, TURN };
