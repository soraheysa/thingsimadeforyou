/*
 * Điều ước cho nhau — preview mode (open the page with ?demo). Fake wishes, kept in this browser only.
 * It runs the very same rules as the real backend (rules.js). Sign in on the home page with an
 * email containing "luan" to be Luân; anything else is Thư. Both sides share this fake data,
 * so you can switch sides and watch a wish travel from one to the other.
 *
 * Preview-only nicety: when you tap "Đã thành hiện thực", the other side confirms by itself a few
 * seconds later, so you can see the stamp land.
 */
(function () {
  'use strict';
  const R = window.HU_RULES;
  const KEY = 'hu_mock_db_v2';
  const AUTO_CONFIRM_MS = 5000;

  function dayKey(tz, ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms == null ? Date.now() : ms)).map(x => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day;
  }
  const TZ = { left: 'Asia/Ho_Chi_Minh', right: 'Europe/Berlin' };
  const ago = days => Date.now() - days * 86400e3;
  const iso = ms => new Date(ms).toISOString();
  const dayIn = days => dayKey('Asia/Ho_Chi_Minh', Date.now() + days * 86400e3);   // '2026-11-20'

  function row(o) {
    const w = {};
    R.FIELDS.forEach(f => { w[f] = o[f] == null ? '' : String(o[f]); });
    return w;
  }
  function drawn(by, days) { return { drawnBy: by, drawnAt: iso(ago(days)), drawnDay: dayKey(TZ[by], ago(days)) }; }

  function seed() {
    let n = 0;
    const w = o => row(Object.assign({ id: 'demo' + (++n) }, o));
    return [
      // Luân's wishes
      w({ author: 'left', category: 'both', title: 'Đi Đà Lạt cuối tuần, chỉ hai đứa', note: 'Thuê một căn nhà gỗ có lò sưởi.', createdAt: iso(ago(9)), due: dayIn(-4) }),
      w({ author: 'left', category: 'self', title: 'Một đôi giày chạy bộ mới', note: 'Size 42, màu gì cũng được trừ màu cam.', link: 'https://example.com/giay', createdAt: iso(ago(8)), due: dayIn(7),
        ...drawn('right', 2) }),   // Thư opened this one two days ago; Luân can't tell
      w({ author: 'left', category: 'someone', recipient: 'Mẹ', title: 'Máy massage cổ cho mẹ', note: 'Mẹ hay mỏi vai sau giờ làm.', createdAt: iso(ago(7)) }),
      w({ author: 'left', category: 'other', title: 'Dắt em đi ăn lẩu nấm ngày em về', createdAt: iso(ago(6)) }),
      w({ author: 'left', category: 'both', title: 'Xem pháo hoa giao thừa cùng nhau', createdAt: iso(ago(5)), due: dayIn(49) }),
      w({ author: 'left', category: 'self', title: 'Đọc xong một cuốn sách dày', note: 'Em chọn sách giúp anh.', createdAt: iso(ago(12)),
        ...drawn('right', 10), tapRight: iso(ago(4)), tapLeft: iso(ago(3)) }),
      // Thư's wishes
      w({ author: 'right', category: 'self', title: 'Một chiếc khăn len màu kem', note: 'Dày một chút, quấn được hai vòng.', createdAt: iso(ago(9)), due: dayIn(2),
        ...drawn('left', 1) }),
      w({ author: 'right', category: 'both', title: 'Học nấu một món Huế cùng nhau', note: 'Bún bò hoặc bánh bèo, món nào cũng được.', createdAt: iso(ago(8)), due: dayIn(42) }),
      w({ author: 'right', category: 'someone', recipient: 'Bé Na', title: 'Gửi quà sinh nhật cho bé Na', note: 'Bé thích khủng long.', createdAt: iso(ago(7)) }),
      w({ author: 'right', category: 'other', title: 'Đan cho anh một đôi găng tay', note: 'Màu xanh rêu.', createdAt: iso(ago(11)),
        tapRight: iso(ago(0.1)) }),   // Thư says it came true; waiting for Luân to confirm
      w({ author: 'right', category: 'self', title: 'Đi xem triển lãm ánh sáng', link: 'https://example.com/trien-lam', createdAt: iso(ago(5)) }),
      w({ author: 'right', category: 'self', title: 'Một quyển sổ tay bìa vải', createdAt: iso(ago(4)), due: dayIn(-2),
        ...drawn('left', 3) }),   // Luân drew it, the day has passed: grey, still doable
      w({ author: 'right', category: 'self', title: 'Một hộp màu nước mới', createdAt: iso(ago(14)),
        ...drawn('left', 13), tapLeft: iso(ago(6)), tapRight: iso(ago(6)) }),
      w({ author: 'right', category: 'both', title: 'Chạy chung một giải 5 km', createdAt: iso(ago(3)) }),
    ];
  }

  function load() {
    try { const db = JSON.parse(localStorage.getItem(KEY)); if (db && db.rows) return db; } catch (e) { /* fresh */ }
    const db = { rows: seed(), auto: [] };
    save(db);
    return db;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
  const err = (error, message) => ({ ok: false, error, message });
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /** The pretend other person confirms taps that have waited long enough. */
  function runAuto(db) {
    const now = Date.now();
    db.auto = (db.auto || []).filter(a => {
      if (a.at > now) return true;
      const w = db.rows.find(x => x.id === a.id);
      if (w) { const r = R.grant(w, a.side, iso(now)); if (r.ok) Object.assign(w, r.patch); }
      return false;
    });
  }

  async function handle(body, side) {
    await wait(body.action === 'huDraw' ? 900 : 250);   // feel like a network
    const db = load();
    runAuto(db);
    const today = dayKey(body.tz || TZ[side]);
    const now = iso(Date.now());
    const find = id => db.rows.find(w => w.id === String(id || '')) || null;
    const done = extra => { save(db); return Object.assign({ ok: true }, R.stateFor(db.rows, side, today), extra || {}); };

    switch (body.action) {
      case 'huList': return done();

      case 'huAdd': {
        const v = R.validate(body, true);
        if (!v.ok) return err('bad_request', v.message);
        const r = R.checkRecipient(v.value.category, v.value.recipient);
        if (!r.ok) return err('bad_request', r.message);
        const id = 'demo' + Math.random().toString(36).slice(2, 10);
        db.rows.push(row(Object.assign({}, v.value, { id, author: side, createdAt: now,
          recipient: v.value.category === 'someone' ? v.value.recipient : '' })));
        return done({ id });
      }

      case 'huEdit': {
        const v = R.validate(body, false);
        if (!v.ok) return err('bad_request', v.message);
        const w = find(body.id);
        if (!w || !R.canChange(w, side)) return err('not_found', 'Điều ước này không đổi được nữa.');
        const r = R.checkRecipient(w.category, v.value.recipient);
        if (!r.ok) return err('bad_request', r.message);
        Object.assign(w, { title: v.value.title, note: v.value.note, link: v.value.link, due: v.value.due, editedAt: now,
          recipient: w.category === 'someone' ? v.value.recipient : '' });
        return done();
      }

      case 'huDelete': {
        const w = find(body.id);
        if (!w || !R.canDelete(w, side)) return err('not_found', 'Điều ước này không xoá được.');
        Object.assign(w, { deleted: 'TRUE', deletedAt: now });
        return done();
      }

      case 'huDraw': {
        if (R.drewToday(db.rows, side, today)) return err('drew_today', 'Hôm nay bốc rồi. Mai bốc tiếp nhé.');
        const pool = R.jarFor(db.rows, side);
        if (!pool.length) return err('empty', 'Hũ đang trống.');
        const w = R.pick(pool, today);
        Object.assign(w, { drawnBy: side, drawnAt: now, drawnDay: today });
        return done({ drawn: R.view(w, side) });
      }

      case 'huGrant': {
        const w = find(body.id);
        const r = R.grant(w, side, now);
        if (!r.ok) return r;
        Object.assign(w, r.patch);
        if (!R.isGranted(w) && R.assignee(w) === side) {
          db.auto = (db.auto || []).filter(a => a.id !== w.id);
          db.auto.push({ id: w.id, side: R.otherOf(side), at: Date.now() + AUTO_CONFIRM_MS });
        }
        return done();
      }

      case 'huUngrant': {
        const w = find(body.id);
        const r = R.ungrant(w, side);
        if (!r.ok) return r;
        Object.assign(w, r.patch);
        db.auto = (db.auto || []).filter(a => a.id !== w.id);
        return done();
      }

      // Preview only: start the fake data over (and give back today's draw).
      case 'huReset': { localStorage.removeItem(KEY); return Object.assign({ ok: true }, R.stateFor(load().rows, side, today)); }

      default: return err('bad_request', 'Yêu cầu không hợp lệ.');
    }
  }

  window.HUMock = { handle, AUTO_CONFIRM_MS };
})();
