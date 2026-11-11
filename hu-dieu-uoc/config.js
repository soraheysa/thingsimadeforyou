/*
 * Hũ điều ước — settings. This file is public: no emails, no codes.
 */
window.HU_CONFIG = {
  // The Hũ điều ước backend: Apps Script web app URL (ends in /exec). See backend/Code.gs.
  // Sign-in itself still goes through the Hai nửa backend (AUTH_API_URL in ../shared/config.js).
  // While empty, the page says it is being connected (preview mode with ?demo still works).
  API_URL: '',

  // These sides can open the page before its release date (THINGS in ../shared/config.js),
  // e.g. so Luân can fill the jar before Thư sees it. 'left' Luân, 'right' Thư.
  EARLY_SIDES: ['left'],

  // How often the page checks for changes while it is open.
  POLL_SECONDS: 60,

  // Names in sentences, by side.
  NAMES: { left: 'Luân', right: 'Thư' },
  // The pronoun each person uses for themself, and the other uses for them ("cho anh", "Em ước").
  SELF: { left: 'anh', right: 'em' },
};
