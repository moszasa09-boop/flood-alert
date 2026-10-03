// รางรถไฟน้ำเหนือ: แม่น้ำเจ้าพระยา นครสวรรค์ → กรุงเทพฯ (ข้อมูล สสน./กรมชลฯ/กทม. ผ่าน POPNIX Flood)
import { SOURCES } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';
import { parsePopTime } from './popnix.mjs';

// จังหวัดของแต่ละสถานี (รหัสจาก api_river) — สถานีใหม่ที่ไม่อยู่ในรายการจะแสดงโดยไม่มีชื่อจังหวัด
export const RIVER_PROVINCE = {
  568: 'นครสวรรค์', 2795: 'นครสวรรค์', 584: 'นครสวรรค์',
  80: 'ชัยนาท', 2744: 'ชัยนาท', 89: 'ชัยนาท',
  71: 'สิงห์บุรี', 2723: 'สิงห์บุรี', 68: 'สิงห์บุรี',
  2626: 'อ่างทอง', 58: 'อ่างทอง',
  39: 'อยุธยา', 2609: 'อยุธยา', 49: 'อยุธยา',
  26: 'นนทบุรี',
  2599: 'กรุงเทพฯ', 'bma:76': 'กรุงเทพฯ', 4: 'กรุงเทพฯ',
};
export const DAM_CODE = '2744'; // ท้ายเขื่อนเจ้าพระยา (C.13) ชัยนาท
const STALE_MIN = 180;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// สถานะสถานีแม่น้ำ จากระดับน้ำเทียบตลิ่ง (diff = น้ำ − ตลิ่ง, ม.)
export function riverStatus(diff, ageMin) {
  if (diff == null) return 'unknown';
  if (ageMin > STALE_MIN) return 'stale';
  if (diff >= 0) return 'red';        // ล้นตลิ่ง
  if (diff > -0.3) return 'orange';   // เหลือไม่ถึง 30 ซม.
  if (diff > -1.0) return 'yellow';   // สูง
  return 'green';
}

// "น้ำเหนือมาถึงไหนแล้ว" = สถานีใต้สุด (ใกล้ กทม. สุด) ที่ล้นตลิ่ง / ใกล้ล้น
export function riverFront(stations) {
  const live = stations.filter((s) => !['stale', 'unknown'].includes(s.status));
  const pick = (lv) => [...live].reverse().find((s) => lv.includes(s.status)) || null;
  return { overflow: pick(['red']), near: pick(['red', 'orange']), overflowCount: live.filter((s) => s.status === 'red').length };
}

export function normalizeRiver(json, now = Date.now()) {
  const main = (json.stations || [])
    .filter((x) => x.order != null && x.river === 'แม่น้ำเจ้าพระยา')
    .sort((a, b) => a.order - b.order)
    .map((x) => {
      const time = parsePopTime(x.measured_at);
      const diff = num(x.diff);
      const ageMin = time ? (now - time) / 60000 : Infinity;
      return {
        code: String(x.code),
        name: (x.name || '').trim(),
        province: RIVER_PROVINCE[x.code] || RIVER_PROVINCE[String(x.code)] || null,
        agency: x.agency,
        lat: num(x.lat), lon: num(x.lng),
        wl: num(x.wl), bank: num(x.bank), diff,
        trend: x.trend || null,
        flow: num(x.flow),
        time,
        spark: Array.isArray(x.spark) ? x.spark.map(num) : [],
        status: riverStatus(diff, ageMin),
      };
    });
  const dam = json.notes?.dam_release;
  const rama8 = (json.flows || []).find((f) => f.code === 'FW.PKG.01');
  return {
    stations: main,
    front: riverFront(main),
    damRelease: dam?.v != null ? { flow: num(dam.v), time: parsePopTime(dam.as_of), src: dam.src } : null,
    rama8: rama8 ? { flow: num(rama8.flow), avg: num(rama8.avg_flow), time: parsePopTime(rama8.measured_at) } : null,
  };
}

export async function fetchRiver() {
  const res = await fetchWithRetry(`${SOURCES.popnix}/api_river.php`, {}, { tries: 2 });
  const json = await res.json();
  const r = normalizeRiver(json);
  if (r.stations.length < 8) throw new Error('POPNIX river: สถานีน้อยผิดปกติ');
  return r;
}
