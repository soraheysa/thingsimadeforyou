/*
 * Everything in this file is public (it lives in your GitHub repo).
 * Do NOT put the access code or any email address here.
 */
window.APP_CONFIG = {
  APP_NAME: 'Hai nửa',

  // The backend address and sign-in live in ../shared/config.js (AUTH_API_URL).

  // How often the page checks for the other person's updates while it is open.
  POLL_SECONDS: 45,

  // Mood list. "bg" colours that person's half, "ink" is the text colour on top of it,
  // "soft" is used for cards and fields inside the half.
  // {them} in a label becomes the other person's pronoun: Luân sees "Nhớ em", Thư sees "Nhớ anh".
  MOODS: [
    { key: 'radiant', emoji: '☀️', label: 'Rạng rỡ',   bg: '#FFD84D', ink: '#3A2A00', soft: '#FFE88F' },
    { key: 'happy',   emoji: '😊', label: 'Vui',       bg: '#FFB38A', ink: '#3B1A0A', soft: '#FFD0B5' },
    { key: 'loved',   emoji: '🥰', label: 'Được thương', bg: '#F7A1C4', ink: '#3D0F24', soft: '#FBC6DB' },
    { key: 'excited', emoji: '✨', label: 'Háo hức',   bg: '#B7F36B', ink: '#1E3300', soft: '#D3F8A3' },
    { key: 'dreamy',  emoji: '🔮', label: 'Mơ màng',   bg: '#B79CED', ink: '#24104A', soft: '#CDBBF3' },
    { key: 'calm',    emoji: '🌿', label: 'Bình yên',  bg: '#A8D5BA', ink: '#10301F', soft: '#C9E6D4' },
    { key: 'tired',   emoji: '😴', label: 'Mệt',       bg: '#C9C3D9', ink: '#2B2640', soft: '#DEDAE8' },
    { key: 'missing', emoji: '🌙', label: 'Nhớ {them}', bg: '#2E3A73', ink: '#EEF0FF', soft: '#45518C' },
    { key: 'sad',     emoji: '🌧️', label: 'Buồn',      bg: '#7FA7C9', ink: '#0D2233', soft: '#A7C3DB' },
    { key: 'grumpy',  emoji: '🌋', label: 'Khó ở',     bg: '#7A2834', ink: '#FFE9EB', soft: '#934250' },
  ],

  // Colours of each half before a mood is picked today.
  // Left (Luân): pink with purple ink. Right (Thư): orange with purple ink.
  // Purple, the colour you share, marks everything shared (the joint slip, the plans badge).
  NO_MOOD: {
    left:  { bg: '#FF9DD1', ink: '#3A1A47', soft: '#FFC6E5' },
    right: { bg: '#E07306', ink: '#160719', soft: '#F09A47' },
  },

  // How a person is called in sentences on the OTHER person's screen.
  // left: 'gà con' → Thư sees "Cho gà con xem quẻ này", "Lời nhắn cho gà con", "Gà con nhắn em".
  // Your big name heading stays "Luân". Leave a side out to use the real name.
  CALL_NAMES: {
    left: 'gà con',
  },
};
