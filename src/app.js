/*
 * 非常口 — 画面
 * 公開情報（hjg-public）でロック画面を出し、合言葉で暗号データ（hjg-vault）を開いて描画する。
 * 中身はすべて設定ファイル（vault.yaml）から来る。ここには個人情報を書かない。
 */
(function () {
  'use strict';

  var C = window.HJGCore;
  var PUB = JSON.parse(document.getElementById('hjg-public').textContent);
  var VAULT = JSON.parse(document.getElementById('hjg-vault').textContent);
  var L = PUB.labels;
  var root = document.getElementById('root');
  var MASK = '▮▮▮▮▮▮▮▮';

  var state = null; // 解除中だけ存在する

  /* ---------- 小道具 ---------- */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) {
      c.forEach(function (x) { append(el, x); });
      return;
    }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function stamp(d) {
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function isJa(s) { return /[^\x00-\x7f]/.test(s); }

  function telHref(v) {
    var digits = String(v).replace(/[^0-9+#*]/g, '');
    return digits ? 'tel:' + digits : null;
  }

  function groupCode(code) {
    if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
    if (code.length === 8) return code.slice(0, 4) + ' ' + code.slice(4);
    return code;
  }

  function sectionLabels(sections) {
    var map = {};
    sections.forEach(function (s, i) { map[s.id] = pad(i + 1) + ' ' + s.title; });
    return map;
  }

  // [文字](#章id) / [文字](https://…) / [文字](tel:…) だけをリンクにする。[](#章id) は章名になる。
  function inline(text) {
    var out = [];
    var re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      var href = m[2];
      var label = m[1];
      var a = null;
      if (href.charAt(0) === '#') {
        var id = href.slice(1);
        a = h('a', { href: '#sec-' + id }, label || (state && state.labels[id]) || id);
      } else if (/^https?:\/\//i.test(href)) {
        a = h('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }, label || href);
      } else if (/^(tel|mailto):/i.test(href)) {
        a = h('a', { href: href }, label || href.replace(/^\w+:/, ''));
      }
      out.push(a || m[0]);
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  /* ---------- 時計（常時） ---------- */

  function tickClock() {
    var t = stamp(new Date());
    var els = document.querySelectorAll('.clock');
    for (var i = 0; i < els.length; i++) els[i].textContent = t;
  }
  setInterval(tickClock, 1000);

  function topbar(unlocked) {
    return [
      h('div', { class: 'topbar' },
        h('span', { class: 'status' },
          h('span', { class: 'status-dot' + (unlocked ? ' on' : ''), 'aria-hidden': 'true' }),
          unlocked ? L.unlocked : L.locked),
        h('span', { class: 'clock' }, stamp(new Date()))),
      h('div', { class: 'glowline', 'aria-hidden': 'true' })
    ];
  }

  /* ---------- ロック画面 ---------- */

  function chip(k, v) {
    return h('span', { class: 'chip' }, h('span', null, k), v);
  }

  function renderLock(message, isError) {
    state = null;
    root.textContent = '';
    document.title = PUB.title;

    var input = h('input', {
      class: 'pass-input', id: 'pp', type: 'password', autocomplete: 'off',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: '— — — — — —'
    });
    var btn = h('button', { class: 'btn-primary', type: 'submit' }, PUB.lock.button);
    var show = h('input', { type: 'checkbox' });
    show.addEventListener('change', function () { input.type = show.checked ? 'text' : 'password'; });
    var msg = h('div', { class: 'lock-msg' + (isError ? ' err' : ''), role: 'status', 'aria-live': 'polite' }, message || '');
    var kdf = (VAULT.slots && VAULT.slots[0] && VAULT.slots[0].kdf && VAULT.slots[0].kdf.alg) || 'argon2id';

    var form = h('form', { class: 'panel big lock-panel', autocomplete: 'off', novalidate: true },
      h('span', { class: 'c-tr' }), h('span', { class: 'c-bl' }),
      h('div', null,
        h('div', { class: 'lock-label' }, PUB.lock.label),
        h('h1', { class: 'lock-title' }, PUB.title),
        PUB.lock.greeting ? h('div', { class: 'lock-greeting' }, PUB.lock.greeting) : null),
      h('div', { class: 'chips' },
        chip('CIPHER', 'AES-256-GCM'),
        chip('KDF', kdf.toUpperCase()),
        chip('UPDATED', PUB.updated)),
      h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
        h('label', { class: 'pass-label', for: 'pp' }, PUB.lock.passphraseLabel),
        h('div', { class: 'pass-row' }, input, btn),
        h('label', { class: 'check' }, show, PUB.lock.showInput)),
      msg);

    var busy = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy || !input.value) return;
      busy = true;
      btn.disabled = true;
      input.readOnly = true;
      msg.className = 'lock-msg';
      msg.textContent = L.deriving;
      var pass = input.value;
      // 表示を更新してから重い計算に入る
      setTimeout(function () {
        C.unlock(VAULT, pass, function (i, n) {
          if (n > 1) msg.textContent = L.deriving + ' (' + (i + 1) + '/' + n + ')';
        }).then(function (res) {
          pass = null;
          if (!res) {
            busy = false;
            btn.disabled = false;
            input.readOnly = false;
            msg.className = 'lock-msg err';
            msg.textContent = L.denied;
            form.classList.remove('shake');
            void form.offsetWidth;
            form.classList.add('shake');
            input.select();
            return;
          }
          input.value = '';
          renderApp(res.payload.data);
        }, function (err) {
          busy = false;
          btn.disabled = false;
          input.readOnly = false;
          msg.className = 'lock-msg err';
          msg.textContent = 'ERROR: ' + (err && err.message ? err.message : err);
        });
      }, 40);
    });

    root.appendChild(h('div', { class: 'lock-screen' },
      h('div', { class: 'scan', 'aria-hidden': 'true' }),
      topbar(false),
      h('div', { class: 'lock-center' }, form),
      h('div', { class: 'ruler', 'aria-hidden': 'true' })));
    input.focus();
  }

  /* ---------- 秘密の表示・コピー ---------- */

  function secret(value, paintFn) {
    var s = { value: value, shown: false, els: [], btns: [], paint: paintFn || null };
    state.secrets.push(s);
    return s;
  }

  function paint(s) {
    s.els.forEach(function (el) {
      if (s.paint) s.paint(el, s.shown);
      else el.textContent = s.shown ? s.display || s.value : MASK;
    });
    s.btns.forEach(function (b) {
      b.textContent = s.shown ? L.hide : L.show;
      b.setAttribute('aria-pressed', String(s.shown));
    });
  }

  function secretEl(s, tag, cls) {
    var el = h(tag, { class: cls });
    s.els.push(el);
    paint(s);
    return el;
  }

  function toggleBtn(s, what) {
    var b = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', 'aria-label': what ? what + ' ' + L.show : null });
    b.addEventListener('click', function () {
      s.shown = !s.shown;
      paint(s);
    });
    s.btns.push(b);
    paint(s);
    return b;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // http や古いブラウザ向け
    var ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  function copyBtn(getText, what) {
    var b = h('button', { class: 'btn', type: 'button', 'aria-label': what ? what + ' ' + L.copy : null }, L.copy);
    var timer = null;
    b.addEventListener('click', function () {
      copyText(getText()).then(function () {
        b.textContent = L.copied;
        clearTimeout(timer);
        timer = setTimeout(function () { b.textContent = L.copy; }, 1400);
      }, function () {
        b.textContent = '×';
        clearTimeout(timer);
        timer = setTimeout(function () { b.textContent = L.copy; }, 1400);
      });
    });
    return b;
  }

  function hideAll() {
    if (!state) return;
    state.secrets.forEach(function (s) {
      s.shown = false;
      paint(s);
    });
  }

  var toastEl = null;
  var toastTimer = null;
  function toast(text) {
    if (!toastEl) {
      toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1400);
  }

  /* ---------- ブロック ---------- */

  function blockSteps(b) {
    return h('ol', { class: 'b-steps' }, b.items.map(function (t) { return h('li', null, inline(t)); }));
  }

  function blockList(b) {
    return h(b.ordered ? 'ol' : 'ul', { class: 'b-list' }, b.items.map(function (t) { return h('li', null, inline(t)); }));
  }

  function blockContacts(b) {
    return h('div', { class: 'rows' }, b.items.map(function (c) {
      var tel = c.tel ? telHref(c.tel) : null;
      return h('div', { class: 'row contact' },
        h('span', { class: 'c-label' }, c.label),
        h('span', { class: 'c-name' }, c.name),
        c.tel ? (tel ? h('a', { href: tel }, c.tel) : h('span', null, c.tel)) : null,
        c.note ? h('span', { class: 'c-note' }, inline(c.note)) : null);
    }));
  }

  function blockTotp(b) {
    return h('div', { class: 'totp-grid' }, b.items.map(function (item) {
      var t = { item: item, bytes: C.base32Decode(item.secret), step: -1, code: '' };
      t.codeEl = h('button', { class: 'totp-code', type: 'button', title: L.copy, 'aria-label': item.name + ' ' + L.copy }, '--- ---');
      t.codeEl.addEventListener('click', function () {
        if (!t.code) return;
        copyText(t.code).then(function () { toast(item.name + ' ' + L.codeCopied); }, function () {});
      });
      t.tEl = h('span', { class: 'totp-t' }, '');
      t.fill = h('i', null);
      t.gauge = h('span', { class: 'gauge', 'aria-hidden': 'true' }, t.fill);
      state.totps.push(t);
      var s = secret(item.secret);
      s.display = item.secret.match(/.{1,4}/g).join(' ');
      return h('div', { class: 'totp' },
        h('div', { class: 'totp-head' },
          h('span', { class: 'totp-name' }, item.name),
          item.account ? h('span', { class: 'totp-acct' }, item.account) : null),
        h('div', { class: 'totp-code-row' }, t.codeEl, t.tEl),
        t.gauge,
        h('div', { class: 'secret-row' },
          h('span', { class: 'k' }, L.seed),
          secretEl(s, 'code', 'v'),
          h('span', { class: 'btns' },
            toggleBtn(s, item.name),
            copyBtn(function () { return item.secret; }, item.name))));
    }));
  }

  function blockCodes(b) {
    return h('div', { class: 'codes-grid' }, b.items.map(function (g) {
      var s = secret(g.codes.join('\n'), function (el, shown) {
        el.textContent = '';
        g.codes.forEach(function (c, i) {
          el.appendChild(h('span', null, h('span', { class: 'n' }, pad(i + 1)), shown ? c : MASK));
        });
      });
      return h('div', { class: 'codes' },
        h('div', { class: 'codes-head' },
          h('span', { class: 'name' }, g.name),
          h('span', { class: 'count' }, g.codes.length + '件'),
          h('span', { class: 'grow' }),
          toggleBtn(s, g.name),
          copyBtn(function () { return g.codes.join('\n'); }, g.name)),
        secretEl(s, 'div', 'codes-list'),
        g.note ? h('div', { class: 'b-note' }, inline(g.note)) : null);
    }));
  }

  function blockSecret(b) {
    var s = secret(b.text, function (el, shown) {
      el.textContent = shown ? b.text : [MASK, MASK, MASK].join('\n');
    });
    return h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
      h('div', { class: 'secret-head' },
        h('span', { class: 'name' }, b.name),
        h('span', { class: 'grow' }),
        toggleBtn(s, b.name),
        copyBtn(function () { return b.text; }, b.name)),
      secretEl(s, 'pre', 'secret-pre'),
      b.note ? h('div', { class: 'b-note' }, inline(b.note)) : null);
  }

  function fieldValue(f) {
    if (f.type === 'tel') {
      var tel = telHref(f.value);
      return tel ? h('a', { href: tel }, f.value) : f.value;
    }
    if (f.type === 'url' && /^https?:\/\//i.test(f.value)) {
      return h('a', { href: f.value, target: '_blank', rel: 'noopener noreferrer' }, f.value);
    }
    if (f.type === 'email') return h('a', { href: 'mailto:' + f.value }, f.value);
    return f.value;
  }

  function blockEntries(b) {
    return h('div', { class: 'entries' }, b.items.map(function (e) {
      return h('div', { class: 'entry' },
        h('div', { class: 'entry-name' }, e.name),
        e.sub ? h('div', { class: 'entry-sub' }, e.sub) : null,
        e.fields.map(function (f) {
          var cls = 'field' + (f.big ? ' big' : '');
          if (f.secret) {
            var s = secret(f.value);
            var what = e.name + ' ' + f.label;
            return h('div', { class: cls },
              h('span', { class: 'k' }, f.label),
              secretEl(s, 'code', 'v'),
              h('span', { class: 'btns' }, toggleBtn(s, what), copyBtn(function () { return f.value; }, what)));
          }
          return h('div', { class: cls },
            h('span', { class: 'k' }, f.label),
            h('span', { class: 'v' + (isJa(f.value) ? ' jp' : '') }, fieldValue(f)));
        }),
        e.note ? h('div', { class: 'entry-note' }, inline(e.note)) : null);
    }));
  }

  // どのブロックにも title（小見出し）を付けられる
  function renderBlock(b) {
    var body = renderBlockBody(b);
    if (!b.title) return body;
    return h('div', { class: 'b-group' }, h('h3', { class: 'b-title' }, b.title), body);
  }

  function renderBlockBody(b) {
    switch (b.type) {
      case 'steps': return blockSteps(b);
      case 'list': return blockList(b);
      case 'text': return h('p', { class: 'b-text' }, inline(b.text));
      case 'note': return h('div', { class: 'b-note' }, inline(b.text));
      case 'contacts': return blockContacts(b);
      case 'totp': return blockTotp(b);
      case 'codes': return blockCodes(b);
      case 'secret': return blockSecret(b);
      case 'entries': return blockEntries(b);
      default: return null;
    }
  }

  /* ---------- 解除後 ---------- */

  function renderApp(data) {
    state = { secrets: [], totps: [], labels: sectionLabels(data.sections) };
    root.textContent = '';
    window.scrollTo(0, 0);

    var sections = data.sections.map(function (sec, i) {
      var cls = 'panel sec ' + sec.size + ' ' + (i % 2 ? 'even' : 'odd') + ' kind-' + kindOf(sec) +
        (sec.tone === 'warn' ? ' tone-warn' : '') + (sec.emphasis ? ' big emphasis' : '');
      return h('section', { class: cls, id: 'sec-' + sec.id, 'data-id': sec.id, 'aria-labelledby': 'h-' + sec.id },
        h('span', { class: 'sec-mark', 'aria-hidden': 'true' }, pad(i + 1)),
        sec.emphasis ? [h('span', { class: 'c-tr' }), h('span', { class: 'c-bl' })] : null,
        h('h2', { class: 'sec-h', id: 'h-' + sec.id },
          h('span', { class: 'sec-no' }, 'SEC.' + pad(i + 1)),
          h('span', { class: 'sec-title' }, sec.title),
          sec.subtitle ? h('span', { class: 'sec-sub' }, sec.subtitle) : null),
        sec.blocks.map(renderBlock));
    });

    var meterT = state.totps.length ? h('span', { class: 'meter' }, 'T-', h('b', null, ''), 's') : null;
    state.meterT = meterT && meterT.querySelector('b');

    state.tabEls = {};
    var tabs = h('nav', { class: 'tabs', 'aria-label': L.sections },
      data.sections.map(function (sec) {
        var a = h('a', { class: 'tab', href: '#sec-' + sec.id }, state.labels[sec.id]);
        state.tabEls[sec.id] = a;
        return a;
      }));
    var header = h('header', { class: 'app-header' },
      h('span', { class: 'app-title' }, PUB.title),
      h('div', { class: 'app-tools' },
        meterT,
        h('button', { class: 'btn', type: 'button', onclick: hideAll }, L.hideAll),
        h('button', { class: 'btn-primary', type: 'button', onclick: lock }, L.lock + ' ■')));
    var navbar = h('div', { class: 'navbar' },
      tabs,
      h('div', { class: 'navbar-tools' },
        h('button', { class: 'btn-primary btn-mini', type: 'button', onclick: lock, 'aria-label': L.lock }, '■')));
    state.tabsEl = tabs;
    state.header = header;
    state.navbar = navbar;
    state.secEls = sections;
    state.current = '';

    root.appendChild(h('div', { class: 'app ss-' + PUB.ui.sectionStyle },
      topbar(true),
      header,
      navbar,
      h('main', { class: 'sections' }, sections),
      h('footer', { class: 'app-foot' },
        h('div', { class: 'ruler', 'aria-hidden': 'true' }),
        h('p', null, L.updated + ' ' + PUB.updated))));

    document.title = PUB.title + ' — ' + L.unlocked;
    state.timer = setInterval(tick, 250);
    tick();
    updateNav();
  }

  // 章の中身の種類（sectionStyle: meaning の模様に使う）
  //   live   … 刻々と変わる値がある（TOTP）
  //   sealed … 伏せた秘密がある（コード・パスワードなど）
  //   info   … それ以外
  function kindOf(sec) {
    var live = false;
    var sealed = false;
    sec.blocks.forEach(function (b) {
      if (b.type === 'totp') live = true;
      if (b.type === 'codes' || b.type === 'secret') sealed = true;
      if (b.type === 'entries') {
        b.items.forEach(function (e) {
          e.fields.forEach(function (f) { if (f.secret) sealed = true; });
        });
      }
    });
    return live ? 'live' : sealed ? 'sealed' : 'info';
  }

  /* ---------- 今いる章 ---------- */

  var navQueued = false;
  function scheduleNav() {
    if (navQueued) return;
    navQueued = true;
    requestAnimationFrame(function () {
      navQueued = false;
      updateNav();
    });
  }

  function updateNav() {
    if (!state || !state.navbar) return;
    var bar = state.navbar.getBoundingClientRect();
    state.navbar.classList.toggle('stuck', state.header.getBoundingClientRect().bottom <= bar.height);
    var line = bar.bottom + 24;
    var els = state.secEls;
    var cur = [];
    var doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
      // 一番下まで来たら最後の行
      var lastTop = els[els.length - 1].getBoundingClientRect().top;
      cur = els.filter(function (el) { return Math.abs(el.getBoundingClientRect().top - lastTop) < 2; });
    } else {
      els.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top <= line && r.bottom > line) cur.push(el);
      });
      if (!cur.length) {
        if (els[0].getBoundingClientRect().top > line) cur = [];
        else return; // 章と章のすき間：そのまま
      }
    }
    var key = cur.map(function (el) { return el.getAttribute('data-id'); }).join(',');
    if (key === state.current) return;
    state.current = key;
    els.forEach(function (el) { el.classList.toggle('current', cur.indexOf(el) >= 0); });
    var first = null;
    Object.keys(state.tabEls).forEach(function (id) {
      var on = cur.some(function (el) { return el.getAttribute('data-id') === id; });
      var t = state.tabEls[id];
      t.classList.toggle('active', on);
      if (on) {
        t.setAttribute('aria-current', 'true');
        if (!first) first = t;
      } else t.removeAttribute('aria-current');
    });
    // 目次が横にスクロールする幅なら、光っているタブを見える位置へ
    if (first) {
      var tabs = state.tabsEl;
      var left = first.offsetLeft - tabs.offsetLeft;
      if (left < tabs.scrollLeft || left + first.offsetWidth > tabs.scrollLeft + tabs.clientWidth) {
        tabs.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
      }
    }
  }

  window.addEventListener('scroll', scheduleNav, { passive: true });
  window.addEventListener('resize', scheduleNav);

  function tick() {
    if (!state) return;
    var now = Date.now();
    var sec = Math.floor(now / 1000);
    state.totps.forEach(function (t) {
      var p = t.item.period;
      var step = Math.floor(sec / p);
      var remain = p - (sec % p);
      t.tEl.textContent = 'T-' + remain;
      t.fill.style.width = (remain / p * 100) + '%';
      t.gauge.classList.toggle('low', remain <= 5);
      if (step !== t.step) {
        t.step = step;
        C.totp(t.bytes, t.item, now).then(function (code) {
          if (t.step === step) {
            t.code = code;
            t.codeEl.textContent = groupCode(code);
          }
        });
      }
    });
    if (state.meterT) state.meterT.textContent = String(30 - (sec % 30));
  }

  function lock() {
    if (state && state.timer) clearInterval(state.timer);
    state = null;
    window.scrollTo(0, 0);
    renderLock();
  }

  renderLock();
})();
