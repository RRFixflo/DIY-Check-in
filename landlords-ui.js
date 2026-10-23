// The signed-in landlord dashboard's own chrome and its small browser scripts (landlords.js uses them):
//   appChrome()  swaps the website's header and footer for the dashboard's own (brand, the landlord's name,
//                Properties / Rent / Expenses / Tax year / Settings, Sign out; a tab bar at the bottom on phones)
//   ADDR_UI      postcode first: lists the addresses at a postcode (/api/address) and fills the fields
//   TNT_UI       the tenancy form's tenants: Add another tenant / Remove
//   TABS_UI      the property page's tabs (Overview, Rent, Expenses, Certificates, Tenancy), from the URL's #
//   DT_UI        the dashboard's figures: each opens the list of what makes it up
//   DRAFT_UI     every form keeps what's typed in localStorage until it's saved; notes also save to the server
// Every script works on what's in the page and does nothing when its parts aren't there. Without JavaScript the
// pages still work: all tabs show one after another, the address fields are plain, and forms post as usual.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/><path d="M9 20v-5h6v5"/>',
  rent: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/>',
  exp: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  tax: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const svg = (p, n = 20) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const NAV = [['props', 'Properties', '/account', 'home'], ['rent', 'Rent', '/account/rent', 'rent'], ['exp', 'Expenses', '/account/expenses', 'exp'], ['tax', 'Tax year', '/account/money', 'tax'], ['set', 'Settings', '/account/settings', 'set']];
function navKey(p){
  p = String(p || '');
  return /^\/account\/rent/.test(p) ? 'rent' : /^\/account\/expenses/.test(p) ? 'exp' : /^\/account\/money/.test(p) ? 'tax' : /^\/account\/settings/.test(p) ? 'set' : 'props';
}
function appChrome(html, acc, path){
  const on = navKey(path), cur = k => k === on ? ' aria-current="page" class="on"' : '';
  const header = `<header class="lhd"><div class="wrap lhd-in">
  <a class="lhd-brand" href="/account"><img src="/icons/icon-192.png" alt="" width="30" height="30"><span><b>Landlord dashboard</b><small>DIY Inventory</small></span></a>
  <nav class="lhd-nav" aria-label="Dashboard">${NAV.map(([k, l, h]) => `<a href="${h}"${cur(k)}>${l}</a>`).join('')}</nav>
  <div class="lhd-me"><a class="lhd-back" href="/">← diyinventory.co.uk</a><span class="lhd-name" title="${esc(acc.email)}">${esc(acc.name)}</span><form method="post" action="/account/sign-out" class="inline"><button class="lhd-out">Sign out</button></form></div>
</div></header>
<nav class="lbar" aria-label="Dashboard">${NAV.map(([k, l, h, i]) => `<a href="${h}"${cur(k)}>${svg(ICON[i])}<span>${l}</span></a>`).join('')}</nav>`;
  const footer = `<footer class="lft"><div class="wrap"><a href="/">← Back to diyinventory.co.uk</a><span><a href="/app">Do a check-in or inspection</a> · <a href="/certificates">Book a certificate</a> · <a href="/contact">Help</a> · <a href="/privacy">Privacy</a></span></div></footer>`;
  return html.replace('<body>', '<body class="lapp">').replace(/<header class="top">[\s\S]*?<\/header>/, () => header).replace(/<footer>[\s\S]*?<\/footer>/, () => footer);
}

