// เว็บแอปเตือนภัยน้ำท่วม — อ่าน data/latest.json ที่ scripts/fetch.mjs สร้าง
import { initRain } from './rain.js';
const REFRESH_MS = 5 * 60 * 1000;
const HOME_FALLBACK = { lat: 13.91, lon: 100.70 };
const STALE_DATA_MIN = 75;           // ไฟล์ข้อมูลเก่ากว่านี้ = เตือนให้เช็กเอง
const RED_REPEAT_MS = 15 * 60 * 1000;
const RANK = { stale: -1, unknown: -1, green: 0, yellow: 1, orange: 2, red: 3 };

const LABEL = {
  green: 'ปกติ', yellow: 'เฝ้าระวัง', orange: 'เตรียมพร้อม', red: 'น้ำกำลังมา',
  unknown: 'ข้อมูลไม่พอ', stale: 'ข้อมูลขัดข้อง',
};
const EMOJI = { green: '🟢', yellow: '🟡', orange: '🟠', red: '🔴', unknown: '⚪', stale: '⚪' };
const ACTIONS = {
  green: ['ใช้ชีวิตปกติ', 'เปิดแอปดูวันละครั้งพอ'],
  yellow: ['เช็กของจำเป็น ไฟฉาย ยา เอกสาร', 'เอากระสอบทราย/แผ่นกั้นน้ำมาไว้ใกล้ประตู', 'ดูคลองหนองระแหงถี่ขึ้น (เช้า-เย็น) แล้วบันทึกไม้วัด'],
  orange: ['ติดแผ่นกั้นน้ำ อุดท่อ/รูระบายในบ้าน', 'ยกของมีค่า เครื่องใช้ไฟฟ้าขึ้นชั้น 2', 'เตรียมย้ายรถไปที่สูง', 'ดูคลองทุก 1–2 ชม.'],
  red: ['ย้ายรถไปที่สูงทันที', 'ตัดไฟชั้นล่าง', 'ขึ้นชั้น 2 พร้อมของจำเป็น', 'ต้องการช่วยเหลือ โทร 1555 / 1784'],
  unknown: ['ระบบดึงข้อมูลคลองใกล้บ้านไม่ได้', 'ไปดูคลองหนองระแหงด้วยตาเอง', 'ติดตามข่าว กทม. / ปภ.'],
};
const LEGEND = [
  ['green', 'ปกติ', 'คลองใกล้บ้านต่ำกว่าตลิ่งเกิน 50 ซม. และน้ำไม่ขึ้นเร็ว'],
  ['yellow', 'เฝ้าระวัง', 'คลองใกล้บ้านเหลือ < 50 ซม. ถึงตลิ่ง หรือ น้ำเหนือใกล้ล้น หรือ ทางระบายใต้เต็ม'],
  ['orange', 'เตรียมพร้อม', 'คลองใกล้บ้านเหลือ < 20 ซม. หรือ < 50 ซม. และกำลังขึ้น หรือ น้ำเหนือใกล้ล้นพร้อมทางระบายเต็ม'],
  ['red', 'น้ำกำลังมา', 'คลองใกล้บ้านถึงตลิ่ง (ยืนยัน 2 รอบติดกัน)'],
  ['stale', 'ข้อมูลขัดข้อง', 'สถานีไม่ส่งข้อมูลนานเกินไป — ไม่นำมาตัดสิน'],
];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const fmtTime = (t) => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtHM = (t) => new Date(t).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const fmtDayHM = (t) => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const ageMin = (t) => (Date.now() - t) / 60000;
const fmtAge = (m) => (m < 60 ? `${Math.max(0, Math.round(m))} นาที` : m < 2880 ? `${Math.round(m / 60)} ชม.` : `${Math.round(m / 1440)} วัน`);
const cm = (m) => `${Math.round(m * 100)} ซม.`;
const fmtRate = (r) => (r === null || r === undefined ? '' : Math.abs(r) < 0.005 ? 'ทรงตัว' : `${r > 0 ? '▲ ขึ้น' : '▼ ลด'} ${Math.abs(Math.round(r * 100))} ซม./ชม.`);

let DATA = null;
let STALE_VIEW = false; // ไฟล์ข้อมูลเก่าเกิน → แผนผัง/แผนที่เป็นสีเทาทั้งหมด กันเข้าใจผิดจากค่าเก่า
let HISTORY = null;
let calm = false;
let map = null;
let mapLayer = null;
const charts = [];

