// แท็บ "ฝน": เรดาร์ฝนสด (RainViewer) + วิเคราะห์กลุ่มฝนรอบบ้าน + พยากรณ์รายชั่วโมง (Open-Meteo)
import { whenLib } from './lib.js';
import { classifyPixel, denoise, analyze, approach, firstRainWindow, pxKm, lonLatToPixel, dirName, RAIN_LEVEL } from './rain-core.js';

const RADAR_API = 'https://api.rainviewer.com/public/weather-maps.json';
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const RADAR_REFRESH_MS = 5 * 60 * 1000;
const FORECAST_REFRESH_MS = 15 * 60 * 1000;
const ANALYZE_Z = 7; // RainViewer ฟรีให้ละเอียดสุดที่ซูม 7 (~1.2 กม./พิกเซล)
const RAIN_COLORS = ['transparent', '#cec086', '#88ddee', '#0077aa', '#ffaa00', '#ff2050'];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtHM = (t) => new Date(t).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const fmtDayHM = (t) => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', hour: '2-digit', minute: '2-digit' });
// เวลาจาก Open-Meteo เป็นเวลาไทยไม่มีโซน เช่น "2026-10-03T18:00"
const omTime = (s) => Date.parse(`${s}:00+07:00`);

let ctx = null;          // { home, calm }
let map = null;
let frames = [];         // [{ time, path, layer }]
let host = '';
let frameIdx = 0;
let playing = false;
let playTimer = 0;
let radarTimer = 0;
let fcTimer = 0;
let fcChart = null;
let started = false;

export function initRain(context) {
  ctx = context;
  if (started) { map?.invalidateSize(); return; }
  started = true;
  $('#radar-play').addEventListener('click', () => (playing ? pause() : play()));
  $('#radar-slider').addEventListener('input', (e) => { pause(); showFrame(Number(e.target.value)); });
  loadRadar(); // วิเคราะห์ฝนได้ทันที ไม่ต้องรอไลบรารีแผนที่
  whenLib('L').then((ok) => {
    buildMap(ok);
    if (ok) { frames = []; loadRadar(); } // แผนที่พร้อมแล้ว → ใส่ภาพเรดาร์ลงแผนที่
  });
  loadForecast();
  radarTimer = setInterval(loadRadar, RADAR_REFRESH_MS);
  fcTimer = setInterval(loadForecast, FORECAST_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('#tab-rain').hidden) { loadRadar(); loadForecast(); }
  });
}

