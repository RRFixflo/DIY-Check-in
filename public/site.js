// The website's motion: the header firms up on scroll, sections glide in as they come into view, numbers
// count up, and cards and the hero phone follow the cursor. Nothing here is needed to read the site.
(function () {
  // A real person (not a robot): once per tab, after a scroll, tap, key or 4 s on screen; counts towns of real visitors.
  try {
    if (!sessionStorage.getItem('diy-human')) {
      var hs = false, hum = function () { if (hs) return; hs = true; try { sessionStorage.setItem('diy-human', '1'); var b = JSON.stringify({ name: 'human' }); if (!(navigator.sendBeacon && navigator.sendBeacon('/api/event', new Blob([b], { type: 'text/plain' })))) fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: b, keepalive: true }); } catch (e) {} };
      ['scroll', 'pointerdown', 'keydown', 'touchstart'].forEach(function (t) { addEventListener(t, hum, { once: true, passive: true }); });
      setTimeout(function () { if (document.visibilityState === 'visible') hum(); }, 4000);
    }
  } catch (e) {}
  // Where this visit came from (this tab only, sessionStorage, no cookie): the first page (with its campaign tags and
  // ad click id), the site that sent the visitor, when they arrived, how many pages they've seen and the last few.
  // Every form posted on the site carries it as a hidden src_visit field (origin.js on the server), so each lead says
  // exactly where it came from.
  try {
    var here = location.pathname + location.search, v = JSON.parse(sessionStorage.getItem('diy-visit') || 'null');
    if (!v) { var r = document.referrer, ext = r && r.indexOf(location.origin) !== 0 && !/^https?:\/\/(www\.)?diyinventory\.co\.uk/.test(r);
      v = { land: here, ref: ext ? r : '', at: Date.now(), pages: 0, trail: [] }; }
    v.pages = (v.pages || 0) + 1; v.trail = (v.trail || []).concat(here).slice(-8);
    sessionStorage.setItem('diy-visit', JSON.stringify(v));
    document.addEventListener('submit', function (e) {
      var f = e.target; if (!f || String(f.getAttribute('method') || '').toLowerCase() !== 'post') return;
      var cur = {}; try { cur = JSON.parse(sessionStorage.getItem('diy-visit') || '{}'); } catch (x) {}
      cur.here = location.pathname + location.search;
      var inp = f.querySelector('input[name="src_visit"]'); if (!inp) { inp = document.createElement('input'); inp.type = 'hidden'; inp.name = 'src_visit'; f.appendChild(inp); }
      inp.value = JSON.stringify(cur);
    }, true);
  } catch (e) {}
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var top = document.querySelector('header.top');
  function onScroll() { if (top) top.classList.toggle('scrolled', window.scrollY > 8); }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Glide in: section headings, cards, steps, FAQ entries and counters, staggered within each group.
  var els = [].slice.call(document.querySelectorAll('main .sec-head, main .card, main .stat, main .faq details, main .faq h2, main .timeline > *, main article.prose > *'))
    .filter(function (el) { return !el.closest('.hero') && !el.closest('.reveal'); });
  els.forEach(function (el) { var sibs = [].slice.call(el.parentNode.children); el.style.setProperty('--i', Math.min(sibs.indexOf(el), 8)); });
  function countUp(el) {
    var dec = (String(el.getAttribute('data-count')).split('.')[1] || '').length, end = parseFloat(el.getAttribute('data-count')), pre = el.getAttribute('data-prefix') || '', suf = el.getAttribute('data-suffix') || '';
    if (reduce) { el.textContent = pre + (dec ? end.toFixed(dec) : end) + suf; return; }
    var t0 = null;
    function step(t) { if (!t0) t0 = t; var p = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - p, 3); el.textContent = pre + (dec ? (end * e).toFixed(dec) : Math.round(end * e)) + suf; if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }
  var counters = [].slice.call(document.querySelectorAll('[data-count]'));
  if (reduce || !('IntersectionObserver' in window)) { counters.forEach(countUp); return; }
  els.forEach(function (el) { el.classList.add('reveal'); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in'); io.unobserve(en.target);
      [].slice.call(en.target.querySelectorAll('[data-count]')).concat(en.target.hasAttribute('data-count') ? [en.target] : []).forEach(countUp);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  els.forEach(function (el) { io.observe(el); });

  // Spotlight under the cursor on cards.
  document.addEventListener('pointermove', function (e) {
    var c = e.target.closest && e.target.closest('.card');
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  // The hero phone leans towards the cursor.
  var vis = document.querySelector('.hero .visual');
  if (vis && matchMedia('(pointer: fine)').matches) {
    var hero = document.querySelector('.hero');
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      vis.style.transform = 'perspective(1000px) rotateY(' + (x * 10).toFixed(2) + 'deg) rotateX(' + (-y * 8).toFixed(2) + 'deg)';
    });
    hero.addEventListener('pointerleave', function () { vis.style.transform = ''; });
    vis.style.transition = 'transform .4s cubic-bezier(.2,.7,.2,1)';
  }
})();