/* ---------------- โหมดลดอนิเมชัน ---------------- */
async function decideCalm() {
  const manual = store.get('calm', null);
  let auto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      if (!b.charging && b.level < 0.2) auto = true;
    }
  } catch { /* ไม่รองรับ */ }
  calm = manual ?? auto;
  document.documentElement.classList.toggle('calm', calm);
  $('#calm-toggle').checked = calm;
}

/* ---------------- โหลดข้อมูล ---------------- */
async function load() {
  try {
    const res = await fetch(`data/latest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    DATA = await res.json();
    store.set('lastData', DATA);
    HISTORY = null; // โหลดใหม่เมื่อเปิดการ์ด
  } catch {
    DATA = DATA || store.get('lastData', null);
  }
  render();
}

async function loadHistory() {
  if (HISTORY) return HISTORY;
  try {
    const res = await fetch(`data/history.json?t=${DATA?.generatedAt || Date.now()}`);
    HISTORY = await res.json();
  } catch { HISTORY = {}; }
  return HISTORY;
}

/* ---------------- render ---------------- */
function render() {
  if (!DATA) {
    $('#hero-label').textContent = 'โหลดข้อมูลไม่ได้';
    $('#hero-reason').textContent = 'เช็กอินเทอร์เน็ต แล้วดูคลองหนองระแหงด้วยตาเอง';
    showBanner('⚠️ โหลดข้อมูลไม่ได้ — ช่วยเช็กน้ำเอง');
    return;
  }
  const age = ageMin(DATA.generatedAt);
  const dataStale = age > STALE_DATA_MIN;
  STALE_VIEW = dataStale;
  const st = dataStale ? 'unknown' : DATA.overall.status;

  const hero = $('#hero');
  hero.dataset.status = st;
  $('#hero-label').textContent = `${EMOJI[st]} ${LABEL[st]}`;
  $('#hero-reason').textContent = dataStale
    ? `ข้อมูลไม่อัปเดตมา ${fmtAge(age)} — ช่วยเช็กน้ำเอง (สถานะล่าสุดที่รู้: ${LABEL[DATA.overall.status]})`
    : DATA.overall.reasons.join(' · ');

  for (const chip of document.querySelectorAll('.chip')) chip.dataset.status = dataStale ? 'stale' : DATA.groups[chip.dataset.g];

  const acts = ACTIONS[st] || ACTIONS.unknown;
  $('#actions').innerHTML = `<h3>ควรทำตอนนี้</h3><ul>${acts.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`;
  $('#updated').textContent = `อัปเดต ${fmtTime(DATA.generatedAt)}`;

  const src = DATA.sources;
  const failed = [];
  if (!src.bma.ok && !(src.popnix?.ok && src.popnix.used > 0)) failed.push('กทม.');
  if (!src.tw.ok) failed.push('ThaiWater');
  if (dataStale) showBanner(`⚠️ ข้อมูลไม่อัปเดตมา ${fmtAge(age)} — ระบบอาจขัดข้อง ช่วยเช็กน้ำเอง`);
  else if (failed.length) showBanner(`⚠️ ดึงข้อมูล ${failed.join(', ')} ไม่ได้รอบล่าสุด — บางสถานีอาจเป็นค่าเก่า`);
  else showBanner(null);

  renderLine();
  renderInfo();
  if (map || !$('#tab-map').hidden) { renderMap(); setTimeout(() => map && map.invalidateSize(), 50); }
  handleAlerts(st, dataStale);
  if (window.gsap && !calm && !render.done) {
    // ขยับอย่างเดียว ไม่ทำให้จาง — ถ้าอนิเมชันค้าง (แท็บพื้นหลัง/เครื่องช้า) ข้อมูลยังเห็นครบ
    gsap.from('.hero, .chips .chip, .actions, .line-wrap', { y: 18, duration: 0.6, stagger: 0.07, ease: 'power3.out', clearProps: 'transform' });
  }
  render.done = true;
}

function showBanner(msg) {
  const b = $('#stale-banner');
  b.hidden = !msg;
  if (msg) b.textContent = msg;
}

// สถานีตัวแทนของแต่ละจุด = สถานีหลัก ถ้าไม่มีก็สถานีที่อันตรายที่สุดที่ยังส่งข้อมูล
function repStation(node) {
  const live = node.stations.filter((s) => RANK[s.status] >= 0);
  const primary = live.find((s) => s.primary);
  if (primary) return primary;
  return live.sort((a, b) => RANK[b.status] - RANK[a.status] || (a.margin ?? 9) - (b.margin ?? 9))[0] || null;
}

const COLORS = { green: '#22e39a', yellow: '#ffd23f', orange: '#ff8a2a', red: '#ff3b5c', stale: '#6b7a94', unknown: '#6b7a94' };
const colorOf = (status) => COLORS[STALE_VIEW ? 'stale' : status];

function renderLine() {
  const W = 360, X = 34, TOP = 30, GAP = 86, HOME_GAP = 110;
  const nodes = DATA.nodes;
  const ys = [];
  let y = TOP;
  nodes.forEach((n, i) => {
    if (i > 0) y += (n.role === 'home' || nodes[i - 1].role === 'home') ? HOME_GAP : GAP;
    ys.push(y);
  });
  const seaY = y + GAP;
  const H = seaY + 30;

  let segs = '';
  nodes.forEach((n, i) => {
    const y2 = i < nodes.length - 1 ? ys[i + 1] : seaY;
    const c = colorOf(n.status);
    const w = n.status === 'red' ? 7 : n.status === 'orange' ? 6 : 4;
    segs += `<line class="seg ${n.status === 'red' && !STALE_VIEW ? 'blink' : ''}" x1="${X}" y1="${ys[i]}" x2="${X}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" filter="url(#glow)"/>`;
  });

  let dots = '';
  nodes.forEach((n, i) => {
    const c = colorOf(n.status);
    const home = n.role === 'home';
    const r = home ? 17 : 9;
    const rep = repStation(n);
    let val = 'ไม่มีข้อมูลล่าสุด';
    let sub = '';
    if (rep) {
      val = `${rep.wl.toFixed(2)} ม.` + (rep.bank != null ? ` · ${rep.wl >= rep.bank ? 'เกินตลิ่ง ' + cm(rep.wl - rep.bank) : 'ต่ำกว่าตลิ่ง ' + cm(rep.bank - rep.wl)}` : '');
      sub = [fmtRate(rep.rate), rep.distKm != null ? `${rep.distKm} กม. จากบ้าน` : ''].filter(Boolean).join(' · ');
    }
    const pulse = !STALE_VIEW && (n.status === 'red' || n.status === 'orange')
      ? `<circle class="pulse-ring" cx="${X}" cy="${ys[i]}" r="${r}" fill="none" stroke="${c}" stroke-width="2"/>` : '';
    const homeRing = home
      ? `<circle cx="${X}" cy="${ys[i]}" r="${r + 7}" fill="none" stroke="${c}" stroke-width="2.5" opacity=".9" filter="url(#glow)"/>
         <text x="${X}" y="${ys[i] + 6}" text-anchor="middle" font-size="17">🏠</text>` : '';
    dots += `
      <g class="node-hit" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.name)} สถานะ ${LABEL[n.status]}">
        <rect class="node-bg" x="0" y="${ys[i] - 30}" width="${W}" height="60" rx="12"/>
        ${pulse}
        <circle cx="${X}" cy="${ys[i]}" r="${r}" fill="${home ? '#0a1630' : c}" stroke="${c}" stroke-width="3" filter="url(#glow)"/>
        ${homeRing}
        <text class="node-name" x="${X + 36}" y="${ys[i] - 8}" ${home ? 'font-size="17"' : ''}>${esc(n.name)}</text>
        <text class="node-val" x="${X + 36}" y="${ys[i] + 11}" fill="${c}">${esc(val)}</text>
        <text class="node-val-sub" x="${X + 36}" y="${ys[i] + 27}">${esc(sub || n.note)}</text>
      </g>`;
  });

  $('#line').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="แผนผังสายน้ำ">
      <defs>
        <!-- userSpaceOnUse: เส้นแนวตั้งกว้าง 0 จะหายถ้าใช้ขอบเขตแบบเปอร์เซ็นต์ -->
        <filter id="glow" filterUnits="userSpaceOnUse" x="-40" y="-40" width="${W + 80}" height="${H + 80}">
          <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g id="segs">${segs}</g>
      ${dots}
      <g><circle cx="${X}" cy="${seaY}" r="7" fill="none" stroke="#39c6ff" stroke-width="2"/>
        <text class="node-name" x="${X + 36}" y="${seaY + 5}">🌊 ทะเล</text></g>
    </svg>
    <canvas id="flow" aria-hidden="true"></canvas>`;

  document.querySelectorAll('.node-hit').forEach((g) => {
    const open = () => openSheet(g.dataset.node);
    g.addEventListener('click', open);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });

  if (window.gsap && !calm && !renderLine.drawn) {
    document.querySelectorAll('#segs line').forEach((l) => {
      const len = Math.abs(l.y2.baseVal.value - l.y1.baseVal.value);
      l.style.strokeDasharray = len;
      l.style.strokeDashoffset = len;
    });
    gsap.to('#segs line', { strokeDashoffset: 0, duration: 0.5, stagger: 0.12, ease: 'power1.inOut', onComplete() {
      document.querySelectorAll('#segs line').forEach((l) => { l.style.strokeDasharray = ''; l.style.strokeDashoffset = ''; });
    } });
  }
  renderLine.drawn = true;
  startFlow({ X, W, ys, seaY, H, nodes });
}

/* ---------- อนุภาคแสงไหลตามเส้นคลอง ---------- */
let flowRAF = 0;
function startFlow(geo) {
  cancelAnimationFrame(flowRAF);
  const cv = $('#flow');
  if (!cv || calm) return;
  const svg = $('#line svg');
  const ctx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const size = () => {
    const r = svg.getBoundingClientRect();
    cv.style.cssText = `position:absolute;left:0;top:0;width:${r.width}px;height:${r.height}px;pointer-events:none`;
    cv.width = r.width * dpr;
    cv.height = r.height * dpr;
    return r.width / geo.W;
  };
  let k = size();
  const segOf = (y) => {
    for (let i = geo.ys.length - 1; i >= 0; i--) if (y >= geo.ys[i]) return geo.nodes[i];
    return geo.nodes[0];
  };
  // ความเร็วตามอัตราน้ำขึ้นของต้นน้ำ (ขึ้นเร็ว = ไหลเร็ว)
  const upRate = Math.max(0, ...geo.nodes.flatMap((n) => n.stations.map((s) => s.rate || 0)));
  const speed = 0.35 + Math.min(upRate * 20, 1.6);
  const parts = Array.from({ length: 26 }, (_, i) => ({ y: geo.ys[0] + (i / 26) * (geo.seaY - geo.ys[0]), s: 0.6 + Math.random() * 0.8 }));
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(50, now - last) / 16.7;
    last = now;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.y += speed * p.s * dt;
      if (p.y > geo.seaY) p.y = geo.ys[0];
      const c = colorOf(segOf(p.y).status);
      ctx.beginPath();
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 10 * dpr;
      ctx.arc(geo.X * k * dpr, p.y * k * dpr, 2.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    flowRAF = requestAnimationFrame(tick);
  };
  flowRAF = requestAnimationFrame(tick);
  window.addEventListener('resize', () => { k = size(); }, { once: true });
}

/* ---------- พื้นหลังคลื่นน้ำ ---------- */
function startBg() {
  const cv = $('#bg');
  if (calm) return;
  const ctx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  resize();
  addEventListener('resize', resize);
  const draw = (t) => {
    if (calm) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      const base = cv.height * (0.72 + j * 0.07);
      for (let x = 0; x <= cv.width; x += 12 * dpr) {
        const y = base + Math.sin(x / (140 * dpr) + t / (1400 + j * 300) + j) * 12 * dpr;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(57,198,255,${0.12 - j * 0.02})`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

/* ---------------- การ์ดรายละเอียด ---------------- */
async function openSheet(nodeId) {
  const node = DATA.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  charts.splice(0).forEach((c) => c.destroy());
  const body = $('#sheet-body');
  body.innerHTML = `<h2>${esc(node.name)}</h2><p class="muted small">${esc(node.note)}</p>` +
    node.stations.map((s, i) => stationHtml(s, i)).join('');
  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
  if (window.gsap && !calm) gsap.from('#sheet-body', { y: 60, duration: 0.35, ease: 'power3.out', clearProps: 'transform' });

  const hist = await loadHistory();
  if (!window.Chart) return;
  node.stations.forEach((s, i) => {
    const pts = hist[s.key] || [];
    const el = document.getElementById(`chart-${i}`);
    if (!el || pts.length < 2) { if (el) el.parentElement.innerHTML = '<p class="muted small">ยังไม่มีกราฟย้อนหลัง (ระบบจะเก็บสะสมเอง)</p>'; return; }
    const c = colorOf(s.status);
    const ds = [{ label: 'ระดับน้ำ', data: pts.map(([x, y]) => ({ x, y })), borderColor: c, backgroundColor: c + '22', fill: true, borderWidth: 2, pointRadius: 0, tension: 0.25 }];
    const tMin = pts[0][0], tMax = pts[pts.length - 1][0];
    if (s.bank != null) ds.push({ label: 'ตลิ่ง', data: [{ x: tMin, y: s.bank }, { x: tMax, y: s.bank }], borderColor: '#ffffff', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0 });
    charts.push(new Chart(el, {
      type: 'line',
      data: { datasets: ds },
      options: {
        animation: calm ? false : { duration: 600 },
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { labels: { color: '#8ea3c4', boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { title: (it) => fmtTime(it[0].parsed.x), label: (it) => `${it.dataset.label} ${it.parsed.y.toFixed(2)} ม.` } },
        },
        scales: {
          x: { type: 'linear', min: tMin, max: tMax, ticks: { color: '#8ea3c4', maxTicksLimit: 4, maxRotation: 0, callback: (v) => (tMax - tMin > 20 * 3600e3 ? fmtDayHM(v) : fmtHM(v)) }, grid: { color: 'rgba(120,180,255,.08)' } },
          y: { ticks: { color: '#8ea3c4', maxTicksLimit: 6, callback: (v) => v.toFixed(2) }, grid: { color: 'rgba(120,180,255,.08)' } },
        },
      },
    }));
  });
}

function stationHtml(s, i) {
  const live = RANK[s.status] >= 0;
  let bar = '';
  if (s.wl != null && s.bank != null) {
    const top = Math.max(s.bank, s.wl) + 0.3;
    const bottom = Math.min(s.wl, s.bank) - 1.2;
    const pct = (v) => Math.max(0, Math.min(100, ((v - bottom) / (top - bottom)) * 100));
    bar = `<div class="bar"><div class="bar-fill" style="width:${pct(s.wl)}%"></div><div class="bar-bank" style="left:${pct(s.bank)}%"></div></div>
      <div class="bar-legend"><span>น้ำ ${s.wl.toFixed(2)}</span><span>ตลิ่ง ${s.bank.toFixed(2)} ม.รทก.</span></div>`;
  }
  const meta = [
    s.time ? `วัดเมื่อ ${fmtTime(s.time)}` : '',
    s.distKm != null ? `ห่างบ้าน ${s.distKm} กม.` : '',
    s.src === 'tw' ? 'ThaiWater (สสน.)' : s.via === 'POPNIX' ? 'ข้อมูล: สำนักการระบายน้ำ กทม. ผ่าน POPNIX Flood' : 'กทม.',
    s.agencyStatus ? `หน่วยงานประเมิน: ${s.agencyStatus}` : '',
  ].filter(Boolean).join(' · ');
  const extra = [
    s.isGate && s.wlOut != null ? `น้ำด้านนอกประตู ${s.wlOut.toFixed(2)} ม.` : '',
    s.maxToday != null ? `สูงสุดวันนี้ ${s.maxToday.toFixed(2)}` : '',
    s.maxYesterday != null ? `เมื่อวาน ${s.maxYesterday.toFixed(2)}` : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="st" data-status="${s.status}">
      <div class="st-head"><span class="st-name">${esc(s.name)}</span><span class="st-badge">${EMOJI[s.status]} ${LABEL[s.status]}</span></div>
      <div class="st-meta">${esc(meta)}</div>
      <div class="st-nums">
        <span class="st-big">${s.wl != null ? s.wl.toFixed(2) : '—'}<small style="font-size:.6em"> ม.</small></span>
        <span class="st-small">${esc(s.reason || '')}${live && s.rate != null ? ' · ' + esc(fmtRate(s.rate)) : ''}</span>
      </div>
      ${bar}
      ${extra ? `<div class="st-meta">${esc(extra)}</div>` : ''}
      <div class="chart-box"><canvas id="chart-${i}"></canvas></div>
      <a href="${esc(s.url)}" target="_blank" rel="noopener">ดูหน้าทางการ ↗</a>
    </div>`;
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  charts.splice(0).forEach((c) => c.destroy());
}

/* ---------------- แผนที่ ---------------- */
function renderMap() {
  if (!window.L) { $('#map').innerHTML = '<p class="card muted">โหลดแผนที่ไม่ได้ (ต้องใช้อินเทอร์เน็ต)</p>'; return; }
  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([DATA.home.lat, DATA.home.lon], 12);
    // OpenStreetMap ฟรี ไม่ต้องใช้ key — ทำโหมดมืดด้วย CSS (.dark-tiles)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, className: 'dark-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.marker([DATA.home.lat, DATA.home.lon], { icon: L.divIcon({ className: 'home-marker', html: '🏠', iconSize: [30, 30], iconAnchor: [15, 15] }) })
      .addTo(map).bindPopup(esc(DATA.home.name));
  }
  if (mapLayer) mapLayer.remove();
  mapLayer = L.layerGroup().addTo(map);
  const bounds = [[DATA.home.lat, DATA.home.lon]];
  for (const n of DATA.nodes) for (const s of n.stations) {
    if (s.lat == null) continue;
    const c = colorOf(s.status);
    L.circleMarker([s.lat, s.lon], { radius: s.primary ? 10 : 7, color: c, fillColor: c, fillOpacity: 0.55, weight: 2 })
      .bindPopup(`<b>${esc(s.name)}</b><br>${esc(n.name)}<br>${EMOJI[s.status]} ${LABEL[s.status]} · ${s.wl != null ? s.wl.toFixed(2) + ' ม.' : '—'}<br><span style="color:#8ea3c4">${esc(s.reason || '')}</span>`)
      .addTo(mapLayer);
    if (n.role !== 'up' || s.distKm < 15) bounds.push([s.lat, s.lon]);
  }
  if (!renderMap.fitted) { map.fitBounds(bounds, { padding: [24, 24] }); renderMap.fitted = true; }
}

/* ---------------- ไม้วัด ---------------- */
function renderGauge() {
  const list = store.get('gauge', []);
  $('#gauge-list').innerHTML = list.length
    ? list.slice().reverse().map((g, i) => `
      <div class="g-row"><span class="muted">${esc(fmtTime(g.t))}</span><span><span class="g-val">${esc(g.v)} ซม.</span> ${esc(g.note || '')}</span>
      <button class="g-del" data-i="${list.length - 1 - i}" aria-label="ลบ">✕</button></div>`).join('')
    : '<p class="muted small">ยังไม่มีบันทึก</p>';
  document.querySelectorAll('.g-del').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('ลบบันทึกนี้?')) return;
    const l = store.get('gauge', []);
    l.splice(Number(b.dataset.i), 1);
    store.set('gauge', l);
    renderGauge();
  }));
}

