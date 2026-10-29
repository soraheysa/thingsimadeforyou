/*
 * Settings shared by every page in this repo. This file is public: no emails, no codes.
 */
window.SHARED_CONFIG = {
  SERIES_NAME: 'Những thứ anh làm cho em',

  // Apps Script "Web app" URL (ends in /exec) of the Hai nửa backend.
  // It also handles sign-in for every page here. While empty, the site runs in preview mode.
  AUTH_API_URL: 'https://script.google.com/macros/s/AKfycbwReTu_3fDlmwowpR1tPRUYbXCQ4iQ30i0MsBxpu_JHZUKgGmv53ERpkI-ScrJJt50h4A/exec',

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
  //  status  → 'building' (Đang build) or 'idea' (Mới là ý tưởng): listed but not clickable.
  THINGS: [
    { path: 'hai-nua/', title: 'Hai nửa', text: 'Nhật ký tâm trạng của hai đứa mình, mỗi ngày một quẻ.' },
    { path: 'qua-giang-sinh/', title: 'Đoán quà Giáng sinh', text: 'Mỗi ngày một lượt đoán món quà anh chuẩn bị cho em.',
      opensAt: '2026-11-02T00:00:00+01:00' },   // 00:00 Monday 2 Nov in Germany = 06:00 in Vietnam
  ],
};
