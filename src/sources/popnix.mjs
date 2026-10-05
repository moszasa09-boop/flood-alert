// POPNIX Flood (flood.pop.in.th) — ข้อมูลคลองของสำนักการระบายน้ำ กทม. ที่จัดรูปแบบใหม่ เปิดให้ใช้ฟรี
// ใช้เป็นแหล่งสำรองเมื่อดึงเว็บ กทม. ตรงไม่ได้ (เว็บ กทม. บล็อกเครื่องต่างประเทศ เช่น GitHub Actions)
// เงื่อนไข: ต้องให้เครดิต "ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)"
//           และห้ามแสดงเป็นประกาศเตือนภัยทางการ
import { SOURCES } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';

export const POPNIX_CREDIT = 'ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// "2026-10-03 19:35:00" (เวลาไทย) → epoch ms
export function parsePopTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 7 * 3600e3;
}

export function normalizePopnix(x) {
  return {
    popId: x.id,
    name: (x.name || '').replace(/\s+/g, ' ').trim(),
    lat: num(x.lat),
    lon: num(x.lng),
    time: parsePopTime(x.measured_at),
    wl: num(x.wl),
    bank: num(x.bank),
    warning: num(x.warn),
    critical: num(x.crit),
    maxToday: num(x.max_day),
    maxYesterday: num(x.max_yday),
  };
}

export async function fetchPopnixAll() {
  const res = await fetchWithRetry(`${SOURCES.popnix}/api_overview.php`, {}, { tries: 2 });
  const json = await res.json();
  if (!Array.isArray(json?.stations) || json.stations.length < 50) throw new Error('POPNIX: ได้ข้อมูลผิดรูปแบบ');
  return json.stations.map(normalizePopnix);
}

// ประวัติ 72 ชม. ของสถานีเดียว → [[epochMs, wl], ...]
export async function fetchPopnixHistory(popId) {
  const res = await fetchWithRetry(`${SOURCES.popnix}/api_history.php?id=${encodeURIComponent(popId)}&h=72`, {}, { tries: 2 });
  const json = await res.json();
  return (json.points || []).map((p) => [parsePopTime(p.t), num(p.wl)]).filter(([t, v]) => t && v !== null);
}

// หาสถานี POPNIX ที่ตำแหน่งตรงกับสถานี กทม. (ภายใน maxKm) — ไม่จับคู่ด้วยรหัส เพราะบางรหัสชื่อไม่ตรงกัน
export function matchByLocation(list, lat, lon, maxKm = 0.2) {
  if (lat == null || lon == null) return null;
  const r = (d) => (d * Math.PI) / 180;
  let best = null;
  let bestKm = Infinity;
  for (const s of list) {
    if (s.lat == null || s.lon == null) continue;
    const x = Math.sin(r(s.lat - lat) / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(s.lat)) * Math.sin(r(s.lon - lon) / 2) ** 2;
    const km = 12742 * Math.asin(Math.sqrt(x));
    if (km < bestKm) { best = s; bestKm = km; }
  }
  return bestKm <= maxKm ? best : null;
}

// จับคู่สถานี POPNIX กับสถานี กทม.: ใช้ตำแหน่งก่อน · ถ้า POPNIX ไม่มีพิกัด ใช้ "รหัสตรงกัน + ชื่อจุดตรงกัน"
// (บางรหัสใน POPNIX ชื่อเป็นคนละสถานี เช่น 20 = ส.คลองขุนราชพินิจใจ จึงต้องเช็กชื่อด้วย ไม่ใช้รหัสอย่างเดียว)
const tokens = (s) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').map((w) => w.replace(/^(ค\.|ปตร\.|ส\.|คลอง|จุดวัด)/, '')).filter((w) => w.length >= 3);
export function matchStation(list, ref) {
  const byLoc = matchByLocation(list, ref.lat, ref.lon);
  if (byLoc) return byLoc;
  const p = list.find((s) => s.popId === ref.id);
  if (!p || (p.lat != null && p.lon != null)) return null; // มีพิกัดแต่ห่างเกิน = คนละสถานี
  const refName = String(ref.name || '');
  const placeTokens = tokens(p.name).filter((w) => !/^พระยาสุเรนทร์|^แสนแสบ|^ประเวศ/.test(w)); // ตัดชื่อคลองออก เหลือชื่อจุด
  return placeTokens.some((w) => refName.includes(w)) ? p : null;
}
