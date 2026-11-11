/*
 * Hũ điều ước — the rules, in one place.
 *
 * This same file runs in two places, so the preview and the real thing can never disagree:
 *  - in the browser (preview mode, via mock.js),
 *  - in Apps Script, pasted as a second file named Rules.gs next to backend/Code.gs.
 * After changing it here, paste it into Rules.gs again and deploy a new version.
 *
 * A wish is one row. Sides: 'left' = Luân, 'right' = Thư. Every field is a string ('' when empty).
 *   category  'self'    for the author          → goes into the jar
 *             'other'   for the other person    → never in the jar; the author's own to-do,
 *                                                  kept hidden from the other until it is done
 *             'both'    for the two of us       → goes into the jar
 *             'someone' for someone else        → goes into the jar (recipient = their name)
 *   drawnBy / drawnAt / drawnDay   who opened it from the jar, when, and on which local day
 *   tapLeft / tapRight             "Đã thành hiện thực" taps; granted when both are set
 *   deleted ('TRUE')               withdrawn by the author
 *
 * The doer ("assignee") is the one who drew it, or the author for a 'for the other' wish.
 * The doer taps first, then the other person confirms. The author never learns that a jar
 * wish was drawn until the drawer taps "Đã thành hiện thực".
 */
var HU_RULES = (function () {
  'use strict';

  var LIMITS = { TITLE: 80, NOTE: 300, LINK: 500, RECIPIENT: 40 };
  var CATEGORIES = ['self', 'other', 'both', 'someone'];
  var JAR = ['self', 'both', 'someone'];
  var FIELDS = ['id', 'author', 'category', 'title', 'note', 'link', 'recipient', 'createdAt', 'editedAt',
    'drawnBy', 'drawnAt', 'drawnDay', 'tapLeft', 'tapRight', 'deleted', 'deletedAt'];

  function otherOf(side) { return side === 'left' ? 'right' : 'left'; }
  function isDeleted(w) { return w.deleted === 'TRUE'; }
  function tapOf(w, side) { return side === 'left' ? w.tapLeft : w.tapRight; }
  function tapKey(side) { return side === 'left' ? 'tapLeft' : 'tapRight'; }
  function assignee(w) { return w.category === 'other' ? w.author : (w.drawnBy || ''); }
  function isGranted(w) { return !!(w.tapLeft && w.tapRight); }
  function grantedAt(w) {
    if (!isGranted(w)) return '';
    return w.tapLeft > w.tapRight ? w.tapLeft : w.tapRight;
  }

  function clean(s, max) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  }

  /** "shopee.vn/abc" → "https://shopee.vn/abc"; '' stays ''; anything else that isn't a web link → null. */
  function normalizeLink(s) {
    s = clean(s, LIMITS.LINK).replace(/\s+/g, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) {
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#|:)/i.test(s)) return null;
      s = 'https://' + s;
    }
    return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(s) ? s : null;
  }

  /**
   * Checks what someone typed. isNew: the category may only be chosen when adding.
   * Returns { ok: true, value } or { ok: false, field, message }.
   */
  function validate(input, isNew) {
    var v = {};
    if (isNew) {
      v.category = String(input.category || '');
      if (CATEGORIES.indexOf(v.category) < 0) return { ok: false, field: 'category', message: 'Chọn điều ước này dành cho ai nhé.' };
    }
    v.title = clean(input.title, LIMITS.TITLE).replace(/\s+/g, ' ');
    if (!v.title) return { ok: false, field: 'title', message: 'Viết điều ước trước đã.' };
    v.note = clean(input.note, LIMITS.NOTE);
    var link = normalizeLink(input.link);
    if (link === null) return { ok: false, field: 'link', message: 'Đường link chưa đúng. Dán cả địa chỉ, ví dụ https://shopee.vn/…' };
    v.link = link;
    v.recipient = clean(input.recipient, LIMITS.RECIPIENT).replace(/\s+/g, ' ');
    return { ok: true, value: v };
  }

  /** The recipient only matters for 'someone' wishes. */
  function checkRecipient(category, recipient) {
    if (category === 'someone' && !recipient) return { ok: false, field: 'recipient', message: 'Ghi tên người nhận nhé.' };
    return { ok: true };
  }

  /** Wishes `side` can draw: the other person's jar wishes nobody has opened yet. */
  function jarFor(rows, side) {
    return rows.filter(function (w) {
      return w.author !== side && JAR.indexOf(w.category) >= 0 && !w.drawnBy && !isDeleted(w);
    });
  }

  /** One draw per day, by the drawer's own calendar day. Withdrawn wishes still count. */
  function drewToday(rows, side, today) {
    return rows.some(function (w) { return w.drawnBy === side && w.drawnDay === today; });
  }

  /**
   * What `side` is allowed to see of a wish, or null when it should stay hidden.
   * status: 'jar' (still in the jar, as far as the author knows), 'todo', 'pending' (doer tapped,
   *         waiting for the other), 'granted', 'withdrawn' (the author took it back after it was drawn)
   * role:   'doer' (it's on my to-do), 'confirmer' (I'm asked to confirm), 'author'
   */
  function view(w, side) {
    var other = otherOf(side);
    var doer = assignee(w);
    var doerTap = doer ? tapOf(w, doer) : '';
    var mine = w.author === side;
    var base = {
      id: w.id, author: w.author, category: w.category, title: w.title, note: w.note, link: w.link,
      recipient: w.category === 'someone' ? w.recipient : '', createdAt: w.createdAt, editedAt: w.editedAt,
    };

    if (isDeleted(w)) {
      if (w.drawnBy !== side || w.category === 'other') return null;
      return Object.assign(base, { status: 'withdrawn', role: 'doer', assignee: side, drawnAt: w.drawnAt,
        myTap: false, otherTap: false, grantedAt: '', canEdit: false, canDelete: false });
    }

    var visible = mine || w.drawnBy === side || (w.category === 'other' && !!doerTap);
    if (!visible) return null;

    // The author only finds out a jar wish was drawn once the drawer says it came true.
    var revealed = w.category === 'other' || w.drawnBy === side || !!doerTap;
    var granted = isGranted(w);
    var status = granted ? 'granted' : doerTap ? 'pending' : (revealed && doer) ? 'todo' : 'jar';
    var role = revealed && doer === side ? 'doer' : (doerTap && doer === other) ? 'confirmer' : 'author';
    var editable = mine && !doerTap && !granted;

    return Object.assign(base, {
      status: status, role: role,
      assignee: revealed ? doer : '',
      drawnAt: revealed && w.category !== 'other' ? w.drawnAt : '',
      myTap: !!tapOf(w, side), otherTap: revealed ? !!tapOf(w, other) : false,
      grantedAt: grantedAt(w), canEdit: editable, canDelete: editable,
    });
  }

  /** "Đã thành hiện thực": the doer taps first, then the other person confirms. Returns a patch. */
  function grant(w, side, now) {
    if (!w || isDeleted(w)) return { ok: false, error: 'not_found', message: 'Điều ước này không còn nữa.' };
    if (isGranted(w)) return { ok: true, patch: {} };
    var doer = assignee(w);
    if (doer && side === doer) {
      var p = {}; p[tapKey(side)] = tapOf(w, side) || now;
      return { ok: true, patch: p };
    }
    if (doer && side === otherOf(doer) && tapOf(w, doer)) {
      var q = {}; q[tapKey(side)] = now;
      return { ok: true, patch: q };
    }
    return { ok: false, error: 'not_allowed', message: 'Điều ước này chưa đến lượt mình bấm.' };
  }

  /** The doer takes back a tap made by mistake, or the confirmer says "Chưa đâu". */
  function ungrant(w, side) {
    if (!w || isDeleted(w)) return { ok: false, error: 'not_found', message: 'Điều ước này không còn nữa.' };
    if (isGranted(w)) return { ok: false, error: 'not_allowed', message: 'Điều ước này đã thành hiện thực rồi.' };
    var doer = assignee(w);
    if (doer && (side === doer || side === otherOf(doer))) {
      var p = {}; p[tapKey(doer)] = '';
      return { ok: true, patch: p };
    }
    return { ok: false, error: 'not_allowed', message: 'Không đổi được điều ước này.' };
  }

  /** Editing and deleting: the author only, until someone has tapped "Đã thành hiện thực". */
  function canChange(w, side) {
    if (!w || isDeleted(w) || w.author !== side) return false;
    var doer = assignee(w);
    return !(doer && tapOf(w, doer)) && !isGranted(w);
  }

  /** Everything one person sees: their cards plus the jar. */
  function stateFor(rows, side, today) {
    var cards = [];
    rows.forEach(function (w) { var c = view(w, side); if (c) cards.push(c); });
    return { me: { side: side }, cards: cards, jar: { count: jarFor(rows, side).length, drewToday: drewToday(rows, side, today) } };
  }

  return {
    LIMITS: LIMITS, CATEGORIES: CATEGORIES, JAR: JAR, FIELDS: FIELDS,
    otherOf: otherOf, assignee: assignee, isGranted: isGranted, grantedAt: grantedAt,
    clean: clean, normalizeLink: normalizeLink, validate: validate, checkRecipient: checkRecipient,
    jarFor: jarFor, drewToday: drewToday, view: view, grant: grant, ungrant: ungrant,
    canChange: canChange, stateFor: stateFor,
  };
})();
