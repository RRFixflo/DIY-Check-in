// The website's motion: the header firms up on scroll, sections glide in as they come into view, numbers
// count up, and cards and the hero phone follow the cursor. Nothing here is needed to read the site.
(function () {
  // The first page of this visit and the site that sent it (this tab only, no cookie), so a booking can say where
  // the visitor came from.
  try { if (!sessionStorage.getItem('diy-visit')) { var r = document.referrer, ext = r && r.indexOf(location.origin) !== 0 && !/^https?:\/\/(www\.)?diyinventory\.co\.uk/.test(r);
    sessionStorage.setItem('diy-visit', JSON.stringify({ land: location.pathname + location.search, ref: ext ? r : '', at: Date.now() })); } } catch (e) {}
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var top = document.querySelector('header.top');
  function onScroll() { if (top) top.classList.toggle('scrolled', window.scrollY > 8); }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Glide in: section headings, cards, steps, FAQ entries and counters, staggered within each group.
  var els = [].slice.call(document.querySelectorAll('main .sec-head, main .card, main .stat, main .faq details, main .faq h2, main .timeline > *, main article.prose > *'))
    .filter(function (el) { return !el.closest('.hero') && !el.closest('.reveal'); });
  els.forEach(function (el) { var sibs = [].slice.call(el.parentNode.children); el.style.setProperty('--i', Math.min(sibs.indexOf(el), 8)); });
  function countUp(el) {
    var end = parseFloat(el.getAttribute('data-count')), pre = el.getAttribute('data-prefix') || '', suf = el.getAttribute('data-suffix') || '';
    if (reduce) { el.textContent = pre + end + suf; return; }
    var t0 = null;
    function step(t) { if (!t0) t0 = t; var p = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - p, 3); el.textContent = pre + Math.round(end * e) + suf; if (p < 1) requestAnimationFrame(step); }
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