/* ---------------- ข้อมูล ---------------- */
function renderInfo() {
  $('#legend').innerHTML = LEGEND.map(([s, l, d]) => `<div class="legend-row" data-status="${s}"><span class="legend-dot"></span><span><b>${l}</b> — ${d}</span></div>`).join('');
  const src = DATA.sources;
  $('#sources').innerHTML = `
    <div>สำนักการระบายน้ำ กทม. (ตรง): ${src.bma.ok ? `✅ ${src.bma.count} สถานี` : src.popnix?.ok ? '⚠️ ดึงตรงไม่ได้ → ใช้แหล่งสำรอง' : `❌ ${esc(src.bma.error)}`}</div>
    <div>ThaiWater (สสน.): ${src.tw.ok ? `✅ ${src.tw.count} สถานี` : `❌ ${esc(src.tw.error)}`}</div>
    ${src.popnix ? `<div>สำรอง: ${src.popnix.ok ? `✅ ใช้ ${src.popnix.used} สถานี` : `❌ ${esc(src.popnix.error)}`} — <a href="https://flood.pop.in.th" target="_blank" rel="noopener">ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)</a></div>` : ''}
    <div>ดึงข้อมูลล่าสุด: ${fmtTime(DATA.generatedAt)}</div>
    <div>พยากรณ์ฝน (Open-Meteo): ${src.rain ? (src.rain.ok ? '✅' : `❌ ${esc(src.rain.error)}`) : '—'}</div>
    <div>เรดาร์ฝน: RainViewer (โหลดสดในแท็บ "ฝน")</div>`;
  updateNotifState();
}

