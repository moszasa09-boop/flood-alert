// แท็บ "แผนที่": เส้นทางน้ำแบบรางรถไฟบนแผนที่จริง
//   เส้นที่ 1 = แม่น้ำเจ้าพระยา (น้ำเหนือหลัก) นครสวรรค์ → อ่าวไทย
//   เส้นที่ 2 = คลองฝั่งตะวันออก ระพีพัฒน์ → หกวา → บ้านเรา → แสนแสบ → ประเวศ → ทะเล
// จุดเชื่อมระหว่างสถานีเป็น "เส้นตรงแบบแผนผัง" ไม่ใช่แนวแม่น้ำจริง
const COLORS = { green: '#22e39a', yellow: '#ffd23f', orange: '#ff8a2a', red: '#ff3b5c', stale: '#6b7a94', unknown: '#6b7a94' };
const LABEL = { green: 'ปกติ', yellow: 'เฝ้าระวัง', orange: 'ใกล้ตลิ่ง', red: 'เกินตลิ่ง', stale: 'ข้อมูลค้าง', unknown: 'ไม่มีข้อมูล' };
const LIVE = ['green', 'yellow', 'orange', 'red'];
const SEA_CP = [13.545, 100.585]; // ปากแม่น้ำเจ้าพระยา (สมุทรปราการ)
const SEA_EAST = [13.56, 100.78]; // ทางออกทะเลของคลองฝั่งตะวันออก (บางปะกง/สมุทรปราการ) — โดยประมาณ
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pos = (s) => (s.wl == null || s.bank == null ? '' : s.wl >= s.bank ? `เกินตลิ่ง ${Math.round((s.wl - s.bank) * 100)} ซม.` : `ต่ำกว่าตลิ่ง ${Math.round((s.bank - s.wl) * 100)} ซม.`);

// เส้นแบบสถานีต่อสถานี: แต่ละช่วงใช้สีของสถานีต้นทาง + เส้นประวิ่งบอกทิศน้ำไหล
function railLine(layer, pts, { weight = 6, calm = false, label = '', labelLeft = false } = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const c = COLORS[a.status] || COLORS.unknown;
    L.polyline([a.ll, b.ll], { color: '#050b1a', weight: weight + 4, opacity: 0.85, interactive: false }).addTo(layer);
    L.polyline([a.ll, b.ll], { color: c, weight, opacity: 0.95, interactive: false }).addTo(layer);
    if (!calm) L.polyline([a.ll, b.ll], { color: '#ffffff', weight: 2, opacity: 0.75, className: 'flow-dash', interactive: false }).addTo(layer);
  }
  if (label && pts.length) {
    L.marker(pts[0].ll, { interactive: false, icon: L.divIcon({ className: `route-label${labelLeft ? ' left' : ''}`, html: esc(label), iconSize: [170, 20], iconAnchor: labelLeft ? [182, 10] : [-12, 26] }) }).addTo(layer);
  }
}

function stationDot(layer, s, title, extra = '') {
  const c = COLORS[s.status] || COLORS.unknown;
  L.circleMarker(s.ll, { radius: 7, color: '#0a1630', weight: 2.5, fillColor: c, fillOpacity: 1 })
    .bindPopup(`<b>${esc(title)}</b>${extra}<br>${LABEL[s.status] || ''}${s.wl != null ? ` · ${s.wl.toFixed(2)} ม.` : ''}<br><span style="color:#8ea3c4">${esc(pos(s))}</span>`)
    .addTo(layer);
}

export function drawFlowMap(map, layer, DATA, { stale = false, calm = false } = {}) {
  const S = (st) => (stale ? 'stale' : st);
  const bounds = [];

  // ---------- เส้นที่ 1: แม่น้ำเจ้าพระยา ----------
  const rv = (DATA.river?.stations || []).filter((s) => s.lat != null);
  const cp = rv.map((s) => ({ ...s, ll: [s.lat, s.lon], status: S(s.status) }));
  if (cp.length) {
    const tail = { ll: SEA_CP, status: cp.at(-1).status };
    railLine(layer, [...cp, tail], { weight: 6, calm, label: '🌊 แม่น้ำเจ้าพระยา (น้ำเหนือ)' });
    let prov = null;
    for (const s of cp) {
      stationDot(layer, s, s.name, s.province ? ` · ${esc(s.province)}` : '');
      if (s.province && s.province !== prov) {
        prov = s.province;
        L.marker(s.ll, { interactive: false, icon: L.divIcon({ className: 'prov-label', html: `📍 ${esc(prov)}`, iconSize: [110, 18], iconAnchor: [118, 9] }) }).addTo(layer);
      }
      bounds.push(s.ll);
    }
    const f = DATA.river.front?.overflow;
    if (f?.lat != null && !stale) {
      L.marker([f.lat, f.lon], { interactive: false, icon: L.divIcon({ className: 'front-label', html: '🌊 ล้นถึงตรงนี้', iconSize: [104, 22], iconAnchor: [-10, 30] }) }).addTo(layer);
    }
  }

  // ---------- เส้นที่ 2: คลองฝั่งตะวันออก → บ้านเรา ----------
  const east = [];
  for (const n of DATA.nodes) {
    const live = n.stations.filter((s) => s.lat != null && LIVE.includes(s.status));
    const rep = live.find((s) => s.primary) || live.sort((a, b) => (a.margin ?? 9) - (b.margin ?? 9))[0] || n.stations.find((s) => s.lat != null);
    if (!rep) continue;
    const pt = { ...rep, ll: [rep.lat, rep.lon], status: S(n.status), nodeName: n.name, role: n.role };
    if (n.role === 'home') pt.ll = [DATA.home.lat, DATA.home.lon]; // เส้นผ่านบ้านพอดี
    east.push(pt);
  }
  if (east.length) {
    railLine(layer, [...east, { ll: SEA_EAST, status: east.at(-1).status }], { weight: 5, calm, label: '🏞️ คลองฝั่งตะวันออก → บ้านเรา', labelLeft: true });
    for (const p of east) {
      if (p.role === 'home') continue;
      stationDot(layer, p, p.nodeName, `<br><span style="color:#8ea3c4">${esc(p.name)}</span>`);
      bounds.push(p.ll);
    }
  }

  // ---------- บ้าน ----------
  const homeNode = DATA.nodes.find((n) => n.role === 'home');
  const hst = S(DATA.overall.status);
  const hc = COLORS[hst] || COLORS.unknown;
  L.marker([DATA.home.lat, DATA.home.lon], {
    zIndexOffset: 1000,
    icon: L.divIcon({ className: 'home-pin', html: `<div class="home-pin-ring" style="--c:${hc}">🏠</div><div class="home-pin-lbl">บ้านเรา</div>`, iconSize: [64, 58], iconAnchor: [32, 22] }),
  }).bindPopup(`<b>🏠 บ้านเรา</b><br>สถานะ: ${esc(LABEL[homeNode?.status] || '')}<br>${esc(DATA.overall.reasons.join(' · '))}`).addTo(layer);
  bounds.push([DATA.home.lat, DATA.home.lon]);
  return bounds;
}