const ADDR_UI = String.raw`<script>
(function(){
  if (!window.fetch || !document.querySelector) return;
  var RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
  function tidy(v){ var s = String(v || '').toUpperCase().replace(/\s+/g, ''); return RE.test(s) ? s.slice(0, -3) + ' ' + s.slice(-3) : ''; }
  [].forEach.call(document.querySelectorAll('[data-addr]'), function(box){
    var form = box.closest('form'), q = function(s){ return form.querySelector(s); };
    var pc = q('[data-pc]'), btn = q('[data-find]'), wrap = q('[data-pickwrap]'), pick = q('[data-pick]'), msg = q('[data-msg]'), picked = q('[data-picked]'),
        fields = q('[data-fields]'), manualWrap = q('[data-manualwrap]'), manual = q('[data-manual]');
    if (!pc || !btn || !pick) return;
    var last = '', timer = 0, seq = 0, list = [];
    pc.setAttribute('autocomplete', 'off');
    btn.hidden = false;
    function say(t){ msg.textContent = t || ''; msg.hidden = !t; }
    function showFields(focus){ fields.hidden = false; fields.removeAttribute('data-blank'); manualWrap.hidden = true; if (focus) { var f = form.elements.houseNo; if (f) f.focus(); } }
    if (fields.hasAttribute('data-blank')) { fields.hidden = true; manualWrap.hidden = false; }
    function opt(v, t){ var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }
    function find(force){
      var p = tidy(pc.value);
      if (!p) { if (force) say('Enter the full postcode, for example SW1A 1AA.'); return; }
      if (p === last && !force) return;
      last = p; pc.value = p; var my = ++seq;
      say('Looking up the addresses at ' + p + '…'); btn.disabled = true;
      fetch('/api/address/' + encodeURIComponent(p), { credentials: 'same-origin' }).then(function(r){ return r.json(); }).catch(function(){ return { ok: false }; }).then(function(d){
        if (my !== seq) return;
        btn.disabled = false;
        list = d && d.ok && d.addresses ? d.addresses : [];
        pick.innerHTML = '';
        if (list.length) {
          pick.appendChild(opt('', 'Choose the address (' + list.length + ' found)'));
          list.forEach(function(a, i){ pick.appendChild(opt(String(i), a.label)); });
          pick.appendChild(opt('manual', 'It’s not listed: enter it myself'));
          wrap.hidden = false; say('');
          pick.focus();
        } else {
          wrap.hidden = true; if (!d || !d.ok) last = '';
          say(d && d.ok ? 'We couldn’t find any addresses at ' + p + '. Only homes that have had an EPC are listed, so please type the address below.'
            : d && d.reason === 'invalid' ? 'Enter the full postcode, for example SW1A 1AA.'
            : 'Address search isn’t available just now. Please type the address below.');
          if (!(d && d.reason === 'invalid')) showFields(false);
        }
      });
    }
    pc.addEventListener('input', function(){ clearTimeout(timer); if (picked) picked.value = ''; if (tidy(pc.value)) timer = setTimeout(find, 350); });
    pc.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); find(true); } });
    btn.addEventListener('click', function(){ clearTimeout(timer); find(true); });
    manual.addEventListener('click', function(){ wrap.hidden = true; say(''); showFields(true); });
    pick.addEventListener('change', function(){
      if (pick.value === 'manual') { wrap.hidden = true; picked.value = ''; say('Type the address below.'); showFields(true); return; }
      var a = list[+pick.value]; if (pick.value === '' || !a) return;
      ['houseNo', 'building', 'road', 'town'].forEach(function(k){ var el = form.elements[k]; if (el) { el.value = a[k] || ''; el.dispatchEvent(new Event('input', { bubbles: true })); } });
      if (a.postcode) pc.value = a.postcode;
      last = tidy(pc.value); picked.value = a.label || '';
      showFields(false);
      say('Check the address below and change anything that isn’t quite right. We’ll find its EPC when you save.');
    });
    // Hidden required fields can't be checked: show them before the browser validates.
    [].forEach.call(form.querySelectorAll('button:not([type=button])'), function(b){ b.addEventListener('click', function(){ if (fields.hidden) showFields(false); }); });
  });
})();
</script>`;

const TNT_UI = String.raw`<script>
(function(){
  [].forEach.call(document.querySelectorAll('[data-tnts]'), function(list){
    var form = list.closest('form'), add = form.querySelector('[data-tnt-add]'), MAX = 8;
    function blocks(){ return [].slice.call(list.querySelectorAll('fieldset.tnt')); }
    function empty(f){ return [].every.call(f.querySelectorAll('input'), function(i){ return !i.value.trim(); }); }
    function renumber(){
      var bs = blocks().filter(function(f){ return !f.hidden; });
      bs.forEach(function(f, i){ var l = f.querySelector('legend'); if (l) l.textContent = 'Tenant ' + (i + 1); var x = f.querySelector('[data-tnt-remove]'); if (x) x.hidden = bs.length < 2 && empty(f); });
      add.hidden = blocks().length >= MAX && !blocks().some(function(f){ return f.hidden; });
    }
    function blank(){
      var src = blocks()[0], f = src.cloneNode(true);
      f.removeAttribute('data-spare'); f.hidden = false;
      [].forEach.call(f.querySelectorAll('input'), function(i){ i.value = ''; });
      list.appendChild(f); wire(f); return f;
    }
    function wire(f){
      var x = f.querySelector('[data-tnt-remove]');
      if (x) x.onclick = function(){
        if (blocks().filter(function(b){ return !b.hidden; }).length < 2) { [].forEach.call(f.querySelectorAll('input'), function(i){ i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }); }
        else { f.remove(); form.dispatchEvent(new Event('input', { bubbles: true })); }
        renumber();
      };
      [].forEach.call(f.querySelectorAll('input'), function(i){ i.addEventListener('input', renumber); });
    }
    // The empty "Another tenant" block stays hidden until Add another tenant.
    blocks().forEach(function(f){ if (f.hasAttribute('data-spare') && empty(f)) f.hidden = true; f.removeAttribute('data-spare'); wire(f); });
    add.hidden = false;
    add.addEventListener('click', function(){
      var spare = blocks().filter(function(f){ return f.hidden; })[0], f = spare || (blocks().length < MAX ? blank() : null);
      if (!f) return; f.hidden = false; renumber(); var n = f.querySelector('input'); if (n) n.focus();
    });
    // Hidden empty blocks are dropped by the server, so they can stay in the form.
    form.addTenant = function(){ var spare = blocks().filter(function(f){ return f.hidden; })[0]; var f = spare || blank(); f.hidden = false; renumber(); return f; };
    renumber();
  });
})();
</script>`;