/* ---------------- แผนที่เรดาร์ ---------------- */
function buildMap(libOk = !!window.L) {
  if (!libOk) { $('#radar-map').innerHTML = '<p class="card muted">โหลดแผนที่ไม่ได้ (ต้องใช้อินเทอร์เน็ต) — การวิเคราะห์ฝนด้านบนยังใช้ได้</p>'; return; }
  const { lat, lon } = ctx.home;
  map = L.map('radar-map', { zoomControl: true, maxZoom: 11, minZoom: 5 }).setView([lat, lon], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, className: 'dark-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · เรดาร์ <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>',
  }).addTo(map);
  for (const km of [10, 25, 50]) {
    L.circle([lat, lon], { radius: km * 1000, color: '#39c6ff', weight: 1.5, opacity: 0.75, fill: false, dashArray: '4 6', interactive: false }).addTo(map);
    L.marker([lat + km / 111, lon], { interactive: false, icon: L.divIcon({ className: 'ring-label', html: `${km} กม.`, iconSize: [44, 14], iconAnchor: [22, 7] }) }).addTo(map);
  }
  L.marker([lat, lon], { icon: L.divIcon({ className: 'home-marker', html: '🏠', iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 1000 }).addTo(map);
}

async function loadRadar() {
  try {
    const d = await (await fetch(`${RADAR_API}?t=${Date.now()}`, { cache: 'no-store' })).json();
    host = d.host;
    const past = d.radar?.past || [];
    if (!past.length) throw new Error('ไม่มีภาพเรดาร์');
    const latestNew = past.at(-1).time !== frames.at(-1)?.time;
    if (map && latestNew) {
      frames.forEach((f) => f.layer?.remove());
      frames = past.map((f) => ({
        time: f.time * 1000,
        path: f.path,
        // ใช้ภาพดิบ (0_0) ให้ตรงกับที่วิเคราะห์ — ภาพแบบนุ่ม (1_x) ลบกลุ่มฝนเล็กทิ้ง
        layer: L.tileLayer(`${host}${f.path}/256/{z}/{x}/{y}/2/0_0.png`, {
          maxNativeZoom: ANALYZE_Z, maxZoom: 11, opacity: 0, zIndex: 10, className: 'radar-tiles',
        }).addTo(map),
      }));
      const slider = $('#radar-slider');
      slider.max = frames.length - 1;
      showFrame(frames.length - 1);
      if (!ctx.calm && !document.hidden) play();
    } else if (!map) {
      frames = past.map((f) => ({ time: f.time * 1000, path: f.path }));
    }
    await analyzeRain(past);
  } catch (err) {
    $('#rain-now').dataset.level = 'x';
    $('#rain-now-title').textContent = 'โหลดเรดาร์ไม่ได้';
    $('#rain-now-detail').textContent = `${err.message || err} — ลองเปิดเรดาร์ กทม. จากปุ่มด้านล่าง`;
  }
}

function showFrame(i) {
  if (!frames.length) return;
  frameIdx = (i + frames.length) % frames.length;
  frames.forEach((f, j) => f.layer?.setOpacity(j === frameIdx ? 0.8 : 0));
  const f = frames[frameIdx];
  const latest = frameIdx === frames.length - 1;
  const ago = Math.round((Date.now() - f.time) / 60000);
  $('#radar-time').textContent = `${fmtHM(f.time)} ${latest ? `· ล่าสุด (${ago} นาทีที่แล้ว)` : `· ${ago} นาทีที่แล้ว`}`;
  $('#radar-time').classList.toggle('latest', latest);
  $('#radar-slider').value = frameIdx;
}

function play() {
  playing = true;
  $('#radar-play').textContent = '⏸';
  $('#radar-play').setAttribute('aria-label', 'หยุด');
  clearTimeout(playTimer);
  const step = () => {
    if (!playing) return;
    const next = frameIdx + 1;
    showFrame(next >= frames.length ? 0 : next);
    // ค้างที่ภาพล่าสุดนานขึ้น ให้เห็นสถานการณ์ปัจจุบันชัด
    playTimer = setTimeout(step, frameIdx === frames.length - 1 ? 1800 : 500);
  };
  playTimer = setTimeout(step, 500);
}

function pause() {
  playing = false;
  clearTimeout(playTimer);
  $('#radar-play').textContent = '▶';
  $('#radar-play').setAttribute('aria-label', 'เล่น');
}

/* ---------------- วิเคราะห์กลุ่มฝนรอบบ้าน ---------------- */
async function loadGrid(path) {
  const { lat, lon } = ctx.home;
  const p = lonLatToPixel(lon, lat, ANALYZE_Z);
  const tx = Math.floor(p.x / 256);
  const ty = Math.floor(p.y / 256);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 768;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `${host}${path}/256/${ANALYZE_Z}/${tx + dx}/${ty + dy}/2/0_0.png`; // ไม่ทำ smooth = สีตรง
      jobs.push(img.decode().then(() => g.drawImage(img, (dx + 1) * 256, (dy + 1) * 256)));
    }
  }
  await Promise.all(jobs);
  const data = g.getImageData(0, 0, 768, 768).data;
  const levelAt = (x, y) => {
    if (x < 0 || y < 0 || x >= 768 || y >= 768) return 0;
    const i = (y * 768 + x) * 4;
    return classifyPixel(data[i], data[i + 1], data[i + 2], data[i + 3]);
  };
  return { levelAt: denoise(levelAt), hx: p.x - (tx - 1) * 256, hy: p.y - (ty - 1) * 256 };
}

