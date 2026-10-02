/*
 * Phone menu for the public pages (landing, guides and articles, changelog).
 *
 * On a narrow screen the header nav either disappears (landing) or wraps over three lines
 * (content pages), so below 760px every page gets one burger button that opens the same list
 * of pages. One file for all of them, so the list cannot drift between pages. Labels are
 * picked when the menu opens, from <html lang>, which every page's language switch sets.
 */
(function () {
  var PAGES = [
    ['/', 'Home', 'Beranda'],
    ['/guides', 'Guides', 'Panduan'],
    ['/faq', 'FAQ', 'FAQ'],
    ['/changelog', "What's new", 'Apa yang baru'],
    ['/about', 'About', 'Tentang'],
    ['/contact', 'Contact', 'Kontak'],
    ['/support', 'Support FRLcast', 'Dukung FRLcast'],
    ['/privacy', 'Privacy', 'Privasi']
  ];
  var CTA = ['/dashboard', 'Open the dashboard', 'Buka dashboard'];

  var css = ''
    + '.frlm-btn{display:none;width:40px;height:40px;flex:none;border-radius:10px;border:1px solid rgba(255,255,255,.16);'
    + 'background:rgba(255,255,255,.04);color:#f4f6f8;cursor:pointer;align-items:center;justify-content:center;padding:0}'
    + '.frlm-btn svg{width:20px;height:20px}'
    + '.frlm-btn:focus-visible,.frlm a:focus-visible,.frlm-x:focus-visible{outline:2px solid #00e0a4;outline-offset:2px}'
    + '.frlm{position:fixed;inset:0;z-index:1000;display:none}'
    + '.frlm.open{display:block}'
    + '.frlm-bg{position:absolute;inset:0;background:rgba(5,7,10,.6)}'
    + '.frlm-panel{position:absolute;top:0;right:0;bottom:0;width:min(300px,84vw);background:#0e1116;'
    + 'border-left:1px solid rgba(255,255,255,.10);padding:16px 16px 24px;display:flex;flex-direction:column;overflow-y:auto;'
    + 'transform:translateX(100%);transition:transform .2s ease;font-family:Inter,"Segoe UI",system-ui,sans-serif}'
    + '.frlm.in .frlm-panel{transform:none}'
    + '.frlm-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}'
    + '.frlm-head b{color:#fff;font-size:18px;font-weight:800}'
    + '.frlm-x{width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:none;color:#f4f6f8;'
    + 'font-size:22px;line-height:1;cursor:pointer}'
    + '.frlm nav{display:flex;flex-direction:column}'
    + '.frlm nav a{color:#d6dbe2;text-decoration:none;font-size:16px;padding:13px 10px;border-radius:10px}'
    + '.frlm nav a:hover{background:rgba(255,255,255,.05);text-decoration:none}'
    + '.frlm nav a[aria-current]{color:#00e0a4;background:rgba(0,224,164,.08)}'
    + '.frlm-cta{margin-top:16px;display:block;text-align:center;background:#00e0a4;color:#04120d;font-weight:800;'
    + 'text-decoration:none;padding:13px 16px;border-radius:12px;font-size:15px}'
    + '@media (max-width:760px){.frlm-btn{display:inline-flex}header.site nav{display:none}header.site .langbtns{margin-left:auto}}'
    + '@media (max-width:480px){.hero .nav .pill{display:none}}'
    + '@media (prefers-reduced-motion:reduce){.frlm-panel{transition:none}}';

  function init() {
    // Where the button goes: the content pages' header, the landing nav, the changelog header.
    var host = document.querySelector('header.site') || document.querySelector('.hero .nav')
      || document.querySelector('body > header, .wrap > header, header');
    if (!host || document.querySelector('.frlm-btn')) return;

    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'frlm-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'frlMenu');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    host.appendChild(btn);

    var menu = document.createElement('div');
    menu.className = 'frlm';
    menu.id = 'frlMenu';
    menu.innerHTML = '<div class="frlm-bg"></div><div class="frlm-panel" role="dialog" aria-modal="true">'
      + '<div class="frlm-head"><b>FRLcast</b><button type="button" class="frlm-x">&times;</button></div>'
      + '<nav></nav><a class="frlm-cta"></a></div>';
    document.body.appendChild(menu);

    var nav = menu.querySelector('nav');
    var cta = menu.querySelector('.frlm-cta');
    var close = menu.querySelector('.frlm-x');
    var here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';

    function label() {
      var id = (document.documentElement.lang || '').slice(0, 2) === 'id';
      btn.setAttribute('aria-label', id ? 'Buka menu' : 'Open menu');
      close.setAttribute('aria-label', id ? 'Tutup menu' : 'Close menu');
      nav.setAttribute('aria-label', id ? 'Halaman' : 'Pages');
      nav.innerHTML = PAGES.map(function (p) {
        return '<a href="' + p[0] + '"' + (p[0] === here ? ' aria-current="page"' : '') + '>' + (id ? p[2] : p[1]) + '</a>';
      }).join('');
      cta.href = CTA[0];
      cta.textContent = id ? CTA[2] : CTA[1];
    }

    function open() {
      label();
      menu.classList.add('open');
      requestAnimationFrame(function () { menu.classList.add('in'); });
      btn.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden';
      var first = nav.querySelector('a');
      if (first) first.focus();
    }
    function shut() {
      menu.classList.remove('in', 'open');
      btn.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
      btn.focus();
    }

    btn.addEventListener('click', open);
    close.addEventListener('click', shut);
    menu.querySelector('.frlm-bg').addEventListener('click', shut);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) shut();
    });
    // Back on a wide screen with the menu open (rotating a tablet): close it.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 760 && menu.classList.contains('open')) shut();
    });
    label();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
