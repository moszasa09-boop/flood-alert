// ThaiWater (สสน.) — ระดับน้ำทั่วประเทศ
import { SOURCES } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// "2026-10-03 18:00" (เวลาไทย) → epoch ms
export function parseThaiTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 7 * 3600e3;
}

export function normalizeThaiwater(r) {
  const s = r.station || {};
  const wl = num(r.waterlevel_msl);
  const time = parseThaiTime(r.waterlevel_datetime);
  return {
    key: `tw:${s.id}`,
    src: 'tw',
    id: s.id,
    name: s.tele_station_name?.th || '',
    fullName: s.tele_station_name?.th || '',
    code: s.tele_station_oldcode,
    district: r.geocode?.amphoe_name?.th,
    lat: num(s.tele_station_lat),
    lon: num(s.tele_station_long),
    time,
    wl,
    wlOut: null,
    isGate: false,
    bank: num(s.min_bank),
    leftBank: num(s.left_bank),
    rightBank: num(s.right_bank),
    warning: null,
    critical: null,
    // หมายเหตุ: waterlevel_msl_previous คือค่า "รอบก่อน" (ปกติห่าง 10 นาที แต่ไม่มีเวลากำกับ)
    // จึงไม่เอามาคิดอัตรา — ใช้ประวัติที่ระบบเก็บเองแทน
    agencyStatus: r.situation_level ? `ระดับ ${r.situation_level}/5` : null,
    url: 'https://www.thaiwater.net/water/wl',
  };
}

export async function fetchThaiwater() {
  const res = await fetchWithRetry(SOURCES.thaiwater, {}, { tries: 3 });
  const json = await res.json();
  const rows = json?.waterlevel_data?.data;
  if (!Array.isArray(rows) || rows.length < 50) throw new Error('ThaiWater: ได้ข้อมูลผิดรูปแบบ');
  return rows.map(normalizeThaiwater);
}