const TABS_UI = String.raw`<script>
(function(){
  var bar = document.querySelector('[data-ptabs]'); if (!bar) return;
  var panes = [].slice.call(document.querySelectorAll('[data-pane]')), tabs = [].slice.call(bar.querySelectorAll('a[data-tab]'));
  document.documentElement.classList.add('tabs-on');
  function paneOf(id){
    var el = id && document.getElementById(id);
    if (!el) return null;
    var p = el.closest('[data-pane]'); return p ? { pane: p, el: el } : null;
  }
  function show(name){
    panes.forEach(function(p){ p.classList.toggle('on', p.getAttribute('data-pane') === name); });
    tabs.forEach(function(t){ var on = t.getAttribute('data-tab') === name; t.classList.toggle('on', on); if (on) { t.setAttribute('aria-current', 'page'); if (t.offsetLeft + t.offsetWidth > bar.scrollLeft + bar.clientWidth || t.offsetLeft < bar.scrollLeft) bar.scrollLeft = t.offsetLeft - 16; } else t.removeAttribute('aria-current'); });
  }
  function go(id, scroll){
    var hit = paneOf(id);
    show(hit ? hit.pane.getAttribute('data-pane') : 'overview');
    if (!scroll) return;
    var target = !hit || hit.el === hit.pane || hit.el === hit.pane.firstElementChild ? bar : hit.el;
    var y = target.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top: Math.max(0, y), behavior: scroll === 'jump' ? 'auto' : 'smooth' });
    var d = hit && hit.el.closest('details'); if (d && hit.el !== hit.pane && hit.el.tagName === 'DETAILS') d.open = true;
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
    var id = a.getAttribute('href').slice(1); if (!paneOf(id)) return;
    e.preventDefault(); history.replaceState(null, '', '#' + id); go(id, 'smooth');
  });
  addEventListener('hashchange', function(){ go(location.hash.slice(1), 'jump'); });
  var start = location.hash.slice(1);
  go(start, start ? 'jump' : '');
  if (start) setTimeout(function(){ go(start, 'jump'); }, 60);
})();
</script>`;

const DT_UI = String.raw`<script>
(function(){
  var ts = [].slice.call(document.querySelectorAll('[data-dt]')); if (!ts.length) return;
  function show(k){
    ts.forEach(function(t){ var on = t.getAttribute('data-dt') === k; t.classList.toggle('on', on); t.setAttribute('aria-expanded', on ? 'true' : 'false'); });
    [].forEach.call(document.querySelectorAll('.dtl'), function(p){ p.hidden = p.id !== 'dt-' + k; });
    var p = k && document.getElementById('dt-' + k); if (p && p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  ts.forEach(function(t){ t.addEventListener('click', function(e){ e.preventDefault(); show(t.classList.contains('on') ? '' : t.getAttribute('data-dt')); }); });
  document.addEventListener('click', function(e){ if (e.target.closest && e.target.closest('[data-dt-close]')) { e.preventDefault(); show(''); } });
})();
</script>`;