async function analyzeRain(past) {
  const km = pxKm(ANALYZE_Z, ctx.home.lat);
  const now = past.at(-1);
  const before = past[Math.max(0, past.length - 4)]; // ~30 นาทีก่อน
  const [gNow, gBefore] = await Promise.all([loadGrid(now.path), before !== now ? loadGrid(before.path) : null]);
  const aNow = analyze(gNow.levelAt, gNow.hx, gNow.hy, km);
  const aBefore = gBefore ? analyze(gBefore.levelAt, gBefore.hx, gBefore.hy, km) : null;
  const trend = approach(aBefore, aNow, (now.time - before.time) / 60);
  renderNow(aNow, trend, now.time * 1000);
}

function renderNow(a, trend, time) {
  const box = $('#rain-now');
  let title;
  let detail = [];
  let level = a.atHome;
  if (a.atHome >= 2) {
    title = `🌧️ ${RAIN_LEVEL[a.atHome]}เหนือบ้านตอนนี้`;
    if (trend?.trend === 'away') detail.push('กลุ่มฝนกำลังเคลื่อนออก');
  } else if (a.nearest) {
    level = a.nearest.level;
    const d = Math.round(a.nearest.km);
    title = d <= 10 ? `🌦️ ฝนใกล้บ้าน ${d} กม.` : `⛅ ยังไม่มีฝนเหนือบ้าน`;
    detail.push(`กลุ่มฝนใกล้สุด ${d} กม. ทิศ${dirName(a.nearest.bearing)} (${RAIN_LEVEL[a.nearest.level]})`);
    if (trend?.trend === 'closer') {
      detail.push(trend.etaMin != null
        ? `กำลังเข้าใกล้ ~${Math.round(trend.speed)} กม./ชม. อาจถึงใน ~${trend.etaMin} นาที (ประมาณคร่าวๆ)`
        : `กำลังเข้าใกล้ช้าๆ`);
    } else if (trend?.trend === 'new') detail.push('มีกลุ่มฝนก่อตัวใหม่ใกล้บ้าน — บอกเวลาถึงไม่ได้');
    else if (trend?.trend === 'away') detail.push('กำลังเคลื่อนออกห่าง');
    else if (trend?.trend === 'steady') detail.push('ระยะทรงตัวใน 30 นาทีที่ผ่านมา');
  } else {
    title = '☀️ ไม่มีฝนในรัศมี 100 กม.';
    level = 0;
  }
  if (a.maxNear >= 4) detail.push(`⚠️ มี${RAIN_LEVEL[a.maxNear]}ในรัศมี 25 กม.`);
  box.dataset.level = String(level);
  $('#rain-now-title').textContent = title;
  $('#rain-now-detail').textContent = detail.join(' · ');
  $('#rain-now-time').textContent = `จากเรดาร์เวลา ${fmtHM(time)}`;
}

/* ---------------- พยากรณ์รายชั่วโมง ---------------- */
async function loadForecast() {
  const { lat, lon } = ctx.home;
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'Asia/Bangkok', forecast_days: 3,
    hourly: 'precipitation_probability,precipitation',
    minutely_15: 'precipitation', forecast_minutely_15: 12,
    daily: 'precipitation_sum,precipitation_probability_max',
  });
  try {
    const d = await (await fetch(`${FORECAST_API}?${q}`)).json();
    renderForecast(d);
  } catch {
    $('#fc-summary').textContent = 'โหลดพยากรณ์ไม่ได้ — ดูจากกรมอุตุฯ ด้านล่าง';
  }
}

