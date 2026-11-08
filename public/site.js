// The website's motion: the header firms up on scroll, sections glide in as they come into view, numbers
// count up, and cards and the hero phone follow the cursor. Nothing here is needed to read the site.
(function () {
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

// The hero house: small triangles fly in from every side and gather into the shape of a house, then the solid
// house builds up from the ground over them (CSS) and a few loose triangles keep drifting. Made here, not in the
// HTML, so the page stays light; fewer on phones. Under reduced motion only the finished house shows.
(function () {
  var g = document.querySelector('.house .parts');
  if (!g || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  var seed = 11; function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function inside(x, y) {
    var roof = y <= 250 && y >= 40 && Math.abs(x - 310) <= (y - 40) * (240 / 210);
    return roof || (x >= 120 && x <= 500 && y >= 250 && y <= 520) || (x >= 410 && x <= 460 && y >= 80 && y <= 200);
  }
  var cols = ['#13213A', '#1B2E4B', '#1B2E4B', '#2F4F7F', '#2F4F7F', '#C49A6C', '#C49A6C', '#D9B98C', '#8A6A45', '#5B7BA8', '#B8895A'];
  var many = innerWidth < 700 ? 650 : 1200, html = [], n = 0, tries = 0;
  function tri(x, y, s, amb) {
    var a = rnd() * 6.28, pts = [0, 1, 2].map(function (k) { return (x + s * Math.cos(a + k * 2.094)).toFixed(1) + ',' + (y + s * Math.sin(a + k * 2.094)).toFixed(1); }).join(' ');
    var ang = rnd() * 6.28, r = 120 + rnd() * 200, c = cols[Math.floor(rnd() * cols.length)];
    return '<polygon' + (amb ? ' class="amb"' : '') + ' points="' + pts + '" stroke-opacity="' + (amb ? (.2 + rnd() * .25) : (.6 + rnd() * .4)).toFixed(2) +
      '" style="--c:' + c + ';--dx:' + Math.round(r * Math.cos(ang)) + 'px;--dy:' + Math.round(r * Math.sin(ang)) + 'px;--b:' + (rnd() * .9).toFixed(2) + 's;--d:' + (rnd() * 6).toFixed(2) + 's"/>';
  }
  while (n < many && tries++ < 20000) { var x = 40 + rnd() * 540, y = 20 + rnd() * 510; if (!inside(x, y)) continue; n++; html.push(tri(x, y, 2.4 + rnd() * 3.4, false)); }
  for (var i = 0; i < 140; i++) { var ax = rnd() * 620, ay = rnd() * 560; if (!inside(ax, ay)) html.push(tri(ax, ay, 1.8 + rnd() * 2.2, true)); }
  g.innerHTML = html.join('');
  document.documentElement.classList.add('house-on');
  // Once the solid house is up, the triangles inside it are hidden: take them away so phones don't keep animating them.
  setTimeout(function () { [].slice.call(g.querySelectorAll('polygon:not(.amb)')).forEach(function (p) { p.remove(); }); }, 7600);
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
