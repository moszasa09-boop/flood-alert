import { riverView } from './fresh.js';
// แท็บ "น้ำเหนือ": รางรถไฟ 2 สาย
//   1) แม่น้ำป่าสัก (ต้นทางน้ำมาบ้านเรา) — แยกเข้าคลองระพีพัฒน์ที่เขื่อนพระรามหก
//   2) แม่น้ำเจ้าพระยา นครสวรรค์ → อ่าวไทย
const COLORS = { green: '#22e39a', yellow: '#ffd23f', orange: '#ff8a2a', red: '#ff3b5c', stale: '#6b7a94', unknown: '#6b7a94' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (t) => new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDate = (t) => new Date(t).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const TREND = { up: '▲', down: '▼', flat: '–' };
const NEAR_PROV = ['นนทบุรี', 'กรุงเทพฯ', 'ปทุมธานี'];
const DAM_DAILY_STALE_H = 48;

const km = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// การ์ดสรุปของแต่ละสาย
function headCard(V, { title, riverName, nearProv = [], lines = [] }) {
  let head, sub, level;
  if (V.liveCount === 0) {
    level = 'stale';
    head = `ข้อมูล${riverName}ไม่พร้อม — ยังประเมินไม่ได้`;
    sub = V.lastSeen ? `ค่าที่มีล่าสุดวัดเมื่อ ${fmtTime(V.lastSeen)} (เก่าเกินจะใช้ได้)` : 'ยังไม่มีข้อมูลจากสถานี';
  } else if (V.front.overflow) {
    const f = V.front.overflow;
    level = nearProv.includes(f.province) || f.branch ? 'red' : 'orange';
    head = `ล้นตลิ่งแล้ว ${V.front.overflowCount} จุด — ลงมาถึง${f.province ? ` ${f.province}` : ''}`;
    sub = `ใต้สุดที่ ${f.name}${f.diff != null ? ` (เกินตลิ่ง ${Math.round(f.diff * 100)} ซม.)` : ''} · วัดล่าสุด ${fmtTime(V.asOf)}`;
  } else if (V.front.near) {
    const n = V.front.near;
    level = 'yellow';
    head = `ยังไม่ล้นตลิ่ง แต่ใกล้ล้นถึง${n.province ? ` ${n.province}` : ''}`;
    sub = `${n.name} เหลือ ${Math.round(-n.diff * 100)} ซม. · วัดล่าสุด ${fmtTime(V.asOf)}`;
  } else {
    level = 'green';
    head = `${riverName}ยังต่ำกว่าตลิ่ง (${V.liveCount} สถานีที่มีข้อมูลสด)`;
    sub = `วัดล่าสุด ${fmtTime(V.asOf)}`;
  }
  return `<div class="glass river-head" data-status="${level}">
      <div class="rv-tag">${title}</div>
      <div class="rv-head">${esc(head)}</div>
      ${sub ? `<div class="rv-subhead">${esc(sub)}</div>` : ''}
      ${lines.filter(Boolean).map((l) => `<div class="rv-line">${l}</div>`).join('')}
    </div>`;
}

// รางแนวตั้ง: สถานีเรียงเหนือ→ใต้ จัดกลุ่มตามจังหวัด
//   opts.home → แทรก 🏠 ตามละติจูด · opts.branchCode → ทางแยกเข้าคลองระพีพัฒน์ · opts.endLabel
function railSvg(V, { stale, home = null, branch = null, endLabel, damCode, damLabel, ariaLabel, id }) {
  const col = (s) => COLORS[stale ? 'stale' : s] || COLORS.unknown;
  const st = V.stations;
  const front = V.front.overflow;
  const W = 360, X = 34, TOP = 26, GAP = 52, PROV_GAP = 30;
  let y = TOP;
  let lastProv = null;
  const rows = [];
  st.forEach((s, i) => {
    if (s.province !== lastProv) { if (i > 0) y += PROV_GAP; rows.push({ prov: s.province, y }); lastProv = s.province; y += 22; }
    rows.push({ s, i, y });
    y += GAP;
    if (branch && s.code === branch.code) y += 58; // เว้นที่ให้ทางแยก
  });
  let homeRow = null;
  if (home?.lat != null) {
    const north = rows.filter((r) => r.s && r.s.lat != null && r.s.lat > home.lat);
    const after = north.at(-1);
    if (after) {
      const nearest = st.filter((s) => s.lat != null).reduce((a, s) => (km(home.lat, home.lon, s.lat, s.lon) < km(home.lat, home.lon, a.lat, a.lon) ? s : a));
      const shift = 64;
      for (const r of rows) if (r.y > after.y) r.y += shift;
      y += shift;
      homeRow = { y: after.y + GAP / 2 + shift / 2 + 4, distKm: km(home.lat, home.lon, nearest.lat, nearest.lon) };
    }
  }
  const endY = y + 4;
  const H = endY + 40;
  const pts = rows.filter((r) => r.s);
  let svg = '';
  pts.forEach((r, k) => {
    const y2 = k < pts.length - 1 ? pts[k + 1].y : endY;
    svg += `<line x1="${X}" y1="${r.y}" x2="${X}" y2="${y2}" stroke="${col(r.s.status)}" stroke-width="${r.s.status === 'red' ? 6 : 4}" stroke-linecap="round" filter="url(#${id}-glow)"/>`;
  });
  rows.forEach((r) => {
    if (!r.s) { svg += `<text class="rv-prov" x="${X + 26}" y="${r.y + 4}">📍 ${esc(r.prov || 'ไม่ระบุจังหวัด')}</text>`; return; }
    const s = r.s;
    const c = col(s.status);
    const isDam = s.code === damCode;
    const isFront = front && s.code === front.code;
    const pos = s.diff == null ? 'ไม่มีข้อมูล'
      : s.status === 'stale' ? `ข้อมูลค้าง (${fmtTime(s.time)})`
      : s.status === 'unknown' ? 'ข้อมูลผิดรูปแบบ'
      : s.diff >= 0 ? `เกินตลิ่ง ${Math.round(s.diff * 100)} ซม.` : `ต่ำกว่าตลิ่ง ${Math.round(-s.diff * 100)} ซม.`;
    const extra = [s.trend && s.status !== 'stale' ? `${TREND[s.trend] || ''} ${s.trend === 'up' ? 'ขึ้น' : s.trend === 'down' ? 'ลด' : 'ทรงตัว'}` : '', s.flow ? `${n0(s.flow)} ลบ.ม./วิ` : ''].filter(Boolean).join(' · ');
    if (s.status === 'red' && !stale) svg += `<circle class="pulse-ring" cx="${X}" cy="${r.y}" r="8" fill="none" stroke="${c}" stroke-width="2"/>`;
    svg += isDam
      ? `<rect x="${X - 10}" y="${r.y - 10}" width="20" height="20" rx="4" fill="#0a1630" stroke="${c}" stroke-width="3"/><text x="${X}" y="${r.y + 5}" text-anchor="middle" font-size="12">🚰</text>`
      : `<circle cx="${X}" cy="${r.y}" r="8" fill="${c}" stroke="#0a1630" stroke-width="2" filter="url(#${id}-glow)"/>`;
    svg += `<text class="rv-name" x="${X + 26}" y="${r.y - 4}">${esc(s.name)}${isDam && damLabel ? ` ${esc(damLabel)}` : ''}</text>`;
    svg += `<text class="rv-val" x="${X + 26}" y="${r.y + 13}" fill="${c}">${esc(pos)}</text>`;
    if (extra) svg += `<text class="rv-sub" x="${W - 6}" y="${r.y + 13}" text-anchor="end">${esc(extra)}</text>`;
    if (isFront && !stale) svg += `<text class="rv-front" x="${W - 6}" y="${r.y - 4}" text-anchor="end">🌊 ล้นถึงตรงนี้</text>`;
    if (branch && s.code === branch.code) {
      // ทางแยกเข้าคลองระพีพัฒน์ → บ้านเรา
      const by = r.y + 34, bc = COLORS[stale ? 'stale' : branch.status] || COLORS.unknown;
      svg += `<path d="M${X} ${r.y + 8} Q ${X} ${by} ${X + 34} ${by}" fill="none" stroke="${c}" stroke-width="4" stroke-dasharray="6 5" class="${stale ? '' : 'flow-dash-svg'}"/>`;
      svg += `<circle cx="${X + 48}" cy="${by}" r="13" fill="#0a1630" stroke="${bc}" stroke-width="3"/><text x="${X + 48}" y="${by + 5}" text-anchor="middle" font-size="13">🏠</text>`;
      svg += `<text class="rv-home" x="${X + 68}" y="${by - 4}" fill="${bc}">แยกเข้าคลองระพีพัฒน์ → บ้านเรา</text>`;
      svg += `<text class="rv-sub" x="${X + 68}" y="${by + 12}">รังสิต → หกวา → คลองใกล้บ้าน (${esc(branch.note || '')})</text>`;
    }
  });
  if (homeRow) {
    const hc = COLORS[stale ? 'stale' : home.status] || COLORS.unknown;
    const HX = X + 40;
    const hs = home.station;
    const canal = hs?.wl != null && hs?.bank != null
      ? `คลองใกล้บ้าน ${hs.wl.toFixed(2)} ม. · ${hs.wl >= hs.bank ? `เกินตลิ่ง ${Math.round((hs.wl - hs.bank) * 100)}` : `ต่ำกว่าตลิ่ง ${Math.round((hs.bank - hs.wl) * 100)}`} ซม.`
      : 'คลองใกล้บ้าน: ไม่มีข้อมูล';
    svg += `<line x1="${X}" y1="${homeRow.y}" x2="${HX - 16}" y2="${homeRow.y}" stroke="${hc}" stroke-width="2" stroke-dasharray="4 4"/>`;
    svg += `<circle cx="${HX}" cy="${homeRow.y}" r="15" fill="#0a1630" stroke="${hc}" stroke-width="3" filter="url(#${id}-glow)"/>`;
    svg += `<text x="${HX}" y="${homeRow.y + 6}" text-anchor="middle" font-size="16">🏠</text>`;
    svg += `<text class="rv-home" x="${HX + 24}" y="${homeRow.y - 12}" fill="${hc}">บ้านเรา (อยู่ระดับเดียวกับช่วงนี้)</text>`;
    svg += `<text class="rv-sub" x="${HX + 24}" y="${homeRow.y + 4}">ห่างแม่น้ำไปทางตะวันออก ~${Math.round(homeRow.distKm)} กม.</text>`;
    svg += `<text class="rv-sub" x="${HX + 24}" y="${homeRow.y + 19}">${esc(canal)}</text>`;
  }
  svg += `<circle cx="${X}" cy="${endY}" r="7" fill="none" stroke="#39c6ff" stroke-width="2"/><text class="rv-name" x="${X + 26}" y="${endY + 5}">${esc(endLabel)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">
      <defs><filter id="${id}-glow" filterUnits="userSpaceOnUse" x="-40" y="-40" width="${W + 80}" height="${H + 80}">
        <feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${svg}
    </svg>`;
}

const LEGEND = `<div class="radar-legend"><span><i style="--c:${COLORS.red}"></i>ล้นตลิ่ง</span><span><i style="--c:${COLORS.orange}"></i>เหลือ &lt;30 ซม.</span><span><i style="--c:${COLORS.yellow}"></i>เหลือ &lt;1 ม.</span><span><i style="--c:${COLORS.green}"></i>ปกติ</span><span><i style="--c:${COLORS.stale}"></i>ข้อมูลค้าง</span></div>`;

/**
 * river: DATA.river (เจ้าพระยา) · pasak: DATA.pasak · home: { lat, lon, status, station }
 * eastStatus: สถานะเส้นคลองฝั่งตะวันออก (ใช้ระบายสีทางแยกระพีพัฒน์)
 */
export function renderRiver(river, { stale = false, home = null, pasak = null, eastStatus = 'unknown' } = {}) {
  const box = document.querySelector('#river-body');
  const parts = [];

  // ---------- 1) แม่น้ำป่าสัก ----------
  if (pasak?.stations?.length) {
    const P = riverView(pasak);
    const pStale = stale || P.liveCount === 0;
    const d = pasak.dam;
    const damFresh = d?.time && Date.now() - d.time < DAM_DAILY_STALE_H * 3600e3;
    const damLine = d ? `🚰 ${esc(d.name)}: น้ำในเขื่อน <b>${d.storagePct ?? '—'}%</b> ของระดับเก็บกัก${d.storagePct >= 100 ? ' (เกินระดับเก็บกัก)' : ''} · ไหลเข้า ${d.inflowCms ?? '—'} · ปล่อย <b>${d.releaseCms ?? '—'}</b> ลบ.ม./วิ <span class="muted">(${d.date ? `ข้อมูลวันที่ ${fmtDate(d.time)}` : ''}${damFresh ? '' : ' — ค่าเก่า'})</span>` : '';
    // จุดแยกเข้าคลองระพีพัฒน์ (เขื่อนพระรามหก) — สำคัญที่สุดสำหรับบ้านเรา
    const br = P.live.find((s) => s.branch);
    const brLine = br ? (br.status === 'red'
      ? `⚠️ <b>จุดแยกเข้าคลองระพีพัฒน์ (เขื่อนพระรามหก) ล้นตลิ่ง ${Math.round(br.diff * 100)} ซม.</b> — น้ำส่วนนี้ไหลมาทางคลองฝั่งบ้านเรา`
      : `จุดแยกเข้าคลองระพีพัฒน์ (เขื่อนพระรามหก): ต่ำกว่าตลิ่ง ${Math.round(-br.diff * 100)} ซม.`) : '';
    const head = headCard(P, {
      title: '🏞️ แม่น้ำป่าสัก · ต้นทางน้ำที่มาทางบ้านเรา',
      riverName: 'แม่น้ำป่าสัก',
      lines: [brLine, damLine],
    });
    parts.push(br?.status === 'red' && !pStale ? head.replace(/data-status="(orange|yellow|green)"/, 'data-status="red"') : head);
    parts.push(`<div class="glass rail-wrap">
      <div class="line-head"><span>เพชรบูรณ์ ↓ อยุธยา · ที่เขื่อนพระรามหก น้ำแยกเข้าคลองระพีพัฒน์มาทางบ้านเรา</span></div>
      ${railSvg({ ...P, stations: P.stations }, {
        stale: pStale, id: 'pasak', ariaLabel: 'รางรถไฟแม่น้ำป่าสัก',
        damCode: '2712', damLabel: '', endLabel: '↪ ไหลรวมแม่น้ำเจ้าพระยา (อยุธยา)',
        branch: { code: '2624', status: eastStatus, note: 'ดูแผนผังหน้าแรก' },
      })}
      ${LEGEND}
    </div>`);
  }

  // ---------- 2) แม่น้ำเจ้าพระยา ----------
  if (river?.stations?.length) {
    const V = riverView(river);
    const cStale = stale || V.liveCount === 0;
    const dam = V.dam;
    const damLine = dam ? `🚰 เขื่อนเจ้าพระยา (ชัยนาท) ปล่อย <b>${n0(dam.flow)}</b> ลบ.ม./วิ${dam.fresh ? ' — น้ำใช้เวลาราว 2–3 วันถึงกรุงเทพฯ' : ` <span class="muted">(ค่าเก่า ณ ${fmtTime(dam.time)})</span>`}` : '';
    const r8 = V.rama8 ? `🌉 สะพานพระราม 8 ไหล ${n0(V.rama8.flow)} ลบ.ม./วิ${V.rama8.avg ? ` (เฉลี่ย ${n0(V.rama8.avg)})` : ''}${V.rama8.fresh ? '' : ' <span class="muted">(ค่าเก่า)</span>'}` : '';
    parts.push(headCard(V, {
      title: `🌊 ${V.liveCount ? 'น้ำเหนือตอนนี้' : 'น้ำเหนือ'} · แม่น้ำเจ้าพระยา`,
      riverName: 'แม่น้ำเจ้าพระยา', nearProv: NEAR_PROV, lines: [damLine, r8],
    }));
    parts.push(`<div class="glass rail-wrap">
      <div class="line-head"><span>เหนือ ↓ ใต้ (ไหลจากนครสวรรค์)</span></div>
      ${railSvg(V, { stale: cStale, home, id: 'cp', ariaLabel: 'รางรถไฟแม่น้ำเจ้าพระยา', damCode: '2744', damLabel: '(เขื่อนเจ้าพระยา)', endLabel: '🌊 อ่าวไทย' })}
      ${LEGEND}
    </div>`);
  }

  if (!parts.length) {
    box.innerHTML = '<div class="glass card"><p class="muted">ยังไม่มีข้อมูลแม่น้ำ — ลองใหม่ภายหลัง</p></div>';
    return;
  }
  box.innerHTML = `
    <div class="glass card rv-note">
      <b>น้ำเหนือมาถึงบ้านเรายังไง?</b> บ้านอยู่กรุงเทพฯ ฝั่งตะวันออก (ทุ่งรับน้ำ)
      น้ำเหนือมาทาง <b>แม่น้ำป่าสัก → เขื่อนพระรามหก → คลองระพีพัฒน์ → รังสิต → หกวา → คลองแถวบ้าน</b>
      ส่วนแม่น้ำเจ้าพระยาผ่านฝั่งตะวันตก ห่างบ้าน ~18 กม. — ถ้าล้นมากที่อยุธยา–ปทุมฯ น้ำมักถูกผันเข้าทุ่งฝั่งตะวันออกด้วย
    </div>
    ${parts.join('')}
    <p class="hint">ข้อมูล: สสน. · กรมชลประทาน (ThaiWater) · กทม. ผ่าน <a href="https://flood.pop.in.th" target="_blank" rel="noopener">POPNIX Flood</a> · "2–3 วัน" เป็นค่าประมาณทั่วไป</p>`;
}
