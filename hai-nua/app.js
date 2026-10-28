(function () {
  'use strict';

  const C = window.APP_CONFIG;
  const DEMO = window.Auth.DEMO;
  const MOODS = Object.fromEntries(C.MOODS.map(m => [m.key, m]));
  const LEVELS = {
    great: { stamp: '大吉', label: 'Đại cát' },
    good: { stamp: '吉', label: 'Cát' },
    small: { stamp: '小吉', label: 'Tiểu cát' },
    future: { stamp: '末吉', label: 'Mạt cát' },
  };
  const CITY = { 'Asia/Ho_Chi_Minh': 'Sài Gòn', 'Asia/Saigon': 'Sài Gòn' };

  // WMO weather codes from Open-Meteo → [day icon, night icon, Vietnamese description]
  const WEATHER = {
    0: ['☀️', '🌙', 'Trời quang'], 1: ['🌤️', '🌙', 'Gần như quang đãng'], 2: ['⛅', '☁️', 'Có mây'], 3: ['☁️', '☁️', 'Nhiều mây'],
    45: ['🌫️', '🌫️', 'Sương mù'], 48: ['🌫️', '🌫️', 'Sương mù đóng băng'],
    51: ['🌦️', '🌧️', 'Mưa phùn nhẹ'], 53: ['🌦️', '🌧️', 'Mưa phùn'], 55: ['🌧️', '🌧️', 'Mưa phùn dày'],
    56: ['🌧️', '🌧️', 'Mưa phùn lạnh buốt'], 57: ['🌧️', '🌧️', 'Mưa phùn lạnh buốt'],
    61: ['🌧️', '🌧️', 'Mưa nhỏ'], 63: ['🌧️', '🌧️', 'Mưa vừa'], 65: ['🌧️', '🌧️', 'Mưa to'],
    66: ['🌧️', '🌧️', 'Mưa băng'], 67: ['🌧️', '🌧️', 'Mưa băng'],
    71: ['🌨️', '🌨️', 'Tuyết nhẹ'], 73: ['🌨️', '🌨️', 'Tuyết rơi'], 75: ['❄️', '❄️', 'Tuyết dày'], 77: ['🌨️', '🌨️', 'Hạt tuyết'],
    80: ['🌦️', '🌧️', 'Mưa rào nhẹ'], 81: ['🌧️', '🌧️', 'Mưa rào'], 82: ['⛈️', '⛈️', 'Mưa rào rất to'],
    85: ['🌨️', '🌨️', 'Mưa tuyết'], 86: ['🌨️', '🌨️', 'Mưa tuyết dày'],
    95: ['⛈️', '⛈️', 'Dông'], 96: ['⛈️', '⛈️', 'Dông kèm mưa đá'], 99: ['⛈️', '⛈️', 'Dông kèm mưa đá'],
  };

  // The tied bow on the red thread, above the shared slip.
  const KNOT_SVG = `
    <svg class="knot-bow" viewBox="0 0 64 54" aria-hidden="true">
      <path d="M32 22 C22 7 5 6 6 18 C7 30 22 30 32 22" />
      <path d="M32 22 C42 7 59 6 58 18 C57 30 42 30 32 22" />
      <path d="M32 22 C28 31 22 40 15 51" />
      <path d="M32 22 C36 31 42 40 49 51" />
      <circle cx="32" cy="22" r="4.5" />
    </svg>`;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /* ───────── Storage ───────── */
  const store = {
    get: k => { try { return localStorage.getItem('hn_' + k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem('hn_' + k, v); } catch (e) { /* private mode */ } },
    del: k => { try { localStorage.removeItem('hn_' + k); } catch (e) { /* private mode */ } },
  };

  /* ───────── API (sign-in is shared by the whole site, see ../shared/auth.js) ───────── */
  const api = (action, payload) => window.Auth.call(action, payload);

  const ERRORS = {
    network: 'Không kết nối được tới nhật ký. Kiểm tra mạng rồi thử lại.',
  };
  const errText = r => ERRORS[r.error] || r.message || 'Có lỗi xảy ra. Thử lại sau chút nữa.';

  /* ───────── Formatting ───────── */
  function fmt(date, tz, opts, locale) {
    try { return new Intl.DateTimeFormat(locale || 'vi-VN', Object.assign({ timeZone: tz }, opts)).format(date); }
    catch (e) { return new Intl.DateTimeFormat(locale || 'vi-VN', opts).format(date); }
  }
  const timeIn = (d, tz) => fmt(d, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateIn = (d, tz) => fmt(d, tz, { weekday: 'long', day: 'numeric', month: 'long' });
  function keyIn(d, tz) {
    let parts;
    try { parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d); }
    catch (e) { parts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d); }
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day;
  }
  const cityOf = p => p.city || CITY[p.timezone] || (p.timezone || '').split('/').pop().replace(/_/g, ' ');
  const dayKeyLabel = k => fmt(new Date(k + 'T12:00:00Z'), 'UTC', { weekday: 'long', day: 'numeric', month: 'long' });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ───────── Toast ───────── */
  let toastTimer;
  function toast(msg) {
    if (!msg) return;
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ───────── Diary ───────── */
  let state = null;
  let pollTimer = null;
  let clockTimer = null;
  let saving = 0;

  const moodOf = key => MOODS[key] || null;
  // Each side has its own colours before a mood is picked (older configs with one shared set still work).
  const noMood = side => (C.NO_MOOD && (C.NO_MOOD[side] || C.NO_MOOD.left)) || C.NO_MOOD;
  const pronounOf = p => (p && p.pronoun) || (p && p.side === 'left' ? 'anh' : 'em');
  const mePerson = () => state.people.find(p => p.isMe) || state.people[0];
  const otherPerson = () => state.people.find(p => !p.isMe) || state.people[0];
  const personBySide = side => state.people.find(p => p.side === side) || otherPerson();
  const you = () => pronounOf(mePerson());

  // A mood label as seen on one person's half: "Nhớ {them}" → "Nhớ em" on Luân's, "Nhớ anh" on Thư's.
  function moodLabel(m, ownerSide) {
    if (!m || !m.label) return '';
    const other = state && state.people.find(p => p.side !== ownerSide);
    const them = other ? pronounOf(other) : (ownerSide === 'left' ? 'em' : 'anh');
    return m.label.replace(/\{them\}/g, them);
  }

  function weatherHTML(w) {
    if (!w || typeof w.tempC !== 'number') return '';
    const info = WEATHER[w.code] || ['🌡️', '🌡️', 'Thời tiết'];
    const icon = w.isDay ? info[0] : info[1];
    return `
      <div class="weather">
        <span class="weather-icon" aria-hidden="true">${icon}</span>
        <span class="weather-temp">${w.tempC}°C</span>
        <span class="weather-desc">${esc(info[2])}<br>Cảm giác ${w.feelsC}°C, gió ${w.windKmh} km/h</span>
      </div>`;
  }

  function enterApp(s) {
    $('#loading').hidden = true;
    $('#app').hidden = false;
    render(s);
    requestAnimationFrame(() => $('#app').classList.add('drawn'));
    startPolling();
  }

  async function refresh() {
    if (saving || document.hidden || !state) return;
    const r = await api('state');
    if (r.ok) render(r.state);
    else if (r.error === 'auth') signedOut();
  }

  function startPolling() {
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    pollTimer = setInterval(refresh, Math.max(15, C.POLL_SECONDS || 45) * 1000);
    clockTimer = setInterval(updateClocks, 20 * 1000);
  }

  function signedOut() {
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    window.Auth.expired();
  }


  function applyTheme(el, mood, side) {
    const t = mood || noMood(side);
    el.style.setProperty('--bg', t.bg);
    el.style.setProperty('--ink', t.ink);
    el.style.setProperty('--soft', t.soft);
  }

  function slipHTML(id, fortune, extraClass) {
    if (!fortune) return '';
    const lv = LEVELS[fortune.level] || LEVELS.good;
    const open = store.get('slip:' + id) === '1';
    return `
      <button type="button" class="slip ${extraClass || ''}" data-slip="${esc(id)}" aria-expanded="${open}">
        <span class="slip-closed">
          <span class="slip-title">Quẻ hôm nay</span>
          <span class="slip-sub">Chạm để mở</span>
        </span>
        <span class="slip-open">
          <span class="slip-stamp" lang="ja">${Array.from(lv.stamp).map(c => `<span>${c}</span>`).join('')}</span>
          <span class="slip-level">${lv.label}</span>
          <span class="slip-text">${esc(fortune.text)}</span>
        </span>
      </button>`;
  }

  function sealedSlipHTML(p) {
    return `
      <div class="slip slip-sealed">
        <span class="slip-closed">
          <span class="slip-title">Quẻ của ${esc(p.name)}</span>
          <span class="slip-sub">${esc(p.name)} đang giữ riêng</span>
        </span>
      </div>`;
  }

  function halfHTML(p, other) {
    const mood = moodOf(p.entry && p.entry.mood);
    const note = (p.entry && p.entry.note) || '';
    const now = new Date();
    const youWord = you();

    const moodNow = mood
      ? `<span class="mood-emoji" aria-hidden="true">${mood.emoji}</span><span class="mood-label">${esc(moodLabel(mood, p.side))}</span>`
      : `<span class="mood-label is-empty">${p.isMe ? 'Hôm nay chưa chọn tâm trạng' : esc(p.name) + ' chưa chọn tâm trạng'}</span>`;

    const picker = p.isMe ? `
      <fieldset class="moods">
        <legend>Hôm nay ${esc(youWord)} thấy thế nào?</legend>
        <div class="mood-grid">
          ${C.MOODS.map(m => `
            <button type="button" class="mood-chip" data-mood="${m.key}" aria-pressed="${!!(mood && mood.key === m.key)}"
              style="--chip:${m.bg};--chip-ink:${m.ink}">
              <span aria-hidden="true">${m.emoji}</span>${esc(moodLabel(m, p.side))}
            </button>`).join('')}
        </div>
      </fieldset>` : '';

    const noteBlock = p.isMe ? `
      <div class="note">
        <label for="note-input">Lời nhắn cho ${esc(other.name)}</label>
        <textarea id="note-input" rows="3" maxlength="${state.noteMax || 280}" placeholder="Một chuyện nhỏ trong ngày">${esc(note)}</textarea>
        <div class="note-foot">
          <span class="counter" id="note-counter">${note.length} / ${state.noteMax || 280}</span>
          <button type="button" class="btn btn-ink btn-sm" id="btn-save-note">Lưu lời nhắn</button>
        </div>
      </div>` : `
      <div class="note">
        <p class="note-heading">${esc(p.name)} nhắn ${esc(youWord)}</p>
        ${note ? `<p class="note-text">${esc(note)}</p>` : `<p class="note-empty">Hôm nay ${esc(p.name)} chưa nhắn gì.</p>`}
      </div>`;

    let slipBlock;
    if (p.isMe) {
      slipBlock = `
        ${slipHTML(p.side + '|' + p.dayKey, p.fortune)}
        <button type="button" class="share-toggle" id="btn-share" aria-pressed="${!!p.fortuneShared}">
          <span class="switch" aria-hidden="true"></span>
          <span>Cho ${esc(other.name)} xem quẻ này</span>
        </button>`;
    } else {
      slipBlock = p.fortune ? slipHTML(p.side + '|' + p.dayKey, p.fortune) : sealedSlipHTML(p);
    }

    return `
      <div class="half-inner">
        <header class="who">
          <h2 class="name">${esc(p.name)}</h2>
          <div class="here-now">
            <p class="clock">
              <span class="clock-time" data-tz="${esc(p.timezone)}" data-clock>${timeIn(now, p.timezone)}</span>
              <span class="clock-date"><span data-tz="${esc(p.timezone)}" data-date>${dateIn(now, p.timezone)}</span> ở ${esc(cityOf(p))}</span>
            </p>
            ${weatherHTML(p.weather)}
          </div>
        </header>
        <p class="mood-now">${moodNow}</p>
        ${picker}
        ${noteBlock}
        <div class="slip-wrap">${slipBlock}</div>
      </div>`;
  }

  function render(s) {
    // Keep an unsaved note while the page refreshes.
    const ta = $('#note-input');
    const keep = ta && (document.activeElement === ta || ta.dataset.dirty === '1')
      ? { value: ta.value, focused: document.activeElement === ta, start: ta.selectionStart, end: ta.selectionEnd, dirty: ta.dataset.dirty }
      : null;

    state = s;
    $$('.app-name').forEach(el => { el.textContent = C.APP_NAME; });

    const me = mePerson();
    s.people.forEach(p => {
      const el = $(`.half[data-side="${p.side}"]`);
      if (!el) return;
      const other = s.people.find(x => x !== p) || p;
      el.setAttribute('aria-label', 'Nửa của ' + p.name);
      el.classList.toggle('is-me', !!p.isMe);
      const theme = moodOf(p.entry && p.entry.mood);
      applyTheme(el, theme, p.side);
      el.innerHTML = halfHTML(p, other);
      $('.halves').style.setProperty(p.side === 'left' ? '--lbg' : '--rbg', (theme || noMood(p.side)).bg);
    });

    const myMood = me && moodOf(me.entry && me.entry.mood);
    $('meta[name=theme-color]').setAttribute('content', (myMood || noMood(me && me.side)).bg);

    $('#couple-slot').innerHTML = KNOT_SVG +
      (s.couple && s.couple.fortune
        ? `<p class="knot-label">Cho hai đứa mình</p>${slipHTML('both|' + s.couple.dayKey, s.couple.fortune, 'slip-couple')}`
        : '');

    if (keep) {
      const t = $('#note-input');
      t.value = keep.value;
      t.dataset.dirty = keep.dirty || '';
      updateCounter();
      if (keep.focused) { t.focus(); t.setSelectionRange(keep.start, keep.end); }
    }

    const waiting = s.plans.filter(p => p.status === 'proposed' && !p.mine).length;
    const badge = $('#plans-badge');
    badge.hidden = !waiting;
    badge.textContent = waiting;
    badge.setAttribute('aria-label', `${waiting} lời rủ đang chờ ${you()} trả lời`);
    $('#plan-when-label').textContent = `Khi nào (giờ của ${you()})`;
    if ($('#dlg-plans').open) renderPlans();
  }

  function updateClocks() {
    const now = new Date();
    $$('[data-clock]').forEach(el => { el.textContent = timeIn(now, el.dataset.tz); });
    $$('[data-date]').forEach(el => { el.textContent = dateIn(now, el.dataset.tz); });
    // A new day started for someone: fetch fresh slips and empty moods.
    if (state && state.people.some(p => keyIn(now, p.timezone) !== p.dayKey)) refresh();
  }

  function updateCounter() {
    const t = $('#note-input');
    const c = $('#note-counter');
    if (t && c) c.textContent = `${t.value.length} / ${state.noteMax || 280}`;
  }

  async function saveEntry(fields, okMsg) {
    saving++;
    const r = await api('saveEntry', fields);
    saving--;
    if (r.ok) {
      const t = $('#note-input');
      if (t && fields.note !== undefined) t.dataset.dirty = '';
      render(r.state);
      toast(okMsg);
    } else if (r.error === 'auth') {
      signedOut();
    } else {
      toast(errText(r));
      const back = await api('state');
      if (back.ok) render(back.state);
    }
    return r.ok;
  }

  // Change the screen straight away, then save in the background.
  function optimistic(change) {
    const noteNow = $('#note-input') ? $('#note-input').value : null;
    const dirty = $('#note-input') ? $('#note-input').dataset.dirty : '';
    change(mePerson());
    render(state);
    const t = $('#note-input');
    if (noteNow !== null && t) { t.value = noteNow; t.dataset.dirty = dirty; updateCounter(); }
  }

  function pickMood(key) {
    const mood = moodOf(key);
    optimistic(me => { me.entry = Object.assign({}, me.entry || { note: '' }, { mood: key }); });
    saveEntry({ mood: key }, mood ? 'Đã lưu tâm trạng: ' + moodLabel(mood, mePerson().side) : '');
  }

  function toggleShare() {
    const me = mePerson();
    const share = !me.fortuneShared;
    optimistic(m => { m.fortuneShared = share; });
    saveEntry({ shareFortune: share },
      share ? `Đã cho ${otherPerson().name} xem quẻ hôm nay.` : `Đã giữ quẻ hôm nay cho riêng ${you()}.`);
  }

  /* ───────── Plans ───────── */
  function renderPlans() {
    const me = mePerson();
    const other = otherPerson();
    const youWord = you();
    const list = $('#plan-list');
    if (!state.plans.length) {
      list.innerHTML = `<li class="plan-empty">Chưa có hẹn nào. Rủ nhau một việc nhỏ ở bên dưới nhé.</li>`;
      return;
    }
    list.innerHTML = state.plans.map(p => {
      const start = new Date(p.startISO);
      const creator = personBySide(p.createdBySide);
      let status;
      if (p.status === 'proposed') status = p.mine ? `Đang chờ ${esc(other.name)} trả lời` : `${esc(creator.name)} rủ ${esc(youWord)}`;
      else if (p.status === 'accepted') status = p.mine ? `${esc(other.name)} đồng ý rồi` : `${esc(cap(youWord))} đã đồng ý`;
      else status = p.mine ? `${esc(other.name)} bận mất rồi` : `${esc(cap(youWord))} đã từ chối`;
      const actions = !p.mine && p.status === 'proposed'
        ? `<button type="button" class="btn btn-ink btn-sm" data-plan="${esc(p.id)}" data-answer="accepted">Đồng ý</button>
           <button type="button" class="btn btn-ghost btn-sm" data-plan="${esc(p.id)}" data-answer="declined">Từ chối</button>`
        : p.mine ? `<button type="button" class="link" data-cancel="${esc(p.id)}">Huỷ hẹn</button>` : '';
      return `
        <li class="plan" data-status="${esc(p.status)}">
          <p class="plan-title">${esc(p.title)}</p>
          <p class="plan-when">${timeIn(start, me.timezone)}, ${dateIn(start, me.timezone)} (giờ của ${esc(youWord)})</p>
          <p class="plan-when-other">${timeIn(start, other.timezone)}, ${dateIn(start, other.timezone)} ở chỗ ${esc(other.name)}</p>
          ${p.place ? `<p class="plan-place">${esc(p.place)}</p>` : ''}
          ${p.note ? `<p class="plan-note">${esc(p.note)}</p>` : ''}
          <div class="plan-foot"><span class="plan-status">${status}</span><span class="plan-actions">${actions}</span></div>
        </li>`;
    }).join('');
  }

  function updatePlanHint() {
    const v = $('#plan-when').value;
    const hint = $('#plan-when-other');
    if (!v || !state) { hint.textContent = ''; return; }
    const d = new Date(v);
    if (isNaN(d)) { hint.textContent = ''; return; }
    const o = otherPerson();
    hint.textContent = `Lúc đó là ${timeIn(d, o.timezone)}, ${dateIn(d, o.timezone)} ở chỗ ${o.name}.`;
  }

  function openPlans() {
    renderPlans();
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    $('#plan-when').min = now.toISOString().slice(0, 16);
    $('#plan-error').textContent = '';
    updatePlanHint();
    $('#dlg-plans').showModal();
  }

  async function submitPlan(e) {
    e.preventDefault();
    const title = $('#plan-title').value.trim();
    const when = $('#plan-when').value;
    const errEl = $('#plan-error');
    if (!title) { errEl.textContent = 'Đặt tên cho buổi hẹn nhé.'; return; }
    if (!when) { errEl.textContent = 'Chọn ngày và giờ.'; return; }
    const btn = $('#form-plan button[type=submit]');
    btn.disabled = true;
    saving++;
    const r = await api('createPlan', {
      title, startISO: new Date(when).toISOString(),
      durationMin: Number($('#plan-duration').value),
      place: $('#plan-place').value.trim(), note: $('#plan-note').value.trim(),
    });
    saving--;
    btn.disabled = false;
    if (!r.ok) { errEl.textContent = errText(r); return; }
    errEl.textContent = '';
    $('#form-plan').reset();
    updatePlanHint();
    render(r.state);
    renderPlans();
    toast(`Đã gửi lời rủ. ${otherPerson().name} sẽ thấy ở đây.`);
  }

  async function planAction(action, payload, okMsg) {
    saving++;
    const r = await api(action, payload);
    saving--;
    if (!r.ok) { toast(errText(r)); return; }
    render(r.state);
    renderPlans();
    toast(okMsg);
  }

  /* ───────── History ───────── */
  async function openHistory() {
    const list = $('#history-list');
    list.innerHTML = '<li class="plan-empty">Đang mở những trang cũ…</li>';
    $('#dlg-history').showModal();
    const r = await api('history');
    if (!r.ok) { list.innerHTML = `<li class="plan-empty">${esc(errText(r))}</li>`; return; }
    if (!r.days.length) { list.innerHTML = '<li class="plan-empty">Chưa có gì. Hôm nay sẽ là trang đầu tiên.</li>'; return; }
    list.innerHTML = r.days.map(d => `
      <li class="h-day">
        <p class="h-date">${esc(cap(dayKeyLabel(d.dayKey)))}</p>
        <div class="h-pair">
          ${['left', 'right'].map(side => {
            const person = state.people.find(p => p.side === side);
            const e = d[side];
            const m = moodOf(e && e.mood) || noMood(side);
            return `<div class="h-side" style="--bg:${m.bg};--ink:${m.ink}">
              <p class="h-who">${m.emoji ? m.emoji + ' ' : ''}${esc(person ? person.name : side)}${m.label ? ', ' + esc(moodLabel(m, side).toLowerCase()) : ''}</p>
              ${e && e.note ? `<p class="h-note">${esc(e.note)}</p>` : '<p class="h-note is-empty">Không có lời nhắn</p>'}
            </div>`;
          }).join('')}
        </div>
      </li>`).join('');
  }

  /* ───────── Events ───────── */
  function bind() {

    $('#btn-plans').addEventListener('click', openPlans);
    $('#btn-history').addEventListener('click', openHistory);
    $('#btn-signout').addEventListener('click', () => window.Auth.signOut());
    $('#form-plan').addEventListener('submit', submitPlan);
    $('#plan-when').addEventListener('input', updatePlanHint);

    $$('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

    document.addEventListener('click', e => {
      const chip = e.target.closest('.mood-chip');
      if (chip) { pickMood(chip.dataset.mood); return; }

      if (e.target.closest('#btn-share')) { toggleShare(); return; }

      const slip = e.target.closest('button.slip');
      if (slip) {
        const open = slip.getAttribute('aria-expanded') !== 'true';
        slip.setAttribute('aria-expanded', String(open));
        if (open) store.set('slip:' + slip.dataset.slip, '1'); else store.del('slip:' + slip.dataset.slip);
        return;
      }

      if (e.target.id === 'btn-save-note') {
        const t = $('#note-input');
        const other = otherPerson().name;
        saveEntry({ note: t.value }, t.value.trim() ? `Đã lưu. ${other} sẽ thấy lời nhắn ở nửa của ${you()}.` : 'Đã xoá lời nhắn.');
        return;
      }

      const ans = e.target.closest('[data-answer]');
      if (ans) {
        const yes = ans.dataset.answer === 'accepted';
        planAction('respondPlan', { id: ans.dataset.plan, response: ans.dataset.answer },
          yes ? 'Đã đồng ý. Hẹn rồi nhé!' : 'Đã từ chối.');
        return;
      }
      const cancel = e.target.closest('[data-cancel]');
      if (cancel && confirm('Huỷ buổi hẹn này cho cả hai?')) {
        planAction('cancelPlan', { id: cancel.dataset.cancel }, 'Đã huỷ hẹn.');
      }
    });

    document.addEventListener('input', e => {
      if (e.target.id === 'note-input') { e.target.dataset.dirty = '1'; updateCounter(); }
    });
    document.addEventListener('keydown', e => {
      if (e.target.id === 'note-input' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#btn-save-note').click();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  /* ───────── Start ───────── */
  async function load() {
    const r = await api('state');
    if (r.ok) { enterApp(r.state); return; }
    if (r.error === 'auth') { window.Auth.expired(); return; }
    $('#loading').innerHTML = `${esc(errText(r))} <button class="link" type="button" id="btn-retry">Thử lại</button>`;
    $('#btn-retry').addEventListener('click', () => { $('#loading').textContent = 'Đang mở nhật ký…'; load(); });
  }

  async function init() {
    document.title = C.APP_NAME;
    $$('.app-name').forEach(el => { el.textContent = C.APP_NAME; });
    if (DEMO) { $('#preview-banner').hidden = false; document.body.classList.add('is-preview'); }
    bind();
    await window.Auth.require();   // not signed in → the home page, then back here
    load();
  }

  init();
})();