async function renderForecast(d) {
  const now = Date.now();
  const hTimes = d.hourly.time.map(omTime);
  let from = hTimes.findIndex((t) => t + 3600e3 > now);
  if (from < 0) from = 0;
  const w = firstRainWindow(hTimes, d.hourly.precipitation_probability, d.hourly.precipitation, from, 24);
  $('#fc-summary').innerHTML = w.found
    ? `🌧️ ${w.totalMm >= 10 ? 'ฝนหนัก' : w.totalMm >= 2 ? 'ฝน' : 'ฝนเล็กน้อย'}น่าจะตก <b>${esc(fmtDayHM(w.start))} – ${esc(fmtHM(w.end + 3600e3))}</b> · โอกาสสูงสุด ${w.maxProb}% · รวม ~${w.totalMm} มม.`
    : `☀️ 24 ชม. ข้างหน้าโอกาสฝนต่ำ (สูงสุด ${w.maxProb}%)`;

  // 3 ชม. ข้างหน้า ทีละ 15 นาที
  const mTimes = d.minutely_15.time.map(omTime);
  $('#fc-15').innerHTML = mTimes.map((t, i) => {
    const mm = d.minutely_15.precipitation[i] ?? 0;
    const lv = mm >= 2.5 ? 4 : mm >= 1 ? 3 : mm >= 0.1 ? 2 : 0; // มม. ต่อ 15 นาที
    return `<div class="fc15" title="${mm} มม.">
      <span class="fc15-bar" style="--h:${Math.min(100, mm * 30)}%;--c:${lv ? RAIN_COLORS[lv] : 'rgba(255,255,255,.08)'}"></span>
      <span class="fc15-t">${fmtHM(t)}</span></div>`;
  }).join('');

  // รายวัน
  const days = ['วันนี้ (ทั้งวัน)', 'พรุ่งนี้', 'มะรืน'];
  $('#fc-days').innerHTML = d.daily.time.map((t, i) => {
    const mm = d.daily.precipitation_sum[i] ?? 0;
    const cls = mm >= 35 ? 'heavy' : mm >= 10 ? 'mod' : '';
    return `<div class="fc-day ${cls}"><b>${days[i] || esc(t)}</b><span class="fc-mm">${mm.toFixed(1)} มม.</span><span class="muted">โอกาส ${d.daily.precipitation_probability_max[i] ?? '-'}%</span></div>`;
  }).join('');

  // กราฟ 48 ชม.
  const n = Math.min(48, hTimes.length - from);
  const labels = hTimes.slice(from, from + n);
  const prob = d.hourly.precipitation_probability.slice(from, from + n);
  const mm = d.hourly.precipitation.slice(from, from + n);
  if (!(await whenLib('Chart', 10000))) return;
  fcChart?.destroy();
  fcChart = new Chart($('#fc-chart'), {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'ฝน (มม./ชม.)', data: mm, yAxisID: 'mm', backgroundColor: mm.map((v) => (v >= 10 ? '#ff2050' : v >= 3 ? '#ffaa00' : v >= 0.5 ? '#0077aa' : '#88ddee')), borderRadius: 3 },
        { type: 'line', label: 'โอกาสฝน (%)', data: prob, yAxisID: 'p', borderColor: '#39c6ff', borderWidth: 2, pointRadius: 0, tension: 0.3 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: ctx.calm ? false : { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8ea3c4', boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { title: (it) => fmtDayHM(labels[it[0].dataIndex]) } },
      },
      scales: {
        x: { ticks: { color: '#8ea3c4', maxTicksLimit: 6, maxRotation: 0, callback: (v, i) => fmtDayHM(labels[i]) }, grid: { display: false } },
        mm: { position: 'left', beginAtZero: true, suggestedMax: 5, ticks: { color: '#8ea3c4' }, grid: { color: 'rgba(120,180,255,.08)' } },
        p: { position: 'right', min: 0, max: 100, ticks: { color: '#39c6ff', callback: (v) => `${v}%` }, grid: { display: false } },
      },
    },
  });
}
