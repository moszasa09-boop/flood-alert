// แหล่งสำรองชั้นที่ 3: ข้อมูลคลองของสำนักการระบายน้ำ กทม. ที่ ThaiWater (สสน.) นำมาเผยแพร่
// ช่องทางนี้หยุด/กลับมาเป็นช่วงๆ — ใช้เฉพาะเมื่อค่าใหม่กว่าแหล่งอื่น (ตรวจเวลาเสมอ)
// จับคู่ด้วยรหัสสถานีของ กทม. (เช่น WL.PSR.02) · ใช้ระดับตลิ่งของ กทม. จาก config เพราะ ThaiWater ใช้ค่าตลิ่งต่างกัน
import { SOURCES } from '../config.mjs';
import { fetchWithRetry } from './http.mjs';
import { parseThaiTime } from './thaiwater.mjs';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// → Map(code → { wl, time, name })
export function normalizeTwCanal(json) {
  const out = new Map();
  for (const r of json?.data || []) {
    const code = r?.station?.canal_oldcode;
    const wl = num(r?.canal_value);
    const time = parseThaiTime(r?.canal_datetime);
    if (!code || wl == null || !time) continue;
    out.set(code, { wl, time, name: r.station.canal_name?.th || code });
  }
  return out;
}

export async function fetchTwCanal() {
  const res = await fetchWithRetry(SOURCES.twCanal, {}, { tries: 2 });
  return normalizeTwCanal(await res.json());
}
