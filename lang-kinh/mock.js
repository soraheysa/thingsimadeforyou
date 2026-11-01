/*
 * Lăng kính — preview mode (open the page with ?demo). Fake posts, kept in this browser only.
 */
(function () {
  'use strict';
  const KEY = 'lk_mock_db_v1';
  const MEM = {};   // photos added in this session (too big for localStorage)

  /* ── Placeholder photos drawn on a canvas ── */
  const SCENES = {
    rain(x, w, h) {
      x.fillStyle = '#9FB3C8'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#6F8299'; x.fillRect(0, h * 0.74, w, h);
      [[0.08, 0.38, 0.17], [0.27, 0.52, 0.23], [0.53, 0.3, 0.15], [0.71, 0.45, 0.21]].forEach((b, i) => {
        x.fillStyle = i % 2 ? '#4F5D73' : '#5E6E85'; x.fillRect(b[0] * w, h * 0.74 - b[1] * h, b[2] * w, b[1] * h);
      });
      x.strokeStyle = 'rgba(230,240,255,.5)'; x.lineWidth = w / 300;
      for (let i = 0; i < 60; i++) { const a = (i * 37 % 100) / 100 * w, b = (i * 53 % 100) / 100 * h; x.beginPath(); x.moveTo(a, b); x.lineTo(a - w * 0.01, b + h * 0.04); x.stroke(); }
    },
    coffee(x, w, h) {
      x.fillStyle = '#E8C9A8'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#B98A63'; x.fillRect(0, h * 0.66, w, h);
      x.fillStyle = '#FFFDF9'; x.beginPath(); x.arc(w * 0.48, h * 0.55, w * 0.26, 0, 7); x.fill();
      x.fillStyle = '#8A5A3C'; x.beginPath(); x.arc(w * 0.48, h * 0.55, w * 0.17, 0, 7); x.fill();
      x.fillStyle = '#E8C9A8'; x.beginPath(); x.ellipse(w * 0.48, h * 0.55, w * 0.07, w * 0.045, 0, 0, 7); x.fill();
    },
    sunset(x, w, h) {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#E8875A'); g.addColorStop(1, '#F7C17A');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = '#FFE08A'; x.beginPath(); x.arc(w * 0.45, h * 0.5, w * 0.17, 0, 7); x.fill();
      x.fillStyle = '#5B3A55'; x.fillRect(0, h * 0.62, w, h);
      x.fillRect(w * 0.08, h * 0.35, w * 0.1, h * 0.3); x.fillRect(w * 0.78, h * 0.24, w * 0.13, h * 0.4);
      x.fillStyle = '#E8875A'; x.fillRect(0, h * 0.8, w, h * 0.015);
    },
    bridge(x, w, h) {
      x.fillStyle = '#E9A07A'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#FFE08A'; x.beginPath(); x.arc(w * 0.3, h * 0.3, w * 0.17, 0, 7); x.fill();
      x.fillStyle = '#3E6B7A'; x.fillRect(0, h * 0.6, w, h);
      x.fillStyle = '#7A3F5C'; x.fillRect(0, h * 0.57, w, h * 0.035);
      x.fillRect(w * 0.1, h * 0.25, w * 0.02, h * 0.33); x.fillRect(w * 0.5, h * 0.25, w * 0.02, h * 0.33);
      x.fillStyle = '#2E4F5C'; x.fillRect(w * 0.72, h * 0.12, w * 0.2, h * 0.48);
    },
  };
  function scene(name, size) {
    const k = name + ':' + size;
    if (MEM[k]) return MEM[k];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    SCENES[name](c.getContext('2d'), size, size);
    return (MEM[k] = c.toDataURL('image/jpeg', size < 64 ? 0.5 : 0.82));
  }

  /* ── Starter sticker pack (placeholders for Luân's own drawings) ── */
  const svg = inner => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#fff"/>' + inner + '</svg>');
  const PACK = {
    pk_heart: svg('<circle cx="32" cy="32" r="26" fill="#FFE0EE"/><path d="M32 47s-12-7.3-15.2-14.7C14.4 26.6 18.1 20.7 24 20.7c3.4 0 5.8 1.8 8 4.8 2.2-3 4.6-4.8 8-4.8 5.9 0 9.6 5.9 7.2 11.6C44 39.7 32 47 32 47z" fill="#C8102E"/>'),
    pk_star: svg('<circle cx="32" cy="32" r="26" fill="#FFF1B8"/><path d="M32 14l4.6 9.6 10.6 1.4-7.7 7.4 1.9 10.4L32 37.8l-9.4 5 1.9-10.4-7.7-7.4 10.6-1.4z" fill="#E07306"/>'),
    pk_cat: svg('<circle cx="32" cy="32" r="26" fill="#D6E9F8"/><path d="M20 18l7 9h10l7-9v18a12 12 0 0 1-24 0z" fill="#2A1F2D"/><circle cx="27" cy="34" r="2.2" fill="#FFF1B8"/><circle cx="37" cy="34" r="2.2" fill="#FFF1B8"/>'),
    pk_sun: svg('<circle cx="32" cy="32" r="26" fill="#FFF1B8"/><circle cx="32" cy="32" r="9" fill="#FFE08A" stroke="#E07306" stroke-width="3"/><path d="M32 13v5M32 46v5M13 32h5M46 32h5M18.6 18.6l3.5 3.5M41.9 41.9l3.5 3.5M18.6 45.4l3.5-3.5M41.9 22.1l3.5-3.5" stroke="#E07306" stroke-width="3" stroke-linecap="round"/>'),
    pk_moon: svg('<circle cx="32" cy="32" r="26" fill="#E9E0F7"/><path d="M44 37a14 14 0 1 1-17-17 11 11 0 0 0 17 17z" fill="#2E3A73"/>'),
    pk_flower: svg('<circle cx="32" cy="32" r="26" fill="#D4F2E0"/><g fill="#FF9DD1"><circle cx="32" cy="21" r="7"/><circle cx="43" cy="32" r="7"/><circle cx="32" cy="43" r="7"/><circle cx="21" cy="32" r="7"/></g><circle cx="32" cy="32" r="6" fill="#E07306"/>'),
  };

  /* ── Data ── */
  const iso = msAgo => new Date(Date.now() - msAgo).toISOString();
  function seed() {
    return {
      posts: [
        { id: 'm1', type: 'photo', author: 'left', paper: 'hong', caption: 'Đoán xem anh đang ở đâu nè', body: '', blurred: true, scene: 'bridge', city: 'TP.HCM', createdAt: iso(20 * 60e3), seenAt: '' },
        { id: 'm2', type: 'note', author: 'right', paper: 'bacha', caption: '', body: 'Em vừa thi xong môn khó nhất kỳ này! Tối nay em tự thưởng một bát phở ở chỗ gần ga Altona, nước dùng không bằng ở nhà nhưng mà ấm bụng lắm. Mai em kể anh nghe đề thi nha, có một câu em làm mãi mới ra.', blurred: false, city: 'Hamburg', createdAt: iso(5 * 3600e3), seenAt: iso(4 * 3600e3) },
        { id: 'm3', type: 'photo', author: 'right', paper: 'troi', caption: 'Pinneberg sáng nay mưa lâm râm', body: '', blurred: false, scene: 'rain', city: 'Pinneberg', createdAt: iso(26 * 3600e3), seenAt: iso(25 * 3600e3) },
        { id: 'm4', type: 'note', author: 'left', paper: 'bo', caption: '', body: 'Hôm nay anh đi làm về sớm, ghé quán cà phê quen ở Quận 3. Ngồi đúng cái bàn cạnh cửa sổ lần trước hai đứa ngồi. Anh gọi ly bạc xỉu như mọi khi, rồi tự nhiên nhớ cái cách em chê bạc xỉu ở đây ngọt quá, xong vẫn uống hết.', blurred: false, city: 'TP.HCM', createdAt: iso(30 * 3600e3), seenAt: iso(29 * 3600e3) },
        { id: 'm5', type: 'photo', author: 'right', paper: 'oaihuong', caption: 'Cà phê đầu tiên của tháng 11', body: '', blurred: false, scene: 'coffee', city: 'Hamburg', createdAt: iso(50 * 3600e3), seenAt: iso(49 * 3600e3) },
        { id: 'm6', type: 'photo', author: 'left', paper: 'kem', caption: 'Hoàng hôn Thủ Thiêm', body: '', blurred: false, scene: 'sunset', city: 'TP.HCM', createdAt: iso(74 * 3600e3), seenAt: iso(70 * 3600e3) },
        { id: 'm7', type: 'note', author: 'right', paper: 'troi', caption: '', body: 'Mai anh nhớ mang ô nha, em xem thời tiết bên đó rồi đó.', blurred: false, city: 'Pinneberg', createdAt: iso(98 * 3600e3), seenAt: iso(97 * 3600e3) },
      ],
      reactions: [
        { id: 'r1', postId: 'm3', author: 'left', stickerId: 'pk_heart', createdAt: iso(25 * 3600e3) },
        { id: 'r2', postId: 'm5', author: 'left', stickerId: 'pk_heart', createdAt: iso(49 * 3600e3) },
        { id: 'r3', postId: 'm5', author: 'left', stickerId: 'pk_star', createdAt: iso(49 * 3600e3) },
        { id: 'r4', postId: 'm5', author: 'left', stickerId: 'pk_cat', createdAt: iso(49 * 3600e3) },
        { id: 'r5', postId: 'm2', author: 'left', stickerId: 'pk_star', createdAt: iso(4 * 3600e3) },
      ],
      stickers: [],
      places: {},
    };
  }
  function load() { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch (e) { /* fresh */ } const d = seed(); save(d); return d; }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* full: keep in memory */ } }

  const out = (db, p) => ({
    id: p.id, type: p.type, author: p.author, paper: p.paper, caption: p.caption, body: p.body, blurred: !!p.blurred,
    hasPhoto: p.type === 'photo', city: p.city, createdAt: p.createdAt, editedAt: p.editedAt || '', seenAt: p.seenAt || '',
    preview: p.preview || (p.scene ? scene(p.scene, 24) : ''),
    reactions: db.reactions.filter(r => r.postId === p.id).map(r => Object.assign({}, r)),
  });

  function handle(req, side) {
    const db = load();
    const find = id => db.posts.find(p => p.id === id && !p.deleted);
    switch (req.action) {
      case 'lkList': {
        let list = db.posts.filter(p => !p.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (req.before) list = list.filter(p => p.createdAt < req.before);
        const page = list.slice(0, req.limit || 20);
        return { ok: true, me: { side }, posts: page.map(p => out(db, p)), hasMore: list.length > page.length, places: db.places };
      }
      case 'lkCreate': {
        const p = { id: 'm' + Date.now(), type: req.type, author: side, paper: req.paper, caption: req.caption || '', body: req.body || '',
          blurred: !!req.blurred, city: req.city || '', createdAt: new Date().toISOString(), seenAt: '', preview: req.preview || '' };
        if (req.type === 'photo') { MEM[p.id + ':thumb'] = req.thumb; MEM[p.id + ':large'] = req.large; }
        db.posts.push(p); save(db);
        return { ok: true, post: out(db, p) };
      }
      case 'lkOriginal': return { ok: true };
      case 'lkEdit': {
        const p = find(req.id); if (!p) return { ok: false, error: 'not_found', message: 'Ghim này không còn nữa.' };
        ['caption', 'body', 'paper'].forEach(k => { if (req[k] !== undefined) p[k] = req[k]; });
        if (req.blurred !== undefined) p.blurred = !!req.blurred;
        p.editedAt = new Date().toISOString(); save(db);
        return { ok: true, post: out(db, p) };
      }
      case 'lkDelete': { const p = find(req.id); if (p) { p.deleted = true; save(db); } return { ok: true }; }
      case 'lkImages': {
        const images = {};
        (req.ids || []).forEach(id => {
          const p = find(id); if (!p) return;
          const size = req.size === 'large' ? 'large' : 'thumb';
          images[id] = MEM[id + ':' + size] || (p.scene ? scene(p.scene, size === 'large' ? 1000 : 480) : null);
          if (!images[id]) delete images[id];
        });
        return { ok: true, images };
      }
      case 'lkSeen': { const p = find(req.id); if (p && p.author !== side && !p.seenAt) { p.seenAt = new Date().toISOString(); save(db); } return { ok: true, seenAt: p ? p.seenAt : '' }; }
      case 'lkReact': {
        const mine = db.reactions.filter(r => r.postId === req.postId && r.author === side);
        if (mine.length >= 3) return { ok: false, error: 'limit', message: 'Mỗi người dán tối đa 3 sticker cho một ghim thôi.' };
        const r = { id: 'r' + Date.now(), postId: req.postId, author: side, stickerId: req.stickerId, createdAt: new Date().toISOString() };
        db.reactions.push(r); save(db); return { ok: true, reaction: r };
      }
      case 'lkUnreact': db.reactions = db.reactions.filter(r => !(r.id === req.id && r.author === side)); save(db); return { ok: true };
      case 'lkStickers': return { ok: true, pack: Object.keys(PACK).map(id => ({ id })), mine: db.stickers.filter(s => s.owner === side).map(s => ({ id: s.id })) };
      case 'lkStickerImages': {
        const images = {};
        (req.ids || []).forEach(id => { const v = PACK[id] || MEM['st:' + id]; if (v) images[id] = v; });
        return { ok: true, images };
      }
      case 'lkUploadSticker': {
        const id = 'st' + Date.now();
        MEM['st:' + id] = 'data:image/png;base64,' + req.data;
        db.stickers.push({ id, owner: side }); save(db);
        return { ok: true, sticker: { id } };
      }
      case 'lkPlace': db.places[side] = { city: req.city, lat: req.lat, lon: req.lon, tz: req.tz, updatedAt: new Date().toISOString() }; save(db); return { ok: true };
    }
    return { ok: false, error: 'bad_request' };
  }

  window.LKMock = {
    handle: (req, side) => new Promise(res => setTimeout(() => res(JSON.parse(JSON.stringify(handle(req, side)))), 250)),
    reset: () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
  };
})();
