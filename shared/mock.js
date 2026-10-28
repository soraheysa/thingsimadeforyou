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
    ],
    couple: [
      ['good', 'Cùng một mặt trăng, hai ô cửa sổ. Ngắm trăng rồi chụp gửi nhau.'],
      ['great', 'Hôm nay mấy tiếng chênh lệch giữa hai đứa bỗng ngắn hơn mọi khi.'],
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
    try { const db = JSON.parse(localStorage.getItem(KEY)); if (db) return db; } catch (e) { /* fresh */ }
    const db = { entries: [], plans: [], tokens: {} };
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
    }
    return err('bad_request', 'Yêu cầu không hợp lệ.');
  }

  window.MockBackend = {
    handle: req => new Promise(res => setTimeout(() => res(JSON.parse(JSON.stringify(handle(req)))), 350)),
    reset: () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
  };
})();
