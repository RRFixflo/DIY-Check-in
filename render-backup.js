'use strict';
// Makes a report PDF on the server with the app's own buildPdfBlob() (public/index.html), so a report made from its
// online backup looks exactly like one made on the phone: same cover, contents, At a glance, rooms, cards, linked
// photos and index. The app runs in jsdom; jsPDF and floorplan.js are inlined. No canvas on the server, so photos go
// in at full size (the phone shrinks them first) and the signature is drawn from its own PNG.
//
// Run as a child process (it can use a lot of memory for a big report):
//   node render-backup.js <job.json>
// job.json: { state, photosDir, out, base }  →  writes <out> (the PDF) and <out>.photos.json ([{ n, id, title, ts }])
const fs = require('fs');
const path = require('path');

async function render(job){
  const { JSDOM, VirtualConsole } = require('jsdom');
  const root = __dirname;
  let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const jspdf = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
  let fp = ''; try { fp = fs.readFileSync(path.join(root, 'public', 'floorplan.js'), 'utf8'); } catch (e) {}
  const inline = js => '<script>' + js.replace(/<\/script/gi, '<\\/script') + '</script>';
  html = html.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]+"><\/script>/, () => inline(jspdf))
    .replace(/<script src="\/floorplan\.js"><\/script>/, () => fp ? inline(fp) : '')
    .replace(/<script src="[^"]*"[^>]*><\/script>/g, '')        // nothing else from outside
    .replace(/<link[^>]+stylesheet[^>]*>/g, '');
  const vc = new VirtualConsole();   // the app's start-up chatter (no camera, storage or server here) is ignored
  const dom = new JSDOM(html, { url: (job.base || 'http://localhost') + '/app', runScripts: 'dangerously', pretendToBeVisual: false, virtualConsole: vc,
    beforeParse(w){
      w.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '', blob: async () => new w.Blob([]) });
      try { Object.defineProperty(w.navigator, 'sendBeacon', { value: () => true }); } catch (e) {}
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
      w.scrollTo = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => null;
    } });
  const w = dom.window;
  // Wait for the inline scripts to have run.
  await new Promise(r => setTimeout(r, 50));
  if (typeof w.buildPdfBlob !== 'function') throw new Error('the app’s report builder did not load');
  // No canvas: photos stay as they are, and the signature keeps its own format.
  w.shrinkPhoto = d => Promise.resolve(d);
  w.prepPhoto = d => Promise.resolve(d);
  const API = w.jspdf && w.jspdf.jsPDF && w.jspdf.jsPDF.API;
  if (API && API.addImage) { const orig = API.addImage; API.addImage = function (data, format, ...rest) { if (typeof data === 'string' && /^data:image\/png/.test(data) && format === 'JPEG') format = 'PNG'; return orig.call(this, data, format, ...rest); }; }

  // The backup's photos (stripped of their pictures for the backup) get their pictures back from the photo files.
  // Anything an older or partial backup lacks comes from the app's own blank report.
  const blank = w.defaultState(), src = job.state || {};
  const s = Object.assign({}, blank, src, { meta: Object.assign({}, blank.meta, src.meta), property: Object.assign({}, blank.property, src.property) });
  s.rooms = (src.rooms || []).map(r => { const f = w.makeRoom(r.name || 'Room', r.type || ''); return Object.assign({}, f, r, { items: (r.items || []).map(it => Object.assign({ photos: [], defects: [] }, it)), extraPhotos: r.extraPhotos || [] }); });
  const byUrl = new Map();
  (function walk(o){
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.id && /^[\w-]{1,80}$/.test(String(o.id)) && 'ts' in o && !o.dataUrl) {
      const f = path.join(job.photosDir, String(o.id) + '.jpg');
      if (fs.existsSync(f)) { o.dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64'); byUrl.set(o.dataUrl, String(o.id)); }
    }
    Object.values(o).forEach(walk);
  })(s);

  const out = {};
  const blob = await w.buildPdfBlob(w.JSON.parse(JSON.stringify(s)), null, out);
  const buf = Buffer.from(await new Promise((resolve, reject) => { const fr = new w.FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsArrayBuffer(blob); }));
  if (buf.slice(0, 5).toString() !== '%PDF-') throw new Error('not a PDF');
  fs.writeFileSync(job.out, buf);
  fs.writeFileSync(job.out + '.photos.json', JSON.stringify((out.photos || []).map(p => ({ n: p.n, id: byUrl.get(p.dataUrl) || '', title: p.title, ts: p.ts }))));
  w.close();
}

if (require.main === module) {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  render(job).then(() => process.exit(0), e => { console.error(e && e.stack || e); process.exit(1); });
}

// From the server: runs it in a child process (so a big report can't take the server down) and returns
// { pdf: Buffer, photos: [{ n, id, title, ts }] }, or throws.
function renderInChild(state, photosDir, base, tmpDir){
  const { execFile } = require('child_process');
  fs.mkdirSync(tmpDir, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const jobFile = path.join(tmpDir, id + '.job.json'), out = path.join(tmpDir, id + '.pdf');
  fs.writeFileSync(jobFile, JSON.stringify({ state, photosDir, out, base }));
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--max-old-space-size=3072', __filename, jobFile], { timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) => {
      try {
        if (err) return reject(new Error((String(se || '').split('\n').find(Boolean) || err.message).slice(0, 300)));
        resolve({ pdf: fs.readFileSync(out), photos: JSON.parse(fs.readFileSync(out + '.photos.json', 'utf8')) });
      } catch (e) { reject(e); }
      finally { for (const f of [jobFile, out, out + '.photos.json']) try { fs.unlinkSync(f); } catch (e) {} }
    });
  });
}

module.exports = { renderInChild };
