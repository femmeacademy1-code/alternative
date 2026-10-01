/* Landing page renderer.
 * Builds the whole page from content.json, so non-developers can edit the site
 * through /admin/ without ever touching this file.
 * In /admin/ the page runs inside a preview iframe (?preview=1) and receives
 * live content via postMessage instead of fetching it.
 */
(function () {
  'use strict';

  var PREVIEW = /[?&]preview=1\b/.test(location.search);
  var app = document.getElementById('app');
  var content = null;
  var vat = false;
  var selectedPhoto = {};

  /* ---------- helpers ---------- */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  // Escapes text and isolates Latin runs (brand names etc.) so they render left-to-right inside Hebrew.
  function rich(s) {
    return String(s == null ? '' : s)
      .split(/([A-Za-z][A-Za-z0-9&.'’ -]*[A-Za-z0-9]|[A-Za-z])/)
      .map(function (p, i) { return i % 2 ? '<span class="ltr">' + esc(p) + '</span>' : esc(p); })
      .join('');
  }

  // data-f marks an element with the content path it edits (preview only).
  function F(path) { return PREVIEW ? ' data-f="' + esc(path) + '"' : ''; }

  function safeId(s) { return String(s == null ? '' : s).replace(/[^\w-]/g, '') || 'model'; }

  function waLink() {
    var c = content.contact || {};
    var d = String(c.whatsapp || '').replace(/\D/g, '');
    if (d.charAt(0) === '0') d = '972' + d.slice(1);
    var url = 'https://wa.me/' + d;
    if (c.whatsappMessage) url += '?text=' + encodeURIComponent(c.whatsappMessage);
    return url;
  }

  function safeUrl(u) { return /^(https?:|mailto:|tel:)/i.test(u) ? u : '#'; }

  /* ---------- icons ---------- */
  var ICONS = window.SITE_ICONS;

  function svg(name, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.check) + '</svg>';
  }

  /* ---------- theme ---------- */
  function hex(v) { return /^#[0-9a-f]{6}$/i.test(v || '') ? v : null; }
  function shade(h, k) {
    var n = parseInt(h.slice(1), 16);
    var ch = [n >> 16, (n >> 8) & 255, n & 255].map(function (c, i) {
      return ('0' + Math.min(255, Math.round(c * k[i])).toString(16)).slice(-2);
    });
    return '#' + ch.join('');
  }
  function applyTheme(t) {
    t = t || {};
    var root = document.documentElement.style;
    var map = { bg: '--c-bg', text: '--c-text', green: '--c-green', brown: '--c-brown', orange: '--c-orange', orangeDark: '--c-orange-deep' };
    Object.keys(map).forEach(function (k) {
      var v = hex(t[k]);
      if (v) root.setProperty(map[k], v); else root.removeProperty(map[k]);
    });
    var bg = hex(t.bg);
    if (bg) root.setProperty('--c-surface', shade(bg, [0.955, 0.945, 0.925]));
    else root.removeProperty('--c-surface');
  }

  /* ---------- sections ---------- */
  function nav(c) {
    var links = [];
    if (c.why && c.why.enabled !== false) links.push(['#why', c.nav.why, 'nav.why']);
    (c.models || []).forEach(function (m, i) { links.push(['#' + safeId(m.id), m.navLabel || m.title, 'models.' + i + '.navLabel']); });
    if (c.included && c.included.enabled !== false) links.push(['#included', c.nav.included, 'nav.included']);
    links.push(['#contact', c.nav.contact, 'nav.contact']);
    return '<nav class="nav">' +
      '<a class="nav-brand" href="' + esc(safeUrl(c.contact.website)) + '"><img src="' + esc(c.nav.logo) + '" alt="Alternative Dream"' + F('nav.logo') + '></a>' +
      '<div class="nav-links">' + links.map(function (l) { return '<a href="' + esc(l[0]) + '"' + F(l[2]) + '>' + esc(l[1]) + '</a>'; }).join('') + '</div>' +
      '<a class="btn btn-primary" href="' + esc(waLink()) + '"' + F('nav.button') + '>' + esc(c.nav.button) + '</a>' +
      '</nav>';
  }

  function hero(c) {
    var h = c.hero;
    return '<section class="hero"><div>' +
      '<h1' + F('hero.title') + '>' + rich(h.title) + '</h1>' +
      '<h2 class="muted"' + F('hero.subtitle') + '>' + rich(h.subtitle) + '</h2>' +
      '<div class="row">' +
      '<a class="btn btn-primary" href="' + esc(waLink()) + '"' + F('hero.primaryCta') + '>' + esc(h.primaryCta) + '</a>' +
      '<a class="btn btn-ghost" href="#' + safeId((c.models[0] || {}).id) + '"' + F('hero.secondaryCta') + '>' + esc(h.secondaryCta) + '</a>' +
      '</div></div>' +
      '<figure class="hero-fig washed"><img src="' + esc(h.image) + '" alt="' + esc(h.imageAlt) + '"' + F('hero.image') + '></figure>' +
      '</section>';
  }

  function why(c) {
    var w = c.why;
    if (!w || w.enabled === false) return '';
    return '<section class="sec" id="why">' +
      '<span class="kicker"' + F('why.kicker') + '>' + esc(w.kicker) + '</span>' +
      '<h2 class="sec-title"' + F('why.title') + '>' + rich(w.title) + '</h2>' +
      '<div class="why">' + (w.items || []).map(function (it, i) {
        return '<div class="why-item"><span class="dot"' + F('why.items.' + i + '.icon') + '>' + svg(it.icon, 26) + '</span>' +
          '<h3' + F('why.items.' + i + '.title') + '>' + rich(it.title) + '</h3>' +
          '<p class="muted"' + F('why.items.' + i + '.text') + '>' + esc(it.text) + '</p></div>';
      }).join('') + '</div>' +
      (w.shipping ? '<div class="ship"' + F('why.shipping') + '>' + svg('truck', 20) + esc(w.shipping) + '</div>' : '') +
      '</section>';
  }

  function catalogHead(c) {
    var k = c.catalog;
    return '<section class="sec" style="padding-bottom:0">' +
      '<span class="kicker"' + F('catalog.kicker') + '>' + esc(k.kicker) + '</span>' +
      '<h2 class="sec-title"' + F('catalog.title') + '>' + rich(k.title) + '</h2>' +
      '<p class="muted" style="margin:0"' + F('catalog.subtitle') + '>' + esc(k.subtitle) + '</p>' +
      (k.vatEnabled ? '<div class="vat"><span' + F('catalog.vatLabel') + '>' + esc(k.vatLabel) + '</span>' +
        '<div class="seg" role="radiogroup" aria-label="מע״מ">' +
        '<label class="seg-opt"><input type="radio" name="vat" value="0"' + (vat ? '' : ' checked') + '>' + esc(k.vatOff) + '</label>' +
        '<label class="seg-opt"><input type="radio" name="vat" value="1"' + (vat ? ' checked' : '') + '>' + esc(k.vatOn) + '</label>' +
        '</div></div>' : '') +
      '</section>';
  }

  function formatPrice(p) {
    var k = content.catalog;
    var n = Number(String(p).replace(/[^\d.]/g, '')) || 0;
    if (k.vatEnabled && vat) n = n * (1 + (Number(k.vatRate) || 0) / 100);
    return '₪' + Math.round(n).toLocaleString('en-US');
  }

  function sizeCard(s, mi, si) {
    var k = content.catalog, L = k.specLabels || {};
    var base = 'models.' + mi + '.sizes.' + si + '.';
    var rows = [['diameter', s.diameter], ['height', s.height], ['weight', s.weight], ['capacity', s.capacity, 'cap']]
      .filter(function (r) { return r[1]; })
      .map(function (r) { return '<div' + (r[2] ? ' class="cap"' : '') + '><dt>' + esc(L[r[0]]) + '</dt><dd' + F(base + r[0]) + '>' + esc(r[1]) + '</dd></div>'; })
      .join('');
    var note = k.vatEnabled ? '<span class="muted">' + esc(vat ? k.noteIncl : k.noteExcl) + '</span>' : '';
    var name = String(s.name || '');
    var badge = name.split(/\s+/).pop();
    return '<article class="scard"><span class="sz">' + esc(badge) + '</span>' +
      '<h3' + F(base + 'name') + '>' + esc(name) + '</h3><dl>' + rows + '</dl>' +
      '<div class="price"><b' + F(base + 'price') + '>' + esc(formatPrice(s.price)) + '</b>' + note + '</div></article>';
  }

  function model(m, i) {
    var photos = m.photos || [];
    var sel = Math.min(selectedPhoto[m.id] || 0, Math.max(photos.length - 1, 0));
    var p = 'models.' + i + '.';
    var head = '<div class="m-head"><span class="kicker"' + F(p + 'kicker') + '>' + esc(m.kicker) + '</span>' +
      '<h2 class="sec-title"' + F(p + 'title') + '>' + rich(m.title) + '</h2>' +
      '<p class="muted" style="margin:0"' + F(p + 'subtitle') + '>' + esc(m.subtitle) + '</p>' +
      '<ul class="features">' + (m.features || []).map(function (f, j) { return '<li' + F(p + 'features.' + j) + '>' + esc(f) + '</li>'; }).join('') + '</ul></div>';
    var cards = '<div class="cards">' + (m.sizes || []).map(function (s, j) { return sizeCard(s, i, j); }).join('') + '</div>';
    var fit = (m.fit && m.fit.length) || m.fitTitle ?
      '<div class="fit"><h4' + F(p + 'fitTitle') + '>' + esc(m.fitTitle) + '</h4><ul>' +
      (m.fit || []).map(function (f, j) { return '<li' + F(p + 'fit.' + j) + '>' + esc(f) + '</li>'; }).join('') + '</ul></div>' : '';
    var cta = '<a class="btn btn-primary cta" href="' + esc(waLink()) + '"' + F(p + 'cta') + '>' + esc(m.cta) + '</a>';
    var media = photos.length ?
      '<div class="m-media"><figure class="m-fig washed"><img alt="' + esc(m.title) + '" src="' + esc(photos[sel]) + '"' + F(p + 'photos.' + sel) + '></figure>' +
      (photos.length > 1 ? '<div class="thumbs">' + photos.map(function (ph, j) {
        return '<button type="button" aria-label="תמונה ' + (j + 1) + '" aria-pressed="' + (j === sel) + '" data-model="' + esc(m.id) + '" data-i="' + j + '"><img src="' + esc(ph) + '" alt=""></button>';
      }).join('') + '</div>' : '') + '</div>' : '<div class="m-media"></div>';
    return '<section class="model' + (i % 2 ? ' alt' : '') + '" id="' + esc(safeId(m.id)) + '">' + media + '<div class="m-body">' + head + cards + fit + cta + '</div></section>';
  }

  function included(c) {
    var n = c.included;
    if (!n || n.enabled === false) return '';
    return '<section class="sec" id="included"><div class="inc"><div>' +
      '<span class="kicker"' + F('included.kicker') + '>' + esc(n.kicker) + '</span>' +
      '<h2 class="sec-title"' + F('included.title') + '>' + rich(n.title) + '</h2><ul>' +
      (n.items || []).map(function (t, i) { return '<li' + F('included.items.' + i) + '>' + svg('check', 22) + esc(t) + '</li>'; }).join('') +
      '</ul></div>' +
      '<figure class="inc-fig washed"><img src="' + esc(n.image) + '" alt="' + esc(n.imageAlt) + '"' + F('included.image') + '></figure>' +
      '</div></section>';
  }

  function banner(c) {
    var b = c.banner;
    if (!b || b.enabled === false) return '';
    return '<section style="padding-bottom:calc(1*var(--lead))"><div class="patch"><div>' +
      '<h3' + F('banner.title') + '>' + rich(b.title) + '</h3><p class="muted"' + F('banner.text') + '>' + esc(b.text) + '</p></div>' +
      '<a class="btn btn-primary" href="' + esc(waLink()) + '"' + F('banner.cta') + '>' + esc(b.cta) + '</a></div></section>';
  }

  function footer(c) {
    var f = c.footer, k = c.contact;
    return '<footer id="contact"><div>' +
      '<p class="brand"' + F('footer.brand') + '>' + rich(f.brand) + '</p>' +
      '<p class="muted"' + F('footer.tagline') + '>' + esc(f.tagline) + '</p>' +
      '<p><strong' + F('footer.contactTitle') + '>' + esc(f.contactTitle) + '</strong><br>' +
      '<a class="ltr" href="tel:' + esc(String(k.phone).replace(/[^\d+]/g, '')) + '"' + F('contact.phone') + '>' + esc(k.phone) + '</a> · ' +
      '<a class="ltr" href="mailto:' + esc(k.email) + '"' + F('contact.email') + '>' + esc(k.email) + '</a></p>' +
      '<p class="muted"' + F('contact.hours') + '>' + esc(k.hours) + '</p></div>' +
      (f.logo ? '<img src="' + esc(f.logo) + '" alt=""' + F('footer.logo') + '>' : '') +
      '</footer>';
  }

  function fab(c) {
    var b = c.floatingButton;
    if (!b || b.enabled === false) return '';
    return '<a class="btn btn-primary fab" href="' + esc(waLink()) + '"' + F('floatingButton.text') + '>' + svg('whatsapp', 18) + esc(b.text) + '</a>';
  }

  /* ---------- render ---------- */
  function render(c) {
    content = c;
    applyTheme(c.theme);
    if (c.meta) {
      document.title = c.meta.title || document.title;
      var d = document.querySelector('meta[name="description"]');
      if (!d) { d = document.createElement('meta'); d.name = 'description'; document.head.appendChild(d); }
      d.content = c.meta.description || '';
    }
    var scroll = window.scrollY;
    app.innerHTML = nav(c) +
      '<div class="wrap">' + hero(c) + why(c) + catalogHead(c) + (c.models || []).map(model).join('') +
      included(c) + banner(c) + footer(c) + '</div>' + fab(c);
    if (PREVIEW) window.scrollTo(0, scroll);
  }

  /* ---------- events (delegated, survive re-render) ---------- */
  app.addEventListener('change', function (e) {
    if (e.target.name === 'vat') { vat = e.target.value === '1'; render(content); }
  });
  app.addEventListener('click', function (e) {
    var b = e.target.closest('.thumbs button');
    if (!b) return;
    var m = (content.models || []).filter(function (x) { return x.id === b.dataset.model; })[0];
    if (!m) return;
    selectedPhoto[m.id] = +b.dataset.i;
    var sec = b.closest('.model');
    sec.querySelector('.m-fig img').src = m.photos[+b.dataset.i];
    sec.querySelectorAll('.thumbs button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
  });

  /* ---------- boot ---------- */
  function fail() {
    app.innerHTML = '<p style="padding:40px;text-align:center;font-size:18px">לא ניתן לטעון את תוכן הדף כרגע. נסו לרענן.</p>';
  }

  if (PREVIEW) {
    var st = document.createElement('style');
    st.textContent = '[data-f]{cursor:pointer}[data-f]:hover{outline:2px dashed #c46a2f;outline-offset:3px}';
    document.head.appendChild(st);
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'content') return;
      render(e.data.content);
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('.thumbs button, input, .seg-opt')) return;
      var el = e.target.closest('[data-f]');
      if (el) {
        e.preventDefault();
        parent.postMessage({ type: 'focus', path: el.dataset.f }, location.origin);
      } else if (e.target.closest('a')) {
        e.preventDefault();
      }
    }, true);
    parent.postMessage({ type: 'ready' }, location.origin);
  } else {
    fetch('content.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(render)
      .catch(fail);
  }
})();
