/*
 * Settings shared by every page in this repo. This file is public: no emails, no codes.
 */
// Launch of the "nhớ" heart: 00:00 Saturday 7 Nov in Germany = 06:00 in Vietnam. Used twice below.
const NHO_OPENS_AT = '2026-11-07T00:00:00+01:00';
// Thư lands in Vietnam: 07:00 Friday 15 Jan 2027 in Vietnam = 01:00 in Germany. This is only the plan:
// once she sends her ticket (Quà Giáng sinh page), the countdown follows the real flight, delays included.
// Keep it the same as RIGHT_ARRIVES_AT in the Nhớ backend's Script properties.
const RETURN_AT = '2027-01-15T07:00:00+07:00';

window.SHARED_CONFIG = {
  SERIES_NAME: 'Những thứ anh làm cho em',

  // Apps Script "Web app" URL (ends in /exec) of the Hai nửa backend.
  // It also handles sign-in for every page here. While empty, the site runs in preview mode.
  AUTH_API_URL: 'https://script.google.com/macros/s/AKfycbwReTu_3fDlmwowpR1tPRUYbXCQ4iQ30i0MsBxpu_JHZUKgGmv53ERpkI-ScrJJt50h4A/exec',

  // These sides open every feature before its launch date (opensAt below, and the Nhớ heart),
  // to fill it in and test it. The home list marks such items "Chỉ anh thấy". 'left' Luân, 'right' Thư.
  // Thư's side stays locked until each launch; to stop early access, empty the list: [].
  EARLY_ACCESS_SIDES: ['left'],

  // First screen.
  INVITE_TITLE: 'Thư ơi, chơi cùng anh nhé?',
  INVITE_TEXT: 'Một chuỗi trò chơi nhỏ trên mạng, anh làm riêng cho em. Đăng nhập một lần ở đây là mở được tất cả.',
  INVITE_BUTTON: 'Em đồng ý',

  // 'visit'  → every new visit starts with the email screen (email already filled in, one tap).
  // 'device' → only new devices are asked; return visits go straight in.
  CONFIRM_EMAIL: 'visit',

  // Welcome on the home page, by side (right = Thư, left = Luân). Leave a side out for "Chào <name>".
  WELCOME: {
    right: {
      title: 'Baby của anh ơi,',
      text: 'Đây là những trò con bò anh làm cho em, có những cái đã xong, có cái đang build, có cái chỉ mới là ý tưởng. Em có thể chọn cái nào muốn chơi trong list dưới đây nhé.',
    },
  },

  // The list on the home page. "path" is the folder in this repo.
  //  opensAt → locked until this moment, with a countdown (ISO time with its UTC offset).
  //            Germany is UTC+01:00 in winter and UTC+02:00 in summer.
  //  teaser  → while locked, show this title and status instead of the real title and text.
  //            teaser.countdown replaces the status line; {time} becomes the countdown.
  //  hideWhenOpen → drop the item from the list once it opens (for countdowns that aren't pages).
  //  status  → 'building' (Đang build) or 'idea' (Mới là ý tưởng): listed but not clickable.
  //  hiddenUntilOpen → not listed at all until opensAt (instead of a locked row with a countdown),
  //                    except for EARLY_ACCESS_SIDES.
  THINGS: [
    { path: 'hai-nua/', title: 'Hai nửa', text: 'Nhật ký tâm trạng của hai đứa mình, mỗi ngày một quẻ.' },
    { path: 'qua-giang-sinh/', title: 'Đoán quà Giáng sinh', text: 'Mỗi ngày một lượt đoán món quà anh chuẩn bị cho em.',
      opensAt: '2026-11-02T00:00:00+01:00' },   // 00:00 Monday 2 Nov in Germany = 06:00 in Vietnam
    // Countdown for the heart (not a page of its own): disappears at launch, when the heart card appears above.
    { path: 'nho/', title: 'Anh nhớ em', opensAt: NHO_OPENS_AT, hideWhenOpen: true,
      teaser: { title: 'Tính năng mới sắp được ra mắt', countdown: 'Còn {time} nữa nhé' } },
    { path: 'lang-kinh/', title: 'Lăng kính',
      text: 'Thế giới của riêng hai đứa mình, nơi mà những khoảnh khắc chỉ mình muốn cho nhau xem.',
      opensAt: '2026-11-19T00:00:00+07:00',     // 00:00 19 Nov in Vietnam = 18:00 18 Nov in Germany
      teaser: { title: 'Trò này sẽ được ra mắt sớm thôi nhé', status: 'Coming soon on my birthday' } },
    { path: 'dieu-uoc-cho-nhau/', title: 'Điều ước cho nhau',
      text: 'Thả vào hũ những điều mình ước, rồi mỗi ngày bốc một điều ước của nhau.',
      opensAt: '2026-12-26T00:00:00+01:00',     // after Christmas, Thư's time: 00:00 26 Dec in Germany = 06:00 in Vietnam
      teaser: { title: 'Lại thêm một trò nữa cho anh và em chơi với nhau', countdown: 'Coming soon in {time}' } },
    // The letters. Not listed for Thư until she lands (hiddenUntilOpen); EARLY_ACCESS_SIDES see it before, to check it.
    { path: 'thu-gui-em/', title: 'Những bức Thư anh gửi đến em', text: 'Nơi cất những lá thư anh viết cho em.',
      opensAt: RETURN_AT, hiddenUntilOpen: true },
  ],

  // Countdown to Thư's landing (shared/venha.js), right below the Nhớ card on the home page.
  // The letters (the welcome-home one included) live in the Nhớ Google Sheet, tab NH_Letters.
  RETURN: {
    AT: RETURN_AT,
    ARRIVED_HOURS: 48,   // "Em về rồi" stays this long after landing, then the banner goes away
    TEXT: {
      kicker: { left: 'Thư về nhà', right: 'Em về nhà' },   // above the countdown, by side
      arrived: 'Em về rồi 🧡',
      arrivedSub: { left: 'Thư đã về tới Việt Nam.', right: 'Chào mừng em về nhà.' },
      preview: 'Xem thử màn hình chào',                      // Luân only
      close: 'Cất thư',                                     // button under a letter
      stored: 'Lá thư này được cất trong “Những bức Thư anh gửi đến em”.',
    },
  },

  // The "Anh nhớ em / Em nhớ anh" heart (shared/nho.js), on the home page and in Hai nửa.
  // Sleep times and Thư's landing time live in the backend: nho/backend/Code.gs and its Script properties.
  NHO: {
    // Hidden until this moment (ISO time with its UTC offset). 00:00 Saturday 7 Nov in Germany = 06:00 in Vietnam.
    OPENS_AT: NHO_OPENS_AT,
    // These sides see it early, to test: 'left' Luân, 'right' Thư.
    EARLY_SIDES: ['left'],
    // Apps Script "Web app" URL (ends in /exec) of nho/backend/Code.gs. While empty, the heart is hidden
    // (in preview mode it works with fake data).
    API_URL: 'https://script.google.com/macros/s/AKfycbxnAfyVvUUmvhM_1px8vsm5vWaOCIgJkvvZ14n615Mc_RaqxJcLqB-YB_bgRjQhVWUa/exec',
    // Firebase → Project settings → General → Your apps → Web app → firebaseConfig. Public, safe to keep here.
    FIREBASE: {
      apiKey: 'AIzaSyC2ckH34JOWFbUWC0iGFXNd3ufVRtiUTII',
      authDomain: 'our-story-74c5d.firebaseapp.com',
      projectId: 'our-story-74c5d',
      messagingSenderId: '5045486295',
      appId: '1:5045486295:web:cee87e9395661a6115e692',
    },
    // Firebase → Project settings → Cloud Messaging → Web Push certificates → Key pair.
    VAPID_KEY: 'BAI_54jJLBUlQ-j7UfFGRDDfNgR3APbNHLtMLCOPSr5ACnBskXa7fgy0LT86mFAb-ccHdqVZssk7jevqIfNI6CU',
    // How the other person is called on your screen, by side (left = Luân). Leave a side out for the real name.
    CALL_NAMES: { left: 'gà con' },
    COOLDOWN_SECONDS: 3,   // the heart rests this long after each tap
    POLL_SECONDS: 60,      // how often open pages refresh the counters
  },

  // The installed app ("Our Story" on the home screen), see shared/pwa.js.
  APP: {
    INSTALL_SIDES: ['right'],                    // who sees the "add to home screen" banner: 'left' Luân, 'right' Thư
    SUBTITLE: 'Những thứ anh làm cho mình',      // under "Our Story" on the fingerprint screen
    UNLOCK_TEXT: {                               // above the fingerprint button, by side
      right: 'Thư yêu của anh chạm vân tay để vào nhé',
      left: 'Chạm vân tay để vào nhé',
    },
  },
};