// Drafts: each form's fields (not files, passwords or hidden ones) are kept in localStorage as they're typed,
// keyed by page and form. Opening the page again restores them, with a note and "Discard". Submitting marks the
// draft as sent; the next page that shows a saved notice (?m=) clears the sent drafts. Drafts last 14 days.
// [data-autosave] fields (notes) also save themselves to the server a moment after typing stops.
const DRAFT_UI = String.raw`<script>
(function(){
  var LS; try { LS = window.localStorage; LS.setItem('diy-t', '1'); LS.removeItem('diy-t'); } catch (e) { LS = null; }
  var P = 'diy-draft:', DAY = 864e5;
  function keys(){ var out = []; if (!LS) return out; for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf(P) === 0) out.push(k); } return out; }
  function read(k){ try { return JSON.parse(LS.getItem(k)); } catch (e) { return null; } }
  if (LS) {
    var saved = /[?&]m=/.test(location.search);
    keys().forEach(function(k){ var d = read(k); if (!d || Date.now() - (d.at || 0) > 14 * DAY || (saved && d.sent)) LS.removeItem(k); });
  }
  function fieldsOf(form){ return [].filter.call(form.elements, function(el){ return el.name && !el.disabled && !/^(file|password|hidden|submit|button)$/i.test(el.type) && el.name !== 'website'; }); }
  function snap(form){ return fieldsOf(form).map(function(el){ return [el.name, el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? '1' : '') : el.value]; }); }
  var forms = [].slice.call(document.querySelectorAll('main form')).filter(function(f){ return (f.getAttribute('method') || '').toLowerCase() === 'post' && !f.hasAttribute('data-nodraft') && fieldsOf(f).some(function(el){ return el.tagName === 'TEXTAREA' || /^(text|email|tel|date|number|search|url)$/i.test(el.type) || el.tagName === 'SELECT'; }) && fieldsOf(f).length > 1; });
  forms.forEach(function(form, i){
    var key = P + location.pathname + location.search.replace(/([?&])m=[^&]*&?/, '$1').replace(/[?&]$/, '') + '|' + (form.getAttribute('action') || '') + '|' + i, base = JSON.stringify(snap(form)), timer = 0;
    function save(sent){
      if (!LS) return; var s = snap(form), j = JSON.stringify(s);
      if (j === base && !sent) { LS.removeItem(key); return; }
      try { LS.setItem(key, JSON.stringify({ at: Date.now(), v: s, sent: !!sent })); } catch (e) {}
    }
    var d = LS && read(key);
    if (d && d.v && JSON.stringify(d.v) !== base) {
      var seen = {};
      d.v.forEach(function(pair){
        var name = pair[0], n = seen[name] = (seen[name] || 0) + 1;
        var els = fieldsOf(form).filter(function(el){ return el.name === name; });
        if (els.length < n && form.addTenant && /^t_/.test(name)) { form.addTenant(); els = fieldsOf(form).filter(function(el){ return el.name === name; }); }
        var el = els[n - 1]; if (!el) return;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!pair[1]; else el.value = pair[1];
        var fs = el.closest('fieldset'); if (fs && fs.hidden && pair[1]) fs.hidden = false;
      });
      var det = form.closest('details'); if (det) det.open = true;
      var fl = form.querySelector('[data-fields]'); if (fl) { fl.hidden = false; var mw = form.querySelector('[data-manualwrap]'); if (mw) mw.hidden = true; }
      var note = document.createElement('p'); note.className = 'draft-note'; note.setAttribute('role', 'status');
      note.innerHTML = '<span>Restored your unsaved changes.</span> <button type="button" class="linkbtn">Discard them</button>';
      note.querySelector('button').onclick = function(){ LS.removeItem(key); location.reload(); };
      form.insertBefore(note, form.firstChild);
    }
    form.addEventListener('input', function(){ clearTimeout(timer); timer = setTimeout(function(){ save(false); }, 400); });
    form.addEventListener('change', function(){ save(false); });
    form.addEventListener('submit', function(){ clearTimeout(timer); save(true); });
    addEventListener('pagehide', function(){ clearTimeout(timer); var dd = read(key); if (!(dd && dd.sent)) save(false); });
  });
  // Notes save themselves.
  [].forEach.call(document.querySelectorAll('[data-autosave]'), function(el){
    var url = el.getAttribute('data-autosave'), t = 0, last = el.value, ind = document.createElement('span');
    ind.className = 'autosave'; ind.setAttribute('aria-live', 'polite'); el.parentNode.appendChild(ind);
    function push(){
      if (el.value === last) return; var v = el.value; ind.textContent = 'Saving…'; ind.className = 'autosave';
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'notes=' + encodeURIComponent(v) })
        .then(function(r){ if (!r.ok) throw 0; last = v; ind.textContent = '✓ Saved'; ind.className = 'autosave ok'; })
        .catch(function(){ ind.textContent = 'Not saved yet: we’ll keep it on this device and try again.'; ind.className = 'autosave bad'; });
    }
    el.addEventListener('input', function(){ clearTimeout(t); ind.textContent = ''; t = setTimeout(push, 1200); });
    el.addEventListener('blur', push);
    addEventListener('online', push);
  });
})();
</script>`;

module.exports = { appChrome, navKey, ADDR_UI, TNT_UI, TABS_UI, DT_UI, DRAFT_UI, svg, ICON };
