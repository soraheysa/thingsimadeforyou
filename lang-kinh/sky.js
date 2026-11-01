/*
 * Lăng kính — the sky behind the board.
 *
 * Phase (dawn / day / golden / night) comes from the sun's real height at the viewer's place.
 * Weather comes from Open-Meteo (free, no key). The place comes from the device location,
 * rounded to ~10 km, or from the timezone when location is blocked.
 */
(function () {
  'use strict';

  const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  /* ───── Sun height (NOAA approximation), in degrees above the horizon ───── */
  function sunElevation(lat, lon, date) {
    const rad = Math.PI / 180;
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const doy = Math.floor((date - start) / 864e5);
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = hour * 60 + eq + 4 * lon;                // true solar time, minutes
    const ha = (tst / 4 - 180) * rad;                     // hour angle
    const cosZ = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha);
    return { elevation: 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / rad, morning: ha < 0 };
  }

  function phaseAt(lat, lon, date) {
    const s = sunElevation(lat, lon, date || new Date());
    if (s.elevation < -6) return { phase: 'night', elevation: s.elevation };
    if (s.elevation < 9) return { phase: s.morning ? 'dawn' : 'golden', elevation: s.elevation };
    return { phase: 'day', elevation: s.elevation };
  }

  /* ───── Weather codes (WMO) → kind + Vietnamese label ───── */
  function weatherOf(code) {
    code = Number(code);
    if (code === 0) return { kind: 'clear', label: 'Trời quang' };
    if (code === 1 || code === 2) return { kind: 'partly', label: 'Ít mây' };
    if (code === 3) return { kind: 'overcast', label: 'Nhiều mây' };
    if (code === 45 || code === 48) return { kind: 'fog', label: 'Sương mù' };
    if (code >= 51 && code <= 57) return { kind: 'rain', label: 'Mưa phùn' };
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { kind: 'rain', label: 'Mưa' };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: 'snow', label: 'Tuyết' };
    if (code >= 95) return { kind: 'storm', label: 'Dông' };
    return { kind: 'partly', label: '' };
  }

  const weatherCache = {};
  async function fetchWeather(lat, lon) {
    const key = lat.toFixed(1) + ',' + lon.toFixed(1);
    const hit = weatherCache[key];
    if (hit && Date.now() - hit.at < 25 * 60e3) return hit.data;
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(2) + '&longitude=' + lon.toFixed(2) +
      '&current=temperature_2m,weather_code,is_day&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) throw new Error('weather ' + res.status);
    const j = await res.json();
    const data = { tempC: Math.round(j.current.temperature_2m), code: j.current.weather_code, tz: j.timezone };
    weatherCache[key] = { at: Date.now(), data };
    return data;
  }

  /* ───── Place: device location (rounded), else from the timezone ───── */
  function cityName(j) {
    const name = j.city || j.locality || j.principalSubdivision || '';
    if (/Hồ Chí Minh|Ho Chi Minh/i.test(name)) return 'TP.HCM';
    return name.replace(/^Thành phố /, '');
  }

  function fallbackPlace(fallbacks) {
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
    const f = (fallbacks || {})[tz];
    return f ? Object.assign({ tz, source: 'timezone' }, f) : null;
  }

  async function locate(fallbacks) {
    const key = 'tim_lk_place';
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key)); } catch (e) { /* none */ }
    if (cached && cached.source === 'device' && Date.now() - cached.at < 3 * 3600e3) return cached;
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
    const pos = await new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(p => res(p), () => res(null), { enableHighAccuracy: false, timeout: 12000, maximumAge: 3 * 3600e3 });
    });
    if (!pos) return cached || fallbackPlace(fallbacks);
    const lat = Math.round(pos.coords.latitude * 10) / 10;
    const lon = Math.round(pos.coords.longitude * 10) / 10;
    let city = cached && Math.abs(cached.lat - lat) < 0.05 && Math.abs(cached.lon - lon) < 0.05 ? cached.city : '';
    if (!city) {
      try {
        const r = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=vi');
        if (r.ok) city = cityName(await r.json());
      } catch (e) { /* offline: keep the coordinates */ }
    }
    if (!city) { const f = fallbackPlace(fallbacks); city = f ? f.city : ''; }
    const place = { lat, lon, city, tz, source: 'device', at: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(place)); } catch (e) { /* private mode */ }
    return place;
  }

  /* ───── Drawing ───── */
  const SKY = {
    dawn:   'linear-gradient(180deg, #27325E 0%, #5E5F99 28%, #C98B9F 58%, #F2B796 80%, #FBDDB4 100%)',
    day:    'linear-gradient(180deg, #2C6FC0 0%, #4E95DA 35%, #8EC3EC 72%, #D3E9F8 100%)',
    golden: 'linear-gradient(180deg, #3D5E9E 0%, #7F95C4 28%, #D9A98E 62%, #F4C27E 84%, #FCE3AE 100%)',
    night:  'linear-gradient(180deg, #050816 0%, #0D1533 40%, #1D2A57 85%, #2A3767 100%)',
  };
  const VEIL = { dawn: 'rgba(120,112,132,.55)', day: 'rgba(146,156,172,.6)', golden: 'rgba(132,122,132,.55)', night: 'rgba(14,18,34,.55)' };
  const HAZE = {
    dawn: 'linear-gradient(180deg, rgba(255,230,210,0), rgba(255,230,210,.35))',
    day: 'linear-gradient(180deg, rgba(255,255,255,0), rgba(255,255,255,.35))',
    golden: 'linear-gradient(180deg, rgba(255,225,180,0), rgba(255,225,180,.35))',
    night: 'linear-gradient(180deg, rgba(60,70,120,0), rgba(60,70,120,.25))',
  };
  const SUN = {
    dawn:   { x: '74%', halo: 'radial-gradient(circle, rgba(255,205,170,.6) 0%, rgba(255,180,150,.28) 22%, rgba(255,170,150,0) 58%)', glow: 'rgba(255,190,150,.6)' },
    day:    { x: '72%', halo: 'radial-gradient(circle, rgba(255,252,230,.7) 0%, rgba(255,248,215,.25) 20%, rgba(255,248,215,0) 55%)', glow: 'rgba(255,250,220,.75)' },
    golden: { x: '78%', halo: 'radial-gradient(circle, rgba(255,230,170,.7) 0%, rgba(255,200,120,.32) 24%, rgba(255,190,120,0) 60%)', glow: 'rgba(255,205,120,.7)' },
  };
  const CLOUD = {
    light: { dawn: ['#FFEFF2', '#D6A3B8'], day: ['#FFFFFF', '#D3DCE8'], golden: ['#FFF3E2', '#E2A88E'], night: ['#58628A', '#2A3358'] },
    heavy: { dawn: ['#C9B6C3', '#7D6E86'], day: ['#D3D8E0', '#8B94A3'], golden: ['#D4C1B6', '#86767F'], night: ['#3A4366', '#161B33'] },
  };
  // [left %, top as % of height, width in px, opacity]
  const LAYOUT = {
    clear:    [[12, 11, 280, 0.45]],
    partly:   [[4, 11, 300, 0.92], [30, 7, 220, 0.9], [57, 13, 270, 0.92], [83, 5, 210, 0.88], [16, 80, 340, 0.85], [64, 84, 300, 0.8]],
    overcast: [[-8, 1, 540, 0.96], [22, -2, 580, 0.96], [50, 2, 540, 0.96], [74, -1, 560, 0.96], [-4, 19, 440, 0.94], [36, 17, 480, 0.94], [66, 20, 500, 0.94], [8, 77, 540, 0.9], [58, 81, 580, 0.9]],
    rain:     [[-8, 0, 560, 1], [22, -3, 600, 1], [50, 1, 560, 1], [76, -2, 580, 1], [-4, 18, 460, 0.97], [34, 16, 500, 0.97], [64, 19, 520, 0.97], [86, 13, 420, 0.95], [8, 78, 560, 0.92], [58, 82, 600, 0.92]],
  };

  function draw(el, phase, kind, opts) {
    opts = opts || {};
    const small = window.innerWidth < 760;
    const heavy = kind === 'overcast' || kind === 'rain' || kind === 'storm' || kind === 'fog' || kind === 'snow';
    const layout = LAYOUT[kind === 'storm' ? 'rain' : kind === 'fog' || kind === 'snow' ? 'overcast' : kind] || LAYOUT.partly;
    const tone = CLOUD[heavy ? 'heavy' : 'light'][phase];
    const puff = 'radial-gradient(ellipse at 50% 28%, ' + tone[0] + ' 0%, ' + tone[0] + ' 38%, ' + tone[1] + ' 100%)';
    const base = 'linear-gradient(180deg, ' + tone[0] + ' 0%, ' + tone[1] + ' 100%)';
    const h = [];

    // stars
    const starFactor = { clear: 1, partly: 0.8, overcast: 0.12, fog: 0, rain: 0, storm: 0, snow: 0.05 }[kind];
    if (phase === 'night' && starFactor) {
      for (let i = 0; i < (small ? 50 : 90); i++) {
        h.push('<i class="sky-star" style="left:' + (rnd(i) * 100).toFixed(2) + '%;top:' + (Math.pow(rnd(i + 200), 1.6) * 88).toFixed(2) + '%;' +
          'width:' + (1 + rnd(i + 400) * 1.8).toFixed(1) + 'px;height:' + (1 + rnd(i + 400) * 1.8).toFixed(1) + 'px;' +
          'opacity:' + ((0.35 + rnd(i + 600) * 0.65) * starFactor).toFixed(2) + ';animation-duration:' + (2.5 + rnd(i + 800) * 3).toFixed(1) + 's;' +
          'animation-delay:-' + (rnd(i + 1000) * 4).toFixed(1) + 's"></i>');
      }
    }
    // moon
    if (phase === 'night') {
      const mo = { clear: 1, partly: 0.95, overcast: 0.3, fog: 0.2, rain: 0.15, storm: 0.1, snow: 0.2 }[kind];
      h.push('<div class="sky-moon" style="opacity:' + mo + '"><i class="sky-moon-halo"></i><i class="sky-moon-body"><b style="left:25%;top:30%;width:17%;height:14%"></b><b style="left:55%;top:52%;width:12%;height:11%"></b><b style="left:42%;top:66%;width:8%;height:7%"></b></i></div>');
    }
    // sun
    if (phase !== 'night') {
      const s = SUN[phase];
      const so = { clear: 1, partly: 1, overcast: 0.3, fog: 0.25, rain: 0, storm: 0, snow: 0.2 }[kind];
      const elev = opts.elevation == null ? 30 : opts.elevation;
      const top = phase === 'day' ? Math.max(9, 44 - (elev - 9) * 0.6) : Math.min(92, 80 - elev * 2.2);
      h.push('<div class="sky-sun" style="left:' + s.x + ';top:' + top.toFixed(1) + '%;opacity:' + so + '">' +
        '<i class="sky-sun-halo" style="background:' + s.halo + '"></i><i class="sky-sun-core" style="box-shadow:0 0 46px 14px ' + s.glow + '"></i></div>');
    }
    h.push('<i class="sky-layer" style="top:auto;height:30%;background:' + HAZE[phase] + '"></i>');
    if (heavy) h.push('<i class="sky-layer" style="background:' + VEIL[phase] + '"></i>');
    if (kind === 'fog') h.push('<i class="sky-layer" style="background:linear-gradient(180deg, rgba(220,225,232,.15), rgba(220,225,232,.55))"></i>');

    // clouds
    layout.forEach((c, i) => {
      const w = small ? Math.round(c[2] * 0.6) : c[2];
      h.push('<div class="sky-cloud" style="left:' + c[0] + '%;top:' + c[1] + '%;width:' + w + 'px;height:' + Math.round(w * 0.42) + 'px;' +
        'opacity:' + c[3] + ';filter:blur(' + (heavy ? 5 : 1.5) + 'px);animation-duration:' + (36 + Math.round(rnd(i + 3) * 30)) + 's;animation-delay:-' + Math.round(rnd(i + 9) * 30) + 's">' +
        '<i style="left:4%;top:52%;width:92%;height:48%;border-radius:999px;background:' + base + '"></i>' +
        '<i style="left:0;top:34%;width:38%;height:62%;background:' + puff + '"></i>' +
        '<i style="left:20%;top:6%;width:40%;height:86%;background:' + puff + '"></i>' +
        '<i style="left:46%;top:18%;width:34%;height:76%;background:' + puff + '"></i>' +
        '<i style="left:66%;top:38%;width:32%;height:60%;background:' + puff + '"></i></div>');
    });

    // rain / snow
    if (kind === 'rain' || kind === 'storm') {
      for (let i = 0; i < (small ? 60 : 90); i++) {
        const o = (0.25 + rnd(i + 90) * 0.35).toFixed(2);
        h.push('<i class="sky-rain" style="left:' + (rnd(i + 50) * 125 - 4).toFixed(2) + '%;height:' + Math.round(40 + rnd(i + 70) * 45) + 'px;' +
          'background:linear-gradient(180deg, rgba(210,225,255,0), rgba(210,225,255,' + o + '));' +
          'animation-duration:' + (0.7 + rnd(i + 110) * 0.45).toFixed(2) + 's;animation-delay:-' + (rnd(i + 130) * 1.2).toFixed(2) + 's"></i>');
      }
    }
    if (kind === 'snow') {
      for (let i = 0; i < (small ? 45 : 80); i++) {
        const s = (2 + rnd(i + 70) * 3).toFixed(1);
        h.push('<i class="sky-snow" style="left:' + (rnd(i + 50) * 100).toFixed(2) + '%;width:' + s + 'px;height:' + s + 'px;opacity:' + (0.5 + rnd(i + 90) * 0.5).toFixed(2) + ';' +
          'animation-duration:' + (7 + rnd(i + 110) * 6).toFixed(1) + 's;animation-delay:-' + (rnd(i + 130) * 12).toFixed(1) + 's"></i>');
      }
    }
    el.style.background = SKY[phase];
    el.dataset.phase = phase;
    el.dataset.weather = kind;
    el.innerHTML = h.join('');
  }

  window.LKSky = { sunElevation, phaseAt, weatherOf, fetchWeather, locate, draw };
})();
