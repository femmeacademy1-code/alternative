/* Content editor: form + live preview + publish to GitHub. */
(function () {
  'use strict';

  var C = window.ADMIN_CONFIG;
  var SCHEMA = window.ADMIN_SCHEMA;
  var ICONS = window.SITE_ICONS;
  var ICON_LABELS = window.SITE_ICON_LABELS;

  var state = {
    gh: null,
    content: null,
    loaded: '',          // JSON of the last published/loaded content (dirty check)
    loadedSha: null,     // sha of content.json when we loaded/published it
    pending: new Map(),  // image path -> {url, base64, uploaded}
    open: new Set(),     // paths of expanded <details>
    active: SCHEMA[0].id,
    previewReady: false,
    liveToken: 0
  };

  /* ---------- tiny helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    Array.prototype.slice.call(arguments, 2).forEach(function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      e.append(c.nodeType ? c : document.createTextNode(c));
    });
    return e;
  }
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) {
    var ks = p.split('.'), last = ks.pop();
    ks.reduce(function (a, k) { return a[k]; }, o)[last] = v;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, isErr ? 6000 : 3500);
  }

  function errText(e) {
    if (e && e.status === 401) return 'קוד הגישה אינו תקין או שפג תוקפו.';
    if (e && e.status === 403) return 'לקוד הגישה אין הרשאת כתיבה לאתר.';
    if (e && e.status === 404) return 'האתר לא נמצא — בדקו שהקוד נוצר עבור הריפו הנכון.';
    if (e && e.message === 'Failed to fetch') return 'אין חיבור לאינטרנט או ש-GitHub אינו זמין.';
    return 'שגיאה: ' + ((e && e.message) || e);
  }

  /* ---------- status chip ---------- */
  var CHIP = {
    clean: 'אין שינויים', dirty: 'יש שינויים שלא פורסמו', publishing: 'מפרסם… האתר יתעדכן בעוד כדקה',
    live: 'האתר מעודכן ✓', slow: 'פורסם — העדכון באתר מתעכב, נסו לרענן בעוד רגע', error: 'הפרסום נכשל'
  };
  function setChip(s) { var c = $('#chip'); c.dataset.s = s === 'slow' ? 'live' : s; c.textContent = CHIP[s]; }
  function isDirty() { return JSON.stringify(state.content) !== state.loaded; }
  function refreshDirty() {
    var d = isDirty();
    $('#publishBtn').disabled = !d;
    $('#discardBtn').disabled = !d;
    var c = $('#chip');
    if (d) setChip('dirty');
    else if (['dirty', 'clean'].indexOf(c.dataset.s) > -1) setChip('clean');
  }
  window.addEventListener('beforeunload', function (e) {
    if (state.content && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- preview ---------- */
  var previewTimer;
  function previewContent() {
    var c = clone(state.content);
    (function walk(o) {
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === 'string') { if (state.pending.has(v)) o[k] = state.pending.get(v).url; }
        else if (v && typeof v === 'object') walk(v);
      });
    })(c);
    return c;
  }
  function sendPreview() {
    var f = $('#frame');
    if (!state.previewReady || !f.contentWindow) return;
    f.contentWindow.postMessage({ type: 'content', content: previewContent() }, location.origin);
  }
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(sendPreview, 120); }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'ready') { state.previewReady = true; sendPreview(); }
    if (e.data.type === 'focus') focusPath(e.data.path);
  });

  function setView(v) {
    document.body.dataset.view = v;
    document.querySelectorAll('.mobile-switch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === v); });
  }
  function focusPath(path) {
    var el = null, p = path;
    while (p) {
      el = document.querySelector('[data-path="' + p.replace(/"/g, '') + '"]');
      if (el) break;
      p = p.indexOf('.') > -1 ? p.slice(0, p.lastIndexOf('.')) : '';
    }
    if (!el) return;
    if (window.matchMedia('(max-width:900px)').matches) setView('edit');
    var panel = el.closest('.panel');
    if (panel) activate(panel.id.slice(6));
    for (var d = el.parentElement; d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1600);
    var inp = el.querySelector('input:not([type=file]),textarea');
    if (inp && !window.matchMedia('(pointer:coarse)').matches) inp.focus({ preventScroll: true });
  }

  /* ---------- change tracking ---------- */
  function changed() {
    refreshDirty();
    schedulePreview();
    document.querySelectorAll('details.item').forEach(function (d) { if (d._upd) d._upd(); });
  }
  function setValue(abs, v) { setPath(state.content, abs, v); changed(); }

  /** Mutates an array in the content, then rebuilds the panel that shows it. */
  function mutate(abs, fn, fromEl) {
    var panel = fromEl.closest('.panel');
    fn(getPath(state.content, abs));
    buildPanel(panel.id.slice(6));
    changed();
  }

  /* ---------- images ---------- */
  function imgSrc(path) {
    if (!path) return '';
    var p = state.pending.get(path);
    if (p) return p.url;
    return /^(https?:|data:|blob:)/.test(path) ? path : '../' + path;
  }

  function processImage(file, f) {
    if (!/^image\//.test(file.type)) return Promise.reject(new Error('הקובץ שנבחר אינו תמונה.'));
    if (file.size > 30e6) return Promise.reject(new Error('התמונה גדולה מדי (מעל 30MB).'));
    var bmpP = window.createImageBitmap ? createImageBitmap(file) : Promise.reject(new Error('x'));
    return bmpP.catch(function () { throw new Error('לא ניתן לקרוא את התמונה. השתמשו בקובץ JPG או PNG.'); }).then(function (bmp) {
      var max = f.maxSize || 1600;
      var sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      var png = !!f.png || (file.type === 'image/png' && !!f.keepPng);
      var ctx = cv.getContext('2d');
      if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(function (res) { cv.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.86); }).then(function (blob) {
        return new Promise(function (res, rej) {
          var r = new FileReader();
          r.onload = function () { res(String(r.result).split(',')[1]); };
          r.onerror = rej;
          r.readAsDataURL(blob);
        }).then(function (b64) {
          var base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
          var path = C.uploadDir + '/' + Date.now().toString(36) + '-' + base + '.' + (png ? 'png' : 'jpg');
          state.pending.set(path, { url: URL.createObjectURL(blob), base64: b64, uploaded: false });
          return path;
        });
      });
    });
  }

  function pickImage(f) {
    return new Promise(function (resolve) {
      var inp = h('input', { type: 'file', accept: 'image/*' });
      inp.addEventListener('change', function () {
        var file = inp.files[0];
        if (!file) return resolve(null);
        toast('מעבד תמונה…');
        processImage(file, f).then(function (p) { resolve(p); }, function (e) { toast(e.message, true); resolve(null); });
      });
      inp.click();
    });
  }

  function imageControl(abs, f, extra) {
    var thumb = h('div', { class: 'thumb' });
    var show = function () { var v = getPath(state.content, abs); thumb.style.backgroundImage = v ? 'url("' + imgSrc(v) + '")' : ''; };
    show();
    var btn = h('button', { type: 'button', class: 'btn small', onclick: function () {
      pickImage(f).then(function (p) { if (p) { setValue(abs, p); show(); } });
    } }, getPath(state.content, abs) ? 'החלפת תמונה' : 'בחירת תמונה');
    return h('div', { class: 'img' }, thumb, h('div', { class: 'col' }, btn, h('small', {}, 'התמונה מוקטנת אוטומטית לטעינה מהירה')), extra);
  }

  /* ---------- field rendering ---------- */
  function toolButtons(arr, i, onMove, onDel, min) {
    var stop = function (fn) { return function (e) { e.preventDefault(); e.stopPropagation(); fn(); }; };
    return h('span', { class: 'tools' },
      h('button', { type: 'button', title: 'הזזה למעלה', disabled: i === 0, onclick: stop(function () { onMove(-1); }) }, '↑'),
      h('button', { type: 'button', title: 'הזזה למטה', disabled: i === arr.length - 1, onclick: stop(function () { onMove(1); }) }, '↓'),
      h('button', { type: 'button', class: 'del', title: 'מחיקה', disabled: arr.length <= (min || 0), onclick: stop(onDel) }, '✕'));
  }
  function move(arr, i, d) { var t = arr[i]; arr[i] = arr[i + d]; arr[i + d] = t; }

  function field(f, prefix) {
    var abs = prefix ? prefix + '.' + f.path : f.path;
    var val = f.path != null ? getPath(state.content, abs) : undefined;
    var wrap, input;

    switch (f.type) {
      case 'text': case 'number': case 'textarea':
        input = f.type === 'textarea'
          ? h('textarea', { rows: f.rows || 3 })
          : h('input', { type: f.type === 'number' ? 'number' : 'text', min: f.min, max: f.max, step: f.step });
        input.value = val == null ? '' : val;
        if (f.ltr) input.dir = 'ltr';
        input.addEventListener('input', function () {
          setValue(abs, f.type === 'number' ? (input.value === '' ? 0 : Number(input.value)) : input.value);
        });
        return h('label', { class: 'field', 'data-path': abs }, h('span', { class: 'lbl' }, f.label), input, f.help && h('span', { class: 'help' }, f.help));

      case 'toggle':
        input = h('input', { type: 'checkbox' });
        input.checked = val !== false;
        input.addEventListener('change', function () { setValue(abs, input.checked); });
        return h('label', { class: 'switch', 'data-path': abs }, input, f.label);

      case 'color':
        input = h('input', { type: 'color' });
        input.value = /^#[0-9a-f]{6}$/i.test(val) ? val : '#000000';
        var code = h('code', {}, input.value);
        input.addEventListener('input', function () { code.textContent = input.value; setValue(abs, input.value); });
        return h('div', { class: 'field', 'data-path': abs }, h('span', { class: 'lbl' }, f.label), h('div', { class: 'color' }, input, code));

      case 'reset':
        return h('button', { type: 'button', class: 'btn small add', onclick: function () {
          setPath(state.content, abs, JSON.parse(state.loaded)[abs.split('.')[0]]);
          changed(); buildPanel(state.active);
        } }, f.label);

      case 'icon':
        wrap = h('div', { class: 'field', 'data-path': abs }, h('span', { class: 'lbl' }, f.label));
        var grid = h('div', { class: 'icons' });
        Object.keys(ICONS).forEach(function (name) {
          var b = h('button', { type: 'button', title: ICON_LABELS[name], 'aria-pressed': val === name }, svgEl(name));
          b.addEventListener('click', function () {
            setValue(abs, name);
            grid.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
          });
          grid.append(b);
        });
        wrap.append(grid);
        return wrap;

      case 'image':
        return h('div', { class: 'field', 'data-path': abs }, h('span', { class: 'lbl' }, f.label), imageControl(abs, f));

      case 'list': return listField(f, abs);
      case 'images': return imagesField(f, abs);
      case 'items': return itemsField(f, abs);

      case 'group':
        var gid = 'g:' + f.title;
        var det = h('details', { class: 'group', open: f.open || state.open.has(gid) },
          h('summary', {}, f.title), h('div', { class: 'group-body' }, fields(f.fields, prefix)));
        det.addEventListener('toggle', function () { det.open ? state.open.add(gid) : state.open.delete(gid); });
        return det;
    }
    return h('span');
  }
  function fields(list, prefix) { return list.map(function (f) { return field(f, prefix); }); }

  function svgEl(name) {
    var s = h('span', { 'aria-hidden': 'true' });
    s.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    return s;
  }

  function listField(f, abs) {
    var arr = getPath(state.content, abs) || [];
    var box = h('div', { class: 'items' });
    arr.forEach(function (v, i) {
      var inp = f.textarea ? h('textarea', { rows: 2 }) : h('input', { type: 'text' });
      inp.value = v;
      inp.addEventListener('input', function () { setValue(abs + '.' + i, inp.value); });
      box.append(h('div', { class: 'row', 'data-path': abs + '.' + i },
        h('div', { class: 'field' }, inp),
        toolButtons(arr, i,
          function (d) { mutate(abs, function (a) { move(a, i, d); }, box); },
          function () { mutate(abs, function (a) { a.splice(i, 1); }, box); }, f.min)));
    });
    return h('div', { class: 'field', 'data-path': abs }, h('span', { class: 'items-label' }, f.label), box,
      h('button', { type: 'button', class: 'btn small add', onclick: function () { mutate(abs, function (a) { a.push(''); }, box); } }, '＋ ' + f.addLabel));
  }

  function imagesField(f, abs) {
    var arr = getPath(state.content, abs) || [];
    var box = h('div', { class: 'items' });
    arr.forEach(function (v, i) {
      var tools = toolButtons(arr, i,
        function (d) { mutate(abs, function (a) { move(a, i, d); }, box); },
        function () { mutate(abs, function (a) { a.splice(i, 1); }, box); });
      box.append(h('div', { class: 'row', 'data-path': abs + '.' + i }, imageControl(abs + '.' + i, f, tools)));
    });
    var add = h('button', { type: 'button', class: 'btn small add', disabled: f.max && arr.length >= f.max, onclick: function () {
      pickImage(f).then(function (p) { if (p) mutate(abs, function (a) { a.push(p); }, box); });
    } }, '＋ ' + f.addLabel);
    return h('div', { class: 'field', 'data-path': abs }, h('span', { class: 'items-label' }, f.label), box, add);
  }

  function itemsField(f, abs) {
    var arr = getPath(state.content, abs) || [];
    var box = h('div', { class: 'items' });
    arr.forEach(function (it, i) {
      var ip = abs + '.' + i;
      var title = h('span', { class: 'item-title' });
      var det = h('details', { class: 'item', 'data-path': ip, open: state.open.has(ip) });
      det._upd = function () {
        var cur = getPath(state.content, ip);
        if (cur) title.textContent = f.itemTitle(cur) || 'פריט ' + (i + 1);
      };
      det._upd();
      det.addEventListener('toggle', function () { det.open ? state.open.add(ip) : state.open.delete(ip); });
      det.append(
        h('summary', {}, h('span', { class: 'chev' }), title, toolButtons(arr, i,
          function (d) { mutate(abs, function (a) { move(a, i, d); }, box); },
          function () {
            if (f.confirmDelete && !confirm('למחוק את "' + (f.itemTitle(it) || 'הפריט') + '" מהאתר?')) return;
            mutate(abs, function (a) { a.splice(i, 1); }, box);
          }, f.min)),
        h('div', { class: 'item-body' }, fields(f.fields, ip)));
      box.append(det);
    });
    var add = h('button', { type: 'button', class: 'btn small add', disabled: f.max && arr.length >= f.max, onclick: function () {
      var d = typeof f.defaults === 'function' ? f.defaults() : clone(f.defaults);
      state.open.add(abs + '.' + arr.length);
      mutate(abs, function (a) { a.push(d); }, box);
    } }, '＋ ' + f.addLabel);
    return h('div', { class: 'field', 'data-path': abs }, h('span', { class: 'items-label' }, f.label), box, add);
  }

  /* ---------- panels / tabs ---------- */
  function buildPanel(id) {
    var sec = SCHEMA.filter(function (s) { return s.id === id; })[0];
    var side = $('#side'), top = side.scrollTop;
    var old = $('#panel-' + id);
    var p = h('section', { class: 'panel', id: 'panel-' + id, hidden: id !== state.active },
      h('h2', {}, sec.title), sec.intro && h('p', { class: 'intro' }, sec.intro), fields(sec.fields, ''));
    if (old) old.replaceWith(p); else $('#panels').append(p);
    side.scrollTop = top;
  }
  function activate(id) {
    state.active = id;
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + id; });
    document.querySelectorAll('#tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.id === id); });
  }
  function buildAll() {
    $('#panels').replaceChildren();
    $('#tabs').replaceChildren();
    SCHEMA.forEach(function (s) {
      $('#tabs').append(h('button', { type: 'button', 'data-id': s.id, 'aria-selected': s.id === state.active, onclick: function () { activate(s.id); $('#side').scrollTop = 0; } }, s.icon + ' ' + s.title));
      buildPanel(s.id);
    });
  }

  /* ---------- validation ---------- */
  function validate() {
    var c = state.content, e = [];
    if (!String(c.hero.title).trim()) e.push('חסרה כותרת ראשית.');
    if (String(c.contact.whatsapp).replace(/\D/g, '').length < 9) e.push('מספר הוואטסאפ אינו תקין.');
    var ids = {};
    c.models.forEach(function (m) {
      if (!String(m.title).trim()) e.push('לאחד הדגמים אין כותרת.');
      if (ids[m.id]) e.push('שני דגמים בעלי אותו מזהה.');
      ids[m.id] = 1;
      m.sizes.forEach(function (s) {
        if (!String(s.name).trim()) e.push('בדגם "' + m.title + '" יש גודל ללא שם.');
        if (!(Number(s.price) >= 0)) e.push('מחיר לא תקין ב"' + s.name + '".');
      });
    });
    return e;
  }

  /* ---------- publish ---------- */
  function usedPending() {
    var json = JSON.stringify(state.content), out = [];
    state.pending.forEach(function (v, path) { if (!v.uploaded && json.indexOf('"' + path + '"') > -1) out.push([path, v]); });
    return out;
  }

  function publish() {
    if (!isDirty()) return;
    var errs = validate();
    if (errs.length) { toast('לא ניתן לפרסם:\n• ' + errs.join('\n• '), true); return; }
    var btn = $('#publishBtn');
    btn.disabled = true; btn.textContent = 'מפרסם…';
    var snapshot = clone(state.content);
    var snapshotJson = JSON.stringify(snapshot);
    var imgs = usedPending();

    state.gh.readFile(C.contentPath).then(function (cur) {
      if (cur && cur.sha !== state.loadedSha &&
        !confirm('מישהו אחר עדכן את האתר בזמן שערכתם.\nלפרסם בכל זאת ולדרוס את העדכון שלהם?')) throw new Error('cancelled');
      var files = [{ path: C.contentPath, text: JSON.stringify(snapshot, null, 2) + '\n' }];
      imgs.forEach(function (p) { files.push({ path: p[0], base64: p[1].base64 }); });
      return state.gh.commit(files, 'עדכון תוכן דרך מערכת העריכה');
    }).then(function (res) {
      state.loaded = snapshotJson;
      state.loadedSha = res.blobs[C.contentPath];
      imgs.forEach(function (p) { p[1].uploaded = true; });
      refreshDirty();
      toast('נשמר בהצלחה! האתר מתעדכן — זה לוקח בדרך כלל כדקה.');
      waitLive(snapshotJson);
    }).catch(function (e) {
      if (e.message === 'cancelled') return refreshDirty();
      setChip('error');
      toast(errText(e), true);
    }).then(function () { btn.textContent = 'פרסום באתר'; btn.disabled = !isDirty(); });
  }

  /** Polls the live site until it serves the content we just published. */
  function waitLive(expectedJson) {
    var token = ++state.liveToken;
    setChip('publishing');
    (async function () {
      var expected = JSON.stringify(JSON.parse(expectedJson));
      for (var i = 0; i < 45; i++) {
        await sleep(i < 3 ? 4000 : 8000);
        if (token !== state.liveToken) return;
        try {
          var r = await fetch('../' + C.contentPath + '?_=' + Date.now(), { cache: 'no-store' });
          if (r.ok && JSON.stringify(await r.json()) === expected) {
            if (token === state.liveToken && !isDirty()) setChip('live');
            return;
          }
        } catch (e) { /* keep polling */ }
      }
      if (token === state.liveToken && !isDirty()) setChip('slow');
    })();
  }

  /* ---------- history ---------- */
  function showHistory() {
    var list = $('#historyList');
    list.replaceChildren(h('li', {}, 'טוען…'));
    $('#historyDlg').showModal();
    state.gh.history(C.contentPath, 20).then(function (commits) {
      list.replaceChildren();
      if (!commits.length) list.append(h('li', {}, 'אין עדיין גרסאות קודמות.'));
      commits.forEach(function (c, i) {
        var d = new Date(c.commit.author.date);
        list.append(h('li', {},
          h('div', {}, d.toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' }) + (i === 0 ? ' · הנוכחית' : ''),
            h('small', {}, (c.author && c.author.login) || c.commit.author.name)),
          i > 0 && h('button', { type: 'button', class: 'btn small', onclick: function () { restore(c.sha); } }, 'טעינה')));
      });
    }).catch(function (e) { list.replaceChildren(h('li', { class: 'error' }, errText(e))); });
  }
  function restore(sha) {
    if (isDirty() && !confirm('השינויים הנוכחיים שלא פורסמו יוחלפו בגרסה הזו. להמשיך?')) return;
    state.gh.readFile(C.contentPath, sha).then(function (f) {
      state.content = JSON.parse(f.text);
      $('#historyDlg').close();
      buildAll(); changed();
      toast('הגרסה נטענה. לחצו "פרסום באתר" כדי להחזיר אותה.');
    }).catch(function (e) { toast(errText(e), true); });
  }

  /* ---------- session ---------- */
  function openEditor() {
    return state.gh.check().then(function () { return state.gh.readFile(C.contentPath); }).then(function (f) {
      if (!f) throw new Error('הקובץ ' + C.contentPath + ' לא נמצא באתר.');
      state.content = JSON.parse(f.text);
      state.loaded = JSON.stringify(state.content);
      state.loadedSha = f.sha;
      $('#login').hidden = true;
      $('#editor').hidden = false;
      buildAll();
      state.previewReady = false;
      $('#frame').src = '../index.html?preview=1';
      setChip('clean');
      refreshDirty();
    });
  }

  function login(token, remember) {
    state.gh = new window.GH(token);
    return openEditor().then(function () {
      try {
        (remember ? localStorage : sessionStorage).setItem('adm_token', token);
        (remember ? sessionStorage : localStorage).removeItem('adm_token');
      } catch (e) { /* storage unavailable */ }
    });
  }
  function logout() {
    if (isDirty() && !confirm('יש שינויים שלא פורסמו. לצאת בכל זאת?')) return;
    try { localStorage.removeItem('adm_token'); sessionStorage.removeItem('adm_token'); } catch (e) { /* ignore */ }
    location.reload();
  }

  /* ---------- wiring ---------- */
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#loginError'), btn = e.target.querySelector('button[type=submit]');
    err.hidden = true; btn.disabled = true; btn.textContent = 'בודק…';
    login($('#token').value.trim(), $('#remember').checked).catch(function (x) {
      err.textContent = errText(x); err.hidden = false;
    }).then(function () { btn.disabled = false; btn.textContent = 'כניסה'; });
  });
  $('#helpBtn').addEventListener('click', function () { $('#helpDlg').showModal(); });
  $('#publishBtn').addEventListener('click', publish);
  $('#historyBtn').addEventListener('click', showHistory);
  $('#logoutBtn').addEventListener('click', logout);
  $('#discardBtn').addEventListener('click', function () {
    if (!confirm('לבטל את כל השינויים שלא פורסמו?')) return;
    state.content = JSON.parse(state.loaded);
    buildAll(); changed();
  });
  document.querySelectorAll('.mobile-switch button').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.v); }); });
  document.querySelectorAll('.preview-bar .seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      $('#frameWrap').dataset.w = b.dataset.w;
      document.querySelectorAll('.preview-bar .seg button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    });
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('#editor').hidden) publish(); }
  });

  /* ---------- start ---------- */
  var saved = null;
  try { saved = localStorage.getItem('adm_token') || sessionStorage.getItem('adm_token'); } catch (e) { /* ignore */ }
  if (saved) {
    login(saved, !!localStorage.getItem('adm_token')).catch(function (e) {
      $('#login').hidden = false;
      var err = $('#loginError'); err.textContent = errText(e); err.hidden = false;
    });
  } else {
    $('#login').hidden = false;
  }
})();
