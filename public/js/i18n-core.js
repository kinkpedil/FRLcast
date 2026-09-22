/*
 * Indonesian and English, one switch for the whole product.
 *
 * Keyed by the English sentence rather than by an invented id, and the English stays in the
 * HTML. Two reasons, both learned the hard way in other projects.
 *
 * A dictionary of ids means every string exists twice — once in the markup as a key, once
 * in the dictionary as content — and the markup half is unreadable. Worse, it makes the
 * English a translation of itself, so it can drift from what the page actually says.
 *
 * Keying on the sentence removes that: the page is the English, and this file only carries
 * the other language. When somebody edits a sentence and forgets this file, that sentence
 * simply stays English — visibly, on the page, rather than as a missing-key placeholder in
 * front of a visitor. Open any page with ?i18n=debug and the console lists exactly which
 * ones those are.
 *
 * The overlays are deliberately left out. They are read by an audience that never chose a
 * language, and a viewer cannot press a switch on a video.
 */
(function () {
  'use strict';

  var ID = {};
  var KEEP = [];


  var KEY = 'frl.lang';
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
  var ATTRS = ['placeholder', 'alt', 'title', 'aria-label'];

  var originals = new WeakMap();     // text node -> the English it started as
  var attrOriginals = new WeakMap(); // element  -> { attr: English }
  var missing = [];
  /*
   * Everything this dictionary can produce.
   *
   * Code that assembles a sentence from a count and a phrase has to translate as it builds,
   * through t(). The walker then finds that Indonesian in the DOM, cannot find it in a
   * dictionary keyed by English, and reports it as untranslated — ninety false alarms
   * burying the handful that were real. Worse, it caches the Indonesian as the English, so
   * switching back to English left it Indonesian.
   *
   * Knowing its own output solves the first half. The second half is a re-render, which is
   * what the frl:lang event is for.
   */
  var produced = {};
  var titleOriginal = '';
  var descOriginal = '';

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function keep(s) {
    for (var i = 0; i < KEEP.length; i++) if (KEEP[i] === s) return true;
    return false;
  }

  /** Translate, keeping whatever whitespace the original had around it. */
  function swap(original, lang) {
    var body = norm(original);
    if (!body || lang !== 'id') return original;
    // Already this dictionary's own work. Leave it alone and say nothing about it.
    if (produced[body]) return original;

    var hit = ID[body];
    if (!hit) {
      // Worth reporting only when it looks like prose. Numbers, single words that are the
      // same in both, and stray punctuation are noise.
      if (!keep(body) && /[A-Za-z]{3}/.test(body) && body.split(' ').length > 1) {
        if (missing.indexOf(body) < 0) missing.push(body);
      }
      return original;
    }
    var lead = original.match(/^\s*/)[0];
    var tail = original.match(/\s*$/)[0];
    return lead + hit + tail;
  }

  function apply(lang) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.parentNode || SKIP_TAGS[n.parentNode.nodeName]) return NodeFilter.FILTER_REJECT;
        if (n.parentNode.closest && n.parentNode.closest('[data-i18n-skip]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return norm(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    var node;
    while ((node = walker.nextNode())) {
      /*
       * The English is whatever the node held the first time it was seen.
       *
       * Not "whatever it holds now": the dashboard rebuilds its cards on every change, and
       * translating an already-translated node would look up an Indonesian sentence in a
       * dictionary keyed by English, find nothing, and log it as missing for ever.
       */
      var base = originals.has(node) ? originals.get(node) : node.nodeValue;
      if (!originals.has(node)) originals.set(node, base);
      var next = swap(base, lang);
      if (node.nodeValue !== next) node.nodeValue = next;
    }

    var all = document.body.querySelectorAll('[placeholder],[alt],[title],[aria-label]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var store = attrOriginals.get(el);
      if (!store) { store = {}; attrOriginals.set(el, store); }
      for (var a = 0; a < ATTRS.length; a++) {
        var attr = ATTRS[a];
        if (!el.hasAttribute(attr)) continue;
        if (!(attr in store)) store[attr] = el.getAttribute(attr);
        var val = swap(store[attr], lang);
        if (el.getAttribute(attr) !== val) el.setAttribute(attr, val);
      }
    }

    /*
     * The tab title and the description, which live outside <body>.
     *
     * Worth doing rather than skipping: the title is what a bookmark and a search result
     * show, and a page that reads Indonesian under an English title looks half finished.
     */
    if (!titleOriginal) titleOriginal = document.title;
    document.title = swap(titleOriginal, lang);
    var desc = document.querySelector('meta[name="description"]');
    if (desc) {
      if (!descOriginal) descOriginal = desc.getAttribute('content') || '';
      desc.setAttribute('content', swap(descOriginal, lang));
    }

    document.documentElement.lang = lang;
    var buttons = document.querySelectorAll('.langswitch button');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].setAttribute('aria-pressed', buttons[b].dataset.lang === lang ? 'true' : 'false');
    }

    if (new URLSearchParams(location.search).get('i18n') === 'debug' && missing.length) {
      console.warn('[i18n] ' + missing.length + ' string(s) with no Indonesian yet:');
      missing.forEach(function (m) { console.warn('  ' + JSON.stringify(m)); });
    }
  }

  function set(lang) {
    lang = lang === 'id' ? 'id' : 'en';
    try { localStorage.setItem(KEY, lang); } catch (e) { /* private window, fine */ }
    window.FRL_I18N.lang = lang;
    apply(lang);
    /*
     * For content this cannot reach.
     *
     * A line assembled from a number and two words — "12 laps · flag: idle" — has to be
     * translated as it is built, by t(), which means the walker must not touch it: it would
     * cache the Indonesian as the English and switching back would leave it Indonesian.
     * Found exactly that way, on the dashboard, pressing EN. So those places are marked
     * data-i18n-skip and rebuild themselves here instead.
     */
    document.dispatchEvent(new CustomEvent('frl:lang', { detail: lang }));
  }

  function chosen() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'id' || q === 'en') return q;
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === 'id' || saved === 'en') return saved;
    } catch (e) { /* nothing stored, fall through */ }
    // A first visit follows the browser. Somebody reading Indonesian should not have to
    // find a switch before the page makes sense.
    return /^id\b/i.test(navigator.language || '') ? 'id' : 'en';
  }

  function mount() {
    // An explicit slot wins, because the console has a sidebar rather than a header nav and
    // the switch belongs under the brand there, not wherever a selector happens to land.
    var nav = document.querySelector('[data-i18n-mount]') || document.querySelector('.nav');
    if (!nav || nav.querySelector('.langswitch')) return;
    var box = document.createElement('div');
    box.className = 'langswitch';
    box.setAttribute('data-i18n-skip', '');   // ID and EN are the same word in both
    box.innerHTML =
      '<button type="button" data-lang="id" aria-pressed="false">ID</button>'
      + '<button type="button" data-lang="en" aria-pressed="false">EN</button>';
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-lang]');
      if (b) set(b.dataset.lang);
    });
    nav.insertBefore(box, nav.firstChild);
  }

  window.FRL_I18N = {
    lang: chosen(),
    set: set,
    apply: function () { apply(window.FRL_I18N.lang); },
    /**
     * Every English string seen so far with no Indonesian for it.
     *
     * The console logs these under ?i18n=debug, but a console buffer is a poor place to
     * read a list of ninety: it scrolls, it interleaves with everything else, and it cannot
     * be sorted. This hands the same list back as data.
     */
    missing: function () { return missing.slice(); },
    /** For code that builds its own strings. Falls back to the English it was given. */
    t: function (english) {
      return window.FRL_I18N.lang === 'id' ? (ID[norm(english)] || english) : english;
    }
  };

  /**
   * Bring your own dictionary.
   *
   * The engine is shared; the words are not. The public site and the operator console are
   * different bundles with different vocabularies, and making the landing page carry four
   * hundred console strings to translate eight of its own would be a real cost on the one
   * page where load time is visible to a stranger.
   *
   * @param {object} dict  English sentence -> Indonesian
   * @param {Array}  keep  strings that must never be translated
   */
  window.FRL_I18N.install = function (dict, keep) {
    for (var k in dict) if (Object.prototype.hasOwnProperty.call(dict, k)) {
      ID[k] = dict[k];
      produced[norm(dict[k])] = true;
    }
    if (keep) KEEP = KEEP.concat(keep);
    mount();
    apply(window.FRL_I18N.lang);
  };
})();
