import { riverView } from './fresh.js';
// แท็บ "น้ำเหนือ": รางรถไฟแม่น้ำเจ้าพระยา นครสวรรค์ → กรุงเทพฯ
const COLORS = { green: '#22e39a', yellow: '#ffd23f', orange: '#ff8a2a', red: '#ff3b5c', stale: '#6b7a94', unknown: '#6b7a94' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const TREND = { up: '▲', down: '▼', flat: '–' };

// ระยะทาง (กม.) ระหว่างสองพิกัด
const km = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// home: { lat, lon, status, station: { name, wl, bank } } — แสดง 🏠 ตรงระดับละติจูดของบ้าน
export function renderRiver(river, { stale = false, home = null } = {}) { // eslint-disable-line prefer-const
  const box = document.querySelector('#river-body');
  if (!river?.stations?.length) {
    box.innerHTML = '<div class="glass card"><p class="muted">ยังไม่มีข้อมูลแม่น้ำ — ลองใหม่ภายหลัง</p></div>';
    return;
  }
  const col = (s) => COLORS[stale ? 'stale' : s];
  // ประเมินความสดใหม่ทุกครั้ง: สถานีเก่า/ค่าเพี้ยน = เทา, จุดล้นคิดจากสถานีที่สดเท่านั้น
  const V = riverView(river);
  const st = V.stations;
  const front = V.front.overflow;
  const near = V.front.near;
  const dam = V.dam;
  const noLive = V.liveCount === 0;
  if (noLive) stale = true;

  // ---------- สรุปด้านบน ----------
  let head, sub, level;
  if (noLive) {
    level = 'stale';
    head = 'ข้อมูลน้ำเหนือไม่พร้อม — ยังประเมินไม่ได้';
    sub = V.lastSeen ? `ค่าที่มีล่าสุดวัดเมื่อ ${fmtTime(V.lastSeen)} (เก่าเกินจะใช้ได้)` : 'ยังไม่มีข้อมูลจากสถานี';
  } else if (front) {
    level = ['นนทบุรี', 'กรุงเทพฯ', 'ปทุมธานี'].includes(front.province) ? 'red' : 'orange';
    head = `ล้นตลิ่งแล้ว ${V.front.overflowCount} จุด — ลงมาถึง${front.province ? ` ${front.province}` : ''}`;
    sub = `ใต้สุดที่ ${front.name}${front.diff != null ? ` (เกินตลิ่ง ${Math.round(front.diff * 100)} ซม.)` : ''} · วัดล่าสุด ${fmtTime(V.asOf)}`;
  } else if (near) {
    level = 'yellow';
    head = `ยังไม่ล้นตลิ่ง แต่ใกล้ล้นถึง${near.province ? ` ${near.province}` : ''}`;
    sub = `${near.name} เหลือ ${Math.round(-near.diff * 100)} ซม. · วัดล่าสุด ${fmtTime(V.asOf)}`;
  } else {
    level = 'green';
    head = `แม่น้ำเจ้าพระยายังต่ำกว่าตลิ่ง (${V.liveCount} สถานีที่มีข้อมูลสด)`;
    sub = `วัดล่าสุด ${fmtTime(V.asOf)}`;
  }
  const damLine = dam ? `🚰 เขื่อนเจ้าพระยา (ชัยนาท) ปล่อย <b>${n0(dam.flow)}</b> ลบ.ม./วิ${dam.fresh ? ' — น้ำใช้เวลาราว 2–3 วันถึงกรุงเทพฯ' : ` <span class="muted">(ค่าเก่า ณ ${fmtTime(dam.time)})</span>`}` : '';
  const r8 = V.rama8 ? `🌉 สะพานพระราม 8 ไหล ${n0(V.rama8.flow)} ลบ.ม./วิ${V.rama8.avg ? ` (เฉลี่ย ${n0(V.rama8.avg)})` : ''}${V.rama8.fresh ? '' : ` <span class="muted">(ค่าเก่า)</span>`}` : '';

  // ---------- ราง ----------
  const W = 360, X = 34, TOP = 26, GAP = 52, PROV_GAP = 30;
  let y = TOP;
  let lastProv = null;
  const rows = [];
  st.forEach((s, i) => {
    if (s.province !== lastProv) { if (i > 0) y += PROV_GAP; rows.push({ prov: s.province, y }); lastProv = s.province; y += 22; }
    rows.push({ s, i, y });
    y += GAP;
  });
  // 🏠 บ้าน: แทรกหลังสถานีสุดท้ายที่อยู่เหนือบ้าน (ละติจูดมากกว่า) — แม่น้ำไหลจากเหนือลงใต้
  let homeRow = null;
  if (home?.lat != null) {
    const north = rows.filter((r) => r.s && r.s.lat != null && r.s.lat > home.lat);
    const after = north.at(-1);
    if (after) {
      const nearest = st.filter((s) => s.lat != null).reduce((a, s) => (km(home.lat, home.lon, s.lat, s.lon) < km(home.lat, home.lon, a.lat, a.lon) ? s : a));
      const shift = 64;
      for (const r of rows) if (r.y > after.y) r.y += shift;
      y += shift;
      homeRow = { y: after.y + GAP / 2 + shift / 2 + 4, distKm: km(home.lat, home.lon, nearest.lat, nearest.lon), nearest };
    }
  }
  const endY = y + 4;
  const H = endY + 40;
  const pts = rows.filter((r) => r.s);
  let svg = '';
  // เส้นระหว่างสถานี (สีตามสถานีต้นทาง)
  pts.forEach((r, k) => {
    const y2 = k < pts.length - 1 ? pts[k + 1].y : endY;
    svg += `<line x1="${X}" y1="${r.y}" x2="${X}" y2="${y2}" stroke="${col(r.s.status)}" stroke-width="${r.s.status === 'red' ? 6 : 4}" stroke-linecap="round" filter="url(#rglow)"/>`;
  });
  rows.forEach((r) => {
    if (!r.s) {
      svg += `<text class="rv-prov" x="${X + 26}" y="${r.y + 4}">📍 ${esc(r.prov || 'ไม่ระบุจังหวัด')}</text>`;
      return;
    }
    const s = r.s;
    const c = col(s.status);
    const isDam = s.code === '2744';
    const isFront = front && s.code === front.code;
    const pos = s.diff == null ? 'ไม่มีข้อมูล'
      : s.status === 'stale' ? `ข้อมูลค้าง (${fmtTime(s.time)})`
      : s.diff >= 0 ? `เกินตลิ่ง ${Math.round(s.diff * 100)} ซม.` : `ต่ำกว่าตลิ่ง ${Math.round(-s.diff * 100)} ซม.`;
    const extra = [s.trend && s.status !== 'stale' ? `${TREND[s.trend] || ''} ${s.trend === 'up' ? 'ขึ้น' : s.trend === 'down' ? 'ลด' : 'ทรงตัว'}` : '', s.flow ? `${n0(s.flow)} ลบ.ม./วิ` : ''].filter(Boolean).join(' · ');
    if (s.status === 'red' && !stale) svg += `<circle class="pulse-ring" cx="${X}" cy="${r.y}" r="8" fill="none" stroke="${c}" stroke-width="2"/>`;
    svg += isDam
      ? `<rect x="${X - 10}" y="${r.y - 10}" width="20" height="20" rx="4" fill="#0a1630" stroke="${c}" stroke-width="3"/><text x="${X}" y="${r.y + 5}" text-anchor="middle" font-size="12">🚰</text>`
      : `<circle cx="${X}" cy="${r.y}" r="8" fill="${c}" stroke="#0a1630" stroke-width="2" filter="url(#rglow)"/>`;
    svg += `<text class="rv-name" x="${X + 26}" y="${r.y - 4}">${esc(s.name)}${isDam ? ' (เขื่อนเจ้าพระยา)' : ''}</text>`;
    svg += `<text class="rv-val" x="${X + 26}" y="${r.y + 13}" fill="${c}">${esc(pos)}</text>`;
    if (extra) svg += `<text class="rv-sub" x="${W - 6}" y="${r.y + 13}" text-anchor="end">${esc(extra)}</text>`;
    if (isFront && !stale) svg += `<text class="rv-front" x="${W - 6}" y="${r.y - 4}" text-anchor="end">🌊 ล้นถึงตรงนี้</text>`;
  });
  if (homeRow) {
    const hc = COLORS[stale ? 'stale' : home.status] || COLORS.unknown;
    const HX = X + 40;
    const hs = home.station;
    const canal = hs?.wl != null && hs?.bank != null
      ? `คลองใกล้บ้าน ${hs.wl.toFixed(2)} ม. · ${hs.wl >= hs.bank ? `เกินตลิ่ง ${Math.round((hs.wl - hs.bank) * 100)}` : `ต่ำกว่าตลิ่ง ${Math.round((hs.bank - hs.wl) * 100)}`} ซม.`
      : 'คลองใกล้บ้าน: ไม่มีข้อมูล';
    svg += `<line x1="${X}" y1="${homeRow.y}" x2="${HX - 16}" y2="${homeRow.y}" stroke="${hc}" stroke-width="2" stroke-dasharray="4 4"/>`;
    svg += `<circle cx="${HX}" cy="${homeRow.y}" r="15" fill="#0a1630" stroke="${hc}" stroke-width="3" filter="url(#rglow)"/>`;
    svg += `<text x="${HX}" y="${homeRow.y + 6}" text-anchor="middle" font-size="16">🏠</text>`;
    svg += `<text class="rv-home" x="${HX + 24}" y="${homeRow.y - 12}" fill="${hc}">บ้านเรา (อยู่ระดับเดียวกับช่วงนี้)</text>`;
    svg += `<text class="rv-sub" x="${HX + 24}" y="${homeRow.y + 4}">ห่างแม่น้ำไปทางตะวันออก ~${Math.round(homeRow.distKm)} กม.</text>`;
    svg += `<text class="rv-sub" x="${HX + 24}" y="${homeRow.y + 19}">${esc(canal)}</text>`;
  }
  svg += `<circle cx="${X}" cy="${endY}" r="7" fill="none" stroke="#39c6ff" stroke-width="2"/><text class="rv-name" x="${X + 26}" y="${endY + 5}">🌊 อ่าวไทย</text>`;

  box.innerHTML = `
    <div class="glass river-head" data-status="${stale ? 'stale' : level}">
      <div class="rv-tag">🌊 ${noLive ? 'น้ำเหนือ' : 'น้ำเหนือตอนนี้'} · แม่น้ำเจ้าพระยา</div>
      <div class="rv-head">${esc(head)}</div>
      ${sub ? `<div class="rv-subhead">${esc(sub)}</div>` : ''}
      ${damLine ? `<div class="rv-line">${damLine}</div>` : ''}
      ${r8 ? `<div class="rv-line">${r8}</div>` : ''}
    </div>
    <div class="glass card rv-note">
      <b>เกี่ยวกับบ้านเรายังไง?</b> บ้านอยู่กรุงเทพฯ ฝั่งตะวันออก น้ำเหนือมาถึงบ้านเรา<b>ผ่านคลองระพีพัฒน์ → รังสิต → หกวา</b>
      (ดูแผนผังหน้าแรก) ส่วนแม่น้ำเจ้าพระยาที่ล้นจะกระทบริมแม่น้ำ ปทุมธานี นนทบุรี และฝั่งตะวันตกก่อน —
      แต่ถ้าล้นลงมาถึง<b>อยุธยา–ปทุมธานี</b> น้ำมักถูกผันเข้าทุ่งฝั่งตะวันออก ควรเฝ้าระวังมากขึ้น
    </div>
    <div class="glass rail-wrap">
      <div class="line-head"><span>เหนือ ↓ ใต้ (ไหลจากนครสวรรค์)</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="รางรถไฟแม่น้ำเจ้าพระยา">
        <defs><filter id="rglow" filterUnits="userSpaceOnUse" x="-40" y="-40" width="${W + 80}" height="${H + 80}">
          <feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        ${svg}
      </svg>
      <div class="radar-legend"><span><i style="--c:${COLORS.red}"></i>ล้นตลิ่ง</span><span><i style="--c:${COLORS.orange}"></i>เหลือ &lt;30 ซม.</span><span><i style="--c:${COLORS.yellow}"></i>เหลือ &lt;1 ม.</span><span><i style="--c:${COLORS.green}"></i>ปกติ</span><span><i style="--c:${COLORS.stale}"></i>ข้อมูลค้าง</span></div>
    </div>
    <p class="hint">ข้อมูล: สสน. · กรมชลประทาน · กทม. ผ่าน <a href="https://flood.pop.in.th" target="_blank" rel="noopener">POPNIX Flood</a> · "2–3 วัน" เป็นค่าประมาณทั่วไป</p>`;
}
