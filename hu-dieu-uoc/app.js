/*
 * Hũ điều ước — the page.
 * Each person drops wishes into a jar. Once a day you can draw one of the other person's wishes;
 * it becomes yours to make come true. "Đã thành hiện thực" needs both of you to tap.
 * The rules (who sees what) are in rules.js and enforced again by the backend.
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

  const MOCK = A.DEMO;
  const NO_BACKEND = !MOCK && !C.API_URL;
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();

  const me = { side: A.ls.get('side') || 'right' };
  const other = () => R.otherOf(me.side);
  const word = side => C.SELF[side] || '';        // anh / em
  const nameOf = side => C.NAMES[side] || '';

  const state = {
    cards: [], jar: { count: 0, drewToday: false }, loaded: false,
    tab: A.ls.get('hu_tab') === 'todo' ? 'todo' : 'wishes',
    sort: { wishes: A.ls.get('hu_sort_wishes') || 'new', todo: A.ls.get('hu_sort_todo') || 'drawn' },
    editing: null, category: 'self', busy: false, fresh: null, landing: null,
  };

  /* ───────── Words ───────── */

  /** Who a wish is for: 'left', 'right', 'both' or 'someone'. */
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
    wishes: [['new', 'Mới thêm nhất'], ['old', 'Cũ nhất'], ['cat', 'Theo loại']],
    todo: [['drawn', 'Mới bốc nhất'], ['new', 'Mới thêm nhất'], ['old', 'Cũ nhất'], ['cat', 'Theo loại'], ['author', 'Theo người ước']],
  };

  function fmtDay(iso, withYear) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + (withYear ? '/' + d.getFullYear() : '');
  }
  function stampDay(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  function hostOf(link) {
    try { return new URL(link).hostname.replace(/^www\./, ''); } catch (e) { return link; }
  }

  /* ───────── Small helpers ───────── */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  }

  function confirmBox(title, text, yes) {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = yes;
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

  function apply(r) {
    if (!r || !r.cards) return;
    // A wish that just turned "granted" (the other person confirmed) gets its stamp pressed on.
    const before = {};
    state.cards.forEach(c => { before[c.id] = c.status; });
    const landed = state.loaded && r.cards.find(c => c.status === 'granted' && before[c.id] && before[c.id] !== 'granted');
    if (landed && !state.landing) state.landing = landed.id;
    state.cards = r.cards;
    state.jar = r.jar || state.jar;
    state.loaded = true;
    render();
  }

  /* ───────── The jar ───────── */

  function jarSvg(count) {
    const papers = ['#FFFDF9', '#FFF1B8', '#FFE0EE', '#D4F2E0', '#D6E9F8', '#E9E0F7'];
    const n = Math.min(count, 18);
    let slips = '';
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 4), col = i % 4;
      const x = 38 + col * 22 + ((i * 7) % 9) - 4 + (row % 2 ? 9 : 0);
      const y = 166 - row * 15 - ((i * 5) % 6);
      const rot = ((i * 47) % 70) - 35;
      slips += `<rect x="${x - 11}" y="${y - 6}" width="22" height="12" rx="2.5" fill="${papers[i % papers.length]}"
        stroke="rgba(42,31,45,.18)" stroke-width="1" transform="rotate(${rot} ${x} ${y})"/>`;
    }
    return `<svg viewBox="0 0 160 196" role="img" aria-label="Hũ điều ước">
      <defs><clipPath id="jar-in"><path d="M30 58 Q30 46 42 44 H118 Q130 46 130 58 V170 Q130 186 112 186 H48 Q30 186 30 170 Z"/></clipPath></defs>
      <rect x="40" y="16" width="80" height="22" rx="6" fill="#FFE08A" stroke="#C9A23A" stroke-width="2"/>
      <rect x="40" y="27" width="80" height="3" fill="#E9C25A"/>
      <rect x="44" y="36" width="72" height="10" rx="3" fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.7)" stroke-width="2"/>
      <g clip-path="url(#jar-in)">${slips}</g>
      <path d="M30 58 Q30 46 42 44 H118 Q130 46 130 58 V170 Q130 186 112 186 H48 Q30 186 30 170 Z"
        fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.78)" stroke-width="3"/>
      <path d="M44 66 V150" stroke="rgba(255,255,255,.55)" stroke-width="5" stroke-linecap="round"/>
      <path d="M44 160 V166" stroke="rgba(255,255,255,.55)" stroke-width="5" stroke-linecap="round"/>
      <path d="M96 0 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" fill="#FFE08A" opacity=".9"/>
      <path d="M146 54 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z" fill="#FFE0EE" opacity=".9"/>
    </svg>`;
  }

  /** Time left until this device's midnight, when a new draw opens. */
  function untilMidnight() {
    const next = new Date();
    next.setHours(24, 0, 0, 0);
    const s = Math.max(0, Math.floor((next - Date.now()) / 1000));
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60);
  }

  function renderJar() {
    const n = state.jar.count;
    $('#jar').innerHTML = jarSvg(state.loaded ? n : 6);
    if (!state.loaded) return;
    const o = word(other());
    $('#jar-line').textContent = n
      ? `Trong hũ đang có ${n} điều ước của ${o}.`
      : `Hũ của ${o} đang trống. Đợi ${o} thả thêm điều ước nhé.`;
    const btn = $('#btn-draw');
    btn.disabled = state.busy || state.jar.drewToday || !n;
    $('#jar-note').innerHTML = state.jar.drewToday
      ? `Hôm nay ${esc(word(me.side))} bốc rồi. Lượt mới sau <b id="next-draw">${untilMidnight()}</b>`
      : n ? 'Mỗi ngày được bốc một lần, bốc rồi không trả lại hũ nhé.' : '';
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
    if (c.role === 'doer' && c.status === 'todo') {
      out.push(`<button class="btn-sm btn-grant" type="button" data-act="grant" data-id="${esc(c.id)}">Đã thành hiện thực</button>`);
    }
    if (c.role === 'doer' && c.status === 'pending') {
      out.push(`<button class="link" type="button" data-act="ungrant" data-id="${esc(c.id)}">Bấm nhầm? Huỷ</button>`);
    }
    if (c.role === 'confirmer' && c.status === 'pending') {
      out.push(`<button class="btn-sm btn-confirm" type="button" data-act="confirm" data-id="${esc(c.id)}">Xác nhận</button>`);
      out.push(`<button class="btn-sm btn-later" type="button" data-act="notyet" data-id="${esc(c.id)}">Chưa đâu</button>`);
    }
    if (c.canEdit) out.push(`<button class="link" type="button" data-act="edit" data-id="${esc(c.id)}">Sửa</button>`);
    if (c.canDelete) out.push(`<button class="link danger" type="button" data-act="delete" data-id="${esc(c.id)}">Xoá</button>`);
    return out.length ? `<div class="wish-actions">${out.join('')}</div>` : '';
  }

  function cardHtml(c, opts) {
    const b = beneficiary(c);
    const status = statusLine(c);
    const tag = forLabel(b) + (c.recipient ? ' · ' + c.recipient : '');
    const landing = state.landing === c.id ? ' is-landing' : '';
    return `
      <article class="wish${state.fresh === c.id ? ' is-new' : ''}" data-id="${esc(c.id)}" data-b="${esc(b)}" data-status="${esc(c.status)}">
        <div class="wish-body">
          <div class="wish-top"><span class="tag">${esc(tag)}</span><span class="wish-who">${esc(whoLine(c))}</span></div>
          <h3 class="wish-title">${esc(c.title)}</h3>
          ${c.note ? `<p class="wish-note">${esc(c.note)}</p>` : ''}
          ${c.link ? `<a class="wish-link" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
              <span>${esc(hostOf(c.link))}</span></a>` : ''}
          ${status ? `<p class="wish-status">${esc(status)}</p>` : ''}
          ${opts && opts.bare ? '' : actions(c)}
        </div>
        ${c.status === 'granted' ? `<div class="stamp${landing}" aria-label="Đã thành hiện thực ngày ${esc(fmtDay(c.grantedAt, true))}">Đã thành<br>hiện thực<b>${esc(stampDay(c.grantedAt))}</b></div>` : ''}
      </article>`;
  }

  function emptyText(tab) {
    const m = word(me.side), o = word(other());
    if (tab === 'todo') return state.jar.count && !state.jar.drewToday
      ? `Chưa có việc nào. Bốc một điều ước của ${o} ở trên nhé.`
      : `Chưa có việc nào. Những điều ${m} bốc được, và những điều ${m} ước cho ${o}, sẽ nằm ở đây.`;
    return `Chưa có điều ước nào. Bấm “Thêm điều ước” để thả điều đầu tiên vào hũ.`;
  }

  function renderTabs() {
    const m = word(me.side);
    const labels = { wishes: `Điều ${m} ước`, todo: `Việc ${m} làm` };
    $$('#tabs [data-tab]').forEach(btn => {
      const t = btn.dataset.tab;
      btn.setAttribute('aria-selected', String(t === state.tab));
      btn.querySelector('[data-label]').textContent = labels[t];
      const open = state.cards.filter(c => inTab(c, t) && c.status !== 'granted' && c.status !== 'withdrawn').length;
      btn.querySelector('[data-count]').textContent = open;
    });
    const sel = $('#sort');
    sel.innerHTML = SORTS[state.tab].map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    if (!SORTS[state.tab].some(([k]) => k === state.sort[state.tab])) state.sort[state.tab] = SORTS[state.tab][0][0];
    sel.value = state.sort[state.tab];
    const o = word(other());
    $('#tab-help').textContent = state.tab === 'todo'
      ? `Những điều ${m} bốc được từ hũ của ${o}, và những điều ${m} ước cho ${o}. Xong việc nào thì bấm “Đã thành hiện thực”, ${o} xác nhận là được đóng dấu.`
      : `Những điều ${m} thả vào hũ. ${cap(o)} sẽ bốc chúng mà ${m} không biết là điều nào.`;
  }

  function renderConfirm() {
    const list = state.cards.filter(c => c.role === 'confirmer' && c.status === 'pending');
    $('#confirm-zone').hidden = !list.length;
    if (!list.length) return;
    $('#confirm-zone-title').textContent = list.length === 1
      ? `Có một điều ước đang chờ ${word(me.side)} xác nhận`
      : `Có ${list.length} điều ước đang chờ ${word(me.side)} xác nhận`;
    $('#confirm-list').innerHTML = list.map(c => cardHtml(c)).join('');
  }

  function renderList() {
    if (!state.loaded) return;
    const list = sortCards(state.cards.filter(c => inTab(c, state.tab)), state.sort[state.tab]);
    $('#list').innerHTML = list.length ? list.map(c => cardHtml(c)).join('') : `<p class="empty">${esc(emptyText(state.tab))}</p>`;
  }

  function render() {
    renderJar();
    renderTabs();
    renderConfirm();
    renderList();
    state.fresh = null;
    state.landing = null;
  }

  /* ───────── Drawing ───────── */

  async function draw() {
    if (state.busy || state.jar.drewToday || !state.jar.count) return;
    state.busy = true;
    const dlg = $('#dlg-draw');
    const slip = $('#slip');
    slip.classList.remove('is-open');
    slip.classList.add('is-waiting');
    $('#jar').classList.add('is-shaking');
    $('#draw-title').textContent = 'Đang bốc…';
    $('#draw-text').textContent = 'Lắc hũ một chút đã.';
    $('#slip-front').innerHTML = '';
    $('#btn-draw-done').hidden = true;
    dlg.showModal();
    const started = Date.now();
    const r = await api('huDraw');
    await new Promise(res => setTimeout(res, Math.max(0, 1400 - (Date.now() - started))));   // let the jar shake a little
    $('#jar').classList.remove('is-shaking');
    slip.classList.remove('is-waiting');
    state.busy = false;
    if (!r.ok) {
      dlg.close();
      if (r.cards) apply(r); else if (r.error === 'drew_today' || r.error === 'empty') refresh();
      toast(errText(r));
      return;
    }
    apply(r);
    const c = r.drawn;
    $('#slip-front').innerHTML = cardHtml(c, { bare: true });
    requestAnimationFrame(() => slip.classList.add('is-open'));
    $('#draw-title').textContent = 'Bốc được rồi!';
    $('#draw-text').textContent = `Từ giờ đây là việc của ${word(me.side)}. ${cap(word(other()))} sẽ không biết là điều nào đâu.`;
    const done = $('#btn-draw-done');
    done.textContent = `Cất vào “Việc ${word(me.side)} làm”`;
    done.hidden = false;
    done.dataset.id = c.id;
    done.focus();
  }

  function finishDraw() {
    const id = $('#btn-draw-done').dataset.id;
    $('#btn-draw-done').dataset.id = '';
    $('#dlg-draw').close();
    state.tab = 'todo';
    A.ls.set('hu_tab', 'todo');
    state.fresh = id;
    render();
    const el = document.querySelector(`#list [data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ───────── Granting ───────── */

  async function act(kind, id) {
    const c = state.cards.find(x => x.id === id);
    if (!c) return;
    const o = word(other());
    if (kind === 'edit') { openCompose(c); return; }
    if (kind === 'delete') {
      if (!await confirmBox('Xoá điều ước này?', 'Xoá rồi thì không lấy lại được.', 'Xoá')) return;
      const r = await api('huDelete', { id });
      if (!r.ok) { toast(errText(r)); if (r.cards) apply(r); return; }
      apply(r);
      toast('Đã xoá điều ước.');
      return;
    }
    if (kind === 'notyet') {
      if (!await confirmBox('Chưa thành hiện thực à?', `Điều ước sẽ quay lại danh sách việc của ${o}.`, 'Chưa đâu')) return;
    }
    $$(`[data-id="${CSS.escape(id)}"] button`).forEach(b => { b.disabled = true; });
    const action = kind === 'grant' || kind === 'confirm' ? 'huGrant' : 'huUngrant';
    const r = await api(action, { id });
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

  /* ───────── Add / edit ───────── */

  const LIMIT = { 'in-title': R.LIMITS.TITLE, 'in-note': R.LIMITS.NOTE, 'in-recipient': R.LIMITS.RECIPIENT, 'in-link': R.LIMITS.LINK };

  function catHelp(cat) {
    const m = word(me.side), o = word(other());
    if (state.editing) return 'Không đổi được loại sau khi đã thêm. Muốn đổi thì xoá rồi thêm lại nhé.';
    return {
      self: `Vào hũ để ${o} bốc.`,
      other: `Không vào hũ. Đây là việc của ${m}; ${o} chỉ thấy khi nó đã thành hiện thực.`,
      both: `Vào hũ để ${o} bốc.`,
      someone: `Vào hũ để ${o} bốc. Ghi tên người nhận ở dưới nhé.`,
    }[cat];
  }

  function renderCats() {
    const cats = [['self', me.side], ['other', other()], ['both', 'both'], ['someone', 'someone']];
    $('#cat-grid').innerHTML = cats.map(([cat, b]) =>
      `<button type="button" class="cat" data-cat="${cat}" data-b="${b}" aria-pressed="${cat === state.category}" ${state.editing ? 'disabled' : ''}>${esc(forLabel(b))}</button>`).join('');
    $('#cat-help').textContent = catHelp(state.category);
    $('#field-recipient').hidden = state.category !== 'someone';
    $('#btn-submit').textContent = state.editing ? 'Lưu' : state.category === 'other' ? `Thêm vào việc của ${word(me.side)}` : 'Thả vào hũ';
  }

  function updateCounters() {
    $$('[data-counter]').forEach(el => {
      const input = document.getElementById(el.dataset.counter);
      const max = LIMIT[input.id];
      el.textContent = input.value.length > max * 0.6 ? `${input.value.length}/${max}` : '';
    });
  }

  function openCompose(c) {
    state.editing = c || null;
    state.category = c ? c.category : 'self';
    $('#compose-title').textContent = c ? 'Sửa điều ước' : 'Thêm điều ước';
    $('#in-title').value = c ? c.title : '';
    $('#in-note').value = c ? c.note : '';
    $('#in-link').value = c ? c.link : '';
    $('#in-recipient').value = c ? c.recipient : '';
    Object.keys(LIMIT).forEach(id => { document.getElementById(id).maxLength = LIMIT[id]; });
    $('#compose-error').textContent = '';
    $$('.field.has-error').forEach(f => f.classList.remove('has-error'));
    renderCats();
    updateCounters();
    $('#dlg-compose').showModal();
    setTimeout(() => $('#in-title').focus(), 60);
  }

  async function submitCompose(e) {
    e.preventDefault();
    const input = {
      category: state.category,
      title: $('#in-title').value, note: $('#in-note').value,
      link: $('#in-link').value, recipient: $('#in-recipient').value,
    };
    const showErr = (field, msg) => {
      $('#compose-error').textContent = msg;
      $$('.field.has-error').forEach(f => f.classList.remove('has-error'));
      const el = field && document.getElementById('in-' + field);
      if (el) { el.closest('.field').classList.add('has-error'); el.focus(); }
    };
    const v = R.validate(input, !state.editing);
    if (!v.ok) { showErr(v.field, v.message); return; }
    const rc = R.checkRecipient(state.category, v.value.recipient);
    if (!rc.ok) { showErr(rc.field, rc.message); return; }

    const btn = $('#btn-submit');
    btn.disabled = true;
    const r = state.editing
      ? await api('huEdit', Object.assign({ id: state.editing.id }, v.value))
      : await api('huAdd', v.value);
    btn.disabled = false;
    if (!r.ok) { showErr(null, errText(r)); if (r.cards) apply(r); return; }
    $('#dlg-compose').close();
    const wasEdit = !!state.editing;
    const cat = state.category;
    state.editing = null;
    if (!wasEdit) {
      state.tab = cat === 'other' ? 'todo' : 'wishes';
      A.ls.set('hu_tab', state.tab);
      state.fresh = r.id;
    }
    apply(r);
    toast(wasEdit ? 'Đã lưu.' : cat === 'other' ? `Đã thêm vào việc của ${word(me.side)}. ${cap(word(other()))} chưa thấy đâu.` : 'Đã thả vào hũ.');
  }

  /* ───────── Loading ───────── */

  async function refresh() {
    if (state.busy || NO_BACKEND) return;
    if ($('#dlg-compose').open || $('#dlg-draw').open || $('#dlg-confirm').open) return;
    const r = await api('huList');
    if (r.ok) apply(r);
  }

  async function loadFirst() {
    const r = await api('huList');
    if (!r.ok) {
      $('#jar-line').textContent = errText(r);
      $('#list').innerHTML = `<p class="empty">${esc(errText(r))} <button class="link" type="button" id="btn-retry">Thử lại</button></p>`;
      $('#btn-retry').addEventListener('click', loadFirst);
      return;
    }
    apply(r);
  }

  function wire() {
    $('#btn-new').addEventListener('click', () => openCompose(null));
    $('#btn-draw').addEventListener('click', draw);
    $('#btn-draw-done').addEventListener('click', finishDraw);
    $('#dlg-draw').addEventListener('cancel', e => { if (state.busy) e.preventDefault(); });

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

    $('#cat-grid').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (!b || b.disabled) return;
      state.category = b.dataset.cat;
      renderCats();
      if (state.category === 'someone') setTimeout(() => $('#in-recipient').focus(), 30);
    });
    $('#form-compose').addEventListener('submit', submitCompose);
    $('#form-compose').addEventListener('input', updateCounters);
    $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    $$('dialog').forEach(d => d.addEventListener('click', e => {
      if (e.target === d && d.id !== 'dlg-draw') d.close();   // tap outside to close
    }));

    if (MOCK) {
      $('#btn-reset').addEventListener('click', async () => {
        if (!await confirmBox('Làm lại dữ liệu giả?', 'Mọi thứ trong bản xem thử quay về như lúc đầu, và được bốc lại hôm nay.', 'Làm lại')) return;
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
    if (MOCK) { $('#preview-banner').hidden = false; document.body.classList.add('is-preview'); }
    await A.require();
    me.side = A.ls.get('side') || me.side;
    // Before the release date, only EARLY_SIDES (and preview mode) can come in.
    if (!(MOCK || (C.EARLY_SIDES || []).includes(me.side))) await A.waitForRelease('hu-dieu-uoc/');
    wire();
    renderJar();
    renderTabs();
    if (NO_BACKEND) {
      $('#jar-line').textContent = 'Hũ đang được nối với máy chủ. Đợi anh chút nhé.';
      $('#list').innerHTML = '<p class="empty">Sắp xong rồi.</p>';
      return;
    }
    await loadFirst();
    setInterval(refresh, C.POLL_SECONDS * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  boot();
})();
