/*
 * The page's only script.
 *
 * IntersectionObserver rather than a scroll listener: a scroll handler runs on every frame
 * the page moves and there is nothing here worth that cost. Each element is unobserved once
 * it has arrived, so nothing keeps running behind the reader.
 */
(function () {
  var targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  // No observer, or the reader has asked for less motion: show everything and stop.
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
    // A percentage bottom margin is a share of the viewport height, so on a very tall
    // window it can shrink the observed area past the last section and leave it hidden for
    // good. A fixed inset does the same job at every window size.
  }, { rootMargin: '0px 0px -80px 0px', threshold: 0.05 });

  targets.forEach(function (el) { io.observe(el); });
})();
