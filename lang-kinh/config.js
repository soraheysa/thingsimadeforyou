/*
 * Lăng kính — settings. This file is public: no emails, no codes.
 */
window.LK_CONFIG = {
  // The Lăng kính backend: Apps Script web app URL (ends in /exec). See backend/Code.gs.
  // Sign-in itself still goes through the Hai nửa backend (AUTH_API_URL in ../shared/config.js).
  API_URL: '',

  // How often the board checks for the other person's new posts while it is open.
  POLL_SECONDS: 45,
  PAGE_SIZE: 20,

  CAPTION_MAX: 120,     // polaroid caption
  NOTE_MAX: 5000,       // sticky note
  STICKERS_PER_PERSON: 3,

  // Names in sentences ("Luân kẹp · 22:48"), by side.
  NAMES: { left: 'Luân', right: 'Thư' },
  // The pronoun each person uses for themself ("Anh đã dán 1/3", "Sticker của em").
  SELF: { left: 'anh', right: 'em' },

  // Paper colours (polaroid frame / sticky note). Text is always the shared purple.
  PAPERS: [
    { key: 'kem', name: 'Kem', hex: '#FFFDF9' },
    { key: 'bo', name: 'Bơ', hex: '#FFF1B8' },
    { key: 'hong', name: 'Hồng phấn', hex: '#FFE0EE' },
    { key: 'bacha', name: 'Bạc hà', hex: '#D4F2E0' },
    { key: 'troi', name: 'Trời', hex: '#D6E9F8' },
    { key: 'oaihuong', name: 'Oải hương', hex: '#E9E0F7' },
  ],

  // When location is blocked: the sky follows the timezone instead.
  FALLBACK_PLACES: {
    'Europe/Berlin': { city: 'Pinneberg', lat: 53.66, lon: 9.8 },
    'Asia/Ho_Chi_Minh': { city: 'TP.HCM', lat: 10.82, lon: 106.63 },
    'Asia/Saigon': { city: 'TP.HCM', lat: 10.82, lon: 106.63 },
  },
  // The other person's sky before they have opened the board once.
  DEFAULT_PLACES: {
    left: { city: 'TP.HCM', lat: 10.82, lon: 106.63, tz: 'Asia/Ho_Chi_Minh' },
    right: { city: 'Pinneberg', lat: 53.66, lon: 9.8, tz: 'Europe/Berlin' },
  },
};