/* ---------------- การแจ้งเตือน ---------------- */
let swReg = null;
async function notify(title, body, tag = 'flood') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = { body, tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', requireInteraction: tag === 'red' };
  try {
    if (swReg) await swReg.showNotification(title, opts);
    else new Notification(title, opts);
    return true;
  } catch { return false; }
}

function updateNotifState() {
  const el = $('#notif-state');
  if (!('Notification' in window)) {
    el.textContent = /iPhone|iPad/.test(navigator.userAgent)
      ? 'iPhone: ต้องกด แชร์ → "เพิ่มไปยังหน้าจอหลัก" แล้วเปิดจากไอคอนก่อน (iOS 16.4+)'
      : 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน';
    return;
  }
  el.textContent = { granted: '✅ อนุญาตแล้ว', denied: '❌ ถูกปิดไว้ — เปิดได้ในการตั้งค่าเบราว์เซอร์/มือถือ', default: 'ยังไม่ได้อนุญาต' }[Notification.permission];
}

function handleAlerts(st, dataStale) {
  if (!DATA) return;
  const lastSeen = store.get('lastStatus', null);
  const key = dataStale ? 'stale' : st;
  if (lastSeen && lastSeen !== key) {
    if (dataStale) notify('⚪ ระบบดึงข้อมูลไม่ได้', 'ข้อมูลไม่อัปเดต — ช่วยเช็กน้ำหน้าบ้านเอง', 'stale');
    else notify(`${EMOJI[st]} ${LABEL[st]}`, DATA.overall.reasons.join(' · '), st === 'red' ? 'red' : 'flood');
    if (st === 'red' && navigator.vibrate && !calm) navigator.vibrate([400, 150, 400, 150, 800]);
  }
  store.set('lastStatus', key);

  // แดง: เตือนซ้ำทุก 15 นาทีจนกว่าจะกดรับทราบ
  const acked = store.get('ackSince', null) === DATA.overall.since;
  const showAck = st === 'red' && !acked;
  $('#ack-bar').hidden = !showAck;
  clearInterval(handleAlerts.timer);
  if (showAck) {
    handleAlerts.timer = setInterval(() => {
      notify('🔴 น้ำกำลังมา (เตือนซ้ำ)', DATA.overall.reasons.join(' · '), 'red');
      if (navigator.vibrate && !calm) navigator.vibrate([400, 150, 400]);
    }, RED_REPEAT_MS);
  }
}

