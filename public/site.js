// The website's motion: the header gets a rule once you scroll, and sections fade up as they come into
// view. Nothing here is needed to read the site.
(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var top = document.querySelector('header.top');
  function onScroll() { if (top) top.classList.toggle('scrolled', window.scrollY > 8); }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (reduce || !('IntersectionObserver' in window)) return;

  // Fade up: section headings, steps, features, rows and FAQ entries, staggered within each group.
  var els = [].slice.call(document.querySelectorAll('main .sec-head, main .step, main .feature, main .way, main .figures > div, main .service, main .faq details, main .faq h2, main .timeline > *, main .pages, main .split > div, main .card, main article.prose > *, main .compare tbody tr'))
    .filter(function (el) { return !el.closest('.hero') && !el.closest('.reveal'); });
  els.forEach(function (el) { var sibs = [].slice.call(el.parentNode.children); el.style.setProperty('--i', Math.min(sibs.indexOf(el), 6)); el.classList.add('reveal'); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  els.forEach(function (el) { io.observe(el); });
})();
