// แม่น้ำป่าสัก: ต้นทางของน้ำที่มาทางบ้านเรา
//   เพชรบูรณ์ → เขื่อนป่าสักชลสิทธิ์ → สระบุรี → เขื่อนพระรามหก (ท่าเรือ) ─┬→ คลองระพีพัฒน์ → รังสิต → หกวา → บ้านเรา
//                                                                      └→ นครหลวง → แม่น้ำเจ้าพระยา (อยุธยา)
// ข้อมูลสถานีจาก ThaiWater waterlevel_load (ดึงอยู่แล้ว) + เขื่อนจาก ThaiWater analyst/dam
import { fetchWithRetry } from './http.mjs';
import { riverStatus, riverFront } from './river.mjs';

const DAM_API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/analyst/dam';
export const PASAK_DAM_ID = 11; // ป่าสักชลสิทธิ์
export const RAMA6_CODE = '2624'; // ท้ายเขื่อนพระรามหก = จุดแยกเข้าคลองระพีพัฒน์

// เรียงเหนือ → ใต้ (รหัส ThaiWater station.id)
export const PASAK_STATIONS = [
  { id: 693, province: 'เพชรบูรณ์', name: 'หล่มสัก' },
  { id: 691, province: 'เพชรบูรณ์', name: 'เมืองเพชรบูรณ์' },
  { id: 700, province: 'เพชรบูรณ์', name: 'หนองไผ่' },
  { id: 2799, province: 'เพชรบูรณ์', name: 'บ้านบ่อวัง (วิเชียรบุรี)' },
  { id: 2753, province: 'ลพบุรี', name: 'บ้านท่ารวก (ชัยบาดาล)' },
  { id: 2712, province: 'ลพบุรี', name: 'ท้ายเขื่อนป่าสักชลสิทธิ์', dam: true },
  { id: 2706, province: 'สระบุรี', name: 'วัดท่าระหัด (วังม่วง)' },
  { id: 2632, province: 'สระบุรี', name: 'บ้านป่า (แก่งคอย)' },
  { id: 2623, province: 'สระบุรี', name: 'เมืองสระบุรี' },
  { id: 2624, province: 'อยุธยา', name: 'ท้ายเขื่อนพระรามหก (ท่าเรือ)', branch: true },
  { id: 44, province: 'อยุธยา', name: 'นครหลวง' },
];

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// index: Map ของสถานี ThaiWater ที่ normalize แล้ว (key 'tw:<id>')
export function buildPasak(index, dam, now = Date.now()) {
  const stations = PASAK_STATIONS.map((ref) => {
    const s = index.get(`tw:${ref.id}`);
    const wl = num(s?.wl), bank = num(s?.bank);
    const time = Number.isFinite(s?.time) ? s.time : null;
    const diff = wl != null && bank != null ? Math.round((wl - bank) * 100) / 100 : null;
    return {
      code: String(ref.id), name: ref.name, province: ref.province,
      dam: !!ref.dam, branch: !!ref.branch,
      lat: num(s?.lat), lon: num(s?.lon), wl, bank, diff, time, trend: null, flow: null,
      status: riverStatus(diff, time ? (now - time) / 60000 : null),
    };
  });
  if (!stations.some((s) => s.time)) return null;
  return { stations, front: riverFront(stations), dam };
}

// เขื่อนป่าสักชลสิทธิ์ (ข้อมูลรายวัน) — ปริมาณ ล้าน ลบ.ม./วัน → ลบ.ม./วินาที
export function normalizePasakDam(json) {
  const rows = json?.data?.dam_daily;
  const r = Array.isArray(rows) ? rows.find((x) => x?.dam?.id === PASAK_DAM_ID) : null;
  if (!r) return null;
  const cms = (mcmPerDay) => (num(mcmPerDay) == null ? null : Math.round((num(mcmPerDay) * 1e6) / 86400));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.dam_date || '') ? r.dam_date : null;
  return {
    name: 'เขื่อนป่าสักชลสิทธิ์',
    date,
    time: date ? Date.parse(`${date}T06:00:00+07:00`) : null, // ข้อมูลรายวัน (ประมาณ 06:00)
    storage: num(r.dam_storage),
    storagePct: num(r.dam_storage_percent),   // % ของระดับเก็บกักปกติ
    normal: num(r.dam?.normal_storage),
    max: num(r.dam?.max_storage),
    inflowCms: cms(r.dam_inflow),
    releaseCms: cms(r.dam_released),
    spilledCms: cms(r.dam_spilled),
  };
}

export async function fetchPasakDam() {
  const res = await fetchWithRetry(DAM_API, {}, { tries: 2 });
  const dam = normalizePasakDam(await res.json());
  if (!dam) throw new Error('ไม่พบข้อมูลเขื่อนป่าสักชลสิทธิ์');
  return dam;
}