/* ---------------- เริ่มต้น ---------------- */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'map' && DATA) { renderMap(); setTimeout(() => map && map.invalidateSize(), 50); }
  if (tab === 'gauge') renderGauge();
  if (tab === 'rain') initRain({ home: DATA?.home || HOME_FALLBACK, calm });
  store.set('tab', tab);
}

function bind() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  $('#ack-btn').addEventListener('click', () => {
    store.set('ackSince', DATA.overall.since);
    clearInterval(handleAlerts.timer);
    $('#ack-bar').hidden = true;
  });
  $('#calm-toggle').addEventListener('change', (e) => {
    store.set('calm', e.target.checked);
    location.reload();
  });
  $('#notif-enable').addEventListener('click', async () => {
    if (!('Notification' in window)) return updateNotifState();
    await Notification.requestPermission();
    updateNotifState();
  });
  $('#notif-test').addEventListener('click', async () => {
    const ok = await notify('🔔 ทดสอบแจ้งเตือน', 'ถ้าเห็นข้อความนี้ แปลว่าแจ้งเตือนใช้ได้', 'test');
    if (!ok) alert('ยังแจ้งเตือนไม่ได้ — กด "อนุญาตการแจ้งเตือน" ก่อน');
  });
  $('#gauge-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Number($('#g-value').value);
    if (!Number.isFinite(v)) return;
    const list = store.get('gauge', []);
    list.push({ t: Date.now(), v, note: $('#g-note').value.trim() });
    store.set('gauge', list.slice(-500));
    e.target.reset();
    renderGauge();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}

async function init() {
  await decideCalm();
  bind();
  switchTab(store.get('tab', 'line'));
  if ('serviceWorker' in navigator) {
    try { swReg = await navigator.serviceWorker.register('sw.js'); } catch { /* file:// หรือไม่รองรับ */ }
  }
  // ไลบรารีจาก CDN (defer) รันก่อนไฟล์นี้อยู่แล้ว — ถ้าโหลดไม่ได้ แอปยังแสดงสี/ตัวเลขครบ
  // แสดงข้อมูลล่าสุดที่เคยโหลดทันที แล้วค่อยดึงของใหม่
  DATA = store.get('lastData', null);
  if (DATA) render();
  startBg();
  await load();
  setInterval(load, REFRESH_MS);
}

init();