// The hero photo of a hand holding a phone: scale its 750px-wide crop to the box.
(function () {
  var box = document.querySelector('.hand-shot'); if (!box) return;
  function fit() { box.style.setProperty('--k', (box.clientWidth / 750).toFixed(4)); }
  fit(); addEventListener('resize', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(box);
})();

// The hero: someone doing their own inventory. The phone in their hand frames each item of the room in turn,
// takes the photo (shutter, flash, a dated thumbnail), a condition is chosen and the item is pinned as done on the
// room; then the next item, and round again. Under reduced motion one finished step shows, still.
(function () {
  var root = document.querySelector('.dq');
  if (!root) return;
  var items = [['Fridge', .12, .55], ['Oven', .53, .7], ['Worktops', .8, .62], ['Ceiling lights', .73, .2], ['Flooring', .42, .92]];
  var q = function (s) { return root.querySelector(s); };
  var frame = q('.dq-frame'), pins = q('.dq-pins'), hand = q('.dq-hand'), view = q('.dq-view'), name = q('.dq-item'), count = q('.dq-count'),
    flash = q('.dq-flash'), cond = q('.dq-cond'), thumbs = q('.dq-thumbs'), shut = q('.dq-shut');
  var clamp = function (v) { return Math.max(0, Math.min(1, v)); };
  // The phone's camera shows the room zoomed in (380% wide), centred on the item.
  function pos(tx, ty) { return (clamp((3.8 * tx - .5) / 2.8) * 100).toFixed(1) + '% ' + (clamp((2.525 * ty - 1.082) / .361) * 100).toFixed(1) + '%'; }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  var done = 0;
  function aim(i) {
    var it = items[i];
    frame.style.left = it[1] * 100 + '%'; frame.style.top = it[2] * 100 + '%';
    view.style.backgroundPosition = pos(it[1], it[2]);
    hand.style.setProperty('--hx', Math.max(-30, Math.min(6, (it[1] - .7) * 40)).toFixed(1) + '%');
    hand.style.setProperty('--hy', ((it[2] - .6) * 10).toFixed(1) + '%');
    hand.style.setProperty('--hr', ((it[1] - .6) * 6).toFixed(1) + 'deg');
    name.style.opacity = 0; setTimeout(function () { name.textContent = it[0]; name.style.opacity = 1; }, 250);
    cond.classList.remove('on');
  }
  function snap(i) {
    var it = items[i];
    shut.classList.add('tap'); setTimeout(function () { shut.classList.remove('tap'); }, 160);
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    var t = document.createElement('span'); t.style.backgroundPosition = pos(it[1], it[2]); t.setAttribute('data-t', stamp());
    thumbs.appendChild(t); while (thumbs.children.length > 3) thumbs.removeChild(thumbs.firstChild);
    done++; count.textContent = 'Kitchen · ' + done + ' of 10';
  }
  function pin(i) {
    var it = items[i], p = document.createElement('span');
    p.textContent = it[0] + ' · Good'; p.style.left = it[1] * 100 + '%'; p.style.top = it[2] * 100 + '%';
    pins.appendChild(p); requestAnimationFrame(function () { requestAnimationFrame(function () { p.classList.add('on'); }); });
  }
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    aim(1); snap(0); snap(1); cond.classList.add('on'); pin(0); pin(1); name.textContent = items[1][0]; name.style.opacity = 1; return;
  }
  var step = 0;
  function run() {
    if (document.hidden) { setTimeout(run, 1000); return; }
    if (step === items.length) {   // round again: clear the room and start the next walk round
      [].slice.call(pins.children).forEach(function (p) { p.classList.remove('on'); });
      setTimeout(function () { pins.innerHTML = ''; thumbs.innerHTML = ''; done = 0; count.textContent = 'Kitchen · 0 of 10'; step = 0; run(); }, 700);
      return;
    }
    var i = step++;
    aim(i);
    setTimeout(function () { snap(i); }, 1300);
    setTimeout(function () { cond.classList.add('on'); }, 1700);
    setTimeout(function () { pin(i); }, 2500);
    setTimeout(run, i === items.length - 1 ? 4800 : 3600);
  }
  aim(0); setTimeout(run, 700);
})();

// The hero headline: each word rises in from a blur, one after another; the coloured words (<em>) flow through
// navy, blue and camel, each a little behind the one before, so the colour runs along the line.
(function () {
  var h = document.querySelector('.hero h1'); if (!h || h.getAttribute('data-split')) return;
  h.setAttribute('data-split', '1');
  var i = 0;
  function split(node, inEm) {
    [].slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        var frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
          var sp = document.createElement('span'); sp.className = 'hw' + (inEm ? ' hg' : ''); sp.textContent = w;
          sp.style.setProperty('--i', i++); frag.appendChild(sp);
        });
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1) split(n, inEm || n.tagName === 'EM');
    });
  }
  split(h, false);
  h.classList.add('split');
})();
