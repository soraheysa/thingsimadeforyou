/*
 * Điều ước cho nhau — the page.
 * One shared jar. Tap it to draw one of the other person's wishes (once a day); it becomes yours to
 * make come true. "Thêm điều ước" opens a wish note that folds itself into the jar.
 * "Đã thành hiện thực" needs both of you to tap. The rules live in rules.js and the backend checks them again.
 */
(function () {
  'use strict';

  const A = window.Auth;
  const C = window.HU_CONFIG;
  const R = window.HU_RULES;
  const $ = s => document.querySelector(s);
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const MOCK = A.DEMO;
  const NO_BACKEND = !MOCK && !C.API_URL;
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  const FULL_AT = Math.max(1, Math.min(C.JAR_FULL_AT || 10, 10));
  const REVEAL_S = C.REVEAL_SECONDS || 5;

  const me = { side: A.ls.get('side') || 'right' };
  const other = () => R.otherOf(me.side);
  const word = side => C.SELF[side] || '';        // anh / em

  const state = {
    cards: [], jar: { count: 0, total: 0, drewToday: false }, loaded: false,
    tab: A.ls.get('hu_tab') === 'todo' ? 'todo' : 'wishes',
    sort: { wishes: A.ls.get('hu_sort_wishes') || 'new', todo: A.ls.get('hu_sort_todo') || 'drawn' },
    busy: false,          // a draw or a fold is playing: don't redraw the jar underneath it
    fresh: null, landing: null, jarShown: -1,
    note: null,           // { mode: 'new' | 'edit', id, cat, orig }
  };

  /* ───────── Words and dates ───────── */

  function beneficiary(w) {
    if (w.category === 'self') return w.author;
    if (w.category === 'other') return R.otherOf(w.author);
    return w.category;
  }
  /** Same words on both screens: Luân is always "anh", Thư always "em". */
  function forLabel(b) {
    if (b === 'both') return 'cho 2 đứa mình';
    if (b === 'someone') return 'cho người khác';
    return 'cho ' + word(b);
  }
  const CAT_ORDER = () => [me.side, other(), 'both', 'someone'];

  const SORTS = {
    wishes: [['new', 'Mới thêm nhất'], ['old', 'Cũ nhất'], ['due', 'Có ngày trước'], ['cat', 'Theo loại']],
    todo: [['drawn', 'Mới bốc nhất'], ['new', 'Mới thêm nhất'], ['old', 'Cũ nhất'], ['due', 'Có ngày trước'], ['cat', 'Theo loại'], ['author', 'Theo người ước']],
  };

  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  const today = () => dayKey(new Date());
  function daysBetween(a, b) {   // 'yyyy-mm-dd' → whole days from a to b
    const p = s => { const m = s.split('-'); return Date.UTC(+m[0], +m[1] - 1, +m[2]); };
    return Math.round((p(b) - p(a)) / 86400e3);
  }
  function fmtDue(key) {
    const m = key.split('-');
    return m[2] + '/' + m[1] + (+m[0] !== new Date().getFullYear() ? '/' + m[0] : '');
  }
  function fmtDay(iso, withYear) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + (withYear ? '/' + d.getFullYear() : '');
  }
  function stampDay(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  function hostOf(link) { try { return new URL(link).hostname.replace(/^www\./, ''); } catch (e) { return link; } }
  function untilMidnight() {
    const next = new Date(); next.setHours(24, 0, 0, 0);
    const s = Math.max(0, Math.floor((next - Date.now()) / 1000));
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60);
  }

  /** The day chip on a card, or null. A passed day turns the card grey but it stays doable. */
  function dueInfo(c) {
    if (!c.due || c.status === 'granted' || c.status === 'withdrawn') return null;
    const d = daysBetween(today(), c.due);
    if (d < 0) return { cls: 'late', late: true,
      text: 'Quá hạn từ ' + fmtDue(c.due) + (c.role === 'author' && c.status === 'jar' ? ' · vẫn có thể thành hiện thực' : ' · vẫn làm được') };
    if (d === 0) return { cls: 'soon', text: 'Hôm nay là ngày đó' };
    if (d <= 3) return { cls: 'soon', text: 'Còn ' + d + ' ngày · trước ' + fmtDue(c.due) };
    return { cls: '', text: 'Trước ' + fmtDue(c.due) + ' · còn ' + d + ' ngày' };
  }

  /* ───────── Small helpers ───────── */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /** A yes / no question. Never closes by itself. */
  function ask(title, text, no, yes) {
    const dlg = $('#dlg-ask');
    $('#ask-title').textContent = title;
    $('#ask-text').textContent = text;
    $('#ask-no').textContent = no;
    $('#ask-yes').textContent = yes;
    dlg.showModal();
    return new Promise(res => {
      const done = e => {
        const b = e.target.closest('[data-answer]');
        if (!b) return;
        dlg.removeEventListener('click', done);
        dlg.close();
        res(b.dataset.answer === 'yes');
      };
      dlg.addEventListener('click', done);
      dlg.addEventListener('close', () => res(false), { once: true });
    });
  }

  /* ───────── Backend ───────── */
  async function api(action, payload) {
    if (MOCK) return window.HUMock.handle(Object.assign({ action, tz: TZ }, payload || {}), me.side);
    try {
      const res = await fetch(C.API_URL, {
        method: 'POST',   // no Content-Type header, so Apps Script needs no CORS preflight
        body: JSON.stringify(Object.assign({ action, tz: TZ }, A.credentials(), payload || {})),
        redirect: 'follow',
      });
      if (!res.ok) return { ok: false, error: 'network' };
      const r = await res.json();
      if (r && r.error === 'auth') { A.expired(); return new Promise(() => {}); }
      return r;
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }
  const errText = r => r.message || (r.error === 'network' ? 'Không kết nối được. Kiểm tra mạng rồi thử lại nhé.' : 'Có lỗi xảy ra. Thử lại sau chút nữa nhé.');

  function apply(r, opts) {
    if (!r || !r.cards) return;
    const before = {};
    state.cards.forEach(c => { before[c.id] = c.status; });
    const landed = state.loaded && r.cards.find(c => c.status === 'granted' && before[c.id] && before[c.id] !== 'granted');
    if (landed && !state.landing) state.landing = landed.id;
    state.cards = r.cards;
    state.jar = r.jar || state.jar;
    state.loaded = true;
    render(opts);
  }

  /* ───────── The jar ───────── */
  const JAR_PATH = 'M30 62 Q30 50 42 48 H118 Q130 50 130 62 V176 Q130 192 112 192 H48 Q30 192 30 176 Z';
  const SPOTS = [[32, 164.5, -12], [60, 167.5, 8], [86, 163.5, -18], [44, 144.5, 16], [74, 142.5, -8],
    [28, 123.5, -22], [58, 121.5, 10], [88, 119.5, -6], [42, 99.5, 20], [74, 96.5, -14]];
  const PAPERS = ['#FFFDF9', '#FFF1B8', '#FFE0EE', '#D4F2E0', '#D6E9F8', '#E9E0F7'];
  const SPARK = (x, y, s, fill, delay) =>
    `<path class="tw" style="animation-delay:${delay}s" fill="${fill}" d="M${x} ${y} l${s * .375} ${s} ${s} ${s * .375} -${s} ${s * .375} -${s * .375} ${s} -${s * .375} -${s} -${s} -${s * .375} ${s} -${s * .375}z"/>`;

  /** One big folded slip per wish in the shared jar (both of ours), looking full at FULL_AT. */
  function jarSvg(total, fresh) {
    const n = Math.min(total, FULL_AT);
    let slips = '';
    for (let i = 0; i < n; i++) {
      const p = SPOTS[i];
      slips += `<g transform="translate(${p[0]} ${p[1]}) rotate(${p[2]} 22 11.5)"><g class="${fresh && i === n - 1 ? 'slip-new' : ''}">` +
        `<rect width="44" height="23" rx="3" fill="${PAPERS[i % PAPERS.length]}"/><path d="M22 1 V22" stroke="rgba(42,31,45,.14)"/></g></g>`;
    }
    return `<span class="ring" aria-hidden="true"></span>
      <svg viewBox="0 0 160 200" aria-hidden="true">
        <defs><clipPath id="hu-jar-clip"><path d="${JAR_PATH}"/></clipPath></defs>
        <g class="body">
          <rect x="44" y="38" width="72" height="10" rx="3" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.7)" stroke-width="2"/>
          <g clip-path="url(#hu-jar-clip)" stroke="rgba(42,31,45,.18)" stroke-width="1">${slips}</g>
          <path d="${JAR_PATH}" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.8)" stroke-width="2.4"/>
          <path d="M44 72 V154" stroke="rgba(255,255,255,.5)" stroke-width="4" stroke-linecap="round"/>
        </g>
        <g class="lid">
          <rect x="40" y="18" width="80" height="22" rx="6" fill="#FFE08A" stroke="#C9A23A" stroke-width="1.6"/>
          <rect x="40" y="29" width="80" height="3" fill="#E9C25A"/>
        </g>
        <rect class="rising" x="66" y="58" width="28" height="16" rx="3" fill="#FFF1B8" stroke="#C9A23A" stroke-width="1"/>
        ${SPARK(100, 0, 6, '#FFF1B8', 0)}${SPARK(146, 56, 4, '#FFE0EE', .6)}${SPARK(12, 104, 4, '#FFFDF9', 1.1)}
        ${SPARK(22, 30, 3.2, '#FFFDF9', .3)}${SPARK(150, 150, 3.2, '#FFF1B8', .9)}
      </svg>`;
  }

  function canDraw() { return state.loaded && !state.jar.drewToday && state.jar.count > 0; }

  function renderJar(fresh) {
    const jar = $('#jar');
    if (!state.busy) {
      const total = state.loaded ? state.jar.total : 0;
      if (fresh || total !== state.jarShown) { jar.innerHTML = jarSvg(total, fresh); state.jarShown = total; }
      jar.classList.remove('is-open', 'is-feeding');
      jar.classList.toggle('is-idle', canDraw());
      jar.classList.toggle('is-done', state.loaded && state.jar.drewToday);
      jar.classList.toggle('is-empty', state.loaded && !state.jar.total);
    }
    jar.disabled = !state.loaded || NO_BACKEND;
    renderStage();
  }

  function renderStage() {
    const m = word(me.side), o = word(other());
    const line = $('#stage-line'), sub = $('#stage-sub'), see = $('#btn-see-todo');
    see.hidden = true;
    if (NO_BACKEND) { line.textContent = 'Hũ đang được nối với máy chủ. Đợi anh chút nhé.'; sub.textContent = ''; return; }
    if (!state.loaded) return;
    if (state.busy === 'draw') { line.textContent = 'Đang mở nắp…'; sub.textContent = ''; return; }
    if (state.jar.drewToday) {
      line.textContent = `Hôm nay ${m} bốc rồi`;
      sub.innerHTML = `Lượt mới sau <b id="next-draw">${untilMidnight()}</b>`;
      see.textContent = `Xem điều vừa bốc trong “Việc ${m} làm”`;
      see.hidden = false;
    } else if (!state.jar.count) {
      line.textContent = `Chưa có điều ước nào của ${o} để bốc`;
      sub.textContent = `Đợi ${o} thả thêm vào hũ nhé.`;
    } else {
      line.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5V9a1.5 1.5 0 0 1 3 0v2"/><path d="M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4 15.5a1.6 1.6 0 0 1 2.4-2.1L9 16"/></svg>Chạm vào hũ để bốc một điều ước';
      sub.textContent = 'Mỗi ngày một lần · bốc rồi không trả lại hũ';
    }
  }

  function nope(msg) {
    const jar = $('#jar');
    jar.classList.remove('is-nope'); void jar.offsetWidth; jar.classList.add('is-nope');
    setTimeout(() => jar.classList.remove('is-nope'), 400);
    toast(msg);
  }

  /* ───────── Drawing ───────── */

  async function tapJar() {
    if (state.busy || !state.loaded) return;
    if (state.jar.drewToday) return nope(`Hôm nay ${word(me.side)} bốc rồi. Mai bốc tiếp nhé.`);
    if (!state.jar.count) return nope(`Hũ chưa có điều ước nào của ${word(other())} để bốc.`);
    state.busy = 'draw';
    const jar = $('#jar');
    jar.classList.remove('is-idle');
    jar.classList.add('is-open');
    $('#fab-wrap').classList.add('is-hidden');
    renderStage();
    const [r] = await Promise.all([api('huDraw'), wait(1800)]);
    if (!r.ok) {
      state.busy = false;
      $('#fab-wrap').classList.remove('is-hidden');
      state.jarShown = -1;
      if (r.cards) apply(r); else renderJar();
      toast(errText(r));
      return;
    }
    apply(r);   // lists update now; the jar waits until the box closes
    showReveal(r.drawn);
  }

  let revealTimer = null;
  function showReveal(c) {
    const dlg = $('#dlg-reveal');
    const m = word(me.side), o = word(other());
    $('#reveal-card').innerHTML = cardHtml(c, { bare: true });
    $('#reveal-text').textContent = `Từ giờ đây là việc của ${m}. ${cap(o)} sẽ không biết là điều nào đâu.`;
    dlg.style.setProperty('--reveal-ms', (REVEAL_S * 1000) + 'ms');
    dlg.dataset.id = c.id;
    let left = REVEAL_S;
    const label = () => { $('#reveal-label').textContent = `Cất vào “Việc ${m} làm” · ${left}s`; };
    label();
    dlg.showModal();
    clearInterval(revealTimer);
    revealTimer = setInterval(() => { left -= 1; if (left <= 0) finishDraw(); else label(); }, 1000);
  }

  function finishDraw() {
    const dlg = $('#dlg-reveal');
    clearInterval(revealTimer);
    const id = dlg.dataset.id;
    if (!id) return;
    dlg.dataset.id = '';
    if (dlg.open) dlg.close();
    state.busy = false;
    state.jarShown = -1;
    $('#fab-wrap').classList.remove('is-hidden');
    state.tab = 'todo';
    A.ls.set('hu_tab', 'todo');
    state.fresh = id;
    render();
  }

  /* ───────── Cards ───────── */

  function inTab(c, tab) {
    if (c.role === 'confirmer' && c.status === 'pending') return false;   // shown above, waiting for me
    if (tab === 'todo') return c.assignee === me.side;
    return c.category === 'other' ? c.author !== me.side : c.author === me.side;
  }

  function sortCards(list, key) {
    const rank = c => c.status === 'withdrawn' ? 2 : c.status === 'granted' ? 1 : 0;
    const order = CAT_ORDER();
    const desc = (a, b) => (b || '').localeCompare(a || '');
    const by = {
      new: (a, b) => desc(a.createdAt, b.createdAt),
      old: (a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''),
      drawn: (a, b) => desc(a.drawnAt || a.createdAt, b.drawnAt || b.createdAt),
      due: (a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due || '').localeCompare(b.due || '') || desc(a.createdAt, b.createdAt),
      cat: (a, b) => order.indexOf(beneficiary(a)) - order.indexOf(beneficiary(b)) || desc(a.createdAt, b.createdAt),
      author: (a, b) => (a.author === me.side ? 1 : 0) - (b.author === me.side ? 1 : 0) || desc(a.createdAt, b.createdAt),
    }[key] || ((a, b) => desc(a.createdAt, b.createdAt));
    return list.slice().sort((a, b) =>
      rank(a) - rank(b)
      || (rank(a) === 1 ? desc(a.grantedAt, b.grantedAt) : rank(a) === 2 ? desc(a.drawnAt, b.drawnAt) : by(a, b)));
  }

  function whoLine(c) {
    const parts = [`${cap(word(c.author))} ước · ${fmtDay(c.createdAt)}`];
    if (c.drawnAt && c.assignee) parts.push(`${cap(word(c.assignee))} bốc · ${fmtDay(c.drawnAt)}`);
    return parts.join(' · ');
  }

  function statusLine(c) {
    const o = word(other());
    if (c.status === 'jar') return 'Đang nằm trong hũ';
    if (c.status === 'withdrawn') return `${cap(o)} đã rút lại điều ước này`;
    if (c.status === 'pending' && c.role === 'doer') return `Đang chờ ${o} xác nhận`;
    if (c.status === 'pending' && c.role === 'confirmer') return `${cap(o)} nói điều này đã thành hiện thực`;
    if (c.status === 'todo' && c.category === 'other') return `Việc của ${word(me.side)}, ${o} chưa biết đâu`;
    return '';
  }

  function actions(c) {
    const out = [];
    const id = esc(c.id);
    if (c.role === 'doer' && c.status === 'todo') out.push(`<button class="btn-sm btn-grant" type="button" data-act="grant" data-id="${id}">Đã thành hiện thực</button>`);
    if (c.role === 'doer' && c.status === 'pending') out.push(`<button class="link" type="button" data-act="ungrant" data-id="${id}">Bấm nhầm? Huỷ</button>`);
    if (c.role === 'confirmer' && c.status === 'pending') {
      out.push(`<button class="btn-sm btn-confirm" type="button" data-act="confirm" data-id="${id}">Xác nhận</button>`);
      out.push(`<button class="btn-sm btn-later" type="button" data-act="notyet" data-id="${id}">Chưa đâu</button>`);
    }
    if (c.canEdit) out.push(`<button class="link" type="button" data-act="edit" data-id="${id}">Sửa</button>`);
    if (c.canDelete) out.push(`<button class="link danger" type="button" data-act="delete" data-id="${id}">Xoá</button>`);
    return out.length ? `<div class="wish-actions">${out.join('')}</div>` : '';
  }

  function cardHtml(c, opts) {
    const b = beneficiary(c);
    const status = statusLine(c);
    const due = dueInfo(c);
    const tag = forLabel(b) + (c.recipient ? ' · ' + c.recipient : '');
    const cls = 'wish' + (state.fresh === c.id ? ' is-new' : '') + (due && due.late ? ' is-late' : '');
    return `
      <article class="${cls}" data-id="${esc(c.id)}" data-b="${esc(b)}" data-status="${esc(c.status)}">
        <div class="wish-body">
          <div class="wish-top"><span class="tag">${esc(tag)}</span><span class="wish-who">${esc(whoLine(c))}</span></div>
          <h3 class="wish-title">${esc(c.title)}</h3>
          ${c.note ? `<p class="wish-note">${esc(c.note)}</p>` : ''}
          ${c.link ? `<a class="wish-link" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
              <span>${esc(hostOf(c.link))}</span></a>` : ''}
          ${due ? `<span class="due ${due.cls}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${esc(due.text)}</span>` : ''}
          ${status ? `<p class="wish-status">${esc(status)}</p>` : ''}
          ${opts && opts.bare ? '' : actions(c)}
        </div>
        ${c.status === 'granted' ? `<div class="stamp${state.landing === c.id ? ' is-landing' : ''}" aria-label="Đã thành hiện thực ngày ${esc(fmtDay(c.grantedAt, true))}">Đã thành<br>hiện thực<b>${esc(stampDay(c.grantedAt))}</b></div>` : ''}
      </article>`;
  }

  function emptyText(tab) {
    const m = word(me.side), o = word(other());
    if (tab === 'todo') return `Chưa có việc nào. Những điều ${m} bốc được, và những điều ${m} ước cho ${o}, sẽ nằm ở đây.`;
    return 'Chưa có điều ước nào. Bấm “Thêm điều ước” để thả điều đầu tiên vào hũ.';
  }

  function renderTabs() {
    const m = word(me.side), o = word(other());
    const labels = { wishes: `Điều ${m} ước`, todo: `Việc ${m} làm` };
    $$('#tabs [data-tab]').forEach(btn => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === state.tab));
      btn.textContent = labels[btn.dataset.tab];
    });
    const sel = $('#sort');
    sel.innerHTML = SORTS[state.tab].map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    if (!SORTS[state.tab].some(([k]) => k === state.sort[state.tab])) state.sort[state.tab] = SORTS[state.tab][0][0];
    sel.value = state.sort[state.tab];
    $('#tab-help').textContent = state.tab === 'todo'
      ? `Những điều ${m} bốc được, và những điều ${m} ước cho ${o}. Xong việc nào thì bấm “Đã thành hiện thực”, ${o} xác nhận là được đóng dấu.`
      : `Những điều ${m} thả vào hũ. ${cap(o)} sẽ bốc chúng mà ${m} không biết là điều nào.`;
  }

  function renderConfirm() {
    const list = state.cards.filter(c => c.role === 'confirmer' && c.status === 'pending');
    $('#confirm-zone').hidden = !list.length;
    if (!list.length) return;
    $('#confirm-zone-title').textContent = list.length === 1
      ? `Có một điều ước đang chờ ${word(me.side)} xác nhận`
      : `Có vài điều ước đang chờ ${word(me.side)} xác nhận`;
    $('#confirm-list').innerHTML = list.map(c => cardHtml(c)).join('');
  }

  function renderList() {
    if (!state.loaded) return;
    const list = sortCards(state.cards.filter(c => inTab(c, state.tab)), state.sort[state.tab]);
    $('#list').innerHTML = list.length ? list.map(c => cardHtml(c)).join('') : `<p class="empty">${esc(emptyText(state.tab))}</p>`;
  }

  function render(opts) {
    renderJar(opts && opts.freshJar);
    renderTabs();
    renderConfirm();
    renderList();
    state.fresh = null;
    state.landing = null;
  }

  /* ───────── Granting, editing, deleting ───────── */

  async function act(kind, id) {
    const c = state.cards.find(x => x.id === id);
    if (!c) return;
    const o = word(other());
    if (kind === 'edit') { openNote(c); return; }
    if (kind === 'delete') {
      if (!await ask('Xoá điều ước này?', 'Xoá rồi thì không lấy lại được.', 'Thôi', 'Xoá')) return;
      const r = await api('huDelete', { id });
      if (!r.ok) { toast(errText(r)); if (r.cards) apply(r); return; }
      apply(r);
      toast('Đã xoá điều ước.');
      return;
    }
    if (kind === 'notyet' && !await ask('Chưa thành hiện thực à?', `Điều ước sẽ quay lại danh sách việc của ${o}.`, 'Thôi', 'Chưa đâu')) return;
    $$(`[data-id="${CSS.escape(id)}"] button`).forEach(b => { b.disabled = true; });
    const r = await api(kind === 'grant' || kind === 'confirm' ? 'huGrant' : 'huUngrant', { id });
    if (!r.ok) { toast(errText(r)); if (r.cards) apply(r); else render(); return; }
    if (kind === 'confirm') state.landing = id;
    apply(r);
    if (kind === 'grant') {
      toast(`Đã báo cho ${o}. Đợi ${o} xác nhận là đóng dấu nhé.`);
      if (MOCK) setTimeout(refresh, window.HUMock.AUTO_CONFIRM_MS + 300);
    }
    if (kind === 'confirm') toast('Đóng dấu! Điều ước đã thành hiện thực.');
    if (kind === 'ungrant') toast('Đã huỷ. Điều ước quay lại danh sách việc.');
    if (kind === 'notyet') toast(`Đã báo ${o} là chưa nhé.`);
  }

  /* ───────── The wish note ───────── */

  const FIELDS = { title: 'in-title', note: 'in-note', link: 'in-link', due: 'in-due', recipient: 'in-recipient' };
  const LIMIT = { 'in-title': R.LIMITS.TITLE, 'in-note': R.LIMITS.NOTE, 'in-recipient': R.LIMITS.RECIPIENT, 'in-link': R.LIMITS.LINK };

  function values() {
    const v = { category: state.note.cat };
    Object.keys(FIELDS).forEach(k => { v[k] = document.getElementById(FIELDS[k]).value; });
    return v;
  }
  function isValid(v) { return !!v.category && !!v.title.trim() && (v.category !== 'someone' || !!v.recipient.trim()); }
  function isDirty() {
    const v = values(), o = state.note.orig;
    return Object.keys(v).some(k => String(v[k] || '').trim() !== String(o[k] || '').trim());
  }

  function renderCats() {
    const m = word(me.side), o = word(other());
    const n = state.note;
    const cats = [['self', me.side], ['other', other()], ['both', 'both'], ['someone', 'someone']];
    $('#cat-grid').innerHTML = cats.map(([cat, b]) =>
      `<button type="button" class="cat" data-cat="${cat}" data-b="${b}" aria-pressed="${cat === n.cat}" ${n.mode === 'edit' ? 'disabled' : ''}>${esc(forLabel(b))}</button>`).join('');
    const help = n.mode === 'edit' ? 'Không đổi được loại sau khi đã thêm.'
      : { self: `Vào hũ để ${o} bốc.`, both: `Vào hũ để ${o} bốc.`, someone: `Vào hũ để ${o} bốc.`,
        other: `Không vào hũ. Đây là việc của ${m}; ${o} chỉ thấy khi nó đã thành hiện thực.` }[n.cat] || '';
    $('#cat-help').textContent = help;
    $('#cat-help').hidden = !help;
    $('#field-recipient').hidden = n.cat !== 'someone';
    $('#btn-submit').textContent = n.mode === 'edit' ? 'Lưu' : n.cat === 'other' ? `Thêm vào việc của ${m}` : 'Thả vào hũ';
    updateNote();
  }

  function updateNote() {
    $('#btn-submit').disabled = !isValid(values());
    $('#btn-clear-due').disabled = !$('#in-due').value;
  }

  function openNote(c) {
    const m = word(me.side);
    state.note = { mode: c ? 'edit' : 'new', id: c ? c.id : null, cat: c ? c.category : '' };
    $('#note-title').textContent = c ? 'Sửa điều ước' : 'Thêm điều ước';
    $('#in-title').value = c ? c.title : '';
    $('#in-note').value = c ? c.note : '';
    $('#in-link').value = c ? c.link : '';
    $('#in-recipient').value = c ? c.recipient : '';
    $('#in-due').value = c ? (c.due || '') : '';
    $('#in-note').placeholder = `${cap(m)} có thể mô tả cụ thể điều ${m} muốn ở đây nhé.`;
    $('#due-label').textContent = `${cap(m)} muốn cái này thành hiện thực vào`;
    $('#due-help').textContent = `Nếu có ngày cụ thể thì những điều này sẽ được ưu tiên bốc trước nè. Nếu lỡ lố ngày rồi thì mình vẫn có thể thực hiện cho nhau ${m} nhé.`;
    Object.keys(LIMIT).forEach(id => { document.getElementById(id).maxLength = LIMIT[id]; });
    $('#note-error').textContent = '';
    $$('.field.has-error').forEach(f => f.classList.remove('has-error'));
    state.note.orig = values();
    renderCats();
    const dlg = $('#dlg-note');
    dlg.classList.remove('is-out', 'is-folding');
    if (c) { dlg.showModal(); return; }
    // The button bounces first, then the note rises from it
    const fab = $('#btn-new');
    fab.classList.remove('is-pop'); void fab.offsetWidth; fab.classList.add('is-pop');
    setTimeout(() => { fab.classList.remove('is-pop'); dlg.showModal(); }, 280);
  }

  let closing = false;
  async function tryCloseNote() {
    if (closing || !$('#dlg-note').open) return;
    if (isDirty()) {
      const m = word(me.side);
      const edit = state.note.mode === 'edit';
      const yes = await ask(edit ? 'Bỏ những gì vừa sửa nhé?' : 'Bỏ điều ước này nhé?',
        edit ? `Những gì ${m} vừa sửa sẽ không được lưu đâu.` : `Những gì ${m} vừa viết sẽ không được giữ lại đâu.`,
        'Viết tiếp', 'Bỏ đi');
      if (!yes) return;
    }
    await withdrawNote();
  }

  /** The note slides back down into the button. */
  async function withdrawNote() {
    const dlg = $('#dlg-note');
    closing = true;
    dlg.classList.add('is-out');
    await wait(420);
    dlg.close();
    dlg.classList.remove('is-out');
    closing = false;
    const fab = $('#btn-new');
    fab.classList.remove('is-pop'); void fab.offsetWidth; fab.classList.add('is-pop');
    setTimeout(() => fab.classList.remove('is-pop'), 340);
  }

  async function submitNote(e) {
    e.preventDefault();
    const n = state.note;
    const v = values();
    const showErr = (field, msg) => {
      $('#note-error').textContent = msg;
      $$('.field.has-error').forEach(f => f.classList.remove('has-error'));
      const el = field && FIELDS[field] && document.getElementById(FIELDS[field]);
      if (el) { el.closest('.field').classList.add('has-error'); el.focus(); }
    };
    const chk = R.validate(v, n.mode === 'new');
    if (!chk.ok) return showErr(chk.field, chk.message);
    const rc = R.checkRecipient(v.category, chk.value.recipient);
    if (!rc.ok) return showErr(rc.field, rc.message);

    const btn = $('#btn-submit');
    btn.disabled = true;
    const r = n.mode === 'edit' ? await api('huEdit', Object.assign({ id: n.id }, chk.value)) : await api('huAdd', chk.value);
    if (!r.ok) { updateNote(); showErr(null, errText(r)); if (r.cards) apply(r); return; }

    const m = word(me.side), o = word(other());
    if (n.mode === 'edit') { await withdrawNote(); apply(r); toast('Đã lưu.'); return; }
    if (v.category === 'other') {
      state.tab = 'todo'; A.ls.set('hu_tab', 'todo'); state.fresh = r.id;
      await withdrawNote(); apply(r);
      toast(`Đã thêm vào việc của ${m}. ${cap(o)} chưa thấy đâu.`);
      return;
    }
    state.tab = 'wishes'; A.ls.set('hu_tab', 'wishes'); state.fresh = r.id;
    await foldIntoJar(r);
  }

  /** The note folds into a slip, flies into the jar, the lid lifts, the jar wiggles, a new slip lands. */
  async function foldIntoJar(r) {
    const dlg = $('#dlg-note');
    const jar = $('#jar');
    state.busy = 'fold';
    window.scrollTo({ top: 0, behavior: 'auto' });   // the jar has to be on screen behind the note
    const noteBox = dlg.getBoundingClientRect();
    dlg.classList.add('is-folding');
    await wait(460);
    dlg.close();
    dlg.classList.remove('is-folding');

    const jb = jar.getBoundingClientRect();
    const sx = innerWidth / 2, sy = Math.max(80, noteBox.top + noteBox.height * .4 - 150);
    const ex = jb.left + jb.width / 2, ey = jb.top + jb.height * .21;
    const at = (x, y, s, rot) => `translate(${x - 28}px, ${y - 18}px) scale(${s}) rotate(${rot}deg)`;
    jar.classList.remove('is-idle');
    jar.classList.add('is-feeding');
    const flyer = $('#flyer');
    try {
      await flyer.animate([
        { transform: at(sx, sy, 1.6, -12), opacity: 0 },
        { transform: at(sx + 8, sy - 12, 1.5, -8), opacity: 1, offset: .1 },
        { transform: at(ex + 70, Math.min(sy, ey) - 120, 1.15, 16), opacity: 1, offset: .45 },
        { transform: at(ex, ey - 30, .8, 0), opacity: 1, offset: .8 },
        { transform: at(ex, ey + 30, .5, 0), opacity: 0 },
      ], { duration: 1100, easing: 'cubic-bezier(.4,0,.3,1)' }).finished;
    } catch (e) { /* no Web Animations: skip the flight */ }
    await wait(250);
    state.busy = false;
    state.jarShown = -1;
    apply(r, { freshJar: true });
    toast('Đã thả vào hũ.');
  }

  /* ───────── List colour for the button ───────── */
  function watchStage() {
    const stage = $('#stage');
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(([en]) => {
      document.body.classList.toggle('on-list', en.intersectionRatio < 0.35);
    }, { threshold: [0, 0.35, 0.6] }).observe(stage);
  }

  /* ───────── Loading ───────── */

  async function refresh() {
    if (state.busy || NO_BACKEND || closing) return;
    if ($$('dialog').some(d => d.open)) return;
    const r = await api('huList');
    if (r.ok && !state.busy) apply(r);
  }

  async function loadFirst() {
    const r = await api('huList');
    if (!r.ok) {
      $('#stage-line').textContent = errText(r);
      $('#list').innerHTML = `<p class="empty">${esc(errText(r))} <button class="link" type="button" id="btn-retry">Thử lại</button></p>`;
      $('#btn-retry').addEventListener('click', loadFirst);
      return;
    }
    apply(r);
  }

  function wire() {
    $('#jar').addEventListener('click', tapJar);
    $('#btn-new').addEventListener('click', () => { if (!state.busy) openNote(null); });
    $('#btn-reveal-done').addEventListener('click', finishDraw);
    $('#dlg-reveal').addEventListener('cancel', e => { e.preventDefault(); finishDraw(); });
    $('#btn-see-todo').addEventListener('click', () => {
      state.tab = 'todo'; A.ls.set('hu_tab', 'todo'); render();
      $('#list-area').scrollIntoView({ behavior: 'smooth' });
    });

    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      state.tab = b.dataset.tab;
      A.ls.set('hu_tab', state.tab);
      render();
    });
    $('#sort').addEventListener('change', e => {
      state.sort[state.tab] = e.target.value;
      A.ls.set('hu_sort_' + state.tab, e.target.value);
      renderList();
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) act(b.dataset.act, b.dataset.id);
    });

    const note = $('#dlg-note');
    $('#cat-grid').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (!b || b.disabled) return;
      state.note.cat = b.dataset.cat;
      renderCats();
      if (state.note.cat === 'someone') setTimeout(() => $('#in-recipient').focus(), 30);
    });
    $('#form-note').addEventListener('input', updateNote);
    $('#form-note').addEventListener('submit', submitNote);
    $('#btn-clear-due').addEventListener('click', () => { $('#in-due').value = ''; updateNote(); });
    $('#btn-note-close').addEventListener('click', tryCloseNote);
    note.addEventListener('cancel', e => { e.preventDefault(); tryCloseNote(); });
    note.addEventListener('click', e => { if (e.target === note) tryCloseNote(); });   // tap outside the paper

    if (MOCK) {
      $('#btn-reset').addEventListener('click', async () => {
        if (!await ask('Làm lại dữ liệu giả?', 'Mọi thứ trong bản xem thử quay về như lúc đầu, và được bốc lại hôm nay.', 'Thôi', 'Làm lại')) return;
        state.jarShown = -1;
        apply(await api('huReset'));
        toast('Đã làm lại từ đầu.');
      });
    }

    setInterval(() => {
      const el = document.getElementById('next-draw');
      if (!el) return;
      const t = untilMidnight();
      el.textContent = t;
      if (t === '00:00:00') setTimeout(refresh, 1500);   // a new day: the draw opens again
    }, 1000);
  }

  async function boot() {
    if (MOCK) {
      const banner = $('#preview-banner');
      banner.hidden = false;
      const fit = () => document.documentElement.style.setProperty('--banner-h', banner.offsetHeight + 'px');
      fit(); addEventListener('resize', fit);
    }
    await A.require();
    me.side = A.ls.get('side') || me.side;
    document.body.classList.add('side-' + me.side);
    // Before the release date, only EARLY_SIDES (and preview mode) can come in.
    if (!(MOCK || (C.EARLY_SIDES || []).includes(me.side))) await A.waitForRelease('dieu-uoc-cho-nhau/');
    wire();
    watchStage();
    renderJar();
    renderTabs();
    if (NO_BACKEND) { $('#list').innerHTML = '<p class="empty">Sắp xong rồi.</p>'; return; }
    await loadFirst();
    setInterval(refresh, C.POLL_SECONDS * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  boot();
})();
