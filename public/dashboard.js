import { riverView, rainView, radarView, LIVE as LIVE_ST } from './fresh.js';
// แท็บ "สรุป": Dashboard ระดับน้ำแบบเรียลไทม์
const COLORS = { green: '#22e39a', yellow: '#ffd23f', orange: '#ff8a2a', red: '#ff3b5c', stale: '#6b7a94', unknown: '#6b7a94' };
const ICON = { green: '✅', yellow: '⚠️', orange: '🟠', red: '🚨', stale: '⚪', unknown: '⚪' };
const LABEL = { green: 'ปกติ', yellow: 'เฝ้าระวัง', orange: 'ใกล้ตลิ่ง', red: 'เกินตลิ่ง', stale: 'ขัดข้อง', unknown: 'ไม่มีข้อมูล' };
const LIVE = ['green', 'yellow', 'orange', 'red'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (t) => new Date(t).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const cm = (m) => Math.round(m * 100);
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const marginText = (s) => (s.wl == null || s.bank == null ? '—' : s.wl >= s.bank ? `เกินตลิ่ง ${cm(s.wl - s.bank)} ซม.` : `ต่ำกว่าตลิ่ง ${cm(s.bank - s.wl)} ซม.`);
const rateText = (r) => (r == null ? '' : Math.abs(r) < 0.005 ? 'ทรงตัว' : `${r > 0 ? '▲ ขึ้น' : '▼ ลด'} ${Math.abs(Math.round(r * 100))} ซม./ชม.`);
const chip = (st) => `<span class="db-chip" data-status="${st}">${ICON[st]} ${LABEL[st]}</span>`;

// สถานีที่ "แย่ที่สุด" (ใกล้ตลิ่งสุด) ในกลุ่ม
function worstOf(stations) {
  const live = stations.filter((s) => LIVE.includes(s.status) && s.margin != null);
  return live.sort((a, b) => a.margin - b.margin)[0] || stations.find((s) => LIVE.includes(s.status)) || null;
}

// status 'info' = ข้อมูลอ้างอิง ไม่ตัดสินสี (ไม่มีเกณฑ์ทางการ)
function tile({ title, value, sub, status, extra = '', chipText = null }) {
  const c = status === 'info' ? '' : chipText ? `<span class="db-chip" data-status="${status}">${ICON[status]} ${esc(chipText)}</span>` : chip(status);
  return `<div class="db-tile" data-status="${status}">
    <div class="db-tile-top"><span class="db-tile-title">${esc(title)}</span>${c}</div>
    <div class="db-tile-val">${value}</div>
    <div class="db-tile-sub">${sub}</div>${extra}
  </div>`;
}

// กราฟเล็ก 24 ชม. ของคลองใกล้บ้าน + เส้นตลิ่ง (มี tooltip เมื่อชี้)
function sparkline(points, bank, color) {
  if (!points || points.length < 2) return '<div class="db-spark-empty">ยังไม่มีกราฟย้อนหลัง</div>';
  const W = 320, H = 80, P = 4;
  const vals = points.map((p) => p[1]).concat(bank != null ? [bank] : []);
  const lo = Math.min(...vals) - 0.05, hi = Math.max(...vals) + 0.05;
  const t0 = points[0][0], t1 = points.at(-1)[0];
  const x = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${d}L${x(t1).toFixed(1)},${H - P}L${x(t0).toFixed(1)},${H - P}Z`;
  const bankLine = bank != null ? `<line x1="${P}" x2="${W - P}" y1="${y(bank)}" y2="${y(bank)}" class="db-bank"/><text x="${W - P}" y="${y(bank) - 4}" text-anchor="end" class="db-bank-lbl">ตลิ่ง ${bank.toFixed(2)}</text>` : '';
  return `<svg class="db-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-t0="${t0}" data-t1="${t1}" aria-label="ระดับน้ำ 24 ชม.">
      <path d="${area}" fill="${color}" opacity=".14"/>
      ${bankLine}
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <line class="db-cross" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/>
    </svg>
    <div class="db-spark-axis"><span>${Math.round((t1 - t0) / 3600e3)} ชม.ก่อน</span><span class="db-spark-tip" aria-live="polite">แตะกราฟเพื่อดูค่า</span><span>ล่าสุด ${hm(t1)}</span></div>`;
}

function bindSpark(root, points) {
  const svg = root?.querySelector('.db-spark');
  if (!svg || !points?.length) return;
  const tip = root.querySelector('.db-spark-tip');
  const cross = svg.querySelector('.db-cross');
  const t0 = points[0][0], t1 = points.at(-1)[0];
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const t = t0 + f * (t1 - t0);
    const p = points.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
    const px = 4 + ((p[0] - t0) / (t1 - t0 || 1)) * 312;
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    tip.textContent = `${hm(p[0])} · ${p[1].toFixed(2)} ม.`;
  };
  svg.addEventListener('pointermove', (e) => move(e.clientX));
  svg.addEventListener('pointerdown', (e) => move(e.clientX));
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.textContent = 'แตะกราฟเพื่อดูค่า'; });
}

/**
 * DATA: latest.json · history: history.json (อาจยังไม่มา) · stale: ไฟล์ข้อมูลเก่าเกิน
 */
export function renderDashboard(DATA, history, { stale = false } = {}) {
  const box = document.querySelector('#dash-body');
  if (!DATA) { box.innerHTML = '<p class="card muted">ยังไม่มีข้อมูล</p>'; return; }
  const S = (st) => (stale ? 'stale' : st);
  const node = (id) => DATA.nodes.find((n) => n.id === id);

  // ---------- คลองใกล้บ้าน (ใหญ่) ----------
  const homeNode = DATA.nodes.find((n) => n.role === 'home');
  const hs = homeNode.stations.find((s) => s.primary && LIVE.includes(s.status)) || homeNode.stations.find((s) => LIVE.includes(s.status)) || null;
  const hst = S(hs ? hs.status : 'unknown');
  const pct = hs && hs.bank != null ? Math.max(0, Math.min(100, ((hs.wl - (hs.bank - 1.5)) / 1.5) * 100)) : 0;
  const pts = hs && history ? history[hs.key] || [] : [];
  const day = pts.filter((p) => p[0] >= (pts.at(-1)?.[0] ?? 0) - 24 * 3600e3);
  const hero = `<div class="db-hero" data-status="${hst}">
      <div class="db-tile-top"><span class="db-tile-title">💧 คลองใกล้บ้าน</span>${chip(hst)}</div>
      <div class="db-hero-row">
        <div>
          <div class="db-big">${hs ? hs.wl.toFixed(2) : '—'}<small> ม.รทก.</small></div>
          <div class="db-hero-margin">${hs ? esc(marginText(hs)) : 'ไม่มีข้อมูล'}</div>
          <div class="db-tile-sub">${hs ? `${esc(rateText(hs.rate))} · ${esc(hs.name)} · ${hm(hs.time)}` : ''}</div>
        </div>
        <div class="db-gauge" aria-label="ระดับน้ำเทียบตลิ่ง">
          <div class="db-gauge-fill" style="height:${pct}%"></div>
          <div class="db-gauge-bank"><span>ตลิ่ง</span></div>
        </div>
      </div>
      <div class="db-spark-wrap">${sparkline(day, hs?.bank ?? null, COLORS[hst])}</div>
    </div>`;

  // ---------- การ์ดย่อย ----------
  const tiles = [];
  for (const [id, title] of [['samwa', '⬆️ ต้นน้ำใกล้บ้าน'], ['hokwa', '⬆️ คลองหกวา'], ['saensaep', '⬇️ ทางระบาย แสนแสบ'], ['bangchan', '⬇️ พระยาสุเรนทร์ใต้']]) {
    const n = node(id);
    if (!n) continue;
    const w = worstOf(n.stations);
    tiles.push(tile({
      title,
      status: S(w ? w.status : 'unknown'),
      value: w ? `${w.wl.toFixed(2)}<small> ม.</small>` : '—',
      sub: w ? `${esc(marginText(w))}<br><span class="muted">${esc(w.name)}</span>` : 'ไม่มีข้อมูลออนไลน์',
    }));
  }
  const now = Date.now();
  const RV = riverView(DATA.river, now);
  if (RV.stations.length) {
    const f = RV.front.overflow;
    tiles.push(RV.liveCount === 0 ? tile({
      title: '🌊 แม่น้ำเจ้าพระยา',
      status: 'unknown', chipText: 'ไม่มีข้อมูลสด',
      value: '—', sub: `ยังประเมินไม่ได้${RV.lastSeen ? ` · ค่าล่าสุด ${hm(RV.lastSeen)}` : ''}`,
    }) : tile({
      title: '🌊 แม่น้ำเจ้าพระยา',
      status: S(f ? 'red' : RV.front.near ? 'orange' : 'green'),
      chipText: f ? 'ล้นตลิ่ง' : RV.front.near ? 'ใกล้ล้น' : 'ปกติ',
      value: `${RV.front.overflowCount}<small> จุดล้นตลิ่ง</small>`,
      sub: `${f ? `ลงมาถึง <b>${esc(f.province || f.name)}</b>` : 'ยังไม่ล้นตลิ่ง'} · วัด ${hm(RV.asOf)}`,
    }));
  }
  if (RV.dam) {
    tiles.push(tile({
      title: '🚰 เขื่อนเจ้าพระยาปล่อยน้ำ',
      status: stale || !RV.dam.fresh ? 'stale' : 'info',
      chipText: RV.dam.fresh ? null : 'ค่าเก่า',
      value: `${n0(RV.dam.flow)}<small> ลบ.ม./วิ</small>`,
      sub: RV.dam.fresh ? `ถึง กทม. ราว 2–3 วัน · ${hm(RV.dam.time)}` : `ค่า ณ ${hm(RV.dam.time)} — เก่าเกินจะใช้ได้`,
    }));
  }
  const rd = radarView(DATA.radar, now);
  const lv = ['ไม่มีฝน', 'ละอองฝน', 'ฝนเบา', 'ฝนปานกลาง', 'ฝนหนัก', 'ฝนหนักมาก'];
  tiles.push(rd ? tile({
    title: '📡 ฝนตอนนี้ (เรดาร์)',
    status: S(rd.atHome >= 4 ? 'orange' : rd.atHome >= 2 ? 'yellow' : 'green'),
    chipText: rd.atHome >= 2 ? 'มีฝน' : 'ไม่มีฝน',
    value: rd.atHome >= 2 ? `${lv[rd.atHome]}` : 'ไม่มีฝน',
    sub: `${rd.nearest ? `กลุ่มฝนใกล้สุด ${Math.round(rd.nearest.km)} กม. (${lv[rd.nearest.level]})` : 'ไม่มีฝนในรัศมี 100 กม.'} · ${hm(rd.time)}`,
  }) : tile({ title: '📡 ฝนตอนนี้ (เรดาร์)', status: 'unknown', chipText: 'ไม่พร้อม', value: '—', sub: 'เรดาร์ไม่พร้อม — ดูแท็บ "ฝน" หรือเรดาร์ กทม.' }));
  const RN = rainView(DATA.rain, now);
  const w = RN.window;
  tiles.push(!RN.ok ? tile({
    title: '🌧️ ฝนครั้งถัดไป (พยากรณ์)', status: 'unknown', chipText: 'ไม่พร้อม',
    value: '—', sub: 'พยากรณ์ไม่พร้อม — ยังประเมินไม่ได้',
  }) : tile({
    title: '🌧️ ฝนครั้งถัดไป (พยากรณ์)',
    status: S(w ? (w.peakMm >= 10 ? 'orange' : 'yellow') : 'green'),
    chipText: w ? 'มีฝน' : 'ไม่มีฝน',
    value: w ? `${hm(w.start)}–${hm(w.end + 3600e3)}` : 'ไม่มี',
    sub: w ? `~${w.totalMm} มม. · โอกาส ${w.maxProb}%` : 'ใน 12 ชม. ข้างหน้า',
  }));

  // ---------- ตารางทุกสถานี ----------
  const rows = DATA.nodes.flatMap((n) => n.stations.map((s) => ({ ...s, node: n.name })))
    .filter((s) => s.wl != null)
    .map((s) => {
      const st = S(s.status);
      const p = s.bank != null ? Math.max(2, Math.min(100, ((s.wl - (s.bank - 1.5)) / 1.5) * 100)) : 0;
      return `<tr data-status="${st}">
        <td><div class="db-st-name">${esc(s.name)}</div><div class="muted small">${esc(s.node)}</div></td>
        <td class="db-num">${s.wl.toFixed(2)}</td>
        <td><div class="db-mini"><div style="width:${p}%"></div></div><div class="small">${esc(marginText(s))}</div></td>
        <td>${chip(st)}</td></tr>`;
    }).join('');

  const ageMin = Math.round((now - DATA.generatedAt) / 60000);
  const okSrc = Object.values(DATA.sources).filter((x) => x.ok).length;
  const allSt = DATA.nodes.flatMap((n) => n.stations);
  const liveSt = allSt.filter((s) => LIVE_ST.includes(s.status)).length;
  // LIVE เฉพาะเมื่อรอบนี้ดึงข้อมูลได้จริง · ถ้ารอบนี้ล่มแต่ยังมีค่าคลองที่ไม่เก่า = "ใช้ค่าล่าสุด"
  const isLive = !stale && liveSt > 0 && okSrc > 0;
  const liveLabel = isLive ? 'LIVE' : !stale && liveSt > 0 ? 'ใช้ค่าล่าสุด (รอบนี้ดึงข้อมูลไม่ได้)' : 'ข้อมูลไม่สด';
  box.innerHTML = `
    <div class="db-live ${isLive ? '' : 'is-stale'}"><span class="db-dot"></span>${liveLabel}
      · รอบประมวลผลล่าสุด ${hm(DATA.generatedAt)} (${ageMin} นาทีก่อน)
      · สถานีคลองที่มีข้อมูลสด ${liveSt}/${allSt.length} · แหล่งข้อมูลทำงาน ${okSrc}/${Object.keys(DATA.sources).length}</div>
    ${hero}
    <div class="db-grid">${tiles.join('')}</div>
    <div class="glass card">
      <h3>ทุกสถานี</h3>
      <table class="db-table"><thead><tr><th>สถานี</th><th>ม.</th><th>เทียบตลิ่ง</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  bindSpark(box.querySelector('.db-hero'), day);
}
