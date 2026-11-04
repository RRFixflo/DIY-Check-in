// Tenant referencing data under REPORTS_DIR/referencing/: one JSON file per reference in refs/, and uploaded
// documents in files/<referenceId>/. Writes are atomic.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DIR = '', REFS = '', FILES = '';
function init(reportsDir){ DIR = path.join(reportsDir, 'referencing'); REFS = path.join(DIR, 'refs'); FILES = path.join(DIR, 'files'); [DIR, REFS, FILES].forEach(d => fs.mkdirSync(d, { recursive: true })); }
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); };
const id = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const token = () => crypto.randomBytes(18).toString('base64url');
const ID_RE = /^[a-z0-9]{12,24}$/;
const norm = r => { if (r) { r.groupId = r.groupId || r.id; r.role = r.role || 'tenant'; } return r; };
function ref(rid){ return ID_RE.test(String(rid)) ? norm(readJson(path.join(REFS, rid + '.json'), null)) : null; }
function saveRef(r){ r.updatedAt = new Date().toISOString(); writeJson(path.join(REFS, r.id + '.json'), r); return r; }
function allRefs(){ return fs.readdirSync(REFS).filter(f => f.endsWith('.json')).map(f => norm(readJson(path.join(REFS, f), null))).filter(Boolean); }
// The reference and the kind of link ('apply', 'employer', 'landlord') a token belongs to.
function byToken(t){
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(t))) return null;
  for (const r of allRefs()) for (const [k, v] of Object.entries(r.tokens || {})) if (v === t) return { r, kind: k };
  return null;
}
function event(r, text){ (r.events = r.events || []).push({ at: new Date().toISOString(), text }); }
const fileDir = rid => { const d = path.join(FILES, rid); fs.mkdirSync(d, { recursive: true }); return d; };
function deleteFiles(rid){ fs.rmSync(path.join(FILES, rid), { recursive: true, force: true }); }
function deleteRef(rid){ deleteFiles(rid); fs.rmSync(path.join(REFS, rid + '.json'), { force: true }); }
module.exports = { init, id, token, ref, saveRef, allRefs, byToken, event, fileDir, deleteFiles, deleteRef };
