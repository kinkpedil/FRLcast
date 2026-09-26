/*
 * The landing page's only script. No framework, no build step: the site is static and
 * deployed straight to Vercel, so every effect the redesign needs is done here in plain JS.
 *
 *   - reveal:      fade sections in as they enter the viewport (IntersectionObserver)
 *   - marquee:     two image rows that scroll with the page's scroll position
 *   - magnet:      the hero screenshot leans toward the cursor
 *   - text reveal: the "what it is" paragraph lights up character by character on scroll
 *   - stack cards: the showcase cards scale down a touch as the next one covers them
 *
 * Everything checks prefers-reduced-motion and degrades to a plain, readable page.
 */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- reveal
  (function () {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -70px 0px', threshold: 0.06 });
    els.forEach(function (el) { io.observe(el); });
  })();

  // ---------------------------------------------------------------- marquee
  (function () {
    var top = document.getElementById('mqTop');
    var bot = document.getElementById('mqBot');
    if (!top || !bot) return;

    // Real product screenshots woven with typographic stat tiles. Every stat is a true fact
    // about the product, not filler, so the strip reads as a brand band rather than padding.
    var shots = [
      { img: '/shots/overlay.png', alt: 'The broadcast overlay' },
      { img: '/shots/dashboard.png', alt: 'The operator console' },
      { img: '/shots/tutorial-thumbnail.jpg', alt: 'The video tutorial' }
    ];
    var stats = [
      { n: '~1s', k: 'flag to the phone' },
      { n: '11', k: 'overlay widgets' },
      { n: '10', k: 'broadcast themes' },
      { n: 'EN·ID', k: 'console and app' },
      { n: '1', k: 'OBS browser source' },
      { n: '40 KB', k: 'the driver app' }
    ];
    function imgTile(shot) {
      var d = document.createElement('div');
      d.className = 'mq-tile';
      var im = document.createElement('img');
      im.src = shot.img; im.alt = shot.alt; im.loading = 'lazy';
      d.appendChild(im);
      return d;
    }
    function statTile(s) {
      var d = document.createElement('div');
      d.className = 'mq-tile mq-stat';
      d.innerHTML = '<b>' + s.n + '</b><span>' + s.k + '</span>';
      return d;
    }
    // Each row is: screenshot, stat, stat, repeated, offset so the two rows never line up.
    function fill(track, offset) {
      var seq = document.createDocumentFragment();
      for (var i = 0; i < 6; i++) {
        seq.appendChild(imgTile(shots[(offset + i) % shots.length]));
        seq.appendChild(statTile(stats[(offset * 2 + i * 2) % stats.length]));
        seq.appendChild(statTile(stats[(offset * 2 + i * 2 + 1) % stats.length]));
      }
      var whole = document.createDocumentFragment();
      for (var r = 0; r < 3; r++) whole.appendChild(seq.cloneNode(true));
      track.appendChild(whole);
    }
    fill(top, 0);
    // The rows move as the page scrolls. This is user-driven, not autoplay, so it runs even
    // under reduced motion: nothing moves unless the reader is actively scrolling.
    var sec = document.querySelector('.marquee');
    var raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        // Only bother while the strip is anywhere near the viewport.
        var r = sec.getBoundingClientRect();
        if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
        // Tie the travel to the scroll position directly: about 0.9px of slide per pixel
        // scrolled, which is clearly visible without being dizzying. One third of the track
        // is a full sequence, so wrapping inside it keeps the loop seamless in both directions.
        var oneThird = top.scrollWidth / 3;
        var x = ((window.scrollY * 0.9 % oneThird) + oneThird) % oneThird;
        top.style.transform = 'translate3d(' + (-x) + 'px,0,0)';
        bot.style.transform = 'translate3d(' + (x - oneThird) + 'px,0,0)';
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  })();

  // ---------------------------------------------------------------- magnet (hero screenshot)
  (function () {
    if (reduce || window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.magnet').forEach(function (el) {
      var pad = 120, strength = 5;
      el.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)';
      window.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var dx = e.clientX - cx, dy = e.clientY - cy;
        var near = Math.abs(dx) < r.width / 2 + pad && Math.abs(dy) < r.height / 2 + pad;
        if (near) {
          el.style.transition = 'transform .3s ease-out';
          el.style.transform = 'translate(' + (dx / strength) + 'px,' + (dy / strength) + 'px)';
        } else {
          el.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)';
          el.style.transform = '';
        }
      }, { passive: true });
    });
  })();

  // ---------------------------------------------------------------- text reveal
  (function () {
    var p = document.querySelector('[data-animate-text]');
    if (!p) return;
    // The English original, kept so the paragraph can be rebuilt in whichever language is
    // current. Reduced motion leaves the plain text in place for i18n to translate normally.
    var english = p.textContent;
    if (reduce) return;
    // Take this element off i18n's DOM walk: once it is a row of single-character spans the
    // walker cannot match the sentence, so this owns its own translation through t() below.
    p.setAttribute('data-i18n-skip', '');
    var spans = [];
    function build() {
      var txt = (window.FRL_I18N && window.FRL_I18N.t) ? window.FRL_I18N.t(english) : english;
      p.textContent = '';
      spans = [];
      for (var i = 0; i < txt.length; i++) {
        var s = document.createElement('span');
        s.className = 'ch';
        s.textContent = txt[i];
        s.style.color = 'rgba(170,178,189,.25)';
        p.appendChild(s);
        spans.push(s);
      }
      light();
    }
    var raf = 0;
    function light() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var r = p.getBoundingClientRect();
        var vh = window.innerHeight;
        // 0 when the paragraph's top is 80% down the viewport, 1 when its bottom hits 20%.
        var prog = (vh * 0.8 - r.top) / (r.height + vh * 0.6);
        prog = Math.max(0, Math.min(1, prog));
        var lit = Math.round(prog * spans.length);
        for (var i = 0; i < spans.length; i++) {
          spans[i].style.color = i < lit ? 'var(--ink)' : 'rgba(170,178,189,.25)';
        }
      });
    }
    build();
    // Rebuild in the new language whenever i18n switches (it fires this on its first apply too).
    document.addEventListener('frl:lang', build);
    window.addEventListener('load', build);
    window.addEventListener('scroll', light, { passive: true });
  })();

  // ---------------------------------------------------------------- stacking cards
  (function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.card[data-card]'));
    if (!cards.length || reduce) return;
    var raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        for (var i = 0; i < cards.length; i++) {
          var next = cards[i + 1];
          if (!next) { cards[i].style.transform = ''; continue; }
          var nr = next.getBoundingClientRect();
          var cr = cards[i].getBoundingClientRect();
          // As the next card rises over this one, shrink this one a little.
          var span = cr.height;
          var covered = (cr.top + span - nr.top);
          var t = Math.max(0, Math.min(1, covered / span));
          var scale = 1 - t * 0.06;
          cards[i].style.transform = 'scale(' + scale + ')';
        }
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  })();
})();
