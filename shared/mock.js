/*
 * Preview mode: a pretend backend that keeps fake data in this browser only.
 * Active while AUTH_API_URL in shared/config.js is empty, or after opening any page with ?demo.
 * In preview mode any code is accepted, so the real code never appears in this public file.
 */
(function () {
  const KEY = 'hn_mock_db_v2';
  const USERS = [
    { email: 'luan@demo', name: 'Luân', side: 'left', pronoun: 'anh', timezone: 'Asia/Ho_Chi_Minh', city: 'Sài Gòn',
      weather: { tempC: 32, feelsC: 38, code: 2, isDay: true, humidity: 70, windKmh: 10 } },
    { email: 'thu@demo', name: 'Thư', side: 'right', pronoun: 'em', timezone: 'Europe/Berlin', city: 'Pinneberg',
      weather: { tempC: 9, feelsC: 5, code: 61, isDay: false, humidity: 88, windKmh: 18 } },
  ];
  const FORTUNES = {
    personal: [
      ['great', 'Quẻ xem thử: quẻ thật nằm trong Google Sheet của anh.'],
      ['good', 'Có người ở thật xa đang nghĩ về {you} ngay lúc này. Đúng rồi, chính {other} đó.'],
      ['future', 'Hôm nay kiên nhẫn sẽ được đền đáp. Việc gì chậm thì cứ để nó chậm.'],
      ['small', 'Ăn món gì đó ấm áp. Tâm trạng sẽ đi theo cái bụng.'],
      ['bad', 'Kế hoạch hôm nay dễ đổ bể. Chuẩn bị sẵn phương án hai.'],
      ['terrible', 'Quẻ xấu nhất trong ống. Tin tốt là từ đây chỉ có đi lên.'],
    ],
    couple: [
      ['good', 'Cùng một mặt trăng, hai ô cửa sổ. Ngắm trăng rồi chụp gửi nhau.'],
      ['great', 'Hôm nay mấy tiếng chênh lệch giữa hai đứa bỗng ngắn hơn mọi khi.'],
      ['smallbad', 'Hôm nay lệch nhịp hơn mọi khi: người này rảnh thì người kia bận. Hẹn trước một khung giờ để gọi.'],
    ],
  };

  function dayKey(tz) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day;
  }
  function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
  function pick(type, seed, u, other) {
    const l = FORTUNES[type]; const f = l[hash(seed) % l.length];
    const you = u ? u.pronoun : 'bạn';
    return { level: f[0], text: f[1].replace(/\{you\}/g, you).replace(/\{other\}/g, other ? other.name : '') };
  }

  function load() {
    try { const db = JSON.parse(localStorage.getItem(KEY)); if (db) { db.misses = db.misses || seedMisses(); db.letters = db.letters || seedLetters(); return db; } } catch (e) { /* fresh */ }
    const db = { entries: [], plans: [], tokens: {}, misses: seedMisses(), letters: seedLetters() };
    db.entries.push({ dayKey: dayKey('Europe/Berlin'), email: 'thu@demo', mood: 'missing', note: 'Trời ở đây xám quá. Kể em nghe hôm nay anh ăn gì đi.', shareFortune: true });
    db.entries.push({ dayKey: dayKey('Asia/Ho_Chi_Minh'), email: 'luan@demo', mood: 'calm', note: 'Chạy bộ xong rồi. Trên đường về toàn nghĩ tới em.', shareFortune: false });
    const yKey = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    db.entries.push({ dayKey: yKey, email: 'thu@demo', mood: 'happy', note: 'Hôm nay em qua buổi seminar đầu tiên rồi!' });
    db.entries.push({ dayKey: yKey, email: 'luan@demo', mood: 'excited', note: 'Tự hào về em.' });
    const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7)); sat.setHours(20, 0, 0, 0);
    db.plans.push({ id: 'p1', createdBy: 'luan@demo', title: 'Xem phim cùng nhau qua video call', startISO: sat.toISOString(), durationMin: 150, place: 'Google Meet', note: 'Lần này em chọn phim nhé.', status: 'proposed' });
    save(db);
    return db;
  }
  function seedMisses() {
    const vn = dayKey('Asia/Ho_Chi_Minh'), de = dayKey('Europe/Berlin');
    const at = h => new Date(Date.now() - h * 3600e3).toISOString();
    return [
      { from: 'right', to: 'left', at: at(5), fromDay: de, toDay: vn, night: false },
      { from: 'right', to: 'left', at: at(4), fromDay: de, toDay: vn, night: false },
      { from: 'left', to: 'right', at: at(3), fromDay: vn, toDay: de, night: true },
      { from: 'left', to: 'right', at: at(2), fromDay: vn, toDay: de, night: true },
      { from: 'left', to: 'right', at: at(1), fromDay: vn, toDay: de, night: false },
    ];
  }
  /* "Về nhà" letters (shared/venha.js). The real ones live in the Nhớ Google Sheet, tab NH_Letters. */
  function seedLetters() {
    return [{ id: 've-nha', title: 'Chào mừng em về nhà',
      text: '(Lá thư chào em về nhà. Anh sẽ viết nội dung thật vào Google Sheet.)\n\nĐây là chữ giả để xem thử: xuống dòng được giữ nguyên, thư dài thì màn hình tự cuộn.',
      opensAt: 'landing', popup: true, seenAt: '' }];
  }
  const clock = () => (window.Auth && window.Auth.now ? window.Auth.now() : Date.now());
  function letterOut(l) {
    const at = l.opensAt === 'landing' ? Date.parse(flightState().arrivesAt) : Date.parse(l.opensAt || '');
    return Object.assign({}, l, { opensAt: at ? new Date(at).toISOString() : '', locked: !!at && clock() < at });
  }

  /*
   * "Về nhà" flight (action veNha), pretend version: the likely Qatar trip, a little late.
   * QR70 Frankfurt 09:15 → Doha 17:15 on 14 Jan, QR974 Doha 20:00 → Tân Sơn Nhất 07:15 on 15 Jan.
   * Without a ticket (preview switch), only the plan in shared/config.js (RETURN.AT) is known.
   */
  function flightState() {
    const plan = Date.parse(((window.SHARED_CONFIG || {}).RETURN || {}).AT || '');
    let ticket = '1';
    try { ticket = sessionStorage.getItem('tim_pv_ticket') || '0'; } catch (e) { /* private mode */ }
    if (ticket !== '1') return { arrivesAt: plan ? new Date(plan).toISOString() : '', scheduledAt: plan ? new Date(plan).toISOString() : '', landedAt: '', legs: [], checkedAt: '' };
    const t = clock();
    const iso = x => (x ? new Date(x).toISOString() : '');
    const leg = (n, flight, from, fromTz, to, toTz, dS, aS, lateDep, lateArr) => {
      const ds = Date.parse(dS), as = Date.parse(aS);
      const known = t > ds - 3 * 3600e3;            // delays show up on the day
      const dA = ds + lateDep * 60e3, aA = as + lateArr * 60e3;
      const status = t >= aA ? 'Arrived' : t >= aA - 20 * 60e3 ? 'Approaching' : t >= dA ? 'EnRoute' : t > ds - 7 * 864e5 ? 'Expected' : '';
      return { leg: n, flight, from, to, fromName: '', toName: '', fromTz, toTz, status,
        dep: { s: iso(ds), e: iso(known ? dA : ds), a: t >= dA ? iso(dA) : '' },
        arr: { s: iso(as), e: iso(known ? aA : as), a: t >= aA ? iso(aA) : '' } };
    };
    const legs = [
      leg(1, 'QR70', 'FRA', 'Europe/Berlin', 'DOH', 'Asia/Qatar', '2027-01-14T08:15:00Z', '2027-01-14T14:15:00Z', 12, 5),
      leg(2, 'QR974', 'DOH', 'Asia/Qatar', 'SGN', 'Asia/Ho_Chi_Minh', '2027-01-14T17:00:00Z', '2027-01-15T00:15:00Z', 25, 25),
    ];
    const last = legs[1];
    return { arrivesAt: last.arr.a || last.arr.e, scheduledAt: last.arr.s, landedAt: last.arr.a, legs,
      checkedAt: iso(t - 4 * 60e3) };
  }

  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
  function userFor(email) { return /luan|luân/i.test(email || '') ? USERS[0] : USERS[1]; }
  function err(code, message) { return { ok: false, error: code, message: message || '' }; }

  function state(db, me) {
    return {
      me: { side: me.side, name: me.name, email: me.email },
      people: USERS.map(u => {
        const k = dayKey(u.timezone);
        const e = db.entries.find(x => x.email === u.email && x.dayKey === k);
        const other = USERS.find(x => x !== u);
        const shared = !!(e && e.shareFortune);
        return { side: u.side, name: u.name, pronoun: u.pronoun, city: u.city, weather: u.weather, timezone: u.timezone, dayKey: k, isMe: u === me,
          entry: e ? { mood: e.mood, note: e.note } : null,
          fortune: (u === me || shared) ? pick('personal', k + '|' + u.email, u, other) : null,
          fortuneShared: shared };
      }),
      couple: { dayKey: dayKey('Asia/Ho_Chi_Minh'), fortune: pick('couple', dayKey('Asia/Ho_Chi_Minh')) },
      plans: db.plans.filter(p => p.status !== 'cancelled').sort((a, b) => a.startISO.localeCompare(b.startISO))
        .map(p => Object.assign({}, p, { createdBySide: userFor(p.createdBy).side, mine: p.createdBy === me.email })),
      noteMax: 280,
    };
  }

  function handle(req) {
    const db = load();
    const authed = () => { const e = db.tokens[req.token]; return e ? userFor(e) : null; };
    switch (req.action) {
      case 'requestCode': return { ok: true };
      case 'verify': {
        if (!String(req.code || '').trim()) return err('wrong_code');
        const me = userFor(req.email);
        const token = 'demo' + Math.random().toString(36).slice(2);
        db.tokens[token] = me.email; save(db);
        return { ok: true, token, me: { name: me.name, side: me.side, pronoun: me.pronoun } };
      }
      case 'signOut': delete db.tokens[req.token]; save(db); return { ok: true };
    }
    const me = authed();
    if (!me) return err('auth');
    switch (req.action) {
      case 'whoami': return { ok: true, me: { name: me.name, side: me.side, pronoun: me.pronoun } };
      case 'resume':
      case 'state': return { ok: true, state: state(db, me) };
      case 'saveEntry': {
        const k = dayKey(me.timezone);
        let e = db.entries.find(x => x.email === me.email && x.dayKey === k);
        if (!e) { e = { dayKey: k, email: me.email, mood: '', note: '', shareFortune: false }; db.entries.push(e); }
        if (req.mood !== undefined) e.mood = req.mood;
        if (req.note !== undefined) e.note = String(req.note).trim().slice(0, 280);
        if (req.shareFortune !== undefined) e.shareFortune = !!req.shareFortune;
        save(db); return { ok: true, state: state(db, me) };
      }
      case 'history': {
        const by = {};
        db.entries.forEach(e => { by[e.dayKey] = by[e.dayKey] || { dayKey: e.dayKey }; by[e.dayKey][userFor(e.email).side] = { mood: e.mood, note: e.note }; });
        return { ok: true, meSide: me.side, days: Object.keys(by).sort().reverse().map(k => by[k]) };
      }
      case 'createPlan': {
        if (!String(req.title || '').trim()) return err('bad_request', 'Đặt tên cho buổi hẹn nhé.');
        if (isNaN(new Date(req.startISO))) return err('bad_request', 'Chọn ngày và giờ.');
        if (new Date(req.startISO) < Date.now() - 300000) return err('bad_request', 'Chọn một thời điểm trong tương lai.');
        db.plans.push({ id: 'p' + Date.now(), createdBy: me.email, title: req.title.trim(), startISO: new Date(req.startISO).toISOString(),
          durationMin: Number(req.durationMin) || 60, place: req.place || '', note: req.note || '', status: 'proposed' });
        save(db); return { ok: true, state: state(db, me) };
      }
      case 'respondPlan': {
        const p = db.plans.find(x => x.id === req.id);
        if (!p) return err('not_found', 'Buổi hẹn này không còn nữa.');
        if (p.createdBy === me.email) return err('bad_request', 'Lời rủ này là của mình, người kia sẽ trả lời.');
        p.status = req.response; save(db); return { ok: true, state: state(db, me) };
      }
      case 'cancelPlan': {
        const p = db.plans.find(x => x.id === req.id);
        if (!p) return err('not_found', 'Buổi hẹn này không còn nữa.');
        if (p.createdBy !== me.email) return err('bad_request', 'Chỉ người rủ mới huỷ được buổi hẹn.');
        p.status = 'cancelled'; save(db); return { ok: true, state: state(db, me) };
      }
      case 'nhoState': return { ok: true, state: nhoState(db, me) };
      case 'nhoSend': {
        const to = USERS.find(u => u !== me);
        const now = new Date();
        const last = db.misses.filter(m => m.from === me.side).pop();
        if (last && now - new Date(last.at) < 3000) return err('too_fast', 'Chậm lại một chút, tim đang bay tới rồi.');
        const night = asleep(to.side, to.timezone, now);
        db.misses.push({ from: me.side, to: to.side, at: now.toISOString(), fromDay: dayKey(me.timezone), toDay: dayKey(to.timezone), night });
        save(db);
        return { ok: true, silenced: night, pushed: night ? 0 : 1, state: nhoState(db, me) };
      }
      case 'pushSave': case 'pushRemove': return { ok: true, state: nhoState(db, me) };
      case 'veNha': return Object.assign({ ok: true }, flightState());
      case 'letters': {
        const all = db.letters.map(letterOut);
        const list = me.side === 'left' ? all : all.filter(l => !l.locked);
        const popup = me.side === 'right' ? (list.find(l => l.popup && !l.seenAt) || null) : null;
        return { ok: true, letters: list, popup };
      }
      case 'letterSeen': {
        const l = db.letters.find(x => x.id === req.id);
        if (me.side === 'right' && l && !l.seenAt && !letterOut(l).locked) { l.seenAt = new Date(clock()).toISOString(); save(db); }
        return { ok: true };
      }
      case 'pushTest': return { ok: false, error: 'no_push', message: 'Chế độ xem thử không gửi thông báo thật.' };
    }
    return err('bad_request', 'Yêu cầu không hợp lệ.');
  }

  /* "Nhớ" heart (shared/nho.js). Same sleep times as nho/backend/Code.gs. */
  const SLEEP = { left: ['00:00', '05:00'], right: ['01:00', '07:00'] };
  const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  function asleep(side, tz, date) {
    const [a, b] = SLEEP[side].map(mins);
    const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(date).split(':').map(Number);
    const x = h * 60 + m;
    return a < b ? (x >= a && x < b) : (x >= a || x < b);
  }
  function nhoState(db, me) {
    const myDay = dayKey(me.timezone);
    const counts = { left: { day: 0, night: 0, total: 0, lastAt: '' }, right: { day: 0, night: 0, total: 0, lastAt: '' } };
    db.misses.forEach(r => {
      const c = counts[r.from];
      c.total++; c.lastAt = r.at;
      if ((r.to === me.side ? r.toDay : r.fromDay) === myDay) c[r.night ? 'night' : 'day']++;
    });
    const person = u => ({
      side: u.side, name: u.name, pronoun: u.pronoun, tz: u.timezone,
      localTime: new Intl.DateTimeFormat('en-GB', { timeZone: u.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()),
      asleep: asleep(u.side, u.timezone, new Date()), sleep: SLEEP[u.side].join('–'), pushOn: true, sent: counts[u.side],
    });
    return { me: person(me), other: person(USERS.find(u => u !== me)), dayKey: myDay, pushReady: false };
  }

  window.MockBackend = {
    handle: req => new Promise(res => setTimeout(() => res(JSON.parse(JSON.stringify(handle(req)))), 350)),
    reset: () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
  };
})();
